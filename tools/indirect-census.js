#!/usr/bin/env node

'use strict';

// How many DATA-DEPENDENT indirect branches does a function really execute?
//
//   node tools/indirect-census.js --preset=block-exec
//   node tools/indirect-census.js --funcs='$next,$get_reg,$th_add_r_i32'
//   node tools/indirect-census.js --preset=block-exec --sites   # per-site detail
//   node tools/indirect-census.js --preset=block-exec --json
//
// WHY THIS EXISTS. Every argument about interpreter dispatch in this project
// ends at "the mispredicted indirect jump is the cost"
// (docs/interpreter-dispatch-perf.md). The block executor (src/07c-block-exec.wat)
// does not delete those jumps, it rearranges them: a micro-op reads R[d] and
// R[a] through a 15-arm `br_table` over locals, selects its arm through a
// 61-arm one, and writes back through a third -- against the threaded path's
// one `call_indirect` in `$next` plus the accessors' `br_table`s. Counting them
// by reading WAT is guesswork, because a small `br_table` may compile to a
// compare chain and a `return_call` to a known function compiles to an
// indirect-looking trampoline that is not data-dependent at all. This reads the
// machine code and classifies each one.
//
// WHAT IT PRINTS, per function:
//   table   a real jump table: `cmp wN,#K` + `ldr x16,[base,idx,lsl #3]` + `br x16`.
//           DATA-DEPENDENT. `arms` is K (the in-table indices); K+ takes the
//           default arm, so the branch has K+1 possible targets.
//   tailrec a `return_call` trampoline: `adr x17,<patch>` + `br x17`. STATIC --
//           one target, patched at link time; it is not a predictor problem.
//   icall   `blr xN` -- a `call_indirect` (or an imported host call).
//   itail   any other register jump: what `return_call_indirect` compiles to,
//           i.e. `$next`'s handler dispatch. DATA-DEPENDENT.
//
// Read `table` + `icall` + `itail` as the data-dependent count and ignore
// `tailrec`.
//
// LIMITS. The disassembly is SpiderMonkey Ion for the host arch (arm64 on this
// box), exactly as tools/wasm-native.js -- read it for structure, never for a
// cycle count attributed to V8. The classifier is arm64-only; on an x86 host it
// reports `unknown` rather than guessing. A site count is STATIC: how many of
// them one micro-op passes through is a path question, answered by --sites plus
// the source.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTool, nameTable, extract, disassemble, DEFAULT_WASM, COMBINED } =
  require('./wasm-native');

function arg(name, fallback) {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}
function flag(name) { return process.argv.slice(2).includes(`--${name}`); }

// The two paths a round-14 #3(a) census compares, named once here so the doc
// and the tool cannot drift.
const PRESETS = {
  'block-exec': [
    '$th_block_exec', '$th_block_exec_leaf',
    '$next', '$get_reg', '$set_reg',
    '$th_mov_r_r', '$th_mov_r_i32', '$th_add_r_r', '$th_add_r_i32',
    '$th_lea_ro', '$th_load32_ro', '$th_store32_ro',
    '$th_load32_ro_base_ebp', '$th_store32_ro_base_ebp', '$th_lea_sib',
  ],
};

// The accessors a threaded handler reaches through a DIRECT call. Each one
// contains a `br_table` of its own, so a handler that calls two of them pays
// two data-dependent jumps that do not appear in its own row. Counted here so
// the comparison against the executor is like for like.
const ACCESSORS = new Set([
  '$get_reg', '$set_reg', '$get_reg8', '$set_reg8', '$get_reg16', '$set_reg16',
]);

