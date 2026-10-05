#!/usr/bin/env node
'use strict';
// Build a toyvm tree from base 2683a6e3 with hash-pinned patches applied, for
// test-toyvm-irq-if-enable.js (TOYVM_TREE=<out>). Same closure and patch
// procedure as wav-validate/slice-diag.js. No emulator.
//
//   node build-tree.js --out=<new dir> --tree=head|stack
//   node build-tree.js --out=<new dir> --tree=cand --candidate=<diff> --candidate-sha=<64 hex>
// head  = 2683a6e3 as committed; stack = + v2v3j (54de1b13) + v4 (4b00d26d) + smc (b3371e21);
// cand  = stack + the candidate diff, refused unless its full sha256 equals --candidate-sha.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? undefined : h.slice(k.length + 3); };
const R = '/home/user/wine-assembly';
const BASE = '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const J = path.join(R, 'scratch/claude-toyvm-jmpsyn-j-20261005');
const CLOSURE = ['tools/toyvm', 'tools/fnt-read.js', 'tools/ne-dump.js', 'tools/disasm.js',
  'tools/simd-ops.js', 'lib/compile-wat.js', 'lib/wat-manifest.js', 'fonts/Terminal.fon'];
const P = {
  v2v3j: [path.join(J, 'v2-v3-j-combined.patch'), '54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82'],
  v4: [path.join(J, 'v4-delta-on-combined.patch'), '4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b'],
  smc: [path.join(J, 'smc-pure-forward-fix.patch'), 'b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612'],
};
const TREES = { head: [], stack: ['v2v3j', 'v4', 'smc'], cand: ['v2v3j', 'v4', 'smc', 'candidate'] };
const out = arg('out'), which = arg('tree');
if (!out || !TREES[which]) { console.error('usage: node build-tree.js --out=<new dir> --tree=head|stack|cand [--candidate=<diff> --candidate-sha=<hex>]'); process.exit(2); }
if (which === 'cand') {
  if (!arg('candidate') || !/^[0-9a-f]{64}$/.test(arg('candidate-sha') || '')) { console.error('cand needs --candidate=<diff> and --candidate-sha=<64 hex>'); process.exit(2); }
  P.candidate = [path.resolve(arg('candidate')), arg('candidate-sha')];
}
if (fs.existsSync(out) && fs.readdirSync(out).length) { console.error(`refusing: ${out} is not empty`); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tarball = execFileSync('git', ['-C', R, 'archive', BASE, ...CLOSURE], { maxBuffer: 1 << 30 });
if (spawnSync('tar', ['-x', '-C', out], { input: tarball }).status !== 0) { console.error('tar failed'); process.exit(2); }
fs.symlinkSync(path.join(R, 'node_modules'), path.join(out, 'node_modules'));
for (const k of TREES[which]) {
  const [file, want] = P[k];
  if (!fs.existsSync(file) || sha(file) !== want) { console.error(`${k}: patch missing or hash mismatch`); process.exit(2); }
  const r = spawnSync('patch', ['-p1', '-s', '--no-backup-if-mismatch', '-d', out], { input: fs.readFileSync(file) });
  if (r.status !== 0) { console.error(`patch ${k} failed`); process.exit(2); }
}
const f = (n) => sha(path.join(out, 'tools/toyvm', n)).slice(0, 16);
console.log(JSON.stringify({ tree: which, base: BASE, patches: TREES[which], ...(P.candidate ? { candidateSha: P.candidate[1].slice(0, 16) } : {}),
  'dos-loop': f('dos-loop.js'), emit: f('emit.js'), decode: f('decode.js'), compile: f('compile.js'), 'region-jit': f('region-jit.js') }));
