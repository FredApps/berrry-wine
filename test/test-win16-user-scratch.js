#!/usr/bin/env node
'use strict';
// USER callback structs must not alias a runtime-managed DGROUP (VB1).
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'bitmap', extraWat: `
    (func (export "scratch_setup") (result i32)
      (global.set $win16_next_seg (i32.const 1))
      (global.set $win16_auto_data (call $win16_alloc_segment))
      (drop (call $win16_alloc_segment))
      (global.set $win16_msg_slot (i32.const 0))
      (call $win16_set_sreg (i32.const 3) (call $win16_index_to_sel (i32.const 1)))
      (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
      (global.set $esp (i32.add (call $win16_seg_base (i32.const 2)) (i32.const 0xF000)))
      (call $win16_seg_base (i32.const 1)))
    (func (export "scratch_message") (param $src i32) (result i32)
      (call $win16_msg_lparam16 (i32.const 0x2B) (local.get $src)))
    (func (export "scratch_far") (param $p i32) (result i32)
      (call $win16_far_to_guest (i32.shr_u (local.get $p) (i32.const 16))
        (i32.and (local.get $p) (i32.const 65535))))
    (func (export "scratch_font") (param $face i32)
      (global.set $win16_ef_face (call $g2w (local.get $face)))
      (global.set $win16_ef_hdc (i32.const 0))
      (global.set $win16_ef_proc
        (i32.shl (call $win16_index_to_sel (i32.const 2)) (i32.const 16)))
      (call $win16_ef_enter))
  ` });
  const dg = e.scratch_setup(), bytes = new Uint8Array(memory.buffer);
  const dgW = e.guest_to_wasm(dg);
  bytes.fill(0x5a, dgW, dgW + 65536);
  const original = bytes.slice(dgW, dgW + 65536);
  const src = e.guest_alloc(64), sw = e.guest_to_wasm(src), view = new DataView(memory.buffer);
  const fields = [4, 503, 2, 1, 0, 0, 0, -3, 4, 50, 60, 0x12345678];
  fields.forEach((value, i) => view.setUint32(sw + i * 4, value, true));
  const pointers = [];
  for (let i = 0; i < 5; i++) {
    const far = e.scratch_message(src) >>> 0;
    pointers.push(far);
    const dst = e.scratch_far(far), dw = e.guest_to_wasm(dst);
    assert(dst < dg || dst >= dg + 65536, 'DRAWITEM must not reside in DGROUP');
    assert.strictEqual(view.getUint16(dw, true), 4);
    assert.strictEqual(view.getUint16(dw + 2, true), 503);
    assert.strictEqual(view.getInt16(dw + 14, true), -3);
    assert.strictEqual(view.getUint16(dw + 20, true), 60);
    assert.strictEqual(view.getUint32(dw + 22, true), 0x12345678);
  }
  assert.strictEqual(new Set(pointers.slice(0, 4)).size, 4);
  assert.strictEqual(pointers[4], pointers[0], 'bounded ring reuses its selector');
  assert.deepStrictEqual(bytes.slice(dgW, dgW + 65536), original);
  const face = e.guest_alloc(16), fw = e.guest_to_wasm(face);
  bytes.set(Buffer.from('System\0'), fw);
  e.scratch_font(face);
  // Pascal callback entry: return far(4), data(4), type(2), TM far(4), LF far(4).
  const stack = e.guest_to_wasm(e.get_esp());
  const tmFar = view.getUint32(stack + 10, true), lfFar = view.getUint32(stack + 14, true);
  assert.strictEqual(tmFar >>> 16, pointers[0] >>> 16);
  assert.strictEqual(lfFar >>> 16, pointers[0] >>> 16);
  assert.strictEqual((lfFar & 65535), 128);
  assert.strictEqual((tmFar & 65535), 180);
  const lf = e.guest_to_wasm(e.scratch_far(lfFar));
  assert.strictEqual(Buffer.from(bytes.slice(lf + 18, lf + 25)).toString(), 'System\0');
  assert.deepStrictEqual(bytes.slice(dgW, dgW + 65536), original,
    'message and font callbacks preserve all runtime-owned DGROUP bytes');
  console.log('PASS Win16 USER scratch: separate selector, ring reuse, DRAWITEM/font ABI, intact DGROUP');
})().catch(error => { console.error(error); process.exitCode = 1; });
