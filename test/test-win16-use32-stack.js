#!/usr/bin/env node
'use strict';

// USE32 code in a 16-bit task, running on a big stack segment whose base is
// not zero: the shape of Intel's Indeo 4 driver (ir41.dll), which Civilization
// II's Win16 build loads from its CD to play its intro movie. The register
// file keeps ESP as a linear address, and the guest sees ESP as an offset
// into SS, so every instruction that lets the guest look at ESP's value has to
// translate. Indeo refuses to decode a frame unless
// `lea eax,[esp+838h] / sub eax,esp` leaves 838h, and saves its stack with
// PUSH ESP before switching SS to call back into 16-bit code.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "use32_setup")
    ;; seg1: USE32 code at 100000h. seg2: a big (B bit) stack at 110000h.
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (global.get $WIN16_SEG_BIG) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.or (global.get $WIN16_SEG_BIG) (i32.const 1)) (i32.const 2))
    (global.set $code16 (i32.const 1))
    (global.set $cs_big (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (global.set $sreg_ds (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ds (i32.const 0x00110000))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00113f00))
    (global.set $eip (i32.const 0x00100200)))
  (func (export "use32_put8") (param $addr i32) (param $v i32)
    (call $gs8 (local.get $addr) (local.get $v)))
  (func (export "use32_reg32") (param $r i32) (result i32)
    (i32.load (i32.add (global.get $reg_base) (i32.shl (local.get $r) (i32.const 2)))))
`;

const code = [
  0x8d, 0x84, 0x24, 0x38, 0x08, 0x00, 0x00, // 200: lea eax,[esp+838h]
  0x2b, 0xc4,                               // 207: sub eax,esp
  0x8b, 0xdc,                               // 209: mov ebx,esp
  0x54,                                     // 20b: push esp
  0x59,                                     // 20c: pop ecx
  0x54,                                     // 20d: push esp
  0x5c,                                     // 20e: pop esp
  0xe8, 0x02, 0x00, 0x00, 0x00,             // 20f: call 216h
  0xeb, 0xfe,                               // 214: jmp $   ; park here
  0x8b, 0x14, 0x24,                         // 216: mov edx,[esp]
  0xc3,                                     // 219: ret
];

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, width: 32, height: 24 });
  e.use32_setup();
  code.forEach((b, i) => e.use32_put8(0x00100200 + i, b));
  e.run(50);

  const EAX = 0, ECX = 1, EDX = 2, EBX = 3, ESP = 4;
  assert.strictEqual(e.use32_reg32(EAX) >>> 0, 0x838,
    'lea eax,[esp+N] minus esp is N: both see the same ESP');
  assert.strictEqual(e.use32_reg32(EBX) >>> 0, 0x3f00,
    'mov ebx,esp copies the offset into SS, not the linear address');
  assert.strictEqual(e.use32_reg32(ECX) >>> 0, 0x3f00,
    'push esp pushes the offset ESP had before the push');
  assert.strictEqual(e.use32_reg32(ESP) >>> 0, 0x00113f00,
    'pop esp loads the popped offset back as the same stack position');
  assert.strictEqual(e.use32_reg32(EDX) >>> 0, 0x214,
    'call rel32 in USE32 code pushes a doubleword return offset');
  console.log('PASS USE32 code on a based 32-bit stack sees ESP as an offset into SS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
