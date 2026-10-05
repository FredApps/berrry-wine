#!/usr/bin/env node

'use strict';

// WinRAR obtains File -> Change drive by calling GetSubMenu twice: first on
// its resource menu bar, then on the encoded File dropdown. It replaces the
// resource placeholder with the drives found at runtime. The second lookup
// must therefore return a real mutable HMENU, and paint/hit testing must keep
// consuming that same state after DeleteMenu/InsertMenuItem/SetMenuItemInfo.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

const MF_BYPOSITION = 0x0400;
const MIIM_STATE = 0x0001;
const MIIM_ID = 0x0002;
const MIIM_STRING = 0x0040;
const MFS_CHECKED = 0x0008;

const extraWat = String.raw`
  (func (export "test_nested_get_submenu")
      (param $menu i32) (param $pos i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetSubMenu
      (local.get $menu) (local.get $pos) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_nested_delete_menu")
      (param $menu i32) (param $item i32) (param $flags i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_DeleteMenu
      (local.get $menu) (local.get $item) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_nested_set_item_info")
      (param $menu i32) (param $item i32) (param $by_position i32)
      (param $mii i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetMenuItemInfoA
      (local.get $menu) (local.get $item) (local.get $by_position)
      (local.get $mii) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_nested_is_menu") (param $menu i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IsMenu
      (local.get $menu) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_nested_paint")
      (param $hwnd i32) (param $top i32) (param $child i32)
      (param $x i32) (param $y i32)
    (call $menu_paint_submenu
      (local.get $hwnd) (local.get $top) (local.get $child)
      (local.get $x) (local.get $y) (i32.const -1)))
  (func (export "test_nested_hittest")
      (param $hwnd i32) (param $top i32) (param $child i32)
      (param $x i32) (param $y i32) (param $sx i32) (param $sy i32)
      (result i32)
    (call $menu_hittest_submenu
      (local.get $hwnd) (local.get $top) (local.get $child)
      (local.get $x) (local.get $y) (local.get $sx) (local.get $sy)))
`;

