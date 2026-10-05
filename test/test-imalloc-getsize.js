#!/usr/bin/env node

'use strict';

// IMalloc::GetSize / DidAlloc must recognise a live block by its arena, not by
// "below this instance's bump pointer". Once the allocator had moved on, an
// older block answered GetSize = -1, and msvbvm60's memset(p, 0, GetSize(p))
// right after Alloc became a 4 GB rep stosd that wiped the register file
// (JigSawedME hung inside one batch for good). Here the bump pointer is moved
// below the block to stand in for that chunk switch.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_alloc") (param $n i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IMalloc_Alloc (i32.const 0) (local.get $n)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_get_size") (param $p i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IMalloc_GetSize (i32.const 0) (local.get $p)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_did_alloc") (param $p i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IMalloc_DidAlloc (i32.const 0) (local.get $p)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_heap_ptr") (result i32) (global.get $heap_ptr))
  (func (export "t_set_heap_ptr") (param $v i32) (global.set $heap_ptr (local.get $v)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });

  const p = wat.t_alloc(100) >>> 0;
  assert.notStrictEqual(p, 0, 'IMalloc::Alloc returns a block');
  const size = wat.t_get_size(p) >>> 0;
  assert(size >= 100 && size < 0x1000, `GetSize of a fresh block is its payload size (got 0x${size.toString(16)})`);
  assert.strictEqual(wat.get_esp(), 0x0030000c, 'GetSize has stdcall cleanup of 12');
  assert.strictEqual(wat.t_did_alloc(p), 1, 'DidAlloc owns a fresh block');

  const saved = wat.t_heap_ptr();
  wat.t_set_heap_ptr(p - 4);   // the allocator has moved to a chunk below p
  assert.strictEqual(wat.t_get_size(p) >>> 0, size,
    'GetSize of a live block does not depend on where the bump pointer is now');
  assert.strictEqual(wat.t_did_alloc(p), 1,
    'DidAlloc of a live block does not depend on where the bump pointer is now');
  wat.t_set_heap_ptr(saved);

  assert.strictEqual(wat.t_get_size(0x00401000) >>> 0, 0xFFFFFFFF,
    'GetSize of a pointer no arena covers is (SIZE_T)-1');
  assert.strictEqual(wat.t_did_alloc(0x00401000), 0,
    'DidAlloc of a pointer no arena covers is 0');

  console.log('PASS  IMalloc::GetSize/DidAlloc recognise live blocks by arena, not bump pointer');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
