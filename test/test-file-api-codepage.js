#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createFilesystemImports } = require('../lib/filesystem');
const { readWatSourceClosure } = require('./wat-source-closure');
const { compileClosure } = require('../tools/watx-closure');

const handlers = readWatSourceClosure();
const apiTable = require('../src/api_table.json');

for (const name of ['SetFileApisToOEM', 'SetFileApisToANSI', 'AreFileApisANSI']) {
  const api = apiTable.find(entry => entry.name === name);
  assert(api, `${name} is registered`);
  assert.strictEqual(api.nargs, 0, `${name} takes no arguments`);
}

// Execute the actual three handlers rather than asserting their register
// spelling. The isolated module has two thread-like instances over one VFS;
// their private selector globals can disagree, but the public query must not.
const names = ['SetFileApisToOEM', 'SetFileApisToANSI', 'AreFileApisANSI'];
const bodies = names.map(name => {
  const start = handlers.indexOf(`(func $handle_${name} `);
  assert(start >= 0);
  let depth = 0;
  for (let end = start; end < handlers.length; end++) {
    if (handlers[end] === '(') depth++;
    if (handlers[end] === ')' && --depth === 0) return handlers.slice(start, end + 1);
  }
  throw Error(`Unbalanced handler: ${name}`);
});
const compiled = compileClosure({ source: `
  (import "host" "memory" (memory 1))
  (import "host" "reg_base" (global $reg_base i32))
  (import "host" "fs_file_api_ansi" (func $host_fs_file_api_ansi (param i32) (result i32)))
  (global $file_apis_ansi (mut i32) (i32.const 1))
  ${bodies.join('\n')}
  ${names.map(name => `(export "${name}" (func $handle_${name}))`).join('\n')}
`, vfs: new Map() }, { tailCalls: true });
assert(compiled.success, compiled.error);
const moduleUnderTest = new WebAssembly.Module(compiled.wasmBinary);
const wasmMemory = new WebAssembly.Memory({ initial: 1 });
const memory = wasmMemory.buffer;
const mem = new Uint8Array(memory);
const ctx = { getMemory: () => memory };
const host = createFilesystemImports(ctx);
const siblingHost = createFilesystemImports({ getMemory: () => memory, vfs: ctx.vfs });
const makeInstance = (imports, base) => ({ base, exports: new WebAssembly.Instance(moduleUnderTest,
  { host: { memory: wasmMemory, reg_base: base, fs_file_api_ansi: imports.fs_file_api_ansi } }).exports });
const first = makeInstance(host, 64), second = makeInstance(siblingHost, 96);
const call = (instance, name) => {
  const dv = new DataView(memory);
  dv.setUint32(instance.base + 16, 0x1000, true);
  instance.exports[name](0, 0, 0, 0, 0, 0);
  assert.strictEqual(dv.getUint32(instance.base + 16, true), 0x1004, `${name} pops its return address`);
  return dv.getUint32(instance.base, true);
};
assert.strictEqual(call(first, 'AreFileApisANSI'), 1);
const pathAt = 0x100;
const findAt = 0x400;

const writeBytes = bytes => {
  mem.fill(0, pathAt, pathAt + 64);
  mem.set(bytes, pathAt);
};
const ansiPath = Uint8Array.from([
  0x43, 0x3A, 0x5C, 0x63, 0x61, 0x66, 0xE9, 0x2E, 0x74, 0x78, 0x74, 0,
]);
const oemPath = Uint8Array.from([
  0x43, 0x3A, 0x5C, 0x63, 0x61, 0x66, 0x82, 0x2E, 0x74, 0x78, 0x74, 0,
]);
const euroPath = Uint8Array.from([
  0x43, 0x3A, 0x5C, 0x80, 0x75, 0x72, 0x6F, 0x2E, 0x74, 0x78, 0x74, 0,
]);

writeBytes(ansiPath);
const created = host.fs_create_file(pathAt, 0, 2, 0, 0);
assert.notStrictEqual(created >>> 0, 0xFFFFFFFF, 'ANSI APIs create the CP1252 name by default');
host.fs_close_handle(created);

call(first, 'SetFileApisToOEM');
assert.strictEqual(call(second, 'AreFileApisANSI'), 0);
assert.strictEqual(siblingHost.fs_file_api_ansi(-1), 0,
  'a second thread-facing import table observes the process OEM mode');
writeBytes(oemPath);
const openedOem = siblingHost.fs_create_file(pathAt, 0, 3, 0, 0);
assert.notStrictEqual(openedOem >>> 0, 0xFFFFFFFF,
  'OEM CP437 byte 0x82 opens the same Unicode é filename');
host.fs_close_handle(openedOem);
const findOem = host.fs_find_first_file(pathAt, findAt, 0);
assert.notStrictEqual(findOem >>> 0, 0xFFFFFFFF);
assert.strictEqual(mem[findAt + 44 + 3], 0x82,
  'FindFirstFileA returns é in the selected OEM code page');
host.fs_find_close(findOem);

call(second, 'SetFileApisToANSI');
assert.strictEqual(call(first, 'AreFileApisANSI'), 1);
assert.strictEqual(siblingHost.fs_file_api_ansi(-1), 1,
  'restoring ANSI is process-wide across import tables');
writeBytes(ansiPath);
const findAnsi = host.fs_find_first_file(pathAt, findAt, 0);
assert.notStrictEqual(findAnsi >>> 0, 0xFFFFFFFF);
assert.strictEqual(mem[findAt + 44 + 3], 0xE9,
  'SetFileApisToANSI restores CP1252 filename output');
host.fs_find_close(findAnsi);

writeBytes(euroPath);
const createdEuro = host.fs_create_file(pathAt, 0, 2, 0, 0);
assert.notStrictEqual(createdEuro >>> 0, 0xFFFFFFFF,
  'ANSI byte 0x80 decodes as the CP1252 euro sign');
host.fs_close_handle(createdEuro);
const findEuro = host.fs_find_first_file(pathAt, findAt, 0);
assert.notStrictEqual(findEuro >>> 0, 0xFFFFFFFF);
assert.strictEqual(mem[findAt + 44], 0x80,
  'CP1252 filename output encodes the euro sign as byte 0x80');
host.fs_find_close(findEuro);

call(second, 'SetFileApisToOEM');
assert.strictEqual(call(first, 'AreFileApisANSI'), 0);
mem.fill(0, pathAt, pathAt + 64);
mem.set(Buffer.from('C:\\café.txt\0', 'utf16le'), pathAt);
const openedWide = host.fs_create_file(pathAt, 0, 3, 0, 1);
assert.notStrictEqual(openedWide >>> 0, 0xFFFFFFFF,
  'wide file APIs remain Unicode while narrow APIs use OEM');
host.fs_close_handle(openedWide);

console.log('PASS  Win98 file-API ANSI/OEM selection reaches Kernel32 filenames');
