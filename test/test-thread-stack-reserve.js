#!/usr/bin/env node
'use strict';

// Windows gives CreateThread(dwStackSize=0) the EXE's SizeOfStackReserve, not
// a fixed default. Our threads used to get 64KB, and Zuma Deluxe's resource
// loader, whose frame is larger than that, probed it with _alloca_probe, ran
// off the bottom, returned to 0 and died before loading anything past its
// first font -- the loading bar never moved. This pins the sizing policy, the
// export it reads, and the page-wise zero fill a split commit needs.

const assert = require('assert');
const { ThreadManager } = require('../lib/thread-manager');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const harness = await bootRenderHarness({ fonts: 'none' });
  const e = harness.exports;
  assert.strictEqual(typeof e.get_exe_stack_reserve, 'function',
    'the WAT exports the EXE stack reserve');

  const manager = new ThreadManager(null, harness.memory, harness.instance,
    () => ({ host: {} }), {});
  manager._log = () => {};

  // No EXE header value (this harness loads no PE): Windows' 1MB default.
  assert.strictEqual(e.get_exe_stack_reserve() >>> 0, 0);
  assert.strictEqual(manager._threadStackReserve(0, 0), 0x100000,
    'no header reserve falls back to 1MB, never 64KB');

  // Only the header read is swapped; the policy is a pure function of it.
  const withHeader = header => ({
    _threadStackReserve(size, flags) {
      const saved = manager.mainInstance;
      manager.mainInstance = { exports: { get_exe_stack_reserve: () => header } };
      try { return manager._threadStackReserve(size, flags); }
      finally { manager.mainInstance = saved; }
    },
  });
  const zuma = withHeader(0x100000);
  assert.strictEqual(zuma._threadStackReserve(0, 0), 0x100000,
    'dwStackSize 0 takes the EXE reserve');
  assert.strictEqual(zuma._threadStackReserve(0x4000, 0), 0x100000,
    'a commit size below the reserve does not shrink the stack');
  assert.strictEqual(zuma._threadStackReserve(0x180000, 0), 0x200000,
    'a commit size above the reserve rounds up to a 1MB multiple');
  assert.strictEqual(zuma._threadStackReserve(0x20000, 0x10000), 0x20000,
    'STACK_SIZE_PARAM_IS_A_RESERVATION makes the size the reserve itself');
  assert.strictEqual(withHeader(0x400000)._threadStackReserve(0, 0), 0x400000,
    'a larger header reserve is honoured');
  assert.strictEqual(withHeader(0x4000000)._threadStackReserve(0, 0), 0x800000,
    'an implausible header reserve is capped, since stacks commit up front');
  assert.strictEqual(withHeader(0x1000)._threadStackReserve(0, 0), 0x10000,
    'a tiny header reserve still gets 64KB');

  // The zero fill translates every page, so it is correct even when a commit
  // was split across backing extents.
  const size = 0x100000;
  const base = e.guest_stack_alloc(size) >>> 0;
  assert.ok(base, 'guest_stack_alloc maps a 1MB thread stack');
  for (let off = 0; off < size; off += 0x1000) e.guest_write32(base + off + 0xFFC, 0xDEADBEEF);
  manager._zeroGuestRange(base, size);
  for (let off = 0; off < size; off += 0x1000) {
    assert.strictEqual(e.guest_read32(base + off + 0xFFC) >>> 0, 0,
      `stack page +0x${off.toString(16)} is zeroed`);
  }
  assert.strictEqual(e.guest_map_free(base), 1, 'a thread stack can be released');

  console.log('PASS test-thread-stack-reserve');
})().catch(err => { console.error(err); process.exit(1); });
