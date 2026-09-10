#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHostImports } = require('../lib/host-imports');
const RegionMap = require('../lib/region-map.generated');

const ROOT = path.join(__dirname, '..');
const wasmBytes = fs.readFileSync(path.join(ROOT, 'build/wine-assembly.wasm'));
const exeBytes = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));

function le32(v) {
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
}

async function run(fused) {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const h = createHostImports(ctx).host;
  Object.assign(h, { memory, exit() {}, log() {}, log_i32() {}, crash_unimplemented() {},
    wait_multiple: () => 0, shell_execute: () => 33 });
  const { instance } = await WebAssembly.instantiate(wasmBytes, { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const mem = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  mem.set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);
  const imageBase = e.get_image_base() >>> 0;
  const g2w = ga => RegionMap.g2w(ga >>> 0, imageBase);
  const code = imageBase + 0x1000;
  const a = imageBase + 0x8000;
  const b = imageBase + 0x8008;
  const c1 = imageBase + 0x8010;
  const c2 = imageBase + 0x8014;
  const c3 = imageBase + 0x8018;
  const c4 = imageBase + 0x801c;
  const out0 = imageBase + 0x8020;
  const out1 = imageBase + 0x8028;
  dv.setFloat64(g2w(a), 10, true);
  dv.setFloat64(g2w(b), 20, true);
  dv.setFloat32(g2w(c1), 2, true);
  dv.setFloat32(g2w(c2), 3, true);
  dv.setFloat32(g2w(c3), 4, true);
  dv.setFloat32(g2w(c4), 5, true);
  const bytes = [
    0xDD, 0x05, ...le32(a),             // fld qword [a]
    0xDD, 0x05, ...le32(b),             // fld qword [b]
    0xD9, 0xC0,                         // fld st(0)
    0xD8, 0x0D, ...le32(c1),            // fmul dword [c1]
    0xD9, 0xCA,                         // fxch st(2)
    0xDC, 0xC1,                         // fadd st(1),st
    0xD8, 0x0D, ...le32(c2),            // fmul dword [c2]
    0xD9, 0xC9,                         // fxch st(1)
    0xD8, 0x0D, ...le32(c3),            // fmul dword [c3]
    0xDC, 0xC1,                         // fadd st(1),st
    0xDE, 0xEA,                         // fsubp st(2),st
    0xD8, 0x05, ...le32(c4),            // fadd dword [c4]
    0xD9, 0xC9,                         // fxch st(1)
    0xD8, 0x05, ...le32(c4),            // fadd dword [c4]
    0xDD, 0x1D, ...le32(out0),          // fstp qword [out0]
    0xDD, 0x1D, ...le32(out1),          // fstp qword [out1]
    0xC3,
  ];
  mem.set(bytes, g2w(code));
  e.set_x87_island_fusion(fused ? 1 : 0);
  e.reset_handler_hist();
  e.set_handler_hist_enabled(1);
  const stack = imageBase + 0xD00000;
  e.set_esp(stack);
  dv.setUint32(g2w(stack), 0, true);
  e.set_eip(code);
  e.run(100000);
  e.set_handler_hist_enabled(0);
  const hist = new Uint32Array(memory.buffer, e.get_handler_hist_base(),
    e.get_handler_hist_slots());
  return { out0: dv.getFloat64(g2w(out0), true), out1: dv.getFloat64(g2w(out1), true),
    h188: hist[188] >>> 0, h189: hist[189] >>> 0,
    h447: hist[447] >>> 0, h448: hist[448] >>> 0 };
}

(async () => {
  const scalar = await run(false);
  const fused = await run(true);
  assert.deepStrictEqual([scalar.out0, scalar.out1], [-75, 155]);
  assert.deepStrictEqual([fused.out0, fused.out1], [scalar.out0, scalar.out1]);
  assert.strictEqual(fused.h447, 1);
  assert.strictEqual(fused.h448, 1);
  assert.strictEqual(scalar.h447 + scalar.h448, 0);
  assert.ok(fused.h188 + fused.h189 < scalar.h188 + scalar.h189,
    `expected fewer ordinary x87 handlers: scalar=${JSON.stringify(scalar)} fused=${JSON.stringify(fused)}`);
  console.log('x87 island fusion: PASS', JSON.stringify({ scalar, fused }));
})().catch(error => { console.error(error); process.exit(1); });
