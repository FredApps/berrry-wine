#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readPE } = require('../lib/pe');
const { bootRenderHarness } = require('./render-helper');
const { parseNativeTls, fixture } = require('./test-tls-native-fixture');

(async () => {
  const reference = parseNativeTls(fs.readFileSync(fixture, 'utf8'));
  const main = await bootRenderHarness({ fonts: 'none' });
  const peer = await bootRenderHarness({ fonts: 'none', memory: main.memory });
  const a = main.exports, b = peer.exports;
  a.init_thread(1, 0x400000, 0, 0, 0, 0, 0, 0);
  b.init_thread(2, 0x400000, 0, 0, 0, 0, 0, 0);
  const observed = new Map();
  let compared = 0;
  const call = (e, name, args = []) => {
    e.test_call_SetLastError(4660);
    e.set_esp(0x07408000);
    const result = e[`test_call_${name}`](...args) >>> 0;
    assert.strictEqual(e.get_esp() >>> 0, 0x07408000, `${name}: test wrapper restores ESP`);
    return { result, error: e.test_call_GetLastError() >>> 0 };
  };
  const row = (label, e, name, ...args) => {
    const actual = call(e, name, args);
    assert.deepStrictEqual(actual, reference.rows.get(label), label);
    observed.set(label, actual); compared++;
    return actual.result;
  };
  for (const expected of reference.allocations) {
    assert.deepStrictEqual(call(a, 'TlsAlloc'), expected, `allocation ${expected.result}`);
    compared++;
  }
  row('exhausted', a, 'TlsAlloc');
  const index = reference.rows.get('chosen').result;
  row('initial-main', a, 'TlsGetValue', index);
  row('set-main-status', a, 'TlsSetValue', index, 0x11223344);
  assert.strictEqual(call(b, 'TlsSetValue', [index, 0x55667788]).result, 1);
  row('set-main', a, 'TlsGetValue', index);
  row('set-worker', b, 'TlsGetValue', index);
  const mainVector = a.get_tls_slots() >>> 0, peerVector = b.get_tls_slots() >>> 0;
  assert.notStrictEqual(mainVector, peerVector);
  row('free', a, 'TlsFree', index);
  assert.strictEqual(a.guest_read32(mainVector + index * 4), 0, 'raw main TLS vector cleared');
  assert.strictEqual(b.guest_read32(peerVector + index * 4), 0, 'raw worker TLS vector cleared');
  // Spawn snapshots carry a high-water mark, not ownership of freed holes.
  b.set_tls_next_index(80);
  a.set_tls_next_index(20);
  row('freed-main', a, 'TlsGetValue', index);
  row('freed-worker', b, 'TlsGetValue', index);
  row('free-again', a, 'TlsFree', index);
  row('reuse-main', a, 'TlsAlloc');
  row('reused-main', a, 'TlsGetValue', index);
  row('reused-worker', b, 'TlsGetValue', index);
  assert.strictEqual(call(a, 'TlsSetValue', [index, 0x99aabbcc]).result, 1);
  row('free-for-worker', a, 'TlsFree', index);
  row('reuse-by-worker', b, 'TlsAlloc');
  row('worker-reused-main', a, 'TlsGetValue', index);
  row('worker-reused-worker', b, 'TlsGetValue', index);
  row('set-index-64', a, 'TlsSetValue', 64, 0xabcdef01);
  row('get-index-64', a, 'TlsGetValue', 64);
  row('set-index-79', a, 'TlsSetValue', 79, 0x12345678);
  row('get-index-79', a, 'TlsGetValue', 79);
  row('set-index-80', a, 'TlsSetValue', 80, 0x12345678);
  row('get-index-80', a, 'TlsGetValue', 80);
  row('get-index-81', a, 'TlsGetValue', 81);
  row('invalid-get-max', a, 'TlsGetValue', 0xffffffff);
  row('free-index-64', a, 'TlsFree', 64);
  row('freed-index-64', a, 'TlsGetValue', 64);
  row('free-index-80', a, 'TlsFree', 80);
  row('invalid-free-max', a, 'TlsFree', 0xffffffff);
  assert.strictEqual(observed.size, reference.rows.size - 3, 'all API observations replayed (not version/capacity/chosen metadata)');

  // A later-created thread must join clearing too, without changing allocated
  // indices or inheriting values from either existing thread.
  const late = (await bootRenderHarness({ fonts: 'none', memory: main.memory })).exports;
  late.init_thread(3, 0x400000, 0, 0, 0, 0, 0, 0);
  assert.strictEqual(call(late, 'TlsGetValue', [79]).result, 0);
  assert.strictEqual(call(late, 'TlsSetValue', [79, 0x12345678]).result, 1);
  assert.strictEqual(call(b, 'TlsFree', [79]).result, 1);
  assert.strictEqual(late.guest_read32((late.get_tls_slots() >>> 0) + 79 * 4), 0);
  assert.strictEqual(call(a, 'TlsGetValue', [79]).result, 0);

  // Synthetic static TLS directory in a real PE: preserve the loader contract
  // that FS:[0x2c][assigned index] points at template bytes plus zero fill.
  const loader = await bootRenderHarness({ fonts: 'none' });
  const e = loader.exports;
  const image = fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'));
  const pe = readPE(image);
  const section = pe.sections.find(section => section.name === '.rsrc' && section.rawSize >= 128);
  assert(section, 'fixture needs a resource-section tail');
  const rva = section.rva + section.rawSize - 128;
  const offset = pe.va2off(pe.imageBase + rva);
  image.fill(0, offset, offset + 128);
  image.writeUInt32LE(rva, pe.peOff + 24 + 96 + 9 * 8);
  image.writeUInt32LE(24, pe.peOff + 24 + 96 + 9 * 8 + 4);
  image.writeUInt32LE(pe.imageBase + rva + 32, offset);
  image.writeUInt32LE(pe.imageBase + rva + 36, offset + 4);
  image.writeUInt32LE(pe.imageBase + rva + 48, offset + 8);
  image.writeUInt32LE(8, offset + 16);
  image.writeUInt32LE(0x12345678, offset + 32);
  new Uint8Array(loader.memory.buffer).set(image, e.get_staging());
  assert(e.load_pe(image.length));
  const staticIndex = e.guest_read32(pe.imageBase + rva + 48) >>> 0;
  const staticVector = e.guest_read32((e.get_fs_base() >>> 0) + 0x2c) >>> 0;
  assert.strictEqual(staticVector, e.get_tls_slots() >>> 0);
  const template = e.guest_read32(staticVector + staticIndex * 4) >>> 0;
  assert(template);
  assert.strictEqual(e.guest_read32(template) >>> 0, 0x12345678);
  assert.strictEqual(e.guest_read32(template + 4), 0);
  assert.strictEqual(e.guest_read32(template + 8), 0);
  const dynamic = call(e, 'TlsAlloc').result;
  assert.notStrictEqual(dynamic, staticIndex, 'dynamic allocation cannot take the static PE reservation');
  assert.strictEqual(call(e, 'TlsFree', [dynamic]).result, 1);
  assert.strictEqual(call(e, 'TlsAlloc').result, dynamic);
  assert.strictEqual(e.guest_read32(staticVector + staticIndex * 4) >>> 0, template);

  // A later thread copies the EXE template, not the parent's modified block or
  // dynamic values. Use the same vector creation path as both thread backends.
  e.guest_write32(template, 0x87654321);
  call(e, 'TlsSetValue', [dynamic, 0x11223344]);
  const thread = (await bootRenderHarness({ fonts: 'none', memory: loader.memory })).exports;
  thread.init_thread(1, pe.imageBase, 0, 0, 0, 0, 0, 0);
  const threadVector = thread.ensure_tls_slots() >>> 0;
  const threadTemplate = thread.guest_read32(threadVector + staticIndex * 4) >>> 0;
  assert(threadTemplate && threadTemplate !== template);
  assert.strictEqual(thread.guest_read32(threadTemplate) >>> 0, 0x12345678);
  assert.strictEqual(thread.guest_read32(threadTemplate + 4), 0);
  assert.strictEqual(thread.guest_read32(threadVector + dynamic * 4), 0);
  assert.strictEqual(e.guest_read32(template) >>> 0, 0x87654321);

  // A synthetic DLL adds relocated TLS to already existing threads. Its small
  // relocation block describes the three VA fields in the TLS directory; no
  // guest code is executed from this fixture image.
  const dll = Buffer.from(image);
  dll.writeUInt16LE(dll.readUInt16LE(pe.peOff + 22) | 0x2000, pe.peOff + 22);
  dll.writeUInt32LE(0xabcdef01, offset + 32);
  dll.writeUInt32LE(rva + 64, pe.peOff + 24 + 96 + 5 * 8);
  dll.writeUInt32LE(16, pe.peOff + 24 + 96 + 5 * 8 + 4);
  dll.writeUInt32LE(rva & ~0xfff, offset + 64);
  dll.writeUInt32LE(16, offset + 68);
  for (let i = 0; i < 3; i++) dll.writeUInt16LE(0x3000 | ((rva + i * 4) & 0xfff), offset + 72 + i * 2);
  dll.writeUInt16LE(0, offset + 78);
  const dllBase = e.get_next_dll_addr() >>> 0;
  const dllCount = e.get_dll_count();
  new Uint8Array(loader.memory.buffer).set(dll, e.get_staging());
  assert(e.load_dll(dll.length, dllBase), 'DLL with relocated TLS loads');
  assert.strictEqual(e.get_dll_count(), dllCount + 1);
  const dllIndex = e.guest_read32(dllBase + rva + 48) >>> 0;
  assert.notStrictEqual(dllIndex, staticIndex);
  assert.notStrictEqual(dllIndex, dynamic);
  const dllMainData = e.guest_read32(staticVector + dllIndex * 4) >>> 0;
  const dllThreadData = thread.guest_read32(threadVector + dllIndex * 4) >>> 0;
  assert(dllMainData && dllThreadData && dllMainData !== dllThreadData);
  for (const ptr of [dllMainData, dllThreadData]) {
    assert.strictEqual(e.guest_read32(ptr) >>> 0, 0xabcdef01);
    assert.strictEqual(e.guest_read32(ptr + 4), 0);
    assert.strictEqual(e.guest_read32(ptr + 8), 0);
  }
  e.guest_write32(dllMainData, 0x55667788);
  assert.strictEqual(thread.guest_read32(dllThreadData) >>> 0, 0xabcdef01);
  const laterThread = (await bootRenderHarness({ fonts: 'none', memory: loader.memory })).exports;
  laterThread.init_thread(2, pe.imageBase, 0, 0, 0, 0, 0, 0);
  const laterVector = laterThread.ensure_tls_slots() >>> 0;
  const laterDllData = laterThread.guest_read32(laterVector + dllIndex * 4) >>> 0;
  assert(laterDllData && laterDllData !== dllMainData && laterDllData !== dllThreadData);
  assert.strictEqual(laterThread.guest_read32(laterDllData) >>> 0, 0xabcdef01);
  assert.strictEqual(laterThread.guest_read32(laterDllData + 8), 0);
  assert.strictEqual(laterThread.guest_read32(laterThread.guest_read32(laterVector + staticIndex * 4)) >>> 0,
    0x12345678, 'later thread gets both EXE and DLL templates');
  assert.strictEqual(laterThread.ensure_tls_slots() >>> 0, laterVector);
  assert.strictEqual(e.guest_read32(dllMainData) >>> 0, 0x55667788,
    'ensuring TLS never reinitializes an existing block');

  // An invalid TLS directory must not publish a DLL or consume a TLS index.
  const malformed = Buffer.from(dll);
  malformed.writeUInt32LE(malformed.readUInt32LE(pe.peOff + 80) - 8, pe.peOff + 24 + 96 + 9 * 8);
  const nextIndex = e.get_tls_next_index();
  new Uint8Array(loader.memory.buffer).set(malformed, e.get_staging());
  assert.strictEqual(e.load_dll(malformed.length, e.get_next_dll_addr()), 0);
  assert.strictEqual(e.get_dll_count(), dllCount + 1);
  assert.strictEqual(e.get_tls_next_index(), nextIndex);
  assert.strictEqual(e.test_call_GetLastError(), 193);
  const { loadDll } = require('../lib/dll-loader');
  assert.throws(() => loadDll(e, loader.memory.buffer, malformed), /DLL loader rejected/,
    'host must not return a module handle for rejected TLS metadata');

  const zeroOnly = Buffer.from(dll);
  zeroOnly.writeUInt32LE(pe.imageBase + rva + 32, offset + 4);
  zeroOnly.writeUInt32LE(12, offset + 16);
  const zeroModule = loadDll(e, loader.memory.buffer, zeroOnly);
  const zeroIndex = e.guest_read32(zeroModule.loadAddr + rva + 48) >>> 0;
  for (const vector of [staticVector, threadVector, laterVector]) {
    const data = e.guest_read32(vector + zeroIndex * 4) >>> 0;
    assert(data, 'zero-only TLS has a real block in every existing thread');
    for (let off = 0; off < 12; off += 4) assert.strictEqual(e.guest_read32(data + off), 0);
  }
  while (call(e, 'TlsAlloc').result !== 0xffffffff) {}
  const fullCount = e.get_dll_count();
  assert.throws(() => loadDll(e, loader.memory.buffer, dll), /DLL loader rejected/,
    'TLS index exhaustion fails DLL loading');
  assert.strictEqual(e.get_dll_count(), fullCount, 'failed TLS registration publishes no module');
  assert.strictEqual(e.test_call_GetLastError(), 8);
  assert.strictEqual(e.guest_read32(dllMainData) >>> 0, 0x55667788);
  console.log(`PASS ${compared} native TLS API observations, raw cross-thread clearing, stale spawn metadata and late-thread registration`);
  console.log('PASS static PE TLS template, zero fill and reservation survive dynamic index reuse');
  console.log('PASS relocated DLL TLS, existing/new thread initialization, independent values and invalid-directory rejection');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
