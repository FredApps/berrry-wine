#!/usr/bin/env node
'use strict';

// The micro-op engines against L1 on more than one wasm engine.
//
//   node tools/toyvm/uop-shell-bench.js --progs=EXE@KEY:IP[,EXE@KEY:IP...]
//        [--arms=node,v8,sm] [--engines=l1,e1,straight] [--configs=all]
//        [--steps=2m] [--reps=5] [--budget=20m] [--out=DIR] [--timeout=600]
//
// Name a config twice (--configs=all,all,baseline) to time a second copy of
// it, reported as `e1/all#2`: that pair's spread is this run's null band, on
// this box at this load, which is what any other arm's difference has to beat.
// A row that bailed lists its top bail blocks and why each has no native form.
//
// Same method as uop-speed.js (which is what runs): snapshot the program at
// the loop head, time L1 in the loop's steady state and each µop program from
// the head, best of --reps. The shells run a PRIVATE bundle of uop-speed.js
// and everything it requires (bundle-browser.js's builder, other roots), so
// node, d8 and SpiderMonkey all run the same sources and differ only in the
// engine. One process per (program, shell); shells rotate per program.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildBundle } = require('./bundle-browser');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};
const count = (s) => {
  const m = /^(\d+(?:\.\d+)?)([kmb]?)$/i.exec(String(s).trim());
  if (!m) throw new Error(`not a count: ${s}`);
  return Math.round(Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()]);
};

const JSVU = path.join(os.homedir(), '.jsvu', 'bin');
const SHELLS = {
  node: [process.execPath],
  v8: [path.join(JSVU, 'v8')],
  sm: [path.join(JSVU, 'sm'), path.join(JSVU, 'spidermonkey')],
};
const binOf = (id) => (SHELLS[id] || []).find((b) => b === process.execPath || fs.existsSync(b)) || null;

function runnerSource(bundle, exe, o) {
  const dir = path.dirname(exe);
  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  return `'use strict';
globalThis.self = globalThis;
var nodeFs = (typeof require === 'function') ? require('fs') : null;
function readBin(p) {
  if (typeof readbuffer === 'function') return new Uint8Array(readbuffer(p));
  if (typeof os !== 'undefined' && os.file && os.file.readFile) return os.file.readFile(p, 'binary');
  return new Uint8Array(nodeFs.readFileSync(p));
}
var say = (typeof print === 'function') ? print : function (s) { console.log(s); };
if (typeof atob === 'undefined') {
  globalThis.atob = function (s) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = '', b = 0, n = 0;
    for (var i = 0; i < s.length; i++) {
      var v = A.indexOf(s[i]); if (v < 0) continue;
      b = ((b << 6) | v) & 0xFFFFFF; n += 6;
      if (n >= 8) { n -= 8; o += String.fromCharCode((b >> n) & 255); }
    }
    return o;
  };
}
if (typeof load === 'function') load(${JSON.stringify(bundle)});
else require('vm').runInThisContext(nodeFs.readFileSync(${JSON.stringify(bundle)}, 'utf8'), { filename: 'uop-bundle.js' });
var DIR = ${JSON.stringify(dir)}, FILES = ${JSON.stringify(files)};
for (var i = 0; i < FILES.length; i++) ToyVM.mount(FILES[i], readBin(DIR + '/' + FILES[i]));
ToyVM.require('tools/toyvm/uop-speed.js').bench(${JSON.stringify({ ...o, exe: path.basename(exe) })}).then(function (r) {
  say('SHELLUOP ' + JSON.stringify(r));
}, function (e) { say('SHELLUOP-ERR ' + String(e && e.stack || e).split('\\n').slice(0, 5).join(' | ')); });
`;
}

function runShell(id, script, timeoutS) {
  return new Promise((resolve) => {
    // Its own process group, and the timeout kills the group: a jsvu engine is
    // a wrapper script around the real binary, and killing only the wrapper
    // orphaned the engine, which kept the pipes open so 'close' never came and
    // the whole bench hung behind one program.
    const p = spawn(binOf(id), [script], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { p.kill('SIGKILL'); }
    }, timeoutS * 1000);
    p.on('close', (code, sig) => {
      clearTimeout(kill);
      const m = /^SHELLUOP (.*)$/m.exec(out);
      if (m) return resolve({ ok: true, ...JSON.parse(m[1]) });
      const e = /^SHELLUOP-ERR (.*)$/m.exec(out);
      resolve({ ok: false, reason: sig === 'SIGKILL' ? 'timeout'
        : e ? e[1] : `exit ${code}: ${(err || out).trim().split('\n').slice(-3).join(' | ')}` });
    });
  });
}

async function main() {
  const progs = String(arg('progs', '')).split(',').filter(Boolean).map((s) => {
    const [exe, head] = s.split('@');
    return { exe: path.resolve(exe), head: head || null };
  });
  if (!progs.length) throw new Error('--progs=EXE@KEY:IP,... is required');
  const shells = String(arg('arms', 'node,v8,sm')).split(',');
  for (const s of shells) if (!binOf(s)) throw new Error(`no binary for ${s}`);
  const out = path.resolve(arg('out', fs.mkdtempSync(path.join(os.tmpdir(), 'uop-shell-'))));
  fs.mkdirSync(out, { recursive: true });
  const built = buildBundle(['tools/toyvm/uop-speed.js', 'lib/compile-wat.js']);
  const bundle = path.join(out, 'uop-bundle.js');
  fs.writeFileSync(bundle, built.js);
  const o = {
    engines: String(arg('engines', 'l1,e1,straight')).split(','),
    configs: String(arg('configs', 'all')).split(','),
    steps: count(arg('steps', '2m')), reps: Number(arg('reps', '5')), warm: count(arg('warm', '50000')),
    budget: count(arg('budget', '20m')),
  };
  const timeoutS = Number(arg('timeout', '600'));
  console.log(`uop-shell-bench: ${progs.length} program(s) x ${shells.join(',')}  loadavg ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  const results = [];
  for (let pi = 0; pi < progs.length; pi++) {
    const p = progs[pi];
    const order = shells.map((_, i) => shells[(i + pi) % shells.length]);
    for (const sh of order) {
      const script = path.join(out, `run-${pi}-${sh}.js`);
      fs.writeFileSync(script, runnerSource(bundle, p.exe, { ...o, head: p.head }));
      const r = await runShell(sh, script, timeoutS);
      results.push({ prog: path.basename(p.exe), head: p.head, shell: sh, ...r });
      if (!r.ok) { console.log(`  ${path.basename(p.exe)} ${sh}: FAILED ${r.reason}`); continue; }
      for (const row of r.rows) {
        console.log(`  ${path.basename(p.exe).padEnd(13)} ${r.head.padEnd(11)} ${sh.padEnd(5)} ${row.name.padEnd(18)}`
          + ` ${row.ns.toFixed(2).padStart(7)} ns/insn  x${row.x.toFixed(2)}  steps=${row.steps} ${row.why} bails=${row.bails}`);
        for (const b of row.bailAt || []) console.log(`      bail ${b}`);
      }
    }
  }
  const json = arg('json', null);
  if (json) fs.writeFileSync(json, JSON.stringify(results, null, 1));
  console.log(`loadavg after ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
}

main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
