#!/usr/bin/env node
'use strict';
// Run from the baseline checkout. Pass candidate checkout paths positionally.
// Each arm starts a new process. Baseline repeats bracket candidate runs; all
// timing comparisons require identical frames, pixels, palette and API work.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.BENCH_OUT || 'build/diablo-gameplay-bench');
fs.mkdirSync(out, { recursive: true });
const walking = process.argv.includes('--walking');
const profiling = process.argv.includes('--profile');
const quietFast = process.argv.includes('--quiet-fast');
const referenceArg = process.argv.find(p => p.startsWith('--reference='));
const oracle = referenceArg ? JSON.parse(fs.readFileSync(referenceArg.slice('--reference='.length))) : null;
const referenceWork = Array.isArray(oracle) ? oracle[0] : oracle;
function sameWork(a, b) {
  return ['startHash', 'endHash', 'frameHash', 'frames', 'iterations', 'guestMs', 'apiCalls']
    .every(k => a[k] === b[k]) && JSON.stringify(a.positions) === JSON.stringify(b.positions);
}
const candidates = process.argv.slice(2).filter(p => !p.startsWith('--')).map(p => path.resolve(p));
const sequence = [root, ...candidates, ...candidates.slice().reverse(), root];
if (profiling) sequence.push(root);
const input = '1000:mousemove:320:213,1040:mousedown:320:213,1080:mouseup:320:213,1300:mousemove:420:298,1340:mousedown:420:298,1380:mouseup:420:298,1600:mousemove:348:446,1640:mousedown:348:446,1680:mouseup:348:446,1900:keydown:71,1910:keypress:103,1950:keydown:65,1960:keypress:97,2000:keydown:76,2010:keypress:108,2200:mousemove:348:446,2240:mousedown:348:446,2280:mouseup:348:446';
const results = [];
for (let i = 0; i < sequence.length; i++) {
  const cwd = sequence[i], label = `${i}-${path.basename(cwd)}`;
  if (os.loadavg()[0] > 2) throw new Error('remote host too busy: load ' + os.loadavg());
  const file = path.join(out, label + '.json');
  if (fs.existsSync(file)) throw new Error('result already exists; use a fresh BENCH_OUT: ' + file);
  const profile = profiling && i === sequence.length - 1;
  const fd = fs.openSync(path.join(out, label + '.log'), 'w');
  console.log(new Date().toISOString(), 'START', label, 'load', os.loadavg());
  const run = spawnSync(process.execPath, ['test/run.js', '--app=diablo_shareware',
    '--no-build', '--no-threads', '--batch-size=200000', '--tick-ms-per-batch=50',
    '--wall-clock-ms=1789000000000', '--max-batches=10000', '--max-seconds=900',
    '--repaint-every=200', '--quiet-api', '--no-close', '--gameplay-bench=' + file,
    ...(quietFast ? ['--quiet-api-fast'] : []),
    ...(walking ? ['--gameplay-walking'] : []),
    ...(profile ? ['--gameplay-profile=' + path.join(out, 'walking.cpuprofile')] : []),
    '--input=' + input], { cwd, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  if (run.status !== 0 || !fs.existsSync(file)) throw new Error(`run failed: ${label}; see log`);
  if (profile && walking) {
    const profileFile = path.join(out, 'walking.cpuprofile');
    if (!fs.existsSync(profileFile) || !fs.existsSync(profileFile + '.realtime.cpuprofile'))
      throw new Error('profile run incomplete');
    const live = JSON.parse(fs.readFileSync(profileFile + '.realtime.json'));
    if (live.breakpointEnabled || !live.presents || live.uniquePositions < 2)
      throw new Error('real-clock profile failed its movement/breakpoint check');
  }
  const r = { label, cwd, quietFast, node: process.version, cpuModel: os.cpus()[0].model,
    wasmSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(cwd, 'build/wine-assembly.wasm'))).digest('hex'),
    ...JSON.parse(fs.readFileSync(file)) };
  results.push(r);
  const reference = results[0];
  r.sameWork = sameWork(r, reference) && (!referenceWork || sameWork(r, referenceWork));
  console.log(new Date().toISOString(), 'DONE', label, 'sameWork', r.sameWork,
    'CPU ms', r.cpuMs, 'presents', r.frames);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  if (!r.sameWork) throw new Error('workload mismatch; refusing timing comparison');
}
console.log('PASS: every measured arm completed identical gameplay work');
