#!/usr/bin/env node
'use strict';

// Differential fuzzer for the H418 LUT_RUN fold.
//
//   node tools/lut-differential.js [--cases=N] [--seed=N] [--verbose] [--json]
//
// WHY THIS EXISTS
//   The LUT_RUN recognizer was generalized to admit three shapes it used to
//   decline: two independent cursors, an accumulator zeroed OUTSIDE the loop,
//   and a result register distinct from the index accumulator. A corpus census
//   says that takes the fold from 74 of 404 static LUT loops to 376. Those ~300
//   newly-admitted loops have no coverage: every whole-app A/B available to us
//   reports `bounded LUT matches 0 runs 0` in BOTH arms, so it is a null
//   control that proves nothing, and the one app that does fold (StarCraft)
//   only reaches the loop on an animated screen where the two arms cannot be
//   held in lockstep.
//
//   So this stops using apps. It injects hand-encoded x86 straight into a live
//   wasm instance -- the test/test-x86-ops.js pattern -- and A/Bs the SAME loop
//   with the fold emitter off and on, in one process, with no guest clock
//   anywhere in the loop. The comparison is exact machine state, not pixels.
//
// THE CONTRACT BEING TESTED
//   When the fold fires, it must be invisible: all eight GPRs, CF/ZF/SF/OF and
//   every byte the loop could have written must match the unfolded execution of
//   the identical loop from the identical start state.
//
//   A variant that does NOT fold is not a failure -- the recognizer is allowed
//   to be conservative. Those are counted and reported separately, because a
//   run where nothing folded is a null result and must never read as a pass.
//   The exit code is driven by mismatches, and a run that folded NOTHING fails
//   too: it means the fuzzer stopped exercising the thing it exists to test.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('../test/render-helper');

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
const has = n => argv.includes(`--${n}`);

const CASES = parseInt(opt('cases', '400'), 10);
const SEED = parseInt(opt('seed', '20260916'), 10);
const VERBOSE = has('verbose');
const JSON_OUT = has('json');

// xorshift32 -- seeded so a failure reproduces from the printed seed alone.
let rngState = SEED >>> 0 || 1;
function rnd() {
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5; rngState >>>= 0;
  return rngState;
}
const pick = arr => arr[rnd() % arr.length];
const range = (lo, hi) => lo + (rnd() % (hi - lo + 1));

// ---- x86 encoding ---------------------------------------------------------
// 32-bit register numbers. esp (4) is deliberately absent everywhere: it needs
// a SIB byte in every memory form and buys nothing here.
const R32 = { eax: 0, ecx: 1, edx: 2, ebx: 3, ebp: 5, esi: 6, edi: 7 };
// Low-byte registers, which are the only ones the accumulator gate admits.
const R8 = { al: 0, cl: 1, dl: 2, bl: 3 };
const LOW8_OF = { eax: 'al', ecx: 'cl', edx: 'dl', ebx: 'bl' };

const modrm = (mod, reg, rm) => ((mod & 3) << 6) | ((reg & 7) << 3) | (rm & 7);

// mov r8, [base] -- ebp has no mod=00 form, so it takes an explicit zero disp8.
function movR8FromMem(dstR8, baseR32) {
  const rm = R32[baseR32];
  return baseR32 === 'ebp'
    ? [0x8a, modrm(1, R8[dstR8], rm), 0x00]
    : [0x8a, modrm(0, R8[dstR8], rm)];
}
// mov r8, [base + disp8] -- the reach-back load of the in-place form
function movR8FromMemDisp8(dstR8, baseR32, disp8) {
  return [0x8a, modrm(1, R8[dstR8], R32[baseR32]), disp8 & 0xff];
}
// mov r8, [base + index] -- the register-indexed table load, Heroes' `mov al,[eax+ecx]`.
// Needs a SIB byte: mod=00 rm=100, then scale=0, the given index and base.
function movR8FromMemSIB(dstR8, baseR32, indexR32) {
  return [0x8a, modrm(0, R8[dstR8], 4),
    ((0 & 3) << 6) | ((R32[indexR32] & 7) << 3) | (R32[baseR32] & 7)];
}
// mov r8, [base + disp32] -- the table load, StarCraft's `mov bl,[eax+0x4e8701]`
function movR8FromMemDisp32(dstR8, baseR32, disp32) {
  const d = disp32 >>> 0;
  return [0x8a, modrm(2, R8[dstR8], R32[baseR32]),
    d & 0xff, (d >>> 8) & 0xff, (d >>> 16) & 0xff, (d >>> 24) & 0xff];
}
// mov [base + disp8], r8 -- the store, StarCraft's `mov [edi-1],bl`
function movMemDisp8FromR8(baseR32, disp8, srcR8) {
  return [0x88, modrm(1, R8[srcR8], R32[baseR32]), disp8 & 0xff];
}
const incR32 = r => [0x40 + R32[r]];
const decR32 = r => [0x48 + R32[r]];
const xorR32Self = r => [0x31, modrm(3, R32[r], R32[r])];
const jnzRel8 = rel => [0x75, rel & 0xff];
const RET = [0xc3];

