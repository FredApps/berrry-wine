#!/usr/bin/env node
'use strict';

// The KERNEL/OLE behaviors Visual Basic 5 CCE's setup and IDE depend on:
//   - lstrcmp/lstrcmpi use CompareString's word sort, not a byte compare
//     (SetupAPI's sorted INF string table misses "CommonFilesDir" otherwise);
//   - DeleteFileA reports ERROR_FILE_NOT_FOUND instead of a stale last error
//     (setup put up "Delete Error" from a leftover ERROR_NOT_ENOUGH_MEMORY);
//   - CLSIDFromString accepts only a braced GUID or a registered ProgID, so a
//     .pag file's "VB.PropertyPage" is looked up rather than half-parsed;
//   - IIDFromString, and OleSetMenuDescriptor's NULL (remove) form.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');
const apiTable = require('../src/api_table.json');
const RegionMap = require('../lib/region-map.generated.js');

const ROOT = path.join(__dirname, '..');

async function main() {
  const wasm = compileSrcWasm();
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer, renderer: null, resourceJson: {} };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  Object.assign(imports.host, {
    create_thread: () => 0,
    exit_thread: () => 0,
    terminate_thread: () => 0,
    create_event: () => 0,
    set_event: () => 0,
    reset_event: () => 0,
    wait_single: () => 0,
    wait_multiple: () => 0,
    com_create_instance: () => 0x80004002,
  });

  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = instance.exports;
  ctx.exports = e; // the registry backend translates guest pointers through these
  const exe = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert(e.load_pe(exe.length), 'fixture PE should initialize API thunks');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const dv = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const thunkWa = RegionMap.BASE.THUNK_BASE;
  const thunkGuest = (thunkWa - guestBase + imageBase) >>> 0;

  function strA(s) {
    const p = e.guest_alloc(s.length + 1) >>> 0;
    bytes.set([...Buffer.from(s, 'latin1'), 0], wa(p));
    return p;
  }
  function strW(s) {
    const p = e.guest_alloc(2 * s.length + 2) >>> 0;
    for (let i = 0; i < s.length; i++) dv.setUint16(wa(p) + 2 * i, s.charCodeAt(i), true);
    dv.setUint16(wa(p) + 2 * s.length, 0, true);
    return p;
  }
  function guid(p) {
    const b = bytes.slice(wa(p), wa(p) + 16);
    const hex = n => [...b.slice(...n)].map(x => x.toString(16).padStart(2, '0')).join('');
    const le = (o, n) => [...b.slice(o, o + n)].reverse().map(x => x.toString(16).padStart(2, '0')).join('');
    return `{${le(0, 4)}-${le(4, 2)}-${le(6, 2)}-${hex([8, 10])}-${hex([10, 16])}}`.toUpperCase();
  }

  // call_func pushes four arguments; stdcall arguments past the fourth sit
  // above them, so they are pushed first and the callee pops them all.
  function callApi(name, ...args) {
    const api = apiTable.find(entry => entry.name === name);
    assert(api, `${name} must exist in api_table.json`);
    assert.strictEqual(api.nargs, args.length, `${name} argument count`);
    const esp0 = e.get_esp() >>> 0;
    for (let i = args.length - 1; i >= 4; i--) {
      e.set_esp((e.get_esp() - 4) >>> 0);
      dv.setUint32(wa(e.get_esp() >>> 0), args[i] >>> 0, true);
    }
    const head = args.slice(0, 4);
    while (head.length < 4) head.push(0);
    dv.setUint32(thunkWa + 4, api.id >>> 0, true);
    e.call_func(thunkGuest, ...head);
    for (let i = 0; i < 500 && e.get_eip(); i++) e.run(5000);
    assert.strictEqual(e.get_eip(), 0, `${name} call must terminate`);
    // A four-slot frame was pushed for a call with fewer arguments.
    e.set_esp(esp0);
    return e.get_eax() | 0;
  }
  const sign = v => Math.sign(v | 0);

  // --- lstrcmp / lstrcmpi: word sort ---
  assert.strictEqual(sign(callApi('lstrcmpA', strA('CommonFilesDir'), strA('SetupkitSetup1'))), -1,
    'lstrcmpA orders letters case-insensitively first (a byte compare says +1)');
  assert.strictEqual(sign(callApi('lstrcmpA', strA('abc'), strA('ABC'))), -1,
    'lstrcmpA breaks a case-only tie lowercase first');
  assert.strictEqual(callApi('lstrcmpiA', strA('abc'), strA('ABC')), 0,
    'lstrcmpiA ignores case');
  assert.strictEqual(sign(callApi('lstrcmpiA', strA('co-op'), strA('coop'))), 1,
    'a hyphen is ignored at the primary level and decides last');
  assert.strictEqual(sign(callApi('lstrcmpiW', strW('commonfilesdir'), strW('SetupkitSetup1'))), -1,
    'lstrcmpiW uses the same ordering');
  assert.strictEqual(sign(callApi('lstrcmpA', 0, strA('a'))), -1, 'NULL sorts before a string');

  // --- DeleteFileA sets the last error on failure ---
  callApi('SetLastError', 8);
  assert.strictEqual(callApi('DeleteFileA', strA('c:\\no\\such\\file.tmp')), 0,
    'deleting a missing file fails');
  assert.strictEqual(callApi('GetLastError'), 2,
    'DeleteFileA replaces a stale last error with ERROR_FILE_NOT_FOUND');

  // --- CLSIDFromString ---
  const out = e.guest_alloc(16) >>> 0;
  const clsid = '{0BE35203-8F91-11CE-9DE3-00AA004BB851}';
  assert.strictEqual(callApi('CLSIDFromString', strW(clsid), out), 0, 'braced CLSID parses');
  assert.strictEqual(guid(out), clsid, 'braced CLSID round-trips');

  bytes.fill(0xcc, wa(out), wa(out) + 16);
  assert.strictEqual(callApi('CLSIDFromString', 0, out), 0, 'NULL string gives CLSID_NULL');
  assert.deepStrictEqual([...bytes.slice(wa(out), wa(out) + 16)], new Array(16).fill(0),
    'NULL string writes CLSID_NULL');

  assert.strictEqual(callApi('CLSIDFromString', strW(clsid), 0) >>> 0, 0x80004003,
    'NULL output is E_POINTER');
  assert.strictEqual(callApi('CLSIDFromString', strW('{0BE35203-8F91-11CE-9DE3-00AA004BB85}'), out) >>> 0,
    0x800401F3, 'a short braced GUID is CO_E_CLASSSTRING');
  assert.strictEqual(callApi('CLSIDFromString', strW('VB.PropertyPage'), out) >>> 0, 0x800401F3,
    'an unregistered ProgID is CO_E_CLASSSTRING');

  // Register HKCR\Test.ProgId\CLSID = {clsid}; the ProgID form now resolves.
  const HKCR = 0x80000000;
  assert.strictEqual(callApi('RegSetValueA', HKCR, strA('Test.ProgId\\CLSID'), 1,
    strA(clsid), clsid.length + 1), 0, 'registry accepts the ProgID key');
  bytes.fill(0xcc, wa(out), wa(out) + 16);
  assert.strictEqual(callApi('CLSIDFromString', strW('Test.ProgId'), out), 0,
    'a registered ProgID resolves through HKCR\\<progid>\\CLSID');
  assert.strictEqual(guid(out), clsid, 'ProgID lookup yields the registered CLSID');
  bytes.fill(0xcc, wa(out), wa(out) + 16);
  assert.strictEqual(callApi('CLSIDFromProgID', strW('Test.ProgId'), out), 0,
    'CLSIDFromProgID uses the same registry lookup');
  assert.strictEqual(guid(out), clsid, 'CLSIDFromProgID yields the registered CLSID');

  // --- IIDFromString ---
  const iid = '{00000000-0000-0000-C000-000000000046}';
  assert.strictEqual(callApi('IIDFromString', strW(iid), out), 0, 'IIDFromString parses a braced IID');
  assert.strictEqual(guid(out), iid, 'IIDFromString round-trips');
  assert.strictEqual(callApi('IIDFromString', strW('IUnknown'), out) >>> 0, 0x800401F4,
    'IIDFromString takes no ProgID form: CO_E_IIDSTRING');
  bytes.fill(0xcc, wa(out), wa(out) + 16);
  assert.strictEqual(callApi('IIDFromString', 0, out), 0, 'NULL string gives IID_NULL');
  assert.deepStrictEqual([...bytes.slice(wa(out), wa(out) + 16)], new Array(16).fill(0),
    'NULL string writes IID_NULL');

  // --- OleSetMenuDescriptor(NULL, ...) removes the (absent) dispatch hook ---
  assert.strictEqual(callApi('OleSetMenuDescriptor', 0, 0x1234, 0x5678, 0, 0), 0,
    'OleSetMenuDescriptor with a NULL descriptor succeeds');

  console.log('test-vb5-setup-com-apis: PASS');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
