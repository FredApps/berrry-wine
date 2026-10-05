#!/usr/bin/env node
'use strict';

// Win16 FindResource hands out an HRSRC that names one resource of one
// module; finding the same resource again answers the same handle. We minted
// a new descriptor per call out of a 1024-entry table that was never reused.
// Civilization II finds the same advisor picture every time the advisor
// window opens (7 opens = 7 descriptors, and 7 more Win16 handle-map slots),
// and a long campaign ended in its own "ERR_RESOURCENOTFOUND ... PORT.CPP"
// box followed by DebugBreak once the table was full.
//
// Also: a shared descriptor counts its LoadResource holders, and a freed
// module's descriptors are given back.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "t_init") (global.set $is_win16 (i32.const 1)) (call $win16_handle_reset))
  (func (export "t_alloc") (param $key i32) (param $module i32) (param $rid i32) (result i32)
    (call $win16_res_handle_alloc (local.get $key) (local.get $module) (local.get $rid)))
  (func (export "t_desc") (param $h16 i32) (result i32)
    (call $win16_res_desc_from_handle (local.get $h16)))
  (func (export "t_res_next") (result i32) (call $win16_res_handle_next_get))
  (func (export "t_load") (param $desc i32) (result i32) (call $win16_res_load (local.get $desc)))
  (func (export "t_forget") (param $module i32) (call $win16_res_forget_module (local.get $module)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const dv = () => new DataView(memory.buffer);
  e.t_init();
  const mapBase = e.win16_handle_map_used();

  const PIC = 0x7f010032, MOD = 0x10018, OTHER_MOD = 0x10019;
  const h = e.t_alloc(PIC, MOD, 0);
  assert.notStrictEqual(h, 0);
  const mapAfterFirst = e.win16_handle_map_used();

  // The advisor window, opened a campaign's worth of times.
  for (let i = 0; i < 3000; i++) {
    assert.strictEqual(e.t_alloc(PIC, MOD, 0), h, `FindResource #${i + 2} of one resource answers the first handle`);
  }
  assert.strictEqual(e.t_res_next(), 1, 'one resource, one descriptor');
  assert.strictEqual(e.win16_handle_map_used(), mapAfterFirst, 'and one handle-map slot');
  assert.ok(mapAfterFirst - mapBase <= 1);

  // Different module, id or name-id: different resources.
  const hOther = e.t_alloc(PIC, OTHER_MOD, 0);
  const hNamed = e.t_alloc(PIC & 0xffff0000, MOD, 0x8003);
  const hId = e.t_alloc(PIC + 1, MOD, 0);
  assert.strictEqual(new Set([h, hOther, hNamed, hId]).size, 4);

  // A cached selector is shared: each LoadResource of it adds a holder.
  const desc = e.t_desc(h) >>> 0;
  assert.notStrictEqual(desc, 0);
  dv().setUint32(desc + 8, 0x1234 | 0x10000, true);
  assert.strictEqual(e.t_load(desc), 0x1234, 'a loaded resource answers its selector');
  assert.strictEqual(dv().getUint32(desc + 8, true), 0x1234 | 0x20000, 'and counts the second holder');
  dv().setUint32(desc + 8, 0, true);

  // FreeLibrary: the module's descriptors are released and reused.
  const before = e.t_res_next();
  e.t_forget(OTHER_MOD);
  assert.strictEqual(e.t_desc(hOther) && dv().getUint32(e.t_desc(hOther) >>> 0, true), 0,
    'the freed module no longer names its resource');
  e.t_alloc(0x7f020001, OTHER_MOD + 1, 0);
  assert.strictEqual(e.t_res_next(), before, 'a freed descriptor is taken before the table grows');
  assert.strictEqual(e.t_alloc(PIC, MOD, 0), h, 'other modules are untouched');

  // Many distinct resources across many load/free cycles never exhaust it.
  for (let cycle = 0; cycle < 50; cycle++) {
    const mod = 0x10100 + cycle;
    for (let r = 0; r < 40; r++) assert.notStrictEqual(e.t_alloc(0x7f010000 + r, mod, 0), 0);
    e.t_forget(mod);
  }
  assert.ok(e.t_res_next() < 64, `descriptor high-water mark stays small (${e.t_res_next()})`);

  console.log('PASS Win16 FindResource reuses descriptors');
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
