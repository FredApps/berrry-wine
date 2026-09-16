#!/usr/bin/env node
'use strict';

// Semantic regression for the generic unit-stride byte FILL_RUN (H454).
//
// The fold replaces N byte stores with one memory.fill, so "it wrote the right
// number of bytes" is not enough on its own: an off-by-one in a blit fold looks
// perfect in every histogram. Every arm below therefore runs the SAME x86 twice
// -- once with the lowering off, once on -- and demands that the filled bytes,
// the guard bytes either side of the run, all eight registers and all four
// arithmetic flags come out identical.
//
// Three body orders are covered because the position of the pointer add relative
// to the store is what decides the first address, and getting that wrong shifts
// the whole run by one byte:
//   A  mov [edi],al / inc edi / dec edx / jnz     (StarCraft 0x004b48d7)
//   B  inc edi / dec edx / mov [edi-1],al / jnz   (StarCraft 0x004b4d2a)
//   C  dec edi / dec edx / mov [edi],al / jnz     (StarCraft 0x004b557f, descending)
// plus two near misses that must stay ordinary x86, and a zero-counter entry
// (the x86 trip count is 2^32) that must stay inside its budget.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const EXTRA_WAT = `
  (func (export "test_fill_cf") (result i32) (call $get_cf))
  (func (export "test_fill_zf") (result i32) (call $get_zf))
  (func (export "test_fill_sf") (result i32) (call $get_sf))
  (func (export "test_fill_of") (result i32) (call $get_of))
