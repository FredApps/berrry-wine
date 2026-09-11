#!/usr/bin/env node
'use strict';
// A resource-dialog EDIT has a WAT HWND but no renderer.windows entry.
const assert = require('assert');
const { Win98Renderer } = require('../lib/renderer');
const { keyboardProxyAction } = require('../lib/mobile-keyboard');
const p = Win98Renderer.prototype;
let visible = true, style = 0x50010000, parent = 1, width = 190;
const e = {
  get_caret_visible: () => visible, get_caret_hwnd: () => 2,
  get_caret_x: () => 5, get_caret_y: () => 3,
  get_caret_w: () => 2, get_caret_h: () => 15,
  wnd_get_style_export: () => style, wnd_get_parent: () => parent,
  wnd_client_screen_x: () => 140, wnd_client_screen_y: () => 248,
  wnd_screen_w: () => width, wnd_screen_h: () => 24,
};
const wasm = { exports: e };
const r = Object.create(p);
r.wasm = wasm;
r.windows = { 1: { hwnd: 1, visible: true, wasm, x: 100, y: 177,
  clientRect: { x: 100, y: 200 }, w: 275, h: 134 } };
r._computeClientRect = () => {};
r._caretBlinkState = new Map();
const painted = [];
r._fillCaretRect = rect => painted.push(rect);
r._scheduleCaretBlink = active => { r.blinkActive = active; };
r._paintCaretOverlay();
assert.deepStrictEqual(r.caretRect(), { x: 145, y: 251, w: 2, h: 15 });
assert.strictEqual(painted.length, 1, 'native child caret is painted');
assert.strictEqual(r.blinkActive, true);
assert.strictEqual(r.windows[2], undefined, 'no synthetic window or surface');
assert.strictEqual(keyboardProxyAction({ hasCaret: !!r.caretRect(),
  proxyFocused: false, gesture: true }), 'focus', 'tap can open phone keyboard');
r._caretBlinkState.get(wasm).phase = false;
r._paintCaretOverlay();
assert(r.caretRect(), 'blink-off phase keeps the keyboard anchor');
assert.strictEqual(painted.length, 1, 'blink-off does not paint');
function hidden(reason) {
  r._paintCaretOverlay();
  assert.strictEqual(r.caretRect(), null, reason);
  assert.strictEqual(r.blinkActive, false, reason);
}
visible = false; hidden('HideCaret'); visible = true;
style = 0; hidden('hidden or destroyed native child'); style = 0x50010000;
r.windows[1].visible = false; hidden('hidden parent'); r.windows[1].visible = true;
parent = 0; hidden('orphan'); parent = 2; hidden('cyclic ancestry'); parent = 1;
width = 0; hidden('empty control'); width = 190;
r.windows[1].wasm = {}; hidden('foreign process'); r.windows[1].wasm = wasm;
r._paintCaretOverlay(); assert(r.caretRect(), 'visible again');
// Existing JS-backed windows retain their original geometry path.
r.windows[2] = { hwnd: 2, visible: true, parentHwnd: 1, x: 40, y: 48, w: 190, h: 24 };
r._paintCaretOverlay();
assert.deepStrictEqual(r.caretRect(), { x: 145, y: 251, w: 2, h: 15 });
console.log('PASS native dialog caret: paint, blink, keyboard anchor, visibility and ownership');
