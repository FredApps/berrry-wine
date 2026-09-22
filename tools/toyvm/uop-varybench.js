#!/usr/bin/env node
'use strict';

// A VARIED-WORKING-SET benchmark for the micro-op tier -- the blk_mix512
// lesson (tools/bench-loops.js) applied to tools/toyvm/uop-*.js.
//
// WHY. Every number in c29f8d2a comes from ONE periodic loop (ANARCHY's head,
// ~30 micro-ops repeating in the same order forever). A modern indirect branch
// predictor with long path history learns that stream from a single site, so a
// one-site engine (E1/E2: one br_table) is flattered against a many-site one
// (E3: 520 return_call_indirect) by construction. The main emulator already
// has the shape that does not flatter it -- blk_mix512 cycles 512 distinct
// blocks so no indirect site sees a learnable target sequence -- and the
// micro-op tier had no equivalent.
//
// WHAT THIS RUNS. A synthetic .COM whose hot loop is a cycle of W distinct
// basic blocks, each holding a DIFFERENT random mix of x86 instructions, wired
// in a random permutation. What matters is the mix, not the block count: the
// loop engine's br_table target is the OP ID at $pc, so W blocks that all held
// the same instructions would still give a period-B target stream and measure
// nothing. With a fresh random mix per block the stream's period is the whole
// cycle -- W * B ops -- and W is the knob that sweeps it from "learnable" to
// "not". W = 1 reproduces the periodic-loop shape the old numbers came from.
//
// The discipline is bench-loops.js's, which is what makes its +-1% trustworthy
// and a whole-app A/B on a loaded box useless: both arms run IN ONE PROCESS,
// every rep re-seeds from one snapshot, the arm order alternates per rep, and
// the reported time is the best of N. A second, identical E1 arm ('e1b') rides
// along at every width purely as a NULL BAND: it differs from 'e1' only by
// being a different object, so whatever spread it shows is the floor under
// which no other difference here means anything.
//
// WHAT IT MEASURED (quiet box, 2026-09-22, V8 and SpiderMonkey shells, best of
// 5 reps, median of 3 seeds per width, null band 0.5-1.1% mean / 2.8% worst).
// The hypothesis was that the loop engine's one indirect site is what the
// periodic loop flatters, so its lead should SHRINK with the working set and
// could invert. It does not shrink. It GROWS, on both shells, monotonically:
//
//   body 4, width 8 -> 56 (40 -> 280 x86 insns in the cycle)
//     e1  ns/insn   V8 0.63 -> 0.67    SM 0.79 -> 0.72      flat
//     e3  ns/insn   V8 2.20 -> 3.21    SM 1.98 -> 2.86      +46% / +44%
//     e3/e1         V8 3.46 -> 4.79    SM 2.50 -> 4.00
//   body 12, width 1 -> 16 (13 -> 208 x86 insns), the same shape with long
//   blocks: e1 flat, e3 doubles, e3/e1 V8 3.51 -> 5.50, SM 2.19 -> 4.12.
//
// So the ~3x from ANARCHY is not an artifact of one learnable stream; it is
// the floor, and the threaded engine's cost is what the working set moves.
// That is the same answer dispatch replication gave the main emulator (1 site
// -> 419 and the branch-miss rate did not move) and what the 30:11 arm64
// instruction ratio in c29f8d2a predicted: the threaded engine loses on
// entry/exit bookkeeping per micro-op, and more distinct micro-ops means more
// of it, not more mispredictions.
//
// CEILING, and it is the honest limit of this benchmark: the engine's code
// page and its 2048-entry vreg file cap a program at roughly 280 x86
// instructions (width 56 at body 4, width 16 at body 12); past that the
// lowering refuses with `code N bytes does not fit` or `N vregs > 2047`. That
// is a 56x widening of the op stream, not blk_mix512's 512 blocks. The control
// that says the widening is nonetheless real: L1, on the same programs, is
// measurably slower per instruction as it widens (3.3 -> 6.4 ns on V8 over
// width 1 -> 40 at body 4) while E1 does not move at all.
//
//   node tools/toyvm/uop-varybench.js [--widths=1,2,4,...] [--body=6]
//        [--engines=e1,e1b,e2k4,e3k4] [--steps=2m] [--reps=5] [--seeds=3]
//        [--seed=N] [--straight] [--verify] [--json=FILE]
//   node tools/toyvm/uop-varybench.js --arms=node,v8,sm [...]   # same, per shell
//
// `sweep()` is importable and holds nothing Node-only, so the shell driver can
// run it from a bundle inside d8 / SpiderMonkey exactly as uop-shell-bench.js
// runs uop-speed.js. Nothing here is on any shipped path: the file is not in
// bundle-browser.js's ROOTS and the browser bundles do not change.

