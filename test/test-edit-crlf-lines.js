#!/usr/bin/env node
'use strict';

// A multiline EDIT holding CRLF text. Lines break at the \n, and the CR in
// front of it is part of the break, not of the line: EM_LINELENGTH excludes
// it, End puts the caret before it, and it is never drawn.
//
// The unwrapped paint path drew each line up to the \n, CR included, which
// the font rendered as a '?' at every line end: SimCity 2000's budget window
// header read "New City?" / "1903 Budget?" / "January 1903". (The word-wrap
// path already broke on CR; only an ES_AUTOHSCROLL edit showed it.)
//
// The paint check needs no reference image: the same text written with bare
// \n breaks must paint exactly the same pixels.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_edit_message")
    (param $hwnd i32) (param $msg i32) (param $wp i32) (param $lp i32) (result i32)
    (call $edit_wndproc (local.get $hwnd) (local.get $msg) (local.get $wp) (local.get $lp)))
`;

const WM_SETTEXT = 0x000C, WM_PAINT = 0x000F, WM_KEYDOWN = 0x0100;
const EM_GETSEL = 0x00B0, EM_SETSEL = 0x00B1, EM_LINELENGTH = 0x00C1;
const VK_END = 0x23, VK_DOWN = 0x28;
// SimCity 2000's budget header (RT_DIALOG 102, control 101): WS_CHILD |
// WS_VISIBLE | WS_BORDER | ES_READONLY | ES_AUTOHSCROLL | ES_MULTILINE.
const STYLE = 0x50800884;
const W = 120, H = 60;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'all' });
  const str = s => {
    const g = e.guest_alloc(s.length + 1) >>> 0;
    for (let i = 0; i < s.length; i++) e.guest_write8(g + i, s.charCodeAt(i));
    e.guest_write8(g + s.length, 0);
    return g;
  };
  const CRLF = 'New City\r\n1903 Budget\r\nJanuary 1903';
  const LF = 'New City\n1903 Budget\nJanuary 1903';

  const edit = e.test_create_edit(0, 0, W, H, STYLE, str(CRLF)) >>> 0;
  assert.ok(edit, 'edit created');

  // --- line lengths ----------------------------------------------------------
  assert.strictEqual(e.send_message(edit, EM_LINELENGTH, 0, 0), 8,
    'EM_LINELENGTH of "New City\\r\\n" excludes the CR');
  assert.strictEqual(e.send_message(edit, EM_LINELENGTH, 10, 0), 11,
    'EM_LINELENGTH of "1903 Budget\\r\\n" excludes the CR');
  assert.strictEqual(e.send_message(edit, EM_LINELENGTH, 23, 0), 12,
    'the last line has no break to exclude');
  console.log('PASS  EM_LINELENGTH excludes the CR of a CRLF break');

  // --- caret -----------------------------------------------------------------
  e.send_message(edit, EM_SETSEL, 0, 0);
  e.send_message(edit, WM_KEYDOWN, VK_END, 0);
  assert.strictEqual(e.send_message(edit, EM_GETSEL, 0, 0) & 0xFFFF, 8,
    'End stops before the CR, not between CR and LF');
  e.send_message(edit, WM_KEYDOWN, VK_DOWN, 0);
  assert.strictEqual(e.send_message(edit, EM_GETSEL, 0, 0) & 0xFFFF, 18,
    'Down keeps column 8 on the next line');
  e.send_message(edit, EM_SETSEL, 0, 0);
  console.log('PASS  End/Down place the caret before the CR');

  // --- paint -----------------------------------------------------------------
  const bmi = e.guest_alloc(40) >>> 0, out = e.guest_alloc(4) >>> 0;
  e.guest_write32(bmi, 40); e.guest_write32(bmi + 4, W); e.guest_write32(bmi + 8, -H);
  e.guest_write16(bmi + 12, 1); e.guest_write16(bmi + 14, 32);
  const bitmap = e.test_call_CreateDIBSection(0, bmi, 0, out, 0, 0);
  const dc = e.test_call_CreateCompatibleDC(0);
  e.test_call_SelectObject(dc, bitmap);
  const bits = e.guest_read32(out) >>> 0;
  const paint = text => {
    e.send_message(edit, WM_SETTEXT, 0, str(text));
    for (let i = 0; i < W * H; i++) e.guest_write32(bits + i * 4, 0x00FF00FF);
    e.test_edit_message(edit, WM_PAINT, dc, 0);
    const px = [];
    for (let i = 0; i < W * H; i++) px.push(e.guest_read32(bits + i * 4) & 0xFFFFFF);
    return px;
  };
  const crlf = paint(CRLF), lf = paint(LF);
  const ink = crlf.filter(p => p === 0).length;
  assert.ok(ink > 50, `CRLF text painted some glyphs (${ink} black pixels)`);
  const diff = crlf.reduce((n, p, i) => n + (p !== lf[i]), 0);
  assert.strictEqual(diff, 0,
    `CRLF text paints exactly like LF text (${diff} pixels differ: a CR drawn as a glyph)`);
  console.log(`PASS  CRLF lines paint like LF lines (${ink} ink pixels, 0 differ)`);
})().catch(err => { console.error(err); process.exit(1); });
