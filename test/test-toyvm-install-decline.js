'use strict';

// Pure JS: use the repository's actual bundle, pipeline and epoch-decline
// installer. No Wasm compilation or guest execution is needed for this path.
const assert = require('assert/strict');
const { LiveJit } = require('../tools/toyvm/region-live');
const { Extras } = require('../tools/toyvm/extras');

function fixture(options = {}) {
  let resolvePreparation;
  let bundle;
  const logs = [];
  const extras = new Extras();
  const mem = Uint8Array.of(7, 8, 9);
  const session = { cache: { regions: new Map(), regionAt: new Map() } };
  const vm = {
    variant: 'test', mem, exports: {},
    rebind() { throw new Error('unexpected VM mutation on decline'); },
  };
  const backend = {
    name: 'worker',
    prepare(snapshot) {
      bundle = snapshot;
      return new Promise(resolve => { resolvePreparation = resolve; });
    },
  };
  const jit = new LiveJit({
    session, vm, extras, backend, log: line => logs.push(line), ...options,
  });
  return {
    jit, extras, mem, session, vm, logs,
    get bundle() { return bundle; },
    prepared() {
      return {
        extras: [], extrasEpoch: bundle.extrasEpoch,
        picks: [{ headIp: 16, blocks: 1, ops: 4, share: 75 }],
        gate: { ratio: 1.2 }, ms: { workerCpu: 0 },
      };
    },
    release(result) { resolvePreparation(result); },
  };
}

async function epochDeclineDoesNotCount() {
  const f = fixture();
  f.jit.samples.set(5, 3);
  const pending = f.jit.runPipeline();
  assert.equal(f.bundle.extrasEpoch, 0);
  f.mem[0] = 99;
  assert.equal(f.bundle.mem[0], 7, 'real makeBundle copies guest memory');

  // A second producer grows the actual shared tail while preparation awaits.
  const otherHandler = { kind: 'concurrent test handler' };
  f.extras.commit([otherHandler]);
  f.release(f.prepared());
  await pending;

  assert.equal(f.jit.installs, 0, 'DECLINED_INSTALL_MUST_NOT_COUNT');
  assert.equal(f.jit.phase, 'profiling');
  assert.match(f.jit.declined, /handler table grew/);
  assert.deepEqual(f.extras.handlers, [otherHandler]);
  assert.equal(f.session.cache.regionAt.size, 0);
  assert.equal(f.jit.installedAt, null);
  assert.equal(f.logs.some(line => line.startsWith('[jit] installed')), false);
  assert.ok(Number.isFinite(f.jit.ms.install));
  assert.equal(f.jit.samples.get(5), 3, 'pipeline does not discard profile');
}

async function continuousDeclinePreservesRewindow() {
  const f = fixture({ continuous: true });
  f.jit.dispatched = 123;
  const pending = f.jit.run();
  f.extras.commit(['other handler']);
  f.release(f.prepared());
  await pending;
  assert.equal(f.jit.installs, 0);
  assert.equal(f.jit.phase, 'profiling');
  assert.match(f.jit.declined, /handler table grew/);
  assert.equal(f.jit.windows, 1);
  assert.equal(f.jit.sampleAfter, 123);
}

async function undefinedSuccessContract() {
  const f = fixture();
  let calls = 0;
  // Boundary stub only: successful install currently returns undefined.
  // This tests caller bookkeeping, not a successful Wasm/table installation.
  f.jit.install = async () => { calls++; return undefined; };
  const pending = f.jit.runPipeline();
  f.release(f.prepared());
  await pending;
  assert.equal(calls, 1);
  assert.equal(f.jit.installs, 1);
  assert.equal(f.jit.phase, 'installed');
  assert.equal(f.logs.filter(line => line.startsWith('[jit] installed')).length, 1);
}

async function preparationDeclineAndExceptionStayUncounted() {
  const declined = fixture();
  declined.jit.install = async () => { throw new Error('unexpected install'); };
  const preparation = declined.jit.runPipeline();
  declined.release({ declined: 'not profitable', ms: { pick: 1 } });
  await preparation;
  assert.equal(declined.jit.installs, 0);
  assert.equal(declined.jit.phase, 'declined');
  assert.equal(declined.jit.declined, 'not profitable');

  const failed = fixture();
  failed.jit.install = async () => { throw new Error('install error'); };
  const installation = failed.jit.runPipeline();
  failed.release(failed.prepared());
  await assert.rejects(installation, /install error/);
  assert.equal(failed.jit.installs, 0);
}

(async () => {
  await epochDeclineDoesNotCount();
  await continuousDeclinePreservesRewindow();
  await undefinedSuccessContract();
  await preparationDeclineAndExceptionStayUncounted();
  console.log('PASS ToyVM install decline accounting (pure JS; no Wasm compilation)');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
