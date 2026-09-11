'use strict';
const assert = require('assert');
const { CommandQueue, OPCODES: OP, VERSION, Encoder, WorkerConsumer, createCommandReceiver } = require('../lib/d3d-command-stream');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function pixelExecutor() {
  const resources = new Map(), output = new Uint8Array(4), gates = new Map();
  return { gates, execute(command) {
    const p = command.payload;
    if (command.opcode === OP.CLEAR && p && p.delayedColor !== undefined) {
      const gate = deferred(); gates.set(p.gate, gate);
      return { value: 0, completion: gate.promise.then(() => { output.fill(p.delayedColor); }) };
    }
    let value = 0;
    switch (command.opcode) {
      case OP.RESOURCE_CREATE: case OP.RESOURCE_UPDATE: resources.set(p.id, p.pixels); break;
      case OP.DRAW: output.set(resources.get(p.texture)); break;
      case OP.READBACK: case OP.PRESENT: value = output.slice(); break;
      case OP.RESOURCE_RELEASE: resources.delete(p.id); break;
      case OP.CLEAR: output.fill(0); break;
      default: throw new Error('unexpected pixel command');
    }
    if (p && p.gate) {
      const gate = deferred(); gates.set(p.gate, gate);
      return { value, completion: gate.promise };
    }
    return { value, complete: true };
  } };
}

if (!isMainThread) {
  const executor = pixelExecutor();
  const receive = createCommandReceiver(executor, message => parentPort.postMessage(message));
  parentPort.on('message', message => {
    if (message.t === 'test-release') executor.gates.get(message.gate).resolve();
    else receive(message);
  });
}

function workerMessage(worker, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('worker message deadline')); }, 10000);
    const listener = message => { if (predicate(message)) { cleanup(); resolve(message); } };
    function cleanup() { clearTimeout(timer); worker.off('message', listener); }
    worker.on('message', listener);
  });
}

async function workerTests() {
  const worker = new Worker(__filename), adapter = new WorkerConsumer(worker);
  try {
    const direct = new CommandQueue({ deviceId: 90, consumer: pixelExecutor() });
    const threaded = new CommandQueue({ deviceId: 90, consumer: adapter });
    const commands = [
      [OP.RESOURCE_CREATE, { id: 1, pixels: new Uint8Array([15, 25, 35, 255]) }],
      [OP.DRAW, { texture: 1 }], [OP.PRESENT], [OP.CLEAR], [OP.READBACK],
      [OP.RESOURCE_RELEASE, { id: 1 }],
    ];
    const directResults = [], workerResults = [];
    for (const [opcode, payload] of commands) {
      directResults.push(direct.submit(opcode, payload).value);
      workerResults.push(threaded.submit(opcode, payload).value);
    }
    assert.strictEqual(threaded.submitted, 6);
    assert.strictEqual(threaded.consumed, 0, 'postMessage is not consumption');
    assert.strictEqual(threaded.completed, 0);
    commands[0][1].pixels.fill(99);
    assert.deepStrictEqual(await Promise.all(workerResults), directResults);
    await threaded.fence();
    assert.deepStrictEqual([...directResults[2]], [15, 25, 35, 255], 'Present owns its completed snapshot');
    assert.deepStrictEqual([...directResults[4]], [0, 0, 0, 0]);
    assert.deepStrictEqual([threaded.submitted, threaded.consumed, threaded.completed], [6, 6, 6]);
    const consumed = workerMessage(worker, m => m.phase === 'consumed' && m.sequence === 7);
    const held = threaded.submit(OP.CLEAR, { gate: 'held' });
    threaded.submit(OP.READBACK);
    await consumed; await tick();
    assert.strictEqual(held.status, 'consumed');
    assert.strictEqual(threaded.poll(7).status, 'pending', 'consumed ack is not an execution fence');
    assert.strictEqual(adapter.receive({ t: 'd3d-result', deviceId: 90, generation: 999,
      sequence: 7, phase: 'completed', value: 55 }), false);
    assert.strictEqual(threaded.completed, 6);
    worker.postMessage({ t: 'test-release', gate: 'held' });
    await threaded.fence();
    assert.strictEqual(threaded.completed, 8);

    // A fresh generation shares the same worker only after full drain.
    threaded.reset();
    threaded.submit(OP.CLEAR); await threaded.fence();
    assert.strictEqual(threaded.generation, 2);
    assert.strictEqual(threaded.completed, 1);
  } finally { await adapter.cancel(); }

  const cancelWorker = new Worker(__filename), cancelAdapter = new WorkerConsumer(cancelWorker);
  let releases = 0;
  const queue = new CommandQueue({ deviceId: 91, consumer: cancelAdapter,
    retainResource: ref => ref, releaseResource() { releases++; } });
  try {
    const consumed = workerMessage(cancelWorker, m => m.phase === 'consumed');
    queue.submit(OP.CLEAR, { gate: 'cancel' }, { resources: [{ id: 1, version: 1 }] });
    await consumed; await tick();
    const fence = queue.fence();
    queue.cancel();
    assert.strictEqual(releases, 0, 'sending cancellation cannot free worker-owned data');
    await assert.rejects(fence, e => e.code === 'CANCELLED');
    await cancelAdapter.cancel(); await tick();
    assert.strictEqual(releases, 1, 'confirmed worker termination retires retained lease');
    assert.strictEqual(queue.inflight, 0);
  } finally { await cancelAdapter.cancel(); }
}

