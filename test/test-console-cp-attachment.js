#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_get_console_cp") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetConsoleCP
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_get_console_output_cp") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetConsoleOutputCP
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_set_console_cp_value") (param $cp i32)
    (global.set $console_cp (local.get $cp)))

  (func (export "test_set_console_output_cp_value") (param $cp i32)
    (global.set $console_output_cp (local.get $cp)))

  (func (export "test_set_pe_subsystem") (param $subsystem i32)
    (global.set $image_base (i32.const 0x00400000))
    (call $gs16 (i32.const 0x00400000) (i32.const 0x5A4D))
    (call $gs32 (i32.const 0x0040003C) (i32.const 0x80))
    (call $gs32 (i32.const 0x00400080) (i32.const 0x00004550))
    (call $gs16 (i32.const 0x004000DC) (local.get $subsystem))
    (i32.atomic.store (region.addr $CONSOLE_INPUT 0xC10) (i32.const 0)))

  (func (export "test_free_console") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_FreeConsole
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_alloc_console") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_AllocConsole
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  e.test_set_console_cp_value(850);
  e.test_set_console_output_cp_value(932);
  e.test_set_pe_subsystem(3); // IMAGE_SUBSYSTEM_WINDOWS_CUI
  assert.strictEqual(e.test_get_console_cp(), 850,
    'attached console did not expose its current input code page');
  assert.strictEqual(e.get_esp(), 0x00300004,
    'GetConsoleCP did not pop its zero-argument return address');
  assert.strictEqual(e.test_get_console_output_cp(), 932,
    'attached console did not expose its current output code page');
  assert.strictEqual(e.get_esp(), 0x00300004,
    'GetConsoleOutputCP did not pop its zero-argument return address');

  e.test_set_pe_subsystem(2); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  assert.strictEqual(e.test_get_console_cp(), 0,
    'GUI process without a console reported a usable console code page');
  assert.strictEqual(e.test_get_console_output_cp(), 0,
    'GUI process without a console reported a usable output code page');

  e.test_set_pe_subsystem(3);
  assert.strictEqual(e.test_free_console(), 1);
  assert.strictEqual(e.test_get_console_cp(), 0,
    'GetConsoleCP kept succeeding after FreeConsole detached the process');
  assert.strictEqual(e.test_get_console_output_cp(), 0,
    'GetConsoleOutputCP kept succeeding after FreeConsole detached the process');

  assert.strictEqual(e.test_alloc_console(), 1);
  assert.strictEqual(e.test_get_console_cp(), 850,
    'GetConsoleCP did not recover after AllocConsole attached a new console');
  assert.strictEqual(e.test_get_console_output_cp(), 932,
    'GetConsoleOutputCP did not recover after AllocConsole attached a new console');

  console.log('PASS  console code-page queries follow the process attachment lifecycle');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
