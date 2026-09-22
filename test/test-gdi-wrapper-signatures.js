#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness();
  assert.strictEqual(e.test_call_MoveToEx.length, 4, 'expose the previous-point output');
  assert.strictEqual(e.test_call_SelectPalette.length, 3, 'expose force-background');
  const dc = e.test_call_CreateCompatibleDC(0) >>> 0;
  assert(dc);
  const point = e.guest_alloc(16) >>> 0;
  assert(point);
  const sp = 0x07408000;
  e.set_esp(sp);
  assert.strictEqual(e.test_call_MoveToEx(dc, -7, 19, 0), 1);
  assert.strictEqual(e.get_esp() >>> 0, sp);
  e.guest_write32(point, 0x12345678);
  e.guest_write32(point + 12, 0x76543210);
  assert.strictEqual(e.test_call_MoveToEx(dc, 21, -3, point + 4), 1);
  assert.strictEqual(e.guest_read32(point + 4) | 0, -7);
  assert.strictEqual(e.guest_read32(point + 8) | 0, 19);
  assert.strictEqual(e.guest_read32(point), 0x12345678);
  assert.strictEqual(e.guest_read32(point + 12), 0x76543210);
  assert.strictEqual(e.get_esp() >>> 0, sp);
  for (const background of [0, 1]) {
    assert.strictEqual(e.test_call_SelectPalette(dc, 0x3001f, background), 0x3001f);
    assert.strictEqual(e.get_esp() >>> 0, sp);
  }
  assert.strictEqual(e.test_call_DeleteDC(dc), 1);
  console.log('PASS full GDI wrapper signatures, previous-point output/guards and ESP preservation');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
