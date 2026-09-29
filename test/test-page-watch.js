#!/usr/bin/env node
'use strict';
// Real VM accessors, shared instances, bulk/native writes and cache consumers.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { D3DIMGpu } = require('../lib/d3dim-gpu');
const extraWat = `
  (export "watch_store64" (func $gs64))
  (export "watch_copy" (func $guest_memmove))
  (export "watch_fill" (func $guest_memset))
  (export "watch_native_copy" (func $memcpy))
  (export "watch_native_zero" (func $zero_memory))
  (export "watch_window" (func $uop_window_set))
  (export "watch_block" (func $uop_rg_block_ok))
  (export "watch_dib_alloc" (func $dib_alloc))
  (export "watch_dib_free" (func $dib_free_wasm))
  (export "watch_fill_rect" (func $viewport_fill_rect))
  (export "watch_surface_fmt" (func $dx_surf_fmt_set))
  (export "watch_surface_free" (func $dx_free))
  (export "watch_gdi_upload" (func $gdi_write_surface_upload))
  (export "watch_bitmap_alloc" (func $gdi_bitmap_alloc))
  (export "watch_bitmap_bits" (func $gdi_bitmap_storage))
  (func (export "watch_epoch") (result i32) (i32.atomic.load (global.get $UOP_WIN_EPOCH)))
  (func (export "watch_alias") (param $g i32) (param $wa i32)
    (drop (call $guest_page_publish_range (local.get $g) (i32.const 4096)
      (local.get $wa) (i32.const 4))))
`;

