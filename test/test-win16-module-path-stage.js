'use strict';
const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');
const { stageReceiver, resourceDll } = require('./win16-path-stage-helper');
const memory = { buffer: new ArrayBuffer(2 * 1024 * 1024) };
const vfs = new VirtualFS(), fixture = resourceDll();
vfs.files.set('c:\\windows\\temp\\art.dll', { data: fixture.bytes, attrs: 0x20 });
const calls = [], wasmExports = {
  win16_dll_staging: () => 0x20000,
  win16_app_dll_staging_size: () => 0x100000,
  win16_dll_path_alloc(id) { calls.push(id); return 0x1000; },
};
const receiver = stageReceiver(wasmExports, memory, vfs);
assert.equal(receiver._stageWin16Module('ART', 13), fixture.bytes.length);
assert.deepEqual(calls, [13]);
const m = new Uint8Array(memory.buffer);
assert.equal(Buffer.from(m.subarray(0x1000, 0x1000 + 260)).toString().split(String.fromCharCode(0))[0], 'c:\\windows\\temp\\art.dll');
assert.deepEqual(m.subarray(0x20000, 0x20000 + fixture.bytes.length), fixture.bytes);
assert.equal(receiver._stageWin16Module('missing', 14), false);
assert.equal(stageReceiver({ ...wasmExports, win16_dll_path_alloc: () => 0 }, memory, vfs)._stageWin16Module('ART', 13), false);
assert.equal(stageReceiver({ ...wasmExports, win16_dll_path_alloc: undefined }, memory, vfs)._stageWin16Module('ART', 13), fixture.bytes.length,
  'older WASM keeps its existing staging contract');
const cached = stageReceiver(wasmExports, memory, vfs, new Map([['ART', fixture.bytes]]));
calls.length = 0;
assert.equal(cached._stageWin16Module('ART', 13), fixture.bytes.length);
assert.deepEqual(calls, [], 'a resident file does not replace the identity of preloaded bytes');
for (const [filePath, accepted] of [
  ['c:\\dir\\0\\art.dll', true],
  ['c:\\dir' + String.fromCharCode(0) + '\\art.dll', false],
  ['c:\\' + 'a'.repeat(253) + '\\art.dll', false],
]) {
  const guardedVfs = new VirtualFS();
  guardedVfs.files.set(filePath, { data: fixture.bytes, attrs: 0x20 });
  calls.length = 0;
  assert.equal(stageReceiver(wasmExports, memory, guardedVfs)._stageWin16Module('ART', 13),
    accepted ? fixture.bytes.length : false, filePath);
  assert.equal(calls.length, accepted ? 1 : 0, 'invalid path is rejected before allocation');
}
console.log('PASS actual host stages original bytes and retains selected nested VFS filename; missing/allocation failure and old-module compatibility');
