#!/usr/bin/env node
'use strict';

// A full Win32 MSG is 28 bytes. Internal USER queue probes must not use one
// 16-byte PaintRect slot: the final slot borders WND_CLASS_SLOT_TABLE, and a
// read there used to turn Rodent's board class slot from 22 into zero.
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { BASE } = require('../lib/region-map.generated');

const module_ = new WebAssembly.Module(compileSrcWasm());
const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
const imports = { host: { memory } };
for (const imp of WebAssembly.Module.imports(module_)) {
  if (imp.kind === 'function') imports[imp.module][imp.name] = () => 0;
}
const e = new WebAssembly.Instance(module_, imports).exports;
e.init_thread(0, 0x400000, 0, 0, 0, 0, 0, 0);

const slots = new Uint8Array(memory.buffer, BASE.WND_CLASS_SLOT_TABLE, 12);
slots.fill(22);
assert.strictEqual(e.post_message_q(0, 0x500, 0x1234, 0x5678), 1);
for (let i = 0; i < 16; i++) {
  assert.strictEqual(e.has_pending_message(), 1);
}
assert.deepStrictEqual([...slots], Array(12).fill(22),
  'sixteen non-removing MSG reads must preserve the adjacent class-slot table');
assert.strictEqual(e.post_queue_depth(), 1,
  'the pending-message probe must not remove the queued post');

console.log('PASS USER queue MSG scratch preserves adjacent Win16 class slots');
