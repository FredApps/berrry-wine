// Consumer for lib/d3d-command-stream.js. It instantiates the same module over
// shared memory with inert host imports: D3DIM rasterization is WAT-native and
// presentation remains fenced on the ordinary browser-owner path.
'use strict';

const IS_WEB = typeof importScripts === 'function';
let parentPort = null;
if (!IS_WEB) parentPort = require('worker_threads').parentPort;
const send = IS_WEB ? (msg => self.postMessage(msg)) : (msg => parentPort.postMessage(msg));
const listen = IS_WEB
  ? (fn => { self.onmessage = event => fn(event.data || {}); })
  : (fn => parentPort.on('message', msg => fn(msg || {})));

let instance = null;
let memory = null;
let control = null;
let buffers = null;
let stateGuest = 0;
let verticesGuest = 0;
let initializedImage = 0;
let targetBytes = null;
let neutralReceiver = null;
let neutralStopping = false;
let initializing = false;
const neutralDevices = new Map();
const CTRL = {
  READY: 0, COMPLETED: 1, ERROR: 2,
  BATCHES: 4, COMMANDS: 5, REPLAY_US: 6,
  GL_TRIANGLES: 8, GL_CLIPPED: 9, GL_CULLED: 10,
};
const HEADER_BYTES = 32;
const RECORD_FLIP = 1; // header-only swap record; see d3d-command-stream.js
const RECORD_GL = 2;   // software-OpenGL snapshot + packed draw
const RECORD_GL_TEX = 3; // converted glTexSubImage2D texels for one surface
const STATE_BYTES = 4096;
const VERTEX_CAPACITY = 0x400000;

// Pure functions a rasterizer calls mid-draw (GL fog and specular use pow);
// an inert 0 there would draw the wrong picture rather than fail.
const MATH_IMPORTS = {
  math_sin: Math.sin, math_cos: Math.cos, math_tan: Math.tan,
  math_atan2: Math.atan2, math_log2: Math.log2, math_pow: Math.pow,
  math_pow2: x => Math.pow(2, x),
};

function inertImports(sigs) {
  const host = { memory };
  for (const [name, sig] of Object.entries(sigs || {})) {
    host[name] = MATH_IMPORTS[name]
      || (sig.results && sig.results.length ? (() => 0) : (() => {}));
  }
  return { host };
}

function ensureWorkspace(imageBase) {
  imageBase >>>= 0;
  if (initializedImage === imageBase && stateGuest && verticesGuest) return;
  if (initializedImage) throw new Error('D3D render Worker image base changed');
  const ex = instance.exports;
  // Renderer-only initialization establishes address translation and a private
  // heap arena without assigning a guest thread's page/cache partitions.
  ex.d3dim_worker_init(imageBase);
  stateGuest = ex.guest_alloc(STATE_BYTES) >>> 0;
  verticesGuest = ex.guest_alloc(VERTEX_CAPACITY) >>> 0;
  if (!stateGuest || !verticesGuest) throw new Error('D3D render Worker workspace allocation failed');
  initializedImage = imageBase;
}

