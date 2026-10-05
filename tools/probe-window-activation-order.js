#!/usr/bin/env node
'use strict';

// Read-only runtime diagnostic. Compiles current sources plus observation
// exports, then exercises the real host and USER entry points in one process.
// No success assertion pins today's bugs; compare the returned state/order.
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const { bootRenderHarness } = require('../test/render-helper');

const extraWat = String.raw`
  (func (export "probe_create") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x10CF0000)))
    (local.get $h))
  (func (export "probe_rank") (param $h i32) (result i32)
    (call $wnd_z_get (local.get $h)))
  (func (export "probe_active") (result i32) (global.get $active_hwnd))
  (func (export "probe_focus") (result i32) (global.get $focus_hwnd))
  (func (export "probe_style") (param $h i32) (result i32)
    (call $wnd_get_style (local.get $h)))
  (func (export "probe_min") (param $h i32) (result i32)
    (call $wnd_min_get (local.get $h)))
  (func (export "probe_owner") (param $h i32) (param $owner i32) (param $visible i32)
    (call $wnd_set_owner (local.get $h) (local.get $owner))
    (drop (call $wnd_set_style (local.get $h)
      (select (i32.const 0x10CF0000) (i32.const 0x00CF0000) (local.get $visible)))))
  (func (export "probe_default") (param $h i32) (param $msg i32) (param $wp i32) (param $lp i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_DefWindowProcA (local.get $h) (local.get $msg) (local.get $wp)
      (local.get $lp) (i32.const 0) (i32.const 0)))
  (func (export "probe_api") (param $kind i32) (param $h i32) (param $cmd i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (if (i32.eqz (local.get $kind))
      (then (call $handle_SetActiveWindow (local.get $h) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $kind) (i32.const 1))
      (then (call $handle_ShowWindow (local.get $h) (local.get $cmd) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $kind) (i32.const 2))
      (then (call $handle_CloseWindow (local.get $h) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)))))
`;

