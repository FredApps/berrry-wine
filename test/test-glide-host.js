'use strict';
const assert = require('assert');
const { Bridge } = require('../lib/glide-host');
const { processSharedCtx } = require('../lib/worker-imports');

// Borrowed guest memory may be reused immediately after an import completes.
// The fake consumer retains a packet to model a resource upload retained by
// the renderer; it must never observe subsequent guest writes.
const memory = new ArrayBuffer(128);
const words = new Uint32Array(memory);
const win = {}, renderer = { windows: { 42: win },
  scheduleRepaint() { this.repaintScheduled = true; } };
let device, destroyed = 0, frames = 0;
class Device {
  constructor(options) { this.options = options; this.commands = []; device = this; }
  submit(op, bytes) {
    this.commands.push({ op, bytes });
    if (op === 9) bytes.set([0x00, 0xf8], 20);
    if (op === 4) this.options.onPresent({ hwnd: 0, surface: { frame: frames++ } });
    return 1;
  }
}
const bridge = new Bridge({
  getMemory: () => memory, renderer: () => renderer,
  getExports: () => ({ get_dx_present_hwnd: () => 42 }),
  createCanvas: () => ({}), createBackend: () => ({ destroy() { destroyed++; } }), Device,
});
words.set([42, 640, 480, 0, 0]);
assert.equal(bridge.submit(1, 0, 20), 1);
words[0] = 123;
bridge.submit(6, 0, 4);
words[0] = 456;
assert.equal(new DataView(device.commands[1].bytes.buffer).getUint32(0, true), 123);
assert.throws(() => bridge.submit(6, 125, 4), /outside WASM/);
assert.throws(() => bridge.submit(6, -1, 4), /outside WASM/);
bridge.submit(4, 0, 0);
assert.equal(win._gpuFrameLayer.writeSeq, 1);
assert.equal(win._dxFrameLayer, win._gpuFrameLayer);
assert(renderer.repaintScheduled);
assert.equal(processSharedCtx({ glideBridge: bridge }).glideBridge, bridge,
  'a guest thread must use the process board rather than create a second renderer');
bridge.submit(9, 64, 22);
assert.equal(new DataView(memory).getUint16(84, true), 0xf800,
  'a synchronous LFB read publishes returned pixels to guest memory');
const oldDevice = device;
renderer.repaintScheduled = false;
bridge.submit(2, 0, 0);
assert.equal(win._gpuFrameLayer, null);
assert.equal(win._dxFrameLayer, null);
assert.equal(destroyed, 1);
assert(renderer.repaintScheduled, 'closing the board must repaint the detached window layer');
assert.deepEqual(oldDevice.commands.map(c => c.op), [1, 6, 4, 9, 2]);
bridge.close();
assert.equal(destroyed, 1, 'retirement is idempotent');
assert.throws(() => bridge.submit(4, 0, 0), /without an open context/);
words.set([42, 640, 480, 0, 0]);
assert.equal(bridge.submit(1, 0, 20), 1, 'closed context can reopen with fresh resources');
bridge.close();
const absent = new Bridge({ getMemory: () => memory, createCanvas: () => null });
assert.equal(absent.submit(1, 0, 20), 0, 'unavailable drawable fails context creation');
console.log('PASS Glide host: owned packets, bounds, process sharing, presentation and close/reopen');
