'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
 (func (export "span") (param $p i32) (param $n i32) (result i32)
   (call $guest_span_in (local.get $p) (local.get $n)))
 (func (export "release") (param $p i32) (param $n i32)
   (call $guest_span_release (local.get $p) (local.get $n)))
 (func (export "writeback") (param $g i32) (param $p i32) (param $n i32)
   (call $guest_span_writeback (local.get $g) (local.get $p) (local.get $n)))
 (func (export "capacity") (result i32) (global.get $GUEST_SPAN_SCRATCH_SIZE))
`;
(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const base = 0x3c000000, p = base + 4090;
  for (const g of [base, base + 0x10000, base + 4096]) e.test_virtual_map_commit(g, 4096);
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  for (let i = 0; i < 32; i++) e.guest_write8(p + i, i + 1);
  const direct = e.guest_alloc(32), held = [], bytes = new Uint8Array(memory.buffer);
  const capacity = e.capacity(); assert.strictEqual(capacity % 32, 0);
  for (let i = 0; i < capacity / 32; i++) held.push(e.span(p, 32));
  assert.strictEqual(e.guest_span_cursor_bytes(), capacity, 'exact fit accepted');
  const before = bytes.slice(held[0], held[0] + capacity);
  for (const len of [32, 0xfffffff0]) {
    const overflows = e.guest_span_overflow_count();
    assert.throws(() => e.span(p, len), WebAssembly.RuntimeError, 'cannot return an unsafe nonaffine pointer');
    assert.strictEqual(e.guest_span_cursor_bytes(), capacity, 'failure leaves owned spans intact');
    assert.strictEqual(e.guest_span_overflow_count(), overflows + 1);
    assert.deepStrictEqual(bytes.slice(held[0], held[0] + capacity), before, 'no partial writes');
  }
  assert.strictEqual(e.span(direct, 32), e.guest_to_wasm(direct), 'full arena does not block affine spans');
  assert.strictEqual(e.span(p, 0), 0); assert.strictEqual(e.span(0, 32), 0);
  const top = held.pop(); bytes[top] = 0xab;
  e.writeback(p, top, 32); assert.strictEqual(e.guest_read8(p), 0xab);
  assert.strictEqual(e.guest_span_cursor_bytes(), capacity - 32);
  for (const wa of held.reverse()) e.release(wa, 32);
  assert.strictEqual(e.guest_span_cursor_bytes(), 0);
  const next = e.span(p, 32); assert.strictEqual(bytes[next], 0xab);
  e.release(next, 32); assert.strictEqual(e.guest_span_cursor_bytes(), 0);
  console.log('PASS guest spans: exact fill, exhaustion/wrapped-size traps, preserved held spans, affine bypass, LIFO writeback/release and reuse');
})().catch(error => { console.error(error); process.exitCode = 1; });
