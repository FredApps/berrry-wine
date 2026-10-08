#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  let ticks = 0, calls = 0;
  const { exports: e } = await bootRenderHarness({ fonts: 'none',
    extraHostOverrides: { get_ticks: () => { calls++; return ticks; } },
    extraWat: `
      (func (export "qpc") (param $out i32) (param $unused i32) (result i32)
        (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
        (call $handle_QueryPerformanceCounter (local.get $out)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
        (i32.load (global.get $reg_base)))
      (func (export "qpf") (param $out i32) (result i32)
        (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
        (call $handle_QueryPerformanceFrequency (local.get $out)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
        (i32.load (global.get $reg_base)))
    ` });
  const out = e.guest_alloc(16) >>> 0;
  const read64 = () => BigInt(e.guest_read32(out + 4) >>> 0) |
    BigInt(e.guest_read32(out + 8) >>> 0) << 32n;
  let previous = -1n;
  for (const value of [1, 2147483, 2147484, 4294967, 4294968,
    9000000, 0x7fffffff, 0x80000000, 0xffffffff]) {
    ticks = value; calls = 0;
    e.guest_write32(out, 0x12345678);
    e.guest_write32(out + 12, 0x12345678);
    assert.strictEqual(e.qpc(out + 4, 0), 1);
    const actual = read64();
    assert.strictEqual(actual, BigInt(value) * 1000n, `ticks=${value}`);
    assert(actual > previous, 'no backwards low-DWORD rollover');
    previous = actual;
    assert.strictEqual(calls, 1, 'one sample supplies both DWORDs');
    assert.strictEqual(e.guest_read32(out), 0x12345678);
    assert.strictEqual(e.guest_read32(out + 12), 0x12345678);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  }
  // One process-wide sequence ($QPC_SHARED): a second call in the same
  // millisecond, or a reading whose clock is behind (another guest thread's
  // instance), continues one past the last count instead of going back.
  // FreeSpace treats a backwards QPC as a reset of its time base.
  const last = read64();
  e.qpc(out + 4, 0);
  assert.strictEqual(read64(), last + 1n, 'same millisecond: one past the last count');
  ticks = 1;
  e.qpc(out + 4, 0);
  assert.strictEqual(read64(), last + 2n, 'a lower clock reading never goes backwards');
  assert.strictEqual(e.qpf(out + 4), 1);
  assert.strictEqual(read64(), 1000000n);
  assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  console.log('PASS QPC: 64-bit product, unsigned inputs, single sample, process-wide monotonic, frequency and stdcall');
})().catch(error => { console.error(error); process.exitCode = 1; });
