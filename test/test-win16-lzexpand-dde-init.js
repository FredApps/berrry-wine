#!/usr/bin/env node
'use strict';

// Two Win16 pieces Sierra's Win 3.x SETUP (Betrayal in Antara demo) needs:
//
//  * LZEXPAND, emulated over LZ32: SETUP.EXE imports LZEXPAND.2 LZOpenFile
//    to unpack its second stage, and with no LZEXPAND.DLL on the machine the
//    import trapped. An LZ handle (0x400 + slot) passes through; a plain file
//    goes through the task's file map, as _lopen's does.
//  * DdeInitialize with afCmd = 0xFFFFFFFF (every flag, APPCLASS_MONITOR
//    included) succeeds, as Windows' DDEML lets it; refusing the monitor
//    class stopped the installer at "DdeInitialize returned 4004".

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func $t_segs
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 3) (i32.const 0x00120000)
      (i32.const 0x10000) (i32.const 2) (i32.const 3))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00110100))
    ;; Far return address 1:0x0020.
    (call $gs16 (i32.const 0x00110100) (i32.const 0x0020))
    (call $gs16 (i32.const 0x00110102) (call $win16_index_to_sel (i32.const 1))))
  (func (export "t_sel3") (result i32) (call $win16_index_to_sel (i32.const 3)))
  (func (export "t_word") (param $at i32) (param $v i32) (call $gs16 (local.get $at) (local.get $v)))

  ;; LZOpenFile("SETUP.SOL" at 3:0x10, OFSTRUCT at 3:0x100, OF_READ).
  (func (export "t_lz_open") (result i32)
    (call $t_segs)
    (call $gs16 (i32.const 0x00110104) (i32.const 0))                    ;; wStyle
    (call $gs16 (i32.const 0x00110106) (i32.const 0x0100))
    (call $gs16 (i32.const 0x00110108) (call $win16_index_to_sel (i32.const 3)))
    (call $gs16 (i32.const 0x0011010a) (i32.const 0x0010))
    (call $gs16 (i32.const 0x0011010c) (call $win16_index_to_sel (i32.const 3)))
    (call $win16_LZOpenFile)
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "t_fh32") (param $h i32) (result i32) (call $win16_fh32 (local.get $h)))
  (func (export "t_h16") (param $h i32) (result i32) (call $win16_lz_h16 (local.get $h)))
  (func (export "t_h32") (param $h i32) (result i32) (call $win16_lz_h32 (local.get $h)))

  (func (export "t_is_lz") (param $id i32) (result i32) (call $win16_module_is_lzexpand (local.get $id)))
  (func (export "t_name_slot") (param $i i32) (result i32) (call $win16_dynamic_module_slot (local.get $i)))
  (func (export "t_dyn_base") (result i32) (global.get $WIN16_DYNAMIC_BASE))

  ;; DdeInitialize(&id at 3:0x200, pfn 1:0x40, afCmd, ulRes 0).
  (func (export "t_dde_init") (param $afcmd i32) (result i32)
    (call $t_segs)
    (call $gs16 (i32.const 0x00110104) (i32.const 0))
    (call $gs16 (i32.const 0x00110106) (i32.const 0))
    (call $gs16 (i32.const 0x00110108) (i32.and (local.get $afcmd) (i32.const 0xFFFF)))
    (call $gs16 (i32.const 0x0011010a) (i32.shr_u (local.get $afcmd) (i32.const 16)))
    (call $gs16 (i32.const 0x0011010c) (i32.const 0x0040))
    (call $gs16 (i32.const 0x0011010e) (call $win16_index_to_sel (i32.const 1)))
    (call $gs16 (i32.const 0x00110110) (i32.const 0x0200))
    (call $gs16 (i32.const 0x00110112) (call $win16_index_to_sel (i32.const 3)))
    (call $win16_DdeInitialize)
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_dde_id") (result i32) (call $gl32 (i32.const 0x00120200)))
`;

(async () => {
  let wat;
  let created = 0;
  const harness = await bootRenderHarness({
    extraWat,
    extraHostOverrides: {
      fs_create_file() { created++; return 41; },
      fs_set_file_pointer() { return 0; },
      // An ordinary (not SZDD) file: LZInit hands the file handle back.
      fs_read_file(handle, buffer, requested, count) {
        assert.strictEqual(handle, 41);
        for (let i = 0; i < requested; i++) wat.guest_write8(buffer + i, i ? 0 : 0x4d);
        wat.guest_write32(count, requested);
        return 1;
      },
    },
  });
  wat = harness.exports;
  const mem = () => new Uint8Array(harness.memory.buffer);

  // An emulated module is recognised by the name the loader gave its slot.
  const slot = wat.t_name_slot(0);
  mem().set([8, ...Buffer.from('LZEXPAND')], slot);
  assert.strictEqual(wat.t_is_lz(wat.t_dyn_base()), 1, 'LZEXPAND in a dynamic slot is the emulated module');
  mem().set([3, ...Buffer.from('VER')], slot);
  assert.strictEqual(wat.t_is_lz(wat.t_dyn_base()), 0, 'another module name is not');
  assert.strictEqual(wat.t_is_lz(1), 0, 'KERNEL is not');

  // Handle mapping: LZ handles and LZERROR codes pass through as words.
  assert.strictEqual(wat.t_h16(0x401), 0x401);
  assert.strictEqual(wat.t_h32(0x401), 0x401);
  assert.strictEqual(wat.t_h16(-1), 0xFFFF, 'LZERROR_BADINHANDLE as a word');

  // LZOpenFile on a plain file: the task gets a 16-bit file handle that maps
  // back to the 32-bit one, and the Pascal frame (10 bytes) is popped.
  const name = Buffer.from('SETUP.SOL\0');
  for (let i = 0; i < name.length; i++) wat.guest_write8(0x00120010 + i, name[i]);
  const h16 = wat.t_lz_open() >>> 0;
  assert.strictEqual(created, 1, 'the file was opened');
  assert(h16 > 0 && h16 < 0x400, `a task file handle, not an LZ handle (0x${h16.toString(16)})`);
  assert.strictEqual(wat.t_fh32(h16), 41, 'it names the opened file');
  assert.strictEqual(wat.t_h32(h16), 41, 'and LZRead/LZClose map it back');
  assert.strictEqual(wat.t_esp() >>> 0, 0x00110100 + 4 + 10, 'far return + 10 argument bytes popped');

  // DdeInitialize with every afCmd bit set, monitor class included.
  assert.strictEqual(wat.t_dde_init(0xFFFFFFFF) >>> 0, 0, 'DdeInitialize(-1) succeeds');
  assert.notStrictEqual(wat.t_dde_id() >>> 0, 0, 'and returns an instance id');
  assert.strictEqual(wat.t_esp() >>> 0, 0x00110100 + 4 + 16, 'its 16 argument bytes are popped');
  console.log('PASS  Win16 LZEXPAND over LZ32, and DdeInitialize accepts afCmd = -1');
})().catch(error => { console.error(error); process.exit(1); });
