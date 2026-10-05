#!/usr/bin/env node

'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $write_fmt_test_delta (mut i32) (i32.const 0))

  (func (export "write_fmt_call")
      (param $stack i32) (param $storage i32) (param $format i32)
      (param $user_type i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_WriteFmtUserTypeStg
      (local.get $storage) (local.get $format) (local.get $user_type)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $write_fmt_test_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $stack)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "write_fmt_delta") (result i32)
    (global.get $write_fmt_test_delta))
  (export "write_fmt_sparse_map" (func $virtual_map_commit))
  (export "write_fmt_g2w" (func $g2w))
`;

function dword(bytes, value) {
  value >>>= 0;
  bytes.push(value & 0xff, (value >>> 8) & 0xff,
    (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function word(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function expectedCompObj(userType, format) {
  const bytes = [];
  const user = Array.from(userType, ch => ch.charCodeAt(0));
  const userAnsiBytes = user.length ? user.length + 1 : 0;
  const userUnicodeBytes = user.length ? (user.length + 1) * 2 : 0;

  dword(bytes, 0xfffe0001);
  dword(bytes, 0x00000a03);
  dword(bytes, 0xffffffff);
  dword(bytes, 0);
  dword(bytes, 0);
  dword(bytes, 0);
  dword(bytes, 0);

  dword(bytes, userAnsiBytes);
  for (const ch of user) bytes.push(ch <= 0xff ? ch : 0x3f);
  if (user.length) bytes.push(0);

  if (typeof format === 'number') {
    if (format === 0) {
      dword(bytes, 0);
    } else {
      dword(bytes, 0xffffffff);
      dword(bytes, format);
    }
  } else {
    dword(bytes, format.length + 1);
    for (const ch of format) bytes.push(ch.charCodeAt(0) & 0xff);
    bytes.push(0);
  }

  dword(bytes, 1);
  bytes.push(0);
  dword(bytes, 0x71b239f4);
  dword(bytes, userUnicodeBytes);
  for (const ch of user) word(bytes, ch);
  if (user.length) word(bytes, 0);

  if (typeof format === 'number') {
    if (format === 0) {
      dword(bytes, 0);
    } else {
      dword(bytes, 0xffffffff);
      dword(bytes, format);
    }
  } else {
    dword(bytes, format.length + 1);
    for (const ch of format) word(bytes, ch.charCodeAt(0));
    word(bytes, 0);
  }
  dword(bytes, 0);
  return Uint8Array.from(bytes);
}

(async () => {
  const row = apiTable.find(entry => entry.name === 'WriteFmtUserTypeStg');
  assert(row, 'WriteFmtUserTypeStg is registered');
  assert.strictEqual(row.id, 738);
  assert.strictEqual(row.nargs, 3);
  assert.strictEqual(row.convention, 'stdcall');
  assert.strictEqual(row.stub, undefined, 'WriteFmtUserTypeStg is a real handler');

  const harness = await bootRenderHarness({ fonts: 'none', extraWat });
  const e = harness.exports;
  const memory = harness.memory;
  const u8 = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const wa = gp => e.write_fmt_g2w(gp) >>> 0;
  const alloc = bytes => e.guest_alloc(bytes) >>> 0;
  const writeAnsi = text => {
    const gp = alloc(text.length + 1);
    for (let i = 0; i < text.length; i++) e.guest_write8(gp + i, text.charCodeAt(i));
    e.guest_write8(gp + text.length, 0);
    return gp;
  };
  const writeWide = text => {
    const gp = alloc((text.length + 1) * 2);
    for (let i = 0; i < text.length; i++) e.guest_write16(gp + i * 2, text.charCodeAt(i));
    e.guest_write16(gp + text.length * 2, 0);
    return gp;
  };
  const streamName = writeWide('\u0001CompObj');
  const readStream = stream => {
    const size = e.test_ole_stream_size(stream) >>> 0;
    const output = alloc(size || 1);
    const count = alloc(4);
    e.test_ole_stream_seek(stream, 0);
    assert.strictEqual(e.test_ole_stream_read(stream, output, size, count) >>> 0, 0);
    assert.strictEqual(e.guest_read32(count) >>> 0, size);
    return Uint8Array.from({ length: size }, (_, i) => e.guest_read8(output + i));
  };

  const stack = 0x074ff000;
  const lockbytes = e.test_ole_create_lockbytes(0, 1) >>> 0;
  const storage = e.test_ole_create_storage(lockbytes) >>> 0;
  assert(lockbytes && storage);

  const standardUserType = 'Picture \u03a9';
  assert.strictEqual(e.write_fmt_call(stack, storage, 8, writeWide(standardUserType)) >>> 0, 0,
    'CF_DIB metadata writes successfully');
  assert.strictEqual(e.write_fmt_delta(), 16, 'stdcall pops return address and three arguments');
  let stream = e.test_ole_find_stream(storage, streamName) >>> 0;
  assert(stream, '\\1CompObj stream was created');
  assert.deepStrictEqual(readStream(stream), expectedCompObj(standardUserType, 8),
    'standard format has exact ANSI and lossless Unicode MS-OLEDS fields');

  const pbrushName = writeAnsi('PBrush');
  const pbrushFormat = e.clipboard_register_format_a(pbrushName) >>> 0;
  assert(pbrushFormat >= 0xc000 && pbrushFormat <= 0xffff);

  // Put the authentic MSPaint user type across adjacent guest pages whose
  // backing pages are intentionally non-contiguous.
  const sparsePage = 0x30000000;
  assert.strictEqual(e.write_fmt_sparse_map(sparsePage, 0x1000) >>> 0, sparsePage);
  assert.strictEqual(e.write_fmt_sparse_map(0x28000000, 0x3000) >>> 0, 0x28000000);
  assert.strictEqual(e.write_fmt_sparse_map(sparsePage + 0x1000, 0x1000) >>> 0,
    sparsePage + 0x1000);
  assert.notStrictEqual((wa(sparsePage + 0xfff) + 1) >>> 0, wa(sparsePage + 0x1000),
    'fixture is non-affine at the guest page boundary');
  const sparsePBrush = sparsePage + 0xff8;
  for (let i = 0; i < 'PBrush'.length; i++) {
    e.guest_write16(sparsePBrush + i * 2, 'PBrush'.charCodeAt(i));
  }
  e.guest_write16(sparsePBrush + 'PBrush'.length * 2, 0);

  const originalStream = stream;
  assert.strictEqual(e.write_fmt_call(stack, storage, pbrushFormat, sparsePBrush) >>> 0, 0,
    'registered PBrush metadata reads a sparse non-affine LPOLESTR');
  assert.strictEqual(e.write_fmt_delta(), 16);
  stream = e.test_ole_find_stream(storage, streamName) >>> 0;
  assert.strictEqual(stream, originalStream, 'rewrite preserves an already-open stream identity');
  const pbrushPayload = expectedCompObj('PBrush', 'PBrush');
  assert.deepStrictEqual(readStream(stream), pbrushPayload,
    'registered format persists its name in ANSI and Unicode clipboard fields');

  const beforeFailure = readStream(stream);
  assert.strictEqual(e.write_fmt_call(stack, storage, 0xc123, sparsePBrush) >>> 0, 0x8004006a,
    'an unknown registered CLIPFORMAT reports DV_E_CLIPFORMAT');
  assert.strictEqual(e.write_fmt_delta(), 16);
  assert.deepStrictEqual(readStream(stream), beforeFailure,
    'unknown format failure leaves the existing stream byte-for-byte intact');
  assert.strictEqual(e.write_fmt_call(stack, storage, pbrushFormat, 0x31000000) >>> 0, 0x80004003,
    'an unmapped user-type pointer reports E_POINTER');
  assert.deepStrictEqual(readStream(stream), beforeFailure,
    'pointer failure is transactional');
  assert.strictEqual(e.write_fmt_call(stack, storage, pbrushFormat, 0) >>> 0, 0x80004003,
    'NULL user type reports E_POINTER');
  assert.strictEqual(e.write_fmt_call(stack, 0, pbrushFormat, sparsePBrush) >>> 0, 0x80004003,
    'NULL storage reports E_POINTER');
  const impostor = alloc(64);
  u8.fill(0, wa(impostor), wa(impostor) + 64);
  assert.strictEqual(e.write_fmt_call(stack, impostor, pbrushFormat, sparsePBrush) >>> 0,
    0x80030009, 'non-IStorage objects report STG_E_INVALIDPOINTER');

  const competing = e.test_ole_stream_clone(stream) >>> 0;
  assert(competing);
  assert.strictEqual(e.test_ole_stream_lock(competing, 0, pbrushPayload.length, 2) >>> 0, 0);
  assert.strictEqual(e.write_fmt_call(stack, storage, 8, writeWide('Locked rewrite')) >>> 0,
    0x80030021, 'a conflicting stream region reports STG_E_LOCKVIOLATION');
  e.test_ole_release(competing);
  assert.deepStrictEqual(readStream(stream), beforeFailure,
    'lock failure cannot truncate or partially rewrite the stream');

  assert.strictEqual(e.test_ole_storage_commit(storage) >>> 0, 0,
    'IStorage Commit serializes the metadata stream');
  const serializedData = e.test_ole_lockbytes_data(lockbytes) >>> 0;
  const serializedSize = e.test_ole_lockbytes_size(lockbytes) >>> 0;
  const serialized = Uint8Array.from({ length: serializedSize },
    (_, i) => e.guest_read8(serializedData + i));
  assert.deepStrictEqual(Array.from(serialized.slice(0, 8)),
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    'commit produces a CFB file');

  const freshBacking = alloc(serialized.length);
  for (let i = 0; i < serialized.length; i++) e.guest_write8(freshBacking + i, serialized[i]);
  const freshLockbytes = e.test_ole_create_lockbytes(freshBacking, 0) >>> 0;
  assert.strictEqual(e.test_ole_lockbytes_set_size(freshLockbytes, serialized.length) >>> 0, 0);
  const reopenedOut = alloc(4);
  assert.strictEqual(e.test_ole_cfb_deserialize(freshLockbytes, reopenedOut) >>> 0, 0,
    'a fresh ILockBytes reopens the committed CFB');
  const reopened = e.guest_read32(reopenedOut) >>> 0;
  const reopenedStream = e.test_ole_find_stream(reopened, streamName) >>> 0;
  assert(reopenedStream);
  assert.deepStrictEqual(readStream(reopenedStream), pbrushPayload,
    'reopened \\1CompObj retains exact PBrush user type and registered format');

  e.test_ole_release(reopenedStream);
  e.test_ole_release(reopened);
  e.test_ole_release(freshLockbytes);
  e.test_ole_release(stream);
  e.test_ole_release(originalStream);
  e.test_ole_release(storage);
  e.test_ole_release(lockbytes);

  console.log('PASS  WriteFmtUserTypeStg persists transactional MS-OLEDS \\1CompObj metadata');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
