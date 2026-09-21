#!/usr/bin/env node

'use strict';

// A file HANDLE must be positive as a signed 32-bit int. Delphi's FileOpen
// returns an Integer and TFileStream raises EFOpenError when it is < 0, so a
// first handle of 0xF0000001 made every Delphi program that opens a file
// before anything else fail ("Cannot open file C:\spiel1.exe" from the Best
// Of Moorhuhn CD's Jester wrappers, which read data appended to themselves).

const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');

const vfs = new VirtualFS();
vfs.files.set('c:\\spiel1.exe', { data: new Uint8Array(16), attrs: 0x20 });

const first = vfs.createFile('C:\\spiel1.exe', 0x80000000, 3);
assert(first, 'the first open succeeds');
assert((first | 0) > 0, `first handle 0x${(first >>> 0).toString(16)} is positive as an Integer`);

const second = vfs.createFile('C:\\spiel1.exe', 0x80000000, 3);
assert((second | 0) > 0 && second !== first, 'later handles are distinct and positive');

// Past the top of the positive range the allocator wraps, and must wrap back
// into the same positive namespace rather than to a negative value.
vfs._nextHandle = 0x7FFFFFFF;
const top = vfs.createFile('C:\\spiel1.exe', 0x80000000, 3);
const wrapped = vfs.createFile('C:\\spiel1.exe', 0x80000000, 3);
assert.strictEqual(top, 0x7FFFFFFF);
assert((wrapped | 0) > 0, `wrapped handle 0x${(wrapped >>> 0).toString(16)} is positive`);

console.log('PASS  VFS file handles are positive as signed 32-bit ints, including the first and after wraparound');
