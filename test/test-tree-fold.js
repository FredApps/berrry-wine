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
  (func (export "test_tree_deadflag") (result i32) (global.get $tree_fold_dead_flag_ops))
  (func (export "test_tree_nuops") (result i32) (global.get $tree_fold_last_nuops))
  (func (export "test_tree_live_out") (result i32) (global.get $tree_fold_last_live_out))
  (func (export "test_tree_cf") (result i32) (call $get_cf))
  (func (export "test_tree_zf") (result i32) (call $get_zf))
  (func (export "test_tree_sf") (result i32) (call $get_sf))
  (func (export "test_tree_of") (result i32) (call $get_of))
  (func (export "test_tree_pf") (result i32) (call $get_pf))
  (func (export "test_fpu_sw") (result i32) (global.get $fpu_sw))
  (func (export "test_fpu_sw_clear") (global.set $fpu_sw (i32.const 0)))
  (func (export "test_tree_decl_x87") (result i32) (global.get $tree_decl_x87))
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

// -- D: SIB load / SIB store, plus a LEA through the same index --------------
// [esi+ecx*4] and [edi+ecx*4] are the H389/H420 pair, and `lea edx,[edi+ecx*4]`
// is H148 over the same base+index+scale. All three take their effective
// address from a register the loop itself is advancing, which is what makes
// this different from the base+disp forms already covered: the EA is not a
// decode-time constant plus one register, it is two registers and a shift.
// The store's own extra step charge (H420 bills one) is what the pacing case
// below checks, since getting it wrong changes how much guest work a batch
// buys without changing a single result.
const SHAPE_D = loopBackDec([
  0x8B, 0x04, 0x8E,                   // mov  eax, [esi+ecx*4]
  0x8D, 0x14, 0x8F,                   // lea  edx, [edi+ecx*4]
  0x35, 0x78, 0x56, 0x34, 0x12,       // xor  eax, 0x12345678
  0x01, 0xD8,                         // add  eax, ebx
  0x89, 0x04, 0x8F,                   // mov  [edi+ecx*4], eax
]);

// -- E: absolute-address load and store --------------------------------------
// H20/H21. The decoder resolves [0xADDR] at decode time, so these carry no
// base register at all -- the case where a fold that assumed every memory op
// had one would read register 0 and quietly compute from the wrong address.
function shapeE(absA, absB) {
  const le = v => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  return loopBackDec([
    0xA1, ...le(absA),                // mov  eax, [absA]
    0x01, 0xD8,                       // add  eax, ebx
    0x31, 0xD0,                       // xor  eax, edx
    0xA3, ...le(absB),                // mov  [absB], eax
    0x8B, 0x15, ...le(absB),          // mov  edx, [absB]
  ]);
}

// -- F: the byte LUT loop ----------------------------------------------------
// A partial-register write used to decline the whole block; it is now an
// extract and an insert on the container's local. This is the shape the
// widening exists for -- ref_soft's inner loops are byte loads, byte ALU and
// byte stores -- and it deliberately touches BOTH lanes of one register:
// AL is loaded, AH is combined into it, and the untouched upper 16 bits of
// EAX must come out of the loop exactly as they went in. A fold that kept
// only 8 or only 16 bits of the container would pass every value check here
// and still fail that one.
const SHAPE_F = loopBackDec([
  0x8A, 0x06,                         // mov  al, [esi]
  0x30, 0xE0,                         // xor  al, ah
  0x04, 0x11,                         // add  al, 0x11
  0x88, 0x07,                         // mov  [edi], al
  0x8A, 0x66, 0x01,                   // mov  ah, [esi+1]
  0x83, 0xC6, 0x02,                   // add  esi, 2
  0x46,                               // inc  esi
  0x83, 0xC7, 0x01,                   // add  edi, 1
]);

// -- G: widening loads and a word register -----------------------------------
// MOVZX/MOVSX write the WHOLE destination from a narrow read, so they are the
// opposite case from shape F: no lane on the write, a lane on nothing. The
// `add ax,imm16` in the middle is the 16-bit half of the same widening, where
// the mask is 0xFFFF and flag_sign_shift is 15 rather than 7 -- the field a
// hand-written arm forgets.
const SHAPE_G = loopBackDec([
  0x0F, 0xB6, 0x06,                   // movzx eax, byte [esi]
  0x0F, 0xBE, 0x5E, 0x01,             // movsx ebx, byte [esi+1]
  0x66, 0x05, 0x34, 0x12,             // add   ax, 0x1234
  0x01, 0xD8,                         // add   eax, ebx
  0x89, 0x07,                         // mov   [edi], eax
  0x83, 0xC6, 0x02,                   // add   esi, 2
  0x83, 0xC7, 0x04,                   // add   edi, 4
]);

// -- H: the per-FIELD flag rule's own shape -----------------------------------
// `add eax,ebx` writes all five lazy-flag fields; `xor edx,eax` two ops later
// writes only flag_op, flag_res and flag_sign_shift. A "the last op to touch
// flags wins" rule would call the `add` dead and drop it -- and the terminator
// is `dec ecx`, whose $set_flags_dec snapshots CF, and $get_cf reads flag_a
// and flag_b to compute it. Those two fields would then hold whatever the
// PREVIOUS iteration left, so ZF/SF would still agree, the loop would still
// terminate, and only CF would be wrong. The per-field join is what makes both
// writes survive here, and `esi` advances by LEA rather than ADD precisely so
// that nothing later in the body covers flag_a/flag_b by accident.
const SHAPE_H = loopBackDec([
  0x8B, 0x06,                         // mov  eax, [esi]
  0x01, 0xD8,                         // add  eax, ebx      writes all five
  0x31, 0xC2,                         // xor  edx, eax      writes a strict subset
  0x89, 0x07,                         // mov  [edi], eax
  0x8D, 0x76, 0x04,                   // lea  esi, [esi+4]  no flags at all
  0x8D, 0x7F, 0x04,                   // lea  edi, [edi+4]  nor this one
]);

