#!/usr/bin/env node
'use strict';

// Every D3D IM draw handler must return ESP to exactly where the guest's
// `call` left it plus its own arguments: entry + 4 (return address) + 4 per
// stdcall argument, `this` included.
//
// This is not bookkeeping. A handler that pops one dword too many leaves the
// caller's epilogue reading one slot high, so its `pop`s take the wrong saved
// registers and its `ret` takes the caller's own first argument as a return
// address. Diablo II's Direct3D backend does exactly that during the Act I
// load: d2direct3d calls IDirect3DDevice3::DrawIndexedPrimitiveVB (six dwords
// with `this`) through vtable slot 35, our handler popped seven, and the guest
// jumped to 0x140 or 0x280 -- 320 and 640, the first argument of the renderer
// function it was returning from. It read as a decoder trap in blank memory,
// several thousand blocks away from the call that caused it.
//
// The arities below are the DirectX signatures. The asymmetry in the last two
// rows is the whole point and is not a typo: IDirect3DDevice3's indexed VB
// draw takes (primType, lpVB, lpwIndices, dwIndexCount, dwFlags), while
// IDirect3DDevice7's inserts dwStartVertex and dwNumVertices before the
// indices. Same method name, same vtable role, two different stack sizes.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

// name -> stdcall dwords including `this`.
const CASES = [
  ['IDirect3DDevice3_DrawPrimitive', 6],
  ['IDirect3DDevice3_DrawIndexedPrimitive', 8],
  ['IDirect3DDevice3_DrawPrimitiveStrided', 6],
  ['IDirect3DDevice3_DrawIndexedPrimitiveStrided', 8],
  ['IDirect3DDevice3_DrawPrimitiveVB', 6],
  ['IDirect3DDevice3_DrawIndexedPrimitiveVB', 6],
  ['IDirect3DDevice7_DrawPrimitive', 6],
  ['IDirect3DDevice7_DrawIndexedPrimitive', 8],
  ['IDirect3DDevice7_DrawPrimitiveStrided', 6],
  ['IDirect3DDevice7_DrawIndexedPrimitiveStrided', 8],
  ['IDirect3DDevice7_DrawPrimitiveVB', 6],
  ['IDirect3DDevice7_DrawIndexedPrimitiveVB', 8],
];

// A scratch guest stack well clear of anything the harness uses. The handlers
// read their sixth and later arguments straight off it, so it has to be real
// mapped guest memory, not a made-up pointer.
const STACK = 0x00420000;
const STACK_BYTES = 64;

const exportName = n => 'test_dsa_' + n.replace('IDirect3DDevice', 'd').toLowerCase();

const extraWat = `
  (func (export "test_dsa_set_esp") (param $v i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $v)))
  (func (export "test_dsa_get_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
` + CASES.map(([name]) => `
  (func (export "${exportName(name)}")
    (call $handle_${name}
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0)))`).join('\n');

(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: wat } = h;

  const failures = [];
  for (const [name, nargs] of CASES) {
    // Zero the frame each time: a handler that reads a stale pointer from a
    // previous case would otherwise look fine here and crash in an app.
    for (let i = 0; i < STACK_BYTES; i += 4) wat.guest_write32(STACK + i, 0);

    wat.test_dsa_set_esp(STACK);
    wat[exportName(name)]();
    const delta = (wat.test_dsa_get_esp() >>> 0) - STACK;
    const want = 4 + nargs * 4;
    if (delta !== want) {
      failures.push(`${name}: popped ${delta}, expected ${want} `
        + `(${nargs} dwords incl. this)`);
    }
  }

  assert.deepStrictEqual(failures, [],
    'draw handlers must pop exactly their stdcall frame:\n  ' + failures.join('\n  '));

  // Negative control. If the arithmetic above could not tell a wrong pop from
  // a right one, every assertion in this file would pass against the build
  // that crashed Diablo II. 32 is precisely what the v3 indexed VB draw used
  // to pop, and 28 is what it pops now.
  assert.notStrictEqual(4 + 6 * 4, 32,
    'a 6-dword frame must not be 32 bytes, or this test proves nothing');
  assert.strictEqual(4 + 6 * 4, 28);

  console.log(`PASS test-d3dim-draw-stdcall-arity (${CASES.length} handlers)`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
