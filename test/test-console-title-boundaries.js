#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "map") (param i32) (result i32)
    (call $virtual_map_commit (local.get 0) (i32.const 4096)))
` + ['Set', 'Get'].flatMap(op => ['A', 'W'].map(encoding => `
  (func (export "${op}${encoding}") (param $p i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_${op}ConsoleTitle${encoding} (local.get $p) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`)).join('');

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const page = 0x30000000;
  for (const ga of [page, 0x28000000, page + 4096]) assert.strictEqual(wat.map(ga) >>> 0, ga);
  assert.notStrictEqual(wat.guest_to_wasm(page + 4096), wat.guest_to_wasm(page) + 4096);
  for (let i = 0; i < 4096; i++) wat.guest_write8(0x28000000 + i, 0xa5);
  const aligned = wat.guest_alloc(32) >>> 0;
  const bytes = (p, n) => Array.from({ length: n }, (_, i) => wat.guest_read8(p + i));
  const write = (p, data) => data.forEach((v, i) => wat.guest_write8(p + i, v));
  const encode = (chars, width) => chars.flatMap(v => width === 2 ? [v & 255, v >>> 8] : [v]);
  for (const encoding of ['A', 'W']) {
    const width = encoding === 'W' ? 2 : 1;
    const chars = encoding === 'W' ? [65, 0x03a9, 90] : [65, 0xe9, 90];
    // Preserve the current shared ANSI title representation; this test does
    // not certify the lossy wide-to-ANSI policy as complete Unicode support.
    const stored = encoding === 'W' ? [65, 63, 90] : chars;
    const input = encode([...chars, 0], width);
    for (let split = 1; split < input.length; split++) {
      const edge = page + 4096 - split;
      write(edge - 1, [0xcc, ...input, 0xcc]);
      assert.strictEqual(wat[`Set${encoding}`](edge, 0), 1, `${encoding} set split ${split}`);
      assert.strictEqual(wat.get_esp() >>> 0, 0x074ff008);
      assert.deepStrictEqual(bytes(edge - 1, input.length + 2), [0xcc, ...input, 0xcc]);
      assert.strictEqual(wat.GetA(aligned, 32), 3);
      assert.deepStrictEqual(bytes(aligned, 4), [...stored, 0]);
    }
    for (const size of [0, 1, 2, 4, 6]) {
      for (let split = 1; split < 6 * width; split++) {
        const edge = page + 4096 - split;
        write(edge - 1, Array(6 * width + 2).fill(0xcc));
        const copied = Math.min(3, Math.max(0, size - 1));
        assert.strictEqual(wat[`Get${encoding}`](edge, size), copied);
        assert.strictEqual(wat.get_esp() >>> 0, 0x074ff00c);
        const expected = Array(6 * width + 2).fill(0xcc);
        if (size) expected.splice(1, (copied + 1) * width,
          ...encode([...stored.slice(0, copied), 0], width));
        assert.deepStrictEqual(bytes(edge - 1, expected.length), expected,
          `${encoding} get size ${size} split ${split}`);
      }
    }
  }
  assert.deepStrictEqual(bytes(0x28000000, 4096), Array(4096).fill(0xa5));
  console.log('PASS console titles use sparse guest buffers with bounded A/W writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
