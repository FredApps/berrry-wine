#!/usr/bin/env node
'use strict';

// msvcrt strncat(dest, src, count): append at most `count` characters of src
// at dest's terminator, stop early at src's NUL, always terminate, never pad,
// return dest; cdecl, so the handler pops only the return address. A body for
// it existed without an api_table entry, so every import of it resolved to
// "UNIMPLEMENTED API: strncat" (ScummVM FOTAQ, first gameplay room).
//
// fputc(c, stream) writes the one byte (unsigned char)c and returns it, or EOF
// when the write fails; FOTAQ hit it a few batches after strncat.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const SP = 0x00300000;

const extraWat = String.raw`
  (func (export "test_sc_alloc") (param $n i32) (result i32)
    (local $p i32)
    (local.set $p (call $heap_alloc (local.get $n)))
    (memory.fill (call $g2w (local.get $p)) (i32.const 0x7e) (local.get $n))
    (local.get $p))

  (func (export "test_sc_strncat") (param $d i32) (param $s i32) (param $n i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${SP}))
    (call $handle_strncat (local.get $d) (local.get $s) (local.get $n)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  ;; cdecl frame on a real guest stack: [esp] ret, [esp+4] c, [esp+8] stream.
  (func (export "test_sc_fputc") (param $stack i32) (param $c i32) (param $stream i32) (result i32)
    (call $gs32 (i32.add (local.get $stack) (i32.const 4)) (local.get $c))
    (call $gs32 (i32.add (local.get $stack) (i32.const 8)) (local.get $stream))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_fputc (local.get $c) (local.get $stream)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const writes = [];
  let failWrites = false;
  let e = null;
  ({ exports: e } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      fs_write_file: (handle, bufGA, len, bytesWrittenGA) => {
        if (failWrites) return 0;
        const bytes = [];
        for (let i = 0; i < len; i++) bytes.push(e.guest_read8(bufGA + i));
        writes.push({ handle: handle >>> 0, bytes });
        e.guest_write32(bytesWrittenGA, len);
        return 1;
      },
    },
  }));
  const put = (ga, s) => { for (let i = 0; i <= s.length; i++) e.guest_write8(ga + i, i < s.length ? s.charCodeAt(i) : 0); };
  const get = (ga, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(e.guest_read8(ga + i)); return s; };

  const dest = e.test_sc_alloc(32);
  const src = e.test_sc_alloc(16);
  put(dest, 'ab');
  put(src, 'cdef');

  assert.strictEqual(e.test_sc_strncat(dest, src, 2) >>> 0, dest, 'returns dest');
  assert.strictEqual(e.get_esp() >>> 0, SP + 4, 'cdecl: pops only the return address');
  assert.strictEqual(get(dest, 6), 'abcd\0~', 'appends count chars and terminates without padding');

  e.test_sc_strncat(dest, src, 100);
  assert.strictEqual(get(dest, 10), 'abcdcdef\0~', 'stops at the source NUL when count is larger');

  e.test_sc_strncat(dest, src, 0);
  assert.strictEqual(get(dest, 10), 'abcdcdef\0~', 'count 0 appends nothing');

  console.log('PASS  strncat appends, terminates, never pads, returns dest');

  const stack = e.test_sc_alloc(64);
  const STREAM = 0x70000014;
  assert.strictEqual(e.test_sc_fputc(stack, 0x1e6, STREAM), 0xe6,
    'fputc returns the byte written as unsigned char');
  assert.strictEqual(e.get_esp() >>> 0, stack + 4, 'cdecl: pops only the return address');
  assert.deepStrictEqual(writes, [{ handle: STREAM, bytes: [0xe6] }],
    'exactly one byte, the low byte of c, reaches the stream');
  failWrites = true;
  assert.strictEqual(e.test_sc_fputc(stack, 0x41, STREAM), -1, 'a failed write returns EOF');
  console.log('PASS  fputc writes one byte and returns it, EOF on failure');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
