#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

(async () => {
  const wasm = process.env.WINE_ASSEMBLY_WASM
    ? fs.readFileSync(process.env.WINE_ASSEMBLY_WASM) : compileSrcWasm();
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const { host } = createHostImports(ctx);
  Object.assign(host, { memory, log() {}, log_i32() {}, exit() {} });
  const { instance } = await WebAssembly.instantiate(wasm, { host });
  const e = ctx.exports = instance.exports;
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  e.load_pe(exe.length);
  const base = e.get_image_base();
  // Each case assembles at base+0x1000+count*256, so the operand scratch has to
  // sit past where the last case can reach -- at the original base+0x9000 the
  // 128th case wrote its own code over the inputs and the failure looked like a
  // wrong answer from the instruction under test.
  const a = base + 0x80000, b = a + 32, out = b + 32;
  const le32 = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
  const bits = value => {
    const buf = Buffer.alloc(4); buf.writeFloatLE(value); return buf.readUInt32LE();
  };
  const upper = [0x7fc12345, 0x80000000, 0xdeadbeef];
  let count = 0;
  for(const memorySource of [false,true])for(const [value,expected] of [
    [0,0],[-0,0],[1.5,2],[2.5,2],[-1.5,-2],[-2.5,-2],[3.9,4],
    [2147483520,2147483520],[2147483648,0x80000000],[-2147483648,0x80000000],
    [NaN,0x80000000],[Infinity,0x80000000]]) {
    [bits(value),...upper].forEach((v,i)=>e.guest_write32(b+i*4,v));
    const code=[0x0f,0x10,0x0d,...le32(b),0xf3,0x0f,0x2d,
      ...(memorySource?[0x05,...le32(b)]:[0xc1]),0xa3,...le32(out+16),
      0x0f,0x11,0x0d,...le32(out),0xc3];
    const pc=base+0x1000+count++*256,sp=base+0xd00000;
    code.forEach((v,i)=>e.guest_write8(pc+i,v));
    e.guest_write32(sp,0);e.set_esp(sp);e.set_eip(pc);e.run(10000);
    assert.strictEqual(e.get_eip(),0);assert.strictEqual(e.get_esp()>>>0,sp+4);
    assert.strictEqual(e.guest_read32(out+16)>>>0,expected>>>0,`CVTSS2SI ${value}, memory=${memorySource}`);
    assert.deepStrictEqual(Array.from({length:4},(_,i)=>e.guest_read32(out+i*4)>>>0),
      [bits(value),...upper],'conversion preserves source XMM');
  }
  for(const memorySource of [false,true])for(const value of [0,32,-1,-2147483648,2147483647,16777217,-16777217,16777219]) {
    [bits(7),...upper].forEach((v,i)=>e.guest_write32(a+i*4,v));
    e.guest_write32(b,value);
    const code=[0x0f,0x10,0x05,...le32(a),0xb8,...le32(value),
      0xf3,0x0f,0x2a,...(memorySource?[0x05,...le32(b)]:[0xc0]),
      0x0f,0x11,0x05,...le32(out),0xc3];
    const pc=base+0x1000+count++*256,sp=base+0xd00000;
    code.forEach((v,i)=>e.guest_write8(pc+i,v));
    e.guest_write32(sp,0);e.set_esp(sp);e.set_eip(pc);e.run(10000);
    assert.strictEqual(e.get_eip(),0,'CVTSI2SS returns');
    assert.strictEqual(e.get_esp()>>>0,sp+4);
    assert.deepStrictEqual(Array.from({length:4},(_,i)=>e.guest_read32(out+i*4)>>>0),
      [bits(Math.fround(value)),...upper],`CVTSI2SS signed ${value}, memory=${memorySource}`);
  }
  for (const [opcode, label, operation] of [
    [0x58, 'ADDSS', (x, y) => Math.fround(x + y)],
    [0x59, 'MULSS', (x, y) => Math.fround(x * y)],
    [0x5c, 'SUBSS', (x, y) => Math.fround(x - y)],
    [0x5e, 'DIVSS', (x, y) => Math.fround(x / y)],
  ]) {
    for (const memorySource of [false, true]) {
      for (const values of [[1.5, -2], [-0, 3], [16777216, 1], [1e20, 1e20]]) {
        const [x, y] = values.map(Math.fround);
        [bits(x), ...upper].forEach((v, i) => e.guest_write32(a + i * 4, v));
        [bits(y), 0x7fcabcde, 0, 0xffffffff].forEach((v, i) => e.guest_write32(b + i * 4, v));
        const code = [
          0x0f, 0x10, 0x05, ...le32(a),
          0x0f, 0x10, 0x0d, ...le32(b),
          0xf3, 0x0f, opcode, ...(memorySource ? [0x05, ...le32(b)] : [0xc1]),
          0x0f, 0x11, 0x05, ...le32(out), 0xc3,
        ];
        const pc = base + 0x1000 + count++ * 256;
        code.forEach((v, i) => e.guest_write8(pc + i, v));
        const sp = base + 0xd00000;
        e.guest_write32(sp, 0); e.set_esp(sp); e.set_eip(pc); e.run(10000);
        assert.strictEqual(e.get_eip(), 0, `${label} returns`);
        assert.strictEqual(e.get_esp() >>> 0, sp + 4, `${label} does not alter stack`);
        assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => e.guest_read32(out + i * 4) >>> 0),
          [bits(operation(x, y)), ...upper], `${label} ${memorySource ? 'memory' : 'register'} ${x},${y}`);
      }
    }
  }
  for (const [opcode, memorySource] of [[0x2e, false], [0x2e, true], [0x2f, false], [0x2f, true]]) {
    for (const [x, y, flags] of [[1, 2, 1], [2, 1, 0], [1, 1, 0x40],
      [-0, 0, 0x40], [NaN, 1, 0x45], [1, NaN, 0x45], [Infinity, Infinity, 0x40]]) {
      const input = [bits(x), ...upper];
      input.forEach((v, i) => e.guest_write32(a + i * 4, v));
      [bits(y), ...upper].forEach((v, i) => e.guest_write32(b + i * 4, v));
      const code = [
        0x0f, 0x10, 0x05, ...le32(a),
        0x0f, 0x10, 0x0d, ...le32(b),
        0x68, ...le32(0x8d7), 0x9d, // seed all six arithmetic flags
        0x0f, opcode, ...(memorySource ? [0x05, ...le32(b)] : [0xc1]),
        0x9c, 0x58, 0xa3, ...le32(out + 16), // capture EFLAGS
        0x0f, 0x11, 0x05, ...le32(out), 0xc3,
      ];
      const pc = base + 0x1000 + count++ * 256, sp = base + 0xd00000;
      code.forEach((v, i) => e.guest_write8(pc + i, v));
      e.guest_write32(sp, 0); e.set_esp(sp); e.set_eip(pc); e.run(10000);
      assert.strictEqual(e.get_eip(), 0, 'UCOMISS returns');
      assert.strictEqual(e.guest_read32(out + 16) & 0x8d5, flags,
        `UCOMISS ${memorySource ? 'memory' : 'register'} ${x},${y} flags`);
      assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => e.guest_read32(out + i * 4) >>> 0),
        input, 'UCOMISS does not modify either operand');
    }
  }
  for (const [opcode, label, operation] of [
    [0x5c, 'SUBPS', (x, y) => Math.fround(x - y)],
    [0x5e, 'DIVPS', (x, y) => Math.fround(x / y)],
  ]) {
    for (const memorySource of [false, true]) {
      const av = [1.5, -4, 9, -0], bv = [2, 2, -3, 1];
      av.forEach((v, i) => e.guest_write32(a + i * 4, bits(v)));
      bv.forEach((v, i) => e.guest_write32(b + i * 4, bits(v)));
      const code = [
        0x0f, 0x10, 0x05, ...le32(a), 0x0f, 0x10, 0x0d, ...le32(b),
        0x0f, opcode, ...(memorySource ? [0x05, ...le32(b)] : [0xc1]),
        0x0f, 0x11, 0x05, ...le32(out), 0xc3,
      ];
      const pc = base + 0x1000 + count++ * 256, sp = base + 0xd00000;
      code.forEach((v, i) => e.guest_write8(pc + i, v));
      e.guest_write32(sp, 0); e.set_esp(sp); e.set_eip(pc); e.run(10000);
      assert.strictEqual(e.get_eip(), 0);
      assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => e.guest_read32(out + i * 4) >>> 0),
        av.map((v, i) => bits(operation(v, bv[i]))), `${label} all four lanes`);
    }
  }
  // The SSE1 packed group added for Black & White 2's vertex normalizer. The
  // bitwise forms are checked on raw bit patterns rather than floats, because
  // that is what the guest actually uses them for -- ANDPS with a 0x7fffffff
  // mask is how an abs() is spelled in this kind of code.
  for (const [opcode, label, operation] of [
    [0x54, 'ANDPS', (x, y) => (x & y) >>> 0],
    [0x55, 'ANDNPS', (x, y) => (~x & y) >>> 0],
    [0x56, 'ORPS', (x, y) => (x | y) >>> 0],
  ]) {
    for (const memorySource of [false, true]) {
      const av = [0x7fffffff, 0x80000000, 0xdeadbeef, 0];
      const bv = [0xc0490fdb, 0xffffffff, 0x0f0f0f0f, 0x12345678];
      av.forEach((v, i) => e.guest_write32(a + i * 4, v));
      bv.forEach((v, i) => e.guest_write32(b + i * 4, v));
      const code = [
        0x0f, 0x10, 0x05, ...le32(a), 0x0f, 0x10, 0x0d, ...le32(b),
        0x0f, opcode, ...(memorySource ? [0x05, ...le32(b)] : [0xc1]),
        0x0f, 0x11, 0x05, ...le32(out), 0xc3,
      ];
      const pc = base + 0x1000 + count++ * 256, sp = base + 0xd00000;
      code.forEach((v, i) => e.guest_write8(pc + i, v));
      e.guest_write32(sp, 0); e.set_esp(sp); e.set_eip(pc); e.run(10000);
      assert.strictEqual(e.get_eip(), 0);
      assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => e.guest_read32(out + i * 4) >>> 0),
        av.map((v, i) => operation(v, bv[i])), `${label} all four lanes`);
    }
  }
  // MINPS/MAXPS return the source operand whenever the pair is unordered or
  // equal, so the NaN lane and the +0/-0 lane are the whole point of this case
  // -- wasm's f32x4.min/max would return the other one.
  for (const [opcode, label, operation] of [
    [0x5d, 'MINPS', (x, y) => (x < y ? x : y)],
    [0x5f, 'MAXPS', (x, y) => (x > y ? x : y)],
  ]) {
    for (const memorySource of [false, true]) {
      const av = [1.5, -4, NaN, 0], bv = [2, 2, 7, -0];
      av.forEach((v, i) => e.guest_write32(a + i * 4, bits(v)));
      bv.forEach((v, i) => e.guest_write32(b + i * 4, bits(v)));
      const code = [
        0x0f, 0x10, 0x05, ...le32(a), 0x0f, 0x10, 0x0d, ...le32(b),
        0x0f, opcode, ...(memorySource ? [0x05, ...le32(b)] : [0xc1]),
        0x0f, 0x11, 0x05, ...le32(out), 0xc3,
      ];
      const pc = base + 0x1000 + count++ * 256, sp = base + 0xd00000;
      code.forEach((v, i) => e.guest_write8(pc + i, v));
      e.guest_write32(sp, 0); e.set_esp(sp); e.set_eip(pc); e.run(10000);
      assert.strictEqual(e.get_eip(), 0);
      assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => e.guest_read32(out + i * 4) >>> 0),
        av.map((v, i) => bits(operation(v, bv[i]))), `${label} all four lanes`);
    }
  }
  // SQRTPS/RSQRTPS/RCPPS ignore the destination entirely. The reciprocal pair
  // is a ~12-bit approximation on real silicon and exact here, so the expected
  // values are the exactly-rounded single-precision results.
  for (const [opcode, label, operation] of [
    [0x51, 'SQRTPS', x => Math.fround(Math.sqrt(x))],
    [0x52, 'RSQRTPS', x => Math.fround(1 / Math.fround(Math.sqrt(x)))],
    [0x53, 'RCPPS', x => Math.fround(1 / x)],
  ]) {
    for (const memorySource of [false, true]) {
      const av = [1.5, -4, 9, 0], bv = [4, 0.25, 100, 2];
      av.forEach((v, i) => e.guest_write32(a + i * 4, bits(v)));
      bv.forEach((v, i) => e.guest_write32(b + i * 4, bits(v)));
      const code = [
        0x0f, 0x10, 0x05, ...le32(a), 0x0f, 0x10, 0x0d, ...le32(b),
        0x0f, opcode, ...(memorySource ? [0x05, ...le32(b)] : [0xc1]),
        0x0f, 0x11, 0x05, ...le32(out), 0xc3,
      ];
      const pc = base + 0x1000 + count++ * 256, sp = base + 0xd00000;
      code.forEach((v, i) => e.guest_write8(pc + i, v));
      e.guest_write32(sp, 0); e.set_esp(sp); e.set_eip(pc); e.run(10000);
      assert.strictEqual(e.get_eip(), 0);
      assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => e.guest_read32(out + i * 4) >>> 0),
        bv.map(v => bits(operation(Math.fround(v)))), `${label} all four lanes`);
    }
  }
  // The F3-prefixed scalar twins touch lane 0 only.
  for (const [opcode, label, operation] of [
    [0x51, 'SQRTSS', x => Math.fround(Math.sqrt(x))],
    [0x52, 'RSQRTSS', x => Math.fround(1 / Math.fround(Math.sqrt(x)))],
    [0x53, 'RCPSS', x => Math.fround(1 / x)],
  ]) {
    for (const memorySource of [false, true]) {
      for (const value of [4, 0.25, 100, 2]) {
        [bits(7), ...upper].forEach((v, i) => e.guest_write32(a + i * 4, v));
        [bits(value), 0x7fcabcde, 0, 0xffffffff].forEach((v, i) => e.guest_write32(b + i * 4, v));
        const code = [
          0x0f, 0x10, 0x05, ...le32(a), 0x0f, 0x10, 0x0d, ...le32(b),
          0xf3, 0x0f, opcode, ...(memorySource ? [0x05, ...le32(b)] : [0xc1]),
          0x0f, 0x11, 0x05, ...le32(out), 0xc3,
        ];
        const pc = base + 0x1000 + count++ * 256, sp = base + 0xd00000;
        code.forEach((v, i) => e.guest_write8(pc + i, v));
        e.guest_write32(sp, 0); e.set_esp(sp); e.set_eip(pc); e.run(10000);
        assert.strictEqual(e.get_eip(), 0);
        assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => e.guest_read32(out + i * 4) >>> 0),
          [bits(operation(Math.fround(value))), ...upper],
          `${label} ${value}, memory=${memorySource}`);
      }
    }
  }
  console.log(`PASS ${count} scalar SSE arithmetic/comparison cases`);
})().catch(error => { console.error(error); process.exitCode = 1; });
