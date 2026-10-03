#!/usr/bin/env node

'use strict';

// USER exposes a mutable WINDOWPOS before committing SetWindowPos/MoveWindow,
// then sends the final structure afterward. WM_MOVE/WM_SIZE belong to
// DefWindowProc's WM_WINDOWPOSCHANGED path, not to SetWindowPos itself.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
// Keep this regression's compile private; an optional before-source snapshot
// supplies the negative control without replacing canonical worktree files.
const compiler = require('./compile-src');
const compileOriginal = compiler.compileSrcWasm;
if (process.env.WINDOWPOS_EXPOSURE_BASELINE || process.env.WINDOWPOS_WASM_OUTPUT) compiler.compileSrcWasm = (transform, options) => {
  const wasm = compileOriginal((file, source) => {
    if (file === '09c3-controls.wat' && process.env.WINDOWPOS_EXPOSURE_BASELINE)
      source = fs.readFileSync(process.env.WINDOWPOS_EXPOSURE_BASELINE, 'utf8');
    return transform ? transform(file, source) : source;
  }, options);
  if (process.env.WINDOWPOS_WASM_OUTPUT) {
    const output = process.env.WINDOWPOS_WASM_OUTPUT;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, wasm);
    fs.writeFileSync(output + '.sha256', require('crypto').createHash('sha256').update(wasm).digest('hex') + '\n');
  }
  return wasm;
};
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');
const WM_MOVE = 0x0003;
const WM_SIZE = 0x0005;
const WM_WINDOWPOSCHANGING = 0x0046;
const WM_WINDOWPOSCHANGED = 0x0047;
const SWP_NOREDRAW = 0x0008;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOZORDER = 0x0004;
const SWP_NOSENDCHANGING = 0x0400;

const COUNT = 0;
const MESSAGES = 4;
const LPARAMS = 36;
const XS = 68;
const YS = 100;
const CXS = 132;
const CYS = 164;
const FLAGS = 196;
const INSERT_AFTER = 228;
const OBSERVED_BYTES = 260;

const pack = (low, high) => ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;
const u32 = value => [value, value >>> 8, value >>> 16, value >>> 24].map(v => v & 0xff);

function makeWndProc(observed, changedFlags = SWP_NOZORDER | SWP_NOREDRAW) {
  const code = [];
  const labels = new Map();
  const fixups = [];
  const emit = (...bytes) => code.push(...bytes.map(byte => byte & 0xff));
  const label = name => labels.set(name, code.length);
  const jcc = (opcode, name) => {
    emit(0x0f, opcode, 0, 0, 0, 0);
    fixups.push({ at: code.length - 4, name });
  };
  const jump = name => {
    emit(0xe9, 0, 0, 0, 0);
    fixups.push({ at: code.length - 4, name });
  };
  const storeIndexedEax = address => emit(0x89, 0x04, 0x95, ...u32(address));
  const recordWindowPos = () => {
    emit(0x8b, 0x4c, 0x24, 0x10); // mov ecx,[esp+16] (WINDOWPOS*)
    for (const [offset, base] of [
      [4, INSERT_AFTER], [8, XS], [12, YS], [16, CXS], [20, CYS], [24, FLAGS],
    ]) {
      emit(0x8b, 0x41, offset); // mov eax,[ecx+offset]
      storeIndexedEax(observed + base);
    }
  };

  emit(0x8b, 0x44, 0x24, 0x08); // mov eax,[esp+8] (message)
  emit(0x8b, 0x15, ...u32(observed + COUNT)); // mov edx,[count]
  storeIndexedEax(observed + MESSAGES);
  emit(0x8b, 0x44, 0x24, 0x10); // mov eax,[esp+16] (lParam)
  storeIndexedEax(observed + LPARAMS);
  emit(0x8b, 0x44, 0x24, 0x08); // reload message
  emit(0x83, 0xf8, WM_WINDOWPOSCHANGING);
  jcc(0x84, 'changing'); // je
  emit(0x83, 0xf8, WM_WINDOWPOSCHANGED);
  jcc(0x84, 'changed');
  jump('finish');

  label('changing');
  recordWindowPos();
  // The window changes every mutable field and attempts to clear
  // SWP_NOACTIVATE. USER must commit these values but preserve NOACTIVATE.
  emit(0xc7, 0x41, 0x04, ...u32(1));   // hwndInsertAfter = HWND_BOTTOM
  emit(0xc7, 0x41, 0x08, ...u32(111)); // x
  emit(0xc7, 0x41, 0x0c, ...u32(112)); // y
  emit(0xc7, 0x41, 0x10, ...u32(113)); // cx
  emit(0xc7, 0x41, 0x14, ...u32(114)); // cy
  emit(0xc7, 0x41, 0x18, ...u32(changedFlags));
  jump('finish');

  label('changed');
  recordWindowPos();

  label('finish');
  emit(0x42); // inc edx
  emit(0x89, 0x15, ...u32(observed + COUNT)); // mov [count],edx
  emit(0x31, 0xc0); // xor eax,eax
  emit(0xc2, 0x10, 0x00); // ret 16

  for (const fixup of fixups) {
    const target = labels.get(fixup.name);
    assert.notStrictEqual(target, undefined, `missing x86 label ${fixup.name}`);
    const relative = (target - (fixup.at + 4)) | 0;
    code[fixup.at] = relative & 0xff;
    code[fixup.at + 1] = relative >>> 8 & 0xff;
    code[fixup.at + 2] = relative >>> 16 & 0xff;
    code[fixup.at + 3] = relative >>> 24 & 0xff;
  }
  return Uint8Array.from(code);
}

const extraWat = String.raw`
  (func (export "exposure_create")
      (param $proc i32) (param $parent i32) (param $x i32) (param $y i32)
      (param $w i32) (param $h i32) (result i32)
    (local $hwnd i32)
    (if (local.get $parent)
      (then
        (local.set $hwnd (call $ctrl_create_child (local.get $parent)
          (i32.const 0) (i32.const 111) (local.get $x) (local.get $y)
          (local.get $w) (local.get $h) (i32.const 0x54000000) (i32.const 0))))
      (else
        (local.set $hwnd (global.get $next_hwnd))
        (global.set $next_hwnd (i32.add (local.get $hwnd) (i32.const 1)))
        (call $host_register_dialog_frame (local.get $hwnd) (i32.const 0)
          (i32.const 0) (local.get $w) (local.get $h) (i32.const 0))
        (call $wnd_table_set (local.get $hwnd) (local.get $proc))
        (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x90000000)))))
    (call $wnd_table_set (local.get $hwnd) (local.get $proc))
    (call $client_rect_set (local.get $hwnd) (i32.const 0) (i32.const 0)
      (local.get $w) (local.get $h))
    (local.get $hwnd))
  (func (export "exposure_clear") (param $hwnd i32)
    (call $paint_clear_subtree (local.get $hwnd)))
  (func (export "exposure_damage") (param $hwnd i32)
    (call $paint_flag_set_inv (local.get $hwnd)))
  (func (export "exposure_visible") (param $hwnd i32) (param $visible i32)
    (drop (call $wnd_set_style (local.get $hwnd)
      (i32.or (i32.and (call $wnd_get_style (local.get $hwnd)) (i32.const 0xEFFFFFFF))
        (select (i32.const 0x10000000) (i32.const 0) (local.get $visible))))))
  (func (export "exposure_rect") (param $hwnd i32) (param $dst i32) (result i32)
    (call $update_get_rect (local.get $hwnd) (call $g2w (local.get $dst))))
  (func (export "exposure_erase") (param $hwnd i32) (result i32)
    (i32.and (call $nc_flags_test (local.get $hwnd)) (i32.const 2)))
  (func (export "exposure_pump_one") (result i32)
    (local $hwnd i32)
    (local.set $hwnd (call $paint_select_next_dirty))
    (if (local.get $hwnd) (then (call $update_window_now (local.get $hwnd))))
    (local.get $hwnd))
  (func (export "exposure_thunk") (param $id i32) (result i32)
    (local $p i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $p (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $p)))
  (func (export "test_retire") (param $hwnd i32) (call $wnd_table_remove (local.get $hwnd)))
  (func (export "test_last_error") (result i32) (global.get $last_error))
  (func (export "test_make_window") (param $proc i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (local.get $proc))
    (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x10000000)))
    (local.get $hwnd))

  (func (export "test_call_SetWindowPos")
      (param $hwnd i32) (param $x i32) (param $y i32)
      (param $cx i32) (param $cy i32) (param $flags i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $cy))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $flags))
    (call $handle_SetWindowPos
      (local.get $hwnd) (i32.const 0) (local.get $x) (local.get $y)
      (local.get $cx) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_MoveWindow")
      (param $hwnd i32) (param $x i32) (param $y i32)
      (param $cx i32) (param $cy i32) (param $repaint i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $repaint))
    (call $handle_MoveWindow
      (local.get $hwnd) (local.get $x) (local.get $y)
      (local.get $cx) (local.get $cy) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_BeginDeferWindowPos") (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BeginDeferWindowPos
      (i32.const 1) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_DeferWindowPos")
      (param $hdwp i32) (param $hwnd i32)
      (param $x i32) (param $y i32) (param $cx i32) (param $cy i32)
      (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $cx))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $cy))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (i32.const 0x14))
    (call $handle_DeferWindowPos
      (local.get $hdwp) (local.get $hwnd) (i32.const 0)
      (local.get $x) (local.get $y) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_EndDeferWindowPos") (param $hdwp i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_EndDeferWindowPos
      (local.get $hdwp) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_DefWindowProc")
      (param $hwnd i32) (param $windowpos i32) (param $wide i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (if (local.get $wide)
      (then
        (call $handle_DefWindowProcW
          (local.get $hwnd) (i32.const 0x0047) (i32.const 0)
          (local.get $windowpos) (i32.const 0) (i32.const 0)))
      (else
        (call $handle_DefWindowProcA
          (local.get $hwnd) (i32.const 0x0047) (i32.const 0)
          (local.get $windowpos) (i32.const 0) (i32.const 0))))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const sizes = new Map();
  const positions = new Map();
  const moves = [];
  const zorders = [];
  let memory;
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      set_window_zorder(hwnd, after) {
        zorders.push({ hwnd: hwnd >>> 0, after: after >>> 0 });
      },
      get_window_client_size(hwnd) {
        return sizes.get(hwnd >>> 0) || 0;
      },
      move_window(hwnd, x, y, cx, cy, flags) {
        hwnd >>>= 0;
        flags >>>= 0;
        const oldXY = positions.get(hwnd) || 0;
        const oldWH = sizes.get(hwnd) || 0;
        const nextX = flags & 2 ? oldXY << 16 >> 16 : x;
        const nextY = flags & 2 ? oldXY >> 16 : y;
        const nextCX = flags & 1 ? oldWH & 0xffff : cx;
        const nextCY = flags & 1 ? oldWH >>> 16 : cy;
        positions.set(hwnd, pack(nextX, nextY));
        sizes.set(hwnd, pack(nextCX, nextCY));
        moves.push({ hwnd, x, y, cx, cy, flags });
      },
      get_window_rect(hwnd, out) {
        const xy = positions.get(hwnd >>> 0) || 0;
        const wh = sizes.get(hwnd >>> 0) || 0;
        const view = new DataView(memory.buffer);
        const x = xy << 16 >> 16;
        const y = xy >> 16;
        view.setInt32(out, x, true);
        view.setInt32(out + 4, y, true);
        view.setInt32(out + 8, x + (wh & 0xffff), true);
        view.setInt32(out + 12, y + (wh >>> 16), true);
      },
    },
  });
  const e = harness.exports;
  memory = harness.memory;

  const fixturePath = process.env.WINDOWPOS_FIXTURE || path.join(ROOT, 'test', 'binaries', 'calc.exe');
  const fixture = fs.readFileSync(fixturePath);
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes synchronous wndproc dispatch');
  e.init_dx_com_thunks();

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const observed = e.guest_alloc(OBSERVED_BYTES) >>> 0;
  const proc = e.guest_alloc(512) >>> 0;
  bytes.set(makeWndProc(observed), toWasm(proc));

  const hwnd = e.test_make_window(proc) >>> 0;
  positions.set(hwnd, pack(0, 0));
  sizes.set(hwnd, pack(40, 20));

  const clearObserved = () => bytes.fill(0, toWasm(observed), toWasm(observed) + OBSERVED_BYTES);
  const read = (base, index = 0) => view.getUint32(toWasm(observed + base + index * 4), true);
  const messages = () => Array.from({ length: read(COUNT) }, (_, index) => read(MESSAGES, index));

  clearObserved();
  moves.length = 0;
  assert.strictEqual(e.test_call_SetWindowPos(hwnd, 10, 12, 80, 30, 0x14), 1);
  assert.deepStrictEqual(messages(), [WM_WINDOWPOSCHANGING, WM_WINDOWPOSCHANGED],
    'SetWindowPos sends changing before changed and does not synthesize geometry messages');
  assert.strictEqual(read(XS, 0), 10, 'changing sees the caller-proposed x');
  assert.strictEqual(read(CXS, 0), 80, 'changing sees the caller-proposed width');
  assert.strictEqual(read(FLAGS, 0), 0x14, 'changing sees the caller flags');
  assert.deepStrictEqual(moves[0], {
    hwnd, x: 111, y: 112, cx: 113, cy: 114,
    flags: SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOREDRAW,
  }, 'SetWindowPos commits mutable WINDOWPOS fields while preserving NOACTIVATE');
  assert.strictEqual(read(XS, 1), 111, 'changed sees the committed x');
  assert.strictEqual(read(CYS, 1), 114, 'changed sees the committed height');
  assert.strictEqual(read(FLAGS, 1), 0x1c, 'changed sees the effective flags');

  clearObserved();
  moves.length = 0;
  assert.strictEqual(
    e.test_call_SetWindowPos(hwnd, 21, 22, 81, 31, 0x14 | SWP_NOSENDCHANGING), 1);
  assert.deepStrictEqual(messages(), [WM_WINDOWPOSCHANGED],
    'SWP_NOSENDCHANGING suppresses only the mutable changing message');
  assert.deepStrictEqual(moves[0], {
    hwnd, x: 21, y: 22, cx: 81, cy: 31, flags: 0x414,
  }, 'without changing notification the caller values commit unchanged');
  assert.strictEqual(read(XS, 0), 21, 'changed still carries the committed caller value');

  clearObserved();
  moves.length = 0;
  assert.strictEqual(e.test_call_MoveWindow(hwnd, 30, 32, 90, 35, 1), 1);
  assert.deepStrictEqual(messages(), [WM_WINDOWPOSCHANGING, WM_WINDOWPOSCHANGED],
    'MoveWindow uses the same changing/changed transaction');
  assert.deepStrictEqual(moves[0], {
    hwnd, x: 111, y: 112, cx: 113, cy: 114, flags: 0x1c,
  }, 'MoveWindow commits the mutable WINDOWPOS and protected NOACTIVATE');

  // Move away without a changing callback, then prove deferred positioning
  // stays inert through Defer and inherits the transaction only at End.
  e.test_call_SetWindowPos(hwnd, 50, 52, 70, 25, 0x14 | SWP_NOSENDCHANGING);
  clearObserved();
  moves.length = 0;
  const hdwp = e.test_call_BeginDeferWindowPos() >>> 0;
  assert(hdwp, 'BeginDeferWindowPos succeeds');
  assert.strictEqual(e.test_call_DeferWindowPos(hdwp, hwnd, 60, 62, 75, 28) >>> 0, hdwp);
  assert.deepStrictEqual(messages(), [], 'DeferWindowPos sends nothing before End');
  assert.deepStrictEqual(moves, [], 'DeferWindowPos changes no geometry before End');
  assert.strictEqual(e.test_call_EndDeferWindowPos(hdwp), 1);
  assert.deepStrictEqual(messages(), [WM_WINDOWPOSCHANGING, WM_WINDOWPOSCHANGED],
    'EndDeferWindowPos commits through the same message transaction');
  assert.strictEqual(moves[0].x, 111, 'deferred commit honors changing mutation');

  // A wndproc that consumed WM_WINDOWPOSCHANGED above got no WM_MOVE/WM_SIZE.
  // Calling either DefWindowProc spelling is what derives them synchronously.
  const windowpos = e.guest_alloc(28) >>> 0;
  const wp = toWasm(windowpos);
  view.setUint32(wp, hwnd, true);
  view.setUint32(wp + 24, 0, true);
  clearObserved();
  assert.strictEqual(e.test_call_DefWindowProc(hwnd, windowpos, 0), 0);
  assert.deepStrictEqual(messages(), [WM_MOVE, WM_SIZE],
    'DefWindowProcA derives synchronous WM_MOVE then WM_SIZE');
  assert.strictEqual(read(LPARAMS, 0), pack(111, 112), 'WM_MOVE carries the client origin');
  assert.strictEqual(read(LPARAMS, 1), pack(113, 114), 'WM_SIZE carries the client dimensions');

  view.setUint32(wp + 24, 2, true); // SWP_NOMOVE
  clearObserved();
  assert.strictEqual(e.test_call_DefWindowProc(hwnd, windowpos, 1), 0);
  assert.deepStrictEqual(messages(), [WM_SIZE],
    'DefWindowProcW shares flag-sensitive geometry derivation');

  // Use a separate code address: rewriting an already decoded wndproc would
  // test instruction-cache invalidation instead of WINDOWPOS semantics.
  const zproc = e.guest_alloc(512) >>> 0;
  bytes.set(makeWndProc(observed, SWP_NOREDRAW), toWasm(zproc));
  const zhwnd = e.test_make_window(zproc) >>> 0;
  clearObserved();
  zorders.length = 0;
  assert.strictEqual(e.test_call_SetWindowPos(zhwnd, 1, 2, 30, 40, 0x14), 1);
  assert.deepStrictEqual(zorders, [{ hwnd: zhwnd, after: 1 }],
    'changing can clear NOZORDER and replace HWND_TOP with HWND_BOTTOM at the host');
  assert.strictEqual(read(INSERT_AFTER, 0), 0, 'changing sees the original insertion target');
  assert.strictEqual(read(INSERT_AFTER, 1), 1, 'changed reports the target actually committed');

  clearObserved();
  zorders.length = 0;
  assert.strictEqual(e.test_call_SetWindowPos(hwnd, 1, 2, 30, 40, SWP_NOACTIVATE), 1);
  assert.deepStrictEqual(zorders, [], 'changing can set NOZORDER to suppress the host change');

  clearObserved();
  zorders.length = 0;
  assert.strictEqual(e.test_call_SetWindowPos(zhwnd, 1, 2, 30, 40,
    SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_NOREDRAW), 1);
  assert.deepStrictEqual(messages(), [WM_WINDOWPOSCHANGED]);
  assert.deepStrictEqual(zorders, [{ hwnd: zhwnd, after: 0 }],
    'NOSENDCHANGING commits the original insertion target');
  assert.strictEqual(read(INSERT_AFTER), 0);

  clearObserved();
  zorders.length = 0;
  assert.strictEqual(e.test_call_MoveWindow(zhwnd, 3, 4, 50, 60, 1), 1);
  assert.deepStrictEqual(zorders, [{ hwnd: zhwnd, after: 1 }],
    'MoveWindow also honors callback-enabled Z-order and the replacement target');

  const retired = e.test_make_window(proc) >>> 0;
  e.test_retire(retired);
  for (const invalid of [0, 0x76543210, retired]) {
    clearObserved();
    moves.length = 0;
    zorders.length = 0;
    assert.strictEqual(e.test_call_SetWindowPos(invalid, 1, 2, 30, 40, 0x18), 0,
      `invalid target ${invalid} fails instead of reporting success`);
    assert.strictEqual(e.test_last_error(), 1400);
    assert.deepStrictEqual(moves, [], 'invalid target never reaches host geometry');
    assert.deepStrictEqual(zorders, [], 'invalid target never reaches host Z-order');
    assert.deepStrictEqual(messages(), [], 'invalid target receives no notification');
    assert.strictEqual(e.test_call_MoveWindow(invalid, 1, 2, 30, 40, 1), 0);
    assert.strictEqual(e.test_last_error(), 1400);
    assert.deepStrictEqual(moves, [], 'invalid MoveWindow target never reaches geometry');
    assert.deepStrictEqual(zorders, [], 'invalid MoveWindow target never reaches Z-order');
    assert.deepStrictEqual(messages(), []);
  }

  console.log('PASS  WINDOWPOS changing/changed mutation and DefWindowProc geometry semantics');
  await testCustomExposure();
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});

async function testCustomExposure() {
  const h = await bootRenderHarness({ extraWat, fonts: 'none' }), e = h.exports;
  const api = require('../src/api_table.json');
  const thunk = name => e.exposure_thunk(api.find(a => a.name === name).id) >>> 0;
  const begin = thunk('BeginPaint'), fill = thunk('FillRect'), end = thunk('EndPaint');
  const invalidate = thunk('InvalidateRect');
  const order = e.guest_alloc(1024), rc = e.guest_alloc(16);
  const brushes = [0x000000ff, 0x00ff0000, 0x0000ffff, 0x00ff00ff, 0x0000ff00].map(c => e.test_call_CreateSolidBrush(c));
  const write = (addr, words) => words.forEach((v,i) => e.guest_write32(addr+i*4,v));
  // Actual x86 stdcall wndprocs call BeginPaint/FillRect/EndPaint. No host
  // callback paints for them; erase returns handled and the paint draws the
  // parent's pattern or the child's two-color marker through its real DC.
  function painter(rectangles) {
    const ps = e.guest_alloc(64), code = [], fixups = [], labels = new Map();
    const emit = (...b) => code.push(...b.map(v=>v&255));
    const jcc = (op,label) => { emit(0x0f,op,0,0,0,0);fixups.push([code.length-4,label]); };
    const call = addr => emit(0xb8,...u32(addr),0xff,0xd0);
    emit(0x55,0x89,0xe5,0x53,0x56); // ebp frame, preserve ebx/esi
    emit(0x83,0x7d,0x0c,0x0f);jcc(0x85,'other');
    emit(0x8b,0x0d,...u32(order),0x8b,0x45,0x08,0x89,0x04,0x8d,...u32(order+4),0xff,0x05,...u32(order));
    emit(0x68,...u32(ps),0xff,0x75,0x08);call(begin);emit(0x89,0xc6);
    for(const [l,t,r,b,brush] of rectangles){const rect=e.guest_alloc(16);write(rect,[l,t,r,b]);emit(0x68,...u32(brush),0x68,...u32(rect),0x56);call(fill);}
    emit(0x68,...u32(ps),0xff,0x75,0x08);call(end);
    labels.set('other',code.length);
    // The real VCL tile invalidates itself after its geometry notification.
    // Exercise that guest behavior without having the test host paint it.
    emit(0x83,0x7d,0x0c,0x47);jcc(0x85,'finish');
    emit(0x6a,0,0x6a,0,0xff,0x75,0x08);call(invalidate);
    labels.set('finish',code.length);emit(0xb8,1,0,0,0,0x5e,0x5b,0x5d,0xc2,16,0);
    for(const [at,label] of fixups)u32(labels.get(label)-(at+4)).forEach((v,i)=>code[at+i]=v);
    const proc=e.guest_alloc(code.length);code.forEach((b,i)=>e.guest_write8(proc+i,b));return proc;
  }
  const pattern=[];for(let x=0;x<160;x+=4)pattern.push([x,0,x+4,80,brushes[(x/4)%2]]);
  const parent=e.exposure_create(painter(pattern),0,0,0,160,80)>>>0;
  const tile=e.exposure_create(painter([[0,0,20,30,brushes[2]],[20,0,40,30,brushes[3]]]),parent,80,10,40,30)>>>0;
  const sibling=e.exposure_create(painter([[0,0,12,30,brushes[4]]]),parent,100,10,12,30)>>>0;
  const unrelated=e.exposure_create(painter([[0,0,10,10,brushes[4]]]),parent,140,60,10,10)>>>0;
  assert.strictEqual(e.ctrl_get_class(tile),0,'regression uses guest custom child, not WAT Button');
  const resetOrder=()=>e.guest_write32(order,0);
  function pump(){const selected=[];for(let i=0;i<32;i++){const hwnd=e.exposure_pump_one()>>>0;if(!hwnd)return selected;selected.push(hwnd);}throw Error('paint did not drain');}
  const rect=hwnd=>e.exposure_rect(hwnd,rc)?[0,1,2,3].map(i=>e.guest_read32(rc+i*4)|0):null;
  e.exposure_damage(parent);pump();
  const dc=e.test_call_GetDC(parent)>>>0;
  const pixel=(x,y)=>e.test_call_GetPixel(dc,x,y)>>>0;
  const expected=x=>(Math.floor(x/4)%2?0x00ff0000:0x000000ff);
  const flags=0x14;
  e.exposure_clear(parent);resetOrder();
  assert.strictEqual(e.test_call_SetWindowPos(tile,60,10,40,30,flags),1);
  const exposed=rect(parent), erase=e.exposure_erase(parent), selected=pump();
  assert.strictEqual(pixel(116,20),expected(116),'vacated custom-child pixels restore patterned parent');
  assert.deepStrictEqual(exposed,[100,10,120,40],'left move exposes only old right strip');
  assert.strictEqual(erase,2,'exposure requests erase through BeginPaint');
  assert.strictEqual(selected[0],parent,'parent guest paints before intersecting descendants');
  assert(selected.includes(sibling),'overlapping exposed sibling is repainted');
  assert(!selected.includes(unrelated),'unrelated sibling is not repainted');
  assert.strictEqual(pixel(106,20),0x0000ff00,'overlapping sibling remains green');
  assert.strictEqual(pixel(65,20),0x0000ffff,'moved child remains painted at new origin');
  assert.strictEqual(pixel(145,65),0x0000ff00,'unrelated sibling pixels stay intact');
  // Repeated small moves are the Tetravex failure trigger.
  for(const x of [50,40,30]){e.test_call_SetWindowPos(tile,x,10,40,30,flags);pump();assert.strictEqual(pixel(x+45,20),expected(x+45));}
  // Diagonal exposure forms an L: bounding-box painting includes part of the
  // new child, which must repaint afterward instead of being brush-wiped.
  e.exposure_clear(parent);e.test_call_SetWindowPos(tile,20,15,40,30,flags);
  assert.deepStrictEqual(rect(parent),[30,10,70,40]);pump();
  assert.strictEqual(pixel(25,20),0x0000ffff,'included new child survives parent L-shape bounding paint');
  assert.strictEqual(pixel(65,20),expected(65));
  // A pure shrink with NOMOVE is separate from movement.
  e.exposure_clear(parent);e.test_call_SetWindowPos(tile,999,999,20,30,flags|2);
  assert.deepStrictEqual(rect(parent),[40,15,60,45]);pump();
  assert.strictEqual(pixel(55,20),expected(55));
  e.exposure_clear(parent);e.test_call_SetWindowPos(tile,20,15,20,30,flags);
  assert.strictEqual(rect(parent),null,'same position/size creates no exposure');
  e.test_call_SetWindowPos(tile,20,15,30,35,flags);
  assert.strictEqual(rect(parent),null,'pure growth at unchanged origin exposes no old parent pixels');
  e.test_call_SetWindowPos(tile,20,15,20,30,flags|8);e.exposure_clear(parent);
  e.test_call_SetWindowPos(tile,10,15,20,30,flags|8);
  assert.strictEqual(rect(parent),null,'NOREDRAW commits geometry without parent damage');
  e.exposure_visible(parent,0);e.test_call_SetWindowPos(tile,0,15,20,30,flags);
  assert.strictEqual(rect(parent),null,'hidden ancestor suppresses exposure');
  e.exposure_visible(parent,1);e.exposure_visible(tile,0);e.test_call_SetWindowPos(tile,5,15,20,30,flags);
  assert.strictEqual(rect(parent),null,'hidden child suppresses exposure');
  e.exposure_visible(tile,1);e.test_call_SetWindowPos(tile,-10,15,20,30,flags|8);e.exposure_clear(parent);
  e.test_call_SetWindowPos(tile,-20,15,20,30,flags);
  assert.deepStrictEqual(rect(parent),[0,15,10,45],'old exposure clips to parent client bounds');pump();
  // A hide combined with movement exposes the whole old rectangle; the new
  // invisible bounds must not be subtracted. Pure hide policy stays elsewhere.
  e.test_call_SetWindowPos(tile,10,10,20,30,flags|8);e.exposure_clear(parent);
  e.test_call_SetWindowPos(tile,15,10,20,30,flags|0x80);
  assert.deepStrictEqual(rect(parent),[10,10,30,40],'move+hide exposes all formerly visible pixels');pump();
  assert.strictEqual(pixel(25,20),expected(25),'hidden moved child cannot cover parent repaint');
  e.test_call_ReleaseDC(parent,dc);
  console.log('PASS  custom guest-child movement/shrink exposure, patterned pixels, sibling ordering, visibility and NOREDRAW');
}
