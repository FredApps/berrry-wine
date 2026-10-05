#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { readWatSourceClosure } = require('./wat-source-closure');

const ROOT = path.join(__dirname, '..');
const apiTable = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src', 'api_table.json'), 'utf8'));
const apiId = name => {
  const api = apiTable.find(entry => entry.name === name);
  assert(api, `${name} must remain in api_table.json`);
  return api.id;
};

const extraWat = String.raw`
  (func (export "test_dispatch_legacy_seek")
      (param $api i32) (param $handle i32) (param $offset i32)
      (param $origin i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x13579bdf))
    (call $dispatch_api_table
      (local.get $api) (local.get $handle) (local.get $offset)
      (local.get $origin) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const calls = [];
  const { exports: wat } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      fs_set_file_pointer(handle, offset, origin) {
        calls.push([handle, offset, origin]);
        if (handle === 0xdead) return -1;
        return 0x1000 + calls.length;
      },
    },
  });

  const invoke = (name, handle, offset, origin) => {
    const before = calls.length;
    const result = wat.test_dispatch_legacy_seek(
      apiId(name), handle, offset, origin);
    assert.strictEqual(wat.get_esp() >>> 0, 0x00300010,
      `${name} pops three arguments and the return address exactly once`);
    return { result, called: calls.length !== before };
  };

  for (const [name, handle, offset, origin] of [
    ['_llseek', 0x101, 7, 0],
    ['mmioSeek', 0x202, -3, 1],
    ['LZSeek', 0x303, 0, 2],
  ]) {
    const { result, called } = invoke(name, handle, offset, origin);
    assert.strictEqual(result, 0x1000 + calls.length,
      `${name} returns the absolute position from the shared host seek`);
    assert(called, `${name} reaches the shared host seek`);
    assert.deepStrictEqual(calls.at(-1), [handle, offset, origin],
      `${name} preserves handle, signed offset, and origin`);
  }

  for (const name of ['_llseek', 'mmioSeek']) {
    const { result, called } = invoke(name, 0x404, 1, 3);
    assert.strictEqual(result, -1,
      `${name} returns its documented error for an invalid origin`);
    assert.strictEqual(called, false,
      `${name} rejects an invalid origin before host I/O`);
  }

  const badValue = invoke('LZSeek', 0x505, 1, -1);
  assert.strictEqual(badValue.result, -7,
    'LZSeek returns LZERROR_BADVALUE for an invalid origin');
  assert.strictEqual(badValue.called, false,
    'LZSeek rejects an invalid origin before host I/O');

  const badHandle = invoke('LZSeek', 0xdead, 0, 0);
  assert.strictEqual(badHandle.result, -1,
    'LZSeek preserves LZERROR_BADINHANDLE from the host seek');
  assert.strictEqual(badHandle.called, true,
    'LZSeek distinguishes a bad handle from a bad origin');

  const mmio = apiTable.find(entry => entry.name === 'mmioSeek');
  assert.strictEqual(mmio.handler, '_llseek',
    'mmioSeek dispatches to the canonical compatible handler');
  const source = readWatSourceClosure();
  assert.match(source, /\(func \$legacy_file_seek[\s\S]*?\$host_fs_set_file_pointer/,
    'the legacy seek family owns one host-backed seek core');
  assert.doesNotMatch(source, /\(func \$handle_mmioSeek\b/,
    'mmioSeek does not retain a copied handler body');

  console.log('PASS  _llseek/mmioSeek share one handler and LZSeek preserves its distinct errors');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
