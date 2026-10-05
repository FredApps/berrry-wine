#!/usr/bin/env node
// The cooperative scheduler's nested synchronous wait cannot await a lazy
// byte-range fill. Diablo's main thread waits inside WM_INITDIALOG
// (waitMultipleCooperative) while Storm's worker reads spawn.mpq; if that read
// misses, the worker parks on io_wait, runSlice gets zero steps, and the wait
// returns WAIT_FAILED before the fetch can land. This pins that behaviour and
// the `[io] needs-preload` report that names the range to preload.
const assert = require('assert');
const { ThreadManager } = require('../lib/thread-manager');

(async () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const mainInstance = { exports: { get_sync_table: () => 0, get_bp_addr: () => 0, get_watch_addr: () => 0 } };
  let resolveFill = null;
  const fills = [];
  const pending = { path: 'c:\\spawn.mpq', handle: 0x30, pos: 0, offset: 0x2fe5eeb, length: 0x80 };
  const vfs = {
    getPendingRead: (id) => (id === 3 ? pending : null),
    fillPendingRead: (p) => {
      fills.push(p);
      return new Promise(resolve => { resolveFill = resolve; });
    },
  };
  const tm = new ThreadManager({}, memory, mainInstance, () => ({ host: {} }), { getVfs: () => vfs });
  const logs = [];
  tm._log = (m) => logs.push(String(m));

  let yieldReason = 12;
  let runs = 0;
  const THREAD = 0xE1001;
  tm.threads.set(THREAD, {
    instance: {
      exports: {
        get_yield_reason: () => yieldReason,
        clear_yield: () => { yieldReason = 0; },
        get_eip: () => 0x4010,
        get_esp: () => 0x100000,
        get_current_thread_id: () => 3,
        run: () => { runs++; },
      },
    },
    state: 'active', tid: 2, suspendCount: 0, sleepUntil: 0, sleepCount: 0, waitPolls: 0,
  });

  // WaitForMultipleObjects(1, &thread, FALSE, INFINITE) from a nested frame.
  const handles = new Uint32Array(memory.buffer, 0x100, 1);
  handles[0] = THREAD;
  const result = tm.waitMultipleCooperative(1, 0x100, 0, 0xFFFFFFFF, 1);
  assert.strictEqual(result >>> 0, 0xFFFFFFFF, 'the nested wait cannot outlast the async fill');
  assert.strictEqual(fills.length, 1, 'the fill was started');
  assert.strictEqual(runs, 0, 'the parked reader ran no guest code');
  const report = logs.filter(m => m.startsWith('[io] needs-preload'));
  assert.strictEqual(report.length, 1, logs.join('\n'));
  assert.ok(report[0].includes('c:\\spawn.mpq @50224875+128'), report[0]);

  // Reported once per range, not once per wait.
  tm.waitMultipleCooperative(1, 0x100, 0, 0xFFFFFFFF, 1);
  assert.strictEqual(logs.filter(m => m.startsWith('[io] needs-preload')).length, 1);

  // Once the fill lands (an event-loop turn the nested wait never had), the
  // ordinary scheduler re-enters the read; nothing is reported for it.
  resolveFill(true);
  await new Promise(resolve => setImmediate(resolve));
  tm.runSlice(1000, { quantumSteps: 1000 });
  assert.strictEqual(yieldReason, 0);
  assert.strictEqual(runs, 1);

  console.log('PASS  nested cooperative wait reports a lazy-range park as needs-preload');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
