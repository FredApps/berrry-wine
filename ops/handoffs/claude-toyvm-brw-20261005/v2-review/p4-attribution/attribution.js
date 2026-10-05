#!/usr/bin/env node
'use strict';
// Attribute stage 2's P4 control-gate failure (2026-10-05 16:05Z, runner
// c89f3d03): 4 of 199 l1 rows moved under --no-irq-schedule, all in the final
// dispatched count only. Which patch of the stack moves them, and do they move
// anything the guest can see?
//
// Six trees from base 2683a6e3, each with a hash-pinned patch subset, and the
// EXACT P4 invocation on each: corpus-ab --arms=l1 --recipe=sweep --budgets=8m
// --no-irq-schedule over the four programs. "Exact stop-budget semantics" means
// the same corpus-ab arm and recipe, so a row's dispatched count is the same
// "first handback past 8,000,000" that P4 compared.
//
//   node attribution.js --w=<stage-1 work dir with demos/> --out=<dir> --dry-run
//       builds and verifies the six trees, prints hashes and the commands; no emulator
//   node attribution.js --w=... --out=... --run
//       runs the six corpus-ab invocations one after another (needs a granted
//       slot), then writes table.md / result.json. The head and stack rows must
//       equal P4's own base / cand rows, or the attribution is void.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const flag = (k) => argv.includes(`--${k}`);
const R = '/home/user/wine-assembly';
const BASE = '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const REV = path.join(R, 'scratch/claude-toyvm-brw-v2-review-20261005');
const J = path.join(R, 'scratch/claude-toyvm-jmpsyn-j-20261005');
const AB = path.join(REV, 'corpus-ab.js');
const CLOSURE = ['tools/toyvm', 'tools/fnt-read.js', 'tools/ne-dump.js', 'tools/disasm.js',
  'tools/simd-ops.js', 'lib/compile-wat.js', 'lib/wat-manifest.js', 'fonts/Terminal.fon'];
const P = {
  j: [path.join(J, 'jmp-syn-j.patch'), '7f8a7275d3b8a234e2fc8f1f23930e74426cddc30316fbfaecbb11ab65412239'],
  smc: [path.join(J, 'smc-pure-forward-fix.patch'), 'b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612'],
  v2v3j: [path.join(J, 'v2-v3-j-combined.patch'), '54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82'],
  v4: [path.join(J, 'v4-delta-on-combined.patch'), '4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b'],
};
const TREES = {
  head: [],
  j: ['j'],              // fix J alone (cut against HEAD)
  smc: ['smc'],          // forward-SMC fix alone (cut against HEAD)
  v2v3j: ['v2v3j'],      // v2 + v3 delta + J
  v2v3j_v4: ['v2v3j', 'v4'],
  stack: ['v2v3j', 'v4', 'smc'],   // the P4 candidate
};
const PROGRAMS = ['1995-a-acidrain/ACIDRAIN.EXE', '1995-a-acolors/COLORS.EXE',
  '1995-b-boxtro/NEWSBOX3.EXE', '1995-b-brian/BRIAN.EXE'];
