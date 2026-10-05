#!/usr/bin/env node
// Check the emulator's WAT video decoders against ffmpeg, frame for frame.
//
//   node tools/avi-player/verify.js <file.avi> [...] [--frames=N]
//
// Compiles src/09a7e-video-codecs.wat standalone (./codecs-wasm.js), decodes
// the first N video frames (default 60) with it and with
// `ffmpeg -f rawvideo -pix_fmt rgb24`, and prints per file the frames
// compared, how many are bit-exact, and the worst channel delta.
// Zero-length chunks (a "repeat the last frame" drop marker) are skipped on
// our side because ffmpeg emits nothing for them under passthrough timing.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const { parseAvi } = require('./avi-demux');
const { loadNode } = require('./codecs-wasm');

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const framesArg = args.find(a => a.startsWith('--frames='));
const maxFrames = framesArg ? Number(framesArg.split('=')[1]) : 60;
if (!files.length) {
  console.error('usage: node tools/avi-player/verify.js <file.avi> [...] [--frames=N]');
  process.exit(2);
}

(async () => {
  const codecs = await loadNode();
  let failed = 0;
  for (const file of files) {
    const avi = parseAvi(fs.readFileSync(file));
    const vs = avi.streams.find(s => s.header && s.header.type === 'vids');
    const { decoder, name, reason } = await codecs.createDecoder(vs.format);
    if (!decoder) { console.log(`SKIP  ${file}: ${name} (${reason})`); continue; }
    const { width: w, height: h } = decoder, frameBytes = w * h * 3;
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0',
      '-fps_mode', 'passthrough', '-frames:v', String(maxFrames),
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
    const refCount = Math.floor(raw.length / frameBytes);
    let n = 0, exact = 0, worst = 0, worstFrame = -1;
    for (const c of vs.chunks) {
      if (n >= refCount) break;
      const data = avi.bytes.subarray(c.off, c.off + c.size);
      if (c.kind === 'pc') { decoder.paletteChange(data); continue; }
      if (!c.size) continue;
      decoder.decode(data);
      const ref = raw.subarray(n * frameBytes, (n + 1) * frameBytes), f = decoder.frame;
      let d = 0;
      for (let i = 0, o = 0; i < w * h; i++, o += 4) {
        d = Math.max(d, Math.abs(f[o + 2] - ref[i * 3]), Math.abs(f[o + 1] - ref[i * 3 + 1]),
          Math.abs(f[o] - ref[i * 3 + 2]));
      }
      if (d === 0) exact++;
      if (d > worst) { worst = d; worstFrame = n; }
      n++;
    }
    const ok = n > 0 && exact === n;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}: ${name} ${w}x${h}, ${n} frames, ` +
      `${exact} bit-exact, worst delta ${worst}${worstFrame >= 0 ? ` at frame ${worstFrame}` : ''}`);
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.stack || e); process.exit(2); });
