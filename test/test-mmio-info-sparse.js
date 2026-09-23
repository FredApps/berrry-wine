'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = `
 (func (export "invoke_mmio") (param $id i32) (param $a i32) (param $b i32) (param $c i32)
   (param $sp i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (i32.store offset=0 (global.get $reg_base) (i32.const 0xdeadbeef))
   (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b) (local.get $c)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  let e, position = 0, pending = false, reads = 0;
  const boot = await bootRenderHarness({ extraWat, fonts: 'none', extraHostOverrides: {
    fs_set_file_pointer(h, offset, origin) {
      position = origin === 1 ? position + offset : offset;
      return position;
    },
    fs_read_file(h, buf, count, out) {
      reads++;
      if (pending) return 0;
      const n = Math.min(count, 4);
      for (let i = 0; i < n; i++) e.guest_write8(buf + i, 65 + i);
      e.guest_write32(out, n); position += n; return 1;
    },
    fs_read_pending() { return pending ? 1 : 0; },
  }});
  e = boot.exports;
  const stack = e.guest_alloc(64), buf = e.guest_alloc(128), direct = e.guest_alloc(88) + 4;
  const base = 0x38000000, neighbor = base + 0x10000;
  for (const p of [base, neighbor, base + 4096]) e.test_virtual_map_commit(p, 4096);
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  const read = (p, n) => Array.from({ length: n }, (_, i) => e.guest_read8(p + i));
  const fill = (p, n, v) => { for (let i = 0; i < n; i++) e.guest_write8(p + i, v); };
  const record = fields => {
    const bytes = new Uint8Array(72), view = new DataView(bytes.buffer);
    for (const [offset, value] of Object.entries(fields)) view.setUint32(Number(offset), value, true);
    return Array.from(bytes);
  };
  let calls = 0;
  function call(name, a, b, c = 0) {
    const api = apis.find(api => api.name === name), pop = 4 * (api.nargs + 1);
    e.guest_write32(stack + pop, 0x12345678);
    const result = e.invoke_mmio(api.id, a, b, c, stack);
    assert.strictEqual(e.get_esp(), stack + pop, name + ' stack');
    assert.strictEqual(e.guest_read32(stack + pop), 0x12345678, name + ' stack guard');
    assert.strictEqual(e.guest_span_cursor_bytes(), 0, name + ' releases span');
    assert(read(neighbor, 128).every(v => v === 0xa7), name + ' unrelated backing');
    calls++; return result;
  }
  // Split a field itself, and split between fields in the middle of MMIOINFO.
  for (const info of [direct, base + 4094, base + 4072]) {
    fill(neighbor, 128, 0xa7);
    const reset = () => { fill(info - 4, 80, 0xcc); fill(info, 72, 0); };
    const guards = () => {
      assert.deepStrictEqual(read(info - 4, 4), [204, 204, 204, 204]);
      assert.deepStrictEqual(read(info + 72, 4), [204, 204, 204, 204]);
    };
    reset();
    e.guest_write32(info + 4, 0x204d454d);
    e.guest_write32(info + 20, 128); e.guest_write32(info + 24, buf);
    const beforeOpen = read(info, 72);
    const h = call('mmioOpenA', 0, info, 0x1002);
    assert(h > 0); assert.deepStrictEqual(read(info, 72), beforeOpen);
    assert.strictEqual(call('mmioGetInfo', h, info), 0);
    assert.strictEqual(e.guest_read32(info + 68), h);
    assert.strictEqual(e.guest_read32(info + 24), buf);
    assert.strictEqual(e.guest_read32(info + 36), buf + 128);
    assert.deepStrictEqual(read(info, 72), record({
      0: 0x1002, 4: 0x204d454d, 20: 128, 24: buf, 28: buf, 32: buf,
      36: buf + 128, 68: h,
    }), 'complete memory MMIOINFO');
    e.guest_write32(info, 0x10000000); e.guest_write32(info + 28, buf + 7);
    const input = read(info, 72);
    assert.strictEqual(call('mmioSetInfo', h, info), 0);
    assert.deepStrictEqual(read(info, 72), input, 'SetInfo leaves input alone');
    assert.strictEqual(call('mmioAdvance', h, info), 0);
    assert.strictEqual(e.guest_read32(info + 32), buf + 7);
    e.guest_write32(info + 28, buf + 128);
    assert.strictEqual(call('mmioAdvance', h, info, 1), 268);
    assert.strictEqual(call('mmioClose', h, 0), 0); guards();
    reset(); e.guest_write32(info + 4, 0x204d454d);
    assert.strictEqual(call('mmioOpenA', 0, info), 0);
    assert.strictEqual(e.guest_read32(info + 12), 5); guards();

    // File-backed output and refill, including a pending provider retry.
    const file = 0x70000131;
    position = 0; reset();
    assert.strictEqual(call('mmioGetInfo', file, info), 0);
    assert.strictEqual(e.guest_read32(info + 68), file);
    const fileBuf = e.guest_read32(info + 24);
    assert(fileBuf);
    const fileSize = e.guest_read32(info + 20);
    assert.deepStrictEqual(read(info, 72), record({
      0: 0x10000, 4: 0x454c4946, 20: fileSize, 24: fileBuf,
      28: fileBuf, 32: fileBuf, 36: fileBuf + fileSize, 68: file,
    }), 'complete file MMIOINFO');
    e.guest_write32(info + 28, fileBuf + 3);
    assert.strictEqual(call('mmioSetInfo', file, info), 0);
    assert.strictEqual(position, 3);
    pending = true;
    // IO_WAIT rewinds the stdcall frame; the ordinary ABI helper expects a completed call.
    const advance = apis.find(api => api.name === 'mmioAdvance').id;
    e.invoke_mmio(advance, file, info, 0, stack);
    assert.strictEqual(e.get_esp(), stack);
    assert.strictEqual(e.guest_span_cursor_bytes(), 0, 'pending refill releases span');
    pending = false;
    assert.strictEqual(call('mmioAdvance', file, info), 0);
    assert.strictEqual(e.guest_read32(info + 28), fileBuf);
    assert.strictEqual(e.guest_read32(info + 32), fileBuf + 4);
    assert.strictEqual(e.guest_read32(info + 40), 3);
    assert.strictEqual(e.guest_read32(info + 44), 7);
    assert.deepStrictEqual(read(info, 72), record({
      0: 0x10000, 4: 0x454c4946, 20: fileSize, 24: fileBuf,
      28: fileBuf, 32: fileBuf + 4, 36: fileBuf + fileSize, 40: 3, 44: 7, 68: file,
    }), 'refill changes only buffer progress');
    e.guest_write32(info + 24, 0);
    assert.strictEqual(call('mmioAdvance', file, info), 259); guards();
    assert.strictEqual(call('mmioClose', file, 0), 0);
  }
  assert.strictEqual(reads, 6);
  console.log(`PASS MMIOINFO direct/sparse memory/file paths, ${calls} ABI calls and lazy retries`);
})().catch(error => { console.error(error); process.exitCode = 1; });
