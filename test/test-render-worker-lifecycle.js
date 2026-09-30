'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WorkerLink, GuestThreadHost } = require('../lib/guest-thread-host');
const sandbox = { console, URLSearchParams, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8') +
  '\n;globalThis.WineAssembly = WineAssembly;', sandbox);
const deferred = () => {
  let resolve; const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

(async () => {
  const original = Object.fromEntries(['start', 'initGuestThread', 'callExport'].map(k => [k, WorkerLink.prototype[k]]));
  const initializing = deferred(), initGate = deferred(), settings = [];
  try {
    WorkerLink.prototype.start = async function () { this.enabled = this.d3dimLazySync; };
    WorkerLink.prototype.initGuestThread = async function () {
      if (this.slot === 1) { initializing.resolve(); await initGate.promise; }
      return {};
    };
    WorkerLink.prototype.callExport = async function (name, value) {
      assert.equal(name, 'd3dim_lazy_enable'); this.enabled = !!value; settings.push([this.slot, value]);
    };
    const host = new GuestThreadHost({ sharedRenderWorker: true, d3dimGpu: true });
    assert.equal(host.d3dimLazySync, true);
    const spawning = host.spawnThread({ tid: 1 });
    await initializing.promise;
    await host.setLazySync(false);
    initGate.resolve();
    const first = await spawning;
    assert.equal(first.enabled, false, 'opt-out during spawn is applied before the thread can run');
    const second = await host.spawnThread({ tid: 2 });
    assert.equal(second.enabled, false, 'future threads inherit opt-out');
    await host.setLazySync(true);
    assert(first.enabled && second.enabled, 'live switch reaches every existing guest thread');
    host.d3dimGpu = false;
    await host.setLazySync(true);
    assert(!first.enabled && !second.enabled, 'software remains eager');
    host.d3dimGpu = true; host.sharedRenderWorker = false;
    await host.setLazySync(true);
    assert(!first.enabled && !second.enabled, 'private executors remain eager');
  } finally { Object.assign(WorkerLink.prototype, original); }
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
