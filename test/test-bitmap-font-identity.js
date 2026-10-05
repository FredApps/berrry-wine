#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
 (func (export "identity_table") (result i32) (global.get $GDI_BITMAP_FONT_TABLE))
 (func (export "identity_wa") (param i32) (result i32) (call $g2w (local.get 0)))
 (func (export "identity_hash") (param i32) (result i32)
   (call $gdi_bitmap_font_path_hash (call $g2w (local.get 0))))
 (func (export "identity_add") (param i32) (result i32)
   (call $gdi_bitmap_font_add_resource (local.get 0)))
 (func (export "identity_buffer") (param i32 i32 i32) (result i32)
   (call $gdi_bitmap_font_add_buffer (local.get 0) (local.get 1) (local.get 2)))
 (func (export "identity_remove") (param i32) (result i32)
   (call $gdi_bitmap_font_remove_resource (local.get 0)))
`;
function firstStrike(bytes) {
  const ne = bytes.readUInt32LE(0x3c);
  let p = ne + bytes.readUInt16LE(ne + 36);
  const shift = bytes.readUInt16LE(p); p += 2;
  while (bytes.readUInt16LE(p)) {
    const type = bytes.readUInt16LE(p), count = bytes.readUInt16LE(p + 2); p += 8;
    for (let i = 0; i < count; i++, p += 12) if (type === 0x8008) {
      const start = bytes.readUInt16LE(p) * 2 ** shift;
      return Buffer.from(bytes.subarray(start, start + bytes.readUInt16LE(p + 2) * 2 ** shift));
    }
  }
  throw Error('System.fon has no FNT fixture');
}
(async () => {
  const h = await bootRenderHarness({ fonts: 'none', extraWat }), e = h.exports;
  const mem = new Uint8Array(h.memory.buffer), dv = new DataView(h.memory.buffer);
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'));
  mem.set(exe, e.get_staging()); assert(e.load_pe(exe.length));
  const held = [];
  const alloc = bytes => {
    const ga = e.guest_alloc(bytes.length); assert(ga); held.push(ga);
    mem.set(bytes, e.identity_wa(ga)); return ga;
  };
  const name = text => alloc(Buffer.from(text + '\0'));
  const pathA = 'c:\\font-id\\5pvu.fon', pathB = 'c:\\font-id\\c3ea.fon';
  const a = name(pathA), b = name(pathB), spellingA = name('C:/FONT-ID/5PVU.FON');
  assert.strictEqual(e.identity_hash(a) >>> 0, 3298562582);
  assert.strictEqual(e.identity_hash(a), e.identity_hash(b));
  assert.strictEqual(e.identity_hash(a), e.identity_hash(spellingA));
  const base = firstStrike(fs.readFileSync(path.join(__dirname, '../fonts/System.fon')));
  const bytesA = Buffer.from(base), bytesB = Buffer.from(base), changedA = Buffer.from(base);
  bytesA[6] = 0x41; bytesB[6] = 0x42; changedA[6] = 0x43;
  const add = (p, pathname, bytes) => {
    h.hostCtx.vfs.files.set(pathname, { data: Uint8Array.from(bytes), attrs: 0x20 });
    return e.identity_add(p);
  };
  function records() {
    const result = [], table = e.identity_table();
    for (let i = 0; i < 48; i++) if (dv.getUint32(table + i * 64, true)) {
      const record = table + i * 64, data = dv.getUint32(record + 8, true), size = dv.getUint32(record + 12, true);
      result.push({ index: i, record: mem.slice(record, record + 64), bytes: mem.slice(data, data + size) });
    }
    return result;
  }
  const tagged = tag => records().find(r => r.bytes[6] === tag);
  try {
    assert.strictEqual(add(a, pathA, bytesA), 1);
    mem[e.identity_wa(a) + 11] = 120; // Caller may reuse input pathname after Add.
    assert.strictEqual(add(b, pathB, bytesB), 1);
    assert.strictEqual(records().length, 2, 'colliding paths must retain independent registrations');
    assert(tagged(0x41) && tagged(0x42));
    console.log('PASS native hash collision preserves independent registrations');
    const before = records();
    assert.strictEqual(add(spellingA, pathA, Buffer.alloc(118)), 0);
    assert.deepStrictEqual(records(), before);
    console.log('PASS failed replacement preserves both colliding identities');
    const savedB = tagged(0x42);
    assert.strictEqual(add(spellingA, pathA, changedA), 1);
    assert.strictEqual(records().length, 2);
    assert(!tagged(0x41) && tagged(0x43));
    assert.deepStrictEqual(tagged(0x42), savedB);
    console.log('PASS case/slash normalization and copied pathname replace only A');
    const invalid = [0, 0x60000000, alloc(Buffer.alloc(261, 120))];
    for (const p of invalid) {
      const old = records();
      assert.strictEqual(e.identity_add(p), 0, 'invalid pathname add rejects');
      assert.strictEqual(e.identity_remove(p), 0, 'invalid pathname remove rejects');
      assert.deepStrictEqual(records(), old);
    }
    console.log('PASS null, unmapped and unterminated MAX_PATH inputs reject without mutation');
    assert.strictEqual(e.identity_remove(spellingA), 1);
    assert.deepStrictEqual(records(), [savedB]);
    assert.strictEqual(e.identity_remove(spellingA), 0);
    console.log('PASS normalized removal preserves colliding B');
    assert.strictEqual(add(spellingA, pathA, bytesB), 1);
    assert.strictEqual(records().length, 2);
    const independentA = records().find(r => r.index !== savedB.index); assert(independentA);
    assert.strictEqual(e.identity_remove(b), 1);
    assert.deepStrictEqual(records(), [independentA]);
    assert.strictEqual(e.identity_remove(spellingA), 1);
    assert.strictEqual(records().length, 0);
    console.log('PASS identical payloads retain independent path ownership');
    const payloadA = alloc(bytesA), payloadB = alloc(bytesB);
    assert.strictEqual(e.identity_buffer(spellingA, payloadA, bytesA.length), 1);
    assert.strictEqual(e.identity_buffer(b, payloadB, bytesB.length), 1);
    assert.strictEqual(records().length, 2);
    const bufferedB = tagged(0x42), bufferedBefore = records();
    const malformed = alloc(Buffer.alloc(118));
    assert.strictEqual(e.identity_buffer(spellingA, malformed, 118), 0);
    for (const p of invalid) assert.strictEqual(e.identity_buffer(p, payloadA, bytesA.length), 0);
    assert.deepStrictEqual(records(), bufferedBefore);
    assert.strictEqual(e.identity_remove(spellingA), 1);
    assert.deepStrictEqual(records(), [bufferedB]);
    assert.strictEqual(e.identity_remove(b), 1);
    console.log('PASS buffered entrypoint shares collision-safe identity and invalid-input rejection');
  } finally { for (const ga of held) e.guest_free(ga); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
