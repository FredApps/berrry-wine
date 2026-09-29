'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WorkerLink } = require('../lib/guest-thread-host');
const sandbox = { console, URLSearchParams, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8') +
  '\n;globalThis.WineAssembly = WineAssembly;', sandbox);
const deferred = () => {
  let resolve; const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

(async () => {
  const portReady = deferred(), events = [];
  const endpoint = { ready: Promise.resolve(), addEventListener() {},
    postMessage(message) { events.push(message.t); },
    terminate() { events.push('close'); return Promise.resolve(); } };
  const link = new WorkerLink({ createRenderEndpoint: () => portReady.promise });
  link.worker = { postMessage() {}, terminate() { events.push('guest-stop'); } };
  link._forwardRenderLegacy({ t: 'init', control: new SharedArrayBuffer(64) });
  await Promise.resolve(); // Endpoint creation is in flight when the producer exits.
  link._forwardRenderLegacy({ t: 'batch' });
  const retired = link.stop();
  assert.strictEqual(link.stop(), retired, 'endpoint retirement is idempotent');
  portReady.resolve(endpoint);
  await retired;
  assert.deepStrictEqual(events, ['guest-stop', 'init', 'batch', 'close'],
    'already accepted batches must be posted before retiring only this endpoint');

  const logs = [], marker = {}, wine = Object.create(sandbox.WineAssembly.prototype);
  let stopped = 0;
  wine.memory = marker;
  wine._renderWorkerPreparationTimeoutMs = 10;
  wine.hostCtx = { closeGlide: () => new Promise(() => {}) };
  wine.logToUI = text => logs.push(text);
  wine._renderWorkerManager = { async stop() {
    stopped++;
    throw new Error('render worker shutdown timed out; heap not reclaimed');
  } };
  wine._renderWorkerManagerReady = Promise.resolve(wine._renderWorkerManager);
  wine._releaseGuestMemory();
  await wine._renderWorkerRetirement;
  assert.strictEqual(stopped, 1, 'unresponsive endpoint cannot prevent manager shutdown');
  assert.strictEqual(wine.memory, marker, 'failed retirement must retain live allocator memory');
  assert.notStrictEqual(wine._renderWorkerRetired, true);
  assert(logs.some(text => /endpoint drain timed out/.test(text)));
  assert.match(wine._renderWorkerRetirementError.message, /heap not reclaimed/);
  console.log('PASS producer endpoint drain and bounded process retirement');
})().catch(error => { console.error(error); process.exitCode = 1; });
