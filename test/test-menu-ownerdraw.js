#!/usr/bin/env node

'use strict';

// A resource cascade can be rebuilt with MF_OWNERDRAW items at runtime, as
// WinRAR does for File -> Change drive. Prove the normal guest WndProc callback
// path receives Win98 MEASUREITEM/DRAWITEM structures and paints through the
// canonical menu-overlay HDC; no app-specific label or compositor fallback is
// involved.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');
const apiTable = require('../src/api_table.json');
const { Win98Renderer } = require('../lib/renderer');
const { createCanvas } = require('../lib/raster-canvas');

const ROOT = path.join(__dirname, '..');

const MIIM_STATE = 0x0001;
const MIIM_ID = 0x0002;
const MIIM_DATA = 0x0020;
const MIIM_FTYPE = 0x0100;
const MFT_OWNERDRAW = 0x0100;

const extraWat = String.raw`
  (func (export "test_owner_make_api_thunk") (param $api_id i32) (result i32)
    (local $addr i32)
    (local.set $addr (i32.add (global.get $THUNK_BASE)
      (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $addr) (i32.const 0))
    (i32.store offset=4 (local.get $addr) (local.get $api_id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (i32.add (i32.sub (local.get $addr) (global.get $GUEST_BASE))
      (global.get $image_base)))
  (func (export "test_owner_get_submenu")
      (param $menu i32) (param $pos i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetSubMenu
      (local.get $menu) (local.get $pos) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_owner_set_item_info")
      (param $menu i32) (param $item i32) (param $by_position i32)
      (param $mii i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetMenuItemInfoA
      (local.get $menu) (local.get $item) (local.get $by_position)
      (local.get $mii) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_owner_paint")
      (param $hwnd i32) (param $x i32) (param $y i32) (param $hover i32)
    (call $menu_paint_submenu
      (local.get $hwnd) (i32.const 0) (i32.const 0)
      (local.get $x) (local.get $y) (local.get $hover)))
  (func (export "test_owner_hittest")
      (param $hwnd i32) (param $x i32) (param $y i32)
      (param $sx i32) (param $sy i32) (result i32)
    (call $menu_hittest_submenu
      (local.get $hwnd) (i32.const 0) (i32.const 0)
      (local.get $x) (local.get $y) (local.get $sx) (local.get $sy)))
`;

const u32 = value => [value, value >>> 8, value >>> 16, value >>> 24]
  .map(byte => byte & 0xff);