(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: e, memory } = h;
  e.heap_init(0x2000000);
  const u32 = new Uint32Array(memory.buffer), u64 = new BigUint64Array(memory.buffer);
  const root = e.page_watch_root() >>> 0;
  const cell = wa => Atomics.load(u32, (root >>> 2) + (wa >>> 22)) + ((wa >>> 12) & 1023) * 16;
  const generation = wa => cell(wa) ? Atomics.load(u64, (cell(wa) + 8) >>> 3) : 0n;
  const refs = wa => Atomics.load(u32, cell(wa) >>> 2);
  const changed = (addresses, fn) => {
    const before = addresses.map(generation); fn();
    addresses.forEach((p, i) => assert(generation(p) > before[i], `missing notification at ${p.toString(16)}`));
  };
  const g = 0x60000000;
  assert(e.test_virtual_map_commit(g, 65536));
  const wa = e.guest_to_wasm(g) >>> 0;
  const window = e.guest_to_wasm(0x420000) >>> 0;
  assert.equal(e.watch_window(window, g, 65536, 1), 1);

  const dibGuest = e.watch_dib_alloc(8192), dib = e.guest_to_wasm(dibGuest) >>> 0;
  assert.equal(e.page_watch_acquire(dib, 8192), 1);
  changed([dib, dib + 4096], () => e.watch_dib_free(dib));
  assert.equal(e.watch_dib_alloc(8192), dibGuest, 'backing is recycled');
  e.page_watch_release(dib, 8192);

  // Actual software rasterizer -> actual texture decoder, with the audit on.
  const surface = e.test_dx_alloc(2) >>> 0, view = new DataView(memory.buffer);
  view.setUint16(surface + 12, 64, true); view.setUint16(surface + 14, 64, true);
  view.setUint16(surface + 16, 16, true); view.setUint16(surface + 18, 128, true);
  view.setUint32(surface + 20, dib, true); e.watch_surface_fmt(surface, 1);
  const native = new D3DIMGpu({ getExports: () => e, getMemory: () => memory.buffer,
    createCanvas: () => { throw Error('no GL needed'); } });
  e.set_page_watch_audit(1); native._view();
  const nt = { textureKeys: new Set() };
  const nd = { texture: surface, texDib: dib, texPitch: 128, texWidth: 64, texHeight: 64,
    texBpp: 16, palette: 0, keyed: 0, keyRaw: 0 };
  const initial = native._texture(nt, nd);
  changed([dib], () => e.watch_fill_rect(surface, 0, 0, 20, 20, 0xff0000));
  const painted = native._texture(nt, nd);
  assert.notEqual(initial.key, painted.key);
  assert(painted.pixels.some((v, i) => i % 4 === 0 && v === 255), 'decoded red native pixels reach texture cache');
  assert.equal(native.stats.dirtyAuditMisses, 0);
  const rows = [];
  const rt = { rt: surface, width: 64, height: 64, bpp: 16, format: 1, dib: 0,
    check: true, dirty: false, textureKeys: new Set(), device: { gpu: {
      updateColorResource: (_key, _bytes, rect) => rows.push(rect), bindImplicitTarget() {},
      gl: { RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, readPixels: (_x, _y, _w, _h, _fmt, _type, pixels) => pixels.fill(255) },
    } } };
  const rd = { rt: surface, dib, pitch: 128, height: 64, format: 1 };
  native._prepare(rt, rd, false);
  rt.check = true; native._prepare(rt, rd, false); assert.equal(rows.length, 1, 'clean target skips upload');
  e.guest_write16(dibGuest + 30 * 128, 0x07e0);
  rt.check = true; native._prepare(rt, rd, false);
  assert.equal(rows.length, 2); assert.equal(rows[1].y, 30); assert.equal(rows[1].height, 1);
  e.page_watch_write(dib, 8192); // conservative whole-surface Unlock, identical bytes
  rt.check = true; native._prepare(rt, rd, false); assert.equal(rows.length, 2);
  assert.equal(rt.watch.changes(), null, 'acknowledge identical dirty rows');
  // Flip can swap DIBs while the GPU target and its byte shadow stay alive.
  const otherGuest = e.watch_dib_alloc(8192), other = e.guest_to_wasm(otherGuest) >>> 0;
  e.watch_native_copy(other, dib, 8192);
  rt.check = true; native._prepare(rt, { ...rd, dib: other }, false);
  assert.equal(rows.length, 2, 'same pixels in a swapped DIB do not force full upload');
  rt.check = true; native._prepare(rt, rd, false);
  native._texture(nt, nd);
  rt.dirty = true; native.targets.set(surface, rt);
  native.fence();
  assert.equal(rt.watch.changes(), null, 'readback acknowledges only its target lease');
  assert(native.textures.get(surface).watch.changes(), 'readback invalidates a texture alias');
  native._texture(nt, nd); assert.equal(native.stats.dirtyAuditMisses, 0);
  e.watch_surface_free(surface); native.fence();
  assert.equal(native.textures.size, 0); assert.equal(refs(dib), 0, 'dead surfaces release watches');
  native.stop(); e.set_page_watch_audit(0);
  const bitmap = e.watch_bitmap_alloc(32, 32, 32, 1, dib, 128, 0, 0);
  assert(bitmap); assert.equal(e.page_watch_acquire(dib, 4096), 1);
  changed([dib], () => e.watch_gdi_upload(bitmap, 0, 0, 32, 32));
  // The canonical host surface also notifies on actual JS pixel production,
  // while presentation-only markDirty must not make GPU readbacks dirty again.
  const { GdiSurface } = require('../lib/gdi-surface');
  const jsSurface = new GdiSurface({ width: 32, height: 32, bpp: 32,
    storage: new Uint8Array(memory.buffer), storageOffset: dib,
    onWrite: (p, n) => e.page_watch_write(p, n) });
  changed([dib], () => jsSurface.fillRect(0, 0, 32, 32, 0xabcdef));
  changed([dib], () => jsSurface.writePixel(1, 1, 0));
  changed([dib], () => jsSurface.writeRgbaRect(1, 1, 1, 1, new Uint8Array([255, 0, 0, 255])));
  const shown = generation(dib); jsSurface.markDirty(0, 0, 32, 32);
  assert.equal(generation(dib), shown);
  e.page_watch_release(dib, 4096);
  const epoch = e.watch_epoch();
  assert.equal(e.page_watch_acquire(wa + 4090, 20), 1);
  assert.notEqual(e.watch_epoch(), epoch, 'old fast-store windows become invalid');
  assert.equal(e.watch_window(window, g, 65536, 1), 0);
  assert.equal(e.watch_window(window, g, 65536, 0), 1, 'read windows remain valid');
  assert.equal(e.watch_block(g, g + 65536, wa, 1), 0, '64KB reguard cannot skip watched interior');
  assert.equal(e.watch_block(g, g + 65536, wa, 0), 1);
  changed([wa], () => e.guest_write8(g + 17, 4));
  changed([wa, wa + 4096], () => e.guest_write16(g + 4095, 0x1234));
  changed([wa, wa + 4096], () => e.guest_write32(g + 4094, 0x12345678));
  changed([wa, wa + 4096], () => e.watch_store64(g + 4093, 123456789n));
  changed([wa, wa + 4096], () => e.watch_copy(g + 4090, g + 8192, 20));
  changed([wa, wa + 4096], () => e.watch_fill(g + 4090, 42, 20));
  changed([wa, wa + 4096], () => e.watch_native_copy(wa + 4090, wa + 8192, 20));
  changed([wa, wa + 4096], () => e.watch_native_zero(wa + 4090, 20));
  changed([wa], () => e.invalidate_code_range(g, 4));
  h.hostCtx.readFile = () => new Uint8Array([1, 2, 3, 4]);
  changed([wa], () => assert.equal(h.host.read_file(wa + 8192, wa, 4), 4));
  changed([wa], () => assert.equal(h.host.wall_clock(wa, 2), 1));
  const unchanged = generation(wa + 8192);
  e.guest_write32(g + 8192, 8);
  assert.equal(generation(wa + 8192), unchanged, 'unwatched page has no generation traffic');

  // Aliases and non-contiguous neighbouring guest pages share backing versions.
  const alias = 0x65000000;
  e.watch_alias(alias, wa); e.watch_alias(alias + 4096, wa + 32768);
  assert.equal(e.page_watch_acquire(wa + 32768, 4096), 1);
  changed([wa], () => e.guest_write32(alias, 7));
  changed([wa, wa + 32768], () => e.watch_store64(alias + 4093, 998877n));
  changed([wa, wa + 32768], () => e.watch_copy(alias + 4090, g + 8192, 20));
  e.page_watch_release(wa + 32768, 4096);

  // A different instance has no private copy of the watch directory.
  const second = new WebAssembly.Instance(h.module, { host: h.host });
  changed([wa], () => second.exports.guest_write32(g, 11));
  assert.equal(e.page_watch_acquire(wa, 1), 1);
  assert.equal(refs(wa), 2);
  e.page_watch_release(wa + 4090, 20);
  assert.equal(refs(wa), 1); assert.equal(refs(wa + 4096), 0);
  e.page_watch_release(wa, 1);
  const released = generation(wa);
  e.guest_write32(g, 12);
  assert.equal(generation(wa), released);
  assert.equal(e.watch_window(window, g, 65536, 1), 1);

  // Actual WASM watches, mocked decode only: cache decisions must see writes
  // through the real guest store path, not a test-only dirty toggle.
  let decodes = 0;
  const errors = [];
  const exports = { ...e, d3dim_gpu_decode_texture: () => { decodes++; return wa + 16384; },
    d3dim_gpu_surface_fmt: () => 1, d3dim_gpu_surface_live: () => 1 };
  const gpu = new D3DIMGpu({ getExports: () => exports, getMemory: () => memory.buffer,
    createCanvas: () => { throw Error('no GL needed'); }, onError: s => errors.push(s) });
  gpu._view();
  const target = { textureKeys: new Set() };
  const desc = { texture: 99, texDib: wa, texPitch: 64, texWidth: 64, texHeight: 128,
    texBpp: 8, palette: wa + 32768, keyed: 0, keyRaw: 0 };
  const texture = () => gpu._texture(target, desc);
  texture(); assert.equal(decodes, 1);
  for (let i = 0; i < 100; i++) texture();
  assert.equal(decodes, 1); assert.equal(gpu.stats.textureByteChecks, 0);
  assert(gpu.stats.pageChecks > 0);
  assert.equal(gpu.textures.get(99).raw, null, 'no texture byte shadow in normal mode');
  e.guest_write8(g + 4097, 99); texture(); assert.equal(decodes, 2);
  e.guest_write32(g + 32768, 0xff123456); texture(); assert.equal(decodes, 3, 'palette tracked separately');
  desc.texture = 100; texture(); assert.equal(decodes, 4, 'second consumer');
  desc.texture = 99; e.guest_write8(g + 2, 98); texture(); assert.equal(decodes, 5);
  desc.texture = 100; texture(); assert.equal(decodes, 6, 'first consumer does not clear second dirtiness');
  e.set_page_watch_audit(1); texture();
  const audited = decodes;
  e.guest_write8(g + 6, 83); texture();
  assert.equal(gpu.stats.dirtyAuditMisses, 0); assert.equal(decodes, audited + 1);
  new Uint8Array(memory.buffer)[wa + 9] ^= 255; // deliberately omit notification
  texture();
  assert.equal(gpu.stats.dirtyAuditMisses, 1); assert.equal(errors.length, 1);
  assert.equal(Atomics.load(u32, (root + 2048) >>> 2), 1, 'audit fails closed for all instances');
  const fallback = decodes;
  new Uint8Array(memory.buffer)[wa + 10] ^= 255; texture();
  assert.equal(decodes, fallback + 1, 'fallback still observes subsequent unnotified writes');
  assert(gpu.stats.textureByteChecks > 0);
  gpu.stop(); assert.equal(refs(wa), 0); assert.equal(refs(wa + 32768), 0);

  // Exercise overflow with an existing live reference; no wrapping refcount.
  Atomics.store(u32, (root + 2048) >>> 2, 0);
  assert.equal(e.page_watch_acquire(wa, 8192), 1);
  Atomics.store(u32, cell(wa + 4096) >>> 2, 0xffffffff);
  assert.equal(e.page_watch_acquire(wa, 8192), 0);
  assert.equal(refs(wa), 1, 'failed registration rolls its earlier page back');
  assert.equal(refs(wa + 4096), 0xffffffff, 'refcount did not wrap');
  Atomics.store(u32, cell(wa + 4096) >>> 2, 1);
  Atomics.store(u32, (root + 2048) >>> 2, 0);
  Atomics.store(u64, (cell(wa) + 8) >>> 3, 0xffffffffffffffffn);
  e.page_watch_write(wa, 1);
  assert.equal(Atomics.load(u32, (root + 2048) >>> 2), 1, 'version wrap fails closed');
  e.page_watch_release(wa, 8192);
  assert.equal(e.page_watch_acquire(memory.buffer.byteLength - 2, 4), 0);
  console.log('PASS selective page watches: stores, aliases, shared instances, windows, bulk copies, palette/cache, release and audit fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
