#!/usr/bin/env node

'use strict';

// Where does guest CPU time go inside the interpreter?
//
// `tools/cpuprof-top.js` ranks individual functions, which answers "what is the
// hottest function" and not "what would removing a MECHANISM buy". The levers
// under discussion — inlining `$next`/`$set_reg`, a per-block handler that keeps
// registers in wasm locals, multi-block region descriptors — each delete a
// *category* of work spread over dozens of functions, and a per-function list
// cannot be added up by eye without deciding, over and over, whether
// `$th_add_ebp_eax2_disp` is dispatch or arithmetic.
//
// So this groups a V8 .cpuprofile's self time into the removable categories and
// prints one table. Categories are decided by the function's WAT name, resolved
// through tools/wasm-func-name.js, so they cannot drift from a renumbered
// module the way a hard-coded index list would.
//
//   node tools/dispatch-attribution.js run.cpuprofile
//   node tools/dispatch-attribution.js a.cpuprofile --label='heroes2 inlined'
//   node tools/dispatch-attribution.js a.cpuprofile --members --top=12
//   node tools/dispatch-attribution.js a.cpuprofile --ops=123456789 --blocks=4567
//   node tools/dispatch-attribution.js a.cpuprofile b.cpuprofile --compare
//
// SHARES are the load-robust output: this box runs at load 20-200 and every
// absolute millisecond scales with whatever else is on it. ns/op and ns/block
// (with --ops/--blocks) are printed because the decision needs an absolute
// ceiling, but they are the number to distrust first.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------- categories

// Order matters: the first matching rule wins, so a specific prefix must come
// before the generic one it is a prefix of.
const RULES = [
  // The threaded-code dispatch itself: one indirect call per op, plus the
  // inline operand fetch from the thread stream. $read_thread_word is part of
  // dispatch and not of the handler: it is the "advance $ip" half of the
  // fetch-decode-execute loop, and with V8 wasm inlining ON it disappears into
  // its callers entirely — which is exactly why it has to be named here.
  ['dispatch', n => n === '$next' || n === '$read_thread_word' || n === '$read_addr'],

  // Leaving one basic block and finding the next: the run loop, the block
  // cache probe, the page index, and the branch/jcc epilogues that hand an
  // address back to it. This is what a multi-block region descriptor deletes.
  // The self-modifying-code guards on every guest store belong here too: they
  // exist only to keep the decoded-block cache honest.
  ['block/cache', n => n === '$run' || n === '$branch_end' || n === '$jcc_end'
    || n === '$branch_target' || n === '$cache_slot' || n === '$cache_lookup'
    || /^\$page_(enter|resolve|probe|dir_slot|index_|publish|create|desc_|retire)/.test(n)
    || /^\$(code_write_is_code|code_page_test|invalidate_code_write|cache_)/.test(n)],

  // Decoding x86 into threaded code, and the page/chunk allocator that stores
  // it. Not removable by any of the four levers — but it has to be separated
  // out or it lands in "other wasm" and looks like handler work.
  ['decode/compile', n => /^\$(decode|emit|loopmatch|lm_|tree_fold|fold_)/.test(n)
    || /^\$page_chunk/.test(n)],

  // The br_table register file. This is what a per-block handler holding
  // registers in wasm locals deletes.
  ['reg accessors', n => /^\$(get|set)_reg(8|16)?$/.test(n)],

  // Lazy-flag bookkeeping, split write vs read: a per-block handler can sink
  // the writes, but a guest that actually reads a flag still pays the read.
  ['flag writes', n => /^\$set_flags_/.test(n)],
  ['flag reads', n => /^\$(get_(zf|cf|sf|of|pf|af)|build_eflags)$/.test(n)],

  // Guest address -> wasm linear address, and the typed load/store wrappers
  // that call it. Kept apart because $g2w alone is the translation and the
  // gl/gs pair is translation plus the access.
  ['g2w translate', n => /^\$g2w/.test(n) || n === '$guest_page_translate'],
  ['guest ld/st', n => /^\$(gl|gs)(8|16|32|_char)$/.test(n)],

  // The actual work: every threaded-code handler body, plus the shared cores
  // the handlers call into — the sized ALU/shift kernels, the condition
  // evaluator, the x87 engine and the string/REP loops. Leaving those in
  // "other wasm" makes handler work look small for the one reason that has
  // nothing to do with the guest: with inlining ON they vanish into their
  // `$th_*` callers and with it OFF they do not.
  ['handler bodies', n => /^\$th_/.test(n)
    || /^\$(do_alu|do_shift|do_muldiv|eval_cc|fpu_|x87_|rep_|movs|stos|scas|cmps|mmx_|simd_)/.test(n)],

  // Win32 API surface reached through the thunk zone.
  ['win32 api', n => /^\$(handle_|win32_dispatch|api_)/.test(n)],
];