function initializeNeutral(msg) {
  if (!Number.isInteger(msg.imageBase) || msg.imageBase <= 0 || msg.imageBase > 0xffffffff)
    throw new Error('invalid neutral render image base');
  if (typeof instance.exports.d3d_render_retire_heap !== 'function')
    throw new Error('native render heap handoff export missing');
  // Same renderer-only initializer as legacy replay, without allocating its
  // unrelated 4 MiB immediate-mode staging buffer or touching x86 thread state.
  instance.exports.d3dim_worker_init(msg.imageBase);
  initializedImage = msg.imageBase;
  let Stream, Software;
  if (IS_WEB) {
    const suffix = msg.sourceVersion === undefined ? '' : `?v=${encodeURIComponent(msg.sourceVersion)}`;
    importScripts(`d3d-command-stream.js${suffix}`, `d3d-shader-ir.js${suffix}`, `d3d-geometry-batches.js${suffix}`, `d3d9-software-backend.js${suffix}`);
    Stream = self.D3DCommandStream; Software = self.D3D9SoftwareBackend;
  } else {
    Stream = require('./d3d-command-stream'); Software = require('./d3d9-software-backend');
  }
  neutralReceiver = Stream.createCommandReceiver({ execute(command) {
    if (neutralStopping) throw new Error('render worker is stopping');
    const p = command.payload, id = command.deviceId;
    if (command.opcode === Stream.OPCODES.RESOURCE_CREATE && p?.kind==='device') {
      if (!p || p.kind !== 'device' || neutralDevices.has(id)) throw new Error('invalid software device creation');
      const device = new Software.Device({getExports:()=>instance.exports,getMemory:()=>memory.buffer,
        width:p.width,height:p.height,quadBudget:p.quadBudget,maxBytes:p.maxBytes,
        sliceMs:p.sliceMs===undefined?4:p.sliceMs,
        schedule:callback=>setTimeout(callback,0)});
      neutralDevices.set(id,{device,generation:command.generation});
      return {value:{width:device.width,height:device.height,pitch:device.pitch},complete:true};
    }
    const entry = neutralDevices.get(id);
    if (!entry || entry.generation !== command.generation) throw new Error('missing/stale software device');
    const result = entry.device.execute(command);
    if (command.opcode === Stream.OPCODES.RESOURCE_RELEASE && command.payload.kind==='device') neutralDevices.delete(id);
    return result;
  } }, send);
}

function shutdownNeutral() {
  if (neutralStopping) return;
  neutralStopping = true;
  let devicesReleased = 0, allocatedBytes = 0;
  for (const {device} of neutralDevices.values()) {
    device.destroy(); devicesReleased++; allocatedBytes += device.bytes;
  }
  neutralDevices.clear();
  const heapHead = instance.exports.d3d_render_retire_heap() >>> 0;
  send({t:'shutdown-complete',devicesReleased,allocatedBytes,heapHead});
}

function replay(msg) {
  ensureWorkspace(msg.imageBase);
  const source = buffers[msg.index | 0];
  const limit = Math.min(msg.bytes >>> 0, source.buffer.byteLength >>> 0);
  const view = source.view;
  const bytes = source.bytes;
  const ex = instance.exports;
  const stateWa = ex.guest_to_wasm(stateGuest) >>> 0;
  const verticesWa = ex.guest_to_wasm(verticesGuest) >>> 0;
  let offset = 0;
  let commands = 0;
  while (offset < limit) {
    if (offset + HEADER_BYTES > limit) throw new RangeError('truncated D3D command header');
    const recordBytes = view.getUint32(offset, true);
    if (view.getUint32(offset + 28, true) === RECORD_FLIP) {
      if (recordBytes !== HEADER_BYTES) throw new RangeError('invalid D3D flip record');
      ex.d3dim_worker_flip(view.getUint32(offset + 4, true), view.getUint32(offset + 8, true));
      offset += recordBytes;
      commands++;
      continue;
    }
    if (view.getUint32(offset + 28, true) === RECORD_GL) {
      const snapBytes = view.getUint32(offset + 4, true);
      const drawBytes = view.getUint32(offset + 8, true);
      if (offset + recordBytes > limit || snapBytes + drawBytes > VERTEX_CAPACITY
          || HEADER_BYTES + snapBytes + drawBytes > recordBytes) {
        throw new RangeError('invalid GL command record');
      }
      // Both payloads into the vertex workspace: the snapshot, then the draw.
      targetBytes.set(bytes.subarray(offset + HEADER_BYTES,
        offset + HEADER_BYTES + snapBytes + drawBytes), verticesWa);
      if (!ex.gl_sw_worker_draw(verticesWa, verticesWa + snapBytes))
        throw new Error('GL render Worker workspace allocation failed');
      offset += recordBytes;
      commands++;
      continue;
    }
    if (view.getUint32(offset + 28, true) === RECORD_GL_TEX) {
      const texBytes = view.getUint32(offset + 24, true);
      if (offset + recordBytes > limit || texBytes > VERTEX_CAPACITY
          || HEADER_BYTES + texBytes > recordBytes) {
        throw new RangeError('invalid GL texture record');
      }
      targetBytes.set(bytes.subarray(offset + HEADER_BYTES,
        offset + HEADER_BYTES + texBytes), verticesWa);
      ex.gl_sw_worker_tex_copy(verticesWa, view.getUint32(offset + 4, true),
        view.getUint32(offset + 8, true), view.getUint32(offset + 12, true),
        view.getUint32(offset + 16, true), view.getUint32(offset + 20, true));
      offset += recordBytes;
      commands++;
      continue;
    }
    const stateBytes = view.getUint32(offset + 20, true);
    const vertexBytes = view.getUint32(offset + 24, true);
    if (recordBytes < HEADER_BYTES + STATE_BYTES || offset + recordBytes > limit
        || stateBytes !== STATE_BYTES || vertexBytes > VERTEX_CAPACITY
        || HEADER_BYTES + stateBytes + vertexBytes > recordBytes) {
      throw new RangeError('invalid D3D command record');
    }
    targetBytes.set(bytes.subarray(offset + HEADER_BYTES,
      offset + HEADER_BYTES + stateBytes), stateWa);
    targetBytes.set(bytes.subarray(offset + HEADER_BYTES + stateBytes,
      offset + HEADER_BYTES + stateBytes + vertexBytes), verticesWa);
    ex.d3dim_worker_draw(
      view.getUint32(offset + 4, true), view.getUint32(offset + 8, true),
      view.getUint32(offset + 12, true), verticesGuest,
      view.getUint32(offset + 16, true), stateGuest);
    offset += recordBytes;
    commands++;
  }
  if (offset !== limit || commands !== (msg.commands | 0)) {
    throw new RangeError('D3D command batch count mismatch');
  }
}

