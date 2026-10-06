#!/usr/bin/env node
'use strict';

// Import descriptors without OriginalFirstThunk, bound against a loaded DLL.
//
// Borland/Delphi linkers leave OriginalFirstThunk 0 and keep the hint/name
// RVAs only in FirstThunk. Every Delphi app built with runtime packages (Age
// of Wonders: aow.exe imports 19 .dpl packages) is laid out that way. The EXE
// is mapped before any package, so the PE loader turns each such IAT slot into
// an API stub, and $patch_caller_iat used to stop its descriptor walk at the
// first zero OriginalFirstThunk: no import was ever bound to its package, and
// the first call (System.LoadResourceModule) trapped as an unimplemented API.
//
// The fixture is two synthetic images, so no corpus binary is needed: an EXE
// importing Foo and Bar by name from pkg.dpl through an OFT-less descriptor,
// and pkg.dpl exporting both. They are loaded through the production
// lib/dll-loader.js path, and each IAT slot must then hold the export's
// address. Bar is imported twice, from two descriptors, because the loader
// calls $patch_caller_iat once per descriptor and the second pass must not
// read an already-bound slot as a name RVA.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { loadDlls } = require('../lib/dll-loader');

const SECT = 0x1000;

// A PE32 image with one RWX section at RVA 0x1000 holding `body` (a Buffer
// sized to the section). dirs: { exportRva, exportSize, importRva, importSize }.
function pe({ imageBase, dll, body, dirs, entry = 0 }) {
  const fileAlign = 0x200;
  const hdr = Buffer.alloc(0x200);
  hdr.write('MZ', 0);
  hdr.writeUInt32LE(0x40, 0x3c);
  hdr.write('PE\0\0', 0x40, 'latin1');
  const fh = 0x44;
  hdr.writeUInt16LE(0x14c, fh);                  // i386
  hdr.writeUInt16LE(1, fh + 2);                  // one section
  hdr.writeUInt16LE(224, fh + 16);               // SizeOfOptionalHeader
  hdr.writeUInt16LE(dll ? 0x2102 : 0x0102, fh + 18);
  const oh = fh + 20;
  hdr.writeUInt16LE(0x10b, oh);
  hdr.writeUInt32LE(entry, oh + 16);             // AddressOfEntryPoint
  hdr.writeUInt32LE(imageBase, oh + 28);
  hdr.writeUInt32LE(SECT, oh + 32);              // SectionAlignment
  hdr.writeUInt32LE(fileAlign, oh + 36);
  hdr.writeUInt16LE(4, oh + 40);                 // OS version
  hdr.writeUInt16LE(4, oh + 48);                 // subsystem version
  hdr.writeUInt32LE(SECT + body.length, oh + 56); // SizeOfImage
  hdr.writeUInt32LE(0x200, oh + 60);             // SizeOfHeaders
  hdr.writeUInt16LE(2, oh + 68);                 // GUI
  hdr.writeUInt32LE(0x100000, oh + 72);
  hdr.writeUInt32LE(0x1000, oh + 76);
  hdr.writeUInt32LE(0x100000, oh + 80);
  hdr.writeUInt32LE(0x1000, oh + 84);
  hdr.writeUInt32LE(16, oh + 92);                // NumberOfRvaAndSizes
  hdr.writeUInt32LE(dirs.exportRva || 0, oh + 96);
  hdr.writeUInt32LE(dirs.exportSize || 0, oh + 100);
  hdr.writeUInt32LE(dirs.importRva || 0, oh + 104);
  hdr.writeUInt32LE(dirs.importSize || 0, oh + 108);
  const sh = oh + 224;
  hdr.write('.text', sh, 'latin1');
  hdr.writeUInt32LE(body.length, sh + 8);        // VirtualSize
  hdr.writeUInt32LE(SECT, sh + 12);              // VirtualAddress
  hdr.writeUInt32LE(body.length, sh + 16);       // SizeOfRawData
  hdr.writeUInt32LE(0x200, sh + 20);             // PointerToRawData
  hdr.writeUInt32LE(0xE0000060, sh + 36);        // code|data, RWX
  return Buffer.concat([hdr, body]);
}

