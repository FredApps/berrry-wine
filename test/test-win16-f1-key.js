#!/usr/bin/env node
'use strict';

// F1 on a window with a menu bar becomes WM_HELP for a 32-bit app, but WM_HELP
// is a Win95 message: a 16-bit task binds F1 as an ordinary key. Civilization
// II's City Status advisor is F1, and it never opened while the renderer
// swallowed the keydown and posted a WM_HELP the task does not know.

const assert = require('assert');
const { createCanvas } = require('../lib/canvas-compat');
const { Win98Renderer } = require('../lib/renderer');

function pressF1(win16) {
  const r = new Win98Renderer(createCanvas(64, 48));
  const posted = [];
  r.wasm = { exports: {
    get_focus_hwnd: () => 0x10079,
    wnd_top_level: () => 0x1000b,
    post_message_q: (hwnd, msg, wp, lp) => { posted.push(msg); },
    is_win16: () => win16,
  } };
  r.windows = { 0x1000b: { hwnd: 0x1000b } };
  r._hasMenuBar = () => true;
  r.handleKeyDown(112, { code: 'F1', location: 0, repeat: false });
  const keys = r.inputQueue.filter(ev => ev.type === 'key').map(ev => ev.msg);
  return { posted, keys };
}

const w32 = pressF1(0);
assert.deepStrictEqual(w32.posted, [0x0053], 'a Win32 window with a menu bar gets WM_HELP');
assert.ok(!w32.keys.includes(0x0100), 'and not the keydown as well');

const w16 = pressF1(1);
assert.deepStrictEqual(w16.posted, [], 'a Win16 task gets no WM_HELP');
assert.ok(w16.keys.includes(0x0100), 'it gets the WM_KEYDOWN for F1');

console.log('PASS F1 reaches a Win16 task as a key, not WM_HELP');
