#!/usr/bin/env node
'use strict';

// _strdup is an owning CRT boundary: it must allocate an independent,
// NUL-terminated guest copy and preserve cdecl stack cleanup. Keep this test
// on the public handler so the shared $guest_strdup path cannot silently drift.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const extraWat = String.raw`
  (func (export "test_strdup") (param $source i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle__strdup
      (local.get $source) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
  (func (export "test_free") (param $pointer i32)
    (call $heap_free (local.get $pointer)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.heap_init(0x00420000);
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);

  const invoke = source => {
    const packed = e.test_strdup(source);
    assert.strictEqual(Number(packed >> 32n) >>> 0, STACK + 4,
      '_strdup preserves one-argument cdecl cleanup');
    return Number(packed & 0xffffffffn) >>> 0;
  };
  const write = value => {
    const source = e.guest_alloc(value.length + 1) >>> 0;
    bytes.set(Buffer.from(`${value}\0`, 'latin1'), wa(source));
    return source;
  };
  const read = pointer => {
    let value = '';
    for (let offset = 0; offset < 256; offset++) {
      const byte = bytes[wa(pointer) + offset];
      if (!byte) return value;
      value += String.fromCharCode(byte);
    }
    throw new Error('unterminated _strdup result');
  };

  const source = write('independent guest copy');
  const copy = invoke(source);
  assert(copy && copy !== source, '_strdup returns a distinct allocation');
  assert.strictEqual(read(copy), 'independent guest copy');
  bytes[wa(source)] = 'X'.charCodeAt(0);
  assert.strictEqual(read(copy), 'independent guest copy',
    'mutating the caller buffer does not change the owned copy');

  const emptySource = write('');
  const emptyCopy = invoke(emptySource);
  assert(emptyCopy && emptyCopy !== emptySource, '_strdup allocates an empty string');
  assert.strictEqual(bytes[wa(emptyCopy)], 0, 'the empty copy is NUL-terminated');

  assert.strictEqual(invoke(0), 0,
    'the shared guest duplication path returns NULL for a NULL source');

  // guest_strlen's bounded scan must not make the owning helper underallocate.
  // Probe both sides of its 64-KiB limit and then allocate/mutate another block:
  // an unbounded copy into a capped allocation would overlap that new block.
  for (const length of [65535, 65536, 65537, 70000]) {
    const longSource = write('Q'.repeat(length));
    const longCopy = invoke(longSource);
    assert(longCopy && longCopy !== longSource, 'long string has an owned copy');
    assert(e.guest_read32(longCopy - 4) >= length + 5,
      `allocation covers ${length} bytes, the NUL, and its four-byte header`);
    const neighbor = e.guest_alloc(32) >>> 0;
    bytes.fill(0xa5, wa(neighbor), wa(neighbor) + 32);
    assert(bytes.subarray(wa(longCopy), wa(longCopy) + length).every(b => b === 0x51),
      `all ${length} copied bytes survive a subsequent allocation`);
    assert.strictEqual(bytes[wa(longCopy) + length], 0, 'long copy ends at its actual NUL');
    e.test_free(neighbor);
    e.test_free(longCopy);
    e.test_free(longSource);
  }

  e.test_free(copy);
  e.test_free(emptyCopy);
  console.log('PASS  _strdup returns an independent owned guest string');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
