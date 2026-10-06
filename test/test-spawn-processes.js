#!/usr/bin/env node
'use strict';

// The pieces behind test/run.js --spawn-processes, the mode that runs every
// guest CreateProcess as a real child emulator (Windows Installer 2.0's
// instmsi.exe -> msiinst.exe -> msiexec.exe chain installs that way):
//
//  - $pipe_launch_line folds lpApplicationName and lpCommandLine into the one
//    string the host launches. msiinst runs CreateProcessA("MsiExec.exe",
//    "C:\...\msiinst.exe /i instmsi.msi ...") and means msiexec with those
//    arguments: argv[0] of the command line is only a label there.
//  - GetLongPathNameA, which msi.dll binds by name with no fallback of its
//    own; without it every msiexec install failed with 1619.
//  - mergeVfsTreeBack, which brings what a child left on C:\ back into its
//    parent's VirtualFS before the parent's wait on it returns.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { VirtualFS } = require('../lib/filesystem');
const { saveVfsToHost, mergeVfsTreeBack } = require('../lib/vfs-export');

const extraWat = String.raw`
  (func (export "t_launch_line") (param $app i32) (param $cmd i32) (result i32)
    (call $pipe_launch_line (local.get $app) (local.get $cmd)))
  (func (export "t_long_path") (param $src i32) (param $dst i32) (param $size i32) (result i64)
    (global.set $last_error (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetLongPathNameA (local.get $src) (local.get $dst) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (global.get $last_error)) (i64.const 32))))
  (func (export "t_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const put = (ptr, s) => {
    [...s].forEach((ch, i) => wat.guest_write8(ptr + i, ch.charCodeAt(0)));
    wat.guest_write8(ptr + s.length, 0);
    return ptr;
  };
  const get = ptr => {
    let s = '';
    for (let c; (c = wat.guest_read8(ptr)) !== 0; ptr++) s += String.fromCharCode(c);
    return s;
  };
  const APP = 0x2600, CMD = 0x2700, BUF = 0x2800;

  // --- the launch line ---
  const line = (app, cmd) => {
    const p = wat.t_launch_line(app ? put(APP, app) : 0, cmd == null ? 0 : put(CMD, cmd)) >>> 0;
    assert.ok(p, 'a launch line is allocated');
    return get(p);
  };
  assert.strictEqual(line(null, 'GNUChess xboard'), 'GNUChess xboard',
    'without an application name the command line is the launch');
  assert.strictEqual(line('MsiExec.exe', 'C:\\windows\\temp\\ixp000.tmp\\msiinst.exe /i instmsi.msi /qb+!'),
    '"MsiExec.exe" /i instmsi.msi /qb+!', 'argv[0] of the command line is replaced by the application');
  assert.strictEqual(line('MsiExec.exe', '"C:\\Program Files\\x.exe" /regserver'),
    '"MsiExec.exe" /regserver', 'a quoted argv[0] is skipped whole');
  assert.strictEqual(line('MsiExec.exe', '  MsiExec.exe'), '"MsiExec.exe"', 'no arguments, no trailing text');
  assert.strictEqual(line('c:\\a b\\setup.exe', null), '"c:\\a b\\setup.exe"', 'no command line at all');

  // --- GetLongPathNameA ---
  put(APP, 'C:\\Program Files');
  let r = wat.t_long_path(APP, BUF, 260);
  assert.strictEqual(Number(r & 0xffffffffn), 16, 'returns the length copied');
  assert.strictEqual(get(BUF), 'C:\\Program Files', 'and copies the path');
  assert.strictEqual(wat.t_esp() >>> 0, 0x00300000 + 16, 'pops three arguments');
  r = wat.t_long_path(APP, BUF, 16);
  assert.strictEqual(Number(r & 0xffffffffn), 17, 'a buffer one short asks for length + terminator');
  r = wat.t_long_path(APP, 0, 0);
  assert.strictEqual(Number(r & 0xffffffffn), 17, 'so does a NULL buffer');
  put(APP, 'C:\\no such dir\\file.msi');
  r = wat.t_long_path(APP, BUF, 260);
  assert.strictEqual(Number(r & 0xffffffffn), 0, 'a missing path fails');
  assert.strictEqual(Number(r >> 32n), 2, 'with ERROR_FILE_NOT_FOUND');

  // --- merging a child's C:\ back ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-merge-'));
  try {
    const vfs = new VirtualFS();
    const write = (p, text) => {
      const h = vfs.createFile(p, 0x40000000, 2);
      vfs.writeFile(h, new Uint8Array(Buffer.from(text)), text.length);
      vfs.closeHandle(h);
    };
    const read = p => {
      const e = vfs.files.get(vfs._resolvePath(p));
      return e ? Buffer.from(e.data).toString() : null;
    };
    write('c:\\setup\\keep.txt', 'same');
    write('c:\\setup\\change.txt', 'old');
    write('c:\\setup\\gone.txt', 'bye');
    const inDir = path.join(tmp, 'in');
    const before = new Map(saveVfsToHost(vfs, inDir)
      .map(row => [String(row.guestPath).toLowerCase(), row.outputPath]));
    // What the child leaves: one file changed, one added, one deleted.
    const outDir = path.join(tmp, 'out');
    fs.cpSync(inDir, outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'setup', 'change.txt'), 'new');
    fs.mkdirSync(path.join(outDir, 'windows', 'system'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'windows', 'system', 'msi.dll'), 'MZ');
    fs.rmSync(path.join(outDir, 'setup', 'gone.txt'));
    const result = mergeVfsTreeBack(vfs, before, outDir);
    assert.deepStrictEqual(result, { written: 2, deleted: 1 }, 'only the differences are applied');
    assert.strictEqual(read('c:\\setup\\keep.txt'), 'same');
    assert.strictEqual(read('c:\\setup\\change.txt'), 'new', 'a changed file is rewritten');
    assert.strictEqual(read('c:\\windows\\system\\msi.dll'), 'MZ', 'a new file appears, parents and all');
    assert.strictEqual(read('c:\\setup\\gone.txt'), null, 'a deleted file is deleted');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('PASS test-spawn-processes');
})().catch(err => { console.error(err); process.exit(1); });
