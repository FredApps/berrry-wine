#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const IMAGE_BASE = 0x00400000;
const QUERY_BUFFER = IMAGE_BASE + 0x4800;
const OLD_PROTECT = IMAGE_BASE + 0x47f0;

function makePe({ imageBase = IMAGE_BASE, dll = false } = {}) {
  const bytes = Buffer.alloc(0x4000);
  const pe = 0x80;
  const opt = pe + 24;
  const sectionTable = opt + 0xe0;
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(pe, 0x3c);
  bytes.writeUInt32LE(0x00004550, pe);
  bytes.writeUInt16LE(0x14c, pe + 4);
  bytes.writeUInt16LE(3, pe + 6);
  bytes.writeUInt16LE(0xe0, pe + 20);
  bytes.writeUInt16LE(dll ? 0x2102 : 0x0102, pe + 22);
  bytes.writeUInt16LE(0x10b, opt);
  bytes.writeUInt32LE(dll ? 0 : 0x1000, pe + 40);
  bytes.writeUInt32LE(imageBase >>> 0, pe + 52);
  bytes.writeUInt32LE(0x1000, pe + 56); // SectionAlignment
  bytes.writeUInt32LE(0x200, pe + 60);  // FileAlignment
  bytes.writeUInt32LE(0x5000, pe + 80); // SizeOfImage
  bytes.writeUInt32LE(0x400, pe + 84);  // SizeOfHeaders
  bytes.writeUInt16LE(2, pe + 92);      // Windows GUI
  bytes.writeUInt32LE(16, pe + 116);    // NumberOfRvaAndSizes

  const sections = [
    ['.text', 0x1800, 0x1000, 0x1800, 0x0400, 0x60000020],
    ['.rdata', 0x0800, 0x3000, 0x0800, 0x1c00, 0x40000040],
    ['.data', 0x1000, 0x4000, 0x1000, 0x2400, 0xc0000040],
  ];
  sections.forEach(([name, vsize, rva, rawSize, rawOff, characteristics], i) => {
    const off = sectionTable + i * 40;
    bytes.write(name, off, 'ascii');
    bytes.writeUInt32LE(vsize, off + 8);
    bytes.writeUInt32LE(rva, off + 12);
    bytes.writeUInt32LE(rawSize, off + 16);
    bytes.writeUInt32LE(rawOff, off + 20);
    bytes.writeUInt32LE(characteristics >>> 0, off + 36);
  });
  return bytes;
}

