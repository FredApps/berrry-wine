#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

(async () => {
  const harness = await bootRenderHarness({ extraWat: `
    (func (export "test_outline_metrics_a")
          (param $hdc i32) (param $bytes i32) (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_GetOutlineTextMetricsA
        (local.get $hdc) (local.get $bytes) (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "test_outline_metrics_w")
          (param $hdc i32) (param $bytes i32) (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_GetOutlineTextMetricsW
        (local.get $hdc) (local.get $bytes) (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
  ` });
  const { exports: wat, memory } = harness;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const imageBase = wat.get_image_base() >>> 0;
  const wa = guest => RegionMap.g2w(guest, imageBase);
  const alloc = (size, fill = 0) => {
    const guest = wat.guest_alloc(size) >>> 0;
    assert(guest, `guest_alloc(${size}) failed`);
    bytes.fill(fill, wa(guest), wa(guest) + size);
    return guest;
  };
  const readA = guest => {
    let text = '';
    for (let i = 0; i < 96; i++) {
      const ch = bytes[wa(guest) + i];
      if (!ch) return text;
      text += String.fromCharCode(ch);
    }
    throw new Error('unterminated OUTLINETEXTMETRICA string');
  };
  const readW = guest => {
    let text = '';
    for (let i = 0; i < 96; i++) {
      const ch = view.getUint16(wa(guest) + i * 2, true);
      if (!ch) return text;
      text += String.fromCharCode(ch);
    }
    throw new Error('unterminated OUTLINETEXTMETRICW string');
  };
  const u32 = (guest, offset) => view.getUint32(wa(guest) + offset, true);
  const i32 = (guest, offset) => view.getInt32(wa(guest) + offset, true);

  const bmi = alloc(40);
  wat.guest_write32(bmi, 40);
  wat.guest_write32(bmi + 4, 64);
  wat.guest_write32(bmi + 8, -32);
  wat.guest_write16(bmi + 12, 1);
  wat.guest_write16(bmi + 14, 32);
  const bitsOut = alloc(4);
  const bitmap = wat.test_call_CreateDIBSection(0, bmi, bitsOut) >>> 0;
  const hdc = wat.test_call_CreateCompatibleDC(0) >>> 0;
  assert(bitmap && hdc, 'memory DC creation failed');
  assert.notStrictEqual(wat.test_call_SelectObject(hdc, bitmap) | 0, -1);

  assert.strictEqual(wat.test_outline_metrics_a(hdc, 0, 0), 0,
    'a stock bitmap font has no outline metrics');
  assert.strictEqual(wat.get_esp() >>> 0, 0x074ff010,
    'A bitmap-font failure must pop return address plus three arguments');
  assert.strictEqual(wat.test_outline_metrics_w(0x7fffffff, 0, 0), 0,
    'an invalid DC has no outline metrics');
  assert.strictEqual(wat.get_esp() >>> 0, 0x074ff010,
    'W invalid-DC failure must preserve exact stdcall cleanup');

  const face = alloc(32);
  for (const [index, character] of [...'Arial'].entries()) {
    wat.guest_write16(face + index * 2, character.charCodeAt(0));
  }
  const font = wat.test_call_CreateFontW(-24, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, face) >>> 0;
  assert(font, 'CreateFontW Arial failed');
  assert.notStrictEqual(wat.test_call_SelectObject(hdc, font) | 0, -1);

  const requiredA = wat.test_outline_metrics_a(hdc, 0, 0) >>> 0;
  const requiredW = wat.test_outline_metrics_w(hdc, 0xffffffff, 0) >>> 0;
  assert.strictEqual(requiredA, 238,
    'A required size is fixed 0xd4 plus four ANSI virtual-face strings');
  assert.strictEqual(requiredW, 268,
    'W required size uses 0xd8 packing and UTF-16 strings');
  assert.strictEqual(wat.get_esp() >>> 0, 0x074ff010,
    'NULL sizing query must retain exact stdcall cleanup');

  const shortA = alloc(requiredA + 16, 0xa5);
  assert.strictEqual(wat.test_outline_metrics_a(hdc, requiredA - 1, shortA), 0,
    'one-byte-short A buffer must fail');
  assert.deepStrictEqual([...bytes.slice(wa(shortA), wa(shortA) + requiredA + 16)],
    Array(requiredA + 16).fill(0xa5),
    'short-buffer failure must not partially overwrite the caller');
  assert.strictEqual(wat.test_outline_metrics_w(hdc, requiredW, 0x90000000), 0,
    'an invalid output span must fail without trapping');

  const outA = alloc(requiredA + 16, 0xa5);
  assert.strictEqual(wat.test_outline_metrics_a(hdc, requiredA + 16, outA), requiredA,
    'A fill returns the required byte count');
  assert.strictEqual(u32(outA, 0), 212,
    'A otmSize reports the fixed packed structure, excluding trailing strings');
  assert(i32(outA, 4) > 0, 'embedded TEXTMETRICA height is positive');
  assert.strictEqual(i32(outA, 8) + i32(outA, 12), i32(outA, 4),
    'embedded ascent and descent form the cell height');
  assert.strictEqual(bytes[wa(outA) + 4 + 51] & 0x06, 0x06,
    'TEXTMETRICA advertises vector and TrueType technology');
  assert(u32(outA, 92) >= 512, 'otmEMSquare comes from the TrueType head table');
  assert(i32(outA, 96) > 0 && i32(outA, 100) < 0,
    'typographic ascent/descent retain signed design units');
  assert.strictEqual(u32(outA, 108), 0,
    'documented unsupported cap-height field stays zero');
  assert.strictEqual(u32(outA, 112), 0,
    'documented unsupported x-height field stays zero');
  assert(i32(outA, 116) < i32(outA, 124) && i32(outA, 120) < i32(outA, 128),
    'font box comes from head xMin/yMin/xMax/yMax');
  assert([...bytes.slice(wa(outA) + 61, wa(outA) + 71)].some(value => value !== 0),
    'PANOSE bytes come from OS/2');
  const aOffsets = [196, 200, 204, 208].map(offset => u32(outA, offset));
  assert.deepStrictEqual(aOffsets, [212, 218, 224, 232],
    'A name members are bounded byte offsets from the structure base');
  assert.deepStrictEqual(aOffsets.map(offset => readA(outA + offset)),
    ['Arial', 'Arial', 'Regular', 'Arial']);
  assert.deepStrictEqual([...bytes.slice(wa(outA) + requiredA, wa(outA) + requiredA + 16)],
    Array(16).fill(0xa5), 'A fill must preserve the trailing canary');
  assert.strictEqual(wat.get_esp() >>> 0, 0x074ff010,
    'A successful fill uses exact stdcall cleanup');

  const outW = alloc(requiredW + 16, 0xa5);
  assert.strictEqual(wat.test_outline_metrics_w(hdc, requiredW, outW), requiredW,
    'W fill returns the required byte count');
  assert.strictEqual(u32(outW, 0), 216,
    'W otmSize reports the fixed packed structure, excluding trailing strings');
  assert.strictEqual(view.getUint8(wa(outW) + 4 + 55) & 0x06, 0x06,
    'TEXTMETRICW uses its wider character-field packing');
  assert.strictEqual(u32(outW, 96), u32(outA, 92),
    'A/W share the same table-backed em square');
  const wOffsets = [200, 204, 208, 212].map(offset => u32(outW, offset));
  assert.deepStrictEqual(wOffsets, [216, 228, 240, 256],
    'W name members account for UTF-16 storage and 0xd8 fixed packing');
  assert.deepStrictEqual(wOffsets.map(offset => readW(outW + offset)),
    ['Arial', 'Arial', 'Regular', 'Arial']);
  assert.deepStrictEqual([...bytes.slice(wa(outW) + requiredW, wa(outW) + requiredW + 16)],
    Array(16).fill(0xa5), 'W fill must preserve the trailing canary');
  assert.strictEqual(wat.get_esp() >>> 0, 0x074ff010,
    'W successful fill uses exact stdcall cleanup');

  assert.strictEqual(wat.test_call_DeleteObject(font), 1);
  assert.strictEqual(wat.test_call_DeleteObject(bitmap), 1);
  assert.strictEqual(wat.test_call_DeleteDC(hdc), 1);
  console.log('PASS  GetOutlineTextMetricsA/W Win98 sizing, packing, metrics, names, canaries, failures, and ABI');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