// -- I: mw3's spill suffix ----------------------------------------------------
// The flag producer is not the op before the Jcc. mw3's 16-bit alpha blend at
// 0x526f54 ends `dec edi / mov [esp+8],edx / mov [esp+c],edi / jnz`, and the
// second of those stores the counter the DEC just wrote. So this is not only
// the shape that used to decline as `terminator`, it is the shape that catches
// a fold which "fixes" the problem by hoisting the suffix above the counter:
// the stored value would then be one too high, and the memory comparison here
// is what says so.
function loopDecThenSuffix(body, suffix) {
  const all = body.concat([0x49]).concat(suffix);   // dec ecx, then the suffix
  return all.concat([0x75, (-(all.length + 2)) & 0xff, 0xc3]);
}
const SHAPE_I = loopDecThenSuffix([
  0x8B, 0x06,                         // mov  eax, [esi]
  0x01, 0xD8,                         // add  eax, ebx
  0x89, 0x07,                         // mov  [edi], eax
  0x83, 0xC6, 0x04,                   // add  esi, 4
  0x83, 0xC7, 0x04,                   // add  edi, 4
], [
  0x89, 0x44, 0x24, 0x08,             // mov  [esp+8], eax
  0x89, 0x4C, 0x24, 0x0C,             // mov  [esp+0xc], ecx   <-- post-DEC value
]);

// -- J: 16-bit memory, the three forms mw3's alpha blend is built from --------
// H166 `mov dx,[esi]`, H165 `mov [edi],dx` and H164 `mov bx,[abs]`. A 16-bit
// register is the low half of its container with no high lane, so the thing to
// get wrong is the OTHER half: each of these must leave bits 16..31 of the
// destination exactly as it found them, which is why ebx and edx are seeded
// with a high pattern nothing in the body touches.
function shapeJ(absAddr) {
  return loopBackDec([
    0x66, 0x8B, 0x16,                 // mov dx, [esi]
    0x66, 0x01, 0xC2,                 // add dx, ax
    0x66, 0x89, 0x17,                 // mov [edi], dx
    0x66, 0x8B, 0x1D,                 // mov bx, [abs]
    absAddr & 0xff, (absAddr >>> 8) & 0xff,
    (absAddr >>> 16) & 0xff, (absAddr >>> 24) & 0xff,
    0x83, 0xC6, 0x02,                 // add esi, 2
    0x83, 0xC7, 0x02,                 // add edi, 2
  ]);
}

// -- K/L: interior flag CONSUMERS, which used to be the family's negatives ----
// ADC reads CF, and the tree's licence used to be "nothing between the ops
// looks at the flags the ops leave behind". That was stronger than necessary:
// the tree keeps the lazy-flag globals current wherever a reader exists, so a
// consumer reads exactly what the scalar sequence would have left. Both of
// these are now positives, and what makes them worth testing rather than
// assuming is the CF fix-up inside ADC/SBB -- when `b + cf` wraps, carry out
// is 1 regardless of the sum, and the handler writes flag_op/a/b raw to say so.
//
// The ordering here is the test, and getting it wrong the first time is how
// it earned its comment. A consumer BEFORE the writers proves nothing: it
// reads the previous iteration's flags, so eliding a later write is correct
// and the elision count is legitimately nonzero. The consumer has to sit
// AFTER a full five-field writer, under a `cmp` terminator (which writes all
// five and reads none, so `covered` is full on entry to the backward walk) and
// with flag-transparent LEAs for the cursor bumps. Then the `add eax,ebx` is
// elidable on every rule EXCEPT the one that says the `adc` reads CF -- which
// is exactly the mutation to check.
const SHAPE_K = loopBackJcc([
  0x8B, 0x06,                         // mov  eax, [esi]
  0x01, 0xD8,                         // add  eax, ebx       writes all five
  0x11, 0xC2,                         // adc  edx, eax       <-- consumer, AFTER it
  0x89, 0x17,                         // mov  [edi], edx
  0x8D, 0x76, 0x04,                   // lea  esi, [esi+4]   no flags
  0x8D, 0x7F, 0x04,                   // lea  edi, [edi+4]   nor this
  0x3B, 0xF1,                         // cmp  esi, ecx
], 0x72);                             // jb
// The byte twin, which goes through $do_alu_sized's own ADC arm rather than
// the 32-bit kind -- a different code path for the same question.
//
// `xor ebp,ebp` in front is not decoration. These are the first shapes whose
// RESULT depends on the CF at loop entry, and checkShape runs its two arms
// back to back, so the gate-on arm inherits the flags the gate-off arm left.
// Without a normalizer the two arms legitimately disagree in the first
// iteration's low byte, which reads exactly like a broken carry chain. The
// xor is outside the array loopBackDec closes, so the back edge still lands on
// `mov al,[esi]` and the carry chain across iterations is untouched.
const SHAPE_L = [0x31, 0xED].concat(loopBackDec([
  0x8A, 0x06,                         // mov  al, [esi]
  0x12, 0xC3,                         // adc  al, bl         <-- flag consumer
  0x88, 0x07,                         // mov  [edi], al
  0x46,                               // inc  esi
  0x47,                               // inc  edi
]));
// The SBB pair, whose fix-up touches flag_a/flag_b and NOT flag_op -- the one
// asymmetry between the two that a shared arm would have flattened.
const SHAPE_M = [0x31, 0xED].concat(loopBackDec([
  0x8B, 0x06,                         // mov  eax, [esi]
  0x19, 0xD8,                         // sbb  eax, ebx       <-- flag consumer
  0x1D, 0x11, 0x22, 0x33, 0x44,       // sbb  eax, 0x44332211
  0x89, 0x07,                         // mov  [edi], eax
  0x83, 0xC6, 0x04,                   // add  esi, 4
  0x83, 0xC7, 0x04,                   // add  edi, 4
]));

