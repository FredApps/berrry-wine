'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (export "compile20" (func $d3d_shader_ir_compile20))
    (func (export "ir20_live_bytes") (result i32) (global.get $d3d_ir_live_bytes))
    (func (export "alloc20") (param i32) (result i32)
      (call $g2w (call $heap_alloc (local.get 0))))
  ` });
  const u = new Uint32Array(memory.buffer), f = new Float32Array(memory.buffer), b = new Uint8Array(memory.buffer);
  const operand = (bank, index, selector = 0xe4, modifier = 0) => [bank, index, selector, modifier];
  const ins = (op, ...operands) => ({ op, operands });
  const dst = (index, mask = 15) => operand(0, index, mask);
  const constant = (index, relative = false) => operand(2, index, 0xe4, relative ? 256 : 0);
  const source = index => operand(0, index);
  const addr = operand(3, 0, 1);
  let cases = 0;
  function ir(instructions, version = 0xfffe0200) {
    const bytes = 32 + instructions.length * 128, p = e.alloc20(bytes);
    assert(p); u.fill(0, p / 4, (p + bytes) / 4);
    u.set([0x44534952, 1, 0, version, instructions.length, 0, bytes, 1], p / 4);
    instructions.forEach((item, i) => {
      const q = (p + 32 + i * 128) / 4;
      u.set([item.op, i, item.operands.length, 0], q);
      item.operands.forEach((value, j) => u.set(value, q + 4 + j * 4));
    });
    return p;
  }
  function compile(instructions, legacy = false) {
    const p = ir(instructions, legacy ? 0xfffe0101 : 0xfffe0200);
    if (!legacy) assert.strictEqual(e.d3d_shader_vm_compile(p), 0, 'public VM compiler still rejects VS2');
    const program = (legacy ? e.d3d_shader_vm_compile(p) : e.d3d_shader_vm_compile_vs20(p)) >>> 0;
    e.d3d_shader_vm_free(p); assert(program); return program;
  }
  function register(ctx, bank, index) {
    const offset = bank === 2 && index >= 128 ? 65568 + (index - 128) * 64 : 32 + (bank * 128 + index) * 64;
    return (ctx + offset) / 4;
  }
  const x = (ctx, bank, index) => Array.from(f.slice(register(ctx, bank, index), register(ctx, bank, index) + 4));
  function seedConstants(ctx) {
    for (let c = 0; c < 256; c++) for (let component = 0; component < 4; component++)
      f.fill(c + component / 4, register(ctx, 2, c) + component * 4, register(ctx, 2, c) + component * 4 + 4);
  }
  function release(...pointers) { pointers.forEach(p => e.d3d_shader_vm_free(p)); }
  assert.strictEqual(e.d3d_shader_vm_context_bytes(), 73760);
  {
    const program = compile([ins(46, addr, source(0)), ins(1, dst(1), constant(128, true)),
      ins(1, dst(2), constant(255)), ins(1, dst(3), constant(127)), ins(1, dst(4), constant(128)),
      ins(35, dst(5), source(0))]);
    const ctx = e.d3d_shader_vm_context(program, 15); assert(ctx); seedConstants(ctx);
    f.set([.5, 1.5, 2.5, -1.5], register(ctx, 0, 0));
    b.fill(0x5a, ctx + 62848, ctx + 65568);
    assert.strictEqual(e.d3d_shader_vm_run(ctx, 1), 1, 'budget stops after MOVA');
    assert.deepStrictEqual(x(ctx, 3, 0), [0, 2, 2, -2], 'nearest-even tie policy');
    assert.strictEqual(e.d3d_shader_vm_run(ctx, 20), 0);
    assert.deepStrictEqual(x(ctx, 0, 1), [128, 130, 130, 126], 'relative gather spans appended and legacy constants');
    assert.deepStrictEqual(x(ctx, 0, 2), [255, 255, 255, 255]);
    assert.deepStrictEqual(x(ctx, 0, 3), [127, 127, 127, 127]);
    assert.deepStrictEqual(x(ctx, 0, 4), [128, 128, 128, 128]);
    assert.deepStrictEqual(x(ctx, 0, 5), [.5, 1.5, 2.5, 1.5], 'ABS foundation');
    assert(b.subarray(ctx + 62848, ctx + 65568).every(v => v === 0x5a), 'stage4/5 sampler records unchanged');
    release(ctx, program); cases++;
  }
  for (const addresses of [[-1, 255, 256, 1000000], [NaN, Infinity, -Infinity, 0]]) {
    const program = compile([ins(46, addr, source(0)), ins(1, dst(1), constant(0, true))]);
    const ctx = e.d3d_shader_vm_context(program, 15); seedConstants(ctx);
    f.set(addresses, register(ctx, 0, 0));
    assert.strictEqual(e.d3d_shader_vm_run(ctx, 8), 0);
    assert.deepStrictEqual(x(ctx, 0, 1), addresses[0] === -1 ? [0, 255, 0, 0] : [0, 0, 0, 0], 'bounded nonfinite/overflow gather');
    release(ctx, program); cases++;
  }
  {
    const program = compile([ins(46, addr, source(0)), ins(1, dst(1), constant(128, true))]);
    const ctx = e.d3d_shader_vm_context(program, 5); seedConstants(ctx);
    f.set([1.6, 1.6, -1.6, -1.6], register(ctx, 0, 0));
    f.fill(99, register(ctx, 3, 0), register(ctx, 3, 0) + 4);
    f.fill(77, register(ctx, 0, 1), register(ctx, 0, 1) + 4);
    assert.strictEqual(e.d3d_shader_vm_run(ctx, 8), 0);
    assert.deepStrictEqual(x(ctx, 3, 0), [2, 99, -2, 99]);
    assert.deepStrictEqual(x(ctx, 0, 1), [130, 77, 126, 77], 'inactive lanes retained');
    release(ctx, program); cases++;
  }
  {
    const word = value => { const v = new DataView(new ArrayBuffer(4)); v.setFloat32(0, value, true); return v.getUint32(0, true); };
    const program = compile([ins(1, dst(0), constant(255)),
      ins(81, operand(2, 255, 15), ...[9, 8, 7, 6].map(v => operand(255, word(v), 0)))]);
    const ctx = e.d3d_shader_vm_context(program, 15); seedConstants(ctx);
    assert.strictEqual(e.d3d_shader_vm_run(ctx, 8), 0);
    assert.deepStrictEqual(Array.from(f.slice(register(ctx, 0, 0), register(ctx, 0, 0) + 16)), [9, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7, 6, 6, 6, 6], 'high DEF hoisted and mapped');
    release(ctx, program); cases++;
  }
  {
    const program = compile([ins(1, addr, source(0)), ins(1, dst(1), constant(95, true))], true);
    const ctx = e.d3d_shader_vm_context(program, 15); seedConstants(ctx);
    f.set([1.6, -.1, .9, -1.6], register(ctx, 0, 0));
    assert.strictEqual(e.d3d_shader_vm_run(ctx, 8), 0);
    assert.deepStrictEqual(x(ctx, 3, 0), [1, -1, 0, -2], 'legacy MOV-a0 still floors');
    assert.deepStrictEqual(x(ctx, 0, 1), [0, 94, 95, 93], 'legacy relative limit remains96');
    release(ctx, program); cases++;
  }
  for (const bad of [ins(46, dst(0), source(0)), ins(46, operand(3, 0, 2), source(0)),
    ins(1, addr, source(0)), ins(1, dst(0), constant(256)), ins(1, dst(0), operand(3, 0)),
    ins(1, dst(0), operand(0, 0, 0xe4, 256)), ins(1, dst(0), operand(2, 0, 0xe4, 512)),
    ins(20, dst(0), source(0), constant(0)), ins(35, dst(0), operand(0, 0, 0xe4, 2)),
    ins(1, operand(4, 1, 15), source(0)), ins(46, operand(3, 0, 1, 1), source(0))]) {
    const p = ir([bad]); assert.strictEqual(e.d3d_shader_vm_compile_vs20(p), 0, 'private unsupported/malformed IR rejected');
    release(p); cases++;
  }
  for (const [word, value] of [[2, 1], [3, 0xfffe0101], [7, 2], [7, 4]]) {
    const p = ir([ins(1, dst(0), constant(0))]); u[p / 4 + word] = value;
    assert.strictEqual(e.d3d_shader_vm_compile_vs20(p), 0, 'private header profile/flags checked');
    release(p); cases++;
  }
  {
    // Real private decoder -> packet compiler -> SIMD execution; public decoder remains closed.
    const tokens = [0xfffe0200, 0x0200001f, 0x80000000, 0x900f0000,
      0x0200002e, 0xb0010000, 0x90000000,
      0x03000001, 0xc00f0000, 0xa0e42080, 0xb0000000, 0xffff];
    const baseline = e.ir20_live_bytes();
    const p = e.alloc20(tokens.length * 4); u.set(tokens, p / 4);
    const nativeIR = e.compile20(p, tokens.length); assert(nativeIR, 'private decoder accepts test');
    const program = e.d3d_shader_vm_compile_vs20(nativeIR); assert(program, 'native IR matches VM contract');
    const ctx = e.d3d_shader_vm_context(program, 15); seedConstants(ctx);
    f.set([0, 1, 2, -1], register(ctx, 1, 0));
    assert.strictEqual(e.d3d_shader_vm_run(ctx, 8), 0);
    assert.deepStrictEqual(x(ctx, 4, 0), [128, 129, 130, 127]);
    release(ctx, program, p);
    e.d3d_shader_ir_free(nativeIR);
    assert.strictEqual(e.ir20_live_bytes(), baseline, 'decoder-owned IR lifetime returns to baseline');
    cases++;
  }
  console.log(`Private VS2 VM PASS ${cases} cases; public admission unchanged`);
})().catch(error => { console.error(error); process.exitCode = 1; });
