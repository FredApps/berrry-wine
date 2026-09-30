#!/usr/bin/env node

'use strict';

// A child window's visible region is built inside its parent's. When a WS_CHILD
// ancestor has WS_CLIPSIBLINGS, the ancestor's higher-z visible siblings are
// removed from every descendant as well.
//
// Civilization II (Win16) opens a city window as a CLIPSIBLINGS child of the
// frame, raised above the City Status advisor. The advisor's own children, its
// "Close" bar and its scrollbar, only considered their own siblings. They kept
// painting across the city window and across the modal production list above
// it.

const assert = require('assert');
const { createCanvas } = require('../lib/canvas-compat');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

const FRAME = 0x10001;
const ADVISOR = 0x10002;
const CITY = 0x10003;
const CLOSEBAR = 0x10004;

const CLIP_PANE = 0x56000000;  // CHILD|VISIBLE|CLIPSIBLINGS|CLIPCHILDREN
const PLAIN_CHILD = 0x50000000; // CHILD|VISIBLE

async function main() {
  const wasm = compileSrcWasm();
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const frameCanvas = createCanvas(400, 300);
  const renderer = {
    canvas: createCanvas(640, 480),
    windows: {
      [FRAME]: { hwnd: FRAME, x: 0, y: 0, w: 400, h: 300, style: 0x10000000, isChild: false,
        clientRect: { x: 0, y: 0, w: 400, h: 300 } },
    },
    wasm: { exports: null },
    getWindowCanvas: hwnd => hwnd === FRAME
      ? { canvas: frameCanvas, ctx: frameCanvas.getContext('2d') } : null,
    scheduleRepaint: () => {},
    invalidate: () => {},
    attachWindowSurface: () => false,
    detachWindowSurface: () => false,
  };
  const ctx = { getMemory: () => memory.buffer, renderer, resourceJson: {}, exports: null };
  const base = createHostImports(ctx);
  base.host.memory = memory;
  base.host.create_thread = () => 0;
  base.host.exit_thread = () => 0;
  base.host.create_event = () => 0;
  base.host.set_event = () => 0;
  base.host.reset_event = () => 0;
  base.host.wait_single = () => 0;
  base.host.wait_multiple = () => 0;
  base.host.com_create_instance = () => 0x80004002;
  const { instance } = await WebAssembly.instantiate(wasm, base);
  const wat = instance.exports;
  ctx.exports = wat;
  renderer.wasm.exports = wat;

  for (const hwnd of [FRAME, ADVISOR, CITY, CLOSEBAR]) wat.wnd_table_set(hwnd, 0);
  wat.ctrl_set_geom(FRAME, 0, 0, 400, 300);
  // The advisor is bordered: its client area starts at (1,1) in its window.
  // The close bar is at (0,120) in that client area, which puts its window
  // origin at (11,131) in the frame's client area.
  wat.ctrl_set_geom(ADVISOR, 10, 10, 200, 150);
  wat.ctrl_set_geom(CITY, 100, 50, 200, 150);
  wat.ctrl_set_geom(CLOSEBAR, 0, 120, 198, 20);
  wat.test_wnd_set_parent(ADVISOR, FRAME);
  wat.test_wnd_set_parent(CITY, FRAME);
  wat.test_wnd_set_parent(CLOSEBAR, ADVISOR);
  wat.wnd_set_style_export(FRAME, 0x10000000);
  wat.wnd_set_style_export(ADVISOR, CLIP_PANE);
  wat.wnd_set_style_export(CITY, CLIP_PANE);
  wat.wnd_set_style_export(CLOSEBAR, PLAIN_CHILD);
  wat.test_gdi_client_rect_set(FRAME, 0, 0, 400, 300);
  wat.test_gdi_client_rect_set(ADVISOR, 1, 1, 199, 149);
  wat.test_gdi_client_rect_set(CITY, 1, 1, 199, 149);
  wat.test_gdi_client_rect_set(CLOSEBAR, 0, 0, 198, 20);
  wat.wnd_z_set_after(ADVISOR, 0);
  wat.wnd_z_set_after(CITY, 0);
  assert.strictEqual(wat.wnd_z_is_above_sibling(ADVISOR, CITY), 1,
    'setup: the city window must be above the advisor');

  const hdc = wat.test_call_GetDC(CLOSEBAR) >>> 0;
  assert(hdc, 'GetDC must allocate a close-bar DC');
  const visible = (x, y) => wat.test_gdi_dc_clip_point_visible(hdc, x, y);
  const refresh = () => wat.dc_apply_client_clip(hdc, CLOSEBAR);

  refresh();
  assert.strictEqual(visible(5, 5), 1,
    'the part of the close bar left of the city window stays visible');
  assert.strictEqual(visible(88, 5), 1,
    'frame x=99 is still left of the city window');
  assert.strictEqual(visible(89, 5), 0,
    'frame x=100 is under the city window: the advisor clips its siblings, ' +
    'so its descendants must lose the higher-z city as well');
  assert.strictEqual(visible(150, 10), 0,
    'the close bar must not paint over the city window');

  // Z-order decides, not creation order.
  wat.wnd_z_set_after(ADVISOR, 0);
  refresh();
  assert.strictEqual(visible(150, 10), 1,
    'once the advisor is raised above the city, its close bar is visible again');
  wat.wnd_z_set_after(CITY, 0);
  refresh();
  assert.strictEqual(visible(150, 10), 0, 'raising the city again hides it');

  // Only the explicit style clips: an ancestor without WS_CLIPSIBLINGS may
  // overdraw its siblings, and so may its children.
  wat.wnd_set_style_export(ADVISOR, CLIP_PANE & ~0x04000000);
  refresh();
  assert.strictEqual(visible(150, 10), 1,
    'an ancestor without WS_CLIPSIBLINGS does not clip its descendants');
  wat.wnd_set_style_export(ADVISOR, CLIP_PANE);

  // A hidden sibling covers nothing.
  wat.wnd_set_style_export(CITY, CLIP_PANE & ~0x10000000);
  refresh();
  assert.strictEqual(visible(150, 10), 1, 'a hidden city window covers nothing');
  wat.wnd_set_style_export(CITY, CLIP_PANE);
  refresh();
  assert.strictEqual(visible(150, 10), 0);

  // The client-erase clip builds the same visible region.
  wat.dc_apply_client_erase_clip(hdc, CLOSEBAR);
  assert.strictEqual(visible(5, 5), 1);
  assert.strictEqual(visible(150, 10), 0,
    'the close bar erase must not clear the city window either');

  console.log('PASS test-ancestor-clipsiblings');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
