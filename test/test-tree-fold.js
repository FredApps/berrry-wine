#!/usr/bin/env node
'use strict';

// TREE_FOLD (H454, src/07b-loop-match.wat, docs/tree-fold-design-a.md).
//
// The first GENERAL decode-time expression fold: a self-loop whose interior is
// full-width integer dataflow becomes one super-op that runs the body with the
// eight GPRs in wasm locals. Because the shape is a parameter rather than a
// predicate, the thing to test is not "does it recognize this loop" but "does
// running it change anything an unfolded run would have left".
//
// So every positive case is run TWICE over separate code addresses -- once
// with the gate off and once on -- and the two arms must agree on all eight
// registers, on CF/ZF/SF/OF/PF, and on the memory they touched. That is the
// only assertion that can catch a wrong micro-op, a stale flag field or a
// dropped live-out, and it is checked against the interpreter itself rather
// than against a hand-computed expectation that could be wrong the same way.
//
// Three shapes, chosen from docs/int-expr-fusion-census.md:
//   A  quake2 ref_soft+0x12570's span coordinate interleave (67,828 hits; the
//      census's one unambiguous tree, 17 of 19 ops foldable)
//   B  a load / imul / add / sar / store chain with two address updates -- the
//      fixed-point address-update loop
//   C  a plain in-place load/op/store chain closed by cmp/jb, which is also
//      the alias proof: the load reads back what the previous iteration stored
//
// Negative cases must NOT fold: a partial-register write, an interior flag
// consumer (adc), and a body under the minimum-op floor.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const EXTRA_WAT = `
  (func (export "test_tree_matches") (result i32) (global.get $tree_fold_matches))
  (func (export "test_tree_runs") (result i32) (global.get $tree_fold_runs))
  (func (export "test_tree_iters") (result i64) (global.get $tree_fold_iters))
  (func (export "test_tree_ops") (result i64) (global.get $tree_fold_ops))
  (func (export "test_tree_nuops") (result i32) (global.get $tree_fold_last_nuops))
  (func (export "test_tree_live_out") (result i32) (global.get $tree_fold_last_live_out))
  (func (export "test_tree_cf") (result i32) (call $get_cf))
  (func (export "test_tree_zf") (result i32) (call $get_zf))
  (func (export "test_tree_sf") (result i32) (call $get_sf))
  (func (export "test_tree_of") (result i32) (call $get_of))
  (func (export "test_tree_pf") (result i32) (call $get_pf))
