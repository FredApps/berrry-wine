// Ordered Direct3D immediate-mode draw transport for the experimental render
// Worker. The producer is the guest-main Worker; the consumer owns a second
// Wasm instance over the same shared WebAssembly.Memory.
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.D3DCommandStream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DRAW_OPCODE = 0x20000;
  const FENCE_OPCODE = 0x20001;
  const STATE_BYTES = 4096;
  const HEADER_BYTES = 32;
  const DEFAULT_BYTES = 2 * 1024 * 1024;
  const DEFAULT_BUFFERS = 3;
  const CTRL = {
    READY: 0, COMPLETED: 1, ERROR: 2, SUBMITTED: 3,
    BATCHES: 4, COMMANDS: 5, REPLAY_US: 6,
  };
  const align4 = value => (value + 3) & ~3;
  const nowMs = () => (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  const versionedWorkerUrl = (source, version) => {
    const separator = source.includes('?') ? '&' : '?';
    return source + separator + 'v=' + encodeURIComponent(version || 'dev');
  };

  class Encoder {
    constructor(options) {
      options = options || {};
      this.memory = options.memory;
      this.module = options.module;
      this.sigs = options.sigs || {};
      this.guestToWasm = options.guestToWasm;
      this.getImageBase = options.getImageBase;
      this.capacity = Math.max(STATE_BYTES + HEADER_BYTES + 32,
        options.capacity || DEFAULT_BYTES);
      this.controlBuffer = new SharedArrayBuffer(64);
      this.control = new Int32Array(this.controlBuffer);
      this.buffers = Array.from({ length: options.bufferCount || DEFAULT_BUFFERS }, () => {
        const buffer = new SharedArrayBuffer(this.capacity);
        return {
          buffer, view: new DataView(buffer), bytes: new Uint8Array(buffer),
          used: 0, commands: 0, seq: 0,
        };
      });
      this._memoryBuffer = null;
      this._memoryView = null;
      this._memoryBytes = null;
      this.current = 0;
      this.lastSubmitted = 0;
      this.stats = {
        queued: 0, submissions: 0, fences: 0, waits: 0, fallbacks: 0,
        bytes: 0, waitMs: 0, maxBatchBytes: 0,
      };
      this.worker = options.workerFactory
        ? options.workerFactory()
        : new Worker(options.workerUrl || versionedWorkerUrl(
          'd3d-render-worker.js', options.sourceVersion || (root && root.WINE_SOURCE_VERSION)));
      this.worker.onerror = () => {
        Atomics.store(this.control, CTRL.ERROR, 1);
        Atomics.notify(this.control, CTRL.COMPLETED);
      };
      this.worker.onmessage = event => {
        const message = event && event.data ? event.data : event;
        if (message && message.t === 'error') {
          Atomics.store(this.control, CTRL.ERROR, 1);
          Atomics.notify(this.control, CTRL.COMPLETED);
        }
      };
      this.worker.postMessage({
        t: 'init', module: this.module, memory: this.memory, sigs: this.sigs,
        control: this.controlBuffer, buffers: this.buffers.map(item => item.buffer),
      });
    }

    ready() {
      return Atomics.load(this.control, CTRL.READY) === 1
        && Atomics.load(this.control, CTRL.ERROR) === 0;
    }

    _refreshMemoryViews() {
      const buffer = this.memory.buffer;
      if (buffer !== this._memoryBuffer) {
        this._memoryBuffer = buffer;
        this._memoryView = new DataView(buffer);
        this._memoryBytes = new Uint8Array(buffer);
      }
      return buffer;
    }

    _waitFor(seq) {
      seq >>>= 0;
      const started = nowMs();
      let waited = false;
      while ((Atomics.load(this.control, CTRL.COMPLETED) >>> 0) < seq) {
        if (Atomics.load(this.control, CTRL.ERROR)) return false;
        const seen = Atomics.load(this.control, CTRL.COMPLETED);
        this.stats.waits++;
        waited = true;
        Atomics.wait(this.control, CTRL.COMPLETED, seen, 1000);
      }
      if (waited) this.stats.waitMs += nowMs() - started;
      return !Atomics.load(this.control, CTRL.ERROR);
    }

    _acquire() {
      const item = this.buffers[this.current];
      if (item.seq && (Atomics.load(this.control, CTRL.COMPLETED) >>> 0) < item.seq) {
        if (!this._waitFor(item.seq)) return null;
      }
      item.seq = 0;
      item.used = 0;
      item.commands = 0;
      return item;
    }

    _submit() {
      const item = this.buffers[this.current];
      // A rotated-to slot keeps its old bytes until _acquire resets it. Its
      // non-zero sequence means those bytes were already published; an idle
      // fence must wait for lastSubmitted, never replay this stale batch.
      if (item.seq) return this.lastSubmitted;
      if (!item.used) return this.lastSubmitted;
      const seq = (Atomics.add(this.control, CTRL.SUBMITTED, 1) + 1) >>> 0;
      item.seq = seq;
      this.lastSubmitted = seq;
      this.stats.submissions++;
      if (item.used > this.stats.maxBatchBytes) this.stats.maxBatchBytes = item.used;
      this.worker.postMessage({
        t: 'batch', index: this.current, bytes: item.used,
        commands: item.commands, seq,
        imageBase: this.getImageBase() >>> 0,
      });
      this.current = (this.current + 1) % this.buffers.length;
      return seq;
    }

    enqueue(descriptorWa) {
      if (!this.ready()) { this.stats.fallbacks++; return 0; }
      const memory = this._refreshMemoryViews();
      descriptorWa >>>= 0;
      if (descriptorWa + 24 > memory.byteLength) { this.stats.fallbacks++; return 0; }
      const descriptor = this._memoryView;
      const thisGuest = descriptor.getUint32(descriptorWa, true);
      const primitive = descriptor.getUint32(descriptorWa + 4, true);
      const vertexType = descriptor.getUint32(descriptorWa + 8, true);
      const verticesGuest = descriptor.getUint32(descriptorWa + 12, true);
      const count = descriptor.getUint32(descriptorWa + 16, true);
      const stateGuest = descriptor.getUint32(descriptorWa + 20, true);
      const vertexBytes = Number(count) * 32;
      const recordBytes = align4(HEADER_BYTES + STATE_BYTES + vertexBytes);
      if (!thisGuest || !verticesGuest || !stateGuest || !count || vertexType < 1
          || vertexType > 3 || !Number.isSafeInteger(vertexBytes)
          || vertexBytes > 0x400000 || recordBytes > this.capacity) {
        this.stats.fallbacks++;
        return 0;
      }

      let item = this.buffers[this.current];
      if (item.used + recordBytes > this.capacity) {
        this._submit();
        item = this._acquire();
        if (!item) { this.stats.fallbacks++; return 0; }
      } else if (item.seq) {
        item = this._acquire();
        if (!item) { this.stats.fallbacks++; return 0; }
      }

      const stateWa = this.guestToWasm(stateGuest) >>> 0;
      const verticesWa = this.guestToWasm(verticesGuest) >>> 0;
      if (stateWa + STATE_BYTES > memory.byteLength
          || verticesWa + vertexBytes > memory.byteLength) {
        this.stats.fallbacks++;
        return 0;
      }
      const start = item.used;
      const view = item.view;
      view.setUint32(start, recordBytes, true);
      view.setUint32(start + 4, thisGuest, true);
      view.setUint32(start + 8, primitive, true);
      view.setUint32(start + 12, vertexType, true);
      view.setUint32(start + 16, count, true);
      view.setUint32(start + 20, STATE_BYTES, true);
      view.setUint32(start + 24, vertexBytes, true);
      view.setUint32(start + 28, 0, true);
      const bytes = item.bytes;
      bytes.set(this._memoryBytes.subarray(stateWa, stateWa + STATE_BYTES), start + HEADER_BYTES);
      bytes.set(this._memoryBytes.subarray(verticesWa, verticesWa + vertexBytes),
        start + HEADER_BYTES + STATE_BYTES);
      item.used += recordBytes;
      item.commands++;
      this.stats.queued++;
      this.stats.bytes += STATE_BYTES + vertexBytes;
      // Start the consumer before the frame fence rather than accumulating a
      // whole frame and serializing simulation after rasterization.
      if (item.used >= this.capacity * 3 / 4) this._submit();
      return 1;
    }

    fence() {
      if (!this.ready()) return 0;
      this.stats.fences++;
      const target = this._submit();
      return target ? (this._waitFor(target) ? 1 : 0) : 1;
    }

    call(opcode, descriptorWa) {
      opcode |= 0;
      if (opcode === DRAW_OPCODE) return this.enqueue(descriptorWa);
      if (opcode === FENCE_OPCODE) return this.fence();
      return -1;
    }

    snapshot() {
      return Object.assign({}, this.stats, {
        replayBatches: Atomics.load(this.control, CTRL.BATCHES) >>> 0,
        replayCommands: Atomics.load(this.control, CTRL.COMMANDS) >>> 0,
        replayMs: (Atomics.load(this.control, CTRL.REPLAY_US) >>> 0) / 1000,
        ready: this.ready(),
      });
    }

    stop() {
      try { this.fence(); } catch (_) {}
      if (this.worker) this.worker.terminate();
      this.worker = null;
    }
  }

  // Version 1 neutral descriptors coexist with the legacy binary Encoder above.
  // The queue owns transport copies, not guest objects or their COM refcounts.
  const VERSION = 1;
  const OPCODES = Object.freeze({
    RESOURCE_CREATE: 1, RESOURCE_UPDATE: 2, RESOURCE_RELEASE: 3, BIND: 4,
    DRAW: 5, CLEAR: 6, COPY: 7, QUERY_BEGIN: 8, QUERY_END: 9,
    READBACK: 10, FENCE: 11, PRESENT: 12,
  });
  const neutralOpcodes = new Set(Object.values(OPCODES));
  class QueueError extends Error {
    constructor(code, message) { super(message); this.name = 'QueueError'; this.code = code; }
  }
  function positiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new QueueError('INVALID', `${name} must be a positive safe integer`);
    return value;
  }

  // A private copy of every upload is made before publication. Typed-array
  // elements cannot be frozen by JavaScript: only the selected executor sees
  // these owned copies and must treat them as read-only. No caller alias escapes.
  function copyPayload(value, budget) {
    const ancestors = new Set();
    const copies = new WeakMap();
    let bytes = 0;
    function charge(n) {
      bytes += n;
      if (bytes > budget) throw new QueueError('FULL', 'render payload exceeds available byte budget');
    }
    function copy(v) {
      if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number') {
        charge(8); return v;
      }
      if (typeof v === 'string') { charge(8 + v.length * 2); return v; }
      if (typeof v !== 'object') throw new QueueError('INVALID', 'render payload must contain only data');
      if (ancestors.has(v)) throw new QueueError('INVALID', 'cyclic render payload');
      if (copies.has(v)) return copies.get(v);
      if (ArrayBuffer.isView(v)) {
        charge(16 + v.byteLength);
        const buffer = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer;
        const result = v instanceof DataView ? new DataView(buffer) : new v.constructor(buffer);
        copies.set(v, result); return result;
      }
      if (v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer)) {
        charge(16 + v.byteLength);
        const result = new Uint8Array(v).slice().buffer;
        copies.set(v, result); return result;
      }
      const proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype && proto !== null)
        throw new QueueError('INVALID', 'render payload contains a host object');
      ancestors.add(v);
      charge(16);
      const result = Array.isArray(v) ? [] : {};
      for (const key of Object.keys(v)) {
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value'))
          throw new QueueError('INVALID', 'render payload accessors are not allowed');
        charge(8 + key.length * 2);
        Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true });
      }
      ancestors.delete(v);
      copies.set(v, result);
      return Object.freeze(result);
    }
    return { value: copy(value), bytes };
  }

  class CommandQueue {
    constructor(options = {}) {
      this.deviceId = positiveInteger(options.deviceId, 'deviceId');
      this.generation = positiveInteger(options.generation === undefined ? 1 : options.generation, 'generation');
      this.capacityBytes = positiveInteger(options.capacityBytes === undefined ? DEFAULT_BYTES : options.capacityBytes, 'capacityBytes');
      this.maxCommands = positiveInteger(options.maxCommands === undefined ? 1024 : options.maxCommands, 'maxCommands');
      if (!options.consumer || typeof options.consumer.execute !== 'function')
        throw new QueueError('INVALID', 'one render consumer is required');
      if (!!options.retainResource !== !!options.releaseResource)
        throw new QueueError('INVALID', 'resource retain and release hooks must be paired');
      this.consumer = options.consumer;
      this._retain = options.retainResource;
      this._release = options.releaseResource;
      this.submitted = this.consumed = this.completed = 0;
      this.bytes = this.inflight = 0;
      this.error = null;
      this._entries = new Map();
      this._waiters = [];
      this._spaceWaiters = [];
      this._publishing = false;
      this._waiting = [];
      this._active = null;
      this._pumping = false;
    }

    submit(opcode, payload = null, options = {}) {
      if (this.error) throw this.error;
      if (this._publishing) throw new QueueError('REENTRANT', 'render publication cannot be reentered');
      if (!neutralOpcodes.has(opcode)) throw new QueueError('INVALID', 'unknown render opcode');
      if (options.generation !== undefined && options.generation !== this.generation)
        throw new QueueError('STALE', 'render command generation is stale');
      if (this._entries.size >= this.maxCommands) throw new QueueError('FULL', 'render command capacity reached');
      if (this.submitted === Number.MAX_SAFE_INTEGER) throw new QueueError('OVERFLOW', 'drain and reset render sequence');
      const resources = options.resources || [];
      if (!Array.isArray(resources)) throw new QueueError('INVALID', 'resource versions must be an array');
      for (const ref of resources) {
        if (!ref || !Number.isSafeInteger(ref.id) || ref.id <= 0
            || !Number.isSafeInteger(ref.version) || ref.version < 0)
          throw new QueueError('INVALID', 'invalid resource version reference');
      }
      const copy = copyPayload({ payload, resources }, this.capacityBytes - this.bytes - HEADER_BYTES);
      const leases = [];
      this._publishing = true;
      try {
        if (this._retain) for (const ref of copy.value.resources) leases.push(this._retain(ref));
      } catch (error) {
        for (const lease of leases.reverse()) this._release(lease);
        throw error;
      } finally { this._publishing = false; }
      const sequence = ++this.submitted;
      const command = Object.freeze({ version: VERSION, deviceId: this.deviceId,
        generation: this.generation, sequence, opcode,
        payload: copy.value.payload, resources: copy.value.resources,
        byteLength: copy.bytes + HEADER_BYTES });
      const entry = { command, sequence, leases, status: 'submitted', value: undefined, retired: false, consumed: false };
      const receipt = Object.freeze({ sequence, generation: this.generation,
        get value() { return entry.value; }, get status() { return entry.status; } });
      this._entries.set(sequence, entry);
      this.bytes += command.byteLength;
      this.inflight++;
      this._waiting.push(entry);
      this._pump(true);
      return receipt;
    }

    _pump(rethrow = false) {
      if (this._pumping || this._publishing || this.error) return;
      this._pumping = true;
      try {
        while (!this._active && !this.error && this._waiting.length) {
          const entry = this._waiting.shift();
          try { this._execute(entry); } catch (error) { if (rethrow) throw error; }
        }
      } finally { this._pumping = false; }
    }

    _execute(entry) {
      // Default executors may yield before effects are applied (software).
      // Pipeline only an explicit ordered engine: execute() then promises that
      // all effects have been synchronously inserted into that engine's order.
      if (this.consumer.ordered !== true) this._active = entry;
      // Taking the descriptor is consumption, not GPU completion. The executor
      // must explicitly attest synchronous retirement or provide its real fence.
      this._publishing = true;
      try {
        const result = this.consumer.execute(entry.command);
        if (!result || (result.complete !== true && !(result.completion && typeof result.completion.then === 'function')))
          throw new QueueError('PROTOCOL', 'executor must report actual completion');
        entry.value = result.value;
        if (result.consumed && typeof result.consumed.then === 'function')
          Promise.resolve(result.consumed).then(() => this._markConsumed(entry), () => {});
        else this._markConsumed(entry);
        if (result.complete === true) this._retire(entry, null);
        else Promise.resolve(result.completion).then(
          () => this._retire(entry, null), error => this._retire(entry, error || new QueueError('EXECUTION', 'render execution failed')));
      } catch (error) {
        // A throwing consumer must have stopped using this command. Deferred
        // work instead returns a completion promise whose settlement retires it.
        this._markConsumed(entry);
        this._retire(entry, error);
        throw error;
      } finally { this._publishing = false; }
    }

    _markConsumed(entry) {
      if (entry.retired) return;
      entry.consumed = true;
      entry.status = 'consumed';
      while (this._entries.has(this.consumed + 1)
          && this._entries.get(this.consumed + 1).consumed) this.consumed++;
    }

    _retire(entry, error) {
      if (entry.retired) return; // cancellation acknowledgement / late fence
      if (!error && !entry.consumed) error = new QueueError('PROTOCOL', 'completion before consumption');
      entry.retired = true;
      entry.status = error ? 'failed' : this.error ? 'cancelled' : 'completed';
      if (error && !this.error) this.error = error;
      this.bytes -= entry.command.byteLength;
      entry.command = null; // receipts must not keep retired upload storage alive
      this.inflight--;
      if (this._active === entry) this._active = null;
      for (const lease of entry.leases) {
        try { this._release(lease); } catch (failure) { if (!this.error) this.error = failure; }
      }
      entry.leases.length = 0;
      // Completed is a contiguous successful prefix, never just the newest
      // callback or the last command sent to the GL driver.
      while (this._entries.has(this.completed + 1)
          && this._entries.get(this.completed + 1).status === 'completed')
        this._entries.delete(++this.completed);
      this._wake();
      if (this.error) this._cancelWaiting();
      else this._pump();
    }

    _cancelWaiting() {
      // These descriptors never reached the executor; no worker acknowledgement
      // is necessary to release their private snapshots and version leases.
      const waiting = this._waiting.splice(0);
      for (const entry of waiting) this._retire(entry, this.error);
    }

    poll(sequence = this.submitted, generation = this.generation) {
      if (generation !== this.generation) return { status: 'stale' };
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.submitted)
        throw new QueueError('INVALID', 'invalid render fence sequence');
      if (sequence <= this.completed) return { status: 'completed' };
      if (this.error) return { status: 'failed', error: this.error };
      return { status: 'pending' };
    }

    fence(sequence = this.submitted, generation = this.generation) {
      const state = this.poll(sequence, generation);
      if (state.status === 'completed') return Promise.resolve();
      if (state.status !== 'pending') return Promise.reject(state.error || new QueueError('STALE', 'render fence generation is stale'));
      return new Promise((resolve, reject) => this._waiters.push({ sequence, resolve, reject }));
    }

    // Wait for room, then retry submit: reservation is deliberately not implied.
    // This yields on the browser main thread and never calls Atomics.wait there.
    waitForSpace(bytes = HEADER_BYTES) {
      positiveInteger(bytes, 'bytes');
      if (bytes > this.capacityBytes) return Promise.reject(new QueueError('FULL', 'command exceeds queue capacity'));
      if (this.error) return Promise.reject(this.error);
      if (this.bytes + bytes <= this.capacityBytes && this._entries.size < this.maxCommands) return Promise.resolve();
      return new Promise((resolve, reject) => this._spaceWaiters.push({ bytes, resolve, reject }));
    }

    _wake() {
      this._waiters = this._waiters.filter(waiter => {
        if (waiter.sequence <= this.completed) { waiter.resolve(); return false; }
        if (this.error) { waiter.reject(this.error); return false; }
        return true;
      });
      this._spaceWaiters = this._spaceWaiters.filter(waiter => {
        if (this.error) { waiter.reject(this.error); return false; }
        if (this.bytes + waiter.bytes <= this.capacityBytes && this._entries.size < this.maxCommands) {
          waiter.resolve(); return false;
        }
        return true;
      });
    }

    cancel(reason = new QueueError('CANCELLED', 'render queue cancelled')) {
      if (!this.error) this.error = reason;
      this._cancelWaiting();
      this._wake();
      // Notification alone cannot free storage still in use by another worker.
      // cancel() may acknowledge retirement (sync or async), e.g. after terminate.
      if (typeof this.consumer.cancel !== 'function') return;
      const entries = Array.from(this._entries.values());
      const retire = () => { for (const entry of entries) this._retire(entry, this.error); };
      const ack = this.consumer.cancel(this.generation, reason);
      if (ack === true) retire();
      else if (ack && typeof ack.then === 'function')
        Promise.resolve(ack).then(retire, () => {}); // failed cancellation is not retirement
    }

    reset(consumer = this.consumer) {
      if (this.inflight) throw new QueueError('BUSY', 'render storage still in flight');
      if (this._publishing) throw new QueueError('REENTRANT', 'reset during render publication');
      if (!consumer || typeof consumer.execute !== 'function') throw new QueueError('INVALID', 'render consumer required');
      positiveInteger(this.generation + 1, 'generation');
      this.consumer = consumer;
      this.generation++;
      this.submitted = this.consumed = this.completed = 0;
      this.error = null;
      this._entries.clear();
      this._waiting.length = 0;
      this._active = null;
      return this.generation;
    }

    snapshot() {
      return { version: VERSION, deviceId: this.deviceId, generation: this.generation,
        submitted: this.submitted, consumed: this.consumed, completed: this.completed,
        bytes: this.bytes, inflight: this.inflight, capacityBytes: this.capacityBytes,
        maxCommands: this.maxCommands, error: this.error };
    }
  }

  const workerKey = command => `${command.deviceId}:${command.generation}:${command.sequence}`;
  function deferredResult() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // A caller may use only fence(), not receipt.value. Keep execution failures
    // observable through that fence without creating an unhandled rejection.
    promise.catch(() => {});
    return { promise, resolve, reject };
  }
  function serializedError(error) {
    return { code: error && error.code || 'EXECUTION', message: error && error.message || String(error) };
  }

  // Same descriptors as direct execution, with structured-clone publication.
  // No shared guest pointer is dereferenced by transport and no upload buffer is
  // reused while the command is pending. The caller supplies the existing worker
  // instance; this adapter deliberately does not create a second worker runtime.
  class WorkerConsumer {
    constructor(worker, options) {
      if (!worker || typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function')
        throw new QueueError('INVALID', 'render worker required');
      if (options && typeof options.reclaimHeap !== 'function')
        throw new QueueError('INVALID', 'neutral render worker requires native heap reclamation callback');
      this.worker = worker;
      this.ordered = true; // receiver preserves execution order, not postMessage
      this.pending = new Map();
      this.stopped = false;
      this._termination = null;
      this._graceful = !!options;
      this._ready = options ? deferredResult() : null;
      this.initialized = !options;
      this.ready = this._ready ? this._ready.promise : Promise.resolve();
      this._shutdown = null;
      this._reclaimHeap = options && options.reclaimHeap;
      const receive = message => this.receive(message && message.data !== undefined ? message.data : message);
      const fail = error => {
        this._graceful = false;
        if (this._shutdown) this._shutdown.resolve(false);
        this.cancel(0, error instanceof Error ? error : new QueueError('WORKER', 'render worker failed'));
      };
      if (typeof worker.on === 'function') {
        worker.on('message', receive);
        worker.on('error', fail);
        worker.on('exit', () => {
          this.stopped = true;
          this._graceful = false;
          const error = new QueueError('WORKER_EXIT', 'render worker exited');
          this._rejectPending(error);
          if (this._ready) this._ready.reject(error);
          if (this._shutdown) this._shutdown.resolve(false);
        });
      } else {
        worker.addEventListener('message', receive);
        worker.addEventListener('error', fail);
      }
      if (options) worker.postMessage({ t: 'init', mode: 'neutral', module: options.module,
        memory: options.memory, sigs: options.sigs, imageBase: options.imageBase,
        sourceVersion: options.sourceVersion === undefined ? globalThis.WINE_SOURCE_VERSION : options.sourceVersion });
    }

    execute(command) {
      if (this.stopped) throw new QueueError('WORKER_EXIT', 'render worker stopped');
      if (!this.initialized) throw new QueueError('NOT_READY', 'render worker is not initialized');
      const key = workerKey(command);
      if (this.pending.has(key)) throw new QueueError('PROTOCOL', 'duplicate render command');
      const entry = { consumed: deferredResult(), completed: deferredResult(), didConsume: false };
      this.pending.set(key, entry);
      try { this.worker.postMessage({ t: 'd3d-command', command }); }
      catch (error) { this.pending.delete(key); throw error; }
      return { consumed: entry.consumed.promise, completion: entry.completed.promise,
        value: entry.completed.promise };
    }

    receive(message) {
      if (message && message.t === 'ready' && this._ready) {
        this.initialized = true; this._ready.resolve(); return true;
      }
      if (message && message.t === 'shutdown-complete') {
        this.shutdownInfo = message;
        if (this._shutdown) this._shutdown.resolve(true);
        return true;
      }
      if (message && message.t === 'error' && this._ready) {
        const error = new QueueError('WORKER', message.error || 'render worker failed');
        this._ready.reject(error); this._graceful = false;
        if (this._shutdown) this._shutdown.resolve(false);
        this.cancel(0,error); return true;
      }
      if (!message || message.t !== 'd3d-result') return false;
      const key = workerKey(message), entry = this.pending.get(key);
      if (!entry) return false; // stale generation, retired command or another device
      if (message.phase === 'consumed') {
        entry.didConsume = true;
        entry.consumed.resolve();
      } else if (message.phase === 'completed' || message.phase === 'failed') {
        if (!entry.didConsume) {
          this.cancel(0, new QueueError('PROTOCOL', 'worker completed before consumed'));
          return false;
        }
        this.pending.delete(key);
        if (message.phase === 'completed') entry.completed.resolve(message.value);
        else entry.completed.reject(new QueueError(message.error && message.error.code || 'EXECUTION',
          message.error && message.error.message || 'render worker execution failed'));
      } else return false;
      return true;
    }

    _rejectPending(error) {
      for (const entry of this.pending.values()) {
        entry.consumed.reject(error); entry.completed.reject(error);
      }
      this.pending.clear();
    }

    cancel(generation, reason = new QueueError('CANCELLED', 'render worker cancelled')) {
      if (this._termination) return this._termination;
      this.stopped = true;
      // Node returns an exit promise; browser terminate() synchronously stops
      // the worker. Neither receipt nor leases retire merely on sending a stop.
      let retirement = Promise.resolve();
      if (this._graceful && this.initialized) {
        this._shutdown = deferredResult();
        retirement = this._shutdown.promise;
        try { this.worker.postMessage({t:'d3d-shutdown'}); }
        catch (_) { this._shutdown.resolve(false); }
      }
      this._termination = retirement.then(() => this.worker.terminate()).then(async () => {
        this._rejectPending(reason);
        if (this._ready) this._ready.reject(reason);
        if (this._reclaimHeap && this.initialized) {
          if (!this.shutdownInfo || !Number.isInteger(this.shutdownInfo.heapHead)) {
            this.orphaned = true;
            throw new QueueError('ORPHANED', 'render worker exited without native heap ownership handoff');
          }
          const adopted = await this._reclaimHeap(this.shutdownInfo.heapHead);
          if (!Number.isInteger(adopted) || adopted < 0)
            throw new QueueError('RECLAIM', 'native render heap handoff rejected');
          this.shutdownInfo.heapAdopted = adopted;
        }
        return true;
      });
      this._termination.catch(() => {});
      return this._termination;
    }
  }

  // Worker hosts wire this receiver to their existing message handler and
  // supply the selected executor. 'consumed' is only ownership acknowledgement;
  // 'completed' follows the executor's actual fence, never the draw call alone.
  function createCommandReceiver(executor, postMessage) {
    if (!executor || typeof executor.execute !== 'function' || typeof postMessage !== 'function')
      throw new QueueError('INVALID', 'render receiver needs executor and message sender');
    const streams = new Map();
    const waiting = [];
    let blocked = false, draining = false;
    function drain() {
      if (blocked || draining) return;
      draining = true;
      try {
        while (!blocked && waiting.length) {
          const { command, stream } = waiting.shift();
          const reply = (phase, extra) => postMessage(Object.assign({ t: 'd3d-result',
            deviceId: command.deviceId, generation: command.generation, sequence: command.sequence, phase }, extra));
          reply('consumed');
          const fail = error => {
            stream.pending--; stream.failed = true;
            reply('failed', { error: serializedError(error) });
          };
          const complete = value => { stream.pending--; reply('completed', { value }); };
          try {
            if (stream.failed) throw new QueueError('EXECUTION', 'earlier render command failed');
            const result = executor.execute(command);
            if (!result || (result.complete !== true && !(result.completion && typeof result.completion.then === 'function')))
              throw new QueueError('PROTOCOL', 'worker executor must report actual completion');
            if (result.complete === true) complete(result.value);
            else {
              // A WAT software draw can yield before touching its target. Only
              // explicitly ordered GPU-style issue permits the next execution.
              if (executor.ordered !== true) blocked = true;
              Promise.resolve(result.completion).then(() => complete(result.value), fail)
                .then(() => { blocked = false; drain(); });
            }
          } catch (error) { fail(error); }
        }
      } finally { draining = false; }
    }
    return function receive(message) {
      if (!message || message.t !== 'd3d-command') return false;
      const command = message.command;
      if (!command || command.version !== VERSION || !neutralOpcodes.has(command.opcode)
          || !Number.isSafeInteger(command.deviceId) || command.deviceId <= 0
          || !Number.isSafeInteger(command.generation) || command.generation <= 0
          || !Number.isSafeInteger(command.sequence) || command.sequence <= 0)
        throw new QueueError('PROTOCOL', 'invalid render worker descriptor');
      let stream = streams.get(command.deviceId);
      if (!stream || command.generation > stream.generation) {
        if (stream && stream.pending) throw new QueueError('BUSY', 'new generation before render retirement');
        stream = { generation: command.generation, sequence: 0, pending: 0, failed: false };
        streams.set(command.deviceId, stream);
      }
      if (command.generation !== stream.generation || command.sequence !== stream.sequence + 1 || stream.failed)
        throw new QueueError('PROTOCOL', 'stale or unordered render worker command');
      stream.sequence = command.sequence;
      stream.pending++;
      waiting.push({ command, stream });
      drain();
      return true;
    };
  }

  return { DRAW_OPCODE, FENCE_OPCODE, STATE_BYTES, HEADER_BYTES, CTRL, Encoder,
    VERSION, OPCODES, QueueError, CommandQueue, WorkerConsumer, createCommandReceiver };
});