// ---- the loop under test --------------------------------------------------
// Instruction ORDER is held at StarCraft's 0x4b48aa exactly; only registers,
// lengths, the hoist and the cursor count vary. Permuting the order would test
// the recognizer's tolerance rather than the executor's correctness, and a
// decline there is legitimate behaviour, not a bug.
//
//   [xor acc, acc]        <- only when the zero is IN-BLOCK
//  head:
//   mov  acc8, [src]
//   inc  src
//   mov  res8, [acc32 + tblDisp]
//   inc  dst
//   dec  ctr
//   mov  [dst-1], res8
//   jnz  head
//   ret
// The one-cursor form is the SAME register read and written, so it carries a
// single increment. Emitting one inc per role there would step the shared
// cursor twice an iteration -- a stride-2 in-place loop that is a different
// program, and one the recognizer is right to decline.
// The in-place (one-cursor) idiom is spelled differently in real code: it
// stores through the cursor at displacement 0 and advances AFTER the store,
// rather than advancing first and storing at -1. Both are the same program,
// but the recognizer models the instruction pattern, so the fuzzer has to emit
// the spelling that actually occurs.
//
//   one cursor:  inc cur / mov acc8,[cur-1] / mov res8,[acc32+tbl]
//                / mov [cur-1],res8 / dec ctr / jnz
//
// The cursor advances BEFORE the load, and both accesses then reach back to
// -1. That is the spelling test-lut-run-generalized.js's Heroes fixture uses
// and the one the in-place recognizer models; advancing after the store is the
// same program but is declined.
function buildLoop(v) {
  const pre = v.hoisted ? [] : xorR32Self(v.accReg);
  const body = v.oneCursor
    ? [].concat(
      incR32(v.srcReg),
      movR8FromMemDisp8(v.acc8, v.srcReg, 0xff),
      // Register-indexed table base, not disp32: that is what the in-place
      // recognizer models, and it is the only difference that made this
      // spelling fold.
      movR8FromMemSIB(v.res8, v.accReg, v.tblReg),
      movMemDisp8FromR8(v.srcReg, 0xff, v.res8),
      decR32(v.ctrReg))
    : [].concat(
      movR8FromMem(v.acc8, v.srcReg),
      incR32(v.srcReg),
      movR8FromMemDisp32(v.res8, v.accReg, v.tblDisp),
      incR32(v.dstReg),
      decR32(v.ctrReg),
      movMemDisp8FromR8(v.dstReg, 0xff, v.res8));
  const rel = -(body.length + 2);
  return { code: Uint8Array.from([].concat(pre, body, jnzRel8(rel), RET)),
    headOffset: pre.length };
}

