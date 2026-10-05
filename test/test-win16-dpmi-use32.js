#!/usr/bin/env node
'use strict';

// A Win16 task can turn one of its own code segments into 32-bit code: DPMI
// function 000Bh reads the selector's descriptor, the task sets the D bit in
// byte 6, and 000Ch writes it back. ClockWerx does exactly that on the first
// call into its blitter segment and then runs it as USE32 code -- 32-bit
// operands and addresses by default, rel32 branches, `66 CA` for its 16-bit
// far return. Without it, int 31h failed, the probe that follows looped, and
// the game never left its title screen.
//
// Here a 16-bit segment reads its own descriptor, sets D, writes it back, and
// the instructions after the int must decode as 32-bit code: `B8 imm32` is a
// five-byte MOV EAX, and `8B 1D disp32` a 32-bit-addressed load through DS.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "dpmi_setup")
    ;; seg1 code (NE segment 1), seg2 stack, seg4 data.
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 4) (i32.const 0x00130000)
      (i32.const 0x10000) (i32.const 1) (i32.const 4))
    (global.set $code16 (i32.const 1))
    (global.set $cs_big (i32.const 0))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (global.set $sreg_ds (call $win16_index_to_sel (i32.const 4)))
    (global.set $seg_base_ds (i32.const 0x00130000))
    (global.set $sreg_es (call $win16_index_to_sel (i32.const 4)))
    (global.set $seg_base_es (i32.const 0x00130000))
    (global.set $eip (i32.const 0x00100200)))
  (func (export "dpmi_put8") (param $addr i32) (param $v i32)
    (call $gs8 (local.get $addr) (local.get $v)))
  (func (export "dpmi_get8") (param $addr i32) (result i32)
    (call $gl8 (local.get $addr)))
  (func (export "dpmi_reg32") (param $r i32) (result i32)
    (i32.load (i32.add (global.get $reg_base) (i32.shl (local.get $r) (i32.const 2)))))
  (func (export "dpmi_cs_big") (result i32) (global.get $cs_big))
  (func (export "dpmi_seg_flags") (param $index i32) (result i32)
    (i32.load offset=8 (i32.add (global.get $WIN16_SEG_TABLE)
      (i32.shl (local.get $index) (i32.const 4)))))
`;

const code = [
  0xb8, 0x0b, 0x00,                   // mov ax,000Bh      ; get descriptor
  0xbb, 0x0f, 0x00,                   // mov bx,000Fh      ; this segment
  0xbf, 0x00, 0x01,                   // mov di,0100h      ; ES:DI buffer
  0xcd, 0x31,                         // int 31h
  0x80, 0x0e, 0x06, 0x01, 0x40,       // or byte [0106h],40h ; set D
  0xb8, 0x0c, 0x00,                   // mov ax,000Ch      ; set descriptor
  0xcd, 0x31,                         // int 31h
  // From here on the segment is USE32.
  0xb8, 0x78, 0x56, 0x34, 0x12,       // mov eax,12345678h
  0x8b, 0x1d, 0x00, 0x01, 0x00, 0x00, // mov ebx,[00000100h]
  0xeb, 0xfe,                         // jmp $           ; park here
];

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, width: 32, height: 24 });
  e.dpmi_setup();
  code.forEach((b, i) => e.dpmi_put8(0x00100200 + i, b));
  e.run(50);

  const desc = Array.from({ length: 8 }, (_, i) => e.dpmi_get8(0x00130100 + i));
  assert.deepStrictEqual(desc, [0xff, 0xff, 0x00, 0x00, 0x10, 0xfa, 0x40, 0x00],
    '000Bh wrote limit FFFFh, base 100000h, a DPL-3 code access byte; D is what the task set');
  assert.strictEqual(e.dpmi_cs_big(), 1, '000Ch on the running CS makes it 32-bit at once');
  assert.notStrictEqual(e.dpmi_seg_flags(1) & 0x80000, 0, 'the D bit is kept with the selector');

  const EAX = 0, EBX = 3;
  assert.strictEqual(e.dpmi_reg32(EAX) >>> 0, 0x12345678,
    'B8 after the switch is MOV EAX,imm32');
  assert.strictEqual(e.dpmi_reg32(EBX) >>> 0, 0x0000ffff,
    '8B 1D is a disp32 load, still relative to DS');
  console.log('PASS DPMI 000Bh/000Ch turn a Win16 code segment into USE32 code');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
