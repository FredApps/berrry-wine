#!/usr/bin/env node
'use strict';

// The present-rate cap: $present_pace and the two rules that decide what
// counts as the end of a frame.
//
// WHY THIS EXISTS
// A game loop with no limiter of its own presents as fast as the machine
// allows (Moorhuhn 444/s, Captain Claw 437/s in a browser), and a display
// shows at most its refresh. Everything past that is guest work nobody sees,
// on the thread the page, the audio and the other guest threads also need.
//
// Three things here fail in ways that are invisible in an app until someone
// reports "the game is half speed", so they are asserted rather than eyeballed:
//
//  * The CADENCE is arithmetic on a guest millisecond, kept in ms*cap units so
//    60 Hz carries no rounding drift. It is checked by running a simulated
//    guest loop against a clock this file owns -- no wall time, no browser, so
//    a failure here is a failure of the rule and not of the machine's load.
//
//  * A cap must never SLOW a loop that is already under it, and must not fire
//    a burst of catch-up frames after a stall. Both are checked directly.
//
//  * WHAT COUNTS AS A FRAME. A present is paced only when it ends a whole
//    frame: a blit covering more than half the target, or the Unlock closing a
//    whole-surface Lock. Pace a sprite blit or a per-sprite lock instead and
//    the frame rate is divided by the sprite count -- which is exactly the
//    "vsync halves it" failure the rate cap exists to avoid.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  ;; Run the pacer and report the sleep it asked for, clearing the flags the
  ;; way a host does when it honours the Sleep.
  (func (export "t_pace") (result i32)
    (local $ms i32)
    (call $present_pace)
    (local.set $ms (select (global.get $sleep_timeout) (i32.const 0)
      (global.get $sleep_yielded)))
    (global.set $sleep_yielded (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (global.set $sleep_timeout (i32.const 0))
    (local.get $ms))
  (func (export "t_reset") (param $cap i32)
    (call $present_set_cap (local.get $cap))
    (global.set $present_paced_ms (i32.const 0))
    (global.set $present_paced_count (i32.const 0))
    (global.set $present_lock_whole (i32.const 0))
    (global.set $sleep_yielded (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (global.set $sleep_timeout (i32.const 0)))
  (func (export "t_paced_count") (result i32) (global.get $present_paced_count))
  (func (export "t_surface_w") (param $s i32) (result i32)
    (load.field DxObject width (call $dx_from_this (local.get $s))))
  (func (export "t_surface_h") (param $s i32) (result i32)
    (load.field DxObject height (call $dx_from_this (local.get $s))))
  (func (export "t_blit") (param $s i32) (param $w i32) (param $h i32)
    (call $present_pace_full_blit (call $dx_from_this (local.get $s))
      (local.get $w) (local.get $h)))
  (func (export "t_seed") (param $ddraw_vtbl i32) (param $surface_vtbl i32)
    (global.set $DX_VTBL_DDRAW (local.get $ddraw_vtbl))
    (global.set $DX_VTBL_DDSURF2 (local.get $surface_vtbl)))
  (func (export "t_create") (param $desc i32) (param $out i32) (result i32)
    (local $ddraw i32)
    (local.set $ddraw (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_lock") (param $s i32) (param $rect i32) (param $desc i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_Lock
      (local.get $s) (local.get $rect) (local.get $desc) (i32.const 0)
      (i32.const 0) (i32.const 0)))
  (func (export "t_unlock") (param $s i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_Unlock
      (local.get $s) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0)))
`;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

(async () => {
  const clock = { now: 0 };
  const { exports: wat } = await bootRenderHarness({
    extraWat,
    extraHostOverrides: { get_ticks: () => clock.now & 0x7FFFFFFF },
  });

  // One simulated guest loop: present, honour the sleep the pacer asks for,
  // spend `workMs` of guest time on the next frame, repeat for `ms`.
  const loop = (cap, workMs, ms) => {
    wat.t_reset(cap);
    clock.now = 0;
    let frames = 0, slept = 0, longest = 0;
    // The guard matters: an uncapped loop with no work of its own advances
    // this clock by nothing at all, and the test would hang rather than fail.
    while (clock.now < ms && frames < 100000) {
      const wait = wat.t_pace() >>> 0;
      longest = Math.max(longest, wait);
      slept += wait;
      clock.now += wait + workMs;
      frames++;
    }
    return { frames, slept, longest };
  };

  // ---- 1. the cap is off unless it is set ------------------------------
  const off = loop(0, 1, 1000);
  check('cap 0 never sleeps', off.slept === 0, `slept ${off.slept}ms`);
  check('cap 0 does not count a paced frame', (wat.t_paced_count() >>> 0) === 0);

  // ---- 2. the cadence --------------------------------------------------
  // A loop that would run flat out lands on the cap, and the sleeps stay
  // inside one period: a boundary-aligned wait (vsync) would show up here as
  // half the rate, which is the failure this design exists to avoid.
  for (const [cap, lo, hi] of [[60, 59, 61], [30, 29, 31], [120, 118, 122]]) {
    const r = loop(cap, 0, 3000);
    const perSec = r.frames / 3;
    check(`a flat-out loop lands on ${cap}/s`, perSec >= lo && perSec <= hi,
      `${perSec.toFixed(1)}/s`);
    check(`no sleep at ${cap}/s exceeds one period`,
      r.longest <= Math.ceil(1000 / cap), `longest ${r.longest}ms`);
  }

  // A loop already slower than the cap is not touched at all. This is the
  // whole point of a rate cap over a vsync wait: 40/s stays 40/s instead of
  // being rounded down to the next boundary.
  const slow = loop(60, 25, 3000);
  check('a loop slower than the cap never sleeps', slow.slept === 0,
    `slept ${slow.slept}ms over ${slow.frames} frames`);
  check('a loop slower than the cap keeps its own rate',
    slow.frames / 3 >= 39 && slow.frames / 3 <= 41, `${(slow.frames / 3).toFixed(1)}/s`);

  // ---- 3. a stall costs one catch-up frame, not a burst ------------------
  // The deadline may trail `now` by at most one period, so a guest that went
  // away for half a second comes back to a single free frame.
  wat.t_reset(60);
  clock.now = 0;
  wat.t_pace();                      // arm
  clock.now = 500;                   // a long stall
  check('the frame after a stall is not slept on', (wat.t_pace() >>> 0) === 0);
  let free = 0;
  for (let i = 0; i < 5; i++) if ((wat.t_pace() >>> 0) === 0) free++; else break;
  check('a stall is followed by at most one more catch-up frame', free <= 1,
    `${free} free frames`);

  // A clock that steps backwards (or a cap lowered under a live deadline)
  // re-arms instead of sleeping toward a deadline the guest never earned.
  wat.t_reset(60);
  clock.now = 10000;
  wat.t_pace();
  clock.now = 10;
  check('a backwards clock re-arms rather than sleeping it off',
    (wat.t_pace() >>> 0) === 0);

  // ---- 4. what counts as a frame: blits ---------------------------------
  const desc = 0x410000, out = 0x410100, lockDesc = 0x410200, rect = 0x410300;
  wat.t_seed(0x51000000, 0x52000000);
  wat.guest_write32(desc, 108);
  wat.guest_write32(desc + 4, 1);          // DDSD_CAPS
  wat.guest_write32(desc + 104, 0x200);    // DDSCAPS_PRIMARYSURFACE
  assert.strictEqual(wat.t_create(desc, out) >>> 0, 0, 'primary CreateSurface failed');
  const primary = wat.guest_read32(out) >>> 0;
  const w = wat.t_surface_w(primary) >>> 0, h = wat.t_surface_h(primary) >>> 0;
  assert.ok(w > 0 && h > 0, `primary has no size (${w}x${h})`);

  const blitPaced = (bw, bh) => {
    wat.t_reset(60);
    clock.now = 0;
    wat.t_blit(primary, bw, bh);   // arms the deadline if it paces at all
    clock.now = 1;
    wat.t_blit(primary, bw, bh);
    return (wat.t_paced_count() >>> 0) > 0;
  };
  check('a full-surface blit to the primary is a frame', blitPaced(w, h));
  check('a blit over half the primary is a frame', blitPaced(w, Math.ceil(h * 0.6)));
  check('a half-surface blit is not a frame', !blitPaced(w, h >> 1));
  check('a sprite-sized blit is not a frame', !blitPaced(32, 32));
  check('an empty blit is not a frame', !blitPaced(0, 0));

  // ---- 5. what counts as a frame: locks ---------------------------------
  // Diablo and Elasto Mania's menus have no Flip and no Blt at all: they lock
  // the whole primary, write the frame themselves and Unlock. A rect lock is
  // one sprite of many, and pacing it would divide the rate by the count.
  const lockPaced = rectPtr => {
    wat.t_reset(60);
    clock.now = 0;
    wat.t_lock(primary, rectPtr, lockDesc);
    wat.t_unlock(primary);
    clock.now = 1;
    wat.t_lock(primary, rectPtr, lockDesc);
    wat.t_unlock(primary);
    return (wat.t_paced_count() >>> 0) > 0;
  };
  wat.guest_write32(rect, 0); wat.guest_write32(rect + 4, 0);
  wat.guest_write32(rect + 8, 32); wat.guest_write32(rect + 12, 32);
  check('unlocking a whole-surface lock of the primary is a frame', lockPaced(0));
  check('unlocking a rect lock is not a frame', !lockPaced(rect));

  // An Unlock with no Lock of its own must not inherit the last one: two
  // presents would then be paced for one frame.
  wat.t_reset(60);
  clock.now = 0;
  wat.t_lock(primary, 0, lockDesc);
  wat.t_unlock(primary);
  clock.now = 1;
  wat.t_unlock(primary);
  check('a second Unlock does not reuse the first one\'s whole-surface lock',
    (wat.t_paced_count() >>> 0) === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
