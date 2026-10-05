'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBenchmark } = require('./diablo-gameplay-bench');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diablo-bench-test-'));
const memory = { buffer: new ArrayBuffer(640 * 480 + 2048) };
const bytes = new Uint8Array(memory.buffer), pal = 640 * 480;
bytes[pal + 4] = 255; bytes[pal + 10] = 255;
for (let y = 365; y < 436; y++) {
  for (let x = 110; x < 186; x++) bytes[y * 640 + x] = 1;
  for (let x = 455; x < 531; x++) bytes[y * 640 + x] = 2;
}
async function trial(name, mutate = false) {
  let eip = 0, halt = 0, api = 0, gate = 1;
  const b = createBenchmark({ out: path.join(dir, name + '.json'), warmup: 1,
    iterations: 2, apiCount: () => api });
  b.init({ get_eip: () => eip, get_last_run_halt: () => halt,
    set_bp: address => assert.strictEqual(address, 0x40dd6b),
    set_benchmark_chain_bp: value => assert.strictEqual(value, 1), get_chain_hits: () => BigInt(api),
    get_page_fast: () => api,
    set_bench_candidate: value => { gate = value; }, set_loop_aoe_fill_emit: () => {} }, memory);
  assert.strictEqual(gate, 0);
  b.present(5, 0, 8, 0, pal);
  assert.strictEqual(await b.boundary(1000), false);
  assert.strictEqual(b.active, false);
  eip = 0x40dd6b; halt = 5;
  await b.boundary(1000);
  assert.strictEqual(gate, 1);
  assert.strictEqual(b.now, 1050);
  // Arbitrary extra budget yields must not advance guest time or iterations.
  halt = 1;
  for (let i = 0; i < 13; i++) await b.boundary(999999);
  assert.strictEqual(b.now, 1050);
  halt = 5; await b.boundary(999999);
  b.present(5, 0, 8, 0, pal); api += 4;
  await b.boundary(999999);
  if (mutate) bytes[0] = 1;
  b.present(5, 0, 8, 0, pal); api += 4;
  assert.strictEqual(await b.boundary(999999), true);
  return JSON.parse(fs.readFileSync(path.join(dir, name + '.json')));
}
(async () => {
const a = await trial('a'), b = await trial('b'), c = await trial('changed', true);
assert.strictEqual(a.frames, 2);
assert.strictEqual(a.apiCalls, 8);
assert.strictEqual(a.guestMs, 100);
assert.strictEqual(a.frameHash, b.frameHash);
assert.notStrictEqual(a.frameHash, c.frameHash);
assert.throws(() => createBenchmark({ out: 'x', iterations: 0 }), /invalid/);
const events = [];
let tick = 0;
const walking = createBenchmark({ out: path.join(dir, 'walking.json'), warmup: 1,
  iterations: 600, walking: true, renderer: {
    handleMouseMove: (...xy) => events.push(['move', tick - 1, xy]),
    handleMouseDown: (...xy) => events.push(['down', tick - 1, xy]),
    handleMouseUp: (...xy) => events.push(['up', tick - 1, xy]),
  } });
walking.init({ get_eip: () => 0x40dd6b, get_last_run_halt: () => 5,
  set_bp: () => {}, set_loop_aoe_fill_emit: () => {},
  set_benchmark_chain_bp: () => {}, get_chain_hits: () => BigInt(tick),
  get_page_fast: () => tick,
  guest_read32: address => address === 0x4ad1a8 ? 0 : Math.floor(tick / 10),
}, memory);
walking.present(5, 0, 8, 0, pal);
await walking.boundary(1000);
for (tick = 1; tick <= 601; tick++) {
  const done = await walking.boundary(999999);
  if (!done) walking.present(5, 0, 8, 0, pal);
}
assert.strictEqual(events.length, 30);
assert.deepStrictEqual(events.slice(0, 4), [
  ['move', 0, [320, 270]], ['down', 1, [320, 270, 1]],
  ['up', 45, [320, 270, 1]], ['move', 60, [320, 82]],
]);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'walking.json'))).movingLegs, 10);
console.log('PASS boundary clock, workload hash, frame/API counts, candidate boot gate, invalid options');
})().catch(error => { console.error(error); process.exitCode = 1; });
