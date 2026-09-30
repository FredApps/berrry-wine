/* global D3DIMGpu */
'use strict';

// Synthetic access benchmark, not a game host. Real compiled WAT, native GDI,
// WebGL readPixels/conversion and real Workers; presentation, guest scheduling
// and D3D command-queue costs are deliberately outside this fixture.
let e, memory, gpu, surface, dib, spare, spareSurface, target, gl, width, height, control;
let helper, serial = 0, creations = 0, exits = 0;
const pending = new Map();
const fail = message => { throw new Error(message); };
const equal = (a, b, label) => { if (a !== b) fail(`${label}: ${String(a)} != ${String(b)}`); };
function imports(module, mem, fence) {
  const out = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    const ns = out[imp.module] || (out[imp.module] = {});
    if (imp.kind === 'memory') ns[imp.name] = mem;
    else if (imp.kind === 'function') ns[imp.name] = imp.name === 'gpu_gl_call' ? fence :
      imp.name === 'gdi_surface_create' ? () => 1 : () => 0;
    else fail(`unsupported import ${imp.kind} ${imp.name}`);
  }
  return out;
}
async function startHelper(module) {
  creations++;
  const w = new Worker('/tools/bench-lazy-sync-worker.js');
  w.onmessage = ({ data }) => {
    if (data.t === 'fence') {
      try {
        Atomics.store(control, 1, gpu.fence(data.wa, data.len));
        Atomics.store(control, 0, 1); Atomics.notify(control, 0);
      } catch (error) {
        Atomics.store(control, 0, -1); Atomics.notify(control, 0);
        for (const p of pending.values()) p.reject(error);
        pending.clear();
      }
      return;
    }
    const p = pending.get(data.id);
    if (p) { pending.delete(data.id); data.error ? p.reject(Error(data.error)) : p.resolve(data.value); }
  };
  w.onerror = error => {
    for (const p of pending.values()) p.reject(Error(error.message));
    pending.clear();
  };
  await rpc(w, { t: 'helper-init', module, memory, control: control.buffer });
  return w;
}
function rpc(w, message) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('helper timeout')); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); } });
    w.postMessage({ ...message, id });
  });
}
function paint(frame) {
  const green = frame & 1;
  gl.clearColor(green ? 0 : 1, green ? 1 : 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  target.dirty = true; e.bl_pending();
  return green ? 0x07e0 : 0xf800;
}
function pixel(index = 0) { return new Uint16Array(memory.buffer, dib + index * 2, 1)[0]; }
function checkHud(background) {
  const p = new Uint16Array(memory.buffer, dib, width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    equal(p[y * width + x], y < 16 && x < 320 ? 31 : background, `pixel ${x},${y}`);
}
const counters = () => ({ ...gpu.snapshot(), armed: e.get_d3dim_lazy_armed(),
  touched: e.get_d3dim_lazy_touched(), untouched: e.get_d3dim_lazy_untouched(), creations, exits });
const delta = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, b[k] - (a[k] || 0)]));
async function boot(module, config) {
  width = config.width; height = config.height;
  memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  control = new Int32Array(new SharedArrayBuffer(8));
  e = (await WebAssembly.instantiate(module, imports(module, memory,
    (op, wa, len) => op === 0x20001 ? gpu.fence(wa, len) : 0))).exports;
  helper = null;
  importScripts('/lib/d3dim-gpu.js');
  const canvas = new OffscreenCanvas(width, height);
  gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }) ||
    canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) fail('WebGL unavailable');
  surface = e.bl_create(width, height); dib = e.bl_bits(surface);
  spareSurface = e.bl_create(width, height); spare = e.bl_bits(spareSurface);
  gpu = new D3DIMGpu.D3DIMGpu({ getMemory: () => memory.buffer,
    // The fixture owns target lifetime. Supply the actual write notification,
    // but not a fabricated COM id to production live-surface filtering.
    getExports: () => ({ page_watch_write: e.page_watch_write }),
    createCanvas: () => canvas, onError: fail });
  target = { rt: 1, dib, width, height, pitch: width * 2, bpp: 16, format: 1,
    dirty: false, device: { gpu: { gl, bindImplicitTarget: () => gl.bindFramebuffer(gl.FRAMEBUFFER, null) } } };
  gpu.targets.set(1, target);
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
}
async function run(module, config) {
  const renderer = await boot(module, config);
  const heap = (e.bl_heap() + 7) & ~7;
  const cases = {
    'untouched-hud': async (frame, verify) => {
      let color;
      for (let i = 0; i < 3; i++) {
        color = paint(frame); e.bl_lock(surface);
        if (i === 2) e.bl_hud(dib, width);
        e.bl_unlock(surface);
      }
      e.bl_flush(); if (verify) checkHud(color);
    },
    'gdi-normal': async (frame, verify) => {
      const color = paint(frame), currentDC = e.bl_dc(surface);
      if (verify) equal(e.bl_getpixel(currentDC), frame & 1 ? 0xff00 : 0xff, 'GDI read');
      e.bl_gdi_hud(currentDC); e.bl_release_dc(surface, currentDC);
      if (verify) checkHud(color);
    },
    'gdi-retained': async (frame, verify) => {
      // Bind each cycle since the normal-DC case releases transient DC state.
      const retained = e.bl_dc(surface), color = paint(frame); e.bl_lock(surface);
      if (verify) equal(e.bl_getpixel(retained), frame & 1 ? 0xff00 : 0xff, 'retained GDI read');
      e.bl_gdi_hud(retained); e.bl_unlock(surface); e.bl_flush();
      if (verify) checkHud(color);
    },
    'gdi-retained-write': async (frame, verify) => {
      const retained = e.bl_dc(surface), color = paint(frame); e.bl_lock(surface);
      e.bl_gdi_hud(retained); e.bl_unlock(surface); e.bl_flush();
      if (verify) checkHud(color);
    },
    'gdi-blit-normal': async (frame, verify) => {
      const srcDC = e.bl_dc(spareSurface); e.bl_hud(spare, width);
      const color = paint(frame), dstDC = e.bl_dc(surface);
      equal(e.test_gdi_hdc_bitblt(dstDC, 0, 0, 320, 16, srcDC, 0, 0, 0xcc0020), 1, 'sprite BitBlt');
      e.bl_release_dc(surface, dstDC); if (verify) checkHud(color);
    },
    'gdi-blit-retained': async (frame, verify) => {
      const srcDC = e.bl_dc(spareSurface), dstDC = e.bl_dc(surface); e.bl_hud(spare, width);
      const color = paint(frame); e.bl_lock(surface);
      equal(e.test_gdi_hdc_bitblt(dstDC, 0, 0, 320, 16, srcDC, 0, 0, 0xcc0020), 1, 'retained sprite BitBlt');
      e.bl_unlock(surface); e.bl_flush(); if (verify) checkHud(color);
    },
    'thread-read-write': async (frame, verify) => {
      const color = paint(frame); e.bl_lock(surface);
      const value = await rpc(helper, { t: 'access', dib, width, write: true });
      e.bl_unlock(surface); e.bl_flush();
      if (verify) { equal(value, color, 'other-worker read'); checkHud(color); }
    },
    'thread-write-only': async (frame, verify) => {
      const color = paint(frame); e.bl_lock(surface);
      await rpc(helper, { t: 'access', dib, width, write: true, writeOnly: true });
      e.bl_unlock(surface); e.bl_flush();
      if (verify) checkHud(color);
    },
    'thread-idle': async (frame, verify) => {
      // A real second Worker exists, but never touches the pending surface.
      await cases['untouched-hud'](frame, verify);
    },
    'x87-overlap': async (frame, verify) => {
      const color = paint(frame); new Uint8Array(memory.buffer, dib - 4, 4).fill(0);
      e.bl_lock(surface); const bits = BigInt.asUintN(64, e.bl_x87(dib - 4)); e.bl_unlock(surface); e.bl_flush();
      if (verify) equal(bits, BigInt((color | (color << 16)) >>> 0) << 32n, 'wide overlap bits');
    },
    'x87-sequential': async (frame, verify) => {
      const color = paint(frame); e.bl_lock(surface);
      // Offset four crosses pages in 1/512 accesses. Odd iterations prevent
      // a repeated constant from disappearing in an even-count XOR checksum.
      const bits = BigInt.asUintN(64, e.bl_x87_loop(dib + 4, 65537, 32768)); e.bl_unlock(surface); e.bl_flush();
      if (verify) equal(bits, BigInt(color) * 0x1000100010001n, 'sequential x87 checksum');
    },
    'x87-heap': async (_frame, verify) => {
      const view = new Float64Array(memory.buffer, heap, 8192);
      if (verify) view.fill(1.25);
      const bits = e.bl_x87_loop(heap, 65537, 32768);
      if (verify) equal(bits, 0x3ff4000000000000n, 'heap checksum');
    },
    'backing-replace': async (frame, verify) => {
      paint(frame); e.bl_lock(surface); e.bl_unlock(surface);
      // Supported post-Unlock replacement. Reuse the old external allocation
      // immediately; no later pending write may damage its new contents.
      e.bl_replace(surface, spare);
      new Uint16Array(memory.buffer, dib, width * height).fill(0x1234);
      e.bl_flush();
      const value = pixel(); e.bl_replace(surface, dib);
      if (verify) equal(value, 0x1234, 'reused old backing');
    },
    'final-release': async (frame, verify) => {
      const temp = e.bl_create(width, height), temporaryBits = e.bl_bits(temp);
      e.bl_replace(temp, dib);
      const color = paint(frame); e.bl_lock(temp); e.bl_unlock(temp);
      equal(e.bl_release(temp), 0, 'final reference');
      if (verify) equal(pixel(), color, 'final release readback');
      // Release fixture-owned backing through a test-only export to avoid
      // allocating a surface-sized buffer every timed iteration indefinitely.
      e.bl_free(temporaryBits);
    },
    'thread-history': async (_frame, verify) => {
      const before = creations, activeBefore = creations - exits;
      const short = await startHelper(module);
      await rpc(short, { t: 'noop' }); short.terminate(); exits++;
      if (verify) {
        equal(creations - before, 1, 'persistent creation history detects transient worker');
        equal(creations - exits, activeBefore, 'active-worker snapshots miss transient worker');
      }
    },
    'thread-transition': async (frame, verify) => {
      const color = paint(frame); e.bl_lock(surface);
      const short = await startHelper(module);
      const value = await rpc(short, { t: 'access', dib, width, write: true });
      short.terminate(); exits++; e.bl_unlock(surface); e.bl_flush();
      if (verify) { equal(value, color, 'new-worker read'); checkHud(color); }
    },
  };
  const rows = [];
  const names = config.cases.length ? config.cases : Object.keys(cases);
  for (const name of names) {
    if (!cases[name]) fail(`unknown case ${name}`);
    if (['thread-read-write', 'thread-write-only', 'thread-idle'].includes(name)) helper = await startHelper(module);
    // A/B/B/A ordering also supplies within-arm null observations.
    for (let round = 0; round < config.rounds; round++) for (const arm of ['eager', 'lazy', 'lazy', 'eager']) {
      e.bl_flush(); e.bl_replace(surface, dib);
      e.d3dim_lazy_enable(arm === 'lazy' ? 1 : 0);
      new Uint8Array(memory.buffer, dib, width * height * 2).fill(0);
      let error = null;
      try { for (let i = 0; i < 2; i++) await cases[name](i, true); }
      catch (caught) { error = String(caught.message || caught); }
      e.bl_flush(); e.bl_replace(surface, dib);
      if (error) {
        rows.push({ name, arm, round, status: 'INVALID', error });
        postMessage({ t: 'progress', row: rows.at(-1) });
        continue;
      }
      for (let i = 0; i < config.warmup; i++) await cases[name](i, false);
      const before = counters(), times = [], begin = performance.now();
      for (let frame = 0; frame < config.frames; frame++) {
        const start = performance.now(); await cases[name](frame, false);
        times.push(performance.now() - start);
      }
      const elapsedMs = performance.now() - begin, counts = delta(before, counters());
      // Full validation outside the measured window, same workload.
      try { await cases[name](0, true); } catch (caught) { error = String(caught.message || caught); }
      times.sort((a, b) => a - b);
      const percentile = p => times[Math.min(times.length - 1, Math.floor(times.length * p))];
      const row = { name, arm, round, status: error ? 'INVALID' : 'PASS', error,
        frames: config.frames, elapsedMs, msPerFrame: elapsedMs / config.frames,
        p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), counts };
      if (error) { delete row.msPerFrame; delete row.p50; delete row.p95; delete row.p99; }
      rows.push(row); postMessage({ t: 'progress', row });
    }
    if (helper) { helper.terminate(); exits++; helper = null; }
  }
  const glError = gl.getError(); if (glError) fail(`GL error ${glError}`);
  return { renderer, rows, config,
    scope: 'Real WAT/access APIs, Workers, WebGL and production D3DIMGpu readback. Minimal host; no guest scheduler, command queue, presentation or upload benchmark.' };
}
onmessage = async ({ data }) => {
  try {
    if (data.t === 'helper-init') {
      const c = new Int32Array(data.control);
      e = (await WebAssembly.instantiate(data.module, imports(data.module, data.memory, (op, wa, len) => {
        if (op !== 0x20001) return 0;
        Atomics.store(c, 0, 0); postMessage({ t: 'fence', wa, len });
        if (Atomics.wait(c, 0, 0, 10000) === 'timed-out' || Atomics.load(c, 0) < 0)
          fail('owner fence failed');
        return Atomics.load(c, 1);
      }))).exports;
      e.d3dim_lazy_enable(1);
      postMessage({ id: data.id, value: true });
    } else if (data.t === 'access') {
      const value = data.writeOnly ? 0 : e.bl_read(data.dib);
      if (data.write) e.bl_hud(data.dib, data.width);
      postMessage({ id: data.id, value });
    } else if (data.t === 'noop') postMessage({ id: data.id, value: true });
    else if (data.t === 'run') postMessage({ t: 'done', result: await run(data.module, data.config) });
  } catch (error) { postMessage({ t: 'error', id: data.id, error: String(error.stack || error) }); }
};