(async () => {
  const { exports: e, instance, memory, renderer, host } =
    await bootRenderHarness({ extraWat, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(__dirname, '../test/binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  if (!e.load_pe(fixture.length)) throw Error('Cannot initialize the USER fixture');
  e.init_dx_com_thunks();
  const windows = ['A', 'B', 'C'].map((name, index) => {
    const hwnd = e.probe_create() >>> 0;
    renderer.createWindow(hwnd, 0x10cf0000, 20 + index * 20, 20, 200, 160,
      name, 0, instance, memory);
    return { name, hwnd };
  });
  const nameOf = hwnd => windows.find(w => w.hwnd === (hwnd >>> 0))?.name || null;
  const snapshots = [];
  const record = stage => {
    const state = windows.map(({ name, hwnd }) => ({
      name, hwnd, watRank: e.probe_rank(hwnd), rendererRank: renderer.windows[hwnd].zOrder,
      visibleBit: !!(e.probe_style(hwnd) & 0x10000000),
      renderedVisible: !!renderer.windows[hwnd].visible,
      minimized: !!e.probe_min(hwnd),
      renderedMinimized: !!renderer.windows[hwnd]._minimized,
      nextFromHost: nameOf(host.get_window_related(hwnd, 2)),
    }));
    snapshots.push({ stage, active: nameOf(e.probe_active()), focus: nameOf(e.probe_focus()),
      watTopFirst: [...state].sort((a, b) => b.watRank - a.watRank).map(w => w.name),
      rendererTopFirst: [...state].sort((a, b) => b.rendererRank - a.rendererRank).map(w => w.name),
      windows: state });
  };
  const a = windows[0].hwnd;
  record('created A, B, C');
  e.probe_api(0, a, 0); record('SetActiveWindow(A)');
  e.probe_api(1, a, 0); record('ShowWindow(A, SW_HIDE)');
  e.probe_api(1, a, 5); record('ShowWindow(A, SW_SHOW)');
  e.probe_api(1, a, 6); record('ShowWindow(A, SW_MINIMIZE)');
  e.probe_api(1, a, 9); record('ShowWindow(A, SW_RESTORE)');
  e.probe_api(2, a, 0); record('CloseWindow(A)');
  // Different creation and ownership order catches a bare target-only raise
  // and a slot-order walk. Hidden owned windows must retain their old rank.
  const addOwned = (name, owner, visible = true) => {
    const hwnd = e.probe_create() >>> 0;
    e.probe_owner(hwnd, owner, Number(visible));
    renderer.createWindow(hwnd, visible ? 0x10cf0000 : 0x00cf0000, 50, 50, 100, 80,
      name, 0, instance, memory);
    renderer.windows[hwnd].ownerHwnd = owner;
    windows.push({ name, hwnd });
    return hwnd;
  };
  const palette = addOwned('P', a);
  addOwned('N', palette);
  addOwned('Q', a);
  addOwned('H-hidden', a, false);
  e.probe_api(1, a, 9);
  e.probe_api(0, windows[1].hwnd, 0); record('SetActiveWindow(B), with A owner group');
  e.probe_api(0, a, 0); record('SetActiveWindow(A), with owner group');
  addOwned('D-unowned', 0);
  e.probe_api(0, a, 0); record('SetActiveWindow(A), already active after new window');
  if (process.argv.includes('--check-order')) {
    for (const s of snapshots.filter(s => s.stage.startsWith('SetActiveWindow'))) {
      assert.deepStrictEqual(s.watTopFirst, s.rendererTopFirst, `${s.stage}: local order matches host`);
    }
    assert.deepStrictEqual(snapshots.at(-1).watTopFirst.slice(0, 4), ['N', 'Q', 'P', 'A'],
      'visible owned levels remain above owner, preserving sibling order');
  }
  if (process.argv.includes('--input-paths') || process.argv.includes('--check-taskbar')) {
    // Exercise actual input and taskbar handlers. Only the DOM button sink is
    // synthetic; no USER exports, renderer state transitions or onclick bodies
    // are replaced. Keep these observations separate from --check-order until
    // the input transaction is integrated with guest state.
    const b = windows[1].hwnd;
    renderer.handleMouseDown(235, 100, 0);
    renderer.handleMouseUp(235, 100, 0);
    record('mouse click on exposed B client');
    const previousDocument = globalThis.document;
    const buttons = [];
    const container = {
      set innerHTML(value) { buttons.length = 0; },
      appendChild(button) { buttons.push(button); },
    };
    globalThis.document = {
      getElementById: id => id === 'task-buttons' ? container : null,
      createElement: tag => {
        assert.strictEqual(tag, 'button');
        return {};
      },
    };
    try {
      // Establish a known foreground owner using the working API path, then
      // drive the taskbar's raise, minimize and restore branches for B.
      e.probe_api(0, a, 0);
      for (const action of ['raise', 'minimize', 'restore']) {
        renderer.updateTaskbar();
        const button = buttons.find(button => button.textContent === 'B');
        assert(button, 'B taskbar button exists');
        const beforeMinimized = renderer.windows[b]._minimized;
        const beforeVisible = renderer.windows[b].visible;
        button.onclick();
        if (action !== 'raise') {
          if (process.argv.includes('--check-taskbar')) {
            assert.strictEqual(renderer.windows[b]._minimized, beforeMinimized,
              'taskbar must not commit minimized state before guest handling');
            assert.strictEqual(renderer.windows[b].visible, beforeVisible,
              'taskbar must not commit visibility before guest handling');
          }
          const event = renderer.takeInput(event => event.hwnd === b && event.msg === 0x0112);
          if (process.argv.includes('--check-taskbar')) {
            assert(event, 'taskbar queues a system command for the owning HWND');
            assert.strictEqual(event.wParam, action === 'minimize' ? 0xF020 : 0xF120);
          }
          // This fixture has no application wndproc; explicitly exercise
          // default processing after checking the queued delivery contract.
          if (event) e.probe_default(event.hwnd, event.msg, event.wParam, event.lParam);
          if (process.argv.includes('--check-taskbar')) {
            assert.strictEqual(!!e.probe_min(b), action === 'minimize', 'guest commits show state');
            assert.strictEqual(!!renderer.windows[b]._minimized, !!e.probe_min(b),
              'renderer follows guest command handling');
          }
        }
        record(`taskbar B ${action}`);
      }
      assert(renderer.windows[b], 'taskbar retains the target window');
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  }
  console.log(JSON.stringify({ fixture: 'same-thread top-level and owned-window activation', snapshots }, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