// -- N: the H149 EA pair, through a 16-bit SIB load --------------------------
// `mov dx,[esi+ecx*2]` has no fused opcode, so the decoder emits the generic
// pair: H149 computes the address into $ea_temp and H164 consumes it through
// $read_addr, which recognizes $SIB_SENTINEL in its address word. That is a
// cross-op dataflow, and it is what made H149 the family's `lastFn` decline on
// mw3. The index is ECX, the loop counter itself, so the address is a function
// of state the fold holds in a LOCAL -- a fold that computed the EA once, or
// read the sentinel as if it were an address (0xEADEAD is a perfectly
// plausible one), would load the same wrong word every iteration and the
// differential below is what says so.
const SHAPE_N = loopBackDec([
  0x66, 0x8B, 0x14, 0x4E,             // mov dx, [esi+ecx*2]   H149 + H164(sent)
  0x66, 0x01, 0xC2,                   // add dx, ax
  0x66, 0x89, 0x17,                   // mov [edi], dx
  0x83, 0xC7, 0x02,                   // add edi, 2
]);

// -- O: H149's own fused byte load -------------------------------------------
// With bit 8 of its operand set, H149 performs the load itself rather than
// leaving it to the next handler, so this form is one micro-op with a
// partial-register write and no partner at all. AH is the other lane of the
// same container the load writes, which is the case a fold that treated the
// fused destination as a whole register would get wrong.
const SHAPE_O = loopBackDec([
  0x8A, 0x04, 0x0E,                   // mov al, [esi+ecx*1]   H149 fused
  0x30, 0xE0,                         // xor al, ah
  0x88, 0x07,                         // mov [edi], al
  0x83, 0xC7, 0x01,                   // add edi, 1
]);

// Close a body with `dec <reg> / jnz body`, for the shapes whose counter
// cannot be ECX because a REP op owns it.
function loopBackDecReg(body, decOpcode) {
  const withDec = body.concat([decOpcode]);
  return withDec.concat([0x75, (-(withDec.length + 2)) & 0xff, 0xc3]);
}

// -- P: a REP MOVSD inside an otherwise ordinary integer loop ------------------
// The blitter shape: reload the run length, copy the run, advance the cursors
// past a gap, count down. H83 was quake2's residual `lastFn` decline and mw3's
// after the H149 pair landed. ECX is reloaded every iteration precisely
// because the REP consumes it -- which is also the thing a fold that kept ECX
// in a local and never published it would get wrong, since $rep_movsd_do reads
// the GLOBAL.
const SHAPE_P = loopBackDecReg([
  0x8B, 0xCD,                         // mov ecx, ebp        (run length)
  0xF3, 0xA5,                         // rep movsd           H83
  0x83, 0xC2, 0x01,                   // add edx, 1
  0x31, 0xD0,                         // xor eax, edx
  0x83, 0xC7, 0x04,                   // add edi, 4          (gap in dst)
], 0x4B /* dec ebx */);

// -- Q: REP STOSB, whose fill byte is AL and therefore changes every trip ------
// The fill value is read from the EAX global inside the handler, so this fails
// loudly if the publish is narrowed to "the registers a movs touches".
const SHAPE_Q = loopBackDecReg([
  0x8B, 0xCD,                         // mov ecx, ebp
  0xF3, 0xAA,                         // rep stosb           H84
  0x83, 0xC0, 0x11,                   // add eax, 0x11       (next fill byte)
  0x83, 0xC7, 0x02,                   // add edi, 2
  0x89, 0xD6,                         // mov esi, edx
], 0x4B /* dec ebx */);

// -- R: the same copy with DF set ---------------------------------------------
// STD is outside the loop, so the body the back edge re-enters is a self-loop
// block with DF already 1 and the copy running downward. Nothing in the
// descriptor models DF; the arm calls the interpreter's body, which reads the
// $df global, and this is the assertion that it still does.
const bodyR = [
  0x8B, 0xCD,                         // mov ecx, ebp
  0xF3, 0xA5,                         // rep movsd           (backward)
  0x83, 0xC2, 0x01,                   // add edx, 1
  0x31, 0xD0,                         // xor eax, edx
  0x83, 0xEF, 0x04,                   // sub edi, 4
  0x4B,                               // dec ebx
];
const SHAPE_R = [0xFD].concat(bodyR,
  [0x75, (-(bodyR.length + 2)) & 0xff, 0xFC, 0xC3]);

// -- S: the bound lives in memory ---------------------------------------------
// `cmp eax,[esi+disp] / jl` -- mw3's 0x0042d9b1, the hottest block in the
// terminator decline bucket. The bound is re-read every iteration, and this
// shape writes it FROM THE BODY on the last trip, so a fold that hoisted the
// load out of the loop would run one iteration too many and a fold that
// cached it would never stop. That is what makes this a differential rather
// than a smoke test.
//
// The bound at [ebx+0x10] is element 4 of the very array the body rewrites,
// so the trip count is decided in the middle of the run: the store at eax==4
// raises it from 20 to 23 and the loop runs three iterations further than its
// entry state said it would.
const SHAPE_S = loopBackJcc([
  0x8B, 0x14, 0x86,                     // mov edx, [esi+eax*4]   H389
  0x01, 0xFA,                           // add edx, edi
  0x89, 0x14, 0x86,                     // mov [esi+eax*4], edx   H420
  0x83, 0xC0, 0x01,                     // add eax, 1
  0x3B, 0x43, 0x10,                     // cmp eax, [ebx+0x10]    H128 alu=7
], 0x7C /* jl */);

