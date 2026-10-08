#!/usr/bin/env node
'use strict';

// A Win9x kernel handle is a small number, and some runtimes keep only its low
// 16 bits: Asghan's Borland I/O layer stores CreateFile's result as a WORD and
// reads with 0xb for our 0x7000000b. Before this every read failed, the
// sprite headers stayed zero, and a `loop` with ECX=0 spun 2^32 times on the
// first draw. A miss on a value below 0x10000 now resolves to the Win32 handle
// with those low bits; an exact small key (a 16-bit _lopen HFILE) still wins.

const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');

const vfs = new VirtualFS();
vfs.files.set('c:\\main.io', { data: new Uint8Array([1, 2, 3, 4, 5, 6]), attrs: 0x20 });
vfs.files.set('c:\\other.io', { data: new Uint8Array([9, 9, 9, 9]), attrs: 0x20 });

vfs._nextHandle = 0x70000010;  // low bits 0x10: inside the legacy HFILE range
const wide = vfs.createFile('C:\\main.io', 0x80000000, 3);
assert(wide > 0xffff, 'CreateFile keeps its Win32-range handle');
const low16 = wide & 0xffff;

const buf = new Uint8Array(4);
assert.deepStrictEqual(vfs.readFile(low16, buf, 4), { ok: true, bytesRead: 4 },
  'a read through the 16-bit truncation reaches the same open file');
assert.deepStrictEqual([...buf], [1, 2, 3, 4]);
assert.strictEqual(vfs.setFilePointer(low16, 0, 0), 0, 'seek through the truncation');
assert.strictEqual(vfs.handles.get(low16), vfs.handles.get(wide), 'one record behind both values');

// The 16-bit _lopen namespace allocates around the alias: a new HFILE never
// takes a value that already names an open Win32 file's low bits.
vfs._nextLegacyHandle = low16;
const legacy = vfs.createLegacyFile('C:\\other.io', 0x80000000, 3);
assert(legacy > 0 && legacy < 0xffff && legacy !== low16,
  `the HFILE (0x${legacy.toString(16)}) skips the aliased 0x${low16.toString(16)}`);
const b2 = new Uint8Array(4);
vfs.readFile(legacy, b2, 4);
assert.deepStrictEqual([...b2], [9, 9, 9, 9], 'the HFILE reads its own file');
vfs.closeHandle(legacy);

// An exact small key always wins over the alias.
const exact = { path: 'c:\\other.io', pos: 0, access: 0x80000000 };
vfs.handles.set(low16, exact);
assert.strictEqual(vfs.handles.get(low16), exact, 'an exact key is not shadowed');
vfs.handles.delete(low16);
assert.strictEqual(vfs.handles.get(low16), vfs.handles.get(wide), 'and the alias returns once it is gone');

// After close both values see the same closed record; an unrelated small
// value still misses.
vfs.closeHandle(wide);
assert.strictEqual(vfs.handles.get(low16), vfs.handles.get(wide), 'a closed file reads the same (closed) record either way');
assert.strictEqual(vfs.handles.has(0x1234), false, 'an unrelated small value is not invented');

console.log('PASS  VFS resolves a 16-bit-truncated Win32 file handle, without shadowing exact keys');
