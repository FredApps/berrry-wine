#!/usr/bin/env node
'use strict';

// DLL-private COM layout is opaque to the host.
// Exit 1 when cache-to-data-face copying writes private fields or leaves an
// unbalanced reference. Covers both cache/face creation orders.
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('../test/render-helper');

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const exe = fs.readFileSync(path.join(__dirname, '../test/binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  if (!e.load_pe(exe.length)) throw Error('PE initialization failed');
  e.init_dx_com_thunks();
  const alloc = n => e.guest_alloc(n) >>> 0;
  const read = p => e.guest_read32(p) >>> 0;
  const write = (p, v) => e.guest_write32(p, v);
  const bytes = new Uint8Array(memory.buffer);
  const wa = p => p - (e.get_image_base() >>> 0) + (e.get_guest_base() >>> 0);
  const call = (obj, slot, ...args) => {
    const fn = read(read(obj) + slot * 4);
    if (!fn) throw Error('missing vtable method');
    e.call_func(fn, ...[obj, ...args, 0, 0, 0].slice(0, 4));
    for (let i = 0; i < 1000 && e.get_eip(); i++) e.run(5000);
    if (e.get_eip()) throw Error('guest continuation did not finish');
    return e.get_eax() >>> 0;
  };
  const success = hr => { if (hr !== 0) throw Error(`HRESULT 0x${hr.toString(16)}`); };
  const format = (id, tymed) => {
    const p = alloc(20);
    [id, 0, 1, 0xffffffff, tymed].forEach((v, i) => write(p + i * 4, v));
    return p;
  };
  const medium = (tymed, payload) => {
    const p = alloc(12);
    [tymed, payload, 0].forEach((v, i) => write(p + i * 4, v));
    return p;
  };
  const iid = alloc(16), out = alloc(4);
  [0x10e, 0, 0xc0, 0x46000000].forEach((v, i) => write(iid + i * 4, v));
  const rows = [];
  for (const faceFirst of [false, true]) {
    const root = e.test_ole_create_static_handler(0) >>> 0;
    const stream = alloc(40), vt = alloc(12), code = alloc(40);
    bytes.fill(0, wa(stream), wa(stream) + 40);
    bytes.fill(0, wa(vt), wa(vt) + 12);
    // +4 is a private cookie, NOT a refcount. Only guest x86 knows that
    // references live at +24, AddRef calls at +28, Release calls at +32.
    const cookie = 0x13572468;
    write(stream, vt); write(stream + 4, cookie); write(stream + 24, 1);
    bytes.set([0x8b,0x44,0x24,0x04, 0xff,0x40,0x18, 0xff,0x40,0x1c,
      0x8b,0x40,0x18, 0xc2,0x04,0x00], wa(code));
    bytes.set([0x8b,0x44,0x24,0x04, 0xff,0x48,0x18, 0xff,0x40,0x20,
      0x8b,0x40,0x18, 0xc2,0x04,0x00], wa(code + 20));
    write(vt + 4, code); write(vt + 8, code + 20);
    const state = () => ({ cookie: read(stream + 4), refs: read(stream + 24),
      addRefs: read(stream + 28), releases: read(stream + 32) });
    let face;
    const query = () => { success(call(root, 0, iid, out)); face = read(out); };
    if (faceFirst) query();
    success(call(root + 52, 7, format(0xc550, 4), medium(4, stream), 1));
    if (!faceFirst) query();
    const afterFacePopulation = state();
    const payload = alloc(4);
    write(payload, 0xaabbccdd);
    success(call(root + 52, 7, format(0xc551, 1), medium(1, payload), 1));
    const afterUnrelatedCacheEdit = state();
    const rootRelease = call(root, 2), faceRelease = call(face, 2);
    const final = state();
    rows.push({ faceFirst, cookieExpected: cookie, afterFacePopulation,
      afterUnrelatedCacheEdit, rootRelease, faceRelease, final });
    if (afterFacePopulation.cookie !== cookie || afterUnrelatedCacheEdit.cookie !== cookie ||
        final.cookie !== cookie || final.refs !== 0 || final.releases !== final.addRefs + 1 ||
        rootRelease !== 1 || faceRelease !== 0) process.exitCode = 1;
  }
  console.log(JSON.stringify(rows, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
