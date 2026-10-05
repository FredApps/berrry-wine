#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { createHostImports } = require('../lib/host-imports');

async function instance(module, memory, tid) {
  const imports = createHostImports({ getMemory: () => memory.buffer, renderer: null, resourceJson: {} });
  imports.host.memory = memory;
  const e = (await WebAssembly.instantiate(module, imports)).exports;
  e.init_thread(tid, 0x400000, 0, 0, 0, 0, 0, 0);
  assert(e.ensure_tls_slots());
  return e;
}

if (!isMainThread) {
  (async () => {
    const e = await instance(workerData.module, workerData.memory, workerData.tid);
    parentPort.on('message', command => {
      if (command === 'stop') { parentPort.close(); return; }
      assert.strictEqual(command, 'allocate');
      const indices = [];
      for (let i = 0; i < 20; i++) {
        const index = e.test_call_TlsAlloc() >>> 0;
        assert(index < 80, 'concurrent reservation has capacity');
        assert.strictEqual(e.test_call_TlsSetValue(index, workerData.tid), 1);
        indices.push(index);
      }
      parentPort.postMessage({ indices, vector: e.get_tls_slots() >>> 0 });
    });
    parentPort.postMessage({ ready: true });
  })().catch(error => { throw error; });
} else {
  (async () => {
    const { compileSrcWasm } = require('./compile-src');
    const module = await WebAssembly.compile(compileSrcWasm());
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const e = await instance(module, memory, 1);
    const workers = [];
    const next = worker => new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('TLS worker observation timeout')), 120000);
      const message = value => finish(null, value);
      const error = value => finish(value);
      const exit = code => finish(new Error(`TLS worker exited before response (${code})`));
      function finish(err, value) {
        clearTimeout(timer);
        worker.off('message', message); worker.off('error', error); worker.off('exit', exit);
        err ? reject(err) : resolve(value);
      }
      worker.once('message', message); worker.once('error', error); worker.once('exit', exit);
    });
    try {
      const ready = [];
      for (let i = 0; i < 4; i++) {
        const worker = new Worker(__filename, { workerData: { module, memory, tid: i + 2 } });
        workers.push(worker); ready.push(next(worker));
      }
      assert((await Promise.all(ready)).every(result => result.ready));
      for (let round = 0; round < 2; round++) {
        const pending = workers.map(next);
        workers.forEach(worker => worker.postMessage('allocate'));
        const replies = await Promise.all(pending);
        const indices = replies.flatMap(reply => reply.indices).sort((a, b) => a - b);
        assert.deepStrictEqual(indices, Array.from({ length: 80 }, (_, i) => i),
          `round ${round}: four real Workers reserve distinct indices`);
        assert.strictEqual(e.test_call_TlsAlloc() >>> 0, 0xffffffff);
        assert.strictEqual(e.test_call_GetLastError(), 259);
        for (const [i, reply] of replies.entries()) {
          for (const index of reply.indices) {
            assert.strictEqual(e.guest_read32(reply.vector + index * 4), i + 2);
          }
        }
        for (const index of indices) assert.strictEqual(e.test_call_TlsFree(index), 1);
        for (const reply of replies) {
          for (let index = 0; index < 80; index++) {
            assert.strictEqual(e.guest_read32(reply.vector + index * 4), 0,
              'remote Free clears raw Worker vectors before another API call');
          }
        }
      }
      console.log('PASS four concurrent WASM Workers: 160 unique reservations, reuse, exhaustion and cross-thread clearing');
    } finally {
      await Promise.all(workers.map(worker => worker.terminate()));
    }
  })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
