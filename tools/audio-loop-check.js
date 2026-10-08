#!/usr/bin/env node
// Is a recording's audio stuck on repeat?
//
//   node tools/audio-loop-check.js <file.mp4|.webm|.wav|.opus> [--from=S] [--to=S]
//        [--max-lag=3] [--threshold=0.98] [--json]
//
// A DirectSound ring the guest stopped refilling keeps playing: the cursor
// sweeps the same bytes lap after lap, and what comes out is one ring-length
// of audio repeated sample-exactly -- the "sound stuck on repeat" users
// report. Ears catch it instantly and every counter in the emulator can miss
// it (in Threads mode a worklet-routed ring never calls back into the page at
// all), so this judges the only thing that is ground truth: the recorded
// output. Make one with tools/record-probe.js.
//
// For every one-second window it finds the earlier lag (50ms..--max-lag) at
// which the audio best matches itself, by normalized cross-correlation over
// FFTs. A stuck ring is a correlation of ~1.0 at a lag of one ring lap,
// second after second. Real music repeats too, but not sample-exactly: on
// measured menu themes it stays under ~0.95. Quiet windows (RMS under -50 dB)
// are reported as silent and never as stuck, since a silent ring replaying
// zeros is inaudible.
//
// Needs ffmpeg on PATH (it decodes to 4 kHz mono s16 first).

'use strict';

const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const FILE = argv.find(a => !a.startsWith('--'));
if (!FILE) {
  console.error('usage: audio-loop-check.js <recording> [--from=S] [--to=S] [--max-lag=3] [--threshold=0.98] [--json]');
  process.exit(2);
}
const RATE = 4000;
const FROM = Number(opt('from', '0'));
const TO = opt('to', null) === null ? null : Number(opt('to', null));
const MAX_LAG = Math.round(Number(opt('max-lag', '3')) * RATE);
const MIN_LAG = Math.round(0.05 * RATE);
const THRESHOLD = Number(opt('threshold', '0.98'));
const JSON_OUT = argv.includes('--json');
const W = RATE;                       // one-second windows
const SILENT_DB = -50;

function decode(file) {
  const args = ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'];
  let raw;
  try { raw = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 }); }
  catch (e) { throw new Error(`ffmpeg could not decode ${file}: ${e.message}`); }
  const n = raw.length >> 1;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = raw.readInt16LE(i * 2) / 32768;
  return x;
}

// In-place iterative radix-2 FFT on (re, im).
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * cr - ai * ci, ti = ar * ci + ai * cr;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Best normalized correlation of x[t, t+W) against x[t-L, t-L+W) for
// L in [MIN_LAG, maxLag].
function bestLag(x, t, maxLag, prefixSq) {
  const segStart = t - maxLag;
  const segLen = maxLag + W;
  let n = 1;
  while (n < segLen + W) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const br = new Float64Array(n), bi = new Float64Array(n);
  for (let i = 0; i < W; i++) ar[i] = x[t + i];
  for (let i = 0; i < segLen; i++) br[i] = x[segStart + i];
  fft(ar, ai, false);
  fft(br, bi, false);
  // corr[k] = sum_i a[i] * b[i + k]  ->  IFFT(conj(A) * B)
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const im = ar[i] * bi[i] - ai[i] * br[i];
    br[i] = r; bi[i] = im;
  }
  fft(br, bi, true);
  const ea = prefixSq[t + W] - prefixSq[t];
  const corr = new Float64Array(maxLag + 1);
  let top = 0;
  for (let L = MIN_LAG; L <= maxLag; L++) {
    const k = maxLag - L;              // b offset where x[t-L] sits
    const s = segStart + k;
    const eb = prefixSq[s + W] - prefixSq[s];
    corr[L] = eb > 0 ? br[k] / Math.sqrt(ea * eb) : 0;
    if (corr[L] > top) top = corr[L];
  }
  // A loop repeats at its lap AND every multiple of it, all ~equally well:
  // report the shortest lag that is as good as the best, i.e. the lap.
  let lag = 0;
  for (let L = MIN_LAG; L <= maxLag; L++) if (corr[L] >= top - 1e-3) { lag = L; break; }
  // Sharpness: how much of the lag range matches nearly as well. A steady
  // tone is periodic at every pitch period, so most lags score high; a
  // replayed ring of real audio scores high only at multiples of its lap.
  // The median |corr| tells the two apart (tone ~0.6+, loop or music ~0.1).
  const mags = Array.from(corr.subarray(MIN_LAG), Math.abs).sort((a, b) => a - b);
  const median = mags.length ? mags[mags.length >> 1] : 0;
  return { corr: top, lagMs: Math.round(lag * 1000 / RATE), median };
}

function main() {
  const x = decode(FILE);
  const prefixSq = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefixSq[i + 1] = prefixSq[i] + x[i] * x[i];
  const end = Math.min(x.length - W, TO === null ? Infinity : Math.floor(TO * RATE));
  const rows = [];
  for (let t = Math.max(Math.floor(FROM * RATE), MIN_LAG + 1); t <= end; t += W) {
    const e = prefixSq[t + W] - prefixSq[t];
    const db = e > 0 ? 10 * Math.log10(e / W) : -Infinity;
    const sec = +(t / RATE).toFixed(1);
    if (db < SILENT_DB) { rows.push({ sec, db: +db.toFixed(1), silent: true }); continue; }
    const maxLag = Math.min(MAX_LAG, t);
    if (maxLag < MIN_LAG) continue;
    const b = bestLag(x, t, maxLag, prefixSq);
    const tonal = b.median >= 0.5;
    rows.push({ sec, db: +db.toFixed(1), corr: +b.corr.toFixed(4), lagMs: b.lagMs,
      median: +b.median.toFixed(3), tonal, stuck: b.corr >= THRESHOLD && !tonal });
  }
  const audible = rows.filter(r => !r.silent);
  const stuck = audible.filter(r => r.stuck);
  // Longest run of consecutive stuck seconds: one isolated hit can be a held
  // note; a run is a ring looping.
  let run = 0, longest = 0, longestAt = null;
  for (const r of rows) {
    if (r.stuck) { run++; if (run > longest) { longest = run; longestAt = +(r.sec - run + 1).toFixed(1); } }
    else run = 0;
  }
  const summary = {
    file: FILE, seconds: +(x.length / RATE).toFixed(1), windows: rows.length,
    audible: audible.length, silent: rows.length - audible.length,
    stuck: stuck.length, stuckPct: audible.length ? +(100 * stuck.length / audible.length).toFixed(1) : null,
    longestStuckRun: longest, longestStuckAt: longestAt, threshold: THRESHOLD,
    verdict: !audible.length ? 'SILENT' : longest >= 2 ? 'STUCK-LOOP' : 'OK',
  };
  if (JSON_OUT) { console.log(JSON.stringify({ summary, rows })); return; }
  for (const r of rows) {
    console.log(r.silent ? `  ${String(r.sec).padStart(6)}s  ${String(r.db).padStart(6)} dB  silent`
      : `  ${String(r.sec).padStart(6)}s  ${String(r.db).padStart(6)} dB  corr ${r.corr.toFixed(3)} @ ${r.lagMs}ms  median ${r.median.toFixed(2)}${r.stuck ? '  STUCK' : r.tonal ? '  (tonal)' : ''}`);
  }
  console.log(`\n${summary.verdict}: ${summary.stuck}/${summary.audible} audible seconds repeat at corr >= ${THRESHOLD}` +
    ` (longest run ${longest}s${longestAt !== null ? ` from ${longestAt}s` : ''}); ${summary.silent} silent.`);
}

main();
