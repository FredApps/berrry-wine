#!/usr/bin/env node
'use strict';

// An address-size override in a 16-bit code segment brings a SIB byte with it,
// and the SIB's scale has to survive into the segmented address. Bad Toys 3D's
// raycaster (386 code in a Win16 segment) reads its tangent table with
// `fs: mov edx,[edi+ecx*4]`; with the scale dropped that was `[edi+ecx]`, a
// misaligned mix of two neighbouring entries, and a ray given those slopes
// walked out of its fully walled map and marked the words after it -- one of
// them the accelerator handle the message loop passed to TranslateAccelerator.
// The encodings below are the game's own, plus a base-less LEA.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "tss_setup")
    (local $i i32)
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 3) (i32.const 0x00120000)
      (i32.const 0x10000) (i32.const 0) (i32.const 3))
    (call $win16_seg_set (i32.const 4) (i32.const 0x00130000)
      (i32.const 0x10000) (i32.const 0) (i32.const 4))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (global.set $sreg_ds (call $win16_index_to_sel (i32.const 4)))
    (global.set $seg_base_ds (i32.const 0x00130000))
    ;; DS:[0x2eae] = far pointer to the table, offset 0 in segment 3.
    (call $gs16 (i32.const 0x00132EAE) (i32.const 0))
    (call $gs16 (i32.const 0x00132EB0) (call $win16_index_to_sel (i32.const 3)))
    ;; Table entry i = 0x11110000 + i, so a misaligned read cannot pass.
    (loop $fill
      (call $gs32 (i32.add (i32.const 0x00120000) (i32.shl (local.get $i) (i32.const 2)))
        (i32.add (i32.const 0x11110000) (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $fill (i32.lt_u (local.get $i) (i32.const 16))))
    (global.set $eip (i32.const 0x00100200)))
  (func (export "tss_put8") (param $addr i32) (param $v i32)
    (call $gs8 (local.get $addr) (local.get $v)))
  (func (export "tss_reg32") (param $r i32) (result i32)
    (i32.load (i32.add (global.get $reg_base) (i32.shl (local.get $r) (i32.const 2)))))
`;

const code = [
  0x0f, 0xb4, 0x3e, 0xae, 0x2e,                         // lfs di,[0x2eae]
  0x66, 0x33, 0xff,                                     // xor edi,edi
  0x66, 0xb9, 0x03, 0x00, 0x00, 0x00,                   // mov ecx,3
  0x66, 0x64, 0x67, 0x8b, 0x14, 0x8f,                   // fs: mov edx,[edi+ecx*4]
  0x67, 0x8d, 0x04, 0x8d, 0x10, 0x00, 0x00, 0x00,       // lea ax,[ecx*4+0x10]
  0x66, 0xb9, 0x85, 0x03, 0x00, 0x00,                   // mov ecx,0x385
  0x66, 0x64, 0x67, 0x8b, 0x9c, 0x8f, 0xf0, 0xf1, 0xff, 0xff, // fs: mov ebx,[edi+ecx*4-0xe10]
  0xf4,                                                 // hlt
];

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, width: 32, height: 24 });
  e.tss_setup();
  code.forEach((b, i) => e.tss_put8(0x00100200 + i, b));
  e.run(1);
  const EAX = 0, EDX = 2, EBX = 3;
  assert.strictEqual(e.tss_reg32(EDX) >>> 0, 0x11110003,
    'fs: [edi+ecx*4] reads table entry ecx, not the bytes at offset ecx');
  assert.strictEqual(e.tss_reg32(EAX) & 0xFFFF, 0x001C,
    'a base-less LEA scales its index too');
  assert.strictEqual(e.tss_reg32(EBX) >>> 0, 0x11110001,
    'the disp32 form scales the index before adding the displacement');
  console.log('PASS Win16 32-bit SIB addressing keeps its scale');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
