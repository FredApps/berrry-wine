'use strict';
// A browser without WebGL must still run a Glide game: the page bridge and the
// render Worker both fall back to the software rasterizer instead of failing
// grSstWinOpen. Before this, NFS III Glide crashed straight after "[Glide]
// WebGL is unavailable" on a GPU-less page.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Bridge } = require('../lib/glide-host');
const Software = require('../lib/glide-software');
const GlideRenderWorker = require('../lib/glide-render-worker');

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const canvas = { width: 0, height: 0, getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  }) };

  // Page bridge: WebGL backend creation throws.
  const packetAt = 0x1000; // scratch spot in WASM memory, restored below
  const errors = [];
  const bridge = new Bridge({
    getMemory: () => memory, getExports: () => e, renderer: () => null,
    createCanvas: () => canvas,
    createBackend: () => { throw new Error('WebGL is unavailable'); },
    onError: error => errors.push(error.message),
  });
  const saved = new Uint8Array(memory.buffer, packetAt, 20).slice();
  new Uint32Array(memory.buffer, packetAt, 5).set([0, 64, 48, 0, 0]);
  assert.strictEqual(bridge.submit(1, packetAt, 20), 1, 'open succeeds without WebGL');
  assert(bridge.device instanceof Software.Device, 'the software device took over');
  assert.strictEqual(canvas.width, 64);
  assert(errors.some(m => /WebGL is unavailable/.test(m)), 'the WebGL failure is still reported');
  assert(errors.some(m => /software backend/.test(m)), 'and the fallback is named');
  bridge.close();
  new Uint8Array(memory.buffer, packetAt, 20).set(saved);

  // Render Worker endpoint: no OffscreenCanvas in Node, so the WebGL branch fails.
  const warn = console.warn; const warned = [];
  console.warn = m => warned.push(String(m));
  try {
    const endpoint = GlideRenderWorker.create({ instance: { exports: e }, memory, backend: 'webgl',
      sendFrame() {} });
    const bytes = new Uint8Array(new Uint32Array([0, 64, 48, 0, 0]).buffer);
    const reply = await endpoint.execute({ t: 'glide-command', op: 1, bytes });
    assert.strictEqual(reply.result, 1, 'worker open succeeds without WebGL');
    assert(warned.some(m => /software backend/.test(m)));
    await endpoint.execute({ t: 'glide-command', op: 2, bytes: new Uint8Array() });
  } finally { console.warn = warn; }
  console.log('PASS Glide without WebGL falls back to software on the page and in the render Worker');
})().catch(error => { console.error(error); process.exitCode = 1; });
