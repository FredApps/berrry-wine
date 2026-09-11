#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_prepare_resume")
    (global.set $eip (i32.const 0x00401234))
    (i32.store (global.get $THREAD_BASE) (i32.const 45))
    (i32.store offset=4 (global.get $THREAD_BASE) (i32.const 0))
    (global.set $resume_ip (global.get $THREAD_BASE)))
  (func (export "test_resume_ip") (result i32) (global.get $resume_ip))
  (func (export "test_sync_depth") (param $n i32) (global.set $sync_msg_depth (local.get $n)))
  (func (export "test_arm_deadline") (param $deadline f64)
    (global.set $run_deadline_enabled (i32.const 1))
    (global.set $run_deadline_ms (local.get $deadline))
    (global.set $run_deadline_countdown (i32.const 0))
    (global.set $run_deadline_hit (i32.const 0)))
  (func (export "test_poll") (result i32) (call $run_deadline_poll))
  (func (export "test_prepare_trap")
    (global.set $eip (i32.const 0x00401234))
    ;; Out-of-bounds decoded operand makes the mandatory resume trap in run(),
    ;; after the plain-run wrapper has disabled the enclosing deadline.
    (global.set $resume_ip (i32.sub (i32.shl (memory.size) (i32.const 16)) (i32.const 4))))
`;

(async () => {
  let calls = 0, clock = 0, increment = 0;
  const harness = await bootRenderHarness({ extraWat, fonts: 'none',
    extraHostOverrides: { monotonic_time_ms: () => { calls++; const value = clock; clock += increment; return value; } } });
  const e = harness.exports;
  const mem = new Uint8Array(harness.memory.buffer);
  const pe = fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'));
  mem.set(pe, e.get_staging());
  e.load_pe(pe.length);
  const address = e.get_image_base() + 0x1000;
  // A real decoded/cached x86 block, rather than a mock dispatch counter.
  mem.set([0x40, 0xeb, 0xfd], e.guest_to_wasm(address)); // inc eax; jmp back
  const reset = () => { e.set_eip(address); e.set_eax(0); e.set_yield_state(0, 0); };
  reset(); e.run(100);
  assert.strictEqual(calls, 0, 'plain/frozen runs do not call the wall clock');
  reset(); e.run_budgeted(10000, 0);
  assert.strictEqual(e.get_last_run_halt(), 6);
  assert.strictEqual(e.get_last_run_blocks(), 0, 'expired deadline starts no block');
  assert.strictEqual(e.get_eax(), 0);
  assert.strictEqual(e.get_run_deadline_enabled(), 0, 'normal return restores disabled state');

  calls = 0; clock = 0; increment = 1;
  reset(); e.run_budgeted(10000, 3);
  assert.strictEqual(e.get_last_run_halt(), 6);
  const retired = e.get_last_run_blocks();
  assert(retired > 0 && retired <= 96, `cached chains must poll, retired=${retired}`);
  assert.strictEqual(e.get_eax(), retired, 'no duplicated/skipped x86 work at a deadline');
  assert.strictEqual(e.get_yield_reason(), 0, 'deadline is not an emulated blocking wait');
  assert.strictEqual(calls, 4);
  reset(); calls = 0; e.run(retired);
  assert.strictEqual(e.get_eax(), retired, 'plain and budgeted fixed work agree');
  assert.strictEqual(calls, 0);

  clock = 2 ** 40; increment = 0; calls = 0;
  reset(); e.run_budgeted(17, clock + 0.5);
  assert.strictEqual(e.get_last_run_blocks(), 17, 'deadline stays f64 beyond i32 wrap');
  assert.strictEqual(e.get_last_run_halt(), 1);
  e.test_prepare_resume(); e.run_budgeted(0, 0);
  assert.strictEqual(e.get_eip(), 0, 'expired run(0) still completes a started block');
  assert.strictEqual(e.test_resume_ip(), 0);
  assert.strictEqual(e.get_last_run_blocks(), 0);

  e.test_arm_deadline(0); e.test_sync_depth(1); calls = 0;
  assert.strictEqual(e.test_poll(), 0, 'no preemption while a synchronous native frame is live');
  assert.strictEqual(calls, 0);
  e.test_sync_depth(0);
  reset(); e.run(4);
  assert.strictEqual(e.get_run_deadline_enabled(), 1, 'nested normal run restores outer deadline');
  assert.strictEqual(calls, 0, 'nested plain run ignores enclosing deadline');
  assert.strictEqual(e.test_poll(), 1, 'outer deadline remains expired after callback');

  // Exercise the actual storage callback helper's finally with a real WASM
  // trap, as its enclosing COM code can catch and continue the outer frame.
  const storage = fs.readFileSync(path.join(__dirname, '../lib/storage.js'), 'utf8');
  const callbackSource = storage.slice(storage.indexOf('  function _runComCallback('),
    storage.indexOf('  function _writeStringToScratch('));
  const callback = vm.runInNewContext(`(${callbackSource.trim()})`);
  e.test_arm_deadline(0); e.test_prepare_trap();
  assert.throws(() => callback(e, 0), WebAssembly.RuntimeError);
  assert.strictEqual(e.get_run_deadline_enabled(), 1, 'caught nested trap restores outer enable flag');
  assert.strictEqual(e.test_poll(), 1, 'caught trap cannot silently remove outer deadline');
  e.set_run_deadline_enabled(0);

  const other = await bootRenderHarness({ extraWat, fonts: 'none',
    extraHostOverrides: { monotonic_time_ms: () => 100 } });
  e.test_arm_deadline(0);
  assert.strictEqual(other.exports.get_run_deadline_enabled(), 0, 'budgets are instance-local');
  e.set_run_deadline_enabled(0);
  const GuestRpc = require('../lib/guest-rpc');
  let posts = 0;
  const worker = GuestRpc.createWorkerImports(harness.memory,
    { monotonic_time_ms: { params: [], results: ['f64'] } }, () => { posts++; });
  assert(Number.isFinite(worker.imports.host.monotonic_time_ms()));
  assert.strictEqual(posts, 0, 'Worker clock never makes a blocking broker round trip');
  console.log('PASS compiled deadline polling: cached chains, exact work, run(0), f64, nested callbacks/traps, instance isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
