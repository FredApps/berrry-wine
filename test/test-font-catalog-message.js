'use strict';
const assert = require('assert');
const Catalog = require('../lib/font-catalog');
const { GuestThreadHost } = require('../lib/guest-thread-host');
const RegionMap = require('../lib/region-map.generated');
const DIR = 'c:\\windows\\fonts\\';

(async () => {
  const policy = [DIR + 'arial.ttf'];
  const entry = { path: DIR + 'custom.ttf', bytes: Uint8Array.of(1, 2, 3) };
  const big = new Uint8Array(4 * 1024 * 1024);
  const invalid = [null, {}, new Array(33).fill(entry), [null],
    [{ ...entry, bytes: 'bad' }], [{ ...entry, bytes: new Uint8Array() }],
    [{ ...entry, bytes: new Uint8Array(big.length + 1) }],
    [{ ...entry, path: DIR + 'arial.ttf' }], [entry, { ...entry, path: entry.path.toUpperCase() }],
    ...['c:\\other.ttf', DIR + 'nested\\font.ttf', DIR + '..\\other.ttf', DIR + 'bad.fon',
      DIR + 'caf\u00e9.ttf', DIR + 'x'.repeat(132) + '.ttf'].map(path => [{ ...entry, path }]),
    Array.from({ length: 5 }, (_, i) => ({ path: DIR + i + '.ttf', bytes: big }))];
  let sends = 0;
  const fakeHost = { link: { async _ask(message) {
    sends++;
    assert.notStrictEqual(message.entries[0].bytes, entry.bytes, 'host owns copied bytes before sending');
    assert.notStrictEqual(message.expectedExcludedPaths, policy);
    return { count: message.entries.length, generation: 1 };
  } } };
  const send = (...args) => GuestThreadHost.prototype.installFontCatalog.call(fakeHost, ...args);
  for (const entries of invalid) {
    assert.throws(() => Catalog.validateEntries(entries, policy));
    await assert.rejects(send(entries, policy));
  }
  for (const paths of [null, {}, new Array(257).fill(policy[0]), [0], [''], ['x'.repeat(132)]]) {
    assert.throws(() => Catalog.validateEntries([entry], paths));
  }
  assert.strictEqual(sends, 0, 'invalid input never crosses the Worker boundary');
  assert.deepStrictEqual(await send([entry], policy), { count: 1, generation: 1 });

  const memory = { buffer: new ArrayBuffer(65536) }, bytes = new Uint8Array(memory.buffer);
  bytes.set(Buffer.from(policy[0] + '\0'), 128);
  const events = [], allocated = new Set(); let next = 4096, changePolicy = false;
  const ex = {
    get_image_base: () => RegionMap.GUEST_BASE,
    font_catalog_exclusion_path: index => index ? 0 : 128,
    font_catalog_begin() { events.push('begin'); return 1; },
    font_catalog_add(token, path, data, size) {
      assert.strictEqual(token, 1); assert.strictEqual(size, entry.bytes.length);
      assert.deepStrictEqual(bytes.slice(data, data + size), entry.bytes);
      events.push('add'); if (changePolicy) bytes[128] = 100; return 1;
    },
    font_catalog_commit() { events.push('commit'); return 1; },
    font_catalog_abort() { events.push('abort'); },
    guest_alloc(size) { const p = next; next += size + 16; allocated.add(p); return p; },
    guest_free(p) { assert(allocated.delete(p)); },
  };
  const options = { exports: ex, memory, expectedExcludedPaths: policy };
  assert.strictEqual(Catalog.installEntries([entry], options), 1);
  assert.deepStrictEqual(events, ['begin', 'add', 'commit']); assert.strictEqual(allocated.size, 0);
  events.length = 0;
  assert.throws(() => Catalog.installEntries([entry], { ...options, expectedExcludedPaths: [] }), /policy/);
  assert.deepStrictEqual(events, [], 'wrong native policy fails before allocation/publication');
  changePolicy = true;
  assert.throws(() => Catalog.installEntries([entry], options), /stale|policy/);
  assert.deepStrictEqual(events, ['begin', 'add', 'abort']); assert.strictEqual(allocated.size, 0);
  console.log('PASS catalog message bounds, pre-send ownership, policy validation and staged rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });
