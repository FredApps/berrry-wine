#!/usr/bin/env node
'use strict';

// MCIWnd (src/09a7i-video-mciwnd.wat) over a tiny RLE8 AVI mounted in the
// VFS, in the message sequence Civilization II MGE sends (civ2.exe
// 0x58e203..0x58e6f6): MCIWndCreateA with WS_CHILD|NOTIFYMODE|NOMENU|
// NOPLAYBAR, MCIWNDM_SETTIMEFORMATA "frames", MCIWNDM_REALIZE, MCI_SEEK
// start, MCI_PLAY, MCIWNDM_NOTIFYMODE back to the parent, GETPOSITIONA,
// MCI_CLOSE, WM_CLOSE. Checks the window takes the movie's size, frames land
// in it on the device clock, the mode reports and notifications, and that
// closing frees both the device and the window.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

const extraWat = String.raw`
  (func (export "t_parent") (result i32)
    (local $top i32)
    (local.set $top (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $host_register_dialog_frame
      (local.get $top) (i32.const 0) (i32.const 0)
      (i32.const 80) (i32.const 60) (i32.const 0))
    (call $wnd_table_set (local.get $top) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $top) (i32.const 0x90000000)))
    (local.get $top))
  (func (export "t_create") (param $parent i32) (param $style i32) (param $file i32) (result i32)
    (call $mciwnd_create (local.get $parent) (local.get $style) (local.get $file)))
  (func (export "t_tick") (call $mciavi_tick_all))
  ;; Posts land in the owning thread's shared USER queue.
  (func (export "t_pq_count") (result i32) (call $shared_post_queue_total_count))
  (func (export "t_pq") (param $i i32) (param $f i32) (result i32)
    (call $shared_post_queue_peek_field_tid (global.get $current_thread_id) (local.get $i) (local.get $f)))
  (func (export "t_pq_reset") (call $shared_post_queue_reset_tid (global.get $current_thread_id)))
  (func (export "t_find") (param $hwnd i32) (result i32) (call $wnd_table_find (local.get $hwnd)))
  (func (export "t_get_pixel") (param $hwnd i32) (param $x i32) (param $y i32) (result i32)
    (local $desc i32) (local $hdc i32)
    (local.set $hdc (i32.add (local.get $hwnd) (i32.const 0x40000)))
    (local.set $desc (global.get $GDI_BLIT_DST_DESC))
    (if (result i32) (call $gdi_surface_descriptor (local.get $hdc) (local.get $desc))
      (then (call $gdi_raster_get_pixel (local.get $desc)
        (call $gdi_line_map_x (local.get $desc) (local.get $x))
        (call $gdi_line_map_y (local.get $desc) (local.get $y))))
      (else (i32.const -1))))
`;

// ---- an 8x4 RLE8 clip, three frames at 10 fps ----
// Palette: 0 blue, 1 red, 2 green.
// Frame 0 (key): all red, top-left pixel blue.
// Frame 1 (delta): top-left 2x2 green.
// Frame 2 (delta): bottom-right pixel blue.
const W = 8, H = 4;
const FRAMES = [
  // bottom-up rows; each ends with EOL, the frame with EOB
  [8, 1, 0, 0, 8, 1, 0, 0, 8, 1, 0, 0, 1, 0, 7, 1, 0, 1],
  [0, 0, 0, 0, 2, 2, 0, 0, 2, 2, 0, 1],
  [7, 1, 1, 0, 0, 1],
];

function fourcc(s) { return Buffer.from(s, 'latin1'); }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }
function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function chunk(id, body) {
  const pad = body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([fourcc(id), u32(body.length), body, pad]);
}
function list(type, parts) {
  const body = Buffer.concat([fourcc(type), ...parts]);
  return Buffer.concat([fourcc('LIST'), u32(body.length), body]);
}

