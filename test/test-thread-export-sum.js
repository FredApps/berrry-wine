'use strict';
// ThreadManager.readWasmExportAll: the read side of setWasmGlobalAll. A
// per-instance counter ($logical_frame_count) counts on whichever thread runs
// the code, and NFS II enters its game step on a worker thread, so the GAME/s
// HUD (host.js _readLogicalFrameCount) reads 0 unless it sums every thread.
const assert = require('assert');
const { ThreadManager } = require('../lib/thread-manager');

(async () => {
  const counter = start => {
    let n = start;
    return { exports: { get_logical_frame_count: () => n, bump: () => { n++; } } };
  };
  const coop = counter(5);
  const workerValue = { n: 40 };
  const mainLink = { callExport: async () => 1000 };
  const localLink = { callExport: async () => 2000 };
  const self = {
    workerBackend: { link: mainLink, _localLink: localLink },
    threads: new Map([
      [0xe1001, { state: 'active', instance: coop }],
      [0xe1003, { state: 'active', link: { callExport: async name => {
        assert.strictEqual(name, 'get_logical_frame_count');
        return workerValue.n;
      } } }],
      [0xe1004, { state: 'active', link: mainLink }],
      [0xe1005, { state: 'active', link: localLink }],
      [0xe1006, { state: 'active', link: { callExport: async () => { throw new Error('no export'); } } }],
    ]),
  };
  const read = () => ThreadManager.prototype.readWasmExportAll.call(self, 'get_logical_frame_count');
  const sum = list => list.reduce((s, r) => s + r.value, 0);

  let values = await read();
  assert.deepStrictEqual(values.map(r => r.handle), [0xe1001, 0xe1003],
    'cooperative and worker threads are read; main links and failing reads are not');
  assert.strictEqual(sum(values), 45);

  coop.exports.bump(); workerValue.n = 41;
  assert.strictEqual(sum(await read()), 47, 'live counts are re-read');

  // An exited worker's instance is gone: keep its last count so the total
  // (and the HUD's rate) never steps backwards.
  self.threads.get(0xe1003).state = 'exited';
  workerValue.n = 0;
  assert.strictEqual(sum(await read()), 47, 'an exited thread keeps its last value');
  console.log('PASS readWasmExportAll sums per-instance counters across guest threads');
})().catch(error => { console.error(error); process.exitCode = 1; });
