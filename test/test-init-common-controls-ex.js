#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const CALLER_RETURN = 0x00408888;
const CONTINUATION = 0x00402000;
const ENTRY_SENTINEL = 0x00407777;

const extraWat = String.raw`
  (func (export "test_init_common_controls_ex") (param $init i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const ${CALLER_RETURN}))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4)) (local.get $init))
    (global.set $eip (i32.const ${ENTRY_SENTINEL}))
    (global.set $handler_set_eip (i32.const 0))
    (global.set $steps (i32.const 17))
    (global.set $font_enum_ret_thunk (i32.const ${CONTINUATION}))
    (call $handle_InitCommonControlsEx
      (local.get $init) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  ;; Model the authentic stdcall epilogue for a direct legacy-mask route.
  (func (export "test_finish_direct_common_controls") (param $result i32)
      (result i32)
    (i32.store offset=0 (global.get $reg_base) (local.get $result))
    (global.set $eip (call $gl32 (i32.load offset=16 (global.get $reg_base))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8)))
    (i32.load offset=0 (global.get $reg_base)))

  ;; Model authentic COMCTL32's RET 4, then enter the shared CACA0011 thunk.
  (func (export "test_finish_mixed_common_controls") (param $result i32)
      (result i32)
    (i32.store offset=0 (global.get $reg_base) (local.get $result))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8)))
    (i32.store (global.get $THUNK_BASE) (i32.const 0xCACA0011))
    (i32.store offset=4 (global.get $THUNK_BASE) (i32.const 0))
    (call $win32_dispatch (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_guest_common_controls_entry") (result i32)
    (call $guest_comctl32_init_common_controls_ex))
  (func (export "test_common_controls_name_matches") (param $base i32)
      (result i32)
    (call $dll_name_match
      (i32.add (local.get $base)
        (call $gl32 (i32.add (local.get $base) (i32.const 0x2c))))
      "COMCTL32.dll"))
  (func (export "test_resolve_common_controls_entry") (result i32)
    (call $resolve_name_export (i32.const 0) "InitCommonControlsEx"))
`;

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const init = wat.guest_alloc(8) >>> 0;

  const writeAscii = (address, text) => {
    Buffer.from(`${text}\0`, 'ascii').forEach((byte, index) =>
      wat.guest_write8(address + index, byte));
  };

  const call = flags => {
    wat.guest_write32(init, 8);
    wat.guest_write32(init + 4, flags);
    return wat.test_init_common_controls_ex(init);
  };

  assert.strictEqual(wat.test_init_common_controls_ex(0), 0,
    'a null INITCOMMONCONTROLSEX pointer fails');

  wat.guest_write32(init, 0);
  wat.guest_write32(init + 4, 0x000000ff); // ICC_WIN95_CLASSES
  assert.strictEqual(wat.test_init_common_controls_ex(init), 0,
    'a missing structure size fails');

  wat.guest_write32(init, 4);
  assert.strictEqual(wat.test_init_common_controls_ex(init), 0,
    'a truncated structure fails');

  wat.guest_write32(init, 12);
  assert.strictEqual(wat.test_init_common_controls_ex(init), 0,
    'an incompatible structure size fails');

  wat.guest_write32(init, 8);
  assert.strictEqual(wat.test_init_common_controls_ex(init), 1,
    'the documented two-DWORD structure succeeds');
  assert.strictEqual(wat.guest_read32(init), 8,
    'the input structure remains caller-owned');
  assert.strictEqual(wat.guest_read32(init + 4) >>> 0, 0x000000ff,
    'the requested class mask remains caller-owned');
  assert.strictEqual(wat.get_esp(), STACK + 8,
    'InitCommonControlsEx pops its one argument');

  // Seed one mapped image with a minimal truthful COMCTL32 export directory.
  // The returned function address is deliberately inert: these focused tests
  // inspect the redirect frame, then model the authentic stdcall RET 4.
  const image = wat.guest_alloc(0x200) >>> 0;
  const fakeEntry = image + 0x150;
  const table = wat.get_dll_table() >>> 0;
  const view = new DataView(memory.buffer);
  wat.guest_write32(image + 0x20 + 12, 0x60); // export-directory Name RVA
  wat.guest_write32(image + 0x20 + 24, 1);    // NumberOfNames
  writeAscii(image + 0x60, 'COMCTL32.dll');
  wat.guest_write32(image + 0x80, 0x150);     // AddressOfFunctions[0]
  wat.guest_write32(image + 0x90, 0xb0);      // AddressOfNames[0]
  wat.guest_write16(image + 0xa0, 0);         // AddressOfNameOrdinals[0]
  writeAscii(image + 0xb0, 'InitCommonControlsEx');
  view.setUint32(table, image, true);
  view.setUint32(table + 8, 0x20, true);
  view.setUint32(table + 12, 1, true);
  view.setUint32(table + 16, 1, true);
  view.setUint32(table + 20, 0x80, true);
  view.setUint32(table + 24, 0x90, true);
  view.setUint32(table + 28, 0xa0, true);
  wat.test_set_dll_count(1);
  assert.strictEqual(wat.get_dll_count(), 1,
    'the fake COMCTL32 row is within the live DLL table');
  assert.strictEqual(wat.test_common_controls_name_matches(image), 1,
    'the fake export-directory name identifies COMCTL32');
  assert.strictEqual(wat.test_resolve_common_controls_entry() >>> 0, fakeEntry,
    'the fake named export resolves through the normal loader helper');
  assert.strictEqual(wat.test_guest_common_controls_entry() >>> 0, fakeEntry,
    'the fake COMCTL32 export is discoverable through shared loader metadata');

  for (const flags of [0x200, 0x400, 0x404]) {
    assert.strictEqual(call(flags), 0,
      `legacy mask 0x${flags.toString(16)} defers its BOOL to COMCTL32`);
    assert.strictEqual(wat.get_eip() >>> 0, fakeEntry,
      `legacy mask 0x${flags.toString(16)} reaches authentic COMCTL32`);
    assert.strictEqual(wat.get_esp() >>> 0, STACK,
      'direct guest routing preserves the original stdcall frame');
    assert.strictEqual(wat.guest_read32(STACK) >>> 0, CALLER_RETURN);
    assert.strictEqual(wat.guest_read32(STACK + 4) >>> 0, init);
    assert.strictEqual(wat.guest_read32(init + 4) >>> 0, flags,
      'direct guest routing does not rewrite the caller mask');
    assert.strictEqual(wat.get_handler_set_eip(), 1,
      'direct guest routing suppresses thunk-zone auto-pop');
    assert.strictEqual(wat.get_steps(), 0,
      'direct guest routing stops the decoded caller block');
    assert.strictEqual(wat.test_finish_direct_common_controls(0x55aa), 0x55aa,
      'authentic BOOL survives direct routing');
    assert.strictEqual(wat.get_eip() >>> 0, CALLER_RETURN);
    assert.strictEqual(wat.get_esp() >>> 0, STACK + 8);
  }

  assert.strictEqual(call(0x8000), 1,
    'WAT supplies ICC_LINK_CLASS without asking Win98 COMCTL32');
  assert.strictEqual(wat.get_eip() >>> 0, ENTRY_SENTINEL,
    'a pure link request does not enter authentic COMCTL32');
  assert.strictEqual(wat.get_esp() >>> 0, STACK + 8);

  assert.strictEqual(call(0x8404), 0,
    'a mixed request defers its BOOL to the authentic legacy half');
  assert.strictEqual(wat.get_eip() >>> 0, fakeEntry);
  assert.strictEqual(wat.get_esp() >>> 0, STACK - 20);
  assert.strictEqual(wat.guest_read32(STACK - 20) >>> 0, CONTINUATION,
    'mixed route returns through CACA0011');
  const masked = wat.guest_read32(STACK - 16) >>> 0;
  assert.strictEqual(masked, STACK - 8,
    'mixed route passes its private INITCOMMONCONTROLSEX copy');
  assert.strictEqual(wat.guest_read32(STACK - 12) >>> 0, 0x54434349,
    'mixed route leaves the ICCT typed continuation marker');
  assert.strictEqual(wat.guest_read32(masked), 8);
  assert.strictEqual(wat.guest_read32(masked + 4) >>> 0, 0x404,
    'authentic COMCTL32 receives only its supported legacy flags');
  assert.strictEqual(wat.guest_read32(init + 4) >>> 0, 0x8404,
    'mixed routing leaves the caller-owned flags untouched');
  assert.strictEqual(wat.test_finish_mixed_common_controls(0), 0,
    'a failed authentic legacy half makes the combined request fail');
  assert.strictEqual(wat.get_eip() >>> 0, CALLER_RETURN);
  assert.strictEqual(wat.get_esp() >>> 0, STACK + 8,
    'mixed continuation completes the original stdcall frame');

  assert.strictEqual(call(0x8404), 0);
  assert.strictEqual(wat.test_finish_mixed_common_controls(1), 1,
    'a successful authentic legacy half preserves the WAT link success');
  assert.strictEqual(wat.get_eip() >>> 0, CALLER_RETURN);
  assert.strictEqual(wat.get_esp() >>> 0, STACK + 8);

  assert.strictEqual(call(0x10000), 0,
    'undocumented flags outside the ICC namespace fail');
  assert.strictEqual(wat.get_eip() >>> 0, ENTRY_SENTINEL,
    'unknown flags do not enter authentic COMCTL32');
  assert.strictEqual(wat.get_esp() >>> 0, STACK + 8);

  console.log('PASS InitCommonControlsEx routes authentic and WAT class masks truthfully');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