async function delayedEffectOrderTests() {
  // A software executor may yield BEFORE touching the output, unlike GL issue.
  // Sorting completion acknowledgements cannot repair a readback that overtook
  // that write. Default direct and worker execution must preserve actual effects.
  const executor = pixelExecutor(), queue = new CommandQueue({ deviceId: 100, consumer: executor });
  queue.submit(OP.CLEAR, { gate: 'direct-write', delayedColor: 42 });
  const read = queue.submit(OP.READBACK);
  executor.gates.get('direct-write').resolve();
  await queue.fence();
  const directPixels = [...read.value];

  const worker = new Worker(__filename), adapter = new WorkerConsumer(worker);
  try {
    const threaded = new CommandQueue({ deviceId: 101, consumer: adapter });
    const consumed = workerMessage(worker, m => m.phase === 'consumed' && m.sequence === 1);
    threaded.submit(OP.CLEAR, { gate: 'worker-write', delayedColor: 63 });
    const workerRead = threaded.submit(OP.READBACK);
    await consumed;
    worker.postMessage({ t: 'test-release', gate: 'worker-write' });
    await threaded.fence();
    assert.deepStrictEqual([...(await workerRead.value)], [63, 63, 63, 63], 'worker readback must not overtake deferred write');
  } finally { await adapter.cancel(); }
  assert.deepStrictEqual(directPixels, [42, 42, 42, 42], 'direct readback must not overtake deferred write');
}

