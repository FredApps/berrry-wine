'use strict';
const assert = require('assert');
const Glide = require('../lib/glide-backend');
const Software = require('../lib/glide-software');
const clock = () => { let value = 0; return () => (value += 10); };
const packet = () => {
  const bytes = new Uint8Array(28);
  bytes.set(new Uint8Array(new Uint32Array([0, 0, 0, 2, 2]).buffer));
  return bytes;
};
const gpu = new Glide.Device({ nowMs: clock(), backend: {
  gl: { RGBA: 1, UNSIGNED_BYTE: 2 },
  readPixels(x, y, w, h, format, type, bytes) {
    assert.deepStrictEqual([x, y, w, h], [0, 0, 2, 2]);
    for (let i = 0; i < bytes.length; i += 4) bytes.set([255, 0, 0, 255], i);
  }
} });
Object.assign(gpu, { opened: true, width: 2, height: 2, bind() {} });
const gpuPacket = packet(); gpu.submit(9, gpuPacket);
assert.strictEqual(new DataView(gpuPacket.buffer).getUint16(20, true), 0xf800);
assert.deepStrictEqual([
  gpu.stats.gpuReadbackCount, gpu.stats.gpuReadbackBytes, gpu.stats.gpuReadbackCpuMs,
  gpu.stats.lfbConversionCpuMs, gpu.stats.lfbReadPacketBytes, gpu.stats.lfbReadPixelBytes
], [1, 16, 10, 10, 28, 8]);
gpu.backend.readPixels = () => { throw new Error('driver lost'); };
assert.throws(() => gpu.submit(9, packet()), /driver lost/);
assert.deepStrictEqual([gpu.stats.gpuReadbackCount, gpu.stats.gpuReadbackFailures,
  gpu.stats.gpuReadbackBytes, gpu.stats.gpuReadbackCpuMs, gpu.stats.lfbReadPacketBytes],
  [2, 1, 16, 20, 28], 'failed GPU calls count time/attempts, not successful bytes');

let frame;
const software = new Software.Device({ nowMs: clock(), presentPixels: value => { frame = value; } });
Object.assign(software, { width: 2, height: 2, colorIds: [1, 2], native: {
  readColor() { return { pixels: Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255,
    0, 0, 255, 255, 0, 0, 255, 255]) }; }
} });
const cpuPacket = packet(); software.submit(9, cpuPacket);
software.present();
assert.deepStrictEqual(cpuPacket, gpuPacket, 'instrumentation preserves RGB565 conversion');
assert.deepStrictEqual(Array.from(frame.pixels.slice(0, 4)), [255, 0, 0, 255]);
assert.deepStrictEqual([software.stats.cpuLfbReadCount, software.stats.cpuLfbReadBytes,
  software.stats.cpuLfbReadCpuMs, software.stats.lfbConversionCpuMs,
  software.stats.cpuPresentReadCount, software.stats.cpuPresentReadBytes,
  software.stats.cpuPresentReadCpuMs, software.stats.presentConversionCpuMs],
  [1, 16, 10, 10, 1, 16, 10, 10]);
assert.strictEqual(software.stats.gpuReadbackCount, 0, 'CPU snapshots are not GPU readbacks');
assert.strictEqual(software.stats.lfbReadPacketBytes, 28);
console.log('PASS Glide readback byte/count/timing attribution and unchanged pixel data');