// -- mixed integer + x87 --------------------------------------------------
// quake2's ref_soft scales a float span while stepping two integer pointers,
// and until the x87 micro-ops existed the whole block declined on the first
// `fld`. The x87 half runs through the SAME $fpu_exec_mem/$fpu_exec_reg the
// unfolded handlers call, so what these cases actually prove is that the
// INTEGER side of the fold -- registers in locals, the SIB/base EA hoist, the
// dead-flag pass -- did not perturb the x87 machine.
//
// MIX1: load / scale / store per iteration, both streams stepped by 4.
const SHAPE_MIX1 = loopBackDec([
  0xD9, 0x06,                         // fld   dword [esi]
  0xD8, 0x0F,                         // fmul  dword [edi]
  0xD9, 0x1F,                         // fstp  dword [edi]
  0x83, 0xC6, 0x04,                   // add   esi, 4
  0x83, 0xC7, 0x04,                   // add   edi, 4
]);

// MIX2: the same shape with a divide, run over a divisor buffer of zeros. The
// status word is STICKY, so a fold that dropped or reordered the divide would
// leave ZE down -- and one that ran it twice would still read ZE, which is why
// the stored quotients are compared as well.
const SHAPE_MIX2 = loopBackDec([
  0xD9, 0x06,                         // fld   dword [esi]
  0xD8, 0x37,                         // fdiv  dword [edi]
  0xD9, 0x1F,                         // fstp  dword [edi]
  0x83, 0xC6, 0x04,                   // add   esi, 4
  0x83, 0xC7, 0x04,                   // add   edi, 4
]);

// MIX3: a register-form body -- fld st(0) / fmul st,st(1) / faddp is quake2
// 0x00d7fb2f's shape -- plus an fxch, which is the op that makes any "keep
// ST(0) in a local" scheme wrong. Closed by cmp/jb on the pointer.
const SHAPE_MIX3 = loopBackJcc([
  0xD9, 0x06,                         // fld   dword [esi]
  0xD9, 0xC0,                         // fld   st(0)
  0xD8, 0xC9,                         // fmul  st, st(1)
  0xD9, 0xC9,                         // fxch  st(1)
  0xDE, 0xC1,                         // faddp st(1), st
  0xD9, 0x1F,                         // fstp  dword [edi]
  0x83, 0xC6, 0x04,                   // add   esi, 4
  0x83, 0xC7, 0x04,                   // add   edi, 4
  0x39, 0xDE,                         // cmp   esi, ebx
], 0x72 /* jb */);

// A negative: FNSTSW AX is folded, but FCOMI writes EFLAGS from inside the FPU
// and the descriptor's per-field dead-flag pass cannot see that, so it must
// decline by name rather than fold and lose the comparison.
const NEG_X87_FCOMI = loopBackDec([
  0xD9, 0x06,                         // fld   dword [esi]
  0xDB, 0xF1,                         // fcomi st, st(1)
  0xDD, 0xD8,                         // fstp  st(0)
  0x83, 0xC6, 0x04,                   // add   esi, 4
  0x83, 0xC7, 0x04,                   // add   edi, 4
]);

// -- negatives ----------------------------------------------------------------
// The accepted range is exactly H82..H85. REP CMPSB (H92) is a string op too,
// and it writes the lazy-flag fields from inside a helper the descriptor's
// per-field dead-flag pass knows nothing about, so it must stay out.
const NEG_REP_CMPS = loopBackDecReg([
  0xF3, 0xA6,                         // rep cmpsb           H92
  0x83, 0xC2, 0x01,                   // add edx, 1
  0x83, 0xC7, 0x04,                   // add edi, 4
  0x83, 0xC6, 0x04,                   // add esi, 4
], 0x4B /* dec ebx */);

