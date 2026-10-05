#!/usr/bin/env node

'use strict';

// I/O completion ports with a FILE attached.
//
// The port on its own is a concurrent queue: create, post, dequeue. That half
// already worked. The half that did not is the one Win32 calls asynchronous
// file I/O — CreateIoCompletionPort(hFile, hPort, key, 0) followed by
// ReadFile/WriteFile with an OVERLAPPED and no byte-count pointer, where the
// result comes back through GetQueuedCompletionStatus rather than through the
// call. Our layer used to refuse the association with $crash_unimplemented,
// which killed the calling guest thread and left every thread waiting on that
// port blocked forever.
//
// This exercise cannot come from an app test: the only binary in the corpus
// that takes the path is Warcraft III, five minutes of walking into a GL
// campaign briefing away, and its failure mode is a picture that stops
// changing. So the four calls are replayed directly against a VFS file whose
// bytes the test wrote itself, and the assertions are the ones a guest can
// actually observe:
//
//   * the association returns the port rather than 0
//   * an overlapped read reports FALSE + ERROR_IO_PENDING, as the guest's own
//     `cmp eax,0x3e5` arm expects
//   * the bytes land in the buffer FROM THE OVERLAPPED OFFSET, not from the
//     file pointer, and the file pointer does not move
//   * exactly one completion is queued, carrying the byte count, the
//     completion key the association was made with, and the guest's own
//     OVERLAPPED pointer
//   * OVERLAPPED.Internal/InternalHigh are filled in
//   * a read past EOF still completes, with STATUS_END_OF_FILE
//   * an overlapped request on an UNBOUND handle stays synchronous
//   * CloseHandle drops the binding, so a reused handle number cannot inherit
//     someone else's completion key

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const CONTENT = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ascii');
const KEY = 0x0BADF00D;
const ERROR_IO_PENDING = 997;
const STATUS_END_OF_FILE = 0xC0000011;

// Scratch guest addresses inside the image window the harness boots with.
const OVERLAPPED = 0x00420000;
const BUFFER = 0x00420100;
const OUT_BYTES = 0x00420200;
const OUT_KEY = 0x00420204;
const OUT_OVL = 0x00420208;
const OUT_READ = 0x0042020c;

