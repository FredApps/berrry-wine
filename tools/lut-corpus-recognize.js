#!/usr/bin/env node
'use strict';

// Does the RUNTIME LUT_RUN matcher accept the loops the static model says it
// should? Answered with real bytes out of real binaries, not synthesized ones.
//
//   node tools/lut-corpus-recognize.js <pe> [<pe>...] [--limit=N] [--verbose]
//                                      [--json] [--dump-shapes]
//
// WHY THIS EXISTS
//   tools/match-loops.js is a JavaScript model of the matcher. It cannot see
//   src/07b-loop-match.wat at all, so its "376 of 404 loops would fold" is an
//   UPPER bound on a good day and pure fiction after any WAT change. Two
//   independent facts say the real recognizer is narrower: bench-loops' `lut`
//   shape is a genuine Heroes II blitter and folds in neither arm, and a
//   synthetic fuzzer that emitted plain [reg] and [reg+disp32] addressing
//   folded 361 of 361 -- while a census of the 17 real LUT loops in
//   starcraft.exe shows 10 of them use base+index or scaled-stack addressing
//   and 6 run in REVERSE, none of which the fuzzer ever emitted.
//
//   So neither the static model nor a hand-rolled generator can answer "how
//   far does the fold actually reach". This takes the loop bodies the census
//   finds, copies their literal bytes into a live instance, and asks the
//   decoder.
//
// WHAT IT DOES AND DOES NOT PROVE
//   RECOGNIZED means the decoder emitted the fold for that body. It is a
//   statement about REACH, not correctness: the loop runs here against
//   scratch registers and whatever its absolute operands happen to address,
//   so its RESULT is meaningless and is deliberately not checked. Correctness
//   of a folded run is tools/lut-differential.js's job.
//
//   A loop's relative branch survives relocation (it is relative), but its
//   absolute data references do not point at anything meaningful in this
//   harness. That is fine and expected: the fold decision is made at decode
//   time, before any of those addresses are touched.

const fs = require('fs');
const path = require('path');
const { findLoops } = require('./find-loops');
const { disasmAt } = require('./disasm');
const { match } = require('./match-loops');
const { readPE } = require('../lib/pe');
const { bootRenderHarness } = require('../test/render-helper');

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
const has = n => argv.includes(`--${n}`);
const files = argv.filter(a => !a.startsWith('--'));

const LIMIT = parseInt(opt('limit', '0'), 10);
const VERBOSE = has('verbose');
const JSON_OUT = has('json');
const DUMP_SHAPES = has('dump-shapes');

if (!files.length) {
  console.error('usage: node tools/lut-corpus-recognize.js <pe> [<pe>...] [--limit=N] [--verbose]');
  process.exit(2);
}

// findLoops hands back { va, n, body: [text] } -- instruction TEXT, with no
// byte extents on it. So re-disassemble n instructions from the head and sum
// their real lengths. Same line format find-loops itself parses, so the two
// cannot disagree about where the loop ends.
function loopExtent(pe, lp) {
  const off = pe.va2off(lp.va);
  if (off < 0) return null;
  const lines = disasmAt(pe.buf, off, lp.va, lp.n, null, { linear: true });
  let end = lp.va, seen = 0;
  for (const ln of lines) {
    const m = /^([0-9a-f]{8})\s{2}((?:[0-9a-f]{2} )+)\s*(.*)$/.exec(ln);
    if (!m) continue;
    end = parseInt(m[1], 16) + m[2].trim().split(' ').length;
    if (++seen === lp.n) break;
  }
  if (seen !== lp.n) return null;
  return { start: lp.va, end };
}

