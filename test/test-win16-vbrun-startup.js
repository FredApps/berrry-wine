#!/usr/bin/env node
'use strict';

// The two KERNEL entry points Visual Basic 3's runtime (VBRUN300.DLL) calls
// before it shows a form. Both were unimplemented, and the Win16 dispatcher
// fails fast, so every VBRUN300 game on the corpus stopped inside the runtime's
// startup rather than in its own code:
//
//   KERNEL.199 SetHandleCount(wNumber) -> how many file handles were granted
//   KERNEL.102 DOS3Call             -> an INT 21h with the caller's registers
//
// DOS3Call is tested through AH=25h (set interrupt vector), which is what VB
// uses it for: the result has to land in the same vector table the `int 21h`
// instruction path writes, and AH=35h has to read it back.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func $test_vbrun_setup
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (global.set $sreg_ds (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ds (i32.const 0x00110000)))

  ;; A far return address at the top of the task stack, the way a Pascal call
  ;; into KERNEL leaves one, so the dispatcher's own return can be checked.
  (func $test_vbrun_frame
    (call $test_vbrun_setup)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00110100))
    (call $gs16 (i32.const 0x00110100) (i32.const 0x0010))
    (call $gs16 (i32.const 0x00110102) (call $win16_index_to_sel (i32.const 1))))

  (func (export "test_vbrun_set_handle_count") (param $want i32) (result i32)
    (call $test_vbrun_frame)
    (call $gs16 (i32.const 0x00110104) (local.get $want))
    (drop (call $win16_kernel (i32.const 199)))
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))

  (func (export "test_vbrun_set_handle_count_esp") (param $want i32) (result i32)
    (call $test_vbrun_frame)
    (call $gs16 (i32.const 0x00110104) (local.get $want))
    (drop (call $win16_kernel (i32.const 199)))
    (i32.load offset=16 (global.get $reg_base)))

  ;; DOS3Call with AH=25h, AL=$vec, DS:DX = the handler.
  (func (export "test_vbrun_dos3call_set_vector") (param $vec i32) (param $off i32)
        (result i32)
    (call $test_vbrun_frame)
    (i32.store offset=0 (global.get $reg_base)
      (i32.or (i32.const 0x2500) (local.get $vec)))
    (i32.store offset=8 (global.get $reg_base) (local.get $off))
    (drop (call $win16_kernel (i32.const 102)))
    (i32.load (i32.add (call $win16_int_vectors)
      (i32.shl (local.get $vec) (i32.const 2)))))

  ;; Where the dispatcher returned to after DOS3Call: it carries no stack
  ;; arguments, so the far return address is all that comes off.
  (func (export "test_vbrun_dos3call_eip") (result i32)
    (global.get $eip))

  (func (export "test_vbrun_dos3call_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))

  ;; AH=35h reads the vector back into ES:BX.
  (func (export "test_vbrun_dos3call_get_vector") (param $vec i32) (result i32)
    (call $test_vbrun_frame)
    (i32.store offset=0 (global.get $reg_base)
      (i32.or (i32.const 0x3500) (local.get $vec)))
    (drop (call $win16_kernel (i32.const 102)))
    (i32.and (i32.load offset=12 (global.get $reg_base)) (i32.const 0xFFFF)))

  (func (export "test_vbrun_data_selector") (result i32)
    (call $win16_index_to_sel (i32.const 2)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'bitmap' });

  // A request the table can serve comes back unchanged; one it cannot is
  // clamped, because Win16 returns what it granted, not what was asked for.
  assert.strictEqual(e.test_vbrun_set_handle_count(30), 30,
    'SetHandleCount should grant a request the file table can serve');
  assert.strictEqual(e.test_vbrun_set_handle_count(255), 255,
    'SetHandleCount should grant the Win16 maximum');
  assert.strictEqual(e.test_vbrun_set_handle_count(1000), 255,
    'SetHandleCount should clamp to what it can actually grant');
  assert.strictEqual(e.test_vbrun_set_handle_count_esp(30) >>> 0, 0x00110106,
    'SetHandleCount should pop its one Pascal argument word and far return');

  const ds = e.test_vbrun_data_selector() >>> 0;
  assert.strictEqual(e.test_vbrun_dos3call_set_vector(0, 0x1234) >>> 0,
    ((ds << 16) | 0x1234) >>> 0,
    'DOS3Call AH=25h should write DS:DX into the interrupt vector table');
  assert.strictEqual(e.test_vbrun_dos3call_eip() >>> 0, 0x00100010,
    'DOS3Call should far return to the caller');
  assert.strictEqual(e.test_vbrun_dos3call_esp() >>> 0, 0x00110104,
    'DOS3Call carries no stack arguments, so only the far return comes off');
  assert.strictEqual(e.test_vbrun_dos3call_get_vector(0) >>> 0, 0x1234,
    'DOS3Call AH=35h should read back the vector DOS3Call AH=25h set');

  console.log('PASS VBRUN300 startup: KERNEL.199 SetHandleCount and KERNEL.102 DOS3Call');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
