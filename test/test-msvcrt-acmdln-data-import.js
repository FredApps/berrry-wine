#!/usr/bin/env node

'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

const ROOT = path.join(__dirname, '..');

// One PE32 section containing an MSVCRT import descriptor, lookup table, IAT,
// and two imports. Its entry point mirrors 7zFM 9.20 at 0x441fcf/0x441fd4:
// load the _acmdln IAT entry, then load the char * stored in that data symbol.
function makeStaticAcmdlnPe() {
  const bytes = Buffer.alloc(0x600);
  const pe = 0x80;
  const opt = pe + 24;
  const section = opt + 0xE0;

  bytes.writeUInt16LE(0x5A4D, 0);
  bytes.writeUInt32LE(pe, 0x3C);
  bytes.writeUInt32LE(0x00004550, pe);
  bytes.writeUInt16LE(0x014C, pe + 4);       // IMAGE_FILE_MACHINE_I386
  bytes.writeUInt16LE(1, pe + 6);
  bytes.writeUInt16LE(0xE0, pe + 20);
  bytes.writeUInt16LE(0x010F, pe + 22);

  bytes.writeUInt16LE(0x010B, opt);          // PE32
  bytes.writeUInt32LE(0x400, opt + 4);
  bytes.writeUInt32LE(0x1000, opt + 16);     // AddressOfEntryPoint
  bytes.writeUInt32LE(0x1000, opt + 20);     // BaseOfCode
  bytes.writeUInt32LE(0x400000, opt + 28);   // ImageBase
  bytes.writeUInt32LE(0x1000, opt + 32);     // SectionAlignment
  bytes.writeUInt32LE(0x200, opt + 36);      // FileAlignment
  bytes.writeUInt32LE(0x2000, opt + 56);     // SizeOfImage
  bytes.writeUInt32LE(0x200, opt + 60);      // SizeOfHeaders
  bytes.writeUInt32LE(16, opt + 92);         // NumberOfRvaAndSizes
  bytes.writeUInt32LE(0x1100, opt + 104);    // Import directory RVA
  bytes.writeUInt32LE(40, opt + 108);

  bytes.write('.text\0\0\0', section, 'ascii');
  bytes.writeUInt32LE(0x400, section + 8);
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(0x400, section + 16);
  bytes.writeUInt32LE(0x200, section + 20);
  bytes.writeUInt32LE(0xE0000060, section + 36);

  // mov eax,[0x401140]; mov eax,[eax]; ret
  Buffer.from([0xA1, 0x40, 0x11, 0x40, 0x00, 0x8B, 0x00, 0xC3])
    .copy(bytes, 0x200);

  bytes.writeUInt32LE(0x1130, 0x300);        // OriginalFirstThunk
  bytes.writeUInt32LE(0x1180, 0x30C);        // DLL name RVA
  bytes.writeUInt32LE(0x1140, 0x310);        // FirstThunk / IAT
  bytes.writeUInt32LE(0x1190, 0x330);        // _acmdln lookup
  bytes.writeUInt32LE(0x11A0, 0x334);        // ordinary function lookup
  bytes.writeUInt32LE(0x1190, 0x340);
  bytes.writeUInt32LE(0x11A0, 0x344);
  bytes.write('MSVCRT.dll\0', 0x380, 'ascii');
  bytes.writeUInt16LE(143, 0x390);
  bytes.write('_acmdln\0', 0x392, 'ascii');
  bytes.writeUInt16LE(183, 0x3A0);
  bytes.write('_controlfp\0', 0x3A2, 'ascii');
  return bytes;
}

const extraWat = String.raw`
  (func (export "test_p_acmdln") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle___p__acmdln
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_proc_address") (param $name i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetProcAddress
      (i32.const 0x00400000) (local.get $name) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const sevenZip = path.join(ROOT, 'test', 'binaries', 'candidates',
    '7zip-file-manager', '7zFM.exe');
  if (require('fs').existsSync(sevenZip)) {
    const audit = execFileSync('node', [
      path.join(ROOT, 'tools', 'unimplemented-imports.js'), sevenZip,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert(!audit.includes('_acmdln'),
      'static trap audit recognizes the loader-owned MSVCRT data import');
  }
  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  let mem = new Uint8Array(memory.buffer);
  const staging = wat.get_staging() >>> 0;
  mem.set(Buffer.from('7zFM.exe', 'ascii'), staging);
  wat.set_exe_name(staging, 8);
  mem.set(Buffer.from('archive.7z', 'ascii'), staging);
  wat.set_extra_cmdline(staging, 10);

  const pe = makeStaticAcmdlnPe();
  mem.set(pe, staging);
  assert.strictEqual(wat.load_pe(pe.length) >>> 0, 0x401000, 'fixture PE loads');

  const view = new DataView(memory.buffer);
  const acmdlnIatWa = RegionMap.GUEST_BASE + 0x1140;
  const controlfpIatWa = acmdlnIatWa + 4;
  const acmdlnCell = view.getUint32(acmdlnIatWa, true) >>> 0;
  const commandLine = wat.guest_read32(acmdlnCell) >>> 0;
  const firstThunk = wat.get_thunk_base() >>> 0;

  assert(acmdlnCell, '_acmdln IAT entry is resolved');
  assert.notStrictEqual(acmdlnCell, firstThunk,
    '_acmdln IAT entry is a data address, not its reserved function-thunk slot');
  assert.strictEqual(view.getUint32(controlfpIatWa, true) >>> 0, firstThunk + 8,
    'an ordinary MSVCRT function import still resolves to the next callable thunk');
  assert.strictEqual(acmdlnCell, wat.test_p_acmdln() >>> 0,
    'static import and __p__acmdln expose the same CRT pointer cell');

  mem = new Uint8Array(memory.buffer);
  const dynamicName = 0x4011C0;
  mem.set(Buffer.from('_acmdln\0', 'ascii'), RegionMap.GUEST_BASE + 0x11C0);
  assert.strictEqual(wat.test_get_proc_address(dynamicName) >>> 0, acmdlnCell,
    'static and dynamic _acmdln resolution return the same data symbol');

  const readCString = guest => {
    let out = '';
    for (let i = 0; ; i++) {
      const ch = wat.guest_read8((guest + i) >>> 0);
      if (ch === 0) break;
      out += String.fromCharCode(ch);
    }
    return out;
  };
  assert.strictEqual(readCString(commandLine), 'C:\\7zFM.exe archive.7z',
    '_acmdln cell holds the process-stable complete ANSI command line');

  wat.call_func(0x401000, 0, 0, 0, 0);
  for (let i = 0; i < 20 && wat.get_eip(); i++) wat.run(1000);
  assert.strictEqual(wat.get_eip(), 0, '7z-style double dereference returns cleanly');
  assert.strictEqual(wat.get_eax() >>> 0, commandLine,
    '7z-style code obtains the command-line pointer through the static IAT cell');

  console.log('PASS static MSVCRT _acmdln data import uses a real pointer cell');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
