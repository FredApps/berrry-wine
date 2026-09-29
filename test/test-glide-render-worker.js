'use strict';
const assert = require('assert');
const { Bridge } = require('../lib/glide-host');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const memory = new ArrayBuffer(4096), calls = [], endpoints = [], copies = [];
  const view = new DataView(memory);
  [7, 2, 2, 0, 0].forEach((v, i) => view.setUint32(i * 4, v, true));
  const win = {}, renderer = { windows: { 7: win }, scheduleRepaint() {} };
  const bridge = new Bridge({ backend: 'webgl', getMemory: () => memory,
    renderer, createCanvas: () => ({ width: 0, height: 0, getContext: () => ({
      drawImage(bitmap) { copies.push(bitmap); },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(image) { copies.push(image.data.slice()); },
    }) }), createRenderEndpoint(options) {
      assert.deepStrictEqual(options, { api: 'glide', backend: 'webgl' });
      const endpoint = { ready: Promise.resolve(), listener: null, gate: null, terminated: false,
        addEventListener(type, listener) { assert.strictEqual(type, 'message'); this.listener = listener; },
        request(message) {
          calls.push({ ...message, bytes: message.bytes.slice() });
          if (message.op === 9) {
            const bytes = message.bytes.slice(); bytes.fill(0xa7, 20);
            return Promise.resolve({ result: 1, bytes });
          }
          if (message.op === 0 && this.gate) return this.gate.promise;
          return Promise.resolve({ result: 1, ...(message.op === 1
            ? { glRenderer: 'ANGLE (test renderer exact string)' } : {}), stats: { draws: calls.length } });
        },
        terminate() { this.terminated = true; return Promise.resolve(); },
        frame(frame) { this.listener({ data: { t: 'frame', frame } }); },
      };
      endpoints.push(endpoint); return endpoint;
    } });
  return { bridge, memory, calls, endpoints, copies, win };
}

(async () => {
  const f = fixture();
  assert.strictEqual(await f.bridge.submit(1, 0, 20), 1);
  assert.strictEqual(f.bridge.device.glRenderer, 'ANGLE (test renderer exact string)');
  const endpoint = f.endpoints[0];
  const bytes = new Uint8Array(f.memory); bytes.set([11, 22, 33, 44], 100);
  endpoint.gate = deferred();
  const command = f.bridge.submit(0, 100, 4);
  bytes.fill(99, 100, 104);
  // Close immediately, before the command's Promise has posted to the port.
  // It must drain that owned packet before sending close, not invalidate it.
  const closing = f.bridge.close();
  assert.strictEqual(f.bridge.close(), closing);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(f.calls.map(c => c.op), [1, 0]);
  assert.deepStrictEqual(Array.from(f.calls[1].bytes), [11, 22, 33, 44]);
  assert.strictEqual(endpoint.terminated, false);
  endpoint.gate.resolve({ result: 1 });
  assert.strictEqual(await command, 1); await closing;
  assert.deepStrictEqual(f.calls.map(c => c.op), [1, 0, 2]);
  assert.strictEqual(endpoint.terminated, true);

  await f.bridge.submit(1, 0, 20);
  const live = f.endpoints[1];
  bytes.fill(0, 200, 228);
  assert.strictEqual(await f.bridge.submit(9, 200, 28), 1);
  assert.strictEqual(f.bridge.device.glRenderer, 'ANGLE (test renderer exact string)',
    'later replies must retain the renderer queried at open');
  assert.deepStrictEqual(Array.from(bytes.slice(220, 228)), Array(8).fill(0xa7));
  let closed = 0;
  const bitmap = { close() { closed++; } };
  live.frame({ hwnd: 7, width: 2, height: 2, bitmap });
  assert.strictEqual(closed, 1);
  assert.strictEqual(f.copies[0], bitmap);
  assert(f.win._gpuFrameLayer);
  const pixels = new Uint8ClampedArray(16).fill(17);
  live.frame({ hwnd: 7, width: 2, height: 2, pixels }); pixels.fill(99);
  assert.deepStrictEqual(Array.from(f.copies[1]), Array(16).fill(17));
  await f.bridge.close();
  assert.strictEqual(f.win._gpuFrameLayer, null);
  live.frame({ hwnd: 7, width: 2, height: 2, bitmap });
  assert.strictEqual(closed, 2, 'late transferred bitmap must be released');

  const failed = fixture(); await failed.bridge.submit(1, 0, 20);
  failed.endpoints[0].gate = deferred();
  const rejected = failed.bridge.submit(0, 100, 4);
  failed.endpoints[0].gate.reject(new Error('native raster failure'));
  await assert.rejects(rejected, /native raster failure/);
  await assert.rejects(failed.bridge.close(), /native raster failure/);
  assert.strictEqual(failed.endpoints[0].terminated, true);
  console.log('PASS Glide shared render endpoint ownership, ordering, readback and teardown');
})().catch(error => { console.error(error); process.exitCode = 1; });