function makeVariant() {
  // acc and res must be low-byte regs; the counter shares that pool. Cursors
  // come from the pointer-ish pool so they never collide with any of the three.
  const lowPool = ['eax', 'ecx', 'edx', 'ebx'];
  const accReg = pick(lowPool);
  const rest = lowPool.filter(r => r !== accReg);
  const sameResult = rnd() % 3 === 0;          // exercise res == acc too
  const resReg = sameResult ? accReg : pick(rest);
  const ctrReg = pick(rest.filter(r => r !== resReg));

  const curPool = ['esi', 'edi', 'ebp'];
  const oneCursor = rnd() % 4 === 0;           // the pre-existing narrow case
  const srcReg = pick(curPool);
  const dstReg = oneCursor ? srcReg : pick(curPool.filter(r => r !== srcReg));

  const hoisted = rnd() % 2 === 0;
  // A hoisted zero is only interesting when the accumulator's high bits are
  // NOT zero -- that is the path that folds acc_high into the table base.
  const accHigh = hoisted && rnd() % 2 === 0 ? (range(1, 0x3f) << 8) >>> 0 : 0;

  // The in-place form addresses its table through a register pair, so it needs
  // a spare low register to hold the table base. One is always free: the pool
  // has four and at most three roles are distinct.
  const tblReg = pick(lowPool.filter(r => r !== accReg && r !== resReg && r !== ctrReg));

  return { accReg, resReg, ctrReg, srcReg, dstReg, tblReg, oneCursor, hoisted, accHigh,
    acc8: LOW8_OF[accReg], res8: LOW8_OF[resReg],
    length: range(1, 48) };
}

