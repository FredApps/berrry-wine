#!/usr/bin/env node

'use strict';

// GetMenuState and EnableMenuItem by command id must reach items in a
// cascaded popup of a window's resource menu, not just the dropdowns.
// Daytona USA Deluxe greys its Settings > Screen mode items in the resource,
// enables the modes EnumDisplayModes reports, then reads them back with
// GetMenuState; when both calls stopped one level short every mode read as
// missing and the game quit with ERR_NORESOLUTION.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const MF_BYCOMMAND = 0x0000;
const MF_ENABLED = 0x0000;
const MF_GRAYED = 0x0001;

const extraWat = String.raw`
  (func (export "test_cascade_get_state")
      (param $menu i32) (param $item i32) (param $flags i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetMenuState (local.get $menu) (local.get $item) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_cascade_enable")
      (param $menu i32) (param $item i32) (param $flags i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_EnableMenuItem (local.get $menu) (local.get $item) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const harness = await bootRenderHarness({ extraWat, width: 640, height: 480 });
  const { exports: e } = harness;

  // One "Settings" dropdown: a "Screen mode" popup whose two children are
  // grayed commands 40009/40011, then a plain command 40021.
  const hwnd = 0x10041;
  const source = 0x0048f6a0;
  const childHeader = 20;
  const nestedHeader = 80;
  const stringBase = 140;
  const strings = ['&Settings', 'Screen mode', 'Sound Settings...', '320x240', '640x480'];
  const offsets = [];
  let blobSize = stringBase;
  for (const text of strings) {
    offsets.push(blobSize);
    blobSize += Buffer.byteLength(text, 'latin1');
  }
  const blob = e.guest_alloc(blobSize) >>> 0;
  for (let offset = 0; offset < blobSize; offset++) e.guest_write8(blob + offset, 0);
  e.guest_write32(blob, 1);
  e.guest_write32(blob + 4, offsets[0]);
  e.guest_write32(blob + 8, strings[0].length);
  e.guest_write32(blob + 12, childHeader);
  e.guest_write32(blob + childHeader, 2);
  const child = index => blob + childHeader + 4 + index * 28;
  e.guest_write32(child(0), offsets[1]);
  e.guest_write32(child(0) + 4, strings[1].length);
  e.guest_write32(child(0) + 16, 0x08);              // popup
  e.guest_write32(child(0) + 24, nestedHeader);
  e.guest_write32(child(1), offsets[2]);
  e.guest_write32(child(1) + 4, strings[2].length);
  e.guest_write32(child(1) + 20, 40021);
  e.guest_write32(blob + nestedHeader, 2);
  const nested = index => blob + nestedHeader + 4 + index * 28;
  for (const [index, id] of [[0, 40009], [1, 40011]]) {
    e.guest_write32(nested(index), offsets[3 + index]);
    e.guest_write32(nested(index) + 4, strings[3 + index].length);
    e.guest_write32(nested(index) + 16, 0x02);       // grayed
    e.guest_write32(nested(index) + 20, id);
  }
  strings.forEach((text, index) => {
    Buffer.from(text, 'latin1').forEach((value, byte) => {
      e.guest_write8(blob + offsets[index] + byte, value);
    });
  });
  e.test_wnd_table_set(hwnd, 0xffff0002);
  e.menu_set_source_guest(hwnd, blob, blobSize, source);

  assert.strictEqual(e.test_cascade_get_state(source, 40021, MF_BYCOMMAND), 0,
    'a dropdown command reads as enabled');
  assert.strictEqual(e.test_cascade_get_state(source, 40011, MF_BYCOMMAND), 3,
    'a grayed cascade command reads MF_GRAYED|MF_DISABLED, not missing');
  assert.strictEqual(e.test_cascade_get_state(source, 40099, MF_BYCOMMAND), -1,
    'an id that is nowhere in the menu is still -1');

  assert.strictEqual(e.test_cascade_enable(source, 40011, MF_BYCOMMAND | MF_ENABLED), 1,
    'EnableMenuItem finds the cascade command and reports it was grayed');
  assert.strictEqual(e.test_cascade_get_state(source, 40011, MF_BYCOMMAND), 0,
    'the enabled cascade command reads back enabled');
  assert.strictEqual(e.test_cascade_get_state(source, 40009, MF_BYCOMMAND), 3,
    'its sibling stays grayed');
  assert.strictEqual(e.menu_subchild_flags(hwnd, 0, 0, 1) & 2, 0,
    'the painted cascade record is the one that was enabled');

  assert.strictEqual(e.test_cascade_enable(source, 40011, MF_BYCOMMAND | MF_GRAYED), 0,
    'graying it again reports the previous enabled state');
  assert.strictEqual(e.test_cascade_get_state(source, 40011, MF_BYCOMMAND), 3);
  assert.strictEqual(e.test_cascade_enable(source, 40099, MF_BYCOMMAND), -1,
    'EnableMenuItem on an unknown id is -1');

  console.log('PASS  GetMenuState/EnableMenuItem by command id reach cascaded resource popups');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
