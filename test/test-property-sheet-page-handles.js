#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_psp_cleanup (mut i32) (i32.const 0))

  (func (export "test_create_property_sheet_page") (param $psp i32) (result i32)
    (local $before i32)
    (global.set $esp (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (global.get $esp))
    (call $handle_CreatePropertySheetPageA
      (local.get $psp) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_psp_cleanup
      (i32.sub (global.get $esp) (local.get $before)))
    (global.get $eax))

  (func (export "test_destroy_property_sheet_page") (param $page i32) (result i32)
    (local $before i32)
    (global.set $esp (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (global.get $esp))
    (call $handle_DestroyPropertySheetPage
      (local.get $page) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_psp_cleanup
      (i32.sub (global.get $esp) (local.get $before)))
    (global.get $eax))

  (func (export "test_psp_cleanup") (result i32)
    (global.get $test_psp_cleanup))

  (func (export "test_psp_is_live") (param $page i32) (result i32)
    (i32.ne (call $propsheet_page_record (local.get $page)) (i32.const 0)))
  (func (export "test_psp_callback")
      (param $page i32) (param $message i32) (result i32)
    (local $raw_w i32)
    (local.set $raw_w (call $propsheet_page_record (local.get $page)))
    (if (i32.eqz (local.get $raw_w)) (then (return (i32.const 0))))
    (call $propsheet_page_callback
      (local.get $page) (i32.add (local.get $raw_w) (i32.const 8))
      (local.get $message)))

  (func (export "test_propsheet_header_valid") (param $header i32) (result i32)
    (call $propsheet_header_valid (call $g2w (local.get $header))))

  (func (export "test_psp_use_handle_array") (param $pages i32) (param $count i32)
    (global.set $propsheet_pages (local.get $pages))
    (global.set $propsheet_page_count (local.get $count))
    (global.set $propsheet_pages_are_handles (i32.const 1))
    (global.set $propsheet_owns_page_handles (i32.const 0)))

  (func (export "test_psp_use_inline_array") (param $pages i32) (param $count i32)
    (global.set $propsheet_pages (local.get $pages))
    (global.set $propsheet_page_count (local.get $count))
    (global.set $propsheet_pages_are_handles (i32.const 0))
    (global.set $propsheet_owns_page_handles (i32.const 0)))

  (func (export "test_psp_resolve") (param $index i32) (result i32)
    (call $propsheet_resolve_page (local.get $index)))

  (func (export "test_psp_transfer_and_release")
    (global.set $propsheet_owns_page_handles (i32.const 1))
    (call $propsheet_release_pages))
  (func (export "test_psp_prepare_inline") (result i32)
    (call $propsheet_prepare_inline_pages))
  (func (export "test_psp_release_pages")
    (call $propsheet_release_pages))
  (func (export "test_psp_page_hwnds_alloc") (result i32)
    (call $propsheet_page_hwnds_alloc))
  (func (export "test_psp_page_hwnds_release")
    (call $propsheet_page_hwnds_release))
  (func (export "test_psp_page_hwnd_get") (param $index i32) (result i32)
    (call $propsheet_page_hwnd_get (local.get $index)))
  (func (export "test_psp_show_page")
      (param $index i32) (param $frame i32) (result i32)
    (global.set $propsheet_frame_hwnd (local.get $frame))
    (call $propsheet_show_page (local.get $index)))
  (func (export "test_psp_hide_page")
    (call $propsheet_hide_page))
  (func (export "test_psp_window_live") (param $hwnd i32) (result i32)
    (i32.ne (call $wnd_table_find (local.get $hwnd)) (i32.const -1)))
  (func (export "test_psp_window_style") (param $hwnd i32) (result i32)
    (call $wnd_get_style (local.get $hwnd)))
  (func (export "test_psp_dialog_extra_set")
      (param $hwnd i32) (param $value i32) (result i32)
    (call $dialog_extra_set (local.get $hwnd) (i32.const 8) (local.get $value)))
  (func (export "test_psp_dialog_extra_get") (param $hwnd i32) (result i32)
    (call $dialog_extra_get (local.get $hwnd) (i32.const 8)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  e.init_thread(0, 0, 0, 0, 0, 0, 0, 0x1000);

  const allocPage = (size = 40, flags = 0) => {
    // Invalid dwSize values only need the fixed Win98 prefix to be readable;
    // do not ask the fixture allocator for the untrusted claimed extent.
    const bytes = Math.min(Math.max(size, 40), 64);
    const page = e.guest_alloc(bytes) >>> 0;
    for (let offset = 0; offset < bytes; offset += 4) {
      e.guest_write32(page + offset, (0x11000000 + offset) >>> 0);
    }
    e.guest_write32(page, size);
    e.guest_write32(page + 4, flags);
    e.guest_write32(page + 8, 0x00400000);
    e.guest_write32(page + 12, 101);
    e.guest_write32(page + 24, 0x00401234);
    e.guest_write32(page + 32, 0);
    return page;
  };

  const header = e.guest_alloc(52) >>> 0;
  const pagesSentinel = 0x00403000;
  const setHeader = (size, flags = 0, count = 1, pages = pagesSentinel) => {
    for (let offset = 0; offset < 52; offset += 4) {
      e.guest_write32(header + offset, 0);
    }
    e.guest_write32(header, size);
    e.guest_write32(header + 4, flags);
    e.guest_write32(header + 24, count);
    e.guest_write32(header + 32, pages);
    return e.test_propsheet_header_valid(header);
  };

  for (const size of [36, 40, 52]) {
    assert.strictEqual(setHeader(size), 1,
      `Win98 accepts its ${size}-byte PROPSHEETHEADERA version`);
  }
  for (const size of [0, 35, 37, 39, 41, 48, 53, 0xFFFFFFFF]) {
    assert.strictEqual(setHeader(size), 0,
      `Win98 rejects unknown ${size >>> 0}-byte PROPSHEETHEADERA versions`);
  }
  assert.strictEqual(setHeader(36, 0x03FFFFFF), 1,
    'Win98 leaves header flag bits 0..25 available to its versioned parser');
  for (const flags of [0x04000000, 0x80000000, 0xFFFFFFFF]) {
    assert.strictEqual(setHeader(36, flags), 0,
      `Win98 rejects reserved high header flags 0x${flags.toString(16)}`);
  }
  assert.strictEqual(setHeader(36, 0, 99), 1,
    'Win98 accepts at most 99 initial property pages');
  assert.strictEqual(setHeader(36, 0, 100), 0,
    'Win98 rejects nPages == 100 rather than accepting an off-by-one page');
  assert.strictEqual(setHeader(36, 0, 0), 0,
    'an empty sheet is rejected before frame construction');
  assert.strictEqual(setHeader(36, 0, 1, 0), 0,
    'a NULL page array is rejected before ownership transfer');

  assert.strictEqual(e.test_create_property_sheet_page(0), 0,
    'NULL is rejected');
  assert.strictEqual(e.test_psp_cleanup(), 8,
    'CreatePropertySheetPageA pops return address plus one argument');

  for (const size of [0, 39, 4097, 0xFFFFFFFF]) {
    assert.strictEqual(e.test_create_property_sheet_page(allocPage(size)), 0,
      `invalid page size ${size >>> 0} is rejected`);
  }
  assert.strictEqual(e.test_create_property_sheet_page(allocPage(40, 0x10000)), 0,
    'Win98 rejects page flag bits above bit 15');
  const nullCallbackPage = e.test_create_property_sheet_page(allocPage(40, 0x80)) >>> 0;
  assert(nullCallbackPage,
    'Win98 tolerates PSP_USECALLBACK with a NULL callback pointer');
  assert.strictEqual(e.test_destroy_property_sheet_page(nullCallbackPage), 1);

  const makeCallback = result => {
    const capture = e.guest_alloc(8) >>> 0;
    const code = e.guest_alloc(32) >>> 0;
    const le32 = value => [value, value >>> 8, value >>> 16, value >>> 24]
      .map(byte => byte & 0xFF);
    bytes.set([
      0x8B, 0x44, 0x24, 0x08,             // mov eax,[esp+8]  (uMsg)
      0xA3, ...le32(capture),              // mov [capture],eax
      0x8B, 0x44, 0x24, 0x0C,             // mov eax,[esp+12] (ppsp)
      0xA3, ...le32(capture + 4),          // mov [capture+4],eax
      0xB8, ...le32(result),               // mov eax,result
      0xC2, 0x0C, 0x00,                    // ret 12
    ], e.guest_to_wasm(code) >>> 0);
    return { capture, code };
  };

  const accepting = makeCallback(1);
  const parentRef = e.guest_alloc(4) >>> 0;
  e.guest_write32(parentRef, 7);
  const callbackSource = allocPage(48, 0x80 | 0x40);
  e.guest_write32(callbackSource + 32, accepting.code);
  e.guest_write32(callbackSource + 36, parentRef);
  const callbackPage = e.test_create_property_sheet_page(callbackSource) >>> 0;
  assert(callbackPage, 'a callback can approve page creation');
  assert.strictEqual(e.guest_read32(accepting.capture), 0,
    'a newer-sized Win98 page receives return-ignored PSPCB_ADDREF at allocation');
  assert.strictEqual(e.guest_read32(accepting.capture + 4) >>> 0, callbackPage,
    'PSPCB_ADDREF receives the owned copy, not caller storage');
  assert.strictEqual(e.guest_read32(parentRef), 8,
    'PSP_USEREFPARENT increments before PSPCB_ADDREF');
  assert.strictEqual(e.test_psp_callback(callbackPage, 2), 1,
    'PSPCB_CREATE can approve page-dialog materialization');
  assert.strictEqual(e.guest_read32(accepting.capture), 2,
    'PSPCB_CREATE is delivered at page-dialog creation, not handle allocation');
  assert.strictEqual(e.test_destroy_property_sheet_page(callbackPage), 1);
  assert.strictEqual(e.guest_read32(accepting.capture), 1,
    'DestroyPropertySheetPage delivers PSPCB_RELEASE');
  assert.strictEqual(e.guest_read32(accepting.capture + 4) >>> 0, callbackPage,
    'PSPCB_RELEASE identifies the same page copy');
  assert.strictEqual(e.guest_read32(parentRef), 7,
    'release balances the optional parent reference after the callback');
  assert.strictEqual(e.test_destroy_property_sheet_page(callbackPage), 0,
    'release callback and storage retirement happen only once');

  const vetoing = makeCallback(0);
  const vetoSource = allocPage(48, 0x80 | 0x40);
  e.guest_write32(vetoSource + 32, vetoing.code);
  e.guest_write32(vetoSource + 36, parentRef);
  const vetoPage = e.test_create_property_sheet_page(vetoSource) >>> 0;
  assert(vetoPage,
    'PSPCB_ADDREF return value does not veto handle allocation');
  assert.strictEqual(e.test_psp_callback(vetoPage, 2), 0,
    'zero from PSPCB_CREATE vetoes page-dialog materialization');
  assert.strictEqual(e.guest_read32(vetoing.capture), 2,
    'the vetoing callback receives PSPCB_CREATE');
  assert.strictEqual(e.guest_read32(parentRef), 8,
    'the allocated page owns its parent reference even when dialog creation is vetoed');
  assert.strictEqual(e.test_destroy_property_sheet_page(vetoPage), 1);
  assert.strictEqual(e.guest_read32(vetoing.capture), 1,
    'a vetoed page still receives its eventual PSPCB_RELEASE');
  assert.strictEqual(e.guest_read32(parentRef), 7,
    'destroying the vetoed page balances its parent reference');

  const source = allocPage(48);
  e.guest_write32(source + 28, 0x12345678);
  e.guest_write32(source + 44, 0x89ABCDEF);
  const page1 = e.test_create_property_sheet_page(source) >>> 0;
  assert(page1, 'a valid Win98 PROPSHEETPAGEA produces a handle');
  assert.strictEqual(e.test_psp_is_live(page1), 1);
  assert.notStrictEqual(page1, source,
    'the opaque handle refers to an owned copy, not caller storage');
  assert.deepStrictEqual([0, 4, 8, 12, 24, 28, 44].map(offset =>
    e.guest_read32(page1 + offset) >>> 0),
  [48, 0, 0x00400000, 101, 0x00401234, 0x12345678, 0x89ABCDEF],
  'the complete caller-declared structure is copied');
  e.guest_write32(source + 12, 999);
  e.guest_write32(source + 44, 0);
  assert.strictEqual(e.guest_read32(page1 + 12), 101,
    'later caller mutation cannot alter the owned page');
  assert.strictEqual(e.guest_read32(page1 + 44) >>> 0, 0x89ABCDEF);

  const page2 = e.test_create_property_sheet_page(allocPage(40)) >>> 0;
  assert(page2 && page2 !== page1, 'each call creates a distinct owned page');
  const handles = e.guest_alloc(8) >>> 0;
  e.guest_write32(handles, page1);
  e.guest_write32(handles + 4, page2);
  e.test_psp_use_handle_array(handles, 2);
  assert.strictEqual(e.test_psp_resolve(0) >>> 0, page1,
    'HPROPSHEETPAGE array resolves its first owned page');
  assert.strictEqual(e.test_psp_resolve(1) >>> 0, page2,
    'HPROPSHEETPAGE array resolves its next owned page');
  assert.strictEqual(e.test_psp_resolve(2), 0,
    'page indexes are bounded by nPages');

  e.test_psp_transfer_and_release();
  assert.strictEqual(e.test_psp_is_live(page1), 0,
    'sheet teardown releases the first transferred page');
  assert.strictEqual(e.test_psp_is_live(page2), 0,
    'sheet teardown releases every transferred page');
  assert.strictEqual(e.test_destroy_property_sheet_page(page1), 0,
    'a stale page handle is rejected instead of double-freed');
  assert.strictEqual(e.test_psp_cleanup(), 8,
    'DestroyPropertySheetPage uses the one-argument stdcall frame');

  const foreign = e.guest_alloc(40) >>> 0;
  assert.strictEqual(e.test_destroy_property_sheet_page(foreign), 0,
    'an unrelated heap allocation is not accepted as HPROPSHEETPAGE');

  const inline = e.guest_alloc(80) >>> 0;
  for (let i = 0; i < 2; i++) {
    const p = inline + i * 40;
    e.guest_write32(p, 40);
    e.guest_write32(p + 4, 0);
    e.guest_write32(p + 12, 200 + i);
    e.guest_write32(p + 24, 0x00402000 + i * 0x100);
  }
  e.test_psp_use_inline_array(inline, 2);
  assert.strictEqual(e.test_psp_resolve(0) >>> 0, inline,
    'PSH_PROPSHEETPAGE still resolves the inline first page');
  assert.strictEqual(e.test_psp_resolve(1) >>> 0, inline + 40,
    'inline page addressing uses the declared Win98 structure size');
  e.guest_write32(inline + 40, 44);
  assert.strictEqual(e.test_psp_resolve(1), 0,
    'a malformed inline array member is rejected');

  const inlineCallback = makeCallback(1);
  const inlineRef = e.guest_alloc(4) >>> 0;
  e.guest_write32(inlineRef, 3);
  const implicit = allocPage(48, 0x80 | 0x40);
  e.guest_write32(implicit + 32, inlineCallback.code);
  e.guest_write32(implicit + 36, inlineRef);
  e.test_psp_use_inline_array(implicit, 1);
  assert.strictEqual(e.test_psp_prepare_inline(), 1,
    'PropertySheet can initialize an implicit inline page');
  assert.strictEqual(e.guest_read32(inlineCallback.capture), 0,
    'implicit newer-sized pages receive PSPCB_ADDREF');
  assert.strictEqual(e.guest_read32(inlineCallback.capture + 4) >>> 0, implicit,
    'the inline callback receives the caller-owned page structure');
  assert.strictEqual(e.guest_read32(inlineRef), 4,
    'implicit creation increments PSP_USEREFPARENT');
  e.test_psp_release_pages();
  assert.strictEqual(e.guest_read32(inlineCallback.capture), 1,
    'sheet teardown sends PSPCB_RELEASE for an implicit unshown page');
  assert.strictEqual(e.guest_read32(inlineRef), 3,
    'implicit sheet teardown balances PSP_USEREFPARENT');

  // Property pages are modeless child dialogs. Win98 creates a normal page
  // lazily the first time it is selected, then retains and hides that same
  // HWND so its dialog/control state survives later selections.
  const dlgProc = e.guest_alloc(16) >>> 0;
  bytes.set([
    0xB8, 0x01, 0x00, 0x00, 0x00,       // mov eax,1
    0xC2, 0x10, 0x00,                   // ret 16
  ], e.guest_to_wasm(dlgProc) >>> 0);
  const retainedCallback = makeCallback(1);
  const retainedPages = e.guest_alloc(96) >>> 0;
  for (let i = 0; i < 2; i++) {
    const page = retainedPages + i * 48;
    for (let offset = 0; offset < 48; offset += 4) {
      e.guest_write32(page + offset, 0);
    }
    e.guest_write32(page, 48);
    e.guest_write32(page + 4, 0x80);    // PSP_USECALLBACK
    e.guest_write32(page + 12, 101 + i);
    e.guest_write32(page + 24, dlgProc);
    e.guest_write32(page + 32, retainedCallback.code);
  }
  e.test_psp_use_inline_array(retainedPages, 2);
  assert.strictEqual(e.test_psp_prepare_inline(), 1);
  assert.strictEqual(e.test_psp_page_hwnds_alloc(), 1,
    'sheet allocates one zeroed retained-HWND slot per page');
  assert.strictEqual(e.test_psp_page_hwnd_get(0), 0);
  assert.strictEqual(e.test_psp_page_hwnd_get(1), 0);
  assert.strictEqual(e.test_psp_page_hwnd_get(2), 0,
    'retained page lookup is bounded by nPages');

  const frame = 0x0001F000;
  const firstHwnd = e.test_psp_show_page(0, frame) >>> 0;
  assert(firstHwnd, 'first selection lazily creates the first page dialog');
  assert.strictEqual(e.test_psp_page_hwnd_get(0) >>> 0, firstHwnd,
    'the first page HWND is retained by its page index');
  assert(e.test_psp_window_style(firstHwnd) & 0x10000000,
    'the active page carries WS_VISIBLE');
  assert.strictEqual(e.guest_read32(retainedCallback.capture), 2,
    'first selection delivers PSPCB_CREATE');
  e.test_psp_dialog_extra_set(firstHwnd, 0x12345678);

  e.test_psp_hide_page();
  assert.strictEqual(e.test_psp_window_live(firstHwnd), 1,
    'deactivation hides but does not destroy the first page dialog');
  assert.strictEqual(e.test_psp_window_style(firstHwnd) & 0x10000000, 0,
    'an inactive retained page loses WS_VISIBLE');
  const secondHwnd = e.test_psp_show_page(1, frame) >>> 0;
  assert(secondHwnd && secondHwnd !== firstHwnd,
    'the second page is independently created on first selection');
  e.test_psp_hide_page();

  e.guest_write32(retainedCallback.capture, 0x7FFFFFFF);
  const revisitedHwnd = e.test_psp_show_page(0, frame) >>> 0;
  assert.strictEqual(revisitedHwnd, firstHwnd,
    'revisiting a page shows its original HWND');
  assert.strictEqual(e.guest_read32(retainedCallback.capture), 0x7FFFFFFF,
    'revisiting does not repeat PSPCB_CREATE');
  assert.strictEqual(e.test_psp_dialog_extra_get(firstHwnd) >>> 0, 0x12345678,
    'application-owned dialog state survives page switches');
  assert(e.test_psp_window_style(firstHwnd) & 0x10000000,
    'the revisited page regains WS_VISIBLE');
  e.test_psp_page_hwnds_release();
  e.test_psp_release_pages();

  const apiTable = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'src', 'api_table.json'), 'utf8'));
  const destroyApi = apiTable.find(api => api.name === 'DestroyPropertySheetPage');
  assert(destroyApi && destroyApi.nargs === 1,
    'DestroyPropertySheetPage is registered as a one-argument API');

  console.log('PASS  property-sheet pages honor Win98 copy, callback, ownership, and retained-dialog lifetimes');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
