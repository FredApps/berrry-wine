#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_version_language") (param $name i32) (param $lang i32)
      (param $out i32) (param $capacity i32) (param $stack i32) (result i32)
    (local $id i32)
    (local.set $id (call $lookup_api_id (call $g2w (local.get $name))))
    (if (i32.lt_s (local.get $id) (i32.const 0)) (then (unreachable)))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (local.get $id) (local.get $lang)
      (local.get $out) (local.get $capacity) (i32.const 0) (i32.const 0)
      (local.get $name))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_version_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer, exports: null };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  const wasm = compileSrcWasm((file, source) => file === '13-exports.wat'
    ? source + extraWat : source);
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = ctx.exports = instance.exports;
  const name = e.guest_alloc(32), allocation = e.guest_alloc(256), out = allocation + 4;
  const write = (p, s) => [...Buffer.from(s + '\0')].forEach((b, i) => e.guest_write8(p + i, b));
  const fill = () => { for (let i = 0; i < 256; i++) e.guest_write8(allocation + i, 0xcc); };
  const read = (n, wide) => String.fromCharCode(...Array.from({ length: n }, (_, i) =>
    e.guest_read8(out + i * (wide ? 2 : 1)) |
    (wide ? e.guest_read8(out + i * 2 + 1) << 8 : 0)));
  const stack = 0x07000000;
  for (const wide of [false, true]) {
    write(name, 'VerLanguageName' + (wide ? 'W' : 'A'));
    const call = (lang, p, cap) => {
      const result = e.test_version_language(name, lang, p, cap, stack);
      assert.strictEqual(e.test_version_esp(), stack + 16, 'stdcall pops return address and three arguments');
      return result;
    };
    for (const [lang, text] of [
      [0x0409, 'English (United States)'], [0x0809, 'English (United Kingdom)'],
      [0x040a, 'Spanish (Traditional Sort)'], [0x0411, 'Japanese'],
      [0x0c0c, 'French (Canadian)'], [0x0419, 'Russian'],
      [0x0401, 'Arabic (Saudi Arabia)'], [0x0436, 'Afrikaans'],
      [0, 'Language Neutral'], [0xffff, 'Language Neutral'],
    ]) {
      for (const cap of [1, 5, text.length, text.length + 1, 100]) {
        fill();
        const count = Math.min(cap - 1, text.length), unit = wide ? 2 : 1;
        assert.strictEqual(call(lang, out, cap), count, 'count excludes terminating NUL');
        assert.strictEqual(read(count + 1, wide), text.slice(0, count) + '\0');
        assert.strictEqual(e.guest_read8(out - 1), 0xcc);
        for (let i = (count + 1) * unit; i < 210; i++)
          assert.strictEqual(e.guest_read8(out + i), 0xcc, 'copy stops at terminator');
      }
    }
    fill();
    assert.strictEqual(call(0x0409, out, 0), 0);
    assert.strictEqual(e.guest_read8(out), 0xcc, 'zero capacity performs no write');
    assert.strictEqual(call(0x0409, 0, 30), 0);
    assert.strictEqual(call(0x0409, 0, 0), 0);
    assert.strictEqual(call(0x0409, out, 0xffffffff), 23, 'DWORD capacity is unsigned');
  }
  console.log('PASS VerLanguageName A/W: hash dispatch, multilingual names, neutral fallback, truncation, canaries and ESP');
})().catch(error => { console.error(error); process.exitCode = 1; });
