#!/usr/bin/env node
// Where does a LONG run actually spend its time? Sample the handler/hot-block
// histogram repeatedly over a live `--control` session and attribute every
// window to a module.
//
//   node tools/ctl-hist-series.js --port=8124 --log=/tmp/wc3-run2.log \
//     --window=45 --gap=15 --count=60 --out=/tmp/wc3-series.ndjson
//   node tools/ctl-hist-series.js --report=/tmp/wc3-series.ndjson
//
// WHY THIS EXISTS
//   tools/hot-loop-census.js consumes several histogram windows and exists
//   because one window is not evidence about where an app spends its time.
//   Nothing *produced* those windows for a CLI session: the ctl probe is a
//   single shot, so every long-run conclusion so far came from one or two
//   hand-timed samples. That is how the Warcraft III campaign load got read as
//   "40% ijl15" when 40% was the share in the first four minutes of a forty
//   minute load -- a number that decides whether intercepting the JPEG decoder
//   is a 1.7x or a rounding error, quoted from a window that could not answer
//   it.
//
//   Shares of block entries are load-immune, so a series collected on a busy
//   box is still comparable window to window. Wall-clock rates are not, and
//   this tool deliberately does not print any.
//
// WHAT A WINDOW COSTS
//   Arming resets the counters, so windows do not overlap and the gap between
//   them is genuinely unsampled -- `--gap=0` measures everything at the cost of
//   never letting the histogram be off. The counters are plain wasm globals
//   incremented in the dispatch loop; the measured cost of leaving them on is
//   small, but it is not nothing, so the default leaves a gap.
//
// MODULE ATTRIBUTION
//   The probe returns raw runtime addresses. Turning 0x00f2a0f0 into
//   `ijl15.dll+0x600330f0` needs each module's load base and its PE-declared
//   origBase, which `test/run.js` prints once at load as
//   `DLL: NAME at 0xBASE, ..., origBase=0xORIG`. Point --log at the run's log
//   and those lines are parsed into the `mods` shape tools/hist-blocks.js
//   already understands, so attribution is not written a third time.

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { makeAttributor, handlerNames } = require('./hist-blocks');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = opt('port', '8124');
const LOG = opt('log', '');
const OUT = opt('out', '');
const REPORT = opt('report', '');
const WINDOW = Number(opt('window', '45'));
const GAP = Number(opt('gap', '15'));
const COUNT = Number(opt('count', '60'));
const TOPB = Number(opt('top-blocks', '40'));
const EXE_BASE = Number(opt('exe-base', '0x400000'));
const LABEL = opt('label', '');

const PROBE = path.join(__dirname, 'ctl-probes', 'read-handler-hist.js');

// `DLL: Game.dll at 0x561000, DllMain=0x9889ad, thunks=2710, origBase=0x6f000000`
function parseMods(logFile) {
  const mods = {};
  if (!logFile) return mods;
  let text;
  try { text = fs.readFileSync(logFile, 'utf8'); }
  catch (err) { throw new Error(`--log=${logFile} unreadable: ${err.message}`); }
  const re = /^DLL:\s+(\S+)\s+at\s+(0x[0-9a-fA-F]+).*?origBase=(0x[0-9a-fA-F]+)/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) mods[m[1]] = [parseInt(m[2], 16), parseInt(m[3], 16)];
  }
  return mods;
}

function post(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      host: '127.0.0.1', port: Number(PORT), path: '/ctl', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', c => { text += c; });
      response.on('end', () => {
        try { resolve(JSON.parse(text)); }
        catch (_) { resolve({ ok: false, error: text.slice(0, 300) }); }
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));

// The probe ends in a `return JSON.stringify(...)`, so the control server hands
// back a string in `value`. A run that has not reached the guest yet returns
// null rather than throwing; treat that as a skipped window, not a failure.
async function sample(code) {
  const res = await post({ action: 'eval', code });
  if (!res || res.ok === false) throw new Error(`ctl eval failed: ${res && res.error}`);
  if (typeof res.value !== 'string') return null;
  return JSON.parse(res.value);
}

// One window -> the per-module share of block entries, plus the top blocks and
// handlers already named. Shares are of block ENTRIES, which is the load-immune
// quantity; ops are reported too because ops/block is what separates
// "block-transfer-bound" from "op-bound".
function summarize(hist, mods, names) {
  const attribute = makeAttributor({ mods }, EXE_BASE);
  const byMod = new Map();
  let attributed = 0;
  for (const [hex, hits] of hist.blocks || []) {
    const a = attribute(parseInt(hex, 16) >>> 0);
    byMod.set(a.name, (byMod.get(a.name) || 0) + hits);
    attributed += hits;
  }
  const blockHits = hist.blockHits || 0;
  const modules = [...byMod.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, hits]) => [name, +(100 * hits / (blockHits || 1)).toFixed(2)]);
  return {
    ops: hist.ops || 0,
    blockHits,
    distinct: hist.distinct || 0,
    opsPerBlock: blockHits ? +(hist.ops / blockHits).toFixed(2) : 0,
    // The probe returns a top-N block list, so module shares are shares of the
    // WHOLE window's entries carried by those blocks -- they do not sum to 100
    // and must not be renormalized as if they did.
    coverage: +(100 * attributed / (blockHits || 1)).toFixed(2),
    modules,
    handlers: (hist.handlers || []).slice(0, 12)
      .map(([id, c]) => [names[id] || `H${id}`, c]),
    blocks: (hist.blocks || []).slice(0, TOPB).map(([hex, hits]) => {
      const a = attribute(parseInt(hex, 16) >>> 0);
      return [`${a.name}+0x${a.va.toString(16)}`, hits];
    }),
  };
}