function buildAvi() {
  const avih = Buffer.concat([
    u32(100000), u32(0), u32(0), u32(0x10), u32(FRAMES.length), u32(0), u32(1),
    u32(256), u32(W), u32(H), u32(0), u32(0), u32(0), u32(0)]);
  const strh = Buffer.concat([
    fourcc('vids'), fourcc('RLE '), u32(0), u16(0), u16(0), u32(0),
    u32(1), u32(10), u32(0), u32(FRAMES.length), u32(256), u32(0xFFFFFFFF), u32(0),
    u16(0), u16(0), u16(W), u16(H)]);
  const palette = Buffer.alloc(256 * 4);
  palette.set([255, 0, 0, 0], 0);   // BGRX blue
  palette.set([0, 0, 255, 0], 4);   // red
  palette.set([0, 255, 0, 0], 8);   // green
  const strf = Buffer.concat([
    u32(40), u32(W), u32(H), u16(1), u16(8), u32(1 /* BI_RLE8 */), u32(0),
    u32(0), u32(0), u32(256), u32(0), palette]);
  const hdrl = list('hdrl', [chunk('avih', avih),
    list('strl', [chunk('strh', strh), chunk('strf', strf)])]);
  const frameChunks = FRAMES.map(f => chunk('00dc', Buffer.from(f)));
  const movi = list('movi', frameChunks);
  // idx1 offsets are relative to the 'movi' fourcc.
  let off = 4;
  const idx = frameChunks.map((c, i) => {
    const e = Buffer.concat([fourcc('00dc'), u32(i === 0 ? 0x10 : 0), u32(off), u32(FRAMES[i].length)]);
    off += c.length;
    return e;
  });
  const body = Buffer.concat([fourcc('AVI '), hdrl, movi, chunk('idx1', Buffer.concat(idx))]);
  return Buffer.concat([fourcc('RIFF'), u32(body.length), body]);
}

const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255];
const MODE_STOP = 525, MODE_PLAY = 526, MODE_NOT_READY = 524;

