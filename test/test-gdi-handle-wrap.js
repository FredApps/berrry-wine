#!/usr/bin/env node
'use strict';

// GDI DC and object handles come from two counters that only ever count up:
// DCs from 0x00310001, objects (pens, brushes, fonts, bitmaps) from
// 0x00410001, regions at 0x0050xxxx. A long session walks the DC counter
// straight into the object range. Civilization II takes ~1.3-3 DCs per batch
// (every GetDC/BeginPaint), so around AD 1730 a new DC handle equalled the
// handle of a live font. The Win16 32->16 map, which finds an existing slot
// by 32-bit value, then handed that DC the font's 16-bit handle, and the
// ReleaseDC that forgot the DC forgot the font with it: dialogs drew with no
// title and no labels from then on.
//
// Each counter must wrap inside its own range and skip handles still live.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const DC_FIRST = 0x00310001, DC_LIMIT = 0x00410000;
const OBJ_FIRST = 0x00410001, OBJ_LIMIT = 0x00500000;

const extraWat = `
  (func (export "t_set_next_dc") (param $h i32) (global.set $gdi_next_dc_handle (local.get $h)))
  (func (export "t_set_next_obj") (param $h i32) (global.set $gdi_next_object_handle (local.get $h)))
  (func (export "t_dc_alloc") (result i32) (call $gdi_dc_alloc))
  (func (export "t_dc_delete") (param $h i32) (result i32) (call $gdi_dc_delete (local.get $h)))
  (func (export "t_obj_alloc") (result i32)
    (call $gdi_object_alloc (i32.const 3) (i32.const 8) (i32.const 8) (i32.const 32) (i32.const 0)))
  (func (export "t_obj_live") (param $h i32) (result i32)
    (i32.ne (call $gdi_object_record (local.get $h)) (i32.const 0)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const hex = (v) => '0x' + (v >>> 0).toString(16);

  // Something long-lived in each range, at the handles a wrap reaches first.
  e.t_set_next_dc(DC_FIRST);
  const liveDc = e.t_dc_alloc() >>> 0;
  assert.ok(liveDc >= DC_FIRST && liveDc < DC_LIMIT, `first DC ${hex(liveDc)}`);
  e.t_set_next_obj(OBJ_FIRST);
  const liveObj = e.t_obj_alloc() >>> 0;
  assert.ok(liveObj >= OBJ_FIRST && liveObj < OBJ_LIMIT, `first object ${hex(liveObj)}`);
  assert.ok(e.t_obj_live(liveObj));

  // A million DCs later: the counter is at the top of its range.
  e.t_set_next_dc(DC_LIMIT - 2);
  const dcs = [];
  for (let i = 0; i < 6; i++) {
    const h = e.t_dc_alloc() >>> 0;
    assert.notStrictEqual(h, 0, 'DC allocation must not fail at the wrap');
    assert.ok(h >= DC_FIRST && h < DC_LIMIT,
      `DC handle ${hex(h)} left the DC range ${hex(DC_FIRST)}..${hex(DC_LIMIT)} and can equal a pen/brush/font handle`);
    assert.notStrictEqual(h, liveDc, 'the wrap must skip a DC that is still live');
    assert.notStrictEqual(h, liveObj, 'a DC must never take a live object handle');
    dcs.push(h);
  }
  assert.strictEqual(new Set(dcs).size, dcs.length, 'DC handles are distinct');
  for (const h of dcs) assert.strictEqual(e.t_dc_delete(h), 1);

  // The object counter has the same shape and borders region handles.
  e.t_set_next_obj(OBJ_LIMIT - 2);
  const objs = [];
  for (let i = 0; i < 6; i++) {
    const h = e.t_obj_alloc() >>> 0;
    assert.notStrictEqual(h, 0, 'object allocation must not fail at the wrap');
    assert.ok(h >= OBJ_FIRST && h < OBJ_LIMIT,
      `object handle ${hex(h)} left the object range and can equal a region handle`);
    assert.notStrictEqual(h, liveObj, 'the wrap must skip an object that is still live');
    objs.push(h);
  }
  assert.strictEqual(new Set(objs).size, objs.length, 'object handles are distinct');
  assert.ok(e.t_obj_live(liveObj), 'the long-lived object was not overwritten');

  console.log('PASS GDI DC and object handle counters wrap inside their own ranges');
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
