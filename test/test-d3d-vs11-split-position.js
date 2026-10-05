#!/usr/bin/env node
// A vs_1_1 shader may fill oPos across several instructions.
//
// The ordinary vs_1_1 transform is four dp4s against four rows of the clip
// matrix -- `dp4 oPos.x, r0, c10` / `.y, c11` / `.z, c12` / `.w, c13` -- which
// is what every HLSL compiler of that era emits and what Black & White 2's
// shaders do. $d3d_ir_scan required a single full xyzw write instead, so it
// refused those shaders at the FIRST dp4, and the game got NULL back from
// CreateVertexShader, bound nothing, and fell silently back to fixed-function
// vertex processing. Measured at B&W2's main menu before the fix: 30 shaders
// made, 107 refused, first refused vertex word 0xfffe0101 with error 16 at
// dword 519 -- which disassembled to exactly that first dp4.
//
// Completeness is still required, just at the end of the shader rather than
// per instruction, because an oPos.w nobody wrote makes the projection divide
// meaningless. So the cases below are symmetrical: every partition of xyzw
// across instructions is accepted, and every partition that leaves a component
// out is refused with the position error, at whatever granularity it is
// spelled.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const included = fs.readFileSync(path.join(__dirname, '../src/main.watx'), 'utf8')
    .includes('09af-d3d-shader-ir.wat');
  const extraWat = included ? ''
    : fs.readFileSync(path.join(__dirname, '../src/09af-d3d-shader-ir.wat'), 'utf8');
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none', extraWat });
  const guest = e.guest_alloc(65536 * 4) >>> 0;
  const ptr = e.guest_to_wasm(guest) >>> 0;
  const words = new Uint32Array(memory.buffer, ptr, 65536);

  const VS = 0xfffe0101;
  const POSITION_ERROR = 10;
  const dst = (bank, n = 0, mask = 15) => (0x80000000 | bank << 28 | n | mask << 16) >>> 0;
  const src = (bank, n = 0, swizzle = 0xe4) => (0x80000000 | bank << 28 | n | swizzle << 16) >>> 0;
  // bank 4 index 0 is oPos; bank 0 is r#, bank 1 v#, bank 2 c#.
  const dp4 = mask => [9, dst(4, 0, mask), src(0), src(2, 10)];
  const mov = mask => [1, dst(4, 0, mask), src(0)];
  const preamble = [VS, 1, dst(0), src(1)];       // mov r0, v0 -- something to transform
  const shader = (...instructions) => [...preamble, ...instructions.flat(), 65535];

  const compile = code => {
    words.fill(0, 0, code.length + 1);
    words.set(code);
    return e.d3d_shader_ir_compile(ptr, code.length) >>> 0;
  };
  const accepted = (what, code) => {
    const ir = compile(code);
    assert.ok(ir, `${what}: refused with error ${e.d3d_shader_ir_error()} ` +
      `at dword ${e.d3d_shader_ir_error_offset()}`);
    e.d3d_shader_ir_free(ir);
  };
  const refused = (what, code) => {
    assert.strictEqual(compile(code), 0, `${what}: must be refused`);
    assert.strictEqual(e.d3d_shader_ir_error(), POSITION_ERROR,
      `${what}: an incomplete oPos is the position error, not something else`);
  };

  // The shape B&W2 actually ships, and the one this test exists for.
  accepted('four single-component dp4s',
    shader(dp4(1), dp4(2), dp4(4), dp4(8)));
  // Every other way of partitioning the same four components.
  accepted('xyz then w', shader(dp4(7), dp4(8)));
  accepted('x then yzw', shader(dp4(1), dp4(14)));
  accepted('xy then zw', shader(dp4(3), dp4(12)));
  accepted('w first, then xyz', shader(dp4(8), dp4(7)));
  accepted('mixed opcodes', shader(dp4(7), mov(8)));
  // Overlapping writes are legal -- the union is what matters.
  accepted('overlapping masks', shader(dp4(15), dp4(3)));
  // And the single full write that always worked still does.
  accepted('one xyzw write', shader(dp4(15)));

  // Completeness is still enforced, however the gap is spelled.
  refused('no oPos at all', shader([1, dst(0, 1), src(0)]));
  refused('xyz only', shader(dp4(7)));
  refused('w missing across three writes', shader(dp4(1), dp4(2), dp4(4)));
  refused('x missing', shader(dp4(14)));
  refused('y missing', shader(dp4(1), dp4(12)));
  // A write to a DIFFERENT rasterizer output does not count towards oPos,
  // which is the mistake a union keyed on the bank alone would make. oFog is
  // bank 4 index 1 and is a single component, so it is written .x -- spelling
  // it .w would be refused for its own reasons and would prove nothing here.
  refused('oFog is not oPos', shader(dp4(7), [9, dst(4, 1, 1), src(0), src(2, 10)]));

  console.log('PASS test-d3d-vs11-split-position');
})().catch(error => { console.error(error); process.exit(1); });
