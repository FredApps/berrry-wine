#!/usr/bin/env node
'use strict';

// VirtualAlloc(lpAddress, size, MEM_RESERVE) at a fixed address below the
// sparse arena. Only the image's own window of the direct mapping is guest
// memory; past it the direct window translates into the heap, the stack and
// emulator tables. Windows fails a reservation it cannot place exactly, and so
// must we: Crusaders of Might and Magic reserves three pools at 64MB, 96MB and
// 128MB, and the first of them used to "succeed" onto the window title
// table. Moving the reservation is no answer either -- that game's level files
// hold pointers already relocated to those bases. A fixed reserve inside the
// image window keeps its old literal meaning.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_valloc") (param $addr i32) (param $size i32) (param $type i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_VirtualAlloc (local.get $addr) (local.get $size) (local.get $type)
      (i32.const 4) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.add (local.get $sp) (i32.const 20)))
      (then (unreachable)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
  (func (export "t_last_error") (result i32) (global.get $last_error))
  (func (export "t_floor") (result i32) (call $virtual_alloc_min))
  (func (export "t_image_end") (result i32)
    (i32.add (global.get $image_base)
      (i32.sub (region.end $GUEST_BASE) (global.get $GUEST_BASE))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const imageEnd = e.t_image_end() >>> 0;
  // With the default image base the window ends at Crusaders' first pool, so
  // its three pools are the window end and 32MB / 64MB past it.
  const pools = [[imageEnd, 0x80000], [imageEnd + 0x2000000, 0xee1000], [imageEnd + 0x4000000, 0x100000]];
  assert(pools.every(([a, n]) => a + n < (e.t_floor() >>> 0)), 'the fixture addresses sit below the sparse arena');

  for (const [addr, size] of [...pools, [imageEnd - 0x10000, 0x20000]]) {
    assert.strictEqual(e.t_valloc(addr, size, 0x2000) >>> 0, 0,
      `reserve at 0x${addr.toString(16)} past the image window fails`);
    assert.strictEqual(e.t_last_error(), 487, 'ERROR_INVALID_ADDRESS');
  }

  const inside = imageEnd - 0x200000;
  assert.strictEqual(e.t_valloc(inside, 0x10000, 0x2000) >>> 0, inside,
    'a fixed reserve inside the image window is honoured literally');
  assert.notStrictEqual(e.t_valloc(0, 0x10000, 0x2000) >>> 0, 0, 'a NULL reserve still places');
  console.log('PASS  fixed MEM_RESERVE past the image window fails with ERROR_INVALID_ADDRESS');
})().catch(error => { console.error(error); process.exit(1); });