(async () => {
  const EXTRA_WAT = `
  (func (export "test_lcr_g2w") (param $ga i32) (result i32)
    (call $g2w (local.get $ga)))
`;
  const { exports: e, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT, fonts: 'none' });
  const host = fs.readFileSync(path.join(__dirname, '..', 'test', 'binaries', 'notepad.exe'));
  const bytes = new Uint8Array(memory.buffer);
  bytes.set(host, e.get_staging());
  if (!e.load_pe(host.length)) throw new Error('host fixture PE failed to load');

  const imageBase = e.get_image_base() >>> 0;
  const wa = ga => e.test_lcr_g2w(ga) >>> 0;
  const dv = new DataView(memory.buffer);

  const stack = (imageBase + 0xd00000) >>> 0;
  const scratch = (imageBase + 0xc00000) >>> 0;
  const codeBase = (imageBase + 0xc20000) >>> 0;
  let slot = 0;

  e.set_loop_lut_emit(1);

  const setAll = [e.set_eax, e.set_ecx, e.set_edx, e.set_ebx,
    e.set_ebp, e.set_esi, e.set_edi].map(f => f.bind(e));

  // One body: copy its literal bytes to a fresh VA, point every register at a
  // small scratch buffer, give it a bounded budget and see whether the decoder
  // folded it. A fresh VA per body keeps the block cache from serving one
  // body's decode for another.
  function recognize(code) {
    const ga = (codeBase + slot * 0x400) >>> 0;
    slot++;
    bytes.set(code, wa(ga));
    // 8 is a short but nonzero trip count for whichever register turns out to
    // be the counter; everything else lands on a mapped scratch page.
    for (const set of setAll) set(scratch);
    e.set_ecx(8); e.set_edx(8); e.set_ebp(8);
    e.set_esp(stack);
    dv.setUint32(wa(stack), 0, true);
    // Count RUNS, not matches. The `matches` counter stays at 0 even in a real
    // app that folds this loop millions of times (`bounded LUT matches 0 runs
    // 1636206` on StarCraft), so it does not mean what its name suggests and
    // reading it reports every loop as declined.
    const before = e.get_loop_lut_runs() >>> 0;
    e.set_eip(ga);
    try { e.run(50000); } catch (_) { /* a wild body may trap; the decode already happened */ }
    return (e.get_loop_lut_runs() >>> 0) !== before;
  }

  const perFile = [];
  let totalStatic = 0, totalRecognized = 0, totalUnreadable = 0;
  const shapes = new Map();

  for (const f of files) {
    let loops;
    try { loops = findLoops(f); }
    catch (err) { console.error(`${path.basename(f)}: ${err.message}`); continue; }

    let pe;
    try { pe = readPE(f); }
    catch (err) { console.error(`${path.basename(f)}: ${err.message}`); continue; }

    const row = { file: f, static: 0, recognized: 0, unreadable: 0, declined: [] };
    for (const lp of loops) {
      const m = match(lp.body);
      if (m.reject || m.pattern !== 'LUT_RUN') continue;
      row.static++; totalStatic++;
      if (LIMIT && row.static > LIMIT) break;

      const ext = loopExtent(pe, lp);
      if (!ext) { row.unreadable++; totalUnreadable++; continue; }
      const off = pe.va2off(ext.start);
      const offEnd = pe.va2off(ext.end);
      if (off < 0 || offEnd < 0 || offEnd <= off) { row.unreadable++; totalUnreadable++; continue; }

      const code = pe.buf.slice(off, offEnd);
      const ok = recognize(new Uint8Array(code));
      if (ok) { row.recognized++; totalRecognized++; }
      else row.declined.push('0x' + ext.start.toString(16));

      if (DUMP_SHAPES) {
        const key = `${m.size || 1}/${m.stride}`;
        const s = shapes.get(key) || { recognized: 0, declined: 0 };
        s[ok ? 'recognized' : 'declined']++;
        shapes.set(key, s);
      }
      if (VERBOSE) {
        console.log(`  ${ok ? 'RECOGNIZED' : 'declined  '} 0x${ext.start.toString(16)} ` +
          `size=${m.size || 1} stride=${m.stride} (${offEnd - off} bytes)`);
      }
    }
    perFile.push(row);
    console.log(`${path.basename(f).padEnd(34)} static ${String(row.static).padStart(4)}  ` +
      `runtime-recognized ${String(row.recognized).padStart(4)}  ` +
      `unreadable ${row.unreadable}`);
  }

  console.log('');
  console.log(`static LUT_RUN candidates : ${totalStatic}`);
  console.log(`RUNTIME recognized        : ${totalRecognized}` +
    (totalStatic ? `  (${(100 * totalRecognized / totalStatic).toFixed(1)}%)` : ''));
  console.log(`could not extract bytes   : ${totalUnreadable}`);

  if (DUMP_SHAPES && shapes.size) {
    console.log('\nby size/stride:');
    for (const [k, v] of [...shapes].sort()) {
      console.log(`  ${k.padEnd(8)} recognized ${String(v.recognized).padStart(4)}  ` +
        `declined ${String(v.declined).padStart(4)}`);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ totalStatic, totalRecognized, totalUnreadable, perFile }, null, 2));
  }

  // A run where the static census found nothing has measured nothing, and must
  // not read as success.
  if (totalStatic === 0) {
    console.log('\nNO static LUT_RUN candidates in these inputs -- nothing was measured.');
    process.exit(2);
  }
})();
