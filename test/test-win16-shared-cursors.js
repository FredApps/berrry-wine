#!/usr/bin/env node
'use strict';

// A second Win16 task runs as its own wasm instance over the shared memory
// (docs/win16-multitask-design.md). Every mutable global is per instance, but
// the selector table, sub-selector pool, handle map and thunk table are
// shared, so the cursors that allocate from them must be shared too --
// otherwise both tasks are handed the same selector and the same handle.
//
// Two instances over one memory, allocating alternately, must never collide.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "t_seg") (result i32) (call $win16_alloc_segment))
  (func (export "t_h16") (param $h i32) (result i32) (call $win16_h16 (local.get $h)))
  (func (export "t_next_seg") (result i32) (call $win16_next_seg_get))
  (func (export "t_sub_next") (result i32) (call $win16_sub_next_get))
`;

(async () => {
  const a = await bootRenderHarness({ fonts: 'none', extraWat });
  const b = await bootRenderHarness({ fonts: 'none', extraWat, memory: a.memory });
  const A = a.exports, B = b.exports;

  assert.strictEqual(A.t_sub_next(), 1024, 'zeroed memory reads as the first sub-selector');

  const segs = [A.t_seg(), B.t_seg(), A.t_seg(), B.t_seg()].map(v => v >>> 0);
  assert.strictEqual(new Set(segs).size, segs.length, `segments are distinct: ${segs}`);
  assert.strictEqual(A.t_next_seg(), B.t_next_seg(), 'both instances see one cursor');

  const handles = [A.t_h16(0x10001), B.t_h16(0x20002), A.t_h16(0x30003)].map(v => v >>> 0);
  assert.strictEqual(new Set(handles).size, handles.length, `handles are distinct: ${handles}`);
  assert.strictEqual(B.t_h16(0x10001) >>> 0, handles[0],
    'a handle one instance mapped is the same 16-bit handle in the other');

  console.log('PASS  Win16 allocator cursors are shared across task instances');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