const EXTRA_WAT = String.raw`
  (func (export "t_last_error") (result i32) (global.get $last_error))
  (func (export "t_iocp_create") (param $file i32) (param $port i32) (param $key i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0))
    (call $handle_CreateIoCompletionPort (local.get $file) (local.get $port)
      (local.get $key) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_iocp_get") (param $port i32) (param $lb i32) (param $lk i32)
      (param $lo i32) (param $ms i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0))
    (global.set $yield_reason (i32.const 0))
    (call $handle_GetQueuedCompletionStatus (local.get $port) (local.get $lb)
      (local.get $lk) (local.get $lo) (local.get $ms) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_read") (param $h i32) (param $buf i32) (param $n i32)
      (param $lr i32) (param $ovl i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0))
    (call $handle_ReadFile (local.get $h) (local.get $buf) (local.get $n)
      (local.get $lr) (local.get $ovl) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_write") (param $h i32) (param $buf i32) (param $n i32)
      (param $lw i32) (param $ovl i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0))
    (call $handle_WriteFile (local.get $h) (local.get $buf) (local.get $n)
      (local.get $lw) (local.get $ovl) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_close") (param $h i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_CloseHandle (local.get $h)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const harness = await bootRenderHarness({ extraWat: EXTRA_WAT });
  const wat = harness.exports;
  const ctx = harness.hostCtx;
  assert(ctx && ctx.vfs, 'the harness exposes its VFS');

  const w32 = (ga, v) => wat.guest_write32(ga >>> 0, v | 0);
  const r32 = (ga) => wat.guest_read32(ga >>> 0) >>> 0;
  const bytesAt = (ga, n) => {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i++) out[i] = wat.guest_read8(ga + i) & 0xff;
    return out;
  };
  // OVERLAPPED: Internal, InternalHigh, Offset, OffsetHigh, hEvent.
  const setOverlapped = (offset) => {
    for (let i = 0; i < 20; i += 4) w32(OVERLAPPED + i, 0);
    w32(OVERLAPPED + 8, offset);
  };

  ctx.vfs.files.set('c:\\async.dat', { data: new Uint8Array(CONTENT), attrs: 0x20 });

  // ---- the port itself ----------------------------------------------------
  const port = wat.t_iocp_create(-1, 0, 0) >>> 0;
  assert.notStrictEqual(port, 0, 'CreateIoCompletionPort(INVALID_HANDLE_VALUE) makes a port');
  assert.strictEqual(wat.t_iocp_create(-1, port, 0) >>> 0, 0,
    'INVALID_HANDLE_VALUE with an existing port is ERROR_INVALID_PARAMETER');
  assert.strictEqual(wat.t_last_error() >>> 0, 87,
    'and it says so through LastError');

  // ---- associating a file -------------------------------------------------
  const hFile = ctx.vfs.createFile('C:\\async.dat', 0xC0000000, 3) >>> 0;
  assert(hFile && hFile !== 0xFFFFFFFF, 'the fixture file opens');
  assert.strictEqual(wat.t_iocp_create(hFile, port, KEY) >>> 0, port,
    'associating a file returns the port it was attached to');
  assert.strictEqual(wat.t_iocp_create(hFile, 0x1234, KEY) >>> 0, 0,
    'associating with a handle that is not a port is ERROR_INVALID_HANDLE');
  assert.strictEqual(wat.t_last_error() >>> 0, 6, 'and it says so through LastError');

  // ---- an overlapped read -------------------------------------------------
  setOverlapped(10);
  for (let i = 0; i < 16; i += 4) w32(BUFFER + i, 0);
  assert.strictEqual(wat.t_read(hFile, BUFFER, 8, 0, OVERLAPPED) >>> 0, 0,
    'an overlapped read on a bound handle returns FALSE');
  assert.strictEqual(wat.t_last_error() >>> 0, ERROR_IO_PENDING,
    'with ERROR_IO_PENDING, which is the arm the guest tests for');
  assert.strictEqual(bytesAt(BUFFER, 8).toString('ascii'), CONTENT.slice(10, 18).toString('ascii'),
    'the bytes come from OVERLAPPED.Offset, not from the file pointer');
  assert.strictEqual(ctx.vfs.handles.get(hFile).pos, 0,
    'and an overlapped read does not move the file pointer');
  assert.strictEqual(r32(OVERLAPPED + 0), 0, 'OVERLAPPED.Internal is STATUS_SUCCESS');
  assert.strictEqual(r32(OVERLAPPED + 4), 8, 'OVERLAPPED.InternalHigh is the byte count');

  // ---- the completion it queued -------------------------------------------
  w32(OUT_BYTES, 0); w32(OUT_KEY, 0); w32(OUT_OVL, 0);
  assert.strictEqual(wat.t_iocp_get(port, OUT_BYTES, OUT_KEY, OUT_OVL, 0) >>> 0, 1,
    'the read queued a completion');
  assert.strictEqual(r32(OUT_BYTES), 8, 'the completion carries the byte count');
  assert.strictEqual(r32(OUT_KEY), KEY >>> 0, 'and the key the association was made with');
  assert.strictEqual(r32(OUT_OVL), OVERLAPPED, "and the guest's own OVERLAPPED pointer");
  assert.strictEqual(wat.t_iocp_get(port, OUT_BYTES, OUT_KEY, OUT_OVL, 0) >>> 0, 0,
    'exactly one completion was queued, not two');

  // ---- a read that runs off the end ---------------------------------------
  // A request that straddles EOF is an ordinary success for however many bytes
  // were there; only a request that starts at or past EOF is
  // STATUS_END_OF_FILE. Both must still produce a completion, because a
  // missing one is the deadlock this whole path exists to avoid.
  setOverlapped(CONTENT.length - 4);
  assert.strictEqual(wat.t_read(hFile, BUFFER, 64, 0, OVERLAPPED) >>> 0, 0,
    'a short read at EOF still reports FALSE');
  assert.strictEqual(wat.t_last_error() >>> 0, ERROR_IO_PENDING,
    'and still completes asynchronously');
  assert.strictEqual(r32(OVERLAPPED + 0), 0,
    'a partial read is a success, not an end-of-file status');
  assert.strictEqual(wat.t_iocp_get(port, OUT_BYTES, OUT_KEY, OUT_OVL, 0) >>> 0, 1,
    'a short read at EOF still queues its completion');
  assert.strictEqual(r32(OUT_BYTES), 4, 'reporting the bytes that were available');

  setOverlapped(CONTENT.length + 16);
  assert.strictEqual(wat.t_read(hFile, BUFFER, 8, 0, OVERLAPPED) >>> 0, 0,
    'a read that starts past EOF also reports FALSE');
  assert.strictEqual(r32(OVERLAPPED + 0), STATUS_END_OF_FILE >>> 0,
    'and OVERLAPPED.Internal reports STATUS_END_OF_FILE');
  assert.strictEqual(wat.t_iocp_get(port, OUT_BYTES, OUT_KEY, OUT_OVL, 0) >>> 0, 1,
    'a read past EOF queues a completion rather than parking the caller');
  assert.strictEqual(r32(OUT_BYTES), 0, 'carrying a zero byte count');

  // ---- an overlapped write ------------------------------------------------
  setOverlapped(4);
  w32(BUFFER, 0x7a7a7a7a); // "zzzz"
  assert.strictEqual(wat.t_write(hFile, BUFFER, 4, 0, OVERLAPPED) >>> 0, 0,
    'an overlapped write on a bound handle returns FALSE');
  assert.strictEqual(wat.t_last_error() >>> 0, ERROR_IO_PENDING, 'with ERROR_IO_PENDING');
  assert.strictEqual(ctx.vfs.handles.get(hFile).pos, 0,
    'and does not move the file pointer either');
  assert.strictEqual(
    Buffer.from(ctx.vfs.files.get('c:\\async.dat').data).toString('ascii'),
    '0123zzzz89ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'the bytes land at OVERLAPPED.Offset');
  assert.strictEqual(wat.t_iocp_get(port, OUT_BYTES, OUT_KEY, OUT_OVL, 0) >>> 0, 1,
    'the write queued its completion');
  assert.strictEqual(r32(OUT_BYTES), 4, 'carrying the byte count');

  // ---- an unbound handle stays synchronous --------------------------------
  const plain = ctx.vfs.createFile('C:\\async.dat', 0x80000000, 3) >>> 0;
  setOverlapped(0);
  w32(OUT_READ, 0);
  assert.strictEqual(wat.t_read(plain, BUFFER, 4, OUT_READ, OVERLAPPED) >>> 0, 1,
    'an OVERLAPPED on a handle bound to no port completes synchronously');
  assert.strictEqual(r32(OUT_READ), 4, 'reporting its byte count in the usual place');
  assert.strictEqual(wat.t_iocp_get(port, OUT_BYTES, OUT_KEY, OUT_OVL, 0) >>> 0, 0,
    'and queues nothing on anybody else\u2019s port');

  // ---- closing the file drops the binding ---------------------------------
  assert.strictEqual(wat.t_close(hFile) >>> 0, 1, 'the bound file closes');
  const reused = ctx.vfs.createFile('C:\\async.dat', 0xC0000000, 3) >>> 0;
  if (reused === hFile) {
    setOverlapped(0);
    w32(OUT_READ, 0);
    assert.strictEqual(wat.t_read(reused, BUFFER, 4, OUT_READ, OVERLAPPED) >>> 0, 1,
      'a reused handle number does not inherit the closed file\u2019s port binding');
    assert.strictEqual(wat.t_iocp_get(port, OUT_BYTES, OUT_KEY, OUT_OVL, 0) >>> 0, 0,
      'and posts nothing to the port it used to be bound to');
  }

  console.log('PASS  IOCP file associations complete overlapped reads and writes');
})().catch(err => { console.error(err); process.exit(1); });
