#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_diablo_runtime_init")
    (global.set $image_base (i32.const 0))
    (global.set $thunk_guest_base (i32.sub (global.get $THUNK_BASE) (global.get $GUEST_BASE))))
  (func (export "test_diablo_strstr") (param $hay i32) (param $needle i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_strstr (local.get $hay) (local.get $needle)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_diablo_acm_metric") (param $metric i32) (param $out i32) (result i32)
    (call $acm_metrics (i32.const 0) (local.get $metric) (local.get $out)))
  (func (export "test_diablo_dllonexit") (param $fn i32) (param $begin i32) (param $end i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle___dllonexit (local.get $fn) (local.get $begin) (local.get $end)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00300004))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
  (func (export "test_diablo_table_free") (param $ptr i32)
    (call $heap_free (local.get $ptr)))
  (func (export "test_diablo_api_thunk") (param $id i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (call $com_cont_thunk (i32.const 0)))
    (i32.store offset=4 (call $g2w (local.get $ptr)) (local.get $id))
    (local.get $ptr))
  (func (export "test_diablo_exit_thunk_init")
    (global.set $atexit_ret_thunk (call $com_cont_thunk (i32.const 0xCACA002C))))
  (func $test_diablo_onexit (export "test_diablo_onexit") (param $fn i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle__onexit (local.get $fn) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00300004))
      (then (unreachable)))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_diablo_onexit_full") (param $fn i32) (result i32)
    (local $count i32) (local $capacity i32) (local $result i32)
    (local.set $count (global.get $atexit_count))
    (local.set $capacity (global.get $atexit_capacity))
    ;; Exercise the registry's bounded growth failure without allocating GBs.
    (global.set $atexit_count (i32.const 0x10000000))
    (global.set $atexit_capacity (i32.const 0x10000000))
    (local.set $result (call $test_diablo_onexit (local.get $fn)))
    (global.set $atexit_count (local.get $count))
    (global.set $atexit_capacity (local.get $capacity))
    (local.get $result))
  (func (export "test_diablo_atexit_begin") (param $first i32) (param $second i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $atexit_exit_code (i32.const 0))
    (global.set $atexit_ret_thunk (i32.const 0x0040DEAD))
    (drop (call $crt_atexit_register (local.get $first)))
    (drop (call $crt_atexit_register (local.get $second)))
    (call $crt_atexit_run_next)
    (global.get $eip))
  (func (export "test_diablo_atexit_next") (result i32)
    (call $crt_atexit_run_next)
    (global.get $eip))
