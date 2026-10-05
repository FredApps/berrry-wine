#!/usr/bin/env node
'use strict';
// One WAV reference run inside one tree, with EXACTLY corpus-ab.js's `witness`
// recipe on the l1 arm (variant tailcall, cpu 386, autoKey, pitClock, soundPref
// sb, ULTRASND=220,1,1,11,7, audioRate 22050, budget 80M, irq schedule on), so
// its `wav` is computed the way P3's was: sha256 of audio.wavBytes(audioChunks,
// audioRate), first 16 hex. The run-dos CLI is deliberately not used: its
// defaults are not corpus-ab's, and a P3 mismatch from a different setup would
// say nothing about the patches.
//
// Adds, without changing the options above:
//   --trace-irq  -> traceIrq: one `irq` line per host-injected interrupt;
//   --trace-io=  -> traceIo: port lines for these hex ports (PIT 40,43).
// Both are read-only hooks; wav-run.js's P3 gate checks every guest field, so a
// trace that perturbed the run would show up there as VOID, not as a finding.
//
// The audio clock (tools/toyvm/audio.js Sound.advance): every slice adds
// dt * rate to outAcc and renders floor(outAcc) frames, carrying the
// fraction. So the frame count measures RENDERED GUEST TIME, which final
// dispatched alone does not fix. Reported: frames, audio.rendered, the outAcc
// residue, guestSeconds(dispatched), and frames/rate.
//
//   node wav-drive.js --tree=DIR --exe=PATH --wav=OUT.wav --row=OUT.json [--trace-irq] [--trace-io=40,43]
// Trace lines go to stdout; the parent redirects them into a size-capped log.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? undefined : h.slice(k.length + 3); };
const tree = arg('tree'), exe = arg('exe'), wavOut = arg('wav'), rowOut = arg('row');
if (!tree || !exe || !wavOut || !rowOut) {
  console.error('usage: node wav-drive.js --tree=DIR --exe=PATH --wav=OUT.wav --row=OUT.json [--trace-irq] [--trace-io=40,43]');
  process.exit(2);
}
const traceIo = arg('trace-io') === undefined ? null
  : arg('trace-io').split(',').filter(Boolean).map((x) => parseInt(x.replace(/^0x/i, ''), 16));
const RECIPE = { variant: 'tailcall', cpu: 386, autoKey: true, pitClock: true, soundPref: 'sb',
  env: ['ULTRASND=220,1,1,11,7'], audioRate: 22050 };
const BUDGET = 80e6;

(async () => {
  const T = (m) => require(path.join(path.resolve(tree), 'tools/toyvm', m));
  const { runDos } = T('run-dos');
  const { wavBytes } = T('audio');
  const out = (s) => process.stdout.write(s + '\n');
  const t0 = process.hrtime.bigint();
  const r = await runDos({ exe, budget: BUDGET, log: out, seconds: 0,
    traceIrq: argv.includes('--trace-irq'), traceIo, ...RECIPE });
  const bytes = r.audioChunks && r.audioChunks.length ? Buffer.from(wavBytes(r.audioChunks, r.audioRate)) : null;
  if (bytes) fs.writeFileSync(wavOut, bytes);
  const full = bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null;
  const a = r.machine && r.machine.audio;
  const frames = bytes ? (bytes.length - 44) / 4 : 0;
  const ek = r.exitKinds || {};
  const row = {
    exe, tree: path.resolve(tree), arm: 'l1', recipe: 'witness', budget: BUDGET, irqSchedule: true,
    ok: true, ranOutOfTime: !!r.ranOutOfTime, stuckAt: r.stuckAt || null,
    frame: r.frame, pixels: r.pixels, wav: full ? full.slice(0, 16) : 'none', wavSha256: full,
    irqs: r.irqs, ints: r.ints, dispatched: r.dispatched, handbacks: r.handbacks,
    kinds: { date: ek.date || 0, budget: ek.budget || 0, cut: ek.cut || 0,
      early: Object.entries(ek).filter(([k]) => k.startsWith('early')).reduce((n, [, v]) => n + v, 0) },
    clock: {
      audioRate: r.audioRate, frames, seconds: r.audioRate ? frames / r.audioRate : 0,
      rendered: a ? a.rendered : null, outAccResidue: a ? a.outAcc : null,
      guestSeconds: typeof r.guestSeconds === 'number' ? r.guestSeconds : null,
      chunks: r.audioChunks ? r.audioChunks.length : 0,
      dmaWrites: a && a.dma ? a.dma.writes : null, speakerWrites: a ? a.speakerWrites : null,
    },
    cpuSecs: r.cpuSecs, wallSecs: Number(process.hrtime.bigint() - t0) / 1e9,
  };
  fs.writeFileSync(rowOut, JSON.stringify(row) + '\n');
  exitAfterFlush(0);
})().catch((e) => { console.error(String(e && e.stack || e)); exitAfterFlush(1); });

// stdout to a pipe is ASYNCHRONOUS in Node: process.exit() right after a burst
// of writes drops whatever is still queued. The 2026-10-05 17:01Z run lost all
// but the first ~1300 irq lines of CAVEIRA and CYCLE this way (254,307 raised,
// 1,307 logged). A write's callback runs after every write queued before it.
function exitAfterFlush(code) {
  let left = 2;
  const done = () => { if (--left === 0) process.exit(code); };
  process.stdout.write('', done);
  process.stderr.write('', done);
}
