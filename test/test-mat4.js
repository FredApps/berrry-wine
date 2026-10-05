#!/usr/bin/env node
// Known-answer check for $mat4_mul / $mat4_transform_vec4 (Step 2 of D3DIM plan).
// Doesn't boot a PE — just instantiates WASM and uses scratch memory.
const fs = require('fs');

const wasmBytes = fs.readFileSync('build/wine-assembly.wasm');
const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
const hostProxy = new Proxy({ memory }, { get: (t, k) => k in t ? t[k] : (() => 0) });
const imports = { host: hostProxy };

(async () => {
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const e = instance.exports;
  const mem = new DataView(memory.buffer);
  const f32 = (off, v) => mem.setFloat32(off, v, true);
  const rf32 = (off) => mem.getFloat32(off, true);

  // Use scratch region inside guest area (well above PE staging) — 0x100 bytes at 0x05000000.
  const A = 0x05000000, B = 0x05000040, OUT = 0x05000080, V = 0x050000C0, VOUT = 0x050000D0;

  // Identity test: I * I = I
  e.test_mat4_identity(A);
  e.test_mat4_identity(B);
  e.test_mat4_mul(OUT, A, B);
  let ok = true;
  for (let i = 0; i < 16; i++) {
    const want = (i % 5 === 0) ? 1 : 0;
    if (Math.abs(rf32(OUT + i*4) - want) > 1e-6) { console.log('I*I FAIL @' + i + ': ' + rf32(OUT + i*4)); ok = false; }
  }

  // Translation matrix (row-major D3D, translation in row 3): T * v with v=(1,2,3,1)
  // T = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[10,20,30,1]]
  for (let i = 0; i < 16; i++) f32(A + i*4, 0);
  f32(A + 0,  1); f32(A + 20, 1); f32(A + 40, 1); f32(A + 60, 1);
  f32(A + 48, 10); f32(A + 52, 20); f32(A + 56, 30);
  f32(V + 0, 1); f32(V + 4, 2); f32(V + 8, 3); f32(V + 12, 1);
  e.test_mat4_xform(VOUT, A, V);
  // Expected: (1+10, 2+20, 3+30, 1) = (11, 22, 33, 1)
  const expect = [11, 22, 33, 1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(rf32(VOUT + i*4) - expect[i]) > 1e-5) { console.log('T*v FAIL @' + i + ': ' + rf32(VOUT + i*4) + ' want ' + expect[i]); ok = false; }
  }

  // Compose: scale(2) * translate(10,0,0); apply to (1,2,3,1) → (1*2+10, 2*2, 3*2, 1) = (12, 4, 6, 1)
  for (let i = 0; i < 16; i++) { f32(A + i*4, 0); f32(B + i*4, 0); }
  f32(A + 0, 2); f32(A + 20, 2); f32(A + 40, 2); f32(A + 60, 1);
  f32(B + 0, 1); f32(B + 20, 1); f32(B + 40, 1); f32(B + 60, 1);
  f32(B + 48, 10);
  e.test_mat4_mul(OUT, A, B);
  e.test_mat4_xform(VOUT, OUT, V);
  const expect2 = [12, 4, 6, 1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(rf32(VOUT + i*4) - expect2[i]) > 1e-5) { console.log('S*T*v FAIL @' + i + ': ' + rf32(VOUT + i*4) + ' want ' + expect2[i]); ok = false; }
  }

  // Aliased output: D3DOP_MATRIXMULTIPLY names handles, so dest may be a
  // source. DX SDK Twist accumulates dest = dest * step every frame; a
  // store-while-reading multiply collapsed that rotation to a sliver.
  const fill = (base, seed) => { for (let i = 0; i < 16; i++) f32(base + i*4, Math.sin(seed + i * 1.7) * 3); };
  const snap = (base) => Array.from({ length: 16 }, (_, i) => rf32(base + i*4));
  for (const alias of ['a', 'b', 'both']) {
    fill(A, 1); fill(B, alias === 'both' ? 1 : 2);
    e.test_mat4_mul(OUT, A, alias === 'both' ? A : B);
    const want = snap(OUT);
    if (alias === 'a') e.test_mat4_mul(A, A, B);
    else if (alias === 'b') e.test_mat4_mul(B, A, B);
    else e.test_mat4_mul(A, A, A);
    const got = snap(alias === 'b' ? B : A);
    for (let i = 0; i < 16; i++) {
      if (got[i] !== want[i]) { console.log(`alias=${alias} FAIL @${i}: ${got[i]} want ${want[i]}`); ok = false; break; }
    }
  }

  // 360 accumulated 1-degree steps must stay a rotation (rows unit length).
  const t = Math.PI / 180;
  for (let i = 0; i < 16; i++) { f32(A + i*4, i % 5 === 0 ? 1 : 0); f32(B + i*4, i % 5 === 0 ? 1 : 0); }
  f32(B + 0, Math.cos(t)); f32(B + 4, Math.sin(t)); f32(B + 16, -Math.sin(t)); f32(B + 20, Math.cos(t));
  for (let n = 0; n < 360; n++) e.test_mat4_mul(A, A, B);
  for (let r = 0; r < 2; r++) {
    const len = Math.hypot(rf32(A + r*16), rf32(A + r*16 + 4));
    if (Math.abs(len - 1) > 1e-3) { console.log(`accumulated rotation row ${r} length ${len}`); ok = false; }
  }

  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
