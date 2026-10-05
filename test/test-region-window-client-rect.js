#!/usr/bin/env node
// Regioned/skinned windows keep their whole shaped surface as the client
// area even after later move/resize NCCALCSIZE passes.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated');

(async () => {
  const { instance, exports: e, renderer, memory } = await bootRenderHarness();
  const hwnd = 0x10001;
  const style = 0x00ca0000; // Winamp-style caption/sysmenu frame.
  const rect = RegionMap.BASE.TEST_SCRATCH + 0x20;
  const dv = new DataView(memory.buffer);
  const box = hrgn => {
    const complexity = e.test_gdi_rgn_get_box(hrgn, rect);
    return {
      complexity,
      rect: [0, 4, 8, 12].map(offset => dv.getInt32(rect + offset, true)),
    };
  };

  renderer.createWindow(hwnd, style, 26, 29, 275, 116, 'Winamp 2.91', 0, instance, memory);
  renderer.windows[hwnd].visible = true;
  // No guest wndproc: 1 is not an address, and once wnd_destroy_tree started
  // sending WM_DESTROY the emulator went off and executed it.
  e.wnd_table_set(hwnd, 0);
  e.wnd_set_style_export(hwnd, style);

  e.host_resize_commit(hwnd, 26, 29, 275, 116);
  assert.strictEqual(e.get_client_rect_l(hwnd), 3, 'plain captioned window should use standard left border');
  assert.strictEqual(e.get_client_rect_t(hwnd), 23, 'plain captioned window should use standard caption offset');
  assert.strictEqual(e.get_client_rect_r(hwnd), 272, 'plain captioned window should subtract right border');
  assert.strictEqual(e.get_client_rect_b(hwnd), 112, 'plain captioned window should subtract bottom border');

  const source = e.test_gdi_rgn_alloc_rect(4, 7, 271, 109);
  const copy = e.test_gdi_rgn_alloc_rect(0, 0, 0, 0);
  assert.notStrictEqual(source, 0);
  assert.notStrictEqual(copy, 0);
  assert.strictEqual(e.test_call_GetWindowRgn(hwnd, copy), 0,
    'window without a region should return ERROR');
  assert.strictEqual(e.test_call_SetWindowRgn(hwnd, source, 0), 1,
    'SetWindowRgn should transfer the canonical region to USER');
  renderer.windows[hwnd].x = 120;
  renderer.windows[hwnd].y = 80;
  e.host_resize_commit(hwnd, 120, 80, 275, 116);

  assert.strictEqual(e.wnd_region_get_export(hwnd), 1, 'region flag should stay set');
  assert.strictEqual(e.get_client_rect_l(hwnd), 0, 'regioned window client left should stay at skin origin');
  assert.strictEqual(e.get_client_rect_t(hwnd), 0, 'regioned window client top should stay at skin origin');
  assert.strictEqual(e.get_client_rect_r(hwnd), 275, 'regioned window client right should stay full width');
  assert.strictEqual(e.get_client_rect_b(hwnd), 116, 'regioned window client bottom should stay full height');

  assert.strictEqual(e.test_call_GetWindowRgn(hwnd, copy), 2,
    'GetWindowRgn should report SIMPLEREGION');
  assert.deepStrictEqual(box(copy), {
    complexity: 2,
    rect: [4, 7, 271, 109],
  }, 'GetWindowRgn should copy window-relative geometry into the caller region');

  assert.strictEqual(e.test_call_SetWindowRgn(hwnd, 0, 0), 1,
    'SetWindowRgn(NULL) should restore the ordinary rectangular window');
  assert.strictEqual(e.wnd_region_get_export(hwnd), 0,
    'clearing the window region should clear shaped-window state');
  assert.strictEqual(e.test_gdi_rgn_get_box(source, rect), 0,
    'replacing a USER-owned window region should release its source HRGN');
  assert.strictEqual(e.test_call_GetWindowRgn(hwnd, copy), 0,
    'GetWindowRgn should return ERROR after the window region is cleared');

  const replacement = e.test_gdi_rgn_alloc_rect(8, 11, 267, 105);
  assert.notStrictEqual(replacement, 0);
  assert.strictEqual(e.test_call_SetWindowRgn(hwnd, replacement, 0), 1,
    'a cleared window should accept a replacement region');

  e.wnd_destroy_tree(hwnd);
  assert.strictEqual(e.wnd_region_get_export(hwnd), 0, 'region flag should clear when the slot is destroyed');
  assert.strictEqual(e.test_gdi_rgn_get_box(replacement, rect), 0,
    'destroying the window should release its USER-owned source region');
  assert.deepStrictEqual(box(copy), {
    complexity: 2,
    rect: [4, 7, 271, 109],
  }, 'the caller-owned GetWindowRgn copy should remain independent');

  // A dock collapsed along either axis must not retain its previous client
  // extent. Paint collapses its Color Box dock to height zero when hidden.
  const dock = 0x10002;
  const dockStyle = 0x10000000; // borderless fixture; outer size owned by renderer
  renderer.createWindow(dock, dockStyle, 0, 0, 267, 49, 'dock', 0, instance, memory);
  e.wnd_table_set(dock, 0);
  e.wnd_set_style_export(dock, dockStyle);
  for (const [w, h] of [[267, 49], [267, 0], [0, 49], [0, 0], [267, 49]]) {
    renderer.windows[dock].w = w;
    renderer.windows[dock].h = h;
    e.host_resize_commit(dock, 0, 0, w, h);
    assert.deepStrictEqual([
      e.get_client_rect_r(dock) - e.get_client_rect_l(dock),
      e.get_client_rect_b(dock) - e.get_client_rect_t(dock),
    ], [w, h], `collapsed dock client must track ${w}x${h}`);
    renderer._computeClientRect(renderer.windows[dock]);
    assert.strictEqual(renderer.windows[dock].clientRect.w, w);
    assert.strictEqual(renderer.windows[dock].clientRect.h, h);
  }

  console.log('PASS  regioned window client rect survives move/resize nccalc');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
