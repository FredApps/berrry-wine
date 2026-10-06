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
    // The 24-byte open grSstWinOpen sends (word 5 = nColBuffers). With Threads
    // the guest's Glide goes through this endpoint, and a 20-byte-only check
    // here trapped Myth TFL's single-buffered 3Dfx open at EIP 0x4602f6.
    const single = GlideRenderWorker.create({ instance: { exports: e }, memory, backend: 'software', sendFrame() {} });
    const open24 = new Uint8Array(new Uint32Array([0, 64, 48, 0, 0, 1]).buffer);
    assert.strictEqual((await single.execute({ t: 'glide-command', op: 1, bytes: open24 })).result, 1,
      'render worker accepts the single-buffered 24-byte open');
    await single.execute({ t: 'glide-command', op: 2, bytes: new Uint8Array() });
    const bad = GlideRenderWorker.create({ instance: { exports: e }, memory, backend: 'software', sendFrame() {} });
    assert.throws(() => bad.execute({ t: 'glide-command', op: 1,
      bytes: new Uint8Array(new Uint32Array([0, 64, 48, 0, 0, 3]).buffer) }), /Invalid Glide open packet/,
      'a colour-buffer count other than 1 or 2 is still refused');
  } finally { console.warn = warn; }

  // The CLI host wiring. run.js keeps ctx.createCanvas null unless
  // --headless-gl or --glide-renderer=software (GL and D3D9 key their
  // no-3D-hardware path off it), and with only that the default webgl Glide
  // bridge had no drawable at all: grSstWinOpen returned 0, NFS III and
  // Diablo II ignored it, and their next grBufferClear/guGammaCorrectionRGB
  // trapped on the closed context. ctx.glideCreateCanvas is Glide's own.
  const { createHostImports } = require('../lib/host-imports');
  const { createCanvas } = require('../lib/canvas-compat');
  const openThroughHost = extra => {
    const logged = [], error = console.error;
    console.error = m => logged.push(String(m));
    try {
      const imports = createHostImports(Object.assign({ getMemory: () => memory.buffer,
        exports: e, renderer: null, onExit() {}, glideBackend: 'webgl', createCanvas: null }, extra));
      new Uint32Array(memory.buffer, packetAt, 5).set([0, 64, 48, 0, 0]);
      const opened = imports.host.glide_submit(1, packetAt, 20);
      if (opened) imports.host.glide_submit(2, 0, 0);
      return { opened, logged };
    } finally {
      console.error = error;
      new Uint8Array(memory.buffer, packetAt, 20).set(saved);
    }
  };
  assert.strictEqual(openThroughHost({}).opened, 0,
    'control: with no drawable factory the open fails, the shape that trapped');
  const viaCli = openThroughHost({ glideCreateCanvas: createCanvas });
  assert.strictEqual(viaCli.opened, 1, 'glideCreateCanvas lets a webgl bridge open headless');
  assert(viaCli.logged.some(m => /software backend/.test(m)), 'by falling back to software');
  const runJs = require('fs').readFileSync(require('path').join(__dirname, 'run.js'), 'utf8');
  assert(/glideCreateCanvas: createCanvas \|\| null/.test(runJs),
    'test/run.js hands the Glide bridge its own drawable factory');
  console.log('PASS Glide without WebGL falls back to software on the page and in the render Worker');
})().catch(error => { console.error(error); process.exitCode = 1; });