function reportLine(i, elapsed, s) {
  const mods = s.modules.slice(0, 4)
    .map(([n, p]) => `${n.replace(/\.dll$/, '')} ${p}%`).join('  ');
  return `#${String(i).padStart(3)} t+${String(Math.round(elapsed)).padStart(5)}s  `
    + `${s.opsPerBlock.toFixed(2)} ops/blk  ${(s.blockHits / 1e6).toFixed(1)}M blk  `
    + `${String(s.distinct).padStart(6)} distinct  | ${mods}`;
}

// --report: read a collected series back and print the module share per window,
// which is the "where did the time go" table. Read DOWN a column to see a phase
// hand over from one module to another; a module that is high in one window and
// absent in the next is a phase, not a cost centre.
function printReport(file) {
  const rows = fs.readFileSync(file, 'utf8').split('\n')
    .filter(Boolean).map(l => JSON.parse(l));
  if (!rows.length) { console.log(`${file} is empty`); return; }
  const all = new Map();
  for (const r of rows) for (const [n, p] of r.modules) all.set(n, (all.get(n) || 0) + p);
  const cols = [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  const head = ['window', 'ops/blk', 'distinct', ...cols.map(c => c.replace(/\.dll$/, ''))];
  const width = head.map(h => Math.max(h.length, 8));
  console.log(head.map((h, i) => h.padStart(width[i])).join(' '));
  let totalOps = 0, totalBlocks = 0;
  const sums = new Map();
  for (const r of rows) {
    totalOps += r.ops; totalBlocks += r.blockHits;
    const m = new Map(r.modules);
    for (const c of cols) {
      // Weight each window's share by the entries it carried, so a long phase
      // counts for more than a short one -- a plain mean over windows would
      // say a 30-second phase and a 20-minute phase matter equally.
      sums.set(c, (sums.get(c) || 0) + (m.get(c) || 0) * r.blockHits);
    }
    const cells = [`t+${r.elapsed}s`, r.opsPerBlock.toFixed(2), String(r.distinct),
      ...cols.map(c => (m.get(c) === undefined ? '-' : m.get(c).toFixed(1)))];
    console.log(cells.map((v, i) => String(v).padStart(width[i])).join(' '));
  }
  console.log('');
  console.log(`${rows.length} windows   ${(totalOps / 1e9).toFixed(1)}G ops   `
    + `${(totalBlocks / 1e6).toFixed(0)}M block entries   `
    + `${(totalOps / (totalBlocks || 1)).toFixed(2)} ops/block overall`);
  console.log('\nshare of ALL sampled block entries, weighted by window size:');
  for (const c of cols) {
    console.log(`  ${c.padEnd(16)} ${(sums.get(c) / (totalBlocks || 1)).toFixed(2)}%`);
  }
  console.log('\n(shares are of the probe\'s top-block list, so they do not sum to 100)');
}

async function main() {
  if (REPORT) { printReport(REPORT); return; }
  const mods = parseMods(LOG);
  if (!LOG) console.log('[warn] no --log=, so every block attributes to "exe"');
  else console.log(`modules: ${Object.keys(mods).join(', ')}`);
  const names = handlerNames();
  const probeCode = fs.readFileSync(PROBE, 'utf8');
  const arm = 'exports.reset_handler_hist(); exports.set_handler_hist_enabled(1); "armed"';
  const out = OUT ? fs.createWriteStream(OUT, { flags: 'a' }) : null;
  const t0 = Date.now();
  for (let i = 1; i <= COUNT; i++) {
    const armed = await post({ action: 'eval', code: arm });
    if (!armed || armed.ok === false) {
      console.log(`#${i} arm failed: ${armed && armed.error} -- stopping`);
      break;
    }
    await sleep(WINDOW);
    let hist;
    try { hist = await sample(probeCode); }
    catch (err) { console.log(`#${i} read failed: ${err.message} -- stopping`); break; }
    if (!hist) { console.log(`#${i} no histogram yet`); await sleep(GAP); continue; }
    const s = summarize(hist, mods, names);
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(reportLine(i, elapsed, s));
    if (out) out.write(JSON.stringify({ i, elapsed, label: LABEL, ...s }) + '\n');
    if (GAP > 0) await sleep(GAP);
  }
  if (out) out.end();
}

main().catch(err => { console.error(String(err.message || err)); process.exit(2); });
