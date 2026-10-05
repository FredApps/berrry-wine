#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const names = ['PathAppendW', 'PathFileExistsW', 'SHCreateDirectoryExW', 'SHCreateDirectoryExA'];
const extraWat = names.map((name, index) => `
  (func (export "path_test_${index}") (param $a i32) (param $b i32) (param $c i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $dispatch_api_table (i32.const ${apis.find(a => a.name === name).id}) (local.get $a) (local.get $b) (local.get $c) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))`).join('\n') + `
  (func (export "path_stack_delta") (result i32)
    (i32.sub (i32.load offset=16 (global.get $reg_base)) (call $w2g (region.addr $GUEST_STACK 524288))))
  (func (export "path_write16") (param $p i32) (param $v i32) (call $gs16 (local.get $p) (local.get $v)))
  (func (export "path_read16") (param $p i32) (result i32) (call $gl16 (local.get $p)))
`;
(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'none', extraHostOverrides: {
    // Observe the real fallback path for a separately run before-dispatch
    // control. WAT itself still executes unreachable after this import.
    crash_unimplemented: (...args) => console.error('SHELL_PATH_MISSING_API', JSON.stringify(args)),
  } });
  const e = h.exports, vfs = h.hostCtx.vfs;
  let count = 0;
  function wide(value, p = e.guest_alloc(1040)) {
    for (let i = 0; i <= value.length; i++) e.path_write16(p + 2 * i, value.charCodeAt(i) || 0);
    return p >>> 0;
  }
  function read(p) {
    let s = '';
    for (let i = 0; i < 260; i++) { const c = e.path_read16(p + i * 2); if (!c) return s; s += String.fromCharCode(c); }
    throw Error('Unterminated output');
  }
  function append(a, b, expected, result = 1) {
    const p = wide(a), q = wide(b);
    assert.equal(e.path_test_0(p, q, 0), result, `${a} + ${b}`);
    assert.equal(e.path_stack_delta(), 12);
    assert.equal(read(p), expected); count++;
  }
  append('C:\\My Documents', 'Gaslamp Games\\\\Dungeons of Dredmor', 'C:\\My Documents\\Gaslamp Games\\\\Dungeons of Dredmor');
  append('C:\\base\\', 'child', 'C:\\base\\child');
  append('C:\\base', '\\child', 'C:\\base\\child');
  append('C:\\base', 'D:\\other', 'D:\\other');
  append('C:\\base', '\\\\server\\share\\file', '\\\\server\\share\\file');
  append('C:\\base', '.\\child', 'C:\\base\\child');
  append('C:\\base\\nested', '..\\child', 'C:\\base\\child');
  append('..\\path1\\path2', 'path3', '\\path1\\path2\\path3');
  append('C:\\', '..\\child', 'C:\\child');
  append('C:\\資料', '保存', 'C:\\資料\\保存');
  append('', '', '\\');
  append('C:', '', 'C:\\');
  append('C:\\base', '', 'C:\\base');
  append('a'.repeat(257), 'b', 'a'.repeat(257) + '\\b');
  append('a'.repeat(258), 'b', '', 0);
  const alias = wide('C:\\base');
  assert.equal(e.path_test_0(alias, alias + 6, 0), 1);
  assert.equal(read(alias), 'C:\\base\\base'); count++;
  assert.equal(e.path_test_0(0, wide('x'), 0), 0); count++;
  vfs.dirs.add('c:\\'); vfs.dirs.add('c:\\my documents');
  vfs.files.set('c:\\existing.txt', { data: new Uint8Array([1]), attrs: 0x20 });
  for (const [path, expected] of [['C:\\existing.txt', 1], ['C:\\My Documents', 1], ['C:\\missing', 0]]) {
    assert.equal(e.path_test_1(wide(path), 0, 0), expected);
    assert.equal(e.path_stack_delta(), 8); count++;
  }
  const sparseBase = 0x38000000, neighbor = sparseBase + 65536;
  for (const p of [sparseBase, neighbor, sparseBase + 4096]) e.test_virtual_map_commit(p, 4096);
  assert.notEqual(e.guest_to_wasm(sparseBase + 4096), e.guest_to_wasm(sparseBase) + 4096);
  const split = wide('C:\\My Documents', sparseBase + 4093);
  assert.equal(e.path_test_0(split, wide('保存'), 0), 1);
  assert.equal(read(split), 'C:\\My Documents\\保存');
  assert.equal(e.path_test_2(0, split, 0), 0);
  assert.equal(e.path_test_1(split, 0, 0), 1);
  assert.equal(e.guest_span_cursor_bytes(), 0); count++;
  const dir = wide('C:\\My Documents\\Gaslamp Games\\Dungeons of Dredmor');
  assert.equal(e.path_test_2(0, dir, 0), 0);
  assert.equal(e.path_stack_delta(), 16);
  assert.equal(vfs.getFileAttributes('C:\\My Documents\\Gaslamp Games') & 16, 16);
  assert.equal(vfs.getFileAttributes(read(dir)) & 16, 16); count++;
  assert.equal(e.path_test_2(0, dir, 0), 183); count++;
  assert.equal(e.path_test_2(0, wide('C:\\existing.txt\\child'), 0), 3);
  assert.equal(vfs.getFileAttributes('C:\\existing.txt\\child') >>> 0, 0xffffffff); count++;
  assert.equal(e.path_test_2(0, wide('relative\\path'), 0), 161); count++;
  assert.equal(e.path_test_2(0, wide('C:\\' + 'x'.repeat(245)), 0), 206); count++;
  assert.equal(e.path_test_2(0, wide('C:\\security'), 1), 50);
  assert.equal(vfs.getFileAttributes('C:\\security') >>> 0, 0xffffffff); count++;
  for (const [path, result] of [['C:\\trailing\\', 0], ['C:/forward/child', 0], ['C:\\bad*name', 123], ['Z:\\missing-drive', 3], ['\\\\server\\share\\child', 53]]) {
    assert.equal(e.path_test_2(0, wide(path), 0), result, path); count++;
  }
  assert.equal(e.path_test_2(0, 0, 0), 161); count++;
  function ansi(value) {
    const p = e.guest_alloc(512);
    for (let i = 0; i <= value.length; i++) e.guest_write8(p + i, value.charCodeAt(i) || 0);
    return p;
  }
  for (const [path, expected] of [['C:\\ansi\\child', 0], ['C:\\ansi\\child', 183], ['relative\\ansi', 161], ['C:\\existing.txt\\child', 3], ['C:\\invalid?ansi', 123], ['C:\\caf\u00e9', 0]]) {
    assert.equal(e.path_test_3(0, ansi(path), 0), expected, 'ANSI ' + path);
    assert.equal(e.path_stack_delta(), 16); count++;
  }
  assert.equal(vfs.getFileAttributes('C:\\ansi') & 16, 16);
  assert.equal(vfs.getFileAttributes('C:\\caf\u00e9') & 16, 16);
  vfs.readOnlyDrives.add('c');
  assert.equal(e.path_test_2(0, wide('C:\\readonly-new'), 0), 5);
  assert.equal(vfs.getFileAttributes('C:\\readonly-new') >>> 0, 0xffffffff); count++;
  console.log(`PASS shell Unicode paths: ${count} actual-handler cases`);
})().catch(error => { console.error(error); process.exitCode = 1; });