// A SIB 16-bit STORE is H149 + H163, and H163 is not a micro-op. So the EA
// producer is present and its consumer is not, which is the exact shape the
// pairing walk exists to refuse: folding the H149 alone would leave a computed
// address nothing in the descriptor reads, and the store would run unfolded
// against a $ea_temp the fold never wrote.
const NEG_EA_UNPAIRED = loopBackDec([
  0x66, 0x89, 0x14, 0x4E,             // mov [esi+ecx*2], dx   H149 + H163
  0x66, 0x01, 0xC2,                   // add dx, ax
  0x83, 0xC7, 0x02,                   // add edi, 2
  0x83, 0xC6, 0x02,                   // add esi, 2
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
      // The x87 status word is part of the answer, not a detail: its exception
      // bits are sticky, so a fold that skipped, doubled or reordered an x87
      // op shows up here even when the stored result happens to match.
      fpuSw: e.test_fpu_sw(),
    };
  }

  // budget=null runs to completion in one call. A small budget forces the fold
  // to hand control back mid-loop and be re-entered, which is the side-exit
  // path -- and the assertion is that the answer does not change.
  function runAt(code, regs, budget) {
    e.test_fpu_sw_clear();
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
    // A float body needs float bytes: the default seed's hash words are
    // denormals, which is legal but makes every arm raise the same pile of
    // flags and hides the one the case is about.
    const doSeed = opts.seedFn || seed;
    if (out !== null) doSeed(out.seedAt, out.seedWords);
    const offState = runAt(offCode, mkRegs(offCode), opts.budget);
    const offMem = out === null ? null : readBack(out.readAt, outWords);
    const matchesOff = e.test_tree_matches();
    assert.strictEqual(matchesOff, matchesBefore + 1,
      `${name}: the predicate recognizes the block even with the gate off`);
    const runsBefore = e.test_tree_runs();
    assert.strictEqual(runsBefore, runsAtEntry,
      `${name}: the gate-off arm executes no super-op`);

    e.set_tree_fold(1);
    if (out !== null) doSeed(out.seedAt, out.seedWords);
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
  //
  // It is also the best case for the dead-flag pass, and the count is exact
  // rather than "> 0": a cmp terminator writes all five fields and reads none,
  // so every interior flag write in the body is dead. The body has three --
  // `xor eax,edx`, `add eax,0x1234` and `add esi,4`; `not eax` and the two
  // memory ops touch no flags at all. Counted once, not twice: the gate-off
  // arm returns after bumping `matches` and never reaches the pass.
  const bufC = (arena + 0xc000) >>> 0;
  {
    const deadBefore = e.test_tree_deadflag();
    checkShape('shape C (in-place chain, cmp/jb, self-aliasing)', SHAPE_C,
      () => ({ eax: 0, ecx: 0x1111, edx: 0x0f0f0f0f, ebx: 0x22334455,
               ebp: 0xa5a5a5a5, esi: bufC, edi: (bufC + TRIPS * 4) >>> 0 }),
      { seedAt: bufC, seedWords: TRIPS + 4, readAt: bufC }, TRIPS + 4);
    assert.strictEqual(e.test_tree_deadflag() - deadBefore, 3,
      'shape C: a cmp terminator makes all three interior flag writes dead');
  }

  // Shape D indexes both streams with the loop counter itself, so ecx is the
  // induction variable, the SIB index and the terminator's operand at once.
  const srcD = (arena + 0x10000) >>> 0;
  const dstD = (arena + 0x14000) >>> 0;
  checkShape('shape D (SIB load/store + LEA through the index)', SHAPE_D,
    () => ({ eax: 0, ecx: TRIPS, edx: 0, ebx: 0x0a0b0c0d,
             ebp: 0xa5a5a5a5, esi: srcD, edi: dstD }),
    { seedAt: srcD, seedWords: TRIPS + 4, readAt: dstD }, TRIPS + 4);

  // Shape E's two absolute cells are read and written every iteration, and the
  // second load reads back the cell the store just wrote -- the abs twin of
  // shape C's aliasing proof, one where nothing about the address comes from a
  // register at all.
  const absA = (arena + 0x18000) >>> 0;
  const absB = (arena + 0x18004) >>> 0;
  checkShape('shape E (absolute load/store, self-aliasing)', shapeE(absA, absB),
    () => ({ eax: 0, ecx: TRIPS, edx: 0x76543210, ebx: 0x00112233,
             ebp: 0xa5a5a5a5, esi: 0, edi: 0 }),
    { seedAt: absA, seedWords: 2, readAt: absA }, 2);

  // Shape F is the byte LUT loop the widening exists for. EAX enters with a
  // recognizable value in its upper 16 bits and only AL and AH are ever
  // written, so the check that matters is not just "the bytes agree" but that
  // bits 16..31 of EAX came out untouched -- and `deepStrictEqual` on the
  // whole register file is what says so.
  const srcF = (arena + 0x1c000) >>> 0;
  const dstF = (arena + 0x1e000) >>> 0;
  {
    const { onState } = checkShape('shape F (byte LUT, both lanes of EAX)', SHAPE_F,
      () => ({ eax: 0xdead0000, ecx: 100, edx: 0, ebx: 0,
               ebp: 0xa5a5a5a5, esi: srcF, edi: dstF }),
      { seedAt: srcF, seedWords: 200, readAt: dstF }, 64);
    assert.strictEqual(onState.eax >>> 16, 0xdead,
      'shape F: the lanes the byte ops never touched are unchanged');
  }

  // Shape G: narrow reads that write the whole destination (MOVZX/MOVSX), plus
  // one true 16-bit ALU op, whose mask is 0xFFFF and whose flag_sign_shift is
  // 15. EBP again carries a value nothing in the loop writes, as the live-out
  // mask's negative control.
  const srcG = (arena + 0x20000) >>> 0;
  const dstG = (arena + 0x24000) >>> 0;
  {
    const { onState } = checkShape('shape G (movzx/movsx + 16-bit ALU)', SHAPE_G,
      () => ({ eax: 0, ecx: 100, edx: 0, ebx: 0,
               ebp: 0xa5a5a5a5, esi: srcG, edi: dstG }),
      { seedAt: srcG, seedWords: 200, readAt: dstG }, 100);
    assert.strictEqual(onState.ebp >>> 0, 0xa5a5a5a5,
      'shape G: a register outside the live-out mask is not republished');
  }

  // Shape H is the pass's negative control, and the assertion is zero. A
  // "last flag writer wins" rule would elide the `add eax,ebx` here because a
  // later `xor` touches flags at all; the per-field rule keeps it, because the
  // xor writes a strict subset and the dec terminator's CF snapshot reads the
  // fields it left alone.
  //
  // The exact count, not `> 0` or `>= 0`, and it is the only guard that works
  // here. Seeding the pass with "the terminator covers everything" -- the
  // last-writer rule -- was tried against this file: the count went to 2 and
  // this assertion fired, while the register/flag comparison in checkShape
  // PASSED. A dropped CF write does not change any register, does not change
  // where the loop exits, and only shows up if the stale CF and the correct
  // one happen to differ at the final iteration, which for one set of inputs
  // they did not. So the flag join is checked structurally, by counting what
  // the pass removed, and the differential is the backstop rather than the
  // other way round.
  const srcH = (arena + 0x28000) >>> 0;
  const dstH = (arena + 0x2c000) >>> 0;
  {
    const deadBefore = e.test_tree_deadflag();
    checkShape('shape H (per-field flag join, subset writer)', SHAPE_H,
      () => ({ eax: 0, ecx: 100, edx: 0x5a5a5a5a, ebx: 0x0f1e2d3c,
               ebp: 0xa5a5a5a5, esi: srcH, edi: dstH }),
      { seedAt: srcH, seedWords: 200, readAt: dstH }, 100);
    assert.strictEqual(e.test_tree_deadflag() - deadBefore, 0,
      'shape H: a later subset writer does not make the full writer dead');
  }

  // Shape I reads back the two STACK slots, not the [edi] stream: the stream
  // would agree even if the suffix were hoisted above the counter, and
  // [esp+0xc] is the only witness that says the fold ran `dec ecx` first.
  const srcI = (arena + 0x30000) >>> 0;
  const dstI = (arena + 0x34000) >>> 0;
  checkShape('shape I (flag-transparent suffix after the counter)', SHAPE_I,
    () => ({ eax: 0, ecx: 100, edx: 0x13572468, ebx: 0x0000cafe,
             ebp: 0xa5a5a5a5, esi: srcI, edi: dstI }),
    { seedAt: (stack + 8) >>> 0, seedWords: 2, readAt: (stack + 8) >>> 0 }, 2);

  const srcJ = (arena + 0x38000) >>> 0;
  const dstJ = (arena + 0x3c000) >>> 0;
  const absJ = (arena + 0x3f000) >>> 0;
  seed(absJ, 4);
  checkShape('shape J (16-bit memory: ro load, ro store, absolute load)',
    shapeJ(absJ),
    () => ({ eax: 0x0000abcd, ecx: 100, edx: 0xdead0000, ebx: 0xbeef0000,
             ebp: 0xa5a5a5a5, esi: srcJ, edi: dstJ }),
    { seedAt: srcJ, seedWords: 200, readAt: dstJ }, 50);

  // Interior flag consumers. Each asserts zero elisions as well as agreeing
  // with the per-op arm: a consumer that the dead-flag pass did not recognize
  // as a reader would let an earlier write go, and the difference is CF only,
  // which the register/flag comparison alone has already been shown to miss.
  const srcK = (arena + 0x40000) >>> 0;
  const dstK = (arena + 0x44000) >>> 0;
  {
    const deadBefore = e.test_tree_deadflag();
    checkShape('shape K (interior adc, after a full flag writer)', SHAPE_K,
      () => ({ eax: 0, ecx: (srcK + 100 * 4) >>> 0, edx: 0xfffffff0,
               ebx: 0x00000037,
               ebp: 0xa5a5a5a5, esi: srcK, edi: dstK }),
      { seedAt: srcK, seedWords: 120, readAt: dstK }, 100);
    assert.strictEqual(e.test_tree_deadflag() - deadBefore, 0,
      'shape K: an interior CF consumer keeps every earlier flag write alive');
  }
  const srcL = (arena + 0x48000) >>> 0;
  const dstL = (arena + 0x4c000) >>> 0;
  checkShape('shape L (interior adc al,bl, byte width)', SHAPE_L,
    () => ({ eax: 0, ecx: 100, edx: 0x5a5a5a5a, ebx: 0x000000e1,
             ebp: 0xa5a5a5a5, esi: srcL, edi: dstL }),
    { seedAt: srcL, seedWords: 60, readAt: dstL }, 25);
  const srcM = (arena + 0x50000) >>> 0;
  const dstM = (arena + 0x54000) >>> 0;
  checkShape('shape M (interior sbb, register and immediate)', SHAPE_M,
    () => ({ eax: 0, ecx: 100, edx: 0x11111111, ebx: 0x0000ffff,
             ebp: 0xa5a5a5a5, esi: srcM, edi: dstM }),
    { seedAt: srcM, seedWords: 200, readAt: dstM }, 100);

  // Shape N's live-out mask is the precise statement that a bare EA compute
  // defines no register. Its body writes EDX (the 16-bit load and the 16-bit
  // add) and EDI (the cursor bump), plus ECX because the DEC terminator writes
  // it, and nothing else -- so the mask is 0x86. The H149 micro-op carries
  // `d = 0`, so a fold that counted it as a definition
  // would publish EAX as well and the mask would read 0x87 -- a register the
  // loop never touched, republished with the value it entered with. Harmless
  // here, wrong in general, and invisible to every value comparison.
  const srcN = (arena + 0x58000) >>> 0;
  const dstN = (arena + 0x5c000) >>> 0;
  {
    checkShape('shape N (H149 + H164 sentinel pair, index = the counter)',
      SHAPE_N,
      () => ({ eax: 0x00001357, ecx: 100, edx: 0xfeed0000, ebx: 0,
               ebp: 0xa5a5a5a5, esi: srcN, edi: dstN }),
      { seedAt: srcN, seedWords: 200, readAt: dstN }, 50);
    assert.strictEqual(e.test_tree_nuops(), 5,
      'shape N: the EA compute is a micro-op of its own');
    assert.strictEqual(e.test_tree_live_out(), 0x86,
      'shape N: the EA compute defines no register');
  }

  const srcO = (arena + 0x60000) >>> 0;
  const dstO = (arena + 0x64000) >>> 0;
  {
    const { onState } = checkShape('shape O (H149 fused byte load)', SHAPE_O,
      () => ({ eax: 0xbeef0011, ecx: 100, edx: 0, ebx: 0,
               ebp: 0xa5a5a5a5, esi: srcO, edi: dstO }),
      { seedAt: srcO, seedWords: 60, readAt: dstO }, 25);
    assert.strictEqual(onState.eax >>> 16, 0xbeef,
      'shape O: the fused load writes AL only, not the container');
  }

  // A REP string op round-trips the whole register file through the globals,
  // so its live-out mask is 0xFF and nothing narrower is defensible: which
  // registers $rep_movsd_do wrote is its business, and the arm reloads all
  // eight from the globals afterwards regardless.
  const srcP = (arena + 0x68000) >>> 0;
  const dstP = (arena + 0x6c000) >>> 0;
  {
    checkShape('shape P (REP MOVSD inside an integer loop)', SHAPE_P,
      () => ({ eax: 0, ecx: 0, edx: 0x01020304, ebx: 20,
               ebp: 4, esi: srcP, edi: dstP }),
      { seedAt: srcP, seedWords: 200, readAt: dstP }, 120);
    assert.strictEqual(e.test_tree_nuops(), 5,
      'shape P: the REP is one micro-op');
    assert.strictEqual(e.test_tree_live_out(), 0xff,
      'shape P: a REP publishes the whole register file');
  }

  const dstQ = (arena + 0x70000) >>> 0;
  checkShape('shape Q (REP STOSB, fill byte from the EAX global)', SHAPE_Q,
    () => ({ eax: 0x00000041, ecx: 0, edx: 0x5a5a5a5a, ebx: 20,
             ebp: 8, esi: 0, edi: dstQ }),
    { seedAt: dstQ, seedWords: 120, readAt: dstQ }, 60);

  // DF=1. The copy runs downward from the top of each buffer, so the window
  // that was written is the tail, not the head.
  const srcR = (arena + 0x74000) >>> 0;
  const dstR = (arena + 0x78000) >>> 0;
  checkShape('shape R (REP MOVSD with DF set)', SHAPE_R,
    () => ({ eax: 0, ecx: 0, edx: 0x11223344, ebx: 20,
             ebp: 4, esi: (srcR + 0x800) >>> 0, edi: (dstR + 0x800) >>> 0 }),
    { seedAt: srcR, seedWords: 600, readAt: (dstR + 0x600) >>> 0 }, 128);

  // Shape S needs its own A/B rather than checkShape's, because the memory it
  // depends on is not a seedable pattern: the bound has to be a small number
  // in a known slot, and checkShape's seed fills every word with a hash.
  {
    const arrS = (arena + 0x7c000) >>> 0;
    const mk = () => ({ eax: 0, ecx: 0, edx: 0, ebx: arrS,
                        ebp: 0xa5a5a5a5, esi: arrS, edi: 3 });
    const setup = () => {
      for (let i = 0; i < 64; i++) dv.setUint32(wa(arrS) + i * 4, i, true);
      dv.setUint32(wa(arrS) + 16, 20, true);   // element 4 IS the bound
    };
    const offCode = install(SHAPE_S);
    const onCode = install(SHAPE_S);

    e.set_tree_fold(0);
    const matchesBefore = e.test_tree_matches();
    setup();
    const offState = runAt(offCode, mk());
    const offMem = readBack(arrS, 64);
    assert.strictEqual(e.test_tree_matches(), matchesBefore + 1,
      'shape S: a memory-bounded terminator is recognized');
    const runsBefore = e.test_tree_runs();

    e.set_tree_fold(1);
    setup();
    const onState = runAt(onCode, mk());
    const onMem = readBack(arrS, 64);
    assert(e.test_tree_runs() > runsBefore, 'shape S: the lowered super-op executes');
    assert.deepStrictEqual(onState, offState,
      'shape S: cmp r,[base+disp] terminator leaves identical state');
    assert.deepStrictEqual(onMem, offMem, 'shape S: identical memory');
    assert.strictEqual(offState.eax, 23,
      'shape S: the body moved the bound mid-run and both arms followed it');
  }

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

  // A block whose ops charge steps on their own account. H420 (MOV dword
  // [base+index*scale+disp], r32) bills one $steps itself, on top of the one
  // $next bills for dispatching it, because it swallowed a separate SIB-EA
  // dispatch. So SHAPE_D's unfolded cost is 7 emitted ops + 1 = 8 per
  // iteration, and a fold that counted only the emitted ops would hand the
  // guest 12% more work per batch than the scalar path -- invisible in every
  // result, and visible only as a capture landing on a different frame.
  {
    const before = e.test_tree_ops();
    const itersBefore = e.test_tree_iters();
    const code = install(SHAPE_D);
    e.set_tree_fold(1);
    runAt(code, { eax: 0, ecx: 64, edx: 0, ebx: 3, ebp: 0, esi: srcD, edi: dstD });
    assert.strictEqual(e.test_tree_iters() - itersBefore, 64n,
      'SIB shape: every guest iteration is accounted for');
    assert.strictEqual(e.test_tree_ops() - before, 64n * 8n,
      'SIB shape: the H420 store\'s own step charge is in the descriptor cost');
  }

  // A REP is ONE guest op no matter how many bytes it moves -- that is what
  // the interpreter charges for it, one $next dispatch -- so the descriptor
  // cost must count it as one and not as its element count. Getting this
  // wrong is the only way this micro-op can change how far a fixed batch
  // budget gets, and it would do so by a factor of the run length.
  {
    const before = e.test_tree_ops();
    const itersBefore = e.test_tree_iters();
    const code = install(SHAPE_P);
    e.set_tree_fold(1);
    runAt(code, { eax: 0, ecx: 0, edx: 0, ebx: 20, ebp: 64, esi: srcP, edi: dstP });
    assert.strictEqual(e.test_tree_iters() - itersBefore, 20n,
      'REP shape: every guest iteration is accounted for');
    // 5 interior ops + dec + jnz = 7, with the 64-dword copy counting as one.
    assert.strictEqual(e.test_tree_ops() - before, 20n * 7n,
      'REP shape: a rep movsd is billed as one guest op, not 64');
  }

  // -------------------------------------------------- mixed integer + x87 ---
  const srcX = (arena + 0x11000) >>> 0;
  const dstX = (arena + 0x14000) >>> 0;
  const FTRIPS = 200;
  // Ordinary finite floats on both sides, so the only exception a healthy run
  // can raise is PE from a rounded product.
  const seedFloats = (dividendZero) => () => {
    for (let i = 0; i < FTRIPS + 4; i++) {
      dv.setFloat32(wa(srcX) + i * 4, 1.5 + i * 0.25, true);
      dv.setFloat32(wa(dstX) + i * 4, dividendZero ? 0 : 0.5 + (i % 7) * 0.125, true);
    }
  };

  checkShape('shape MIX1 (fld/fmul/fstp + two pointer steps)', SHAPE_MIX1,
    () => ({ eax: 0, ecx: FTRIPS, edx: 0, ebx: 0, ebp: 0, esi: srcX, edi: dstX }),
    { seedAt: dstX, seedWords: FTRIPS + 4, readAt: dstX }, FTRIPS + 4,
    { seedFn: seedFloats(false) });

  // The ZE case. Both arms must raise it, and the assertion is on the arm that
  // folded -- checked directly rather than only through the A/B, so a build
  // where NEITHER arm raised it cannot pass by agreeing.
  {
    const { onState, offState } = checkShape('shape MIX2 (fdiv by zero raises ZE)',
      SHAPE_MIX2,
      () => ({ eax: 0, ecx: FTRIPS, edx: 0, ebx: 0, ebp: 0, esi: srcX, edi: dstX }),
      { seedAt: dstX, seedWords: FTRIPS + 4, readAt: dstX }, FTRIPS + 4,
      { seedFn: seedFloats(true) });
    assert.strictEqual(offState.fpuSw & 0x04, 0x04,
      'shape MIX2: the unfolded arm raises ZE');
    assert.strictEqual(onState.fpuSw & 0x04, 0x04,
      'shape MIX2: the folded arm raises the same ZE');
    assert.strictEqual(onState.fpuSw & 0x80, 0x80,
      'shape MIX2: and sets the error summary bit with it');
  }

  // Register-form x87, including the fxch that rules out caching ST(0).
  checkShape('shape MIX3 (register-form x87 with fxch, cmp/jb close)', SHAPE_MIX3,
    () => ({ eax: 0, ecx: 0, edx: 0, ebx: (srcX + FTRIPS * 4) >>> 0,
             ebp: 0, esi: srcX, edi: dstX }),
    { seedAt: dstX, seedWords: FTRIPS + 4, readAt: dstX }, FTRIPS + 4,
    { seedFn: seedFloats(false) });

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
  checkDecline('body under the minimum-op floor', NEG_SHORT);
  checkDecline('an EA compute whose consumer is not a micro-op', NEG_EA_UNPAIRED);
  checkDecline('a REP CMPSB, which writes flags the pass cannot see', NEG_REP_CMPS);
  {
    const declBefore = e.test_tree_decl_x87();
    checkDecline('an FCOMI, which writes EFLAGS from inside the FPU', NEG_X87_FCOMI);
    assert(e.test_tree_decl_x87() > declBefore,
      'the FCOMI decline is counted under its own named reason, not generic');
  }

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

  // The ceiling is the same kind of knob, and it needs its own coverage
  // because nothing else in this file can reach it: the default is 160 and the
  // longest shape here is 9 interior ops. Squeeze it under shape A instead.
  {
    const before = e.test_tree_matches();
    e.set_tree_fold_max_ops(5);
    e.set_tree_fold(1);
    const ga = install(SHAPE_A);
    runAt(ga, { eax: 0, ecx: 8, edx: 0x1000, ebx: 4, ebp: 0, esi: srcB, edi: dstB });
    assert.strictEqual(e.test_tree_matches(), before,
      'a body over the ceiling declines');
    e.set_tree_fold_max_ops(160);
    const ga2 = install(SHAPE_A);
    runAt(ga2, { eax: 0, ecx: 8, edx: 0x1000, ebx: 4, ebp: 0, esi: srcB, edi: dstB });
    assert.strictEqual(e.test_tree_matches(), before + 1,
      'raising the ceiling accepts the same body');
  }

  // The clamp is the safety property, not a convenience: past
  // $TREE_FOLD_UOPS_LIMIT the descriptor runs off either $decode_block's
  // reserved slack or the classify scratch, and both corrupt silently instead
  // of declining -- so the setter must refuse, and a flag must not be able to
  // ask for it.
  {
    e.set_tree_fold_max_ops(100000);
    assert.strictEqual(e.get_tree_fold_max_ops(), 168,
      'the ceiling clamps to the structural limit');
    e.set_tree_fold_max_ops(160);
    assert.strictEqual(e.get_tree_fold_max_ops(), 160,
      'a value under the limit is taken as given');
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
