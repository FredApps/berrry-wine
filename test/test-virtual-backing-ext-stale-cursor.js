#!/usr/bin/env node
'use strict';
// The extension window's bump cursor is a claim, not an authority.
//
// $virtual_backing_ext_take serves a commit the primary pool cannot hold from an
// upward-only bump at VIRTUAL_MAP_STATE+24. That is only wilderness while
// nothing live sits above it -- and the cursor is not the only way an extension
// extent gets handed out. A released extent goes on the hole list, and
// $virtual_hole_take gives it to the next commit that fits without ever
// advancing the cursor. So one hole reused at or above the cursor leaves the
// bump pointing at bytes that are now live, and the next request too large for
// the primary pool writes a second guest range onto them.
//
// Measured on Black & White 2's land load: at 95 seconds past the land pick the
// record table held 0x3797A000 of live mappings over only 0x2C2FA000 of
// distinct backing, ten records overlapping, the first collision at 0x2202E000
// -- the exact address the cursor had been left at. Aliasing like this is
// silent: a write through either guest address appears through the other, which
// is how a loader's spatial grid and a heap's free list end up the same bytes.
//
// So the stale cursor is reproduced directly here, and the two things that
// matter are asserted: the extent handed out does not overlap a live record,
// and a write through the new guest range is not visible through the old one.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { REGIONS } = require('../lib/region-map.generated.js');

const EXT_BASE = REGIONS.THREAD_RPC.end;
const CHUNK = 16 * 1024 * 1024;

const EXTRA_WAT = `
  (func (export "commit") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "backing_of") (param $guest i32) (result i32)
    (call $g2w (local.get $guest)))
  (func (export "ext_cursor") (result i32) (call $virtual_backing_ext_cursor))
  (func (export "set_ext_cursor") (param $v i32)
    (i32.store offset=24 (global.get $VIRTUAL_MAP_STATE) (local.get $v)))
  (func (export "records") (result i32) (i32.load (global.get $VIRTUAL_MAP_STATE)))
  (func (export "rec_size") (param $i i32) (result i32)
    (i32.load offset=4 (i32.add (global.get $VIRTUAL_MAP_TABLE) (i32.shl (local.get $i) (i32.const 4)))))
  (func (export "rec_backing") (param $i i32) (result i32)
    (i32.load offset=8 (i32.add (global.get $VIRTUAL_MAP_TABLE) (i32.shl (local.get $i) (i32.const 4)))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({
    fonts: 'none', extraWat: EXTRA_WAT,
    memory: new WebAssembly.Memory({ initial: 16384, maximum: 16384, shared: true }),
  });

  // Spend the primary pool in chunks until a commit crosses into the extension
  // window -- the same walk test-virtual-backing-extension.js makes, because a
  // single oversized request is served by a different path.
  let guest = 0x60000000, tenant = 0;
  for (let i = 0; i < REGIONS.VIRTUAL_BACKING_BASE.size / CHUNK + 4; i++) {
    assert.ok(e.commit(guest, CHUNK) >>> 0, 'the pool should still be placing 16MB');
    if ((e.backing_of(guest) >>> 0) >= EXT_BASE) { tenant = guest; guest += CHUNK; break; }
    guest += CHUNK;
  }
  assert.ok(tenant, 'a commit should have crossed into the extension window');
  const tenantBacking = e.backing_of(tenant) >>> 0;
  assert.strictEqual(e.ext_cursor() >>> 0, (tenantBacking + CHUNK) >>> 0,
    'the bump advanced past the tenant');
  e.guest_write32(tenant, 0x5a5a1234);

  // Put the cursor back where it stood before that tenant. This is precisely
  // the state a hole reuse leaves behind: live backing sitting above a cursor
  // that still calls itself wilderness.
  e.set_ext_cursor(tenantBacking);

  // The next commit must not be handed the tenant's bytes.
  const late = guest;
  assert.strictEqual(e.commit(late, CHUNK) >>> 0, late, 'the next 16MB still commits');
  const lateBacking = e.backing_of(late) >>> 0;
  assert.ok(lateBacking + CHUNK <= tenantBacking || lateBacking >= tenantBacking + CHUNK,
    `0x${lateBacking.toString(16)} overlaps the live tenant at 0x${tenantBacking.toString(16)}`);

  // No two live records share backing, whatever the cursor claimed.
  const rs = [];
  for (let i = 0, n = e.records() >>> 0; i < n; i++) {
    const size = e.rec_size(i) >>> 0;
    if (size) rs.push([e.rec_backing(i) >>> 0, size]);
  }
  rs.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < rs.length; i++) {
    assert.ok(rs[i][0] >= rs[i - 1][0] + rs[i - 1][1],
      `records overlap: 0x${rs[i - 1][0].toString(16)}+0x${rs[i - 1][1].toString(16)}`
      + ` and 0x${rs[i][0].toString(16)}`);
  }

  // The assertion the failure mode hides from: the tables can look plausible
  // and the bytes still be shared, so write through one range and read the
  // other.
  e.guest_write32(late, 0x0badc0de);
  assert.strictEqual(e.guest_read32(tenant) >>> 0, 0x5a5a1234,
    'a write to the late range must not appear in the tenant');

  // And the cursor is honest again: everything below it is live or a named
  // hole, which is what the wilderness claim means.
  assert.ok((e.ext_cursor() >>> 0) >= (lateBacking + CHUNK) >>> 0,
    'the bump no longer points at bytes it already gave away');

  console.log('PASS sparse backing extension: a stale bump cursor never aliases a live extent');
})().catch(error => { console.error(error); process.exitCode = 1; });
