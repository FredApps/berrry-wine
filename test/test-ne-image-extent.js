#!/usr/bin/env node
'use strict';

// A Win16 program staged for WinExec/LoadLibrary is only the part of its file
// the NE loader reads: headers, segments with their relocation records,
// resources and the non-resident name table. Anything after that is an
// overlay the program reads from its own file -- Civilization II's
// PEDIA\GET_INFO.EXE is an 11 MB Authorware runtime around ~750 KB of image,
// larger than a module staging slot -- so lib/vfs-seed.js trims it.

const assert = require('assert');
const { neImageExtent, residentWin16Module } = require('../lib/vfs-seed');

function buildNe(fileLength) {
  const b = new Uint8Array(fileLength);
  const w16 = (o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
  const w32 = (o, v) => { w16(o, v & 0xffff); w16(o + 2, v >>> 16); };
  b[0] = 0x4d; b[1] = 0x5a; w32(0x3c, 0x40);
  const ne = 0x40;
  b[ne] = 0x4e; b[ne + 1] = 0x45;
  w16(ne + 0x1C, 1);          // one segment
  w16(ne + 0x20, 0x10);       // non-resident names: 0x10 bytes
  w16(ne + 0x22, 0x40);       // segment table
  w16(ne + 0x24, 0x48);       // resource table
  w16(ne + 0x26, 0x60);       // resident names (differs: resources present)
  w32(ne + 0x2C, 0x100);      // non-resident names at file 0x100
  w16(ne + 0x32, 4);          // sector shift
  // Segment at sector 0x20 (0x200), 0x30 bytes, with 2 relocation records.
  w16(ne + 0x40, 0x20); w16(ne + 0x42, 0x30); w16(ne + 0x44, 0x100);
  w16(0x230, 2);
  // One resource at 0x30<<4 = 0x300, 5<<4 = 0x50 bytes long.
  const rt = ne + 0x48;
  w16(rt, 4);
  w16(rt + 2, 0x8002); w16(rt + 4, 1);
  w16(rt + 10, 0x30); w16(rt + 12, 5);
  w16(rt + 22, 0);            // end of types
  return b;
}

const full = buildNe(0x1000);
assert.strictEqual(neImageExtent(full, 0x40), 0x350,
  'image ends at the last resource, not at the overlay');

const short = buildNe(0x320);
assert.strictEqual(neImageExtent(short, 0x40), 0x320,
  'an extent past the end of a truncated file is capped at the file');

const vfs = { files: new Map([['c:\\pedia\\get_info.exe', { data: full }]]) };
const found = residentWin16Module(vfs, 'GET_INFO');
assert(found && found.format === 'ne', 'the NE is recognized');
assert.strictEqual(found.bytes.length, 0x350, 'the staged module is the trimmed image');

console.log('PASS  NE image extent trims overlays from a staged Win16 module');
