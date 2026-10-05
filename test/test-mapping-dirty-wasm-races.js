#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { compile } = require('../tools/watx');

// Standalone fixture memory, not the emulator region map:
// state=0, data=4, disk=8, rendezvous=12. One modeled page contains one DWORD.
const source = String.raw`
  (import "host" "memory" (memory 1 1 shared))
  (import "host" "pause" (func $pause (param i32)))
  (func (export "write") (param $value i32) (param $repair i32)
    (local $stamp i32) (local $after i32)
    (local.set $stamp (i32.atomic.load (i32.const 0)))
    (call $pause (i32.const 0))
    (if (i32.eqz (i32.and (local.get $stamp) (i32.const 1)))
      (then (drop (i32.atomic.rmw.or (i32.const 0) (i32.const 1)))))
    (call $pause (i32.const 1))
    (i32.store (i32.const 4) (local.get $value))
    (call $pause (i32.const 2))
    (local.set $after (i32.atomic.load (i32.const 0)))
    (call $pause (i32.const 3))
    (if (i32.and (local.get $repair)
          (i32.ne (i32.shr_u (local.get $stamp) (i32.const 1))
                  (i32.shr_u (local.get $after) (i32.const 1))))
      (then (drop (i32.atomic.rmw.or (i32.const 0) (i32.const 1))))))
  (func (export "claim") (result i32)
    (local $old i32)
    (loop $retry
      (local.set $old (i32.atomic.load (i32.const 0)))
      (if (i32.eqz (i32.and (local.get $old) (i32.const 1)))
        (then (return (i32.const 0))))
      (br_if $retry (i32.ne
        (i32.atomic.rmw.cmpxchg (i32.const 0) (local.get $old)
          (i32.and (i32.add (local.get $old) (i32.const 2)) (i32.const -2)))
        (local.get $old))))
    (i32.const 1))
  (func (export "copy")
    (i32.store (i32.const 8) (i32.load (i32.const 4))))
`;

if (!isMainThread) {
    const gate = new Int32Array(workerData.memory.buffer, 12, 1);
    let iteration = 0;
    const instance = new WebAssembly.Instance(workerData.module, { host: {
      memory: workerData.memory,
      pause(stage) {
        Atomics.store(gate, 0, 0);
        parentPort.postMessage({ stage, iteration });
        if (Atomics.wait(gate, 0, 0, 15000) === 'timed-out') throw Error('parent rendezvous timed out');
      },
    } });
    for (const value of workerData.values) {
      instance.exports.write(value, workerData.repair ? 1 : 0);
      iteration++;
    }
    parentPort.postMessage({ done: true });
} else {
  async function scenario(module, { repair, initiallyDirty, flushStage, values }) {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    const words = new Int32Array(memory.buffer);
    words[0] = initiallyDirty ? 1 : 0;
    const e = new WebAssembly.Instance(module, { host: { memory, pause() {} } }).exports;
    const worker = new Worker(__filename, { workerData: { module, memory, repair, values } });
    let pauses = 0;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('worker scenario timed out')), 30000);
        worker.on('error', error => { clearTimeout(timer); reject(error); });
        worker.on('exit', code => {
          if (code) { clearTimeout(timer); reject(Error(`worker exited ${code}`)); }
        });
        worker.on('message', message => {
          if (message.done) { clearTimeout(timer); resolve(); return; }
          pauses++;
          // Each flush is completed before another can start. Worker pause
          // occurs INSIDE one WASM write, not between separate write calls.
          if (message.stage === flushStage && e.claim()) e.copy();
          Atomics.store(words, 3, 1);
          Atomics.notify(words, 3);
        });
      });
      assert.strictEqual(pauses, values.length * 4);
      const pending = !!(Atomics.load(words, 0) & 1);
      const before = { memory: words[1], disk: words[2], pending };
      if (e.claim()) e.copy();
      assert.strictEqual(words[1], values.at(-1));
      if (repair) {
        assert.strictEqual(words[2], words[1], 'quiescent drain catches latest store');
        if (flushStage <= 1) assert(pending, 'even a restored value must be marked after pre-store flush');
      }
      return before;
    } finally { await worker.terminate(); }
  }
  (async () => {
    const result = compile(source, new Map(), { mode: 'production' });
    assert(result.success, result.error);
    const module = new WebAssembly.Module(result.wasmBinary);
    const lost = await scenario(module, {
      repair: false, initiallyDirty: false, flushStage: 1, values: [9],
    });
    assert.deepStrictEqual(lost, { memory: 9, disk: 0, pending: false },
      'disabled repair must reproduce lost write with actual WASM stores');
    let count = 0;
    for (const initiallyDirty of [false, true])
      for (const flushStage of [0, 1, 2, 3])
        for (const values of [[9], [9, 0]]) {
          await scenario(module, { repair: true, initiallyDirty, flushStage, values });
          count++;
        }
    console.log(`PASS shared WASM dirty generation: ${count} forced worker schedules plus lost-write negative control`);
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
