#!/usr/bin/env node
'use strict';

// A destroyed window must not keep a GDI DC slot.
//
// Native controls paint through the internal window DC hwnd+0x40000, which is
// never obtained from GetDC and so is never ReleaseDC'd. The DC-state table
// adopted a record for it on first paint and nothing freed it when the window
// went away. The table has 512 slots; SimCity 2000's budget dialog has ~70
// controls and opens every January, so after seven years GetDC returned NULL,
// MFC threw CResourceException on every repaint and the screen froze while
// the simulation ran on underneath it.
//
// Create, paint, destroy a control 600 times -- more than the table holds --
// and require the table to end where it started.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_edit_message")
    (param $hwnd i32) (param $msg i32) (param $wp i32) (param $lp i32) (result i32)
    (call $edit_wndproc (local.get $hwnd) (local.get $msg) (local.get $wp) (local.get $lp)))
  (func (export "test_destroy") (param $hwnd i32)
    (call $wnd_destroy_recursive (local.get $hwnd)))
  (func (export "test_parent_of") (param $hwnd i32) (result i32)
    (call $wnd_get_parent (local.get $hwnd)))
`;

const WM_PAINT = 0x000F;
const STYLE = 0x50800884;   // WS_CHILD|WS_VISIBLE|WS_BORDER|ES_READONLY|ES_AUTOHSCROLL|ES_MULTILINE
const ROUNDS = 600;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const cap = e.gdi_dc_state_capacity();
  assert.ok(ROUNDS > cap, `the loop must outrun the ${cap}-slot table`);

  const round = () => {
    const edit = e.test_create_edit(0, 0, 80, 40, STYLE, 0) >>> 0;
    assert.ok(edit, 'edit created');
    const parent = e.test_parent_of(edit) >>> 0;
    e.test_edit_message(edit, WM_PAINT, 0, 0);   // paints through edit+0x40000
    e.test_destroy(parent || edit);
    return edit;
  };

  round();                                        // warm up anything one-time
  const before = e.gdi_dc_state_used();
  const probe = e.test_create_edit(0, 0, 80, 40, STYLE, 0) >>> 0;
  e.test_edit_message(probe, WM_PAINT, 0, 0);
  assert.ok(e.gdi_dc_state_used() > before,
    'painting a control adopts its internal DC (else this test measures nothing)');
  e.test_destroy(e.test_parent_of(probe) || probe);
  assert.strictEqual(e.gdi_dc_state_used(), before,
    'destroying the control releases the DC its paint adopted');
  console.log('PASS  destroying a painted control frees its internal DC slot');

  for (let i = 0; i < ROUNDS; i++) round();
  const after = e.gdi_dc_state_used();
  assert.strictEqual(after, before,
    `${ROUNDS} create/paint/destroy rounds leaked ${after - before} DC slots (table ${after}/${cap})`);
  console.log(`PASS  ${ROUNDS} create/paint/destroy rounds leave the DC table at ${after}/${cap}`);
})().catch(err => { console.error(err); process.exit(1); });
