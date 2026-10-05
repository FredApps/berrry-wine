#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const extraWat = String.raw`
  (func (export "test_output_debug_string_a") (param $text i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x12345678))
    (call $handle_OutputDebugStringA
      (local.get $text) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0)))
`;

(async () => {
  const messages = [];
  let memory;
  const { exports: e, memory: wasmMemory } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      log: (ptr, length) => {
        const bytes = new Uint8Array(memory.buffer, ptr >>> 0, length >>> 0);
        messages.push(Buffer.from(bytes).toString('latin1'));
      },
    },
  });
  memory = wasmMemory;

  const text = '7-Zip diagnostic: archive opened';
  const ptr = e.guest_alloc(text.length + 1) >>> 0;
  for (let i = 0; i < text.length; i++) e.guest_write8(ptr + i, text.charCodeAt(i));
  e.guest_write8(ptr + text.length, 0);

  e.test_output_debug_string_a(ptr);
  assert.deepStrictEqual(messages, [text],
    'the browser/CLI debugger sink receives the exact bounded ANSI payload');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
    'OutputDebugStringA pops its return address and one stdcall argument');

  e.test_output_debug_string_a(0);
  e.test_output_debug_string_a(0x90000000);
  assert.deepStrictEqual(messages, [text],
    'optional NULL and inaccessible diagnostics do not fabricate output');

  console.log('PASS OutputDebugStringA reaches the debugger log sink safely');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