`;

// Close a body with `dec ecx / jnz body`. The jnz displacement counts from the
// byte after it, so it is -(len + 2) once the dec is included.
function loopBackDec(body) {
  const withDec = body.concat([0x49]);
  return withDec.concat([0x75, (-(withDec.length + 2)) & 0xff, 0xc3]);
}
// Close a body with an explicit two-byte Jcc already in it.
function loopBackJcc(body, opcode) {
  return body.concat([opcode, (-(body.length + 2)) & 0xff, 0xc3]);
}

// -- A: quake2's span coordinate interleave -----------------------------------
// mov eax,edx / add edx,ebx / shr eax,16 / mov esi,edx / add edx,ebx
// and esi,0xffff0000 / or eax,esi / mov [edi],eax / add edi,4 / dec ecx / jnz
const SHAPE_A = loopBackDec([
  0x89, 0xD0,                         // mov eax, edx
  0x01, 0xDA,                         // add edx, ebx
  0xC1, 0xE8, 0x10,                   // shr eax, 16
  0x89, 0xD6,                         // mov esi, edx
  0x01, 0xDA,                         // add edx, ebx
  0x81, 0xE6, 0x00, 0x00, 0xFF, 0xFF, // and esi, 0xffff0000
  0x09, 0xF0,                         // or  eax, esi
  0x89, 0x07,                         // mov [edi], eax
  0x83, 0xC7, 0x04,                   // add edi, 4
]);

// -- B: load / imul / add / sar / store with two cursors ----------------------
const SHAPE_B = loopBackDec([
  0x8B, 0x06,                         // mov  eax, [esi]
  0x6B, 0xC0, 0x03,                   // imul eax, eax, 3
  0x01, 0xD8,                         // add  eax, ebx
  0xC1, 0xF8, 0x08,                   // sar  eax, 8
  0x89, 0x07,                         // mov  [edi], eax
  0x83, 0xC6, 0x04,                   // add  esi, 4
  0x83, 0xC7, 0x04,                   // add  edi, 4
]);

// -- C: in-place load/op/store closed by cmp/jb -------------------------------
// The store and the next iteration's load are the SAME address, so a fold that
// reordered them, cached the loaded value, or wrote memory late would produce
// different bytes. It does neither: micro-ops execute in source order through
// the ordinary $gl32/$gs32.
const SHAPE_C = loopBackJcc([
  0x8B, 0x06,                         // mov  eax, [esi]
  0x31, 0xD0,                         // xor  eax, edx
  0x05, 0x34, 0x12, 0x00, 0x00,       // add  eax, 0x1234
  0xF7, 0xD0,                         // not  eax
  0x89, 0x06,                         // mov  [esi], eax
  0x83, 0xC6, 0x04,                   // add  esi, 4
  0x3B, 0xF7,                         // cmp  esi, edi
], 0x72);                             // jb

// -- negatives ----------------------------------------------------------------
// A byte load into AL is a partial-register write; it is not in the micro-op
// table, so the whole block declines rather than being widened by guesswork.
const NEG_PARTIAL = loopBackDec([
  0x89, 0xD0,                         // mov  eax, edx
  0x8A, 0x06,                         // mov  al, [esi]      <-- partial reg
  0x01, 0xDA,                         // add  edx, ebx
  0x89, 0x07,                         // mov  [edi], eax
  0x83, 0xC7, 0x04,                   // add  edi, 4
]);
// ADC reads CF. An interior flag CONSUMER is exactly what this family forbids,
// because the fold's whole licence is that nothing between the ops looks at
// the flags the ops leave behind.
const NEG_ADC = loopBackDec([
  0x89, 0xD0,                         // mov  eax, edx
  0x11, 0xD8,                         // adc  eax, ebx       <-- flag consumer
  0x01, 0xDA,                         // add  edx, ebx
  0x89, 0x07,                         // mov  [edi], eax
  0x83, 0xC7, 0x04,                   // add  edi, 4
]);
// Three interior ops, under the default floor of four.
const NEG_SHORT = loopBackDec([
  0x89, 0xD0,                         // mov  eax, edx
  0x01, 0xDA,                         // add  edx, ebx
  0x83, 0xC7, 0x04,                   // add  edi, 4
]);

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  let bytes = new Uint8Array(memory.buffer);
  let dv = new DataView(memory.buffer);
  bytes.set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = ga => (ga - imageBase + guestBase) >>> 0;
  const codeBase = (imageBase + 0x2400) >>> 0;
  const stack = (imageBase + 0xd00000) >>> 0;
  let codeSlot = 0;

  // A fresh guest address per install, so the two arms of an A/B decode
  // independently: the gate is read at decode time and a cached block would
  // otherwise carry the previous arm's decision into this one.
  function install(code) {
    const ga = (codeBase + codeSlot++ * 0x100) >>> 0;
    bytes.set(Uint8Array.from(code), wa(ga));
    return ga;
  }

  function state() {
    return {
      eax: e.get_eax() >>> 0, ecx: e.get_ecx() >>> 0,
      edx: e.get_edx() >>> 0, ebx: e.get_ebx() >>> 0,
      esp: e.get_esp() >>> 0, ebp: e.get_ebp() >>> 0,
      esi: e.get_esi() >>> 0, edi: e.get_edi() >>> 0,
      cf: e.test_tree_cf(), zf: e.test_tree_zf(), sf: e.test_tree_sf(),
      of: e.test_tree_of(), pf: e.test_tree_pf(),
    };
  }

  // budget=null runs to completion in one call. A small budget forces the fold
  // to hand control back mid-loop and be re-entered, which is the side-exit
  // path -- and the assertion is that the answer does not change.
  function runAt(code, regs, budget) {
    e.set_eax(regs.eax >>> 0); e.set_ecx(regs.ecx >>> 0);
    e.set_edx(regs.edx >>> 0); e.set_ebx(regs.ebx >>> 0);
    e.set_ebp(regs.ebp >>> 0); e.set_esi(regs.esi >>> 0); e.set_edi(regs.edi >>> 0);
    e.set_esp(stack);
    dv.setUint32(wa(stack), 0, true);
    e.set_eip(code);
    for (let i = 0; i < 200000; i++) {
      e.run(budget === undefined || budget === null ? 100000 : budget);
      if ((e.get_eip() >>> 0) === 0) return state();
    }
    throw new Error(`probe never returned (eip=0x${(e.get_eip() >>> 0).toString(16)})`);
  }

  const arena = e.guest_alloc(0x20000) >>> 0;
  bytes = new Uint8Array(memory.buffer);
  dv = new DataView(memory.buffer);

  const seed = (ga, n) => {
    for (let i = 0; i < n; i++) dv.setUint32(wa(ga) + i * 4, (i * 2654435761) >>> 0, true);
  };
  const readBack = (ga, n) =>
    Array.from(new Uint32Array(memory.buffer.slice(wa(ga), wa(ga) + n * 4)));

  // ---------------------------------------------------------------- shapes --
  // Each case: decode+run with the gate OFF, then with it ON at a different
  // address, and demand the two agree. `matches` is counted in both arms (the
  // predicate runs regardless of the gate), so it also proves the OFF arm
  // really did decline to EMIT rather than failing to recognize.
  function checkShape(name, code, mkRegs, out, outWords, opts = {}) {
    const offCode = install(code);
    const onCode = install(code);

    e.set_tree_fold(0);
    const matchesBefore = e.test_tree_matches();
    // Cumulative across shapes, so the OFF arm's claim is "did not move it",
    // never "it is zero".
    const runsAtEntry = e.test_tree_runs();
    if (out !== null) seed(out.seedAt, out.seedWords);
    const offState = runAt(offCode, mkRegs(offCode), opts.budget);
    const offMem = out === null ? null : readBack(out.readAt, outWords);
    const matchesOff = e.test_tree_matches();
    assert.strictEqual(matchesOff, matchesBefore + 1,
      `${name}: the predicate recognizes the block even with the gate off`);
    const runsBefore = e.test_tree_runs();
    assert.strictEqual(runsBefore, runsAtEntry,
      `${name}: the gate-off arm executes no super-op`);

    e.set_tree_fold(1);
    if (out !== null) seed(out.seedAt, out.seedWords);
    const onState = runAt(onCode, mkRegs(onCode), opts.budget);
    const onMem = out === null ? null : readBack(out.readAt, outWords);
    assert.strictEqual(e.test_tree_matches(), matchesOff + 1,
      `${name}: the gate-on arm lowers a fresh block`);
    assert(e.test_tree_runs() > runsBefore, `${name}: the lowered super-op executes`);

    if (process.env.TREE_FOLD_DEBUG) {
      console.log(`[dbg] ${name}: runs=${e.test_tree_runs() - runsBefore}`,
        `iters=${e.test_tree_iters()}`, `ops=${e.test_tree_ops()}`,
        `nuops=${e.test_tree_nuops()}`,
        `live_out=0x${e.test_tree_live_out().toString(16)}`);
    }
    assert.deepStrictEqual(onState, offState,
      `${name}: registers and every flag field survive the fold`);
    if (out !== null) {
      assert.deepStrictEqual(onMem, offMem, `${name}: memory effects are identical`);
      assert(offMem.some(v => v !== 0), `${name}: the loop actually wrote something`);
    }
    return { offState, onState };
  }

  const TRIPS = 300;
  const dstA = (arena + 0x1000) >>> 0;
  checkShape('shape A (quake2 span interleave)', SHAPE_A,
    () => ({ eax: 0, ecx: TRIPS, edx: 0x00081234, ebx: 0x00030007,
             ebp: 0xa5a5a5a5, esi: 0, edi: dstA }),
    { seedAt: dstA, seedWords: TRIPS + 4, readAt: dstA }, TRIPS + 4);

  const srcB = (arena + 0x4000) >>> 0;
  const dstB = (arena + 0x8000) >>> 0;
  checkShape('shape B (load/imul/add/sar/store)', SHAPE_B,
    () => ({ eax: 0, ecx: TRIPS, edx: 0x11223344, ebx: 0x0000ff01,
             ebp: 0xa5a5a5a5, esi: srcB, edi: dstB }),
    { seedAt: srcB, seedWords: TRIPS + 4, readAt: dstB }, TRIPS + 4,
    { runsBefore: undefined });

  // Shape C is in-place, so seed the buffer it will rewrite and read the same
  // range back. Bound edi one word past the end so the cmp/jb terminates.
  const bufC = (arena + 0xc000) >>> 0;
  checkShape('shape C (in-place chain, cmp/jb, self-aliasing)', SHAPE_C,
    () => ({ eax: 0, ecx: 0x1111, edx: 0x0f0f0f0f, ebx: 0x22334455,
             ebp: 0xa5a5a5a5, esi: bufC, edi: (bufC + TRIPS * 4) >>> 0 }),
    { seedAt: bufC, seedWords: TRIPS + 4, readAt: bufC }, TRIPS + 4);

  // -------------------------------------------------------------- side exit --
  // Same shape, same inputs, but a block budget far below the trip count, so
  // the super-op is forced to materialize everything and be re-entered many
  // times. If the exit path forgot a register or a flag field, the state would
  // diverge from the single-call arm; if the resume were wrong, the memory
  // would.
  {
    const oneShot = install(SHAPE_A);
    const chopped = install(SHAPE_A);
    const regs = () => ({ eax: 0, ecx: TRIPS, edx: 0x00081234, ebx: 0x00030007,
                          ebp: 0xa5a5a5a5, esi: 0, edi: dstA });
    e.set_tree_fold(1);
    seed(dstA, TRIPS + 4);
    const whole = runAt(oneShot, regs());
    const wholeMem = readBack(dstA, TRIPS + 4);
    const runsBefore = e.test_tree_runs();
    seed(dstA, TRIPS + 4);
    const pieces = runAt(chopped, regs(), 7);
    assert.deepStrictEqual(pieces, whole,
      'side exit and resume leave the same architectural state');
    assert.deepStrictEqual(readBack(dstA, TRIPS + 4), wholeMem,
      'side exit and resume leave the same memory');
    assert(e.test_tree_runs() > runsBefore + 1,
      'the chopped arm really did re-enter the super-op more than once');
  }

  // --------------------------------------------------------------- pacing ---
  // The fold must not change how much guest work a host batch buys, or a
  // frame captured at a fixed batch number lands somewhere else. `ops` is the
  // guest-op count the fold billed; it has to equal the block's op count times
  // the iterations it ran, which is what the unfolded loop would have spent.
  {
    const before = e.test_tree_ops();
    const code = install(SHAPE_B);
    e.set_tree_fold(1);
    const itersBefore = e.test_tree_iters();
    runAt(code, { eax: 0, ecx: 64, edx: 0, ebx: 1, ebp: 0, esi: srcB, edi: dstB });
    const iters = e.test_tree_iters() - itersBefore;
    assert.strictEqual(iters, 64n, 'every guest iteration is accounted for');
    // SHAPE_B is 7 interior ops + dec + jnz = 9 emitted ops per iteration.
    assert.strictEqual(e.test_tree_ops() - before, 64n * 9n,
      'billed guest ops equal iterations x the unfolded block cost');
  }

  // ------------------------------------------------------------- negatives ---
  function checkDecline(name, code) {
    const before = e.test_tree_matches();
    const runsBefore = e.test_tree_runs();
    e.set_tree_fold(1);
    const ga = install(code);
    runAt(ga, { eax: 0, ecx: 8, edx: 0x1000, ebx: 4, ebp: 0, esi: srcB, edi: dstB });
    assert.strictEqual(e.test_tree_matches(), before,
      `${name}: the predicate declines outright`);
    assert.strictEqual(e.test_tree_runs(), runsBefore,
      `${name}: nothing is lowered, so no super-op runs`);
  }
  checkDecline('partial-register write (mov al,[esi])', NEG_PARTIAL);
  checkDecline('interior flag consumer (adc)', NEG_ADC);
  checkDecline('body under the minimum-op floor', NEG_SHORT);

  // The floor is a knob, not a law: the same block that declined above is
  // accepted once the floor drops to three, which proves the decline was the
  // floor and not an unrecognized op.
  {
    const before = e.test_tree_matches();
    e.set_tree_fold_min_ops(3);
    const ga = install(NEG_SHORT);
    e.set_tree_fold(1);
    runAt(ga, { eax: 0, ecx: 8, edx: 0x1000, ebx: 4, ebp: 0, esi: srcB, edi: dstB });
    assert.strictEqual(e.test_tree_matches(), before + 1,
      'lowering the floor accepts the short body');
    e.set_tree_fold_min_ops(4);
  }

  console.log('TREE_FOLD tests passed:',
    e.test_tree_matches(), 'blocks matched,',
    e.test_tree_runs(), 'super-op runs,',
    String(e.test_tree_iters()), 'guest iterations,',
    String(e.test_tree_ops()), 'guest ops replaced');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