(async () => {
  const harness = await bootRenderHarness({ extraWat, width: 640, height: 480 });
  const { exports: e, memory } = harness;
  const bytes = new Uint8Array(memory.buffer);

  const allocations = [];
  const alloc = size => {
    const guest = e.guest_alloc(size) >>> 0;
    assert(guest, `guest_alloc(${size})`);
    allocations.push(guest);
    return guest;
  };
  const strA = text => {
    const guest = alloc(Buffer.byteLength(text, 'latin1') + 1);
    Buffer.from(text + '\0', 'latin1').forEach((value, index) => {
      e.guest_write8(guest + index, value);
    });
    return guest;
  };
  const menuItemInfo = ({ mask, state = 0, id = 0, text = 0 }) => {
    const guest = alloc(44);
    for (let offset = 0; offset < 44; offset += 4) e.guest_write32(guest + offset, 0);
    e.guest_write32(guest, 44);
    e.guest_write32(guest + 4, mask);
    e.guest_write32(guest + 12, state);
    e.guest_write32(guest + 16, id);
    e.guest_write32(guest + 36, text);
    return guest;
  };
  const readBlobText = (ptr, len) =>
    Buffer.from(bytes.slice(ptr, ptr + len)).toString('latin1');

  // Parsed WAT menu blob: one File popup, whose first child owns one nested
  // placeholder. The second File child is a command and must not fabricate a
  // submenu handle.
  const hwnd = 0x10031;
  const source = 0x0048f68c;
  const childHeader = 20;
  const nestedHeader = 80;
  const stringBase = 112;
  const strings = ['&File', 'Change &drive', 'E&xit', 'Old drive'];
  const offsets = [];
  let blobSize = stringBase;
  for (const text of strings) {
    offsets.push(blobSize);
    blobSize += Buffer.byteLength(text, 'latin1');
  }
  const blob = alloc(blobSize);
  for (let offset = 0; offset < blobSize; offset++) e.guest_write8(blob + offset, 0);
  e.guest_write32(blob, 1);
  e.guest_write32(blob + 4, offsets[0]);
  e.guest_write32(blob + 8, strings[0].length);
  e.guest_write32(blob + 12, childHeader);
  e.guest_write32(blob + childHeader, 2);
  e.guest_write32(blob + childHeader + 4, offsets[1]);
  e.guest_write32(blob + childHeader + 8, strings[1].length);
  e.guest_write32(blob + childHeader + 20, 0x08); // private popup flag
  e.guest_write32(blob + childHeader + 28, nestedHeader);
  e.guest_write32(blob + childHeader + 32, offsets[2]);
  e.guest_write32(blob + childHeader + 36, strings[2].length);
  e.guest_write32(blob + childHeader + 52, 999);
  e.guest_write32(blob + nestedHeader, 1);
  e.guest_write32(blob + nestedHeader + 4, offsets[3]);
  e.guest_write32(blob + nestedHeader + 8, strings[3].length);
  e.guest_write32(blob + nestedHeader + 24, 44);
  strings.forEach((text, index) => {
    Buffer.from(text, 'latin1').forEach((value, byte) => {
      e.guest_write8(blob + offsets[index] + byte, value);
    });
  });
  e.test_wnd_table_set(hwnd, 0xffff0002);
  e.menu_set_source_guest(hwnd, blob, blobSize, source);

  const fileMenu = e.test_nested_get_submenu(source, 0) >>> 0;
  assert.strictEqual(fileMenu, 0x0001f68c,
    'first GetSubMenu keeps the established encoded resource-dropdown handle');
  assert.strictEqual(e.test_nested_get_submenu(fileMenu, 1), 0,
    'a command child does not fabricate a second-level menu');

  const drives = e.test_nested_get_submenu(fileMenu, 0) >>> 0;
  assert(drives, 'a resource cascade returns a mutable HMENU');
  assert.strictEqual(e.test_nested_get_submenu(fileMenu, 0) >>> 0, drives,
    'repeated GetSubMenu calls preserve the cascade identity');
  assert.strictEqual(e.test_nested_is_menu(drives), 1);
  assert.strictEqual(e.test_menu_item_count(drives), 1,
    'the mutable menu begins with the resource placeholder');
  assert.strictEqual(e.menu_child_sub_count(hwnd, 0, 0), 1,
    'the visible cascade reads the same seeded item');

  assert.strictEqual(e.test_nested_delete_menu(drives, 0, MF_BYPOSITION), 1);
  assert.strictEqual(e.test_menu_item_count(drives), 0);
  assert.strictEqual(e.menu_child_sub_count(hwnd, 0, 0), 0,
    'deleting through HMENU removes the visible placeholder too');

  const cText = strA('Temporary C');
  assert.strictEqual(e.test_call_InsertMenuItemA(drives, 0, 1,
    menuItemInfo({ mask: MIIM_ID | MIIM_STRING, id: 952, text: cText })), 1);
  const dText = strA('D:');
  assert.strictEqual(e.test_call_InsertMenuItemA(drives, 1, 1,
    menuItemInfo({ mask: MIIM_ID | MIIM_STRING, id: 953, text: dText })), 1);

  const longLabel = 'C: local disk with a deliberately long nested-menu label';
  assert.strictEqual(e.test_nested_set_item_info(drives, 0, 1,
    menuItemInfo({
      mask: MIIM_STATE | MIIM_ID | MIIM_STRING,
      state: MFS_CHECKED,
      id: 952,
      text: strA(longLabel),
    })), 1);
  assert.strictEqual(e.menu_child_sub_count(hwnd, 0, 0), 2);
  assert.strictEqual(e.menu_subchild_id(hwnd, 0, 0, 0), 952);
  assert.strictEqual(e.menu_subchild_id(hwnd, 0, 0, 1), 953);
  assert.strictEqual(e.menu_subchild_flags(hwnd, 0, 0, 0) & 4, 4,
    'SetMenuItemInfo state reaches the nested paint record');
  assert.strictEqual(readBlobText(
    e.menu_subchild_label_ptr(hwnd, 0, 0, 0),
    e.menu_subchild_label_len(hwnd, 0, 0, 0)), longLabel,
  'SetMenuItemInfo text reaches the nested paint record');

  const width = e.menu_submenu_width(hwnd, 0, 0) | 0;
  assert(width > 240, `long nested text should widen the cascade (got ${width}px)`);
  assert.strictEqual(e.test_nested_hittest(hwnd, 0, 0, 20, 20,
    20 + width - 3, 25), 0,
  'the whole widened painted row remains clickable');
  assert.strictEqual(e.test_nested_hittest(hwnd, 0, 0, 20, 20,
    20 + width - 3, 45), 1,
  'hit testing sees the inserted second row');

  assert.strictEqual(e.menu_prepare_overlay(), 1);
  e.test_nested_paint(hwnd, 0, 0, 20, 20);
  const descriptor = RegionMap.BASE.GDI_LINE_DESC;
  const hdc = e.test_gdi_menu_overlay_dc() >>> 0;
  assert.strictEqual(e.test_gdi_surface_descriptor(hdc, descriptor), 1);
  const storage = new DataView(memory.buffer).getUint32(descriptor, true);
  const stride = new DataView(memory.buffer).getUint32(descriptor + 12, true);
  let textInk = 0;
  for (let y = 23; y < 40; y++) {
    for (let x = 40; x < 20 + width - 20; x++) {
      const pixel = storage + y * stride + x * 4;
      if (bytes[pixel] < 48 && bytes[pixel + 1] < 48 && bytes[pixel + 2] < 48) textInk++;
    }
  }
  assert(textInk > 30, `nested painter should rasterize the replacement label (${textInk} ink pixels)`);

  assert.strictEqual(e.test_call_DestroyMenu(drives), 1);
  assert.strictEqual(e.test_nested_is_menu(drives), 0,
    'DestroyMenu retires the mutable cascade handle');
  assert.strictEqual(e.menu_child_sub_count(hwnd, 0, 0), 0,
    'destroying the cascade does not resurrect its resource placeholder');
  assert.strictEqual(e.test_nested_get_submenu(fileMenu, 0), 0,
    'the parent no longer exposes the destroyed submenu');

  // Reinstalling a fresh copy and then clearing the owning window must retire
  // its bound cascade too; otherwise a freed parent leaves a live HMENU whose
  // paint binding points into recycled heap storage.
  e.menu_set_source_guest(hwnd, blob, blobSize, source);
  const freshFile = e.test_nested_get_submenu(source, 0) >>> 0;
  const freshDrives = e.test_nested_get_submenu(freshFile, 0) >>> 0;
  assert.strictEqual(e.test_nested_is_menu(freshDrives), 1);
  e.menu_clear(hwnd);
  assert.strictEqual(e.test_nested_is_menu(freshDrives), 0,
    'clearing the parent retires its bound submenu handle');

  for (const allocation of allocations) e.guest_free(allocation);
  console.log('PASS  nested resource HMENU mutation stays coherent with paint, hit testing, and lifetime');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
