'use strict';

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;
const regions = require('../lib/region-map.generated');

(async () => {
  const module = await WebAssembly.compile(compileSrcWasm((file, source) =>
    file === '13-exports.wat' ? source + `
      (func (export "test_heap_shrink") (param i32) (param i32) (result i32)
        (call $heap_shrink (local.get 0) (local.get 1)))
    ` : source));
  const imageBase = 0x400000;
  let cases = 0;
  for (const sparse of [false, true]) {
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const host = { memory };
    for (const [name, signature] of Object.entries(sigs))
      host[name] = signature.results?.length ? () => 0 : () => {};
    const a = (await WebAssembly.instantiate(module, { host })).exports;
    const peer = (await WebAssembly.instantiate(module, { host })).exports;
    a.init_thread(0, imageBase, 0, 0, 0, 0, 0);
    a.heap_init((sparse ? regions.END : regions.BASE).GUEST_HEAP_BASE - regions.GUEST_BASE + imageBase);
    peer.init_thread(1, imageBase, 0, 0, 0, 0, 0);
    const bytes = new Uint8Array(memory.buffer), view = new DataView(memory.buffer);
    const wa = p => a.guest_to_wasm(p) >>> 0;
    const size = p => view.getUint32(wa(p - 4), true);
    const alloc = n => { const p = a.guest_alloc(n) >>> 0; assert(p); return p; };
    const shrink = (p, n) => a.test_heap_shrink(p, n) >>> 0;
    const cursor = () => a[sparse ? 'get_heap_sparse_ptr' : 'get_heap_ptr']() >>> 0;
    const checkBytes = (p, n, value) => assert(bytes.subarray(wa(p), wa(p) + n).every(x => x === value));

    // Exact and rounded shrinks, including minimum allocation and minimum free tail.
    for (const [payload, retained, expected] of [[124, 28, 32], [124, 29, 40], [124, 0, 16], [44, 28, 32]]) {
      const before = alloc(20), p = alloc(payload), after = alloc(20);
      bytes.fill(0x51, wa(before), wa(before) + 20);
      bytes.fill(0xa6, wa(p), wa(p) + payload);
      bytes.fill(0x72, wa(after), wa(after) + 20);
      const oldSize = size(p), bump = cursor();
      assert.strictEqual(shrink(p, retained), p, 'shrink is nonmoving');
      assert.strictEqual(size(p), expected, 'aligned retained extent');
      assert.strictEqual(cursor(), bump, 'shrink does not rewind arena cursor');
      checkBytes(p, expected - 4, 0xa6);
      const tail = p - 4 + expected, tailSize = oldSize - expected;
      assert.strictEqual(a.get_free_list() >>> 0, tail);
      assert.strictEqual(view.getUint32(wa(tail), true), tailSize);
      const tailNext = view.getUint32(wa(tail) + 4, true);
      assert.strictEqual(shrink(p, retained), p, 'repeated shrink is a no-op');
      assert.strictEqual(a.get_free_list() >>> 0, tail);
      assert.strictEqual(view.getUint32(wa(tail) + 4, true), tailNext, 'tail is not linked twice');
      const peerPtr = peer.guest_alloc(tailSize - 4) >>> 0;
      assert(peerPtr && peerPtr !== tail + 4, 'tail belongs to shrinking instance');
      const reused = alloc(tailSize - 4);
      assert.strictEqual(reused, tail + 4, 'entire tail is reusable');
      bytes.fill(0xc3, wa(reused), wa(reused) + tailSize - 4);
      checkBytes(p, expected - 4, 0xa6);
      checkBytes(before, 20, 0x51); checkBytes(after, 20, 0x72);
      cases++;
    }

    const p = alloc(60), originalSize = size(p);
    bytes.fill(0x39, wa(p), wa(p) + 60);
    // Same-size and eight-byte remainder keep the original block/header intact.
    for (const requested of [60, 52]) {
      const head = a.get_free_list(), bump = cursor();
      assert.strictEqual(shrink(p, requested), p);
      assert.strictEqual(size(p), originalSize);
      assert.strictEqual(a.get_free_list(), head);
      assert.strictEqual(cursor(), bump);
      checkBytes(p, 60, 0x39); cases++;
    }
    for (const [pointer, requested] of [[p, 61], [p, 0x7fffffff], [p, 0xffffffff], [0, 8], [p + 1, 8], [0xfffffff4, 8]]) {
      const head = a.get_free_list(), bump = cursor();
      assert.strictEqual(shrink(pointer, requested), 0, 'invalid pointer/size or growth rejected');
      assert.strictEqual(size(p), originalSize);
      assert.strictEqual(a.get_free_list(), head);
      assert.strictEqual(cursor(), bump);
      checkBytes(p, 60, 0x39); cases++;
    }
    // Header validation must precede splitting or free-list mutation.
    for (const badSize of [8, 17, 0x7ffffff8]) {
      view.setUint32(wa(p - 4), badSize, true);
      const head = a.get_free_list(), bump = cursor();
      assert.strictEqual(shrink(p, 8), 0, 'malformed or out-of-arena extent rejected');
      assert.strictEqual(size(p), badSize);
      assert.strictEqual(a.get_free_list(), head);
      assert.strictEqual(cursor(), bump);
      checkBytes(p, 60, 0x39);
      view.setUint32(wa(p - 4), originalSize, true); cases++;
    }
  }
  console.log(`Heap shrink PASS ${cases} cases (low and sparse)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
