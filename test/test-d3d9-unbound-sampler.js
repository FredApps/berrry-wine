#!/usr/bin/env node
// Sampling a texture stage with nothing bound draws; it does not kill the device.
//
// This is legal D3D9, not a gap in the software backend. The result of
// sampling an unbound stage is UNDEFINED and the device stays usable, and
// d3dx9's effect framework produces the state routinely -- whenever an effect
// has a texture parameter the application never assigned, it sets the sampler
// to NULL and draws anyway. Black & White 2's land pass is exactly that, and
// its own API trace shows the two calls back to back:
//
//   [API #11091470] IDirect3DDevice9_SetPixelShader(dev, 0x4e206174)  <- samples t2
//   [API #11091472] IDirect3DDevice9_SetTexture(dev, 2, 0x00000000)   <- NULLs stage 2
//   D3D9 software: missing pixel sampler2
//
// Refusing the draw was not merely wrong, it was fatal: the render command
// queue's error is sticky (lib/d3d-command-stream.js, `submit` rethrows
// `this.error`), so one such draw ended rendering for the whole run -- 9032
// commands submitted, 9031 completed, 558,381 failures after it -- and the
// land loaded to completion behind a menu that could never repaint. See
// docs/re-notes/black-white-2.md.
//
// The substitution lives in the backend and not in the shader VM on purpose:
// the native VM keeps its strict contract (a TEX with no sampler still returns
// -3, which test-d3d-shader-vm.js pins) and simply never sees the unbound
// state. That is what the last case here checks.
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Device } = require('../lib/d3d9-software-backend');

// ps_1_1: tex t<stage> ; mul r0, t<stage>, v0
const samplerShader = stage => new Uint32Array([0xffff0101,
  66, 0xb00f0000 | stage,
  5, 0x800f0000, 0xb0e40000 | stage, 0x90e40000,
  0xffff]);

// One full-viewport triangle carrying position, diffuse white and one UV set.
const source = (stage, textures) => {
  const vertices = new Uint8Array(3 * 24), v = new DataView(vertices.buffer);
  [[-1, 1], [3, 1], [-1, -3]].forEach(([x, y], j) => {
    const at = j * 24;
    [x, y, 0.5].forEach((c, k) => v.setFloat32(at + k * 4, c, true));
    vertices.set([255, 255, 255, 255], at + 12);
    v.setFloat32(at + 16, 0.5, true); v.setFloat32(at + 20, 0.5, true);
  });
  return { primitive: 4, primitiveCount: 1, stride: 24, vertices,
    attributes: [{ register: 0, usage: 0, usageIndex: 0, type: 2, offset: 0 },
      { register: 1, usage: 10, usageIndex: 0, type: 4, offset: 12 },
      { register: 2, usage: 5, usageIndex: 0, type: 1, offset: 16 }],
    vertexShader: new Uint32Array([0xfffe0101, 1, 0xc00f0000, 0x90e40000,
      1, 0xd00f0000, 0x90e40001, 1, 0xe00f0000, 0x90e40002, 0xffff]),
    pixelShader: samplerShader(stage),
    state: { cull: 1, zenable: false },
    textures };
};

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const options = { width: 8, height: 8, getExports: () => e, getMemory: () => memory.buffer };
  const d = new Device(options), base = d.bytes;
  const centre = pixels => Array.from(pixels.slice((4 * 8 + 4) * 4, (4 * 8 + 5) * 4));
  try {
    // A bound stage samples what is bound -- the control, so a later "black"
    // cannot be confused with a shader that never sampled anything at all.
    // Texture texels are BGRA, the byte order of D3DFMT_A8R8G8B8; present()
    // hands back RGBA, so the expected value is the reverse of the source.
    const solid = { width: 1, height: 1, pixels: new Uint8Array([40, 80, 160, 255]),
      sampler: { min: 1, mag: 1, mip: 0 } };
    const SOLID_RGBA = [160, 80, 40, 255];
    d.clear([0, 0, 0, 1], 1);
    d.draw(source(2, [null, null, solid]));
    assert.deepStrictEqual(centre(d.present().pixels), SOLID_RGBA,
      'a bound stage 2 samples the bound texture');

    // The case B&W2 hits: the same shader, nothing bound anywhere. It must
    // draw rather than throw, and the undefined sample reads as transparent
    // black, so `mul` with white diffuse leaves zero.
    d.clear([0, 0, 0, 1], 1);
    assert.doesNotThrow(() => d.draw(source(2, [])),
      'sampling an unbound stage must not fail the draw');
    assert.deepStrictEqual(centre(d.present().pixels), [0, 0, 0, 0],
      'an unbound sample contributes nothing');

    // Same again with the stage explicitly NULLed rather than absent, which is
    // the shape SetTexture(dev, 2, NULL) actually leaves in the payload.
    d.clear([0, 0, 0, 1], 1);
    assert.doesNotThrow(() => d.draw(source(2, [null, null, null])),
      'an explicitly NULLed stage must not fail the draw either');
    assert.deepStrictEqual(centre(d.present().pixels), [0, 0, 0, 0],
      'an explicitly NULLed stage samples as transparent black');

    // The device is still usable afterwards. This is the property whose
    // absence cost the whole run: one unservable draw used to poison every
    // later command, so a draw that works in isolation proves nothing.
    d.clear([0, 0, 0, 1], 1);
    d.draw(source(2, []));
    d.draw(source(2, [null, null, solid]));
    assert.deepStrictEqual(centre(d.present().pixels), SOLID_RGBA,
      'a bound draw still works after an unbound one');

    // Stage 6 and up is a real backend limit, not a D3D9-legal state -- there
    // are only six stages here -- so it must still be refused. Without this,
    // the change above would read as "stop checking samplers". The IR
    // validator gets there first on a PS1.1 shader (t6 is not a register the
    // version has), so match either refusal rather than pinning which layer
    // spoke; what matters is that one of them still does.
    assert.throws(() => d.draw(source(6, [])),
      /missing pixel sampler6|native shader validation failed/,
      'a stage beyond the implemented six is still an error');
  } finally { d.destroy(); assert.strictEqual(d.bytes, 0); }

  // The native shader VM keeps its own strict contract; the backend is what
  // hides the unbound state from it. test-d3d-shader-vm.js pins the -3 path in
  // detail -- this only asserts the export still exists to pin it with, so a
  // future "simplification" that moves the substitution into the VM has to
  // face that test rather than quietly satisfy this one.
  assert.strictEqual(typeof e.d3d_shader_vm_run, 'function');

  console.log('PASS test-d3d9-unbound-sampler');
})().catch(error => { console.error(error); process.exit(1); });
