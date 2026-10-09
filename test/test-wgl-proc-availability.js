#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

async function main() {
  const { exports: e, memory } = await bootRenderHarness({ extraWat: `
    (func (export "lookup_gl_test") (param $name i32) (result i32)
      (local $esp i32) (local $answer i32)
      (local.set $esp (i32.load offset=16 (global.get $reg_base)))
      (call $handle_gpu_api (i32.const 50) (i32.const 1)
        (local.get $name) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))
      (local.set $answer (i32.load (global.get $reg_base)))
      (if (i32.ne (i32.load offset=16 (global.get $reg_base))
          (i32.add (local.get $esp) (i32.const 8))) (then (unreachable)))
      (i32.store offset=16 (global.get $reg_base) (local.get $esp))
      (local.get $answer))` });
  const toWasm = p => p - e.get_image_base() + e.get_guest_base();
  const table = require('../src/api_table.json');
  function lookup(name) {
    const bytes = Buffer.from(name + '\0');
    const p = e.guest_alloc(bytes.length);
    new Uint8Array(memory.buffer, toWasm(p), bytes.length).set(bytes);
    return e.lookup_gl_test(p) >>> 0;
  }
  for (const name of ['wglSwapIntervalEXT', 'glTexParameteriv',
    'GetTickCount', 'gluPerspective', 'glNotARealFunction', 'glactivetextureARB']) {
    assert.strictEqual(lookup(name), 0, `${name} must not be advertised`);
  }
  for (const name of ['glActiveTextureARB', 'glClientActiveTextureARB',
    'glMultiTexCoord2fARB', 'glTexParameterfv', 'glGetTexParameterfv',
    'wglSwapLayerBuffers', 'wglGetCurrentContext', 'wglGetCurrentDC']) {
    const thunk = lookup(name);
    assert.notStrictEqual(thunk, 0, `${name} remains available`);
    assert.strictEqual(new DataView(memory.buffer).getUint32(toWasm(thunk) + 4, true),
      table.findIndex(api => api.name === name), `${name} dispatches to its real API`);
  }
  assert.strictEqual(e.lookup_gl_test(0), 0);
  console.log('WGL procedure availability and thunk identities pass');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