// P4's own rows (full-stage2-attempt2-20261005 nosched-{base,cand}.ndjson).
const P4 = {
  'ACIDRAIN.EXE': [8024330, 8024454], 'COLORS.EXE': [8001200, 8001270],
  'NEWSBOX3.EXE': [8009352, 8009532], 'BRIAN.EXE': [8001195, 8001780],
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const W = arg('w'), OUT = arg('out');
if (!W || !OUT || (!flag('dry-run') && !flag('run'))) {
  console.error('usage: node attribution.js --w=<work dir with demos/> --out=<dir> --dry-run|--run');
  process.exit(2);
}
fs.mkdirSync(path.join(OUT, 'trees'), { recursive: true });

// Build and verify every tree (tar + patch only; no emulator).
const tests = execFileSync('git', ['-C', R, 'ls-tree', '--name-only', BASE, 'test/'], { encoding: 'utf8' })
  .split('\n').filter((l) => l.startsWith('test/test-toyvm-'));
const tarball = execFileSync('git', ['-C', R, 'archive', BASE, ...CLOSURE, ...tests], { maxBuffer: 1 << 30 });
const summary = {};
for (const [name, patches] of Object.entries(TREES)) {
  const t = path.join(OUT, 'trees', name);
  fs.rmSync(t, { recursive: true, force: true });
  fs.mkdirSync(t, { recursive: true });
  if (spawnSync('tar', ['-x', '-C', t], { input: tarball }).status !== 0) throw new Error(`${name}: tar`);
  fs.symlinkSync(path.join(R, 'node_modules'), path.join(t, 'node_modules'));
  for (const k of patches) {
    const [file, want] = P[k];
    if (sha(file) !== want) throw new Error(`${name}: ${k} patch hash`);
    const r = spawnSync('patch', ['-p1', '-s', '--no-backup-if-mismatch', '-d', t], { input: fs.readFileSync(file) });
    if (r.status !== 0) throw new Error(`${name}: patch ${k} failed: ${r.stdout}${r.stderr}`);
  }
  summary[name] = { patches, files: {} };
  for (const f of ['dos-loop', 'run-dos', 'emit', 'compile']) summary[name].files[f] = sha(path.join(t, 'tools/toyvm', f + '.js')).slice(0, 16);
}
const list = path.join(OUT, 'programs4.txt');
const progs = PROGRAMS.map((p) => path.join(W, 'demos', p));
for (const p of progs) if (!fs.existsSync(p)) throw new Error(`missing program ${p}`);
fs.writeFileSync(list, progs.join('\n') + '\n');
const cmd = (name) => [process.execPath, AB, `--tree=${path.join(OUT, 'trees', name)}`, `--list=${list}`, '--arms=l1',
  '--recipe=sweep', '--budgets=8m', '--no-irq-schedule', '--jobs=1', '--timeout=180',
  `--out=${path.join(OUT, `${name}.ndjson`)}`];
fs.writeFileSync(path.join(OUT, 'trees.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
for (const name of Object.keys(TREES)) console.log(`$ ${cmd(name).join(' ')}`);
if (flag('dry-run')) { console.log('dry run: trees built and verified, nothing executed'); process.exit(0); }

// --run: the six corpus-ab invocations, one at a time.
for (const name of Object.keys(TREES)) {
  fs.rmSync(path.join(OUT, `${name}.ndjson`), { force: true });
  const r = spawnSync(cmd(name)[0], cmd(name).slice(1), { stdio: 'inherit', timeout: 900 * 1000 });
  if (r.status !== 0) { console.error(`${name}: corpus-ab exit ${r.status}`); process.exit(2); }
}
const rows = {};
for (const name of Object.keys(TREES)) {
  for (const l of fs.readFileSync(path.join(OUT, `${name}.ndjson`), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    (rows[path.basename(r.exe)] ||= {})[name] = { d: r.dispatched, frame: r.frame, wav: r.wav, irqs: r.irqs, ints: r.ints };
  }
}
const out = ['| program | tree | dispatched | vs head | frame | wav | irqs | ints |', '|---|---|---|---|---|---|---|---|'];
let reproduced = true;
for (const [prog, byTree] of Object.entries(rows)) {
  const h = byTree.head;
  for (const [name, v] of Object.entries(byTree)) {
    const same = (k) => (v[k] === h[k] ? '=' : 'DIFF');
    out.push(`| ${prog} | ${name} | ${v.d} | ${v.d - h.d >= 0 ? '+' : ''}${v.d - h.d} | ${same('frame')} | ${same('wav')} | ${same('irqs')} | ${same('ints')} |`);
  }
  const [pb, pc] = P4[prog] || [];
  if (h.d !== pb || byTree.stack.d !== pc) reproduced = false;
}
out.push('', reproduced ? 'P4 reproduced: head and stack rows equal P4 base/cand.' : 'P4 NOT reproduced: attribution void.');
fs.writeFileSync(path.join(OUT, 'table.md'), out.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ reproduced, rows }, null, 1) + '\n');
console.log(out.join('\n'));
process.exit(reproduced ? 0 : 3);
