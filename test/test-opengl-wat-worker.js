#!/usr/bin/env node
'use strict';

// Real worker_threads coverage for the native WAT OpenGL encoder and the
// GuestRPC blocking broker. No WebGL provider is needed: the main thread
// validates and semantically consumes the production command records.

const assert = require('assert');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const RPC = require('../lib/guest-rpc');
const Stream = require('../lib/gl-command-stream');
const RegionMap = require('../lib/region-map.generated');

const STACK = RegionMap.BASE.GUEST_STACK + 0x3000;
const OUTPUT_GUEST = 0x405000;
const IMAGE_BASE = 0x400000;
const OUTPUT_WASM = OUTPUT_GUEST - IMAGE_BASE + RegionMap.BASE.GUEST_BASE;

if (!isMainThread) {
  const sigs = require(workerData.sigsPath).sigs;
  const memory = workerData.memory;
  const built = RPC.createWorkerImports(memory, sigs,
    message => parentPort.postMessage(message), { slot: 0 });
  const module_ = new WebAssembly.Module(workerData.wasm);
  const instance = new WebAssembly.Instance(module_, built.imports);
  const e = instance.exports;
  assert.strictEqual(e.gl_wat_encoder_set_enabled, undefined,
    'production worker exposes only the native encoder');
  assert.strictEqual(e.gl_wat_encoder_enabled, undefined,
    'production worker has no runtime JS fallback selector');
  e.init_thread(1, IMAGE_BASE, 0, 0, 0, 0, 0);
  e.heap_init(0x420000);
  const view = new DataView(memory.buffer);
  const call = (opcode, args = [], aux = 0) => {
    new Uint8Array(memory.buffer, STACK, 96).fill(0);
    view.setUint32(STACK, 0xDEC0ADDE, true);
    args.forEach((arg, index) => {
      const at = STACK + 4 + index * 4;
      if (arg && arg.f32 !== undefined) view.setFloat32(at, arg.f32, true);
      else view.setUint32(at, (arg && arg.u32 !== undefined ? arg.u32 : arg) >>> 0, true);
    });
    return e.gl_wat_encoder_call(opcode, STACK, aux) | 0;
  };
  const f32 = value => ({ f32: value });

  call(21, [0x0004]);
  call(25, [f32(0.25), f32(0.5), f32(0.75), f32(1)]);
  call(30, [f32(1), f32(2), f32(3)]);
  call(30, [f32(4), f32(5), f32(6)]);
  call(30, [f32(7), f32(8), f32(9)]);
  call(22);
  const outputWa = e.guest_to_wasm(OUTPUT_GUEST) >>> 0;
  view.setUint32(outputWa, 0, true);
  const queryStart = Date.now();
  const queryResult = call(103, [0x84E2, OUTPUT_GUEST]);
  const queryElapsed = Date.now() - queryStart;
  const queryOutput = view.getUint32(outputWa, true);

  // The response releases ownership of the shared stream range. Reuse it for
  // a second ordered barrier submission and prove the worker can park again.
  call(10, [0x0BE2]);
  const finishStart = Date.now();
  const finishResult = call(11);
  const finishElapsed = Date.now() - finishStart;
  parentPort.postMessage({ t: 'done', queryResult, queryOutput, queryElapsed,
    finishResult, finishElapsed, stats: built.stats });
} else {
  const { compileSrcWasm } = require('./compile-src');
  const sigs = require('../lib/host-import-sigs.generated.json').sigs;

  async function main() {
    const wasm = compileSrcWasm();
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const rpcView = RPC.views(memory, 0).i32;
    const batches = [];
    const broker = RPC.createMainBroker(memory, {
      gpu_gl_batch(batch, owner) {
        assert.strictEqual(owner, 0);
        assert.deepStrictEqual(Object.keys(batch).sort(), ['bytes', 'memoryOffset', 'softwareFront'],
          'native worker hands off shared stream and software presentation descriptors');
        assert.strictEqual(batch.softwareFront, 0,
          'a GL stream without a software drawable has no software front surface');
        const snapshot = Buffer.from(new Uint8Array(
          memory.buffer, batch.memoryOffset, batch.bytes));
        const opcodes = [];
        let packed = null;
        const result = Stream.replay(Stream.memoryBatch(
          memory, batch.memoryOffset, batch.bytes), (opcode, mode, capture) => {
          opcodes.push(opcode);
          if (opcode === Stream.PACKED_DRAW_OPCODE) {
            packed = { mode, vertices: Array.from(new Float32Array(
              capture.buffer, capture.pointerOffset, capture.pointerLength / 4)) };
          }
          if (opcode === 103) {
            const stack = new DataView(capture.buffer, capture.stackOffset, capture.stackBytes);
            assert.strictEqual(stack.getUint32(4, true), 0x84E2);
            assert.strictEqual(stack.getUint32(8, true), OUTPUT_GUEST);
            // Publish the query output before serveGlBatch wakes Atomics.wait.
            new DataView(memory.buffer).setUint32(OUTPUT_WASM, 4, true);
          }
          return batches.length === 0 ? 0x2468 : 0x1357;
        });
        batches.push({ ...batch, snapshot, opcodes, packed });
        return result;
      },
    }, sigs, { onError: (_name, error) => { throw error; } });

    const worker = new Worker(__filename, { workerData: {
      wasm, memory,
      sigsPath: path.join(__dirname, '..', 'lib', 'host-import-sigs.generated.json'),
    } });
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WAT GL worker deadline')), 30000);
      worker.on('error', error => { clearTimeout(timer); reject(error); });
      worker.on('message', message => {
        if (message.t === 'glBatch') {
          assert.strictEqual(Object.prototype.hasOwnProperty.call(message, 'batch'), false,
            'native stream never structured-clones a command buffer');
          assert.strictEqual(Atomics.load(rpcView, RPC.SLOT.STATUS), RPC.STATUS_REQ,
            'worker is parked with its request published');
          // A real delay distinguishes Atomics.wait from an accidental
          // synchronous in-process callback.
          setTimeout(() => broker.serveGlBatch(message), 25);
        } else if (message.t === 'done') {
          clearTimeout(timer); resolve(message);
        } else {
          clearTimeout(timer); reject(new Error(`unexpected worker message ${JSON.stringify(message)}`));
        }
      });
    });

    try {
      const result = await done;
      assert.strictEqual(result.queryResult, 0x2468);
      assert.strictEqual(result.queryOutput, 4,
        'query output is visible on the first worker instruction after wake');
      assert.strictEqual(result.finishResult, 0x1357);
      assert(result.queryElapsed >= 15 && result.finishElapsed >= 15,
        'both barriers remained blocked until delayed main-thread replay');
      assert.deepStrictEqual(batches.map(batch => batch.opcodes),
        [[Stream.PACKED_DRAW_OPCODE, 103], [10, 11]],
        'geometry, query, reuse, and finish preserve global order');
      assert.strictEqual(batches[0].packed.mode, 0x0004);
      assert.strictEqual(batches[0].packed.vertices.length, 3 * Stream.VERTEX_FLOATS);
      assert.deepStrictEqual(batches[0].packed.vertices.slice(0, 7),
        [1, 2, 3, 0.25, 0.5, 0.75, 1]);
      assert.strictEqual(batches[1].memoryOffset, batches[0].memoryOffset,
        'stream range is reused only after the first response wakes the worker');
      const reusedBytes = Math.min(batches[0].bytes, batches[1].bytes);
      assert.notStrictEqual(Buffer.compare(batches[0].snapshot.subarray(0, reusedBytes),
        Buffer.from(new Uint8Array(memory.buffer, batches[0].memoryOffset, reusedBytes))), 0,
      'second submission overwrites the released range without changing its snapshot');
      assert.strictEqual(Atomics.load(rpcView, RPC.SLOT.STATUS), RPC.STATUS_IDLE);
      assert.strictEqual(result.stats.sync, 2);
      assert.strictEqual(result.stats.local, 2,
        'only the two native flush imports cross out of WAT');
      console.log('PASS real Worker WAT GL offset transport, Atomics barriers, ordering, and reuse');
    } finally {
      await worker.terminate();
    }
  }

  main().catch(error => { console.error(error); process.exit(1); });
}
