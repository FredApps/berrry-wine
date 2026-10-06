'use strict';
// D3D8's 16-bit display mode. Adapter 0 lists 640x480 X8R8G8B8 and then
// R5G6B5; a fullscreen R5G6B5 device renders 32 bpp in the backend and its
// back buffer gets a 16-bit view: GetDesc says R5G6B5, LockRect hands out a
// 16-bit shadow converted from the 32-bit pixels, UnlockRect writes it back.
// LithTech (Die Hard: Nakatomi Plaza demo) needs the mode, Reset into it, and
// CopyRects between its 16-bit managed textures.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Bridge } = require('../lib/d3d9-host');
const { createHostImports } = require('../lib/host-imports');

const ESP = 0x074ff000;
const set = (i, v) => `(call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const ${i})) ${v})`;
const call = (name, args) => `
    (i32.store offset=16 (global.get $reg_base) (i32.const ${ESP}))
    (call $handle_${name} ${args})
    (i32.load offset=0 (global.get $reg_base))`;

(async () => {
  let bridge, productionImport;
  const { exports: e, memory } = await bootRenderHarness({
    fonts: 'none',
    extraHostOverrides: { gpu_gl_call: (op, p, a) => productionImport(op, p, a) },
    extraWat: `
    (func (export "d3d8_create") (result i32)
      ${call('Direct3DCreate8', '(i32.const 220) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)')})
    (func (export "mode_count") (param $a i32) (result i32)
      ${call('IDirect3D8_GetAdapterModeCount', '(i32.const 0) (local.get $a) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)')})
    (func (export "enum_mode") (param $a i32) (param $m i32) (param $out i32) (result i32)
      ${call('IDirect3D8_EnumAdapterModes', '(i32.const 0) (local.get $a) (local.get $m) (local.get $out) (i32.const 0) (i32.const 0)')})
    (func (export "adapter_mode") (param $out i32) (result i32)
      ${call('IDirect3D8_GetAdapterDisplayMode', '(i32.const 0) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0)')})
    (func (export "check_type") (param $disp i32) (param $bb i32) (param $windowed i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const ${ESP}))
      ${set(24, '(local.get $windowed)')}
      (call $handle_IDirect3D8_CheckDeviceType (i32.const 0) (i32.const 0) (i32.const 1)
        (local.get $disp) (local.get $bb) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "create_device") (param $d3d i32) (param $pp i32) (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const ${ESP}))
      ${set(24, '(local.get $pp)')} ${set(28, '(local.get $out)')}
      (call $handle_IDirect3D8_CreateDevice (local.get $d3d) (i32.const 0) (i32.const 1)
        (i32.const 1) (i32.const 0) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "device_mode") (param $d i32) (param $out i32) (result i32)
      ${call('IDirect3DDevice8_GetDisplayMode', '(local.get $d) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)')})
    (func (export "back_buffer") (param $d i32) (param $out i32) (result i32)
      ${call('IDirect3DDevice8_GetBackBuffer', '(local.get $d) (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0)')})
    (func (export "surf_desc") (param $s i32) (param $out i32) (result i32)
      ${call('IDirect3DSurface8_GetDesc', '(local.get $s) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)')})
    (func (export "surf_lock") (param $s i32) (param $locked i32) (param $rect i32) (param $flags i32) (result i32)
      ${call('IDirect3DSurface8_LockRect', '(local.get $s) (local.get $locked) (local.get $rect) (local.get $flags) (i32.const 0) (i32.const 0)')})
    (func (export "surf_unlock") (param $s i32) (result i32)
      ${call('IDirect3DSurface8_UnlockRect', '(local.get $s) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)')})
    (func (export "back_bits") (param $d i32) (result i32)
      (load.field DxObject misc1 (call $d3ddev_rt_entry (local.get $d))))
    (func (export "managed_texture") (param $d i32) (param $fmt i32) (param $out i32) (result i32)
      (call $d3d9_texture_create (local.get $d) (i32.const 8) (i32.const 8) (i32.const 1)
        (i32.const 0) (local.get $fmt) (i32.const 1) (local.get $out))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "surface_level") (param $t i32) (param $out i32) (result i32)
      ${call('IDirect3DTexture8_GetSurfaceLevel', '(local.get $t) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0)')})
    (func (export "copy_rects") (param $d i32) (param $src i32) (param $rects i32) (param $n i32) (param $dst i32) (param $points i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const ${ESP}))
      ${set(24, '(local.get $points)')}
      (call $handle_IDirect3DDevice8_CopyRects (local.get $d) (local.get $src) (local.get $rects)
        (local.get $n) (local.get $dst) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
  ` });
  productionImport = createHostImports({ getMemory: () => memory.buffer, exports: e,
    d3d9Bridge: { call: (...args) => bridge.call(...args) } }).host.gpu_gl_call;
  bridge = new Bridge({ backend: 'software', enableProgrammable: true, getExports: () => e,
    getMemory: () => memory.buffer, guestToWasm: p => e.guest_to_wasm(p) >>> 0 });
  e.d3dim_worker_init(0x400000); e.init_dx_com_thunks();
  const alloc = n => e.guest_alloc(n) >>> 0, read = p => e.guest_read32(p) >>> 0;
  const write = (p, a) => a.forEach((v, i) => e.guest_write32(p + i * 4, v));
  const read16 = p => read(p) & 0xffff;
  const write16 = (p, v) => e.guest_write32(p, (read(p) & 0xffff0000) | v);
  const OK = 0, INVALIDCALL = 0x8876086c, NOTAVAILABLE = 0x8876086a;
  const x8 = v => {
    const r = (v >>> 11) & 31, g = (v >>> 5) & 63, b = v & 31;
    return (0xff000000 | ((r << 3 | r >> 2) << 16) | ((g << 2 | g >> 4) << 8) | (b << 3 | b >> 2)) >>> 0;
  };
  const out = alloc(64);

  // Enumeration: X8R8G8B8 first (callers taking mode 0 are unchanged), then R5G6B5.
  assert.strictEqual(e.mode_count(0), 2, 'two modes on adapter 0');
  assert.strictEqual(e.mode_count(1), 0, 'no second adapter');
  assert.strictEqual(e.enum_mode(0, 0, out) >>> 0, OK);
  assert.deepStrictEqual([0, 1, 2, 3].map(i => read(out + i * 4)), [640, 480, 60, 22]);
  assert.strictEqual(e.enum_mode(0, 1, out) >>> 0, OK);
  assert.deepStrictEqual([0, 1, 2, 3].map(i => read(out + i * 4)), [640, 480, 60, 23]);
  assert.strictEqual(e.enum_mode(0, 2, out) >>> 0, INVALIDCALL, 'past the last mode');
  assert.strictEqual(e.adapter_mode(out) >>> 0, OK);
  assert.strictEqual(read(out + 12), 22, 'the desktop is X8R8G8B8 before any 16-bit device');
  assert.strictEqual(e.check_type(23, 23, 0) >>> 0, OK, 'fullscreen R5G6B5 is a device type');
  assert.strictEqual(e.check_type(23, 23, 1) >>> 0, NOTAVAILABLE, 'windowed 16-bit is not');
  assert.strictEqual(e.check_type(22, 22, 1) >>> 0, OK, 'X8R8G8B8 unchanged');

  const d3d = e.d3d8_create() >>> 0;
  assert(d3d, 'Direct3DCreate8');
  // D3DPRESENT_PARAMETERS8: W H Format Count MultiSample SwapEffect hwnd
  // Windowed AutoDepth AutoFormat Flags(LOCKABLE_BACKBUFFER) Refresh Interval.
  const pp = alloc(64);
  write(pp, [8, 8, 23, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0]);
  assert.strictEqual(e.create_device(d3d, pp, out) >>> 0, INVALIDCALL, 'windowed R5G6B5 back buffer refused');
  assert.strictEqual(read(out), 0, 'and no device handed out');
  write(pp, [8, 8, 23, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0]);
  assert.strictEqual(e.create_device(d3d, pp, out) >>> 0, OK, 'fullscreen R5G6B5 device');
  const dev = read(out);
  assert.strictEqual(e.device_mode(dev, out) >>> 0, OK);
  assert.strictEqual(read(out + 12), 23, 'device display mode is R5G6B5');
  assert.strictEqual(e.adapter_mode(out) >>> 0, OK);
  assert.strictEqual(read(out + 12), 23, 'the adapter now reads the 16-bit mode');

  assert.strictEqual(e.back_buffer(dev, out) >>> 0, OK);
  const back = read(out);
  assert.strictEqual(e.surf_desc(back, out) >>> 0, OK);
  assert.strictEqual(read(out), 23, 'back buffer reports R5G6B5');
  assert.strictEqual(read(out + 16), 8 * 8 * 2, 'and a 16-bit byte size');
  assert.deepStrictEqual([read(out + 24), read(out + 28)], [8, 8]);

  // Write lock: the 16-bit pixels land in the 32-bit storage widened.
  const locked = alloc(8), rect = alloc(16);
  assert.strictEqual(e.surf_lock(back, locked, 0, 0) >>> 0, OK);
  assert.strictEqual(read(locked), 16, '16-bit pitch');
  let bits = read(locked + 4);
  const pattern = Array.from({ length: 64 }, (_, i) => (i * 0x0841 + 0x1234) & 0xffff);
  pattern.forEach((v, i) => write16(bits + i * 2, v));
  assert.strictEqual(e.surf_unlock(back) >>> 0, OK);
  const storage = new Uint32Array(memory.buffer, e.back_bits(dev), 64);
  assert.deepStrictEqual(Array.from(storage), pattern.map(x8), 'unlock widens into the 32-bit back buffer');

  // Read-only lock: the same 16-bit values come back (R5G6B5 -> X8R8G8B8 ->
  // R5G6B5 is lossless) and nothing is written back.
  assert.strictEqual(e.surf_lock(back, locked, 0, 0x10) >>> 0, OK);
  bits = read(locked + 4);
  assert.deepStrictEqual(Array.from({ length: 64 }, (_, i) => read16(bits + i * 2)), pattern,
    'lock narrows the 32-bit pixels');
  write16(bits, 0xffff);
  assert.strictEqual(e.surf_unlock(back) >>> 0, OK);
  assert.strictEqual(storage[0], x8(pattern[0]), 'a read-only lock writes nothing back');

  // Sub-rect lock: pBits points at the rect's origin in the 16-bit shadow.
  write(rect, [2, 1, 5, 3]);
  assert.strictEqual(e.surf_lock(back, locked, rect, 0) >>> 0, OK);
  assert.strictEqual(read(locked), 16);
  write16(read(locked + 4), 0xf800);
  assert.strictEqual(e.surf_unlock(back) >>> 0, OK);
  assert.strictEqual(storage[1 * 8 + 2], 0xffff0000, 'the rect origin pixel is pure red');
  assert.strictEqual(storage[1 * 8 + 1], x8(pattern[9]), 'pixels outside the rect untouched');

  // CopyRects between two managed X1R5G5B5 textures, one rect, offset.
  assert.strictEqual(e.managed_texture(dev, 24, out) >>> 0, OK, 'managed X1R5G5B5 texture');
  const srcTex = read(out);
  assert.strictEqual(e.managed_texture(dev, 24, out) >>> 0, OK);
  const dstTex = read(out);
  assert.strictEqual(e.surface_level(srcTex, out) >>> 0, OK); const src = read(out);
  assert.strictEqual(e.surface_level(dstTex, out) >>> 0, OK); const dst = read(out);
  assert.strictEqual(e.surf_lock(src, locked, 0, 0) >>> 0, OK);
  assert.strictEqual(read(locked), 16, 'X1R5G5B5 texture pitch is two bytes a texel');
  bits = read(locked + 4);
  for (let i = 0; i < 64; i++) write16(bits + i * 2, 0x8000 | i);
  assert.strictEqual(e.surf_unlock(src) >>> 0, OK);
  const rects = alloc(16), points = alloc(8);
  write(rects, [1, 2, 4, 3]); write(points, [5, 6]);
  assert.strictEqual(e.copy_rects(dev, src, rects, 1, dst, points) >>> 0, OK, 'CopyRects');
  assert.strictEqual(e.surf_lock(dst, locked, 0, 0x10) >>> 0, OK);
  bits = read(locked + 4);
  assert.deepStrictEqual([5, 6, 7].map(x => read16(bits + (6 * 8 + x) * 2)),
    [2 * 8 + 1, 2 * 8 + 2, 2 * 8 + 3].map(i => 0x8000 | i), 'the rect lands at the point');
  assert.strictEqual(read16(bits + (6 * 8 + 4) * 2), 0, 'nothing outside it');
  assert.strictEqual(e.surf_unlock(dst) >>> 0, OK);
  assert.strictEqual(e.copy_rects(dev, src, 0, 0, dst, 0) >>> 0, OK, 'whole-surface CopyRects');
  write(rects, [6, 0, 9, 1]);
  assert.strictEqual(e.copy_rects(dev, src, rects, 1, dst, 0) >>> 0, INVALIDCALL, 'a rect past the edge');

  console.log('PASS test-d3d8-16bit-mode');
})().catch(err => { console.error(err); process.exit(1); });