const WASM_OTHER = 'other wasm';
const JS_HOST = 'js host/harness';

const CATEGORY_ORDER = [
  'dispatch', 'block/cache', 'reg accessors', 'flag writes', 'flag reads',
  'g2w translate', 'guest ld/st', 'handler bodies', 'decode/compile',
  'win32 api', WASM_OTHER, JS_HOST,
];

function categorize(name, isWasm) {
  if (!isWasm) return JS_HOST;
  for (const [cat, test] of RULES) if (test(name)) return cat;
  return WASM_OTHER;
}

// -------------------------------------------------------------- name lookup

let nameCache = null;
function wasmNames() {
  if (nameCache) return nameCache;
  nameCache = new Map();
  try {
    const out = execFileSync('node',
      [path.join(__dirname, 'wasm-func-name.js'), '--dump'], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      });
    for (const line of out.split('\n')) {
      const m = line.match(/^\[(\d+)\] (\S+)/);
      if (m) nameCache.set(Number(m[1]), m[2]);
    }
  } catch (err) {
    console.error(`dispatch-attribution: cannot resolve wasm names (${err.message})`);
    console.error('  build/combined.wat must exist; run tools/concat-wat.js');
  }
  return nameCache;
}

// -------------------------------------------------------------- profile read

// A .cpuprofile is {nodes, samples, timeDeltas}: timeDeltas[i] is the time
// spent BEFORE samples[i], so charging it to samples[i] is the standard
// self-time attribution and matches tools/cpuprof-top.js.
function readCpuProfile(file) {
  const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map();
  for (const n of prof.nodes) byId.set(n.id, n);
  const self = new Map();
  let total = 0;
  for (let i = 0; i < prof.samples.length; i += 1) {
    const dt = (prof.timeDeltas[i] || 0) / 1000;
    if (dt <= 0) continue;
    total += dt;
    self.set(prof.samples[i], (self.get(prof.samples[i]) || 0) + dt);
  }
  const names = wasmNames();
  const rows = new Map();   // label -> {ms, wasm}
  for (const [id, ms] of self) {
    const node = byId.get(id);
    if (!node) continue;
    const frame = node.callFrame || {};
    const raw = frame.functionName || '(anonymous)';
    const idx = raw.match(/^wasm-function\[(\d+)\]$/);
    let label; let isWasm = false;
    if (idx) {
      isWasm = true;
      label = names.get(Number(idx[1])) || raw;
    } else {
      const url = (frame.url || '').replace(/^file:\/\//, '').split('/').pop();
      label = url ? `${raw} @ ${url}` : raw;
    }
    const cur = rows.get(label) || { ms: 0, wasm: isWasm };
    cur.ms += ms;
    rows.set(label, cur);
  }
  return { total, rows, samples: prof.samples.length };
}

// `node --prof` writes a v8.log; --prof-process turns it into a text report
// whose "Bottom up (heavy) profile" is not what we want, but whose ticks
// section is. Accept the PROCESSED text so this tool never has to shell out.
function readProfText(file) {
  const text = fs.readFileSync(file, 'utf8');
  const names = wasmNames();
  const rows = new Map();
  let total = 0;
  let inTicks = false;
  for (const line of text.split('\n')) {
    if (/^\s*ticks\s+total\s+nonlib/.test(line)) { inTicks = true; continue; }
    if (inTicks && /^\s*\[/.test(line)) { inTicks = false; continue; }
    if (!inTicks) continue;
    const m = line.match(/^\s*(\d+)\s+[\d.]+%\s+[\d.]+%\s+(.*\S)\s*$/);
    if (!m) continue;
    const ticks = Number(m[1]);
    let label = m[2].replace(/^(JS|LazyCompile|Builtin|Stub|RegExp|Function|CPP|SHARED_LIB):\s*/, '');
    const idx = label.match(/wasm-function\[(\d+)\]/);
    let isWasm = false;
    if (idx) { isWasm = true; label = names.get(Number(idx[1])) || label; }
    total += ticks;
    const cur = rows.get(label) || { ms: 0, wasm: isWasm };
    cur.ms += ticks;
    rows.set(label, cur);
  }
  if (!rows.size) {
    throw new Error(`${file}: no tick table found — pass a .cpuprofile, or the OUTPUT of node --prof-process`);
  }
  return { total, rows, samples: total, unit: 'ticks' };
}

function read(file) {
  return file.endsWith('.cpuprofile') || file.endsWith('.json')
    ? readCpuProfile(file) : readProfText(file);
}

// ------------------------------------------------------------------ reporting

function aggregate(prof) {
  const cats = new Map();
  for (const [label, { ms, wasm }] of prof.rows) {
    const cat = categorize(label, wasm);
    const cur = cats.get(cat) || { ms: 0, members: [] };
    cur.ms += ms;
    cur.members.push([label, ms]);
    cats.set(cat, cur);
  }
  for (const v of cats.values()) v.members.sort((a, b) => b[1] - a[1]);
  return cats;
}

function bar(share, width = 24) {
  const n = Math.round(share * width);
  return '#'.repeat(Math.min(width, n)).padEnd(width, '.');
}

function table(prof, cats, opts) {
  const out = [];
  const wasmMs = [...cats].filter(([k]) => k !== JS_HOST)
    .reduce((a, [, v]) => a + v.ms, 0);
  const denom = opts.ofWasm ? wasmMs : prof.total;
  const head = opts.ofWasm ? 'share of wasm' : 'share of process';
  out.push(`${opts.label || 'profile'}   ${prof.total.toFixed(0)} ${prof.unit || 'ms'} sampled, `
    + `${prof.samples} samples, wasm ${(100 * wasmMs / prof.total).toFixed(1)}% of process`);
  if (opts.ops) out.push(`  ops ${opts.ops.toLocaleString()}`
    + (opts.blocks ? `   blocks ${opts.blocks.toLocaleString()}`
      + `   ops/block ${(opts.ops / opts.blocks).toFixed(1)}` : ''));
  out.push('');
  // A .cpuprofile is charged in ms; a --prof-process tick table in ticks. The
  // shares are the same either way, so the column is named for what it is.
  const cols = ['category', prof.unit || 'ms', head, 'ns/op', 'ns/block'];
  const widths = [16, 10, 14, 9, 10];
  out.push(cols.map((c, i) => c.padEnd(widths[i])).join(' ') + ' profile');
  out.push(widths.map(w => '-'.repeat(w)).join(' ') + ' ' + '-'.repeat(24));
  const rows = CATEGORY_ORDER.filter(c => cats.has(c))
    .concat([...cats.keys()].filter(c => !CATEGORY_ORDER.includes(c)));
  for (const cat of rows) {
    if (opts.ofWasm && cat === JS_HOST) continue;
    const ms = cats.get(cat).ms;
    const share = ms / denom;
    const nsOp = opts.ops ? (ms * 1e6 / opts.ops) : null;
    const nsBlk = opts.blocks ? (ms * 1e6 / opts.blocks) : null;
    out.push([
      cat.padEnd(widths[0]),
      ms.toFixed(0).padStart(widths[1]),
      `${(100 * share).toFixed(2)}%`.padStart(widths[2]),
      (nsOp === null ? '-' : nsOp.toFixed(2)).padStart(widths[3]),
      (nsBlk === null ? '-' : nsBlk.toFixed(1)).padStart(widths[4]),
    ].join(' ') + ' ' + bar(share));
    if (opts.members) {
      for (const [name, mms] of cats.get(cat).members.slice(0, opts.top)) {
        if (mms / denom < 0.001) break;
        out.push(`    ${(100 * mms / denom).toFixed(2).padStart(6)}%  ${name}`);
      }
    }
  }
  out.push(widths.map(w => '-'.repeat(w)).join(' ') + ' ' + '-'.repeat(24));
  out.push(`${'TOTAL'.padEnd(widths[0])} ${denom.toFixed(0).padStart(widths[1])} `
    + `${'100.00%'.padStart(widths[2])}`);
  return out.join('\n');
}

function compare(profs, opts) {
  const aggs = profs.map(p => aggregate(p));
  const denoms = profs.map((p, i) => opts.ofWasm
    ? [...aggs[i]].filter(([k]) => k !== JS_HOST).reduce((a, [, v]) => a + v.ms, 0)
    : p.total);
  const cats = new Set();
  for (const a of aggs) for (const k of a.keys()) cats.add(k);
  const rows = CATEGORY_ORDER.filter(c => cats.has(c));
  const out = [];
  out.push(['category'.padEnd(16), ...profs.map((p, i) => (p.label || `#${i}`).padStart(14))].join(' '));
  out.push(['-'.repeat(16), ...profs.map(() => '-'.repeat(14))].join(' '));
  for (const c of rows) {
    if (opts.ofWasm && c === JS_HOST) continue;
    out.push([c.padEnd(16), ...aggs.map((a, i) =>
      `${(100 * (a.get(c) ? a.get(c).ms : 0) / denoms[i]).toFixed(2)}%`.padStart(14))].join(' '));
  }
  return out.join('\n');
}

// ----------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const flag = n => argv.includes(`--${n}`);
  const arg = (n, d) => {
    const a = argv.find(v => v.startsWith(`--${n}=`));
    return a ? a.slice(n.length + 3) : d;
  };
  const files = argv.filter(a => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node tools/dispatch-attribution.js <file.cpuprofile|prof-process.txt> [more...]');
    console.error('  --label=NAME  --labels=A,B,C  --members [--top=N]  --of-wasm  --compare');
    console.error('  --ops=N --blocks=N   (from --handler-hist / --batch-stats, for ns/op)');
    process.exit(1);
  }
  const opts = {
    label: arg('label', null),
    members: flag('members'),
    top: parseInt(arg('top', '8'), 10),
    ofWasm: flag('of-wasm'),
    ops: arg('ops', null) ? Number(arg('ops')) : null,
    blocks: arg('blocks', null) ? Number(arg('blocks')) : null,
  };
  const labels = (arg('labels', '') || '').split(',').map(s => s.trim()).filter(Boolean);
  const profs = files.map((f, i) => {
    const p = read(f);
    p.label = labels[i]
      || (files.length > 1 ? path.basename(f).replace(/\.(cpuprofile|txt|json)$/, '') : opts.label);
    return p;
  });
  if (flag('compare') && profs.length > 1) {
    console.log(compare(profs, opts));
    return;
  }
  for (const p of profs) {
    console.log(table(p, aggregate(p), { ...opts, label: p.label || opts.label }));
    console.log('');
  }
}

if (require.main === module) main();
module.exports = { aggregate, read, categorize, CATEGORY_ORDER };
