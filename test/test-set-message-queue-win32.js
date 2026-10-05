#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');

const root = path.join(__dirname, '..');
const api = JSON.parse(fs.readFileSync(path.join(root, 'src/api_table.json'), 'utf8'))
  .find(entry => entry.name === 'SetMessageQueue');
assert.deepStrictEqual(api.stub, { pop: 8, ret: 1 },
  'obsolete Win32 compatibility behavior is explicit generated metadata');
assert.strictEqual(api.test_call, true);

const extraWat = String.raw`
  (func (export "test_set_message_queue_esp") (param $size i32) (param $sp i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_SetMessageQueue
      (local.get $size) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))
`;

const binary = compileSrcWasm((file, source) =>
  file === '13-exports.wat' ? source + extraWat : source);
const module_ = new WebAssembly.Module(binary);
const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
const imports = { host: { memory } };
for (const imp of WebAssembly.Module.imports(module_)) {
  if (imp.kind === 'function') imports[imp.module][imp.name] = () => 0;
}
const e = new WebAssembly.Instance(module_, imports).exports;
e.init_thread(0, 0x400000, 0, 0, 0, 0, 0, 0);

for (const requested of [-1, 0, 1, 8, 64, 96, 0x7fffffff]) {
  assert.strictEqual(e.test_call_SetMessageQueue(requested), 1,
    `Win32 compatibility call succeeds for ${requested}`);
  assert.strictEqual(e.test_set_message_queue_esp(requested, 0x410000), 0x410008,
    `stdcall cleanup remains exact for ${requested}`);
}

for (let i = 0; i < 96; i++) {
  assert.strictEqual(e.post_message_q(0, 0x500 + i, i, 0x1000 + i), 1);
}
assert.strictEqual(e.post_queue_depth(), 96);
assert.strictEqual(e.test_call_SetMessageQueue(1), 1);
assert.strictEqual(e.post_queue_depth(), 96,
  'obsolete call neither truncates nor replaces the existing Win32 queue');
for (let i = 0; i < 96; i++) {
  assert.strictEqual(e.post_queue_peek(i, 1), 0x500 + i);
  assert.strictEqual(e.post_queue_peek(i, 2), i);
  assert.strictEqual(e.post_queue_peek(i, 3), 0x1000 + i);
}

console.log('PASS SetMessageQueue is an explicit Win32 no-op over a growable FIFO');