// pkg.dpl: Foo = mov eax,0x1111; ret   Bar = mov eax,0x2222; ret
function packageImage() {
  const body = Buffer.alloc(0x400);
  const at = rva => rva - SECT;
  body.set([0xB8, 0x11, 0x11, 0, 0, 0xC3], at(0x1000));
  body.set([0xB8, 0x22, 0x22, 0, 0, 0xC3], at(0x1010));
  const exp = 0x1100;
  body.writeUInt32LE(0x1180, at(exp + 12));      // Name
  body.writeUInt32LE(1, at(exp + 16));           // Base
  body.writeUInt32LE(2, at(exp + 20));           // NumberOfFunctions
  body.writeUInt32LE(2, at(exp + 24));           // NumberOfNames
  body.writeUInt32LE(0x1140, at(exp + 28));      // AddressOfFunctions
  body.writeUInt32LE(0x1150, at(exp + 32));      // AddressOfNames
  body.writeUInt32LE(0x1160, at(exp + 36));      // AddressOfNameOrdinals
  body.writeUInt32LE(0x1010, at(0x1140));        // Bar (sorted names first)
  body.writeUInt32LE(0x1000, at(0x1144));        // Foo
  body.writeUInt32LE(0x1190, at(0x1150));
  body.writeUInt32LE(0x11a0, at(0x1154));
  body.writeUInt16LE(0, at(0x1160));
  body.writeUInt16LE(1, at(0x1162));
  body.write('pkg.dpl\0', at(0x1180), 'latin1');
  body.write('Bar\0', at(0x1190), 'latin1');
  body.write('Foo\0', at(0x11a0), 'latin1');
  return pe({ imageBase: 0x10000000, dll: true, body,
    dirs: { exportRva: exp, exportSize: 0xc0 } });
}

// The EXE: descriptor 0 imports Foo, Bar; descriptor 1 imports Bar again.
// Both leave OriginalFirstThunk 0, as Borland's linker does.
function exeImage() {
  const body = Buffer.alloc(0x400);
  const at = rva => rva - SECT;
  body.set([0xC3], at(0x1000));                  // entry: ret
  const imp = 0x1100;
  body.writeUInt32LE(0, at(imp + 0));            // OriginalFirstThunk
  body.writeUInt32LE(0x1180, at(imp + 12));      // Name
  body.writeUInt32LE(0x1200, at(imp + 16));      // FirstThunk
  body.writeUInt32LE(0, at(imp + 20));
  body.writeUInt32LE(0x1180, at(imp + 20 + 12));
  body.writeUInt32LE(0x1220, at(imp + 20 + 16));
  body.write('pkg.dpl\0', at(0x1180), 'latin1');
  body.write('\0\0Foo\0', at(0x1190), 'latin1');
  body.write('\0\0Bar\0', at(0x11a0), 'latin1');
  body.writeUInt32LE(0x1190, at(0x1200));
  body.writeUInt32LE(0x11a0, at(0x1204));
  body.writeUInt32LE(0x11a0, at(0x1220));
  return pe({ imageBase: 0x400000, dll: false, body, entry: 0x1000,
    dirs: { importRva: imp, importSize: 60 } });
}

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const exeBytes = exeImage();
  new Uint8Array(memory.buffer).set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);
  const r32 = g => new DataView(memory.buffer).getUint32(e.guest_to_wasm(g) >>> 0, true) >>> 0;
  const base = e.get_image_base() >>> 0;
  const stub = r32(base + 0x1200);
  assert.notStrictEqual(stub, 0x1190, 'the PE loader replaced the name RVA with an API stub');

  const [pkg] = loadDlls(e, memory.buffer, exeBytes,
    [{ name: 'pkg.dpl', bytes: packageImage() }], null);
  const dllBase = pkg.loadAddr >>> 0;
  const hex = v => '0x' + (v >>> 0).toString(16);
  assert.strictEqual(hex(r32(base + 0x1200)), hex(dllBase + 0x1000), 'Foo is bound to pkg.dpl');
  assert.strictEqual(hex(r32(base + 0x1204)), hex(dllBase + 0x1010), 'Bar is bound to pkg.dpl');
  assert.strictEqual(hex(r32(base + 0x1220)), hex(dllBase + 0x1010),
    'the second descriptor binds Bar too');
  console.log('PASS  OFT-less (Borland) import descriptors bind to a loaded DLL\'s exports');
})().catch(error => { console.error(error); process.exit(1); });
