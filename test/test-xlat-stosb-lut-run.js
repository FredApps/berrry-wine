#!/usr/bin/env node
'use strict';

// Diablo's full-screen palette pass is an implicit-register LUT loop:
//   mov al,[edi] / xlat / stosb / loop ^
// Prove H418 mode 0x10 against ordinary x86 in both DF directions, including
// architectural state, lazy flags, rollback gating and conservative misses.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const EXTRA_WAT = `
  (func (export "test_xlat_g2w") (param $ga i32) (result i32)
    (call $g2w (local.get $ga)))
  (func (export "test_xlat_set_df") (param $v i32)
    (global.set $df (local.get $v)))
  (func (export "test_xlat_seed_flags")
    (call $set_flags_sub (i32.const 0x12345678) (i32.const 0x12345678) (i32.const 0)))
  (func (export "test_xlat_cf") (result i32) (call $get_cf))
  (func (export "test_xlat_zf") (result i32) (call $get_zf))
  (func (export "test_xlat_sf") (result i32) (call $get_sf))
  (func (export "test_xlat_of") (result i32) (call $get_of))
`;

(async () => {
  const traceHost = process.env.XLAT_LUT_TRACE
    ? { log_i32: value => console.error(`loop-trace ${value >>> 0} 0x${(value >>> 0).toString(16)}`) }
    : {};
  const { exports: e, memory } = await bootRenderHarness({
    extraWat: EXTRA_WAT, fonts: 'none', extraHostOverrides: traceHost,
  });
  const fixture = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const bytes = new Uint8Array(memory.buffer);
  bytes.set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');
  if (process.env.XLAT_LUT_TRACE) e.set_loop_trace(1, 0);

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const imageWa = ga => (ga - imageBase + guestBase) >>> 0;
  const wa = ga => e.test_xlat_g2w(ga) >>> 0;
  const dv = new DataView(memory.buffer);
  const stack = (imageBase + 0xd00000) >>> 0;
  const codeBase = (imageBase + 0x1800) >>> 0;
  let codeSlot = 0;

  function install(code) {
    const ga = (codeBase + codeSlot++ * 0x100) >>> 0;
    bytes.set(code, imageWa(ga));
    return ga;
  }

  function execute(code, setup) {
    const ga = install(code);
    e.set_esp(stack);
    dv.setUint32(imageWa(stack), 0, true);
    setup();
    e.set_eip(ga);
    e.run(100000);
    assert.strictEqual(e.get_eip() >>> 0, 0, 'probe returns to sentinel');
  }

  const arena = e.guest_alloc(0x5000) >>> 0;
  const table = (arena + 0x1000) >>> 0;
  const src = (arena + 0x2f80) >>> 0; // crosses a page during the 301-byte pass
  const baseline = (arena + 0x3800) >>> 0;
  const input = Array.from({ length: 301 }, (_, i) => (i * 37 + 11) & 0xff);
  const lut = Array.from({ length: 256 }, (_, i) => (i * 13 + 97) & 0xff);
  bytes.set(lut, wa(table));
  const expected = input.map(v => lut[v]);
  const read = (ga, n) => Array.from(bytes.subarray(wa(ga), wa(ga) + n));

  // LOOP's displacement is relative to byte 6, hence -6 back to byte 0.
  const authentic = Uint8Array.from([
    0x8a, 0x07,       // mov al,[edi]
    0xd7,             // xlat
    0xaa,             // stosb
    0xe2, 0xfa,       // loop byte 0
    0xc3,
  ]);

  const state = () => ({
    eax: e.get_eax() >>> 0, ebx: e.get_ebx() >>> 0,
    ecx: e.get_ecx() >>> 0, edi: e.get_edi() >>> 0,
    cf: e.test_xlat_cf(), zf: e.test_xlat_zf(),
    sf: e.test_xlat_sf(), of: e.test_xlat_of(),
  });
  const setupForward = dst => {
    bytes.set(input, wa(dst));
    e.set_eax(0xa5b6c700); e.set_ebx(table); e.set_ecx(input.length); e.set_edi(dst);
    e.test_xlat_set_df(0);
    e.test_xlat_seed_flags();
  };

  // Decode one copy with LUT folding disabled to get the ordinary reference.
  e.set_loop_lut_emit(0);
  const ordinaryRuns = e.get_loop_xlat_stosb_runs();
  setupForward(baseline);
  execute(authentic, () => {});
  const ordinaryState = state();
  const ordinaryBytes = read(baseline, input.length);
  assert.deepStrictEqual(ordinaryBytes, expected, 'ordinary forward palette output');
  assert.strictEqual(e.get_loop_xlat_stosb_runs(), ordinaryRuns,
    'LUT rollback gate suppresses the specialized executor');

  e.set_loop_lut_emit(1);
  const matches = e.get_loop_xlat_stosb_matches();
  const runs = e.get_loop_xlat_stosb_runs();
  const charged = e.get_loop_xlat_stosb_bytes();
  setupForward(src);
  execute(authentic, () => {});
  assert.deepStrictEqual(read(src, input.length), ordinaryBytes,
    'lowered forward output agrees across a page boundary');
  assert.deepStrictEqual(state(), {
    ...ordinaryState,
    edi: (src + input.length) >>> 0,
  }, 'lowered forward path preserves registers and lazy flags');
  assert(e.get_loop_xlat_stosb_matches() > matches,
    'authentic four-op loop is recognized');
  assert(e.get_loop_xlat_stosb_runs() > runs,
    'authentic loop executes through specialized H418 mode');
  assert.strictEqual(Number(e.get_loop_xlat_stosb_bytes() - charged), input.length,
    'H418 charges every loop iteration');

  // Diablo first enters through a row head that reloads ECX, then LOOP jumps
  // to the six-byte interior. Prove that complete cached-block spelling too.
  const rowHead = Uint8Array.from([
    0xb9, 0x2d, 0x01, 0x00, 0x00, // mov ecx,301
    0x8a, 0x07, 0xd7, 0xaa, 0xe2, 0xfa,
    0xc3,
  ]);
  const rowDst = (arena + 0x3c00) >>> 0;
  bytes.set(input, wa(rowDst));
  const rowMatches = e.get_loop_xlat_stosb_matches();
  const rowRuns = e.get_loop_xlat_stosb_runs();
  execute(rowHead, () => {
    e.set_eax(0x31415900); e.set_ebx(table); e.set_ecx(7); e.set_edi(rowDst);
    e.test_xlat_set_df(0); e.test_xlat_seed_flags();
  });
  assert.deepStrictEqual(read(rowDst, input.length), expected, 'Diablo row-head output');
  assert.strictEqual(e.get_ecx() >>> 0, 0, 'row head reloads and exhausts ECX');
  assert(e.get_loop_xlat_stosb_matches() > rowMatches,
    'MOV ECX row head is recognized before the self-loop gate');
  assert(e.get_loop_xlat_stosb_runs() > rowRuns, 'MOV ECX row head uses H418');

  // DF=1: EDI is both the source and STOSB destination, so the same semantic
  // loop must walk backward without changing output ordering in memory.
  const backward = (arena + 0x4800) >>> 0;
  bytes.set(input, wa(backward));
  const backMatches = e.get_loop_xlat_stosb_matches();
  const backRuns = e.get_loop_xlat_stosb_runs();
  execute(authentic, () => {
    e.set_eax(0x11223300); e.set_ebx(table); e.set_ecx(input.length);
    e.set_edi(backward + input.length - 1); e.test_xlat_set_df(1);
    e.test_xlat_seed_flags();
  });
  assert.deepStrictEqual(read(backward, input.length), expected,
    'lowered DF=1 palette output');
  assert.strictEqual(e.get_edi() >>> 0, (backward - 1) >>> 0, 'DF=1 final EDI');
  assert.strictEqual(e.get_ecx() >>> 0, 0, 'DF=1 final ECX');
  assert(e.get_loop_xlat_stosb_matches() > backMatches, 'DF is runtime state');
  assert(e.get_loop_xlat_stosb_runs() > backRuns, 'DF=1 uses H418');
  e.test_xlat_set_df(0);

  // LOOPE is intentionally outside the fold even when ZF=1 makes this run
  // equivalent today: it observes flags each iteration and is a different ISA
  // contract. It must remain ordinary x86.
  const near = Uint8Array.from(authentic);
  near[4] = 0xe1;
  const nearDst = (arena + 0x4300) >>> 0;
  bytes.set(input, wa(nearDst));
  const nearMatches = e.get_loop_xlat_stosb_matches();
  const nearRuns = e.get_loop_xlat_stosb_runs();
  execute(near, () => {
    e.set_eax(0x55667700); e.set_ebx(table); e.set_ecx(input.length); e.set_edi(nearDst);
    e.test_xlat_seed_flags();
  });
  assert.deepStrictEqual(read(nearDst, input.length), expected, 'LOOPE near-miss output');
  assert.strictEqual(e.get_loop_xlat_stosb_matches(), nearMatches,
    'LOOPE near miss is not recognized');
  assert.strictEqual(e.get_loop_xlat_stosb_runs(), nearRuns,
    'LOOPE near miss stays on ordinary handlers');

  console.log('XLAT/STOSB LUT_RUN semantic regression passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