const H = require('./uop-harness');
const IR = require('./uop-ir');
const OPT = require('./uop-opt');
const { runDos } = require('./run-dos');
const { speed } = require('./uop-speed');

// ---------------------------------------------------------------------------
// The guest program.
// ---------------------------------------------------------------------------

const ORG = 0x100;          // .COM load offset
const BLOCK_BASE = 0x400;   // first block
const DATA = 0xC000;        // scratch the blocks load and store through BX
const DATA_LEN = 128;       // disp8 off BX reaches 0..127

// Destinations: everything but BX (the memory base, held constant) and SP.
const DST = [0, 1, 2, 5, 6, 7];          // ax cx dx bp si di
const SRC = [0, 1, 2, 3, 5, 6, 7];       // ...BX may be read

function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

// One instruction, chosen at random. Every form here is 16-bit, register or
// [BX+disp8], and none of them can leave the data window or write code -- so a
// block is safe to run in any order after any other block.
function randInsn(r) {
  const d = DST[r() % DST.length], s = SRC[r() % SRC.length];
  const i16 = () => { const v = r() & 0xFFFF; return [v & 0xFF, v >> 8]; };
  const d8 = () => r() % DATA_LEN;
  switch (r() % 18) {
    case 0: return [0x01, 0xC0 | (s << 3) | d];               // add d,s
    case 1: return [0x29, 0xC0 | (s << 3) | d];               // sub d,s
    case 2: return [0x31, 0xC0 | (s << 3) | d];               // xor d,s
    case 3: return [0x21, 0xC0 | (s << 3) | d];               // and d,s
    case 4: return [0x09, 0xC0 | (s << 3) | d];               // or  d,s
    case 5: return [0x89, 0xC0 | (s << 3) | d];               // mov d,s
    case 6: return [0x11, 0xC0 | (s << 3) | d];               // adc d,s
    case 7: return [0x19, 0xC0 | (s << 3) | d];               // sbb d,s
    case 8: return [0x81, 0xC0 | d, ...i16()];                // add d,imm16
    case 9: return [0x81, 0xE0 | d, ...i16()];                // and d,imm16
    case 10: return [0x81, 0xF0 | d, ...i16()];               // xor d,imm16
    case 11: return [0xB8 + d, ...i16()];                     // mov d,imm16
    case 12: return [0xD1, 0xE0 | d];                         // shl d,1
    case 13: return [0xD1, 0xE8 | d];                         // shr d,1
    case 14: return [0x40 + d];                               // inc d
    case 15: return [0x48 + d];                               // dec d
    case 16: return [0x8B, 0x47 | (d << 3), d8()];            // mov d,[bx+disp8]
    default: return [0x89, 0x47 | (s << 3), d8()];            // mov [bx+disp8],s
  }
}

