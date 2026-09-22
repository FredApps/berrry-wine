#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "map_format_page") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "format_wide") (param $flags i32) (param $src i32)
        (param $out i32) (param $size i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $gs32 (i32.const 0x074ff018) (local.get $size))
      (call $gs32 (i32.const 0x074ff01c) (i32.const 0))
      (call $handle_FormatMessageW (local.get $flags) (local.get $src)
        (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0))
      (i32.load (global.get $reg_base)))
  ` });
  const page = 0x30000000, unrelated = 0x28000000;
  for (const ga of [page, unrelated, page + 4096]) assert.strictEqual(e.map_format_page(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  const put = (ga, bytes) => bytes.forEach((v, i) => e.guest_write8(ga + i, v));
  const fill = (ga, n, value) => put(ga, Array(n).fill(value));
  const text = [...Buffer.from('Hello\0', 'utf16le')];
  const source = e.guest_alloc(text.length) >>> 0;
  const direct = e.guest_alloc(text.length + 2) >>> 0;
  put(source, text);
  fill(unrelated, 4096, 0xa5);
  // Each DWORD split, plus a page-local control, through the real handler.
  for (let split = 1; split <= 4; split++) {
    const out = page + 4096 - split;
    fill(out - 1, 6, 0xcc);
    assert.strictEqual(e.format_wide(0x700, source, out, 0), 5);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff020);
    const allocated = e.guest_read32(out) >>> 0;
    const expected = Buffer.alloc(4);
    // The allocated pointer must round-trip through the sparse caller slot.
    assert.ok(allocated !== 0, `pointer split ${split}`);
    expected.writeUInt32LE(allocated);
    assert.deepStrictEqual(read(out - 1, 6), [0xcc, ...expected, 0xcc]);
    assert.deepStrictEqual(read(allocated, text.length), text);
    assert.deepStrictEqual(read(unrelated, 4096), Array(4096).fill(0xa5));
  }
  // Existing guest-aware conversion paths: every byte split, including WCHAR
  // and terminator splits, and a page-local control. No truncation-policy claim.
  for (let split = 1; split <= text.length; split++) {
    const boundary = page + 4096 - split;
    fill(boundary - 1, text.length + 2, 0xcc);
    assert.strictEqual(e.format_wide(0x600, source, boundary, 6), 5);
    assert.deepStrictEqual(read(boundary - 1, text.length + 2), [0xcc, ...text, 0xcc]);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff020);
    put(boundary, text);
    const before = read(boundary - 1, text.length + 2);
    fill(direct, text.length + 2, 0xcc);
    assert.strictEqual(e.format_wide(0x600, boundary, direct + 1, 6), 5);
    assert.deepStrictEqual(read(direct, text.length + 2), [0xcc, ...text, 0xcc]);
    assert.deepStrictEqual(read(boundary - 1, text.length + 2), before);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff020);
  }
  assert.deepStrictEqual(read(unrelated, 4096), Array(4096).fill(0xa5));
  console.log('PASS FormatMessageW allocated-pointer, direct-output and template sparse boundaries');
})().catch(error => { console.error(error); process.exitCode = 1; });
