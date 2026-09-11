#!/usr/bin/env node
'use strict';

// The Screen Savers applet (src/09ca-screensavers.wat), driven the way the
// host drives it: open the window, run $wat_app_pump, repaint, and read the
// screen. There is no PE and no guest thread here, which is the point --
// this is the coverage that says an applet can run with no program behind
// it.
//
// The checks are deliberately about observable state rather than internals:
// the catalogue is intact, the list is populated, clicking a row moves the
// detail statics, Preview reaches the shell-execute host import with the
// right .SCR name, and Close takes the window down.

const assert = require('assert');
const path = require('path');
const { bootRenderHarness, countUniqueColors, writePng } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_scrsave_field") (param $i i32) (param $f i32) (result i32)
    (call $scrsave_field (local.get $i) (local.get $f)))
  (func (export "test_scrsave_post") (param i32 i32 i32 i32) (result i32)
    (call $post_queue_push (local.get 0) (local.get 1) (local.get 2) (local.get 3)))
`;

function readCString(memory, addr) {
  const bytes = new Uint8Array(memory.buffer);
  let end = addr;
  while (bytes[end]) end++;
  return Buffer.from(bytes.slice(addr, end)).toString('latin1');
}

(async () => {
  const shellExecuted = [];
  const harness = await bootRenderHarness({
    extraWat,
    width: 640,
    height: 480,
    extraHostOverrides: {
      shell_execute: (hwnd, opWa, fileWa, paramsWa, dirWa, nShow) => {
        shellExecuted.push(readCString(harness.memory, fileWa));
        return 33;
      },
    },
  });
  const { exports: e, memory, renderer } = harness;

  // ---- catalogue ----
  const count = e.scrsave_count() >>> 0;
  assert.ok(count >= 19, `catalogue lists every screensaver (got ${count})`);
  const names = [];
  const files = [];
  for (let i = 0; i < count; i++) {
    const name = readCString(memory, e.test_scrsave_field(i, 0));
    const file = readCString(memory, e.test_scrsave_field(i, 1));
    const d1 = readCString(memory, e.test_scrsave_field(i, 2));
    const d2 = readCString(memory, e.test_scrsave_field(i, 3));
    assert.ok(name.length, `entry ${i} has a name`);
    assert.ok(/^[A-Z0-9_]+\.SCR$/.test(file), `entry ${i} names a .SCR file (${file})`);
    assert.ok(d1.length && d2.length, `entry ${i} has both description lines`);
    names.push(name);
    files.push(file);
  }
  assert.strictEqual(e.test_scrsave_field(count, 0), 0,
    'the table terminates instead of walking off the end');
  assert.strictEqual(e.test_scrsave_field(0, 4), 0, 'invalid fields cannot walk outside a catalogue entry');
  assert.strictEqual(new Set(files).size, files.length, 'no .SCR file is listed twice');

  // Every file in the catalogue must be an app the shell can actually start,
  // or Preview is a button that does nothing.
  const { APPS } = require(path.join(__dirname, '..', 'lib', 'apps.js'));
  const registered = new Set(Object.values(APPS)
    .map(a => String(a.exe || '').split('/').pop().toLowerCase())
    .filter(Boolean));
  for (const file of files) {
    assert.ok(registered.has(file.toLowerCase()),
      `${file} is registered in lib/apps.js so ShellExecute can resolve it`);
  }
  console.log(`PASS  catalogue: ${count} savers, every .SCR registered`);

  // ---- open ----
  const hwnd = e.scrsave_open() >>> 0;
  assert.ok(hwnd, 'scrsave_open returns a window handle');
  assert.strictEqual(e.scrsave_window() >>> 0, hwnd, 'the applet remembers its window');
  const list = e.scrsave_list_hwnd() >>> 0;
  assert.ok(list, 'the list control exists');
  // LB_GETCOUNT = 0x018B
  assert.strictEqual(e.send_message(list, 0x018b, 0, 0) | 0, count,
    'the list holds one row per catalogue entry');
  assert.strictEqual(e.send_message(list, 0x0188, 0, 0) | 0, 0,
    'the first saver is selected on open');

  assert.strictEqual(e.wat_app_pump() | 0, 1, 'the pump reports the applet is alive');
  renderer.repaint();
  const colors = countUniqueColors(harness.canvas);
  assert.ok(colors >= 8, `the applet draws a real window (${colors} colors)`);
  writePng(harness.canvas, 'screensaver-browser.png');
  console.log(`PASS  window opens and paints (${colors} distinct colors)`);

  // ---- selection moves the detail pane ----
  // LB_SETCURSEL then the WM_COMMAND the listbox posts on a click.
  const pick = 3;
  e.send_message(list, 0x0186, pick, 0);
  e.send_message(hwnd, 0x0111, (1 << 16) | 0x500, list); // LBN_SELCHANGE
  e.wat_app_pump();
  console.log(`PASS  selection of "${names[pick]}" accepted`);

  // ---- Preview ----
  assert.strictEqual(e.scrsave_last_launched() | 0, 0, 'nothing launched yet');
  assert.strictEqual(e.test_scrsave_post(hwnd, 0x0111, 1, 0), 1); // IDOK / Preview
  assert(e.get_post_queue_count() > 0, 'native same-thread notifications use the local queue');
  e.wat_app_pump();
  assert.strictEqual(e.get_post_queue_count(), 0, 'applet pump drains the local queue');
  assert.strictEqual(e.scrsave_last_launched() | 0, pick + 1,
    'Preview launched the selected saver');
  assert.deepStrictEqual(shellExecuted, [files[pick]],
    `Preview handed "${files[pick]}" to the shell`);
  console.log(`PASS  Preview started ${names[pick]} via ${files[pick]}`);

  // ---- Close ----
  e.send_message(hwnd, 0x0111, 2, 0); // IDCANCEL / Close
  assert.strictEqual(e.scrsave_window() | 0, 0, 'Close forgets the window');
  assert.strictEqual(e.wat_app_pump() | 0, 0,
    'the pump reports the applet is finished so the host can stop it');
  console.log('PASS  Close tears the applet down');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
