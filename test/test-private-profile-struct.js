#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "profile_error") (result i32) (global.get $last_error))
    (func (export "map_profile_page") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "profile_write") (param i32 i32 i32 i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_WritePrivateProfileStringA (local.get 0) (local.get 1)
        (local.get 2) (local.get 3) (i32.const 0) (i32.const 0)))
    (func (export "profile_struct") (param i32 i32 i32 i32 i32) (result i32)
      (global.set $last_error (i32.const 4660))
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_GetPrivateProfileStructA (local.get 0) (local.get 1)
        (local.get 2) (local.get 3) (local.get 4) (i32.const 0))
      (i32.load (global.get $reg_base)))
  ` });
  const str = s => {
    const p = e.guest_alloc(s.length + 1) >>> 0;
    [...Buffer.from(s, 'latin1'), 0].forEach((v, i) => e.guest_write8(p + i, v));
    return p;
  };
  const app = str('section'), key = str('key'), file = str('c:\\profile-struct.ini');
  const page = 0x30000000, unrelated = 0x28000000;
  for (const ga of [page, unrelated, page + 4096]) assert.strictEqual(e.map_profile_page(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const read = (p, n) => Array.from({ length: n }, (_, i) => e.guest_read8(p + i));
  const fill = (p, n, v) => { for (let i = 0; i < n; i++) e.guest_write8(p + i, v); };
  fill(unrelated, 4096, 0xa5);
  const values = {
    valid: '0180FEFF7E', lowercase: '0180feff7e', checksum: '0180FEFF7F',
    'bad-first': 'G180FEFF7E', 'bad-middle': '0180GEFF7E', 'bad-checksum': '0180FEFFGE',
    short: '0180FEFF', long: '0180FEFF7E00', quoted: '"0180FEFF7E"',
    zero: '00', 'zero-bad': '01', empty: '', missing: null,
    'size-small': '0180FEFF7E', 'size-large': '0180FEFF7E',
  };
  const serial = fs.readFileSync(path.join(__dirname, 'fixtures/win98-profile-struct/native.serial.txt'), 'utf8');
  assert.match(serial, /PROFILE_STRUCT_DONE/);
  let code, count = 0;
  for (const line of serial.split('\n')) {
    if (line.startsWith('CHAR')) code = Number(line.split('=')[1]);
    const m = line.match(/^READ label=(\S+) size=(\d+) ok=(\d+) error=(\d+) bytes=([A-F0-9]+)$/);
    if (!m) continue;
    const [, label, size, ok, error, bytes] = m;
    const value = label === 'high' ? String.fromCharCode(code) + '000'
      : label === 'low' ? '0' + String.fromCharCode(code) + '00' : values[label];
    assert.notStrictEqual(value, undefined, label);
    e.profile_write(app, key, value === null ? 0 : str(value), file);
    for (const split of [1, 2, 3, 10]) {
      const out = page + 4096 - split;
      fill(out - 1, 10, 0xcc);
      assert.strictEqual(e.profile_struct(app, key, out, +size, file), +ok, `${label} ${code} split ${split}`);
      assert.strictEqual(e.profile_error(), +error);
      assert.strictEqual(e.get_esp() >>> 0, 0x074ff018);
      assert.deepStrictEqual(read(out - 1, 10), [...Buffer.from(bytes, 'hex')], `${label} bytes`);
      count++;
    }
  }
  assert.strictEqual(count, 203 * 4);
  // Emulator safety, not native failure semantics: impossible encoded sizes
  // must not wrap the staging allocation and write into a tiny allocation.
  for (const size of [0x3ffffffe, 0x7ffffffe, 0xffffffff]) {
    fill(page, 10, 0xcc);
    assert.strictEqual(e.profile_struct(app, key, page + 1, size, file), 0);
    assert.deepStrictEqual(read(page, 10), Array(10).fill(0xcc));
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff018);
  }
  assert.deepStrictEqual(read(unrelated, 4096), Array(4096).fill(0xa5));
  console.log(`PASS ${count} native Win98 profile-structure cases across sparse/control buffers`);
})().catch(error => { console.error(error); process.exitCode = 1; });