(async () => {
  const EXTRA_WAT = `
  (func (export "test_lut_g2w") (param $ga i32) (result i32)
    (call $g2w (local.get $ga)))
  (func (export "test_lut_cf") (result i32) (call $get_cf))
  (func (export "test_lut_zf") (result i32) (call $get_zf))
  (func (export "test_lut_sf") (result i32) (call $get_sf))
  (func (export "test_lut_of") (result i32) (call $get_of))
`;
  const { exports: e, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'test', 'binaries', 'notepad.exe'));
  const bytes = new Uint8Array(memory.buffer);
  bytes.set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');

  const imageBase = e.get_image_base() >>> 0;
  const wa = ga => e.test_lut_g2w(ga) >>> 0;
  const dv = new DataView(memory.buffer);

  const stack = (imageBase + 0xd00000) >>> 0;
  const tblVA = (imageBase + 0xc00000) >>> 0;   // 256-aligned by construction
  const srcVA = (imageBase + 0xc01000) >>> 0;
  const dstVA = (imageBase + 0xc02000) >>> 0;
  const codeBase = (imageBase + 0xc10000) >>> 0;
  let codeSlot = 0;

  const put = (ga, arr) => bytes.set(arr, wa(ga));
  const get = (ga, n) => bytes.slice(wa(ga), wa(ga) + n);

  const setReg = {
    eax: v => e.set_eax(v), ecx: v => e.set_ecx(v), edx: v => e.set_edx(v),
    ebx: v => e.set_ebx(v), ebp: v => e.set_ebp(v), esi: v => e.set_esi(v),
    edi: v => e.set_edi(v),
  };
  const snapshotRegs = () => ({
    eax: e.get_eax() >>> 0, ecx: e.get_ecx() >>> 0, edx: e.get_edx() >>> 0,
    ebx: e.get_ebx() >>> 0, ebp: e.get_ebp() >>> 0, esi: e.get_esi() >>> 0,
    edi: e.get_edi() >>> 0, esp: e.get_esp() >>> 0,
    cf: e.test_lut_cf() | 0, zf: e.test_lut_zf() | 0,
    sf: e.test_lut_sf() | 0, of: e.test_lut_of() | 0,
  });

  // One arm: fresh code VA (so the block cache cannot serve the other arm's
  // decode), identical start state, identical table and source bytes.
  function runArm(v, emit, table, input) {
    const { code } = buildLoop(v);
    const ga = (codeBase + codeSlot * 0x200) >>> 0;
    codeSlot++;
    put(ga, code);

    put(tblVA, table);
    put(srcVA, input);
    put(dstVA, new Uint8Array(v.length + 8).fill(0x99));

    e.set_loop_lut_emit(emit);
    const runsBefore = e.get_loop_lut_runs() >>> 0;

    e.set_esp(stack);
    dv.setUint32(wa(stack), 0, true);
    // Registers not used by the loop still get a fingerprint, so a fold that
    // clobbers a bystander register is caught rather than read as zero-vs-zero.
    for (const r of Object.keys(setReg)) setReg[r](0xdead0000 | R32[r]);
    setReg[v.srcReg](srcVA);
    setReg[v.dstReg](v.oneCursor ? srcVA : dstVA);
    setReg[v.ctrReg](v.length);
    // The table base register carries the same acc_high correction the disp32
    // form folds into its displacement, so the effective address is
    // tblVA + indexByte in both spellings.
    if (v.oneCursor) setReg[v.tblReg]((tblVA - v.accHigh) >>> 0);
    setReg[v.accReg](v.accHigh);

    e.set_eip(ga);
    e.run(2000000);

    return {
      regs: snapshotRegs(),
      dst: get(v.oneCursor ? srcVA : dstVA, v.length + 8),
      folded: (e.get_loop_lut_runs() >>> 0) !== runsBefore,
    };
  }

  let folded = 0, declined = 0, mismatched = 0;
  const failures = [];

  for (let i = 0; i < CASES; i++) {
    const v = makeVariant();
    // disp32 is chosen so the EFFECTIVE address is tblVA + indexByte even when
    // the accumulator carries nonzero high bits -- exactly how the guest code
    // this fold targets is written.
    v.tblDisp = (tblVA - v.accHigh) >>> 0;

    const table = new Uint8Array(256);
    for (let k = 0; k < 256; k++) table[k] = rnd() & 0xff;
    const input = new Uint8Array(v.length);
    for (let k = 0; k < v.length; k++) input[k] = rnd() & 0xff;

    const a = runArm(v, 0, table, input);
    const b = runArm(v, 1, table, input);

    if (!b.folded) {
      declined++;
      if (VERBOSE) console.log(`  [${i}] declined  ${describe(v)}`);
      continue;
    }
    folded++;

    const regsEqual = JSON.stringify(a.regs) === JSON.stringify(b.regs);
    const memEqual = Buffer.compare(Buffer.from(a.dst), Buffer.from(b.dst)) === 0;
    if (regsEqual && memEqual) {
      if (VERBOSE) console.log(`  [${i}] ok        ${describe(v)}`);
      continue;
    }
    mismatched++;
    failures.push({ case: i, variant: describe(v), seed: SEED,
      regsEqual, memEqual, unfolded: a.regs, folded: b.regs });
    console.log(`  [${i}] MISMATCH  ${describe(v)}`);
    if (!regsEqual) {
      for (const k of Object.keys(a.regs)) {
        if (a.regs[k] !== b.regs[k]) {
          console.log(`        ${k}: unfolded 0x${a.regs[k].toString(16)} ` +
            `folded 0x${b.regs[k].toString(16)}`);
        }
      }
    }
    if (!memEqual) console.log('        destination bytes differ');
  }

  function describe(v) {
    return `len=${String(v.length).padStart(2)} ` +
      `src=${v.srcReg} dst=${v.dstReg}${v.oneCursor ? '(one)' : ''} ` +
      `ctr=${v.ctrReg} acc=${v.acc8} res=${v.res8}` +
      `${v.res8 === v.acc8 ? '(same)' : ''} ` +
      `${v.hoisted ? 'hoisted' : 'in-block'} accHigh=0x${v.accHigh.toString(16)}`;
  }

  const summary = { seed: SEED, cases: CASES, folded, declined, mismatched, failures };
  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('');
    console.log(`seed ${SEED}  cases ${CASES}`);
    console.log(`  folded     ${folded}`);
    console.log(`  declined   ${declined}   (conservative recognizer, not a failure)`);
    console.log(`  MISMATCHED ${mismatched}`);
  }

  if (mismatched > 0) {
    console.log('\nFAIL: the fold changed observable state.');
    process.exit(1);
  }
  if (folded === 0) {
    console.log('\nFAIL: nothing folded -- this run is a null control and proves nothing.');
    process.exit(2);
  }
  console.log('\nPASS: every folded variant is bit-identical to its unfolded execution.');
})();