(async () => {
  const harness = await bootRenderHarness({ extraWat, width: 640, height: 480 });
  const { exports: e, memory } = harness;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  bytes.set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes synchronous guest callbacks');
  e.init_dx_com_thunks();
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const allocations = [];
  const alloc = size => {
    const guest = e.guest_alloc(size) >>> 0;
    assert(guest, `guest_alloc(${size})`);
    allocations.push(guest);
    return guest;
  };
  const wa = guest => (guest - imageBase + guestBase) >>> 0;

  // A tiny stdcall WndProc. WM_MEASUREITEM records the structure then returns
  // 220x28. WM_DRAWITEM records every relevant field and calls FillRect on the
  // supplied HDC/RECT with BLACK_BRUSH, proving an actual x86 -> API thunk ->
  // WAT GDI round trip from the compositor-triggered callback.
  const marker = alloc(72);
  for (let offset = 0; offset < 72; offset += 4) e.guest_write32(marker + offset, 0);
  const fillRectApi = apiTable.find(api => api.name === 'FillRect');
  assert(fillRectApi, 'FillRect API id is present');
  const fillRectThunk = e.test_owner_make_api_thunk(fillRectApi.id) >>> 0;
  const code = [];
  const emit = (...values) => code.push(...values.flat());
  const storeEax = address => emit(0xa3, u32(address));
  const storeEdx = address => emit(0x89, 0x15, u32(address));

  emit(0x8b, 0x44, 0x24, 0x08);             // mov eax,[esp+8] (msg)
  emit(0x83, 0xf8, 0x2c);                   // cmp eax,WM_MEASUREITEM
  emit(0x0f, 0x85, 0, 0, 0, 0);            // jne draw_check
  const toDrawCheck = code.length - 4;
  emit(0xff, 0x05, u32(marker));             // inc [measureCount]
  emit(0x8b, 0x44, 0x24, 0x10);             // mov eax,[esp+16] (lParam)
  emit(0x8b, 0x10); storeEdx(marker + 8);    // CtlType
  emit(0x8b, 0x50, 0x04); storeEdx(marker + 12); // CtlID
  emit(0x8b, 0x50, 0x08); storeEdx(marker + 16); // itemID
  emit(0x8b, 0x50, 0x14); storeEdx(marker + 20); // itemData
  emit(0xc7, 0x40, 0x0c, u32(220));         // itemWidth
  emit(0xc7, 0x40, 0x10, u32(28));          // itemHeight
  emit(0xb8, u32(1), 0xc2, 0x10, 0x00);     // return TRUE, ret 16

  const drawCheck = code.length;
  code.splice(toDrawCheck, 4, ...u32(drawCheck - (toDrawCheck + 4)));
  emit(0x83, 0xf8, 0x2b);                   // cmp eax,WM_DRAWITEM
  emit(0x0f, 0x85, 0, 0, 0, 0);            // jne ignored
  const toIgnored = code.length - 4;
  emit(0xff, 0x05, u32(marker + 4));         // inc [drawCount]
  emit(0x8b, 0x4c, 0x24, 0x10);             // mov ecx,[esp+16] (DRAWITEMSTRUCT)
  for (const [source, destination] of [
    [0x00, 24], [0x04, 28], [0x08, 32], [0x0c, 36], [0x10, 40],
    [0x14, 44], [0x18, 48], [0x1c, 52], [0x20, 56], [0x24, 60],
    [0x28, 64], [0x2c, 68],
  ]) {
    emit(0x8b, 0x41, source);                // mov eax,[ecx+source]
    storeEax(marker + destination);
  }
  emit(0x68, u32(0x30014));                 // push BLACK_BRUSH
  emit(0x8d, 0x41, 0x1c, 0x50);             // lea eax,[ecx+28]; push eax
  emit(0xff, 0x71, 0x18);                   // push [ecx+24] (hDC)
  emit(0xb8, u32(fillRectThunk), 0xff, 0xd0); // mov eax,thunk; call eax
  emit(0xb8, u32(1), 0xc2, 0x10, 0x00);     // return TRUE, ret 16
  const ignored = code.length;
  code.splice(toIgnored, 4, ...u32(ignored - (toIgnored + 4)));
  emit(0x31, 0xc0, 0xc2, 0x10, 0x00);       // return FALSE, ret 16

  const wndproc = alloc(code.length);
  bytes.set(code, wa(wndproc));
  e.set_esp(0x073ff000);

  // One parsed File popup with a single nested placeholder.
  const hwnd = 0x10041;
  const source = 0x0048f68c;
  const childHeader = 20;
  const nestedHeader = 52;
  const blobSize = 84;
  const blob = alloc(blobSize);
  for (let offset = 0; offset < blobSize; offset++) e.guest_write8(blob + offset, 0);
  e.guest_write32(blob, 1);
  e.guest_write32(blob + 12, childHeader);
  e.guest_write32(blob + childHeader, 1);
  e.guest_write32(blob + childHeader + 20, 0x08); // resource child is a popup
  e.guest_write32(blob + childHeader + 28, nestedHeader);
  e.guest_write32(blob + nestedHeader, 1);
  e.guest_write32(blob + nestedHeader + 24, 44);
  e.test_wnd_table_set(hwnd, wndproc);
  e.menu_set_source_guest(hwnd, blob, blobSize, source);
  const fileMenu = e.test_owner_get_submenu(source, 0) >>> 0;
  const submenu = e.test_owner_get_submenu(fileMenu, 0) >>> 0;
  assert(submenu, 'second GetSubMenu returns the mutable cascade');

  const itemData = 0x1234abcd;
  const mii = alloc(44);
  for (let offset = 0; offset < 44; offset += 4) e.guest_write32(mii + offset, 0);
  e.guest_write32(mii, 44);
  e.guest_write32(mii + 4, MIIM_FTYPE | MIIM_ID | MIIM_DATA | MIIM_STATE);
  e.guest_write32(mii + 8, MFT_OWNERDRAW);
  e.guest_write32(mii + 12, 0);
  e.guest_write32(mii + 16, 952);
  e.guest_write32(mii + 32, itemData);
  assert.strictEqual(e.test_owner_set_item_info(submenu, 0, 1, mii), 1);

  assert.strictEqual(e.menu_submenu_width(hwnd, 0, 0), 260,
    'MEASUREITEM width plus Win98 menu gutters controls cascade width');
  assert.strictEqual(e.menu_submenu_height(hwnd, 0, 0), 32,
    'MEASUREITEM height controls cascade bounds');
  assert.strictEqual(e.menu_submenu_width(hwnd, 0, 0), 260);
  assert.strictEqual(e.guest_read32(marker), 1,
    'repeated geometry queries reuse the cached MEASUREITEM result');
  assert.deepStrictEqual([
    e.guest_read32(marker + 8), e.guest_read32(marker + 12),
    e.guest_read32(marker + 16), e.guest_read32(marker + 20) >>> 0,
  ], [1, 0, 952, itemData],
  'MEASUREITEMSTRUCT carries ODT_MENU, zero control id, command id and itemData');

  assert.strictEqual(e.test_owner_hittest(hwnd, 20, 20, 100, 49), 0,
    'the last pixel of the 28px owner-measured row is clickable');
  assert.strictEqual(e.test_owner_hittest(hwnd, 20, 20, 100, 50), -1,
    'the lower border is not mistaken for another row');

  assert.strictEqual(e.menu_prepare_overlay(), 1);
  e.test_owner_paint(hwnd, 20, 20, 0);
  assert.strictEqual(e.guest_read32(marker + 4), 1,
    'painting dispatches exactly one WM_DRAWITEM callback');
  assert.deepStrictEqual([
    e.guest_read32(marker + 24), e.guest_read32(marker + 28),
    e.guest_read32(marker + 32), e.guest_read32(marker + 36),
    e.guest_read32(marker + 40), e.guest_read32(marker + 44) >>> 0,
    e.guest_read32(marker + 52), e.guest_read32(marker + 56),
    e.guest_read32(marker + 60), e.guest_read32(marker + 64),
    e.guest_read32(marker + 68) >>> 0,
  ], [1, 0, 952, 1, 1, submenu, 20, 22, 280, 50, itemData],
  'DRAWITEMSTRUCT carries ODT_MENU/action/selection/HMENU/rect/itemData');
  assert.strictEqual(e.guest_read32(marker + 48) >>> 0,
    e.test_gdi_menu_overlay_dc() >>> 0,
  'DRAWITEMSTRUCT exposes the canonical menu-overlay HDC');

  const descriptor = RegionMap.BASE.GDI_LINE_DESC;
  assert.strictEqual(e.test_gdi_surface_descriptor(
    e.test_gdi_menu_overlay_dc(), descriptor), 1);
  const storage = view.getUint32(descriptor, true);
  const stride = view.getUint32(descriptor + 12, true);
  const pixel = storage + 30 * stride + 100 * 4;
  assert(bytes[pixel] < 8 && bytes[pixel + 1] < 8 && bytes[pixel + 2] < 8,
    'guest FillRect paints the owner-draw row into the visible overlay');

  // An item mutation invalidates cached dimensions, just as Win98 asks the
  // owner to measure the changed item before its next display.
  assert.strictEqual(e.test_owner_set_item_info(submenu, 0, 1, mii), 1);
  assert.strictEqual(e.menu_submenu_height(hwnd, 0, 0), 32);
  assert.strictEqual(e.guest_read32(marker), 2,
    'SetMenuItemInfo invalidates and refreshes the measurement cache');

  e.menu_clear(hwnd);
  assert.strictEqual(e.test_owner_set_item_info(submenu, 0, 1, mii), 0,
    'tearing down the owner retires the measured cascade handle');
  for (const allocation of allocations) e.guest_free(allocation);

  // The browser compositor must reserve the same measured bounds WAT paints;
  // otherwise the bottom of a taller owner-draw item is clipped even though
  // callback dispatch and hit testing are individually correct.
  const renderer = new Win98Renderer(createCanvas(320, 200));
  renderer.windows[hwnd] = { hwnd };
  renderer._menuBarPos = () => ({ barX: 10, barY: 20, barH: 18 });
  renderer._openMenuContext = () => ({
    hwnd,
    exports: {
      menu_open_top: () => 0,
      menu_open_hover: () => 0,
      menu_open_sub_hover: () => -1,
      menu_open_x: () => -1,
      menu_open_y: () => -1,
      menu_bar_item_x: () => 4,
      menu_dropdown_height: () => 44,
      menu_dropdown_width: () => 80,
      menu_child_sub_count: () => 1,
      menu_submenu_width: () => 260,
      menu_submenu_height: () => 32,
    },
  });
  assert.deepStrictEqual(renderer._openMenuGeometry().rects, [
    { x: 14, y: 38, w: 80, h: 44 },
    { x: 94, y: 40, w: 260, h: 32 },
  ], 'browser overlay reserves the owner-measured cascade height');
  console.log('PASS  owner-draw resource menus use guest measure/draw callbacks and overlay pixels');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