listen(async msg => {
  try {
    if (msg.t === 'init') {
      if (instance || initializing) throw new Error('render worker already initialized');
      initializing = true;
      memory = msg.memory;
      control = msg.control ? new Int32Array(msg.control) : null;
      buffers = (msg.buffers || []).map(buffer => ({
        buffer, view: new DataView(buffer), bytes: new Uint8Array(buffer),
      }));
      targetBytes = new Uint8Array(memory.buffer);
      const result = await WebAssembly.instantiate(msg.module, inertImports(msg.sigs));
      instance = result.exports ? result : (result.instance || result);
      if (!instance.exports.d3dim_worker_init || !instance.exports.d3dim_worker_draw) {
        throw new Error('D3D render Worker exports missing');
      }
      if (msg.mode === 'neutral') initializeNeutral(msg);
      if (control) {
        Atomics.store(control, CTRL.READY, 1);
        Atomics.notify(control, CTRL.READY);
      }
      send({ t: 'ready' });
      return;
    }
    if (msg.t === 'd3d-command') {
      if (!neutralReceiver) throw new Error('neutral render worker not initialized');
      neutralReceiver(msg); return;
    }
    if (msg.t === 'd3d-shutdown') { shutdownNeutral(); return; }
    if (msg.t === 'batch') {
      const started = performance.now();
      replay(msg);
      Atomics.add(control, CTRL.BATCHES, 1);
      Atomics.add(control, CTRL.COMMANDS, msg.commands | 0);
      Atomics.add(control, CTRL.REPLAY_US,
        Math.max(0, Math.round((performance.now() - started) * 1000)));
      // Software-GL draws count in this instance, not the guest's; publish
      // them so --gl-census can add them back.
      const ex = instance.exports;
      if (ex.gl_sw_triangles) {
        Atomics.store(control, CTRL.GL_TRIANGLES, ex.gl_sw_triangles() | 0);
        Atomics.store(control, CTRL.GL_CLIPPED, ex.gl_sw_clipped() | 0);
        Atomics.store(control, CTRL.GL_CULLED, ex.gl_sw_culled() | 0);
      }
      Atomics.store(control, CTRL.COMPLETED, msg.seq | 0);
      Atomics.notify(control, CTRL.COMPLETED);
    }
  } catch (error) {
    // A protocol/validation failure can still retire the native owner cleanly.
    // A genuinely killed or trapped worker without this acknowledgement is
    // reported as orphaned by its producer, not silently claimed reclaimed.
    if (neutralReceiver && !neutralStopping) {
      try { shutdownNeutral(); } catch (_) {}
    }
    if (control) {
      Atomics.store(control, CTRL.ERROR, 1);
      Atomics.notify(control, CTRL.COMPLETED);
      Atomics.notify(control, CTRL.READY);
    }
    send({ t: 'error', error: String(error && error.stack || error) });
  }
});