`;

// A: mov [edi],al ; inc edi ; dec edx ; jnz -6 ; ret
const BODY_A = Uint8Array.from([0x88, 0x07, 0x47, 0x4a, 0x75, 0xfa, 0xc3]);
// B: inc edi ; dec edx ; mov [edi-1],al ; jnz -7 ; ret
const BODY_B = Uint8Array.from([0x47, 0x4a, 0x88, 0x47, 0xff, 0x75, 0xf9, 0xc3]);
// C: dec edi ; dec edx ; mov [edi],al ; jnz -6 ; ret   (descending)
const BODY_C = Uint8Array.from([0x4f, 0x4a, 0x88, 0x07, 0x75, 0xfa, 0xc3]);
// Near miss 1: the stored byte IS the counter's low byte, so it is not
// loop-invariant and the run is not one repeated value.
const NEAR_CTR = Uint8Array.from([0x88, 0x17, 0x47, 0x4a, 0x75, 0xfa, 0xc3]);
// Near miss 2: jz instead of jnz -- the same four roles, the opposite loop.
const NEAR_JZ = Uint8Array.from([0x88, 0x07, 0x47, 0x4a, 0x74, 0xfa, 0xc3]);

const VALUE = 0xa5;
const GUARD = 0x31;
const PAD = 8;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  let bytes = new Uint8Array(memory.buffer);
  bytes.set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = ga => (ga - imageBase + guestBase) >>> 0;
  const codeBase = (imageBase + 0x2600) >>> 0;
  const arena = e.guest_alloc(0x80000) >>> 0;
  bytes = new Uint8Array(memory.buffer);
  const region = (arena + 0x4000) >>> 0;
  const stack = (arena + 0x70000) >>> 0;

  let nextCode = 0;
  function install(code) {
    const ga = (codeBase + nextCode) >>> 0;
    nextCode += 0x100;
    bytes.set(code, wa(ga));
    return ga;
  }

  // The window observed either side of the run, so an off-by-one at either end
  // is a byte difference rather than an invisible one.
  function snapshot(lo, len) {
    return Array.from(bytes.subarray(wa(lo - PAD), wa(lo + len + PAD)));
  }

  // `descending` says which end of the region the pointer starts at.
  function run(code, count, enabled, { descending = false, budget = 100000 } = {}) {
    bytes.fill(GUARD, wa(region - PAD), wa(region + count + PAD));
    e.guest_write32(stack, 0);
    e.set_loop_fill_emit(enabled ? 1 : 0);
    e.set_eax(0x11223300 | VALUE);
    e.set_ecx(0x44556677);
    e.set_edx(count);
    e.set_ebx(0x33445566);
    e.set_esp(stack);
    e.set_ebp(0x778899aa);
    e.set_esi(0xcafe1234);
    // BODY_C decrements before it stores, so its pointer enters one past the
    // top of the region and the run still covers [region, region+count).
    e.set_edi(descending ? (region + count) >>> 0 : region);
    e.set_eip(code);
    e.run(budget);
    return {
      eip: e.get_eip() >>> 0,
      bytes: snapshot(region, count),
      state: {
        eax: e.get_eax() >>> 0, ecx: e.get_ecx() >>> 0,
        edx: e.get_edx() >>> 0, ebx: e.get_ebx() >>> 0,
        esp: e.get_esp() >>> 0, ebp: e.get_ebp() >>> 0,
        esi: e.get_esi() >>> 0, edi: e.get_edi() >>> 0,
        cf: e.test_fill_cf(), zf: e.test_fill_zf(),
        sf: e.test_fill_sf(), of: e.test_fill_of(),
      },
    };
  }

  // A run longer than one 1000-step quantum, so the budgeted re-entry path and
  // the accumulated register/flag state are both exercised.
  const COUNT = 5000;

  for (const [name, body, descending] of [
    ['A  store,inc,dec', BODY_A, false],
    ['B  inc,dec,store-1', BODY_B, false],
    ['C  dec,dec,store (descending)', BODY_C, true],
  ]) {
    const plainCode = install(body);
    const fusedCode = install(body);

    const before = e.get_loop_fill_matches();
    const plain = run(plainCode, COUNT, false, { descending });
    assert.strictEqual(e.get_loop_fill_matches(), before + 1,
      `${name}: a disabled lowering still recognizes the loop for diagnostics`);
    assert.strictEqual(plain.eip, 0, `${name}: ordinary run returns`);

    const runsBefore = e.get_loop_fill_runs();
    const fused = run(fusedCode, COUNT, true, { descending });
    assert.strictEqual(fused.eip, 0, `${name}: folded run returns`);
    assert.deepStrictEqual(fused, plain,
      `${name}: H454 preserves bytes, registers and flags exactly`);
    assert(e.get_loop_fill_runs() > runsBefore, `${name}: H454 actually executed`);

    assert.deepStrictEqual(fused.bytes.slice(PAD, PAD + COUNT), Array(COUNT).fill(VALUE),
      `${name}: the whole requested extent is filled`);
    assert.deepStrictEqual(fused.bytes.slice(0, PAD), Array(PAD).fill(GUARD),
      `${name}: nothing is written before the run`);
    assert.deepStrictEqual(fused.bytes.slice(PAD + COUNT), Array(PAD).fill(GUARD),
      `${name}: nothing is written after the run`);
  }

  // Near misses: recognized-looking bodies the predicate must refuse outright,
  // so they are not merely un-lowered but never counted as matches either.
  for (const [name, body] of [
    ['stored byte is the counter', NEAR_CTR],
    ['jz terminator', NEAR_JZ],
  ]) {
    const code = install(body);
    const before = e.get_loop_fill_matches();
    e.guest_write32(stack, 0);
    e.set_loop_fill_emit(1);
    e.set_eax(0x11223300 | VALUE);
    e.set_edx(4);
    e.set_esp(stack);
    e.set_edi(region);
    e.set_eip(code);
    e.run(10000);
    assert.strictEqual(e.get_loop_fill_matches(), before,
      `near miss (${name}) stays ordinary x86`);
  }

  // Entering with a zero counter is 2^32 iterations of real x86. The fold must
  // clamp to its budget and re-enter, never run the whole trip inside one
  // handler: the run below would not terminate if it did.
  {
    const code = install(BODY_A);
    bytes.fill(GUARD, wa(region - PAD), wa(region + 40000 + PAD));
    e.guest_write32(stack, 0);
    e.set_loop_fill_emit(1);
    e.set_eax(0x11223300 | VALUE);
    e.set_edx(0);
    e.set_esp(stack);
    e.set_edi(region);
    e.set_eip(code);
    e.run(20000);
    const advanced = ((e.get_edi() >>> 0) - region) >>> 0;
    assert(advanced > 0, 'zero-counter entry makes forward progress');
    assert(advanced < 40000, 'zero-counter entry stays inside its budget');
    assert.strictEqual((0 - (e.get_edx() >>> 0)) >>> 0, advanced,
      'pointer advance and counter decrement agree');
    assert.strictEqual(bytes[wa(region + advanced - 1)], VALUE,
      'the last byte inside the budget is filled');
    assert.strictEqual(bytes[wa(region + advanced)], GUARD,
      'the first byte beyond the budget is untouched');
    assert.strictEqual(e.get_eip() >>> 0, code,
      'the block is re-entered at its own head rather than falling through');
  }

  console.log('PASS  byte FILL_RUN (H454) is exact, budgeted and state-equivalent');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
