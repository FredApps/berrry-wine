#!/usr/bin/env node
'use strict';

// fclose and _close are separate CRT front doors, but this minimal CRT maps
// both FILE* and file descriptors directly to an unbuffered VFS handle. Pin
// the shared close/result path without erasing either handler's cdecl ABI.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', '09a6-handlers-crt.wat'), 'utf8');

assert.strictEqual((source.match(/\$crt_close_unbuffered_handle/g) || []).length, 5,
  'one close helper serves fclose, _close, freopen and termination');
assert.strictEqual((source.match(/\$host_fs_close_handle/g) || []).length, 1,
  'CRT close result translation should have one host-close implementation');

const extraWat = String.raw`
  (func (export "test_stream_init")
    (global.set $image_base (i32.const 0))
    (global.set $thunk_guest_base (i32.sub (global.get $THUNK_BASE) (global.get $GUEST_BASE))))
  (func (export "test_fopen") (param $path i32) (param $mode i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_fopen (local.get $path) (local.get $mode)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_freopen") (param $path i32) (param $mode i32) (param $handle i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_freopen (local.get $path) (local.get $mode) (local.get $handle)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_stream_cleanup") (param $normal i32)
    (global.set $yield_flag (i32.const 0))
    (global.set $yield_reason (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $gs32 (i32.const ${STACK}) (i32.const 0))
    (if (local.get $normal)
      (then
        (global.set $atexit_ret_thunk (call $com_cont_thunk (i32.const 0xCACA002C)))
        (call $handle_exit (i32.const 9) (i32.const 0) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0)))
      (else
        (call $handle__cexit (i32.const 0) (i32.const 0) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0)))))
  (func (export "test_stream_api") (param $id i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (call $com_cont_thunk (i32.const 0)))
    (i32.store offset=4 (call $g2w (local.get $ptr)) (local.get $id))
    (local.get $ptr))
  (func $test_crt_close_result (result i64)
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))

  (func (export "test_fclose") (param $handle i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_fclose
      (local.get $handle) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $test_crt_close_result))

  (func (export "test__close") (param $handle i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle__close
      (local.get $handle) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $test_crt_close_result))
`;

