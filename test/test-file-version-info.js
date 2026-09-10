#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
  (func (export "test_version_begin") (param $id i32) (param $sp i32)
    (global.set $thunk_guest_base (i32.const 0x200000))
    (global.set $thunk_guest_end (i32.const 0x200008))
    (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
    (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
    (global.set $esp (local.get $sp)) (global.set $eip (i32.const 0x200000))
    (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0)))
  (func (export "test_version_esp") (result i32) (global.get $esp))
  (func (export "test_version_eax") (result i32) (global.get $eax))
  (func (export "test_version_frames") (result i32)
    (local $p i32) (local $n i32)
    (local.set $p (global.get $version_pending))
    (block $done (loop $walk
      (br_if $done (i32.eqz (local.get $p)))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (local.set $p (call $gl32 (local.get $p))) (br $walk)))
    (local.get $n))
`;

function makeVersionBlob() {
  const blob = Buffer.alloc(92);
  blob.writeUInt16LE(blob.length, 0);
  blob.writeUInt16LE(52, 2);
  blob.writeUInt16LE(0, 4);
  const key = 'VS_VERSION_INFO\0';
  for (let i = 0; i < key.length; i++) blob.writeUInt16LE(key.charCodeAt(i), 6 + i * 2);
  blob.writeUInt32LE(0xFEEF04BD, 0x28);
  blob.writeUInt32LE(0x00010000, 0x2C);
  blob.writeUInt32LE(0x00050006, 0x30);
  blob.writeUInt32LE(0x00070008, 0x34);
  blob.writeUInt32LE(0x0009000A, 0x38);
  blob.writeUInt32LE(0x000B000C, 0x3C);
  return blob;
}

function makeVersionPe(blob) {
  const file = Buffer.alloc(0x400);
  file.writeUInt16LE(0x5A4D, 0);
  file.writeUInt32LE(0x80, 0x3C);
  file.writeUInt32LE(0x00004550, 0x80);
  file.writeUInt16LE(0x014C, 0x84);
  file.writeUInt16LE(1, 0x86);
  file.writeUInt16LE(0xE0, 0x94);
  const opt = 0x98;
  file.writeUInt16LE(0x010B, opt);
  file.writeUInt32LE(3, opt + 92);
  file.writeUInt32LE(0x1000, opt + 112);
  file.writeUInt32LE(0x200, opt + 116);
  const section = 0x178;
  file.write('.rsrc\0\0\0', section, 'ascii');
  file.writeUInt32LE(0x200, section + 8);
  file.writeUInt32LE(0x1000, section + 12);
  file.writeUInt32LE(0x200, section + 16);
  file.writeUInt32LE(0x200, section + 20);
  const root = 0x200;
  file.writeUInt16LE(1, root + 14);
  file.writeUInt32LE(16, root + 16);
  file.writeUInt32LE(0x80000018, root + 20);
  file.writeUInt16LE(1, root + 0x18 + 14);
  file.writeUInt32LE(1, root + 0x18 + 16);
  file.writeUInt32LE(0x80000030, root + 0x18 + 20);
  file.writeUInt16LE(1, root + 0x30 + 14);
  file.writeUInt32LE(0x0409, root + 0x30 + 16);
  file.writeUInt32LE(0x48, root + 0x30 + 20);
  file.writeUInt32LE(0x1100, root + 0x48);
  file.writeUInt32LE(blob.length, root + 0x4C);
  blob.copy(file, 0x300);
  return file;
}

async function main() {
  const blob = makeVersionBlob();
  const pe = makeVersionPe(blob);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer, renderer: null, resourceJson: {} };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  imports.host.create_thread = () => 0;
  imports.host.exit_thread = () => 0;
  imports.host.terminate_thread = () => 0;
  imports.host.create_event = () => 0;
  imports.host.set_event = () => 0;
  imports.host.reset_event = () => 0;
  imports.host.wait_single = () => 0;
  imports.host.wait_multiple = () => 0;
  imports.host.com_create_instance = () => 0x80004002;
  ctx.vfs.files.set('c:\\windows\\temp\\version.dll', {
    data: new Uint8Array(pe), attrs: 0x20,
  });
  const bad = Buffer.from(pe);
  bad.writeUInt32LE(0x7FFFFFF0, 0x200 + 0x48);
  ctx.vfs.files.set('c:\\windows\\temp\\bad.dll', {
    data: new Uint8Array(bad), attrs: 0x20,
  });

  const { instance } = await WebAssembly.instantiate(compileSrcWasm((file, source) =>
    file === '13-exports.wat' ? source + extraWat : source), imports);
  const e = instance.exports;
  ctx.exports = e;
  const u8 = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const wa = gp => gp - e.get_image_base() + e.get_guest_base();

  function writeAscii(value) {
    const gp = e.guest_alloc(value.length + 1);
    for (let i = 0; i < value.length; i++) u8[wa(gp) + i] = value.charCodeAt(i);
    u8[wa(gp) + value.length] = 0;
    return gp;
  }

  function writeWide(value) {
    const gp = e.guest_alloc((value.length + 1) * 2);
    for (let i = 0; i < value.length; i++) dv.setUint16(wa(gp) + i * 2, value.charCodeAt(i), true);
    dv.setUint16(wa(gp) + value.length * 2, 0, true);
    return gp;
  }

  const ansiPath = writeAscii('C:\\Windows\\Temp\\Version.dll');
  const widePath = writeWide('C:\\Windows\\Temp\\Version.dll');
  const handleOut = e.guest_alloc(4);
  dv.setUint32(wa(handleOut), 0xDEADBEEF, true);
  assert.strictEqual(e.test_call_GetFileVersionInfoSizeA(ansiPath, handleOut), blob.length);
  assert.strictEqual(dv.getUint32(wa(handleOut), true), 0);
  assert.strictEqual(e.test_call_GetFileVersionInfoSizeW(widePath, 0), blob.length);

  const full = e.guest_alloc(blob.length);
  assert.strictEqual(e.test_call_GetFileVersionInfoA(ansiPath, 0, blob.length, full), 1);
  assert.deepStrictEqual(Buffer.from(u8.subarray(wa(full), wa(full) + blob.length)), blob);

  const shortLen = blob.length - 7;
  const short = e.guest_alloc(blob.length + 4);
  u8.fill(0xA5, wa(short), wa(short) + blob.length + 4);
  assert.strictEqual(e.test_call_GetFileVersionInfoW(widePath, 0, shortLen, short), 1);
  assert.deepStrictEqual(Buffer.from(u8.subarray(wa(short), wa(short) + shortLen)), blob.subarray(0, shortLen));
  assert.deepStrictEqual(Array.from(u8.subarray(wa(short) + shortLen, wa(short) + blob.length + 4)),
    new Array(11).fill(0xA5));

  assert.strictEqual(e.test_call_GetFileVersionInfoSizeA(writeAscii('C:\\missing.dll'), 0), 0);
  assert.strictEqual(e.test_call_GetFileVersionInfoSizeA(writeAscii('C:\\Windows\\Temp\\bad.dll'), 0), 0);

  let rejectFill = false;
  const stageRanges = [[0, 64], [0x80, 24], [0x80, 288], [0x200, 512], [0x300, blob.length]];
  const vfs = ctx.vfs;
  function mountLazy() {
    rejectFill = false;
    vfs.setProviderFile('c:\\windows\\temp\\version.dll', { provider: new ChunkCache({
      size: pe.length,
      async readRange(off, len) {
        if (rejectFill) throw new Error('injected version-stage read failure');
        return new Uint8Array(pe.subarray(off, off + len));
      },
    }, { budget: new ChunkCacheBudget({ maxBytes: 0 }), chunkSize: 64, readAhead: 0 }) });
  }
  function liveHandles() { return [...vfs.handles.values()].filter(h => !h.closed).length; }
  function launch(name, sp) {
    const info = !name.includes('Size');
    const output = e.guest_alloc(info ? blob.length + 8 : 4);
    const count = info ? blob.length + 8 : 4;
    u8.fill(0xA5, wa(output), wa(output) + count);
    const filename = name.endsWith('W') ? widePath : ansiPath;
    const args = info ? [filename, 0, blob.length, output] : [filename, output];
    const id = apis.find(a => a.name === name).id;
    e.test_version_begin(id, sp);
    [0, ...args].forEach((value, i) => e.guest_write32(sp + i * 4, value));
    const frame = [0, ...args];
    e.run(2);
    return { id, sp, output, count, info, frame };
  }
  async function drive(call, failStage = -1, firstPending = null) {
    let stage = 0;
    while (firstPending || e.get_yield_reason() === 12) {
      assert(stage < 5, 'parser resumes its stage instead of replaying evicted headers');
      assert.strictEqual(e.test_version_esp(), call.sp);
      assert.strictEqual(e.get_eip(), 0x200000);
      assert.deepStrictEqual(call.frame.map((_, i) => e.guest_read32(call.sp + i * 4) >>> 0), call.frame);
      assert(u8.subarray(wa(call.output), wa(call.output) + call.count).every(x => x === 0xA5),
        'pending version query must leave caller output unchanged');
      const pending = firstPending || vfs.pendingRead;
      firstPending = null;
      assert.deepStrictEqual([pending.offset, pending.length], stageRanges[stage]);
      rejectFill = stage === failStage;
      await vfs.fillPendingRead(pending);
      e.test_version_begin(call.id, call.sp); e.run(2);
      stage++;
    }
    assert.strictEqual(stage, failStage < 0 ? 5 : failStage + 1);
    assert.strictEqual(e.test_version_esp(), call.sp + call.frame.length * 4);
    assert.strictEqual(e.get_eip(), 0);
    assert.strictEqual(e.test_version_eax(), failStage >= 0 ? 0 : call.info ? 1 : blob.length);
    if (call.info) {
      assert.deepStrictEqual(Buffer.from(u8.subarray(wa(call.output), wa(call.output) + blob.length)),
        failStage >= 0 ? Buffer.alloc(blob.length, 0xA5) : blob);
      assert(u8.subarray(wa(call.output) + blob.length, wa(call.output) + call.count).every(x => x === 0xA5));
    } else assert.strictEqual(dv.getUint32(wa(call.output), true), 0);
  }
  const stack = e.guest_alloc(2048) + 1024;
  for (const name of ['GetFileVersionInfoSizeA', 'GetFileVersionInfoSizeW', 'GetFileVersionInfoA', 'GetFileVersionInfoW']) {
    for (const failingStage of [-1, 0, 1, 2, 3, 4]) {
      mountLazy(); const before = liveHandles();
      const call = launch(name, stack);
      assert.strictEqual(e.test_version_frames(), 1);
      await drive(call, failingStage);
      assert.strictEqual(liveHandles(), before, 'success/error closes its retained file handle');
      assert.strictEqual(e.test_version_frames(), 0, 'success/error frees parser continuation');
    }
  }
  mountLazy(); const beforeNested = liveHandles();
  const outer = launch('GetFileVersionInfoSizeA', stack), outerPending = vfs.pendingRead;
  const inner = launch('GetFileVersionInfoW', stack - 128);
  assert.strictEqual(e.test_version_frames(), 2);
  await drive(inner);
  assert.strictEqual(e.test_version_frames(), 1);
  assert.strictEqual(liveHandles(), beforeNested + 1);
  // Reinstate the parked outer call without executing it before its saved fill.
  e.test_version_begin(outer.id, outer.sp);
  await drive(outer, -1, outerPending);
  assert.strictEqual(e.test_version_frames(), 0);
  assert.strictEqual(liveHandles(), beforeNested);
  console.log('PASS file-backed GetFileVersionInfo A/W resource lookup');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