// One indirect branch, classified from the ~8 instructions in front of it.
function classify(instrs, i) {
  const cur = instrs[i].text;
  if (/\bblr\s+x\d+/.test(cur)) return { kind: 'icall' };
  const reg = cur.match(/\bbr\s+x(\d+)/);
  if (!reg) return null;
  const back = instrs.slice(Math.max(0, i - 8), i).map(x => x.text);
  // return_call trampoline: adr x17,<patch>; ldur x16,[x17,#4]; add x17,x17,x16; br x17
  if (back.some(t => /\badr\s+x17,/.test(t))) return { kind: 'tailrec' };
  // jump table: ldr x16,[xA, xB, lsl #3]
  const tbl = back.some(t => /\bldr\s+x\d+,\s*\[x\d+,\s*x\d+,\s*lsl\s*#3\]/.test(t));
  // Everything else that jumps through a register is an indirect TAIL
  // DISPATCH -- what `return_call_indirect` compiles to: the funcref table is
  // indexed far upstream (`add x8,x8,xN,lsl #4`) and the code pointer loaded
  // just before the jump, so the target is data-dependent exactly like an
  // `icall` and is counted with it.
  if (!tbl) return { kind: 'itail' };
  // The bounds check that precedes it names the number of in-table arms.
  let arms = null;
  for (let j = back.length - 1; j >= 0; j--) {
    const m = back[j].match(/\bcmp\s+[wx]\d+,\s*#0x([0-9a-f]+)/);
    if (m) { arms = parseInt(m[1], 16); break; }
  }
  return { kind: 'table', arms };
}

function censusOne(instrs) {
  const sites = [];
  for (let i = 0; i < instrs.length; i++) {
    const c = classify(instrs, i);
    if (c) sites.push({ off: instrs[i].off, ...c });
  }
  return sites;
}

function main() {
  const wasmPath = path.resolve(arg('wasm', DEFAULT_WASM));
  const watPath = path.resolve(arg('wat', COMBINED));
  const tier = arg('tier', 'ion');
  const preset = arg('preset', null);
  const explicit = arg('funcs', null);
  let want = explicit ? explicit.split(',').map(s => s.trim()).filter(Boolean)
    : preset ? PRESETS[preset] : null;
  if (!want) {
    console.error('need --funcs=a,b or --preset=' + Object.keys(PRESETS).join('|'));
    process.exit(2);
  }

  const sm = findTool('SM', [
    path.join(os.homedir(), '.jsvu', 'bin', 'sm'),
    '/usr/local/bin/sm', '/opt/homebrew/bin/sm',
  ], 'Install it with:  npx jsvu@latest --engines=spidermonkey');
  const objdump = findTool('OBJDUMP', [
    '/opt/homebrew/bin/gobjdump', '/usr/local/bin/gobjdump',
    '/opt/homebrew/opt/binutils/bin/objdump', '/usr/bin/objdump',
  ], 'Install it with:  brew install binutils');

  const names = nameTable(watPath);
  const bin = path.join(os.tmpdir(), `indirect-census-${process.pid}.bin`);
  const rows = [];
  try {
    const segs = extract(sm, wasmPath, tier, bin);
    const byIndex = new Map(segs.map(s => [s[0], s]));
    for (const fn of want) {
      const idx = names.byName.get(fn);
      if (idx === undefined) { rows.push({ fn, missing: 'no such function' }); continue; }
      const seg = byIndex.get(idx);
      if (!seg) { rows.push({ fn, missing: 'not ion-compiled' }); continue; }
      const [, begin, end] = seg;
      const text = disassemble(objdump, bin, begin, end);
      const instrs = [];
      for (const l of text.split('\n')) {
        const m = l.match(/^\s*([0-9a-f]+):\t(.*)$/);
        if (!m) continue;
        instrs.push({ off: parseInt(m[1], 16) - begin, text: m[2].replace(/\s+/g, ' ').trim() });
      }
      const sites = censusOne(instrs);
      // Direct calls, resolved through the same segment table wasm-native.js
      // uses, so an accessor call is named rather than guessed at.
      const calls = [];
      for (const ins of instrs) {
        const m = ins.text.match(/\b(?:bl|callq?)\s+\*?0x([0-9a-f]+)/);
        if (!m) continue;
        const t = parseInt(m[1], 16);
        const hit = segs.find(sg => t >= sg[1] && t < sg[2]);
        if (hit) calls.push(names.byIndex.get(hit[0]) || `#${hit[0]}`);
      }
      rows.push({
        fn, index: idx, bytes: end - begin, instrs: instrs.length,
        calls, accessorCalls: calls.filter(c => ACCESSORS.has(c)),
        table: sites.filter(s => s.kind === 'table').length,
        tailrec: sites.filter(s => s.kind === 'tailrec').length,
        icall: sites.filter(s => s.kind === 'icall').length,
        itail: sites.filter(s => s.kind === 'itail').length,
        sites,
      });
    }
  } finally {
    if (fs.existsSync(bin)) fs.unlinkSync(bin);
  }

  if (flag('json')) { console.log(JSON.stringify(rows, null, 2)); return; }

  console.log(`${path.relative(process.cwd(), wasmPath)}  (${tier}, host ${process.arch})`);
  console.log('');
  // A function's own data-dependent count, plus one per accessor it calls
  // (each accessor is a single `br_table`).
  const own = r => r.table + r.icall + r.itail;
  console.log('function                        bytes  instrs  table  icall  itail  tailrec  accessor  dd-total');
  console.log('-'.repeat(98));
  for (const r of rows) {
    if (r.missing) { console.log(`${r.fn.padEnd(30)}  ${r.missing}`); continue; }
    const acc = r.accessorCalls.length;
    console.log(
      `${r.fn.padEnd(30)}${String(r.bytes).padStart(6)}${String(r.instrs).padStart(8)}` +
      `${String(r.table).padStart(7)}${String(r.icall).padStart(7)}` +
      `${String(r.itail).padStart(7)}${String(r.tailrec).padStart(9)}` +
      `${String(acc).padStart(10)}${String(own(r) + acc).padStart(10)}` +
      (acc ? `   (${r.accessorCalls.join(' ')})` : ''));
  }
  if (flag('sites')) {
    for (const r of rows) {
      if (r.missing || !r.sites.length) continue;
      console.log('');
      console.log(`${r.fn}:`);
      for (const s of r.sites) {
        const arms = s.kind === 'table'
          ? `  arms=${s.arms} (+default => ${s.arms + 1} targets)` : '';
        console.log(`  +0x${s.off.toString(16).padStart(4, '0')}  ${s.kind}${arms}`);
      }
    }
  }
}

if (require.main === module) main();
module.exports = { classify, censusOne };