(async () => {
  const calls = [];
  let hostResult = 1;
  let nextHandle = 100;
  const events = [];
  let e;
  const overrides = {
    fs_create_file() { events.push(['open', nextHandle]); return nextHandle; },
    fs_close_handle(handle) {
      calls.push(handle >>> 0);
      events.push(['close', handle >>> 0]);
      return hostResult;
    },
    fs_write_file(handle, buf, len, out) {
      events.push(['write', handle]);
      e.guest_write32(out, len);
      return 1;
    },
    exit(code) { events.push(['exit', code]); },
  };
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: overrides,
  });
  e = harness.exports;
  e.test_stream_init();

  const invoke = (entry, handle, expectedResult) => {
    const packed = entry(handle);
    assert.strictEqual(Number(packed & 0xffffffffn) >>> 0, expectedResult >>> 0,
      'handler translates the host close result to the CRT return value');
    assert.strictEqual(Number(packed >> 32n) >>> 0, STACK + 4,
      'one-argument cdecl handler pops only its return address');
  };

  hostResult = 1;
  invoke(e.test_fclose, 0x12345678, 0);
  invoke(e.test__close, 0x87654321, 0);
  hostResult = 0;
  invoke(e.test_fclose, 0x10203040, -1);
  invoke(e.test__close, 0xfedcba98, -1);

  assert.deepStrictEqual(calls, [0x12345678, 0x87654321, 0x10203040, 0xfedcba98],
    'both front doors pass the original FILE*/descriptor value to the VFS');
  hostResult = 1;
  events.length = 0;
  const filename = 0x1000, mode = 0x1100;
  const ascii = (p, s) => [...s, '\0'].forEach((c, i) => e.guest_write8(p + i, c.charCodeAt(0)));
  ascii(filename, 'cleanup.txt');
  ascii(mode, 'w');
  const open = (handle, instance = e) => {
    nextHandle = handle;
    assert.strictEqual(instance.test_fopen(filename, mode), handle === -1 ? 0 : handle);
  };
  const cleanup = normal => {
    e.test_stream_cleanup(normal);
    e.run(1000);
    assert.strictEqual(e.get_eip(), 0);
  };
  open(100);
  open(101);
  invoke(e.test_fclose, 100, 0);
  events.length = 0;
  cleanup(0);
  assert.deepStrictEqual(events, [['close', 101]], 'returning cleanup closes only live CRT streams');
  cleanup(0);
  assert.deepStrictEqual(events, [['close', 101]], 'repeated cleanup does not close twice');

  open(100); // host handle reuse after an explicit close must be tracked anew
  events.length = 0;
  cleanup(1);
  assert.deepStrictEqual(events, [['close', 100], ['exit', 9]], 'normal exit closes before host termination');
  open(-1);
  events.length = 0;
  cleanup(0);
  assert.deepStrictEqual(events, [], 'failed fopen adds no cleanup entry');

  open(102);
  nextHandle = 103;
  events.length = 0;
  assert.strictEqual(e.test_freopen(filename, mode, 102), 103);
  cleanup(0);
  assert.deepStrictEqual(events, [['close', 102], ['open', 103], ['close', 103]]);
  open(104);
  nextHandle = -1;
  events.length = 0;
  assert.strictEqual(e.test_freopen(filename, mode, 104), 0, 'failed reopen cannot report the old stream as success');
  cleanup(0);
  assert.deepStrictEqual(events, [['close', 104], ['open', -1]], 'failed replacement still closes its original');
  open(107);
  open(108);
  hostResult = 0;
  events.length = 0;
  cleanup(0);
  assert.deepStrictEqual(events, [['close', 108], ['close', 107]], 'one close error cannot strand other streams');
  hostResult = 1;
  events.length = 0;
  cleanup(0);
  assert.deepStrictEqual(events, [], 'failed closes do not leave stale ownership records');

  // A second WASM instance shares the process ownership list, not its globals.
  const peer = (await bootRenderHarness({ extraWat, fonts: 'none',
    memory: harness.memory, extraHostOverrides: overrides })).exports;
  peer.init_thread(1, 0, 0, 0, 0, 0, 0);
  peer.test_stream_init();
  open(105, peer);
  events.length = 0;
  cleanup(0);
  assert.deepStrictEqual(events, [['close', 105]], 'main cleanup sees another instance\'s stream');

  // Real guest callback writes through a public CRT thunk before closure.
  const fputs = e.test_stream_api(require('../src/api_table.json').find(row => row.name === 'fputs').id) >>> 0;
  const le32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
  ascii(0x1200, 'callback output');
  const callback = [0x68, ...le32(106), 0x68, ...le32(0x1200), 0xb8, ...le32(fputs),
    0xff, 0xd0, 0x83, 0xc4, 8, 0xc3];
  callback.forEach((b, i) => e.guest_write8(0x480000 + i, b));
  for (const normal of [0, 1]) {
    open(106);
    assert.strictEqual(e.test_crt_atexit_register(0x480000), 0);
    events.length = 0;
    cleanup(normal);
    assert.deepStrictEqual(events, [['write', 106], ['close', 106],
      ...(normal ? [['exit', 9]] : [])], 'callbacks retain usable streams until they finish');
  }
  // Repeat against the real VFS: bytes survive and the close operation lands.
  // VFS currently retains closed records; rejecting subsequent I/O is a
  // separate known host-layer gap, not a contract this test blesses.
  const actual = await bootRenderHarness({ extraWat, fonts: 'none' });
  e = actual.exports;
  e.test_stream_init();
  ascii(filename, 'cleanup.txt');
  ascii(mode, 'w');
  ascii(0x1200, 'callback output');
  const realFputs = e.test_stream_api(require('../src/api_table.json').find(row => row.name === 'fputs').id) >>> 0;
  for (const normal of [0, 1]) {
    const stream = e.test_fopen(filename, mode) >>> 0;
    assert.notStrictEqual(stream, 0);
    const vfs = actual.hostCtx.vfs;
    const filePath = vfs.handles.get(stream).path;
    const address = 0x481000 + normal * 0x100;
    const bytes = [0x68, ...le32(stream), 0x68, ...le32(0x1200), 0xb8, ...le32(realFputs),
      0xff, 0xd0, 0x83, 0xc4, 8, 0xc3];
    bytes.forEach((b, i) => e.guest_write8(address + i, b));
    e.test_crt_atexit_register(address);
    cleanup(normal);
    const record = vfs.handles.get(stream);
    assert(!record || record.closed, 'cleanup reaches the real VFS close operation');
    assert.strictEqual(Buffer.from(vfs.files.get(filePath).data).toString(), 'callback output',
      'callback output survives stream closure in the real VFS');
  }
  console.log('PASS  fclose/_close share raw close mechanics and preserve distinct CRT ABIs');
  console.log('PASS  CRT streams close after callbacks, including cross-instance ownership and reopen failures');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