const extraWat = String.raw`
  (func (export "test_virtual_query")
      (param $address i32) (param $buffer i32) (param $length i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00404e00))
    (call $handle_VirtualQuery
      (local.get $address) (local.get $buffer) (local.get $length)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_virtual_alloc")
      (param $address i32) (param $size i32) (param $kind i32)
      (param $protect i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00404e00))
    (call $handle_VirtualAlloc
      (local.get $address) (local.get $size) (local.get $kind)
      (local.get $protect) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_virtual_free")
      (param $address i32) (param $size i32) (param $kind i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00404e00))
    (call $handle_VirtualFree
      (local.get $address) (local.get $size) (local.get $kind)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_virtual_protect")
      (param $address i32) (param $size i32) (param $protect i32)
      (param $old i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00404e00))
    (call $handle_VirtualProtect
      (local.get $address) (local.get $size) (local.get $protect)
      (local.get $old) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_virtual_pte") (param $address i32) (result i32)
    (call $virtual_query_pte (local.get $address)))
  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

function mbi(e) {
  const read32 = address => (e.guest_read8(address) |
    (e.guest_read8(address + 1) << 8) |
    (e.guest_read8(address + 2) << 16) |
    (e.guest_read8(address + 3) << 24)) >>> 0;
  return {
    base: read32(QUERY_BUFFER),
    allocationBase: read32(QUERY_BUFFER + 4),
    allocationProtect: read32(QUERY_BUFFER + 8),
    size: read32(QUERY_BUFFER + 12),
    state: read32(QUERY_BUFFER + 16),
    protect: read32(QUERY_BUFFER + 20),
    type: read32(QUERY_BUFFER + 24),
  };
}

async function main() {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: e, memory } = harness;
  const exe = makePe();
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert.strictEqual(e.load_pe(exe.length) >>> 0, IMAGE_BASE + 0x1000,
    'synthetic executable loads');

  assert.strictEqual(e.test_virtual_query(IMAGE_BASE + 0x123, QUERY_BUFFER, 28), 28);
  assert.deepStrictEqual(mbi(e), {
    base: IMAGE_BASE,
    allocationBase: IMAGE_BASE,
    allocationProtect: 0x80,
    size: 0x1000,
    state: 0x1000,
    protect: 0x02,
    type: 0x01000000,
  }, 'PE headers are one committed read-only MEM_IMAGE region');
  assert.strictEqual(e.test_esp(), 0x00404e10, 'VirtualQuery pops three arguments and return');

  assert.strictEqual(e.test_virtual_query(IMAGE_BASE + 0x1234, QUERY_BUFFER, 28), 28);
  assert.deepStrictEqual(mbi(e), {
    base: IMAGE_BASE + 0x1000,
    allocationBase: IMAGE_BASE,
    allocationProtect: 0x80,
    size: 0x2000,
    state: 0x1000,
    protect: 0x20,
    type: 0x01000000,
  }, 'adjacent executable/read pages coalesce within one image section');
  assert.strictEqual(e.test_virtual_query(IMAGE_BASE + 0x2234, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).base, IMAGE_BASE + 0x2000,
    'BaseAddress is the rounded queried page, not the earlier matching page');
  assert.strictEqual(mbi(e).size, 0x1000,
    'RegionSize scans subsequent matching pages only');

  assert.strictEqual(e.test_virtual_query(IMAGE_BASE + 0x3456, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).protect, 0x02,
    'IMAGE_SCN_MEM_READ maps to PAGE_READONLY');
  assert.strictEqual(mbi(e).type, 0x01000000, 'read-only metadata remains MEM_IMAGE');
  assert.strictEqual(e.test_virtual_pte(IMAGE_BASE + 0x3000) & 0x800, 0,
    'normal image loading does not publish a packed-page override');
  assert.strictEqual(e.test_virtual_query(IMAGE_BASE + 0x4567, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).protect, 0x04,
    'IMAGE_SCN_MEM_READ|WRITE maps to PAGE_READWRITE');

  e.guest_write32(OLD_PROTECT, 0xcccccccc);
  assert.strictEqual(e.test_virtual_protect(
    IMAGE_BASE + 0x3123, 0x40, 0x04, OLD_PROTECT), 1,
  'VirtualProtect accepts an image page without changing affine translation');
  assert.strictEqual(e.guest_read8(OLD_PROTECT), 0x02,
    'VirtualProtect returns the section-derived old protection');
  assert.strictEqual(e.test_virtual_query(IMAGE_BASE + 0x3456, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).protect, 0x04,
    'VirtualQuery reflects a direct-image VirtualProtect override');
  assert.notStrictEqual(e.test_virtual_pte(IMAGE_BASE + 0x3000) & 0x800, 0,
    'direct-image PTE metadata is created only by VirtualProtect');
  assert.strictEqual(mbi(e).allocationProtect, 0x80,
    'changing current protection preserves the image allocation protection');

  for (let i = 0; i < 28; i++) e.guest_write8(QUERY_BUFFER + i, 0xcc);
  assert.strictEqual(e.test_virtual_query(IMAGE_BASE + 0x1000, QUERY_BUFFER, 27), 0,
    'a short MEMORY_BASIC_INFORMATION buffer fails');
  for (let i = 0; i < 28; i++) {
    assert.strictEqual(e.guest_read8(QUERY_BUFFER + i), 0xcc,
      'short-buffer failure leaves output untouched');
  }

  const reserve = e.test_virtual_alloc(0, 0x3000, 0x2000, 0x04) >>> 0;
  assert(reserve, 'MEM_RESERVE returns an address');
  assert.strictEqual(e.test_virtual_query(reserve + 0x88, QUERY_BUFFER, 28), 28);
  assert.deepStrictEqual(mbi(e), {
    base: reserve,
    allocationBase: reserve,
    allocationProtect: 0x04,
    size: 0x3000,
    state: 0x2000,
    protect: 0,
    type: 0x00020000,
  }, 'reserved-only sparse pages are MEM_RESERVE, not fabricated commits');

  assert.strictEqual(e.test_virtual_alloc(reserve + 0x1000, 0x1000, 0x1000, 0x20),
    reserve + 0x1000, 'a page inside the reservation commits');
  assert.strictEqual(e.test_virtual_query(reserve, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).state, 0x2000);
  assert.strictEqual(mbi(e).size, 0x1000,
    'reserved prefix stops where committed state begins');
  assert.strictEqual(e.test_virtual_query(reserve + 0x1123, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).allocationBase, reserve,
    'a committed subrange retains the initial reservation base');
  assert.strictEqual(mbi(e).state, 0x1000);
  assert.strictEqual(mbi(e).protect, 0x20);
  assert.strictEqual(mbi(e).size, 0x1000);

  assert.strictEqual(e.test_virtual_protect(reserve + 0x1000, 1, 0x02, OLD_PROTECT), 1);
  assert.strictEqual(e.test_virtual_query(reserve + 0x1000, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).protect, 0x02,
    'VirtualQuery reads sparse current protection from the packed PTE');
  assert.strictEqual(mbi(e).allocationProtect, 0x04,
    'a later commit does not replace the reservation allocation protection');

  assert.strictEqual(e.test_virtual_query(reserve - 0x2000, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).state, 0x10000, 'a sparse gap is MEM_FREE');
  assert.strictEqual(mbi(e).size, 0x2000,
    'a free query reports bytes from the queried page to the next allocation');
  assert.strictEqual(mbi(e).allocationBase, 0);
  assert.strictEqual(mbi(e).protect, 0);
  assert.strictEqual(mbi(e).type, 0);

  assert.strictEqual(e.test_virtual_free(reserve, 0, 0x8000), 1,
    'MEM_RELEASE frees the initial reservation');
  assert.strictEqual(e.test_virtual_query(reserve, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).state, 0x10000,
    'a released sparse allocation becomes MEM_FREE');

  const dll = makePe({ imageBase: 0x10000000, dll: true });
  new Uint8Array(memory.buffer).set(dll, e.get_staging());
  const dllBase = e.get_next_dll_addr() >>> 0;
  e.load_dll(dll.length, dllBase);
  assert.strictEqual(e.test_virtual_query(dllBase + 0x3123, QUERY_BUFFER, 28), 28);
  assert.strictEqual(mbi(e).allocationBase, dllBase,
    'relocated DLL pages retain their mapped module allocation base');
  assert.strictEqual(mbi(e).protect, 0x02,
    'VirtualQuery reads a loaded DLL section table after staging is reusable');
  assert.strictEqual(mbi(e).type, 0x01000000);

  assert.strictEqual(e.test_virtual_query(0x80000000, QUERY_BUFFER, 28), 0,
    'kernel-space query still fails');
  assert.strictEqual(e.test_virtual_query(IMAGE_BASE, 0, 28), 0,
    'NULL output still fails');

  console.log('PASS VirtualQuery reports PE image and sparse allocation state/protection truthfully');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
