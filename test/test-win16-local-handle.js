#!/usr/bin/env node

'use strict';

// KERNEL.11 LocalHandle(wMem) gives back the handle LocalLock turned into
// wMem, for all three shapes the Win16 local heap hands out: a fixed block
// (its own handle), a moveable one (the handle is the word before the data)
// and a moveable one LocalReAlloc has moved (the handle is a four-byte stub
// elsewhere in the heap that points at the data).
//
// Intel's 16-bit Indeo 4 driver (ir41.dll) frees its buffers with
// LocalUnlock(LocalHandle(p)) / LocalFree when a movie stops. The ordinal was
// missing, so skipping Civilization II's Win16 intro trapped in the codec.
//
// Calls go through $win16_kernel by ordinal on a real selector with a Pascal
// frame, the way the dispatcher drives them (see
// test-win16-profile-int-default.js).

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  ;; One arena segment as the task's DGROUP, stack and return CS.
  (func (export "tlh_setup") (result i32)
    (local $index i32) (local $sel i32)
    (global.set $win16_next_seg (i32.const 1))
    (local.set $index (call $win16_alloc_segment))
    (local.set $sel (call $win16_index_to_sel (local.get $index)))
    (global.set $win16_auto_data (local.get $index))
    (global.set $sreg_ds (local.get $sel))
    (global.set $seg_base_ds (call $win16_seg_base (local.get $index)))
    (local.get $sel))

  (func (export "tlh_base") (result i32) (global.get $seg_base_ds))

  ;; Call KERNEL.ord with up to three word arguments; w0 is the last pushed.
  (func (export "tlh_call") (param $ord i32) (param $esp i32) (param $sel i32)
      (param $w0 i32) (param $w1 i32) (param $w2 i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs16 (local.get $esp) (i32.const 0x100))
    (call $gs16 (i32.add (local.get $esp) (i32.const 2)) (local.get $sel))
    (call $gs16 (i32.add (local.get $esp) (i32.const 4)) (local.get $w0))
    (call $gs16 (i32.add (local.get $esp) (i32.const 6)) (local.get $w1))
    (call $gs16 (i32.add (local.get $esp) (i32.const 8)) (local.get $w2))
    (drop (call $win16_kernel (local.get $ord)))
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const sel = e.tlh_setup() >>> 0;
  const esp = (e.tlh_base() >>> 0) + 0xF000;
  const k = (ord, ...w) => e.tlh_call(ord, esp, sel, w[0] | 0, w[1] | 0, w[2] | 0) >>> 0;

  const LocalInit = 4, LocalAlloc = 5, LocalReAlloc = 6, LocalLock = 8, LocalHandle = 11;
  const LMEM_MOVEABLE = 2;

  assert.strictEqual(k(LocalInit, 0x1000, 0x100, sel), 1, 'LocalInit(sel, 0x100, 0x1000)');

  const fixed = k(LocalAlloc, 0x10, 0);
  assert(fixed, 'fixed LocalAlloc');
  assert.strictEqual(k(LocalHandle, fixed), fixed, 'a fixed block is its own handle');

  const h = k(LocalAlloc, 0x10, LMEM_MOVEABLE);
  const p = k(LocalLock, h);
  assert.notStrictEqual(p, h, 'a moveable handle is not its data');
  assert.strictEqual(k(LocalHandle, p), h, 'moveable: the handle is found from the data');

  // Something above h, so growing h has to move its data elsewhere.
  assert(k(LocalAlloc, 0x10, 0), 'block above the moveable one');
  assert.strictEqual(k(LocalReAlloc, LMEM_MOVEABLE, 0x200, h), h, 'realloc keeps the handle');
  const moved = k(LocalLock, h);
  assert.notStrictEqual(moved, p, 'the data moved');
  assert.strictEqual(k(LocalHandle, moved), h, 'moved: the stub is found from the new data');

  console.log('PASS  Win16 LocalHandle inverts LocalLock for fixed, moveable and moved blocks');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
