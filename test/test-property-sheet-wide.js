#!/usr/bin/env node
'use strict';

// PropertySheetW and CreatePropertySheetPageW share the mature ANSI page,
// callback, lifetime, and modal machinery. This fixture makes the encoding
// distinction observable with a named RT_DIALOG resource: the W spelling must
// consume its UTF-16 name and caption, while the A spelling remains unchanged.

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const IMAGE_BASE = 0x400000;
const RSRC_RVA = 0x16000;
const DATA_RVA = 0x17000;

const extraWat = String.raw`
  (global $test_propsheet_cleanup (mut i32) (i32.const 0))

  (func (export "test_CreatePropertySheetPageA") (param $psp i32) (result i32)
    (local $before i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreatePropertySheetPageA
      (local.get $psp) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_propsheet_cleanup
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_CreatePropertySheetPageW") (param $psp i32) (result i32)
    (local $before i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreatePropertySheetPageW
      (local.get $psp) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_propsheet_cleanup
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_DestroyPropertySheetPage") (param $page i32) (result i32)
    (call $handle_DestroyPropertySheetPage
      (local.get $page) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_propsheet_cleanup") (result i32)
    (global.get $test_propsheet_cleanup))
  (func (export "test_propsheet_page_is_wide") (param $page i32) (result i32)
    (call $propsheet_page_is_wide (local.get $page)))
  (func (export "test_propsheet_page_callback")
      (param $page i32) (param $message i32) (result i32)
    (local $raw_w i32)
    (local.set $raw_w (call $propsheet_page_record (local.get $page)))
    (if (i32.eqz (local.get $raw_w)) (then (return (i32.const 0))))
    (call $propsheet_page_callback
      (local.get $page) (i32.add (local.get $raw_w) (i32.const 8))
      (local.get $message)))

  (func (export "test_PropertySheetA") (param $header i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00401000))
    (call $handle_PropertySheetA
      (local.get $header) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.get $modal_dlg_hwnd))

  (func (export "test_PropertySheetW") (param $header i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00401000))
    (call $handle_PropertySheetW
      (local.get $header) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.get $modal_dlg_hwnd))

  (func (export "test_PropertySheetW_invalid") (param $header i32) (result i32)
    (local $before i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (call $handle_PropertySheetW
      (local.get $header) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_propsheet_cleanup
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_PropertySheet_done")
    (call $modal_done (i32.const 0)))
  (func (export "test_propsheet_page_hwnd") (result i32)
    (global.get $propsheet_page_hwnd))
  (func (export "test_propsheet_modal_adjust") (result i32)
    (global.get $modal_esp_adjust))
  (func (export "test_propsheet_window_wide") (param $hwnd i32) (result i32)
    (call $wnd_unicode_get (local.get $hwnd)))
  (func (export "test_propsheet_control_count") (param $hwnd i32) (result i32)
    (local $slot i32)
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (if (i32.lt_s (local.get $slot) (i32.const 0))
      (then (return (i32.const -1))))
    (i32.load offset=28 (call $dlg_record_addr (local.get $slot))))
  (func (export "test_propsheet_lookup_api") (param $name i32) (result i32)
    (call $lookup_api_id (call $g2w (local.get $name))))
`;

