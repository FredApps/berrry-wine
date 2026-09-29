#!/usr/bin/env node
'use strict';

// Two Win16 shapes Civilization II's Civilopedia (GET_INFO.EXE, an Authorware
// runtime) depends on:
//
// 1. LoadBitmap(NULL, OBM_*) returns a real system bitmap at the size USER
//    ships. It returned 0 and Authorware stopped with
//    "Internal Error main2_w, 150".
// 2. TEXTMETRIC16 is not the Win32 structure with its ints narrowed. The
//    Win32 layout puts the five BYTE chars (+44) before Italic/Underlined/
//    StruckOut (+48). The 16-bit one puts the style bytes first (+16) and the
//    chars after (+19). Copying the Win32 order made every font look italic
//    and gave it the wrong charset.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "t_obm") (param $id i32) (result i32)
      (call $gdi_object_record (call $gdi_bitmap_create_system (local.get $id))))
    (func (export "t_rec_w") (param $r i32) (result i32) (call $gdi_bitmap_record_width (local.get $r)))
    (func (export "t_rec_h") (param $r i32) (result i32) (call $gdi_bitmap_record_height (local.get $r)))
    (func (export "t_is_obm") (param $id i32) (result i32) (call $obm_is_system (local.get $id)))
    (func (export "t_scratch") (result i32) (call $w2g (global.get $GUEST_STACK)))
    (func (export "t_g2w") (param $ga i32) (result i32) (call $g2w (local.get $ga)))
    (func (export "t_narrow") (param $dst i32) (param $src i32)
      (call $win16_tm_narrow (local.get $dst) (local.get $src)))
  ` });

  const sizes = {
    32754: [36, 18],  // OBM_CLOSE: two Win3.x system-menu bars
    32753: [16, 16],  // OBM_UPARROW
    32740: [16, 16],  // OBM_DNARROWD
    32747: [18, 18],  // OBM_RESTORE
    32749: [18, 18],  // OBM_REDUCE
    32739: [13, 13],  // OBM_MNARROW
    32738: [16, 16],  // OBM_COMBO
    32760: [13, 13],  // OBM_CHECK
  };
  for (const [id, [w, h]] of Object.entries(sizes)) {
    const rec = e.t_obm(+id) >>> 0;
    assert.notStrictEqual(rec, 0, `OBM ${id} creates a bitmap`);
    assert.deepStrictEqual([e.t_rec_w(rec), e.t_rec_h(rec)], [w, h], `OBM ${id} size`);
  }
  assert.strictEqual(e.t_is_obm(32733), 0, 'below the OBM range is not a system bitmap');
  assert.strictEqual(e.t_is_obm(100), 0, 'an ordinary resource id is not a system bitmap');

  const base = e.t_scratch() >>> 0;
  const gsrc = base + 0x100, gdst = base + 0x200;
  const src = e.t_g2w(gsrc) >>> 0, dst = e.t_g2w(gdst) >>> 0;
  const u8 = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  u8.fill(0xEE, src, src + 0x100);
  // Win32 TEXTMETRICA: eleven LONGs, four BYTE chars (+44), then Italic,
  // Underlined, StruckOut, PitchAndFamily, CharSet (+48..+52).
  for (let i = 0; i < 11; i++) dv.setInt32(src + i * 4, 10 + i, true);
  [0x20, 0xFF, 0x2E, 0x20].forEach((b, i) => { u8[src + 44 + i] = b; });
  [1, 0, 1, 0x31, 0xA2].forEach((b, i) => { u8[src + 48 + i] = b; });
  e.t_narrow(gdst, gsrc);

  const w = off => dv.getInt16(dst + off, true);
  assert.deepStrictEqual([0, 2, 4, 6, 8, 10, 12, 14].map(w), [10, 11, 12, 13, 14, 15, 16, 17],
    'Height..Weight are the first eight Win32 LONGs as words');
  assert.deepStrictEqual([...u8.subarray(dst + 16, dst + 19)], [1, 0, 1],
    'Italic/Underlined/StruckOut come right after Weight');
  assert.deepStrictEqual([...u8.subarray(dst + 19, dst + 23)], [0x20, 0xFF, 0x2E, 0x20],
    'FirstChar..BreakChar follow the style bytes');
  assert.deepStrictEqual([u8[dst + 23], u8[dst + 24]], [0x31, 0xA2],
    'PitchAndFamily/CharSet at +23/+24');
  assert.deepStrictEqual([w(25), w(27), w(29)], [18, 19, 20],
    'Overhang/DigitizedAspectX/Y sit after PitchAndFamily/CharSet');

  console.log('PASS  Win16 OBM system bitmaps and TEXTMETRIC16 layout');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
