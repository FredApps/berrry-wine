'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = `
 (func (export "caps") (param $id i32) (param $out i32) (param $cb i32) (param $sp i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (i32.store offset=0 (global.get $reg_base) (i32.const 0xdeadbeef))
   (call $dispatch_api_table (local.get $id) (i32.const 0) (local.get $out) (local.get $cb)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.guest_alloc(64), direct = e.guest_alloc(136) + 4;
  const base = 0x38000000, neighbor = base + 0x10000;
  for (const p of [base, neighbor, base + 4096]) e.test_virtual_map_commit(p, 4096);
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  const read = (p, n) => Array.from({ length: n }, (_, i) => e.guest_read8(p + i));
  const fill = (p, n, b) => { for (let i = 0; i < n; i++) e.guest_write8(p + i, b); };
  let calls = 0;
  for (const input of [false, true]) for (const wide of [false, true]) {
    const name = `wave${input ? 'In' : 'Out'}GetDevCaps${wide ? 'W' : 'A'}`;
    const id = apis.find(api => api.name === name).id;
    const size = (input ? 48 : 52) + (wide ? 32 : 0), tail = wide ? 72 : 40;
    const expected = Buffer.alloc(size);
    expected.writeUInt16LE(1, 0); expected.writeUInt16LE(1, 2); expected.writeUInt32LE(0x400, 4);
    expected.write(input ? 'Microphone' : 'Audio', 8, wide ? 'utf16le' : 'ascii');
    expected.writeUInt32LE(0xfff, tail); expected.writeUInt16LE(2, tail + 4);
    if (!input) expected.writeUInt32LE(12, tail + 8);
    function call(out, cb, result = 0) {
      e.guest_write32(stack + 16, 0x12345678);
      assert.strictEqual(e.caps(id, out, cb, stack), result, `${name} cb=${cb}`);
      assert.strictEqual(e.get_esp(), stack + 16);
      assert.strictEqual(e.guest_read32(stack + 16), 0x12345678);
      assert.strictEqual(e.guest_span_cursor_bytes(), 0);
      calls++;
    }
    for (const out of [direct, base + 4094, base + 4068]) {
      for (const cb of [...Array(size + 9).keys(), 0xffffffff]) {
        fill(out - 4, 120, 0xcc); fill(neighbor, 128, 0xa7);
        call(out, cb);
        const n = Math.min(cb, size);
        assert.deepStrictEqual(read(out, n), Array.from(expected.subarray(0, n)), `${name} prefix ${cb}`);
        assert(read(out + n, 116 - n).every(v => v === 0xcc), `${name} tail ${cb}`);
        assert(read(out - 4, 4).every(v => v === 0xcc), `${name} leading guard`);
        assert(read(neighbor, 128).every(v => v === 0xa7), `${name} backing guard`);
      }
    }
    call(0, 0); call(0, size, 11);
  }
  console.log(`PASS ${calls} waveform capability ABI calls: all prefixes, A/W, input/output, sparse guards`);
})().catch(error => { console.error(error); process.exitCode = 1; });