// W blocks of `body` random instructions each, ending in `jmp near` to the
// next block of a random single cycle. `stride` keeps every block at a fixed
// address so the permutation can be wired without a second pass.
function genCom({ width, body = 4, seed = 1, stride = 0 }) {
  const r = rng(seed);
  const maxBody = body * 4 + 3;
  const st = stride || ((maxBody + 15) & ~15);
  const end = BLOCK_BASE + width * st;
  if (end > 0xB000) throw new Error(`uop-varybench: image ${end} bytes collides with the data window`);
  const img = Buffer.alloc(end - ORG, 0x90);
  const put = (off, bytes) => { for (let k = 0; k < bytes.length; k++) img[off - ORG + k] = bytes[k] & 0xFF; };

  // Prologue: fill the data window with varied bytes, set BX, seed the other
  // registers with values that are neither zero nor equal, jump into the cycle.
  let p = ORG;
  const emit = (...b) => { put(p, b); p += b.length; };
  emit(0xBF, DATA & 0xFF, DATA >> 8);            // mov di,DATA
  emit(0xB9, DATA_LEN, 0x00);                    // mov cx,DATA_LEN
  emit(0xB0, 0x35);                              // mov al,0x35
  const fill = p;
  emit(0x88, 0x05);                              // mov [di],al
  emit(0x04, 0x1D);                              // add al,0x1d
  emit(0x47);                                    // inc di
  emit(0xE2, (fill - (p + 2)) & 0xFF);           // loop fill
  emit(0xBB, DATA & 0xFF, DATA >> 8);            // mov bx,DATA
  emit(0xB8, 0x34, 0x12);                        // mov ax,0x1234
  emit(0xB9, 0x07, 0x00);                        // mov cx,7
  emit(0xBA, 0x5A, 0xA5);                        // mov dx,0xa55a
  emit(0xBE, 0x11, 0x00);                        // mov si,0x11
  emit(0xBF, 0x33, 0x22);                        // mov di,0x2233
  emit(0xBD, 0x55, 0x04);                        // mov bp,0x455
  if (p > BLOCK_BASE) throw new Error('uop-varybench: prologue overran the block area');

  // A random single cycle: order[j] -> order[j+1], order[W-1] -> order[0].
  const order = Array.from({ length: width }, (_, i) => i);
  for (let i = width - 1; i > 0; i--) { const j = r() % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const addrOf = (i) => BLOCK_BASE + i * st;

  let insns = 0;
  for (let j = 0; j < width; j++) {
    const me = order[j], next = order[(j + 1) % width];
    let at = addrOf(me);
    for (let k = 0; k < body; k++) { const b = randInsn(r); put(at, b); at += b.length; insns++; }
    const target = addrOf(next);
    put(at, [0xE9, (target - (at + 3)) & 0xFF, ((target - (at + 3)) >> 8) & 0xFF]);
    insns++;
    if (at + 3 > addrOf(me) + st) throw new Error('uop-varybench: block overran its stride');
  }
  // The head is wherever the cycle starts; every block is in the cycle, so any
  // one of them discovers the whole loop.
  const jmp0 = addrOf(order[0]);
  put(p, [0xE9, (jmp0 - (p + 3)) & 0xFF, ((jmp0 - (p + 3)) >> 8) & 0xFF]);
  return { com: img, head: jmp0, insns, blocks: width, bytes: img.length };
}

// ---------------------------------------------------------------------------
// Capture. Portable: a bundle has no writable disk, so the image is mounted;
// under Node it is written to a temp file, which is what runDos wants.
// ---------------------------------------------------------------------------

function placeCom(name, bytes) {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (g && g.ToyVM && typeof g.ToyVM.mount === 'function') { g.ToyVM.mount(name, bytes); return name; }
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uop-vary-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

async function captureCom(com, o = {}) {
  const exe = placeCom('VARY.COM', com.com);
  const r = await runDos({ exe, budget: o.budget || 200000, slice: o.slice || 5000,
    autoKey: true, log: () => {} });
  const env = H.envOf(r.vm);
  if (!H.stepTo(r.vm, {}, env.codeBase, com.head, 2e6, r.machine)) {
    throw new Error(`uop-varybench: never reached the loop head 0x${com.head.toString(16)}`);
  }
  return { vm: r.vm, snap: H.snapshot(r.vm), env: H.envOf(r.vm) };
}

function buildProgram(c, com) {
  const reg = IR.discover((lin) => c.vm.mem[lin], c.env, com.head, { maxNodes: com.insns + 256 });
  const passes = OPT.ablationConfigs().find(([n]) => n === 'all')[1];
  const prog = OPT.build(reg, { passes, env: c.env, vm: c.vm });
  const unsup = [...reg.nodes.values()].filter((n) => n.unsupported).length;
  // A block the lowering refuses runs in the JS reference interpreter instead,
  // which would silently put a different engine under the measurement. The
  // instruction pool is chosen so this stays empty; say so when it does not.
  const low = require('./uop-wasm').lowerProgram(prog);
  const notNative = [...low.blocks.values()].filter((b) => !b.native).length;
  return { reg, prog, body: reg.body.size, unsup, cyclic: reg.cyclic,
    notNative, why: [...low.why].map(([k, n]) => `${k} x${n}`), nvTotal: low.nvTotal };
}

// ---------------------------------------------------------------------------
// One width.
// ---------------------------------------------------------------------------

async function oneWidth(width, o) {
  const com = genCom({ width, body: o.body, seed: o.seed + width });
  const c = await captureCom(com, o);
  const built = buildProgram(c, com);
  const arms = [{ name: 'l1', engine: 'l1' }];
  for (const e of o.engines) {
    // 'e1b' is the null-band twin: a second, separately built E1 arm.
    arms.push({ name: e, engine: e === 'e1b' ? 'e1' : e, prog: built.prog });
  }
  if (o.straight) arms.push({ name: 'straight', engine: 'straight', prog: built.prog });
  const loopSteps = com.insns;
  const best = await speed(c.vm, c.snap, arms, {
    budget: o.steps,
    warm: Math.max(o.warm, 30 * loopSteps),
    reps: o.reps,
  });
  const base = best.get('l1');
  const rows = [...best].map(([name, b]) => ({ name, ns: b.ns, steps: b.steps, why: b.why,
    entries: b.entries, bails: b.bails, x: base ? base.ns / b.ns : null }));
  return { width, insns: com.insns, bytes: com.bytes, body: built.body, unsup: built.unsup,
    cyclic: built.cyclic, nv: built.prog.nv, nvTotal: built.nvTotal,
    notNative: built.notNative, why: built.why, rows };
}

// A width's arms must agree with L1 or its times mean nothing.
async function verifyWidth(width, o) {
  const com = genCom({ width, body: o.body, seed: o.seed + width });
  const c = await captureCom(com, o);
  const { prog } = buildProgram(c, com);
  const { makeEnter } = require('./uop-wasm');
  const out = [];
  for (const engine of o.engines.filter((e) => e !== 'e1b')) {
    const st = {};
    const enter = await makeEnter(c.vm, prog, engine, st);
    for (const budget of [37, 1000, 250000]) {
      let cache = H.seed(c.vm, c.snap);
      const a = H.guestState(c.vm, H.runArm(c.vm, cache, budget));
      cache = H.seed(c.vm, c.snap);
      if (st.install) st.install();
      const b = H.guestState(c.vm, H.runArm(c.vm, cache, budget,
        { head: { codeBase: c.snap.env.codeBase, ip: prog.headIp }, enter }));
      const diff = H.diffStates(a, b);
      out.push({ engine, budget, ok: diff.length === 0, diff: diff.slice(0, 4) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The sweep. Returns plain rows; no printing, so a shell can hand it back as
// one JSON line.
// ---------------------------------------------------------------------------

async function sweep(opts = {}) {
  const o = {
    widths: opts.widths || [1, 2, 4, 8, 16, 24, 32, 40, 48, 56],
    body: opts.body || 4,
    engines: opts.engines || ['e1', 'e1b', 'e2k4', 'e3k4'],
    steps: opts.steps || 2e6,
    warm: opts.warm || 50000,
    reps: opts.reps || 5,
    seed: opts.seed || 1,
    seeds: opts.seeds || 1,
    straight: !!opts.straight,
    verify: !!opts.verify,
    budget: opts.budget || 200000,
  };
  const out = { widths: [], failed: [], verify: null };
  if (o.verify) out.verify = await verifyWidth(o.widths[o.widths.length - 1], o);
  for (const w of o.widths) {
    // Each width is a DIFFERENT random program, so one program per width mixes
    // "the working set widened" with "this program's instruction mix". Several
    // seeds per width and the median over them separate the two; the spread is
    // reported so a trend smaller than it is not read as a trend.
    const got = [];
    for (let s = 0; s < o.seeds; s++) {
      try {
        got.push(await oneWidth(w, { ...o, seed: o.seed + 1000 * s }));
      } catch (e) {
        out.failed.push({ width: w, seed: s, why: String((e && e.message) || e) });
      }
    }
    if (got.length) out.widths.push(mergeSeeds(got));
  }
  return out;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function mergeSeeds(got) {
  const first = got[0];
  const names = [...new Set(got.flatMap((g) => g.rows.map((r) => r.name)))];
  const rows = names.map((name) => {
    const hit = got.map((g) => g.rows.find((r) => r.name === name)).filter(Boolean);
    const ns = hit.map((r) => r.ns);
    return { name, ns: median(ns), lo: Math.min(...ns), hi: Math.max(...ns),
      steps: hit[0].steps, why: hit[0].why, entries: hit[0].entries,
      bails: Math.max(...hit.map((r) => r.bails || 0)), seeds: ns.length };
  });
  const base = rows.find((r) => r.name === 'l1');
  for (const r of rows) r.x = base ? base.ns / r.ns : null;
  return { ...first, seeds: got.length, rows };
}

module.exports = { genCom, sweep, oneWidth, verifyWidth };

// ---------------------------------------------------------------------------
// CLI (Node only).
// ---------------------------------------------------------------------------

function report(r, log) {
  const names = ['l1', ...new Set(r.widths.flatMap((w) => w.rows.map((x) => x.name)).filter((n) => n !== 'l1'))];
  log(`width  insns  body   nv   ${names.map((n) => n.padStart(9)).join('')}    (ns per x86 insn)`);
  for (const w of r.widths) {
    const by = new Map(w.rows.map((x) => [x.name, x]));
    log(`${String(w.width).padStart(5)}${String(w.insns).padStart(7)}${String(w.body).padStart(6)}`
      + `${String(w.nv).padStart(6)}   ${names.map((n) => (by.has(n) ? by.get(n).ns.toFixed(2) : '-').padStart(9)).join('')}`
      // Entering a program costs a couple of bails through the slow half
      // before it settles on a fast header; a bail rate above that is the JS
      // reference interpreter running part of the loop, which would put a
      // different engine under the number.
      + (w.seeds > 1 ? `   seed spread ${(100 * Math.max(...w.rows.map((x) => (x.hi - x.lo) / x.lo))).toFixed(0)}%` : '')
      + (w.rows.some((x) => x.bails > x.steps / 1000)
        ? `  BAILS (${w.notNative} non-native blocks: ${w.why.join(', ')})` : ''));
  }
  log(`width  ${names.filter((n) => n !== 'l1').map((n) => `${n} vs l1`.padStart(11)).join('')}`);
  for (const w of r.widths) {
    const by = new Map(w.rows.map((x) => [x.name, x]));
    log(`${String(w.width).padStart(5)}  ${names.filter((n) => n !== 'l1')
      .map((n) => (by.has(n) ? `x${by.get(n).x.toFixed(2)}` : '-').padStart(11)).join('')}`);
  }
  // The hypothesis's own statistic: the one-site loop engine against the
  // 520-site threaded one. If prediction is what the periodic loop was
  // flattering, this shrinks as the working set widens.
  const has = (w, n) => w.rows.find((x) => x.name === n);
  if (r.widths.every((w) => has(w, 'e1') && has(w, 'e3k4'))) {
    log(`loop vs threaded (e3k4 ns / e1 ns):  ${r.widths
      .map((w) => `W${w.width}=${(has(w, 'e3k4').ns / has(w, 'e1').ns).toFixed(2)}`).join('  ')}`);
  }
  const band = r.widths.map((w) => {
    const a = w.rows.find((x) => x.name === 'e1'), b = w.rows.find((x) => x.name === 'e1b');
    return a && b ? Math.abs(a.ns - b.ns) / Math.min(a.ns, b.ns) : null;
  }).filter((x) => x !== null);
  if (band.length) {
    log(`null band (e1 vs its identical twin): max ${(100 * Math.max(...band)).toFixed(2)}%`
      + `  mean ${(100 * band.reduce((s, x) => s + x, 0) / band.length).toFixed(2)}%`);
  }
  for (const f of r.failed) log(`  width ${f.width}: FAILED ${f.why}`);
}

async function shellSweep(o, shells, timeoutS, log) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { spawn } = require('child_process');
  // Reached through path.join so the bundler's own `require('./x')` walk does
  // not pull the bundler (and its asset templates) into the bundle.
  const { buildBundle } = require(path.join(__dirname, 'bundle-browser.js'));
  const JSVU = path.join(os.homedir(), '.jsvu', 'bin');
  const BIN = { node: [process.execPath], v8: [path.join(JSVU, 'v8')],
    sm: [path.join(JSVU, 'sm'), path.join(JSVU, 'spidermonkey')] };
  const binOf = (id) => (BIN[id] || []).find((b) => b === process.execPath || fs.existsSync(b)) || null;
  for (const s of shells) if (!binOf(s)) throw new Error(`no binary for shell ${s}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uop-vary-shell-'));
  const bundle = path.join(dir, 'bundle.js');
  fs.writeFileSync(bundle, buildBundle(['tools/toyvm/uop-varybench.js', 'lib/compile-wat.js']).js);
  const results = {};
  for (const sh of shells) {
    const script = path.join(dir, `run-${sh}.js`);
    fs.writeFileSync(script, `'use strict';
globalThis.self = globalThis;
var say = (typeof print === 'function') ? print : function (s) { console.log(s); };
if (typeof load === 'function') load(${JSON.stringify(bundle)});
else require('vm').runInThisContext(require('fs').readFileSync(${JSON.stringify(bundle)}, 'utf8'), { filename: 'bundle.js' });
ToyVM.require('tools/toyvm/uop-varybench.js').sweep(${JSON.stringify(o)}).then(function (r) {
  say('VARY ' + JSON.stringify(r));
}, function (e) { say('VARY-ERR ' + String((e && e.stack) || e).split('\\n').slice(0, 6).join(' | ')); });
`);
    log(`--- ${sh} ---`);
    const r = await new Promise((resolve) => {
      const p = spawn(binOf(sh), [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err += d; });
      const kill = setTimeout(() => p.kill('SIGKILL'), timeoutS * 1000);
      p.on('close', (code, sig) => {
        clearTimeout(kill);
        const m = /^VARY (.*)$/m.exec(out);
        if (m) return resolve(JSON.parse(m[1]));
        const e = /^VARY-ERR (.*)$/m.exec(out);
        return resolve({ widths: [], failed: [{ width: 0, why: sig === 'SIGKILL' ? 'timeout'
          : e ? e[1] : `exit ${code}: ${(err || out).trim().split('\n').slice(-3).join(' | ')}` }] });
      });
    });
    results[sh] = r;
    report(r, log);
  }
  return results;
}

if (typeof require !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2);
  const flag = (n, d) => {
    const a = args.find((x) => x === `--${n}` || x.startsWith(`--${n}=`));
    if (!a) return d;
    return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
  };
  const num = (s) => {
    const m = /^([\d.]+)([kmb]?)$/i.exec(String(s));
    return m ? Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()] : Number(s);
  };
  const o = {
    widths: String(flag('widths', '1,2,4,8,16,24,32,40,48,56')).split(',').map(Number),
    body: Number(flag('body', '4')),
    engines: String(flag('engines', 'e1,e1b,e2k4,e3k4')).split(','),
    steps: num(flag('steps', '2m')),
    warm: num(flag('warm', '50000')),
    reps: Number(flag('reps', '5')),
    seed: Number(flag('seed', '1')),
    seeds: Number(flag('seeds', '1')),
    straight: !!flag('straight', false),
    verify: !!flag('verify', false),
  };
  const os2 = require('os');
  (async () => {
    console.log(`uop-varybench: widths ${o.widths.join(',')} body ${o.body} steps ${o.steps}`
      + ` reps ${o.reps}  loadavg ${os2.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
    const shells = flag('arms', null);
    const json = flag('json', null);
    let payload;
    if (shells) {
      payload = await shellSweep(o, String(shells).split(','), Number(flag('timeout', '3600')), console.log);
    } else {
      payload = await sweep(o);
      if (payload.verify) {
        for (const v of payload.verify) {
          console.log(`  verify ${v.engine} budget=${v.budget}: ${v.ok ? 'agrees with L1' : `MISMATCH ${v.diff.join('; ')}`}`);
        }
      }
      report(payload, console.log);
    }
    if (json) require('fs').writeFileSync(json, JSON.stringify(payload, null, 1));
    console.log(`loadavg after ${os2.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  })().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
}
