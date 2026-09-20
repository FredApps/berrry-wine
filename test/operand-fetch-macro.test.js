#!/usr/bin/env node
'use strict';

// Compile the production operand-fetch macro in a tiny independent module.
// This catches expression expansion/evaluation-order mistakes without adding
// test exports or counters to the emulator being benchmarked.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compile } = require('../tools/watx.js');

const cache = fs.readFileSync(path.join(__dirname, '..', 'src', '04-cache.wat'), 'utf8');
const start = cache.indexOf('(defmacro (read-thread-word)');
assert.notStrictEqual(start, -1, 'production read-thread-word macro exists');

function balancedForm(source, offset) {
  let depth = 0;
  for (let i = offset; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(offset, i + 1);
  }
  throw new Error('unterminated read-thread-word macro');
}

const macro = balancedForm(cache, start);
const source = [
  '(memory 1)',
  '(export "memory" (memory 0))',
  '(global $ip (mut i32) (i32.const 0))',
  macro,
  '(func (export "set_ip") (param $v i32) (effects)',
  '  (global.set $ip (local.get $v)))',
  '(func (export "get_ip") (result i32) (effects)',
  '  (global.get $ip))',
  '(func (export "read2") (result i32) (local $operand_word i32) (effects heap)',
  '  (i32.sub (read-thread-word) (read-thread-word)))',
].join('\n');
const built = compile(source, new Map(), { mode: 'production' });
assert.strictEqual(built.success, true, built.error);
const instance = new WebAssembly.Instance(new WebAssembly.Module(built.wasmBinary), {});
const { memory, set_ip, get_ip, read2 } = instance.exports;
const words = new DataView(memory.buffer);

words.setInt32(0, 10, true);
words.setInt32(4, 3, true);
set_ip(0);
assert.strictEqual(read2(), 7, 'two expansions retain left-to-right operand values');
assert.strictEqual(get_ip(), 8, 'two expansions advance ip by eight bytes');

const oob = memory.buffer.byteLength - 2;
set_ip(oob);
assert.throws(() => read2(), WebAssembly.RuntimeError, 'out-of-bounds operand load traps');
assert.strictEqual(get_ip(), oob, 'trapping load leaves ip unchanged');

console.log('PASS production operand-fetch macro ordering, ip advance, and trap atomicity');
