#!/usr/bin/env node
'use strict';

// lib/apps.js virtualAllocTop: where the top-down sparse VirtualAlloc arena
// starts. Win9x hands an app's VirtualAlloc/heap memory out below 0x10000000,
// and Age of Wonders' image library depends on it (`and esi, 0x0FFFFFFC`); at
// our default top of 0x7F000000 that mask turned its sprite pointers into
// garbage and the scenario load span forever in a blit loop. With the app's
// virtualAllocTop applied, a reservation must land below 256MB and stay above
// the direct window; without it the arena keeps the default top.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { applyVirtualAllocTop } = require('../lib/process-boot');

const extraWat = `
  (func (export "t_reserve") (param $size i32) (result i32)
    (call $virtual_reserve_down (local.get $size)))
  (func (export "t_floor") (result i32) (call $virtual_alloc_min))
`;

(async () => {
  for (const top of [0, 0x10000000]) {
    const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
    assert.strictEqual(applyVirtualAllocTop(e, top), top !== 0, 'applied only when set');
    const a = e.t_reserve(0x100000) >>> 0;
    const b = e.t_reserve(0x100000) >>> 0;
    if (top) {
      assert(a < 0x10000000 && b < a, `reservations below 256MB, top-down (0x${a.toString(16)}, 0x${b.toString(16)})`);
      assert.strictEqual((a & 0x0FFFFFFC) >>> 0, a, 'a 28-bit pointer mask leaves it unchanged');
      assert(b >= (e.t_floor() >>> 0), 'still above the direct window');
    } else {
      assert(a > 0x70000000, `default arena starts near the top of user space (0x${a.toString(16)})`);
    }
  }
  console.log('PASS  virtualAllocTop moves the VirtualAlloc arena below 256MB');
})().catch(error => { console.error(error); process.exit(1); });