async function main() {
  await delayedEffectOrderTests();
  assert.strictEqual(typeof Encoder, 'function');
  // Direct execution is real data movement: update then draw samples upload,
  // readback copies the result, and release removes the executor resource.
  const textures = new Map(), output = new Uint8Array(4), seen = [];
  const direct = new CommandQueue({ deviceId: 7, consumer: { execute(command) {
    assert.strictEqual(command.version, VERSION);
    assert.strictEqual(command.deviceId, 7);
    seen.push(command.opcode);
    const p = command.payload;
    switch (command.opcode) {
      case OP.RESOURCE_CREATE: textures.set(p.id, p.pixels); break;
      case OP.DRAW: output.set(textures.get(p.texture)); break;
      case OP.READBACK: return { value: output.slice(), complete: true };
      case OP.RESOURCE_RELEASE: textures.delete(p.id); break;
      default: throw new Error('unexpected opcode');
    }
    return { value: 0, complete: true };
  } } });
  const upload = new Uint8Array([1, 2, 3, 255]);
  direct.submit(OP.RESOURCE_CREATE, { id: 9, pixels: upload });
  upload.fill(77);
  direct.submit(OP.DRAW, { texture: 9 });
  const readback = direct.submit(OP.READBACK);
  direct.submit(OP.RESOURCE_RELEASE, { id: 9 });
  assert.deepStrictEqual([...readback.value], [1, 2, 3, 255]);
  assert.strictEqual(readback.status, 'completed');
  assert.deepStrictEqual(seen, [OP.RESOURCE_CREATE, OP.DRAW, OP.READBACK, OP.RESOURCE_RELEASE]);
  assert.strictEqual(textures.size, 0);
  await direct.fence();
  assert.strictEqual(direct.completed, 4);
  assert.strictEqual(direct.bytes, 0);

  const pending = [], commands = [], retained = [], released = [];
  const asyncQueue = new CommandQueue({ deviceId: 8, maxCommands: 2, capacityBytes: 4096,
    retainResource(ref) { retained.push(ref); return ref; },
    releaseResource(ref) { released.push(ref); },
    consumer: { ordered: true, execute(command) {
      commands.push(command);
      const gate = deferred(); pending.push(gate);
      return { value: 0, completion: gate.promise };
    } },
  });
  const sharedPixels = new Uint8Array([5, 6, 7, 8]);
  const payload = { constants: new Float32Array([1, 2, 3, 4]), state: { blend: true },
    pixels: sharedPixels, levels: [{ pixels: sharedPixels }] };
  const refs = [{ id: 123, version: 2 }];
  const first = asyncQueue.submit(OP.DRAW, payload, { resources: refs });
  payload.constants.fill(9); payload.state.blend = false; refs[0].version = 3;
  asyncQueue.submit(OP.PRESENT, { frame: 1 });
  assert.deepStrictEqual([...commands[0].payload.constants], [1, 2, 3, 4]);
  assert.strictEqual(commands[0].payload.state.blend, true);
  assert.strictEqual(commands[0].payload.pixels, commands[0].payload.levels[0].pixels);
  assert.notStrictEqual(commands[0].payload.pixels.buffer, sharedPixels.buffer);
  sharedPixels.fill(55);
  assert.deepStrictEqual([...commands[0].payload.pixels], [5, 6, 7, 8]);
  assert.strictEqual(commands[0].resources[0].version, 2);
  assert(Object.isFrozen(commands[0].payload.state));
  assert.deepStrictEqual([asyncQueue.submitted, asyncQueue.consumed, asyncQueue.completed], [2, 2, 0]);
  assert.strictEqual(first.status, 'consumed');
  assert.strictEqual(asyncQueue.poll().status, 'pending');
  assert.throws(() => asyncQueue.submit(OP.CLEAR), e => e.code === 'FULL');
  let room = false, done = false;
  const roomPromise = asyncQueue.waitForSpace().then(() => { room = true; });
  const fencePromise = asyncQueue.fence().then(() => { done = true; });
  // A later fence callback cannot make earlier work appear complete, and the
  // bounded reorder window cannot grow while the first command remains pending.
  pending[1].resolve(); await tick();
  assert.strictEqual(asyncQueue.completed, 0);
  assert.strictEqual(done, false); assert.strictEqual(room, false);
  assert.strictEqual(released.length, 0);
  assert.throws(() => asyncQueue.submit(OP.CLEAR), e => e.code === 'FULL');
  pending[0].resolve(); await Promise.all([roomPromise, fencePromise]);
  assert.strictEqual(asyncQueue.completed, 2);
  assert.strictEqual(released.length, 1);
  assert.strictEqual(released[0], retained[0]);
  assert.strictEqual(asyncQueue.bytes, 0);
  // Reuse bounded slots repeatedly without replaying retired work.
  for (let i = 0; i < 20; i++) {
    asyncQueue.submit(OP.CLEAR); pending[pending.length - 1].resolve(); await asyncQueue.fence();
  }
  assert.strictEqual(asyncQueue.completed, 22);

  // Invalid and oversized inputs never reach the consumer or consume sequence.
  const before = asyncQueue.submitted;
  assert.throws(() => asyncQueue.submit(OP.DRAW, { bytes: new Uint8Array(5000) }), e => e.code === 'FULL');
  assert.throws(() => asyncQueue.submit(OP.DRAW, { get state() { throw new Error('must not call getter'); } }), e => e.code === 'INVALID');
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => asyncQueue.submit(OP.DRAW, cycle), e => e.code === 'INVALID');
  assert.throws(() => asyncQueue.submit(999), e => e.code === 'INVALID');
  assert.throws(() => asyncQueue.submit(OP.DRAW, {}, { resources: [{ id: 1, version: -1 }] }), e => e.code === 'INVALID');
  assert.strictEqual(asyncQueue.submitted, before);

  const byteGate = deferred();
  const byteQueue = new CommandQueue({ deviceId: 2, capacityBytes: 512,
    consumer: { execute() { return { completion: byteGate.promise }; } } });
  byteQueue.submit(OP.RESOURCE_UPDATE, new Uint8Array(256));
  assert.throws(() => byteQueue.submit(OP.RESOURCE_UPDATE, new Uint8Array(256)), e => e.code === 'FULL');
  let byteRoom = false;
  const byteWait = byteQueue.waitForSpace(400).then(() => { byteRoom = true; });
  await tick(); assert.strictEqual(byteRoom, false);
  byteGate.resolve(); await byteWait;
  assert.strictEqual(byteQueue.bytes, 0);

  let rolledBack = 0;
  const retainFailure = new CommandQueue({ deviceId: 2,
    retainResource(ref) { if (ref.id === 2) throw new Error('expired version'); return ref; },
    releaseResource() { rolledBack++; },
    consumer: { execute() { throw new Error('must not execute failed retention'); } },
  });
  assert.throws(() => retainFailure.submit(OP.DRAW, null,
    { resources: [{ id: 1, version: 1 }, { id: 2, version: 1 }] }), /expired version/);
  assert.strictEqual(rolledBack, 1);
  assert.strictEqual(retainFailure.submitted, 0);
  assert.strictEqual(retainFailure.bytes, 0);
  const serialGate = deferred();
  let serialIssued = 0, serialReleased = 0;
  const serialCancel = new CommandQueue({ deviceId: 3,
    retainResource: ref => ref, releaseResource() { serialReleased++; },
    consumer: { execute() { serialIssued++; return { completion: serialGate.promise }; } },
  });
  serialCancel.submit(OP.DRAW, null, { resources: [{ id: 1, version: 1 }] });
  serialCancel.submit(OP.DRAW, null, { resources: [{ id: 2, version: 1 }] });
  assert.strictEqual(serialIssued, 1);
  serialCancel.cancel();
  assert.strictEqual(serialReleased, 1, 'unconsumed command needs no executor acknowledgement');
  assert.strictEqual(serialCancel.inflight, 1);
  serialGate.resolve(); await tick();
  assert.strictEqual(serialReleased, 2);
  assert.strictEqual(serialIssued, 1, 'cancelled queued draw must never execute');

  // Device loss wakes waiters immediately, but no lease is released while the
  // executor still owns it. Reset cannot recycle its generation prematurely.
  asyncQueue.submit(OP.DRAW, {}, { resources: [{ id: 4, version: 7 }] });
  const lostFence = asyncQueue.fence();
  asyncQueue.cancel(new Error('context lost'));
  await assert.rejects(lostFence, /context lost/);
  assert.strictEqual(released.length, 1);
  assert.throws(() => asyncQueue.reset(), e => e.code === 'BUSY');
  assert.throws(() => asyncQueue.submit(OP.CLEAR), /context lost/);
  pending[pending.length - 1].resolve(); await tick();
  assert.strictEqual(released.length, 2);
  const oldGeneration = asyncQueue.generation;
  asyncQueue.reset({ execute() { return { complete: true }; } });
  assert.strictEqual(asyncQueue.poll(0, oldGeneration).status, 'stale');
  await assert.rejects(asyncQueue.fence(0, oldGeneration), e => e.code === 'STALE');
  assert.throws(() => asyncQueue.submit(OP.CLEAR, null, { generation: oldGeneration }), e => e.code === 'STALE');
  asyncQueue.submit(OP.CLEAR);
  assert.strictEqual(asyncQueue.completed, 1);

  const oldWork = deferred(), cancelAck = deferred();
  let cancelReleases = 0;
  const cancelled = new CommandQueue({ deviceId: 1,
    retainResource: ref => ref, releaseResource() { cancelReleases++; },
    consumer: { execute() { return { completion: oldWork.promise }; }, cancel() { return cancelAck.promise; } },
  });
  cancelled.submit(OP.DRAW, {}, { resources: [{ id: 1, version: 1 }] });
  cancelled.cancel();
  assert.strictEqual(cancelReleases, 0);
  cancelAck.resolve(); await tick();
  assert.strictEqual(cancelReleases, 1);
  cancelled.reset({ execute() { return { complete: true }; } });
  cancelled.submit(OP.CLEAR);
  oldWork.resolve(); await tick();
  assert.strictEqual(cancelled.completed, 1);
  assert.strictEqual(cancelReleases, 1); // stale callback cannot release twice

  // An executor error is observable and forbids further commands, while earlier
  // in-flight data stays retained until its own retirement.
  const failure = deferred();
  const failing = new CommandQueue({ deviceId: 1, consumer: { execute() { return { completion: failure.promise }; } } });
  failing.submit(OP.DRAW);
  const failedFence = failing.fence();
  failure.reject(new Error('raster fault'));
  await assert.rejects(failedFence, /raster fault/);
  assert.strictEqual(failing.completed, 0);
  assert.strictEqual(failing.inflight, 0);
  assert.throws(() => failing.submit(OP.CLEAR), /raster fault/);
  const firstWork = deferred(), secondWork = deferred();
  let issued = 0, retiredLeases = 0;
  const orderedFault = new CommandQueue({ deviceId: 2,
    retainResource: ref => ref, releaseResource() { retiredLeases++; },
    consumer: { ordered: true, execute() { return { completion: (++issued === 1 ? firstWork : secondWork).promise }; } },
  });
  orderedFault.submit(OP.DRAW, null, { resources: [{ id: 3, version: 1 }] });
  orderedFault.submit(OP.DRAW, null, { resources: [{ id: 4, version: 1 }] });
  const orderedWait = orderedFault.fence();
  secondWork.reject(new Error('later draw failed'));
  await assert.rejects(orderedWait, /later draw failed/);
  assert.strictEqual(retiredLeases, 1);
  assert.strictEqual(orderedFault.inflight, 1);
  firstWork.resolve(); await tick();
  assert.strictEqual(retiredLeases, 2);
  assert.strictEqual(orderedFault.completed, 0);
  const liar = new CommandQueue({ deviceId: 1, consumer: { execute() { return { value: 0 }; } } });
  assert.throws(() => liar.submit(OP.DRAW), e => e.code === 'PROTOCOL');
  assert.strictEqual(liar.completed, 0);
  await workerTests();
  console.log('PASS neutral D3D command stream: direct effects, snapshots, ordered completion, bounds, leases, cancellation, generations and faults');
}
if (isMainThread) main().catch(error => { console.error(error); process.exitCode = 1; });
