#!/usr/bin/env node
'use strict';

// A guest thread's stack lies above the main thread's, as on Win9x, where
// CreateThread reserves it with VirtualAlloc after the loader made the main
// stack. A single-threaded Watcom CRT keeps one stack floor -- the main
// thread's -- and its __CHK judges every thread's ESP against it. With thread
// stacks carved from the low guest heap (below $GUEST_STACK at guest
// 0x07400000) the Atlantis demo's MSS timer callback reported "Stack
// Overflow!" on its first tick and called ExitProcess from the timer thread,
// leaving the main thread suspended forever.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const MAIN_STACK_TOP = 0x07500000; // derived from $GUEST_BASE; an ABI, not a placement

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  e.set_image_base && e.set_image_base(0x00400000);

  const sizes = [0x10000, 0x10000, 0x12345];
  const stacks = sizes.map(size => ({ size, base: e.guest_stack_alloc(size) >>> 0 }));
  for (const { size, base } of stacks) {
    assert(base, `a ${size.toString(16)}-byte stack is reserved`);
    assert.strictEqual(base & 0xFFF, 0, 'page aligned');
    assert(base >= MAIN_STACK_TOP,
      `thread stack 0x${base.toString(16)} lies above the main thread's stack`);
    // Both hosts zero-fill the stack through one translation of its base, so
    // the whole range must be linear in WASM memory.
    const w = e.guest_to_wasm(base) >>> 0;
    const end = e.guest_to_wasm(base + ((size + 0xFFF) & ~0xFFF) - 4) >>> 0;
    assert.strictEqual(end - w, ((size + 0xFFF) & ~0xFFF) - 4, 'the stack is one linear span');
    new Uint8Array(memory.buffer, w, size).fill(0);
    e.guest_write32(base + size - 8, 0x1234abcd);
    assert.strictEqual(e.guest_read32(base + size - 8) >>> 0, 0x1234abcd, 'the top of the stack is writable');
  }
  const bases = stacks.map(s => s.base);
  assert.strictEqual(new Set(bases).size, bases.length, 'each thread gets its own stack');
  for (let i = 1; i < stacks.length; i++) {
    const [lo, hi] = [stacks[i - 1], stacks[i]].sort((a, b) => a.base - b.base);
    assert(lo.base + lo.size <= hi.base, 'stacks do not overlap');
  }
  assert.strictEqual(e.guest_stack_alloc(0) >>> 0, 0, 'a zero-byte request reserves nothing');

  // Both thread hosts take their stacks from here: the cooperative/CLI
  // ThreadManager and the browser's Worker instance.
  for (const file of ['lib/thread-manager.js', 'lib/guest-worker.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert(/guest_stack_alloc\(stackSize\)/.test(src), `${file} allocates thread stacks with guest_stack_alloc`);
  }
  console.log('PASS thread stacks are reserved above the main thread stack, linear, distinct, in both hosts');
})().catch(error => { console.error(error); process.exitCode = 1; });
