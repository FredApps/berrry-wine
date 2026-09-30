#!/usr/bin/env node

'use strict';

// DrawText on a DC whose text alignment has TA_UPDATECP draws at the current
// position, clipped to the rectangle, and advances it -- the rectangle is the
// clip, not the origin. Civilization II draws every city label that way: it
// MoveTo()s to the label, sets TA_UPDATECP and hands DrawText the region it is
// repainting. Drawing at rect.left instead put the label at the left edge of
// whatever was being repainted, so a unit moving next to Rome left "RoRo".

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

(async () => {
  const { exports: wat, memory, hostCtx } = await bootRenderHarness({});
  const bytes = new Uint8Array(memory.buffer);
  const imageBase = wat.get_image_base() >>> 0;
  const wa = guest => RegionMap.g2w(guest, imageBase);
  const allocZero = size => {
    const pointer = wat.guest_alloc(size) >>> 0;
    bytes.fill(0, wa(pointer), wa(pointer) + size);
    return pointer;
  };
  const writeAnsi = value => {
    const pointer = allocZero(value.length + 1);
    bytes.set(Buffer.from(value, 'latin1'), wa(pointer));
    return pointer;
  };
  const writeWide = value => {
    const pointer = allocZero((value.length + 1) * 2);
    [...value].forEach((character, index) =>
      wat.guest_write16(pointer + index * 2, character.charCodeAt(0)));
    return pointer;
  };
  const writeRect = (pointer, left, top, right, bottom) => {
    wat.guest_write32(pointer, left);
    wat.guest_write32(pointer + 4, top);
    wat.guest_write32(pointer + 8, right);
    wat.guest_write32(pointer + 12, bottom);
  };

  // A one-glyph FNT: 'A' is a solid 8x8 block.
  const fnt = Buffer.alloc(143);
  fnt.writeUInt16LE(0x0200, 0);
  fnt.writeUInt32LE(fnt.length, 2);
  fnt.writeUInt16LE(8, 74);
  fnt.writeUInt16LE(400, 83);
  fnt.writeUInt16LE(8, 88);
  fnt.writeUInt16LE(8, 91);
  fnt.writeUInt16LE(8, 93);
  fnt[95] = 65;
  fnt[96] = 65;
  fnt.writeUInt32LE(134, 105);
  fnt.writeUInt16LE(8, 118);
  fnt.writeUInt16LE(126, 120);
  fnt.writeUInt16LE(134, 124);
  fnt.fill(0xff, 126, 134);
  fnt.write('CpBlock\0', 134, 'latin1');
  hostCtx.vfs.files.set('c:\\cpblock.fon', { data: new Uint8Array(fnt), attrs: 0x20 });
  const fontPath = writeAnsi('CPBLOCK.FON');
  assert.strictEqual(wat.test_call_AddFontResourceA(fontPath), 1);

  const width = 128;
  const height = 32;
  const bmi = allocZero(40);
  wat.guest_write32(bmi, 40);
  wat.guest_write32(bmi + 4, width);
  wat.guest_write32(bmi + 8, -height);
  wat.guest_write16(bmi + 12, 1);
  wat.guest_write16(bmi + 14, 32);
  const bitsOut = allocZero(4);
  const bitmap = wat.test_call_CreateDIBSection(0, bmi, 0, bitsOut, 0, 0) >>> 0;
  const hdc = wat.test_call_CreateCompatibleDC(0) >>> 0;
  wat.test_call_SelectObject(hdc, bitmap);
  const font = wat.test_call_CreateFontW(-8, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0,
    writeWide('CpBlock')) >>> 0;
  wat.test_call_SelectObject(hdc, font);
  wat.test_gdi_dc_set_field(hdc, 28, 1, 2); // TRANSPARENT
  wat.test_gdi_dc_set_field(hdc, 20, 0x000000, 0); // black text
  const dibBits = wat.guest_read32(bitsOut) >>> 0;
  const pixel = (x, y) => wat.guest_read32(dibBits + (y * width + x) * 4) & 0xffffff;
  const clear = () => assert.strictEqual(
    wat.test_call_PatBlt(hdc, 0, 0, width, height, 0x00F00021), 1);

  const rect = allocZero(16);
  const text = writeAnsi('AA');
  const TA_UPDATECP = 1;

  // Without TA_UPDATECP the rectangle is the origin, as before.
  clear();
  writeRect(rect, 10, 4, 120, 28);
  assert.strictEqual(wat.test_call_DrawTextA(hdc, text, 2, rect, 0), 8);
  assert.strictEqual(pixel(12, 6), 0, 'no UPDATECP: text starts at rect.left');

  // With TA_UPDATECP the current position is the origin and the rect clips.
  clear();
  wat.test_gdi_dc_set_field(hdc, 32, TA_UPDATECP, 0);
  assert.strictEqual(wat.test_call_MoveToEx(hdc, 40, 10, 0), 1);
  writeRect(rect, 0, 0, width, height);
  assert.strictEqual(wat.test_call_DrawTextA(hdc, text, 2, rect, 0), 8);
  assert.strictEqual(pixel(12, 12), 0xffffff, 'UPDATECP: nothing at rect.left');
  assert.strictEqual(pixel(41, 11), 0, 'UPDATECP: first glyph at the current position');
  assert.strictEqual(pixel(55, 17), 0, 'UPDATECP: second glyph follows it');
  assert.strictEqual(pixel(41, 5), 0xffffff, 'UPDATECP: the current y is the top');
  assert.strictEqual(wat.test_gdi_dc_get_field(hdc, 12, 0), 56, 'UPDATECP: x advances past the text');
  assert.strictEqual(wat.test_gdi_dc_get_field(hdc, 32, 0), TA_UPDATECP,
    'the caller\'s text alignment survives DrawText');

  // A repaint rectangle that starts inside the label clips it in place --
  // it does not move the label to the rectangle's left edge.
  clear();
  assert.strictEqual(wat.test_call_MoveToEx(hdc, 40, 10, 0), 1);
  writeRect(rect, 50, 0, width, height);
  assert.strictEqual(wat.test_call_DrawTextA(hdc, text, 2, rect, 0), 8);
  assert.strictEqual(pixel(45, 12), 0xffffff, 'clipped part of the first glyph stays unpainted');
  assert.strictEqual(pixel(51, 12), 0, 'second glyph is drawn where it belongs');
  assert.strictEqual(pixel(58, 12), 0xffffff, 'nothing drawn past the label');

  wat.test_gdi_dc_set_field(hdc, 32, 0, 0);
  assert.strictEqual(wat.test_call_RemoveFontResourceA(fontPath), 1);
  console.log('PASS  DrawText honours TA_UPDATECP: current position is the origin, rect clips');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
