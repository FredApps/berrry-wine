#!/usr/bin/env node
// Diagnostic for the known static OLE identity split; exits 1 until the contract is fixed.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { bootRenderHarness } = require(root + '/test/render-helper');
(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const exe = fs.readFileSync(root + '/test/binaries/calc.exe');
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  if (!e.load_pe(exe.length)) throw Error('PE initialization failed');
  e.init_dx_com_thunks();
  const alloc = n => e.guest_alloc(n) >>> 0;
  const read = p => e.guest_read32(p) >>> 0;
  const write = (p, v) => e.guest_write32(p, v);
  const iid = id => {
    const p = alloc(16);
    [id, 0, 0xc0, 0x46000000].forEach((v, i) => write(p + i * 4, v));
    return p;
  };
  const call = (p, slot, ...args) => {
    const fn = read(read(p) + slot * 4);
    if (!fn) throw Error('missing COM thunk');
    const argv = [p, ...args, 0, 0, 0].slice(0, 4);
    e.call_func(fn, ...argv);
    for (let i = 0; i < 1000 && e.get_eip(); i++) e.run(5000);
    if (e.get_eip()) throw Error('continuation did not finish');
    return e.get_eax() >>> 0;
  };
  const object = e.test_ole_create_static_handler(0) >>> 0;
  const out = alloc(4), unknown = iid(0), dataId = iid(0x10e), oleId = iid(0x112);
  const query = (p, id) => {
    write(out, 0x12345678);
    const hr = call(p, 0, id, out);
    return { hr, ptr: read(out) };
  };
  const data = query(object, dataId);
  if (data.hr || !data.ptr || data.ptr === 0x12345678) throw Error('IDataObject query did not execute');
  const fromRoot = query(object, unknown);
  const fromData = query(data.ptr, unknown);
  const backToOle = query(data.ptr, oleId);
  const result = { object, data, fromRoot, fromData, backToOle,
    sameIUnknown: fromRoot.ptr === fromData.ptr,
    countsBeforeBalancing: { root: read(object + 4), data: read(data.ptr + 4) } };
  if (backToOle.hr === 0 && backToOle.ptr) call(backToOle.ptr, 2);
  call(fromRoot.ptr, 2);
  call(fromData.ptr, 2);
  result.releaseOriginalRoot = call(object, 2);
  result.remainingDataCount = read(data.ptr + 4);
  result.releaseData = call(data.ptr, 2);
  console.log(JSON.stringify(result, null, 2));
  if (!result.sameIUnknown || backToOle.hr !== 0 || backToOle.ptr !== object) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
