#!/usr/bin/env node
'use strict';
// The software rasterizer clears the shader VM's temp register bank between
// pixel packets so an unwritten register reads zero. That bank is 128 registers
// of 64 bytes, and clearing all 8192 bytes for a shader that names one register
// costs 2KB per pixel -- about 630MB per 640x480 draw, and a measurable share
// of an untextured pixel (tools/bench-raster.js).
//
// $d3d_shader_vm_temp_span scans a compiled program once, when its context is
// created, and records how much of that bank the program can actually reach.
// This pins the three properties the rasterizer depends on: the span is the
// highest temp slot the program names (as a destination OR as a source, since a
// register read before it is written must still read zero), it never exceeds
// the bank, and it never reports less than one register.
//
// The floor is load-bearing rather than defensive: $d3d_software_output reads
// r0 out of this bank as the pixel result, so a malformed program that never
// writes r0 used to read the zero the full-bank fill left behind. Without the
// floor it would read the previous packet's value instead.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const manifest = fs.readFileSync(path.join(__dirname, '../src/main.watx'), 'utf8');
  const fragment = ['09af-d3d-shader-ir.wat', '09ag-d3d-shader-vm.wat'].map(file =>
    manifest.includes(file) ? '' : fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')).join('\n');
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none', extraWat: fragment + `
    (func (export "span_test_alloc") (param $n i32) (result i32)
      (call $g2w (call $heap_alloc (local.get $n))))
  ` });
  const u32 = new Uint32Array((memory || e.memory).buffer);

  // Bank 0 is the temp file r0..r127, bank 1 the input registers, bank 4 the
  // rasterizer outputs. Only bank 0 is what the fill covers.
  const dst = (bank, index = 0, mask = 15) => (0x80000000 | bank << 28 | index | mask << 16) >>> 0;
  const src = (bank, index = 0, swizzle = 0xe4) => (0x80000000 | bank << 28 | index | swizzle << 16) >>> 0;
  const END = 65535, MOV = 1, ADD = 2;

  const compile = tokens => {
    const p = e.span_test_alloc(tokens.length * 4);
    u32.set(tokens, p / 4);
    const normalized = e.d3d_shader_ir_compile(p, tokens.length);
    assert.ok(normalized, `IR error ${e.d3d_shader_ir_error()} at ${e.d3d_shader_ir_error_offset()}`);
    const program = e.d3d_shader_vm_compile(normalized);
    e.d3d_shader_ir_free(normalized); e.d3d_shader_vm_free(p);
    assert.ok(program, 'program compiles');
    return program;
  };
  const span = tokens => {
    const program = compile(tokens), ctx = e.d3d_shader_vm_context(program, 15);
    assert.ok(ctx, 'context allocates');
    const bytes = e.d3d_shader_vm_temp_bytes(ctx);
    e.d3d_shader_vm_free(ctx); e.d3d_shader_vm_free(program);
    return bytes;
  };

  let cases = 0;

  // The case the rasterizer actually runs most: one instruction, one register.
  // 64 bytes instead of 8192 is the whole point of the change.
  assert.strictEqual(span([0xffff0101, MOV, dst(0, 0), src(1), END]), 64,
    'ps_1_1 mov r0,v0 reaches exactly one temp register');
  cases++;

  // A destination further up the file extends the span to cover it, and the
  // registers below it too -- the span is a prefix length, not a set.
  assert.strictEqual(span([0xfffe0101, MOV, dst(0, 5), src(1), MOV, dst(4, 0), src(0, 5), END]), 6 * 64,
    'a write to r5 spans r0..r5');
  cases++;

  // A temp read before it is written cannot be built at all -- the IR rejects
  // it (error 17), which is worth pinning because it is the reason the span's
  // source scan is belt-and-braces rather than load-bearing: no legal program
  // can name a source temp above every destination temp. The scan still reads
  // sources, because over-counting only clears more and under-counting would
  // hand a packet the previous packet's register.
  {
    const tokens = [0xfffe0101, ADD, dst(0, 0), src(0, 3), src(1), MOV, dst(4, 0), src(0, 0), END];
    const p = e.span_test_alloc(tokens.length * 4);
    u32.set(tokens, p / 4);
    assert.strictEqual(e.d3d_shader_ir_compile(p, tokens.length), 0,
      'reading a temp before writing it is refused, not silently zeroed');
    e.d3d_shader_vm_free(p);
    cases++;
  }

  // So the reachable case is a temp that is written and then read back, and the
  // span has to cover it as a prefix either way.
  assert.strictEqual(span([0xfffe0101, MOV, dst(0, 3), src(1), ADD, dst(0, 0), src(0, 3), src(1),
    MOV, dst(4, 0), src(0, 0), END]), 4 * 64,
    'a temp written then read back is inside the span');
  cases++;

  // No temp anywhere falls back to the one-register floor rather than zero.
  assert.strictEqual(span([0xfffe0101, MOV, dst(4, 0), src(1), END]), 64,
    'a program naming no temp still clears r0');
  cases++;

  // Whatever a program does, the span is a span OF THE BANK: the rasterizer
  // passes it straight to memory.fill and must never be told to clear past it.
  for (const tokens of [
    [0xffff0101, MOV, dst(0, 0), src(1), END],
    [0xfffe0101, MOV, dst(0, 5), src(1), MOV, dst(4, 0), src(0, 5), END],
    [0xfffe0101, MOV, dst(4, 0), src(1), END],
  ]) {
    const bytes = span(tokens);
    assert.ok(bytes >= 64 && bytes <= 8192 && bytes % 64 === 0,
      `span ${bytes} is a whole number of registers inside the 8192-byte bank`);
    cases++;
  }

  // A pointer that is not a context cannot be trusted to hold a span, so the
  // accessor reports the whole bank. Clearing too much is slow; clearing too
  // little is a wrong picture, so the unsafe direction is the one to refuse.
  assert.strictEqual(e.d3d_shader_vm_temp_bytes(0), 8192, 'null context reports the whole bank');
  assert.strictEqual(e.d3d_shader_vm_temp_bytes(0xfffffff0), 8192, 'out-of-range context reports the whole bank');
  const notAContext = e.span_test_alloc(64);
  u32[notAContext / 4] = 0x11111111;
  assert.strictEqual(e.d3d_shader_vm_temp_bytes(notAContext), 8192, 'wrong magic reports the whole bank');
  cases += 3;

  console.log(`PASS shader VM temp span: ${cases} cases, reachable temp-bank bytes from real compiled ` +
    `programs, prefix semantics for reads and writes, one-register floor, bank bound, unsafe-input fallback`);
})().catch(error => { console.error(error); process.exit(1); });