(async () => {
  const apis = ['CreatePropertySheetPageW', 'PropertySheetW']
    .map(name => apiTable.find(entry => entry.name === name));
  const priorTail = apiTable.find(entry => entry.name === 'IsValidSid');
  assert(priorTail, 'the serialized API lane predecessor is present');
  apis.forEach((api, index) => {
    assert(api, `${index ? 'PropertySheetW' : 'CreatePropertySheetPageW'} is exported`);
    assert.strictEqual(api.nargs, 1);
    assert.strictEqual(api.convention, 'stdcall');
    assert.strictEqual(api.id, priorTail.id + index + 1,
      `${api.name} was not appended after the prior stable API tail`);
  });

  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: e, memory, renderer } = harness;
  const bytes = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const wasm = guest => e.guest_to_wasm(guest) >>> 0;
  e.init_thread(1, IMAGE_BASE, 0, 0, 0, 0, 0, RSRC_RVA);

  const allocA = text => {
    const ptr = e.guest_alloc(text.length + 1) >>> 0;
    const wa = wasm(ptr);
    for (let i = 0; i < text.length; i++) bytes[wa + i] = text.charCodeAt(i);
    bytes[wa + text.length] = 0;
    return ptr;
  };
  const allocW = text => {
    const ptr = e.guest_alloc((text.length + 1) * 2) >>> 0;
    const wa = wasm(ptr);
    for (let i = 0; i < text.length; i++) {
      dv.setUint16(wa + i * 2, text.charCodeAt(i), true);
    }
    dv.setUint16(wa + text.length * 2, 0, true);
    return ptr;
  };
  apis.forEach(api => {
    assert.strictEqual(e.test_propsheet_lookup_api(allocA(api.name)) >>> 0, api.id,
      `${api.name} is missing from the generated name hash`);
  });

  // Minimal PE resource tree: RT_DIALOG -> named "WideDlg" -> en-US -> data.
  const root = wasm(IMAGE_BASE + RSRC_RVA);
  dv.setUint16(root + 14, 1, true); // one integer type entry
  dv.setUint32(root + 16, 5, true);
  dv.setUint32(root + 20, 0x80000020, true);
  dv.setUint16(root + 0x20 + 12, 1, true); // one named resource entry
  dv.setUint32(root + 0x30, 0x80000080, true);
  dv.setUint32(root + 0x34, 0x80000040, true);
  dv.setUint16(root + 0x40 + 14, 1, true); // one language entry
  dv.setUint32(root + 0x50, 0x0409, true);
  dv.setUint32(root + 0x54, 0x00000060, true);
  dv.setUint32(root + 0x60, DATA_RVA, true);
  dv.setUint32(root + 0x64, 128, true);
  const resourceName = 'WideDlg';
  dv.setUint16(root + 0x80, resourceName.length, true);
  for (let i = 0; i < resourceName.length; i++) {
    dv.setUint16(root + 0x82 + i * 2, resourceName.charCodeAt(i), true);
  }

  // Classic DLGTEMPLATE with one static child. A successful named lookup
  // therefore returns/records one control; a failed lookup records zero.
  const tmpl = wasm(IMAGE_BASE + DATA_RVA);
  let p = tmpl;
  dv.setUint32(p, 0x50000000, true); p += 4; // WS_CHILD | WS_VISIBLE
  dv.setUint32(p, 0, true); p += 4;
  dv.setUint16(p, 1, true); p += 2;
  for (const value of [0, 0, 100, 50]) { dv.setInt16(p, value, true); p += 2; }
  dv.setUint16(p, 0, true); p += 2; // no menu
  dv.setUint16(p, 0, true); p += 2; // default dialog class
  dv.setUint16(p, 0, true); p += 2; // empty title
  p = (p + 3) & ~3;
  dv.setUint32(p, 0x50000000, true); p += 4;
  dv.setUint32(p, 0, true); p += 4;
  for (const value of [4, 4, 60, 12]) { dv.setInt16(p, value, true); p += 2; }
  dv.setUint16(p, 77, true); p += 2;
  dv.setUint16(p, 0xFFFF, true); p += 2;
  dv.setUint16(p, 0x0082, true); p += 2; // Static
  for (const ch of 'Wide child') { dv.setUint16(p, ch.charCodeAt(0), true); p += 2; }
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0, true);

  const dlgProc = e.guest_alloc(16) >>> 0;
  bytes.set([
    0xB8, 0x01, 0x00, 0x00, 0x00, // mov eax,1
    0xC2, 0x10, 0x00,             // ret 16
  ], wasm(dlgProc));

  const allocPage = (template, flags = 0, size = 40) => {
    const page = e.guest_alloc(size) >>> 0;
    for (let offset = 0; offset < size; offset += 4) e.guest_write32(page + offset, 0);
    e.guest_write32(page, size);
    e.guest_write32(page + 4, flags);
    e.guest_write32(page + 8, IMAGE_BASE);
    e.guest_write32(page + 12, template);
    e.guest_write32(page + 24, dlgProc);
    return page;
  };
  const allocHeader = (caption, page) => {
    const header = e.guest_alloc(36) >>> 0;
    for (let offset = 0; offset < 36; offset += 4) e.guest_write32(header + offset, 0);
    e.guest_write32(header, 36);
    e.guest_write32(header + 4, 0x00000008); // PSH_PROPSHEETPAGE
    e.guest_write32(header + 20, caption);
    e.guest_write32(header + 24, 1);
    e.guest_write32(header + 32, page);
    return header;
  };

  // The public page front doors use the same copy/lifetime logic and retain
  // only the encoding distinction needed when the page is materialized.
  assert.strictEqual(e.test_CreatePropertySheetPageA(0), 0);
  assert.strictEqual(e.test_propsheet_cleanup(), 8);
  assert.strictEqual(e.test_CreatePropertySheetPageW(0), 0);
  assert.strictEqual(e.test_propsheet_cleanup(), 8,
    'both CreatePropertySheetPage spellings use the one-argument stdcall ABI');
  const invalidPageW = allocPage(allocW(resourceName), 0, 36);
  assert.strictEqual(e.test_CreatePropertySheetPageW(invalidPageW), 0,
    'CreatePropertySheetPageW rejects an unsupported structure size');
  assert.strictEqual(e.test_propsheet_cleanup(), 8);

  assert.strictEqual(e.test_PropertySheetW_invalid(0), -1,
    'PropertySheetW reports its documented creation error for NULL');
  assert.strictEqual(e.test_propsheet_cleanup(), 8);
  const invalidHeaderW = allocHeader(allocW('Invalid'), allocPage(allocW(resourceName)));
  e.guest_write32(invalidHeaderW + 24, 100);
  assert.strictEqual(e.test_PropertySheetW_invalid(invalidHeaderW), -1,
    'PropertySheetW rejects the Win98 100-page boundary');
  assert.strictEqual(e.test_propsheet_cleanup(), 8);

  const capture = e.guest_alloc(8) >>> 0;
  const callback = e.guest_alloc(32) >>> 0;
  const le32 = value => [value, value >>> 8, value >>> 16, value >>> 24]
    .map(byte => byte & 0xFF);
  bytes.set([
    0x8B, 0x44, 0x24, 0x08,          // mov eax,[esp+8]  (uMsg)
    0xA3, ...le32(capture),           // mov [capture],eax
    0x8B, 0x44, 0x24, 0x0C,          // mov eax,[esp+12] (ppsp)
    0xA3, ...le32(capture + 4),       // mov [capture+4],eax
    0xB8, 0x01, 0x00, 0x00, 0x00,    // mov eax,1
    0xC2, 0x0C, 0x00,                // ret 12
  ], wasm(callback));
  const parentRef = e.guest_alloc(4) >>> 0;
  e.guest_write32(parentRef, 9);
  const sourceW = allocPage(allocW(resourceName), 0x80 | 0x40, 48);
  e.guest_write32(sourceW + 32, callback);
  e.guest_write32(sourceW + 36, parentRef);
  const pageW = e.test_CreatePropertySheetPageW(sourceW) >>> 0;
  assert(pageW && pageW !== sourceW, 'CreatePropertySheetPageW returns an owned page copy');
  assert.strictEqual(e.test_propsheet_page_is_wide(pageW), 1);
  assert.deepStrictEqual([0, 4, 8, 12, 24].map(offset =>
    e.guest_read32(pageW + offset) >>> 0),
  [48, 0xC0, IMAGE_BASE, e.guest_read32(sourceW + 12) >>> 0, dlgProc],
  'the W page preserves the identical 32-bit public structure layout');
  assert.strictEqual(e.guest_read32(capture), 0,
    'the W page receives PSPCB_ADDREF through the shared callback path');
  assert.strictEqual(e.guest_read32(capture + 4) >>> 0, pageW,
    'the callback receives the owned PROPSHEETPAGEW copy');
  assert.strictEqual(e.guest_read32(parentRef), 10,
    'PSP_USEREFPARENT is incremented before the W callback');
  assert.strictEqual(e.test_propsheet_page_callback(pageW, 2), 1);
  assert.strictEqual(e.guest_read32(capture), 2,
    'PSPCB_CREATE preserves its return value for W pages');
  assert.strictEqual(e.test_DestroyPropertySheetPage(pageW), 1);
  assert.strictEqual(e.guest_read32(capture), 1,
    'destroying the W page delivers PSPCB_RELEASE');
  assert.strictEqual(e.guest_read32(parentRef), 9,
    'W page teardown balances PSP_USEREFPARENT after RELEASE');
  assert.strictEqual(e.test_DestroyPropertySheetPage(pageW), 0,
    'the shared lifetime path rejects a stale W page handle');

  const sourceA = allocPage(allocA(resourceName));
  const pageA = e.test_CreatePropertySheetPageA(sourceA) >>> 0;
  assert(pageA, 'CreatePropertySheetPageA remains functional through the shared allocator');
  assert.strictEqual(e.test_propsheet_page_is_wide(pageA), 0);
  assert.strictEqual(e.test_DestroyPropertySheetPage(pageA), 1);

  const wideHeader = allocHeader(
    allocW('Wide property sheet'), allocPage(allocW(resourceName)));
  const wideFrame = e.test_PropertySheetW(wideHeader) >>> 0;
  assert(wideFrame, 'PropertySheetW creates and parks a modal sheet');
  const widePage = e.test_propsheet_page_hwnd() >>> 0;
  assert(widePage, 'PropertySheetW materializes its initial page');
  assert.strictEqual(renderer.windows[wideFrame].title, 'Wide property sheet',
    'the UTF-16 sheet caption reaches the existing renderer as complete text');
  assert.strictEqual(e.test_propsheet_window_wide(wideFrame), 1);
  assert.strictEqual(e.test_propsheet_window_wide(widePage), 1,
    'the W frame and page retain Unicode window identity');
  assert.strictEqual(e.test_propsheet_control_count(widePage), 1,
    'PropertySheetW resolves a UTF-16 named RT_DIALOG and builds its child');
  assert.strictEqual(e.test_propsheet_modal_adjust(), 8,
    'PropertySheetW parks with the same one-argument modal ABI as A');
  e.test_PropertySheet_done();

  const ansiHeader = allocHeader(
    allocA('ANSI property sheet'), allocPage(allocA(resourceName)));
  const ansiFrame = e.test_PropertySheetA(ansiHeader) >>> 0;
  assert(ansiFrame, 'PropertySheetA still creates the same modal sheet shape');
  const ansiPage = e.test_propsheet_page_hwnd() >>> 0;
  assert.strictEqual(renderer.windows[ansiFrame].title, 'ANSI property sheet');
  assert.strictEqual(e.test_propsheet_window_wide(ansiFrame), 0);
  assert.strictEqual(e.test_propsheet_window_wide(ansiPage), 0);
  assert.strictEqual(e.test_propsheet_control_count(ansiPage), 1,
    'PropertySheetA keeps ANSI named-resource lookup after parameterization');
  assert.strictEqual(e.test_propsheet_modal_adjust(), 8);
  e.test_PropertySheet_done();

  console.log('PASS  PropertySheetA/W share layout, lifetime, resource, and modal behavior');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
