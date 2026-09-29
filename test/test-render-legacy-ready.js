'use strict';
const assert = require('assert');
const { Worker } = require('worker_threads');
const { CTRL } = require('../lib/d3d-command-stream');

// A real parked producer: its event loop cannot deliver render error events.
// The main thread must wake startup and fence waits through shared control.
async function probe(mode) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('worker_threads');
    const { Encoder } = require(workerData.module);
    const encoder = new Encoder({ strictReady: true, explicitFence: true,
      readyTimeoutMs: 2000, workerFactory: () => ({
        postMessage: message => parentPort.postMessage(message), terminate() {}
      }) });
    try {
      const result = encoder.call(0x20002, 0);
      if (workerData.mode === 'fence-error') encoder.fence();
      parentPort.postMessage({ t: 'result', result, fallbacks: encoder.stats.fallbacks });
    } catch (error) { parentPort.postMessage({ t: 'result', error: error.message,
      fallbacks: encoder.stats.fallbacks }); }
  `, { eval: true, workerData: { mode, module: require.resolve('../lib/d3d-command-stream') } });
  let control, released = false, timer;
  try {
    return await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(mode + ' producer hung')), 4000);
      const finish = (error, result) => {
        clearTimeout(deadline); error ? reject(error) : resolve(result);
      };
      worker.on('error', error => finish(error));
      worker.on('message', message => {
        if (message.t === 'init') {
          control = new Int32Array(message.control);
          timer = setTimeout(() => {
            released = true;
            Atomics.store(control, mode === 'startup-error' ? CTRL.ERROR : CTRL.READY, 1);
            Atomics.notify(control, CTRL.READY);
          }, 40);
        } else if (message.t === 'legacy-fence') {
          Atomics.store(control, CTRL.ERROR, 1);
          Atomics.notify(control, CTRL.COMPLETED);
        } else if (message.t === 'result') {
          if (!released) return finish(new Error('Producer returned local fallback before READY'));
          finish(null, message);
        }
      });
    });
  } finally { clearTimeout(timer); await worker.terminate(); }
}
(async () => {
  const ready = await probe('ready');
  assert.strictEqual(ready.result, 1); assert.strictEqual(ready.fallbacks, 0);
  for (const mode of ['startup-error', 'fence-error']) {
    const failed = await probe(mode);
    assert.match(failed.error, /Shared render worker failed/);
    assert.strictEqual(failed.fallbacks, 0);
  }
  console.log('PASS shared legacy startup and fence waits fail without local fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
