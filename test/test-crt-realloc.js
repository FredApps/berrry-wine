#!/usr/bin/env node
'use strict';

// Microsoft CRT contract: failure retains the original allocation; size zero
// frees it. Exercise the real cdecl handler, not only the heap helper.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_crt_realloc") (param $ptr i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_realloc (local.get $ptr) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00300004))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
  (func (export "test_crt_errno") (result i32)
    (call $msvcrt_set_errno (i32.const 0))
    (global.get $msvcrt_errno_ptr))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const realloc = (ptr, size) => e.test_crt_realloc(ptr, size) >>> 0;
  const read = (ptr, size) => Array.from({ length: size }, (_, i) => e.guest_read8(ptr + i));
  const fill = (ptr, size, value) => {
    for (let i = 0; i < size; i++) e.guest_write8(ptr + i, value);
  };
  const errno = e.test_crt_errno() >>> 0;
  assert(errno);
  const original = realloc(0, 32);
  assert(original, 'NULL input allocates');
  fill(original, 32, 0x5a);
  const header = e.guest_read32(original - 4);
  assert.strictEqual(realloc(original, 0xfffffff0), 0, 'oversized allocation fails');
  assert.strictEqual(e.guest_read32(original - 4), header, 'failure preserves original header');
  assert.deepStrictEqual(read(original, 32), new Array(32).fill(0x5a),
    'failure must not free or overwrite original allocation');
  assert.strictEqual(e.guest_read32(errno), 12, 'failure sets ENOMEM');
  const peer = realloc(0, 32);
  assert(peer && peer !== original, 'failed realloc must not put original on free list');
  fill(peer, 32, 0xa6);
  e.guest_write32(errno, 77);
  const grown = realloc(original, 128);
  assert(grown, 'growth succeeds after refused oversized allocation');
  assert.deepStrictEqual(read(grown, 32), new Array(32).fill(0x5a));
  assert.deepStrictEqual(read(peer, 32), new Array(32).fill(0xa6), 'neighbor remains intact');
  assert.strictEqual(e.guest_read32(errno), 77, 'success does not clear errno');
  const shrunk = realloc(grown, 7);
  assert(shrunk);
  assert.deepStrictEqual(read(shrunk, 7), new Array(7).fill(0x5a));
  assert.strictEqual(realloc(shrunk, 0), 0, 'non-null size-zero call frees and returns NULL');
  assert.strictEqual(e.guest_read32(errno), 77, 'size-zero free is not ENOMEM');
  assert.strictEqual(realloc(0, 0xfffffff0), 0, 'NULL-input allocation failure');
  assert.strictEqual(e.guest_read32(errno), 12);
  e.guest_free(peer);
  console.log('PASS  CRT realloc failure ownership, growth/shrink, zero-size, errno and cdecl stack');
})().catch(error => { console.error(error); process.exit(1); });
