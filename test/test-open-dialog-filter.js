#!/usr/bin/env node
'use strict';

// The Open/Save dialog lists only files of the type "Files of type" names.
// It listed every file whatever the filter said, so Civilization II's Save
// dialog offered .exe and .gif files under "Save Files (*.SAV)". Changing the
// filter lists the directory again; directories stay listed so the user can
// still navigate; ';' lists and wide OPENFILENAMEW patterns work too.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $t_dlg (mut i32) (i32.const 0))
  (func $t_put (param $g i32) (param $s i32) (param $len i32) (param $wide i32)
    (local $i i32)
    (block $d (loop $l
      (br_if $d (i32.ge_u (local.get $i) (local.get $len)))
      (if (local.get $wide)
        (then (i32.store16 (call $g2w (i32.add (local.get $g) (i32.shl (local.get $i) (i32.const 1))))
          (i32.load8_u (i32.add (local.get $s) (local.get $i)))))
        (else (call $gs8 (i32.add (local.get $g) (local.get $i))
          (i32.load8_u (i32.add (local.get $s) (local.get $i))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $l))))
  ;; $src/$len: a WASM-side copy of the filter list, NULs included.
  (func (export "t_open") (param $src i32) (param $len i32) (param $index i32) (param $wide i32) (result i32)
    (local $ofn i32) (local $filter i32)
    (local.set $ofn (call $heap_alloc (i32.const 76)))
    (call $zero_memory (call $g2w (local.get $ofn)) (i32.const 76))
    (local.set $filter (call $heap_alloc (i32.shl (local.get $len) (i32.const 1))))
    (call $t_put (local.get $filter) (local.get $src) (local.get $len) (local.get $wide))
    (call $gs32 (local.get $ofn) (i32.const 76))
    (call $gs32 (i32.add (local.get $ofn) (i32.const 12)) (local.get $filter))
    (call $gs32 (i32.add (local.get $ofn) (i32.const 24)) (local.get $index))
    (global.set $opendlg_wide (local.get $wide))
    (global.set $t_dlg (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $create_open_dialog (global.get $t_dlg) (i32.const 0) (i32.const 1) (local.get $ofn))
    (global.get $t_dlg))
  (func (export "t_count") (result i32)
    (call $wnd_send_message (call $ctrl_find_by_id (global.get $t_dlg) (i32.const 0x441))
      (i32.const 0x018B) (i32.const 0) (i32.const 0)))
  (func (export "t_item") (param $i i32) (result i32)
    (local $buf i32)
    (local.set $buf (call $heap_alloc (i32.const 280)))
    (drop (call $wnd_send_message (call $ctrl_find_by_id (global.get $t_dlg) (i32.const 0x441))
      (i32.const 0x0189) (local.get $i) (local.get $buf)))
    (call $g2w (local.get $buf)))
  (func (export "t_pick") (param $sel i32)
    (drop (call $wnd_send_message (call $ctrl_find_by_id (global.get $t_dlg) (i32.const 0x445))
      (i32.const 0x014E) (local.get $sel) (i32.const 0)))
    (drop (call $wnd_send_message (global.get $t_dlg) (i32.const 0x0111)
      (i32.or (i32.const 0x445) (i32.shl (i32.const 1) (i32.const 16))) (i32.const 0))))
  (func (export "t_scratch") (result i32) (call $g2w (call $heap_alloc (i32.const 256))))
`;

(async () => {
  const { exports: e, memory, hostCtx } = await bootRenderHarness({ extraWat, width: 64, height: 48 });
  for (const name of ['civ.sav', 'Game2.SAV', 'notes.txt', 'pic.bmp', 'app.exe']) {
    hostCtx.vfs.files.set(`c:\\${name.toLowerCase()}`, { data: new Uint8Array(4), attrs: 0x20 });
  }
  hostCtx.vfs.dirs.add('c:\\saves');

  const bytes = () => new Uint8Array(memory.buffer);
  const cstr = wa => { let s = ''; const b = bytes(); while (b[wa]) s += String.fromCharCode(b[wa++]); return s; };
  const listing = () => Array.from({ length: e.t_count() }, (_, i) => cstr(e.t_item(i)).toLowerCase()).sort();
  const open = (filter, index, wide = 0) => {
    const wa = e.t_scratch();
    for (let i = 0; i < filter.length; i++) bytes()[wa + i] = filter.charCodeAt(i);
    return e.t_open(wa, filter.length, index, wide);
  };
  const files = list => list.filter(n => !n.startsWith('['));

  open('Save Files (*.SAV)\0*.SAV\0All Files (*.*)\0*.*\0Pictures\0*.txt; *.BMP\0\0', 1);
  const first = listing();
  assert.deepStrictEqual(files(first), ['civ.sav', 'game2.sav'], 'only save files, matched case-insensitively');
  assert.ok(first.includes('[saves]'), `directories stay listed: ${first}`);

  e.t_pick(1);
  assert.deepStrictEqual(files(listing()), ['app.exe', 'civ.sav', 'game2.sav', 'notes.txt', 'pic.bmp'],
    'All Files (*.*) lists everything after the filter changes');

  e.t_pick(2);
  assert.deepStrictEqual(files(listing()), ['notes.txt', 'pic.bmp'], 'a ";" list matches each pattern');

  open('Text\0*.t?t\0\0', 1, 1);
  assert.deepStrictEqual(files(listing()), ['notes.txt'], 'a wide OPENFILENAMEW pattern, with "?"');

  open('', 0);
  assert.strictEqual(files(listing()).length, 5, 'no filter list shows every file');

  console.log('PASS Open/Save dialog lists only the files its filter names');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