(async () => {
  let ticks = 1000;
  const h = await bootRenderHarness({ extraWat, width: 96, height: 64, fonts: 'none',
    extraHostOverrides: { get_ticks: () => ticks } });
  const e = h.exports;
  e.init_thread(0, 0, 0, 0, 0, 0, 0, 0x1000);
  h.hostCtx.vfs.files.set('c:\\movie.avi', { data: new Uint8Array(buildAvi()), attrs: 0x20 });

  const str = (s) => {
    const ga = e.guest_alloc(s.length + 1) >>> 0;
    const b = new Uint8Array(h.memory.buffer, RegionMap.GUEST_BASE + ga, s.length + 1);
    b.set(Buffer.from(s + '\0', 'latin1'));
    return ga;
  };
  const readStr = (ga) => {
    const b = new Uint8Array(h.memory.buffer, RegionMap.GUEST_BASE + ga, 64);
    return Buffer.from(b.subarray(0, b.indexOf(0))).toString('latin1');
  };
  const pixel = (hwnd, x, y) => {
    const c = e.t_get_pixel(hwnd, x, y) >>> 0;
    return [c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF];
  };
  const send = (hwnd, msg, w = 0, l = 0) => e.send_message(hwnd, msg, w, l) | 0;
  // The MCIWNDM_NOTIFYMODE posts for $parent, in order, then drained.
  const modes = (parent, hwnd) => {
    const out = [];
    for (let i = 0; i < e.t_pq_count(); i++) {
      if (e.t_pq(i, 1) !== 0x4C8) continue;
      assert.strictEqual(e.t_pq(i, 0) >>> 0, parent, 'NOTIFYMODE goes to the parent');
      assert.strictEqual(e.t_pq(i, 2) >>> 0, hwnd, 'with the MCIWnd as wParam');
      out.push(e.t_pq(i, 3));
    }
    return out;
  };
  // Deliver the device's MM_MCINOTIFY posts to the window, as DispatchMessage would.
  const deliverMci = (hwnd) => {
    let n = 0;
    for (let i = 0; i < e.t_pq_count(); i++) {
      if (e.t_pq(i, 1) !== 0x3B9) continue;
      assert.strictEqual(e.t_pq(i, 0) >>> 0, hwnd, 'MM_MCINOTIFY goes to the MCIWnd');
      send(hwnd, 0x3B9, e.t_pq(i, 2), e.t_pq(i, 3));
      n++;
    }
    return n;
  };

  const parent = e.t_parent() >>> 0;
  // WS_CHILD | MCIWNDF_NOTIFYMODE | MCIWNDF_NOMENU | MCIWNDF_NOPLAYBAR
  const hwnd = e.t_create(parent, 0x4000010a, str('c:\\movie.avi')) >>> 0;
  assert(hwnd, 'MCIWndCreateA made a window');
  assert(e.t_find(hwnd) >= 0, 'the window is in the window table');
  assert.strictEqual(e.ctrl_get_wh(hwnd) >>> 0, W | (H << 16), 'the window takes the movie size');
  const dev = send(hwnd, 0x464);
  assert(dev >= 0x7F00, `MCIWNDM_GETDEVICEID names the avivideo device (${dev})`);
  assert.deepStrictEqual(modes(parent, hwnd), [MODE_STOP], 'open reports stopped');
  e.t_pq_reset();

  assert.strictEqual(send(hwnd, 0x477, 0, str('frames')), 0, 'MCIWNDM_SETTIMEFORMATA frames');
  assert.strictEqual(send(hwnd, 0x468), FRAMES.length, 'MCIWNDM_GETLENGTH in frames');
  assert.strictEqual(send(hwnd, 0x476), 0, 'MCIWNDM_REALIZE');
  assert.strictEqual(send(hwnd, 0x47E), 0, 'MCIWNDM_GETPALETTE: true-colour output, no palette');
  const modeBuf = e.guest_alloc(32) >>> 0;
  assert.strictEqual(send(hwnd, 0x46A, 32, modeBuf), MODE_STOP, 'MCIWNDM_GETMODEA');
  assert.strictEqual(readStr(modeBuf), 'stopped', 'and its string');
  assert.strictEqual(send(hwnd, 0x807, 0, -1), 0, 'MCI_SEEK to MCIWND_START');
  e.t_pq_reset();

  assert.strictEqual(send(hwnd, 0x806), 0, 'MCI_PLAY');
  assert.strictEqual(send(hwnd, 0x46A), MODE_PLAY, 'playing');
  assert.deepStrictEqual(modes(parent, hwnd), [MODE_PLAY], 'play reports playing');
  e.t_pq_reset();
  e.t_tick();
  assert.deepStrictEqual(pixel(hwnd, 0, 0), BLUE, 'frame 0 is in the window');
  assert.deepStrictEqual(pixel(hwnd, 3, 1), RED);
  ticks += 100; e.t_tick();
  assert.deepStrictEqual(pixel(hwnd, 1, 1), GREEN, 'frame 1 follows the clock');
  ticks += 100; e.t_tick();
  assert.deepStrictEqual(pixel(hwnd, 7, 3), BLUE, 'frame 2');
  ticks += 200; e.t_tick(); e.t_tick();
  assert.strictEqual(deliverMci(hwnd), 1, 'the device notified the window at the end');
  assert.deepStrictEqual(modes(parent, hwnd), [MODE_STOP], 'the parent hears it stopped');
  const posBuf = e.guest_alloc(32) >>> 0;
  assert.strictEqual(send(hwnd, 0x466, 32, posBuf), FRAMES.length, 'MCIWNDM_GETPOSITIONA at the end');
  assert.strictEqual(readStr(posBuf), String(FRAMES.length));

  assert.strictEqual(send(hwnd, 0x807, 0, -1), 0, 'MCI_SEEK back to the start');
  assert.strictEqual(send(hwnd, 0x466), 0, 'position 0');
  assert.strictEqual(send(hwnd, 0x806), 0, 'MCI_PLAY again');
  assert.strictEqual(send(hwnd, 0x808), 0, 'MCI_STOP');
  assert.strictEqual(send(hwnd, 0x46A), MODE_STOP);
  e.t_pq_reset();

  assert.strictEqual(send(hwnd, 0x804), 0, 'MCI_CLOSE');
  assert.strictEqual(send(hwnd, 0x464), 0, 'no device after close');
  assert.strictEqual(send(hwnd, 0x46A), MODE_NOT_READY, 'not ready without a movie');
  assert.strictEqual(send(hwnd, 0x499, 0, str('c:\\movie.avi')), 0, 'MCIWNDM_OPENA reopens');
  assert(send(hwnd, 0x464) >= 0x7F00);
  send(hwnd, 0x0010);
  assert(e.t_find(hwnd) < 0, 'WM_CLOSE destroys the window');
  assert.strictEqual(send(parent, 0x0000), 0);
  // The device went with it: its alias is free for a new window.
  const again = e.t_create(parent, 0x4000010a, str('c:\\movie.avi')) >>> 0;
  assert(send(again, 0x464) >= 0x7F00, 'a new MCIWnd opens after the old one closed');
  send(again, 0x0010);

  console.log('PASS test-mciwnd');
})().catch((err) => { console.error(err); process.exit(1); });