`;

(async () => {
  let exitCode = null;
  const { exports: wat } = await bootRenderHarness({
    extraWat,
    extraHostOverrides: { exit: code => { exitCode = code | 0; } },
  });
  wat.test_diablo_runtime_init();

  const writeAscii = (ptr, value) => {
    for (let i = 0; i < value.length; i++) wat.guest_write8(ptr + i, value.charCodeAt(i));
    wat.guest_write8(ptr + value.length, 0);
  };
  const hay = 0x1000;
  const needle = 0x1100;
  writeAscii(hay, 'storm-diablo-data');
  writeAscii(needle, 'diablo');
  assert.strictEqual(wat.test_diablo_strstr(hay, needle) >>> 0, hay + 6,
    'strstr returns the first matching guest pointer');
  writeAscii(needle, 'missing');
  assert.strictEqual(wat.test_diablo_strstr(hay, needle), 0,
    'strstr returns NULL when the substring is absent');
  writeAscii(needle, '');
  assert.strictEqual(wat.test_diablo_strstr(hay, needle) >>> 0, hay,
    'strstr returns the haystack for an empty needle');

  const metricOut = 0x1200;
  assert.strictEqual(wat.test_diablo_acm_metric(50, metricOut), 0,
    'ACM_METRIC_MAX_SIZE_FORMAT succeeds');
  assert.strictEqual(wat.guest_read32(metricOut), 18,
    'ACM_METRIC_MAX_SIZE_FORMAT includes the WAVEFORMATEX cbSize word');
  assert.strictEqual(wat.test_diablo_acm_metric(20, metricOut), 0,
    'ACM_METRIC_COUNT_LOCAL_DRIVERS succeeds');
  assert.strictEqual(wat.guest_read32(metricOut), 1,
    'the built-in PCM converter is exposed as one local ACM driver');

  const begin = 0x1300, end = 0x1304, otherBegin = 0x1310, otherEnd = 0x1314;
  for (const p of [begin, end, otherBegin, otherEnd]) wat.guest_write32(p, 0);
  const callbacks = Array.from({ length: 64 }, (_, i) => 0x405000 + i * 16);
  for (const fn of callbacks) {
    assert.strictEqual(wat.test_diablo_dllonexit(fn, begin, end), fn);
  }
  const table = wat.guest_read32(begin) >>> 0;
  assert.notStrictEqual(table, 0, '__dllonexit allocates the caller-owned table');
  assert.strictEqual(wat.guest_read32(end) >>> 0, table + callbacks.length * 4);
  assert.deepStrictEqual(callbacks.map((_, i) => wat.guest_read32(table + i * 4)), callbacks,
    'growth preserves registration order for reverse traversal by the DLL CRT');
  assert.strictEqual(wat.test_diablo_dllonexit(0x406000, otherBegin, otherEnd), 0x406000);
  assert.notStrictEqual(wat.guest_read32(otherBegin), table, 'DLLs own independent tables');
  assert.strictEqual(wat.test_crt_atexit_count(), 0, 'DLL callbacks never enter the process queue');
  assert.strictEqual(wat.test_diablo_dllonexit(0, begin, end), 0);
  assert.strictEqual(wat.test_diablo_dllonexit(0x407000, 0, end), 0);
  assert.strictEqual(wat.test_diablo_dllonexit(0x407000, begin, 0), 0);
  assert.strictEqual(wat.guest_read32(begin) >>> 0, table);
  assert.strictEqual(wat.guest_read32(end) >>> 0, table + 256);
  // Defensive malformed-span rejection, not a native invalid-pointer contract.
  wat.guest_write32(end, table - 4);
  assert.strictEqual(wat.test_diablo_dllonexit(0x407000, begin, end), 0);
  assert.strictEqual(wat.guest_read32(end) >>> 0, table - 4);
  wat.guest_write32(end, table + 1);
  assert.strictEqual(wat.test_diablo_dllonexit(0x407000, begin, end), 0);
  assert.strictEqual(wat.guest_read32(end) >>> 0, table + 1);
  // Synthetic span reaches heap_realloc's allocation refusal, without a huge allocation.
  wat.guest_write32(end, table + 0x7ffffff0);
  assert.strictEqual(wat.test_diablo_dllonexit(0x407000, begin, end), 0);
  assert.strictEqual(wat.guest_read32(begin) >>> 0, table);
  assert.strictEqual(wat.guest_read32(end) >>> 0, table + 0x7ffffff0);
  assert.deepStrictEqual(callbacks.map((_, i) => wat.guest_read32(table + i * 4)), callbacks);
  wat.test_diablo_table_free(table);
  wat.test_diablo_table_free(wat.guest_read32(otherBegin));

  // Execute real guest callback bodies, including a nested public _cexit call.
  const apiTable = require('../src/api_table.json');
  const cexit = wat.test_diablo_api_thunk(apiTable.find(row => row.name === '_cexit').id) >>> 0;
  const le32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
  const emit = (at, bytes) => bytes.forEach((b, i) => wat.guest_write8(at + i, b));
  const trace = 0x1400;
  const appendDigit = digit => [0x6b, 0x05, ...le32(trace), 10, 0x83, 0xc0, digit,
    0xa3, ...le32(trace)]; // eax = trace * 10 + digit; trace = eax
  const first = 0x480000, second = 0x480100, driver = 0x480200;
  emit(first, [...appendDigit(1), 0xc3]);
  emit(second, [...appendDigit(2), 0xb8, ...le32(cexit), 0xff, 0xd0,
    ...appendDigit(3), 0xc3]);
  emit(driver, [0xb8, ...le32(cexit), 0xff, 0xd0, ...appendDigit(4), 0xc3]);
  wat.guest_write32(trace, 0);
  wat.test_diablo_onexit(first);
  wat.test_crt_atexit_register(second);
  const runCleanup = () => {
    wat.set_esp(0x300000);
    wat.guest_write32(0x300000, 0);
    wat.set_eip(driver);
    wat.run(1000);
    assert.strictEqual(wat.get_eip(), 0, '_cexit resumes the caller to its sentinel return');
    assert.strictEqual(wat.get_esp(), 0x300004, 'nested cleanup preserves the guest stack');
    assert.strictEqual(exitCode, null, 'returning cleanup never calls host exit');
    assert.strictEqual(wat.test_crt_atexit_count(), 0);
  };
  runCleanup();
  assert.strictEqual(wat.guest_read32(trace), 2134,
    'LIFO callback 2 nests cleanup of callback 1, resumes itself, then returns to caller');
  runCleanup();
  assert.strictEqual(wat.guest_read32(trace), 21344, 'empty repeat does not rerun callbacks');
  wat.test_diablo_onexit(first);
  runCleanup();
  assert.strictEqual(wat.guest_read32(trace), 2134414, 'callbacks registered after cleanup still run');
  const onexit = wat.test_diablo_api_thunk(apiTable.find(row => row.name === '_onexit').id) >>> 0;
  const registering = 0x480300;
  emit(registering, [0x68, ...le32(first), 0xb8, ...le32(onexit), 0xff, 0xd0,
    0x83, 0xc4, 4, ...appendDigit(5), 0xc3]);
  wat.guest_write32(trace, 0);
  wat.test_crt_atexit_register(registering);
  runCleanup();
  assert.strictEqual(wat.guest_read32(trace), 514,
    'a callback can register another callback before returning to cleanup');
  wat.test_diablo_exit_thunk_init();
  const exit = wat.test_diablo_api_thunk(apiTable.find(row => row.name === 'exit').id) >>> 0;
  const exiting = 0x480400;
  emit(exiting, [0x6a, 7, 0xb8, ...le32(exit), 0xff, 0xd0, ...appendDigit(8), 0xc3]);
  wat.guest_write32(trace, 0);
  wat.test_diablo_onexit(first);
  wat.set_esp(0x300000);
  wat.set_eip(exiting);
  wat.run(1000);
  assert.strictEqual(wat.guest_read32(trace), 1, 'normal exit runs the callback but never resumes its caller');
  assert.strictEqual(exitCode, 7, 'normal exit retains the supplied status');
  assert.strictEqual(wat.test_crt_atexit_count(), 0);
  exitCode = null;

  assert.strictEqual(wat.test_diablo_onexit(0), 0, '_onexit rejects a NULL callback');
  assert.strictEqual(wat.test_crt_atexit_count(), 0, 'rejection does not register a callback');
  assert.strictEqual(wat.test_diablo_onexit(0x00403000) >>> 0, 0x00403000,
    '_onexit returns the registered function, not atexit status');
  assert.strictEqual(wat.test_crt_atexit_count(), 1,
    '_onexit must retain the callback rather than silently acknowledge it');
  assert.strictEqual(wat.test_diablo_onexit_full(0x00404000), 0,
    '_onexit translates registry capacity failure into NULL');
  assert.strictEqual(wat.test_diablo_atexit_begin(0x00401000, 0x00402000) >>> 0,
    0x00402000, 'normal exit starts with the last registered callback');
  assert.strictEqual(wat.test_crt_atexit_count(), 2,
    'both earlier callbacks remain after the first dispatch');
  assert.strictEqual(wat.guest_read32((wat.get_esp() >>> 0)), 0x0040DEAD,
    'atexit callbacks return through the dedicated continuation thunk');
  assert.strictEqual(wat.test_diablo_atexit_next() >>> 0, 0x00401000,
    'atexit callbacks drain in LIFO order');
  assert.strictEqual(exitCode, null, 'host termination waits for the earlier _onexit callback');
  assert.strictEqual(wat.test_diablo_atexit_next() >>> 0, 0x00403000,
    '_onexit and atexit use the same LIFO registry');
  wat.test_diablo_atexit_next();
  assert.strictEqual(exitCode, 0, 'the normal exit sequence calls the host after callbacks drain');

  console.log('PASS  Diablo CRT and ACM compatibility APIs preserve real contracts');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
