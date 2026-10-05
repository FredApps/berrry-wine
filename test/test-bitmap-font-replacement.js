#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
 (func (export "replacement_table") (result i32) (global.get $GDI_BITMAP_FONT_TABLE))
 (func (export "replacement_lru") (result i32) (global.get $GDI_BITMAP_FONT_LRU))
 (func (export "replacement_clock") (result i32) (global.get $gdi_bitmap_font_clock))
 (func (export "replacement_wa") (param i32) (result i32) (call $g2w (local.get 0)))
 (func (export "replacement_buffer") (param i32 i32 i32) (result i32)
   (call $gdi_bitmap_font_add_buffer (local.get 0) (local.get 1) (local.get 2)))
 (func (export "replacement_file") (param i32) (result i32)
   (call $gdi_bitmap_font_add_resource (local.get 0)))
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
  throw Error('missing FNT fixture');
}
const strike = firstStrike(fs.readFileSync(path.join(__dirname, '../fonts/System.fon')));
function repeated(count, malformedLast = false) {
  const payload = (0x80 + 2 + 8 + count * 12 + 8 + 15) & ~15;
  const b = Buffer.alloc(payload + strike.length);
  b.writeUInt16LE(0x5a4d); b.writeUInt32LE(0x40, 0x3c);
  b.writeUInt16LE(0x454e, 0x40); b.writeUInt16LE(0x40, 0x64);
  b.writeUInt16LE(0x8008, 0x82); b.writeUInt16LE(count, 0x84);
  for (let i = 0; i < count; i++) {
    const p = 0x8a + i * 12;
    b.writeUInt16LE(payload, p);
    b.writeUInt16LE(malformedLast && i === count - 1 ? 1 : strike.length, p + 2);
    b.writeUInt16LE(0x8001 + i, p + 6);
  }
  strike.copy(b, payload); return b;
}
(async () => {
  const h = await bootRenderHarness({ fonts: 'none', extraWat }), e = h.exports;
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'));
  const mem = new Uint8Array(h.memory.buffer), dv = new DataView(h.memory.buffer);
  mem.set(exe, e.get_staging()); assert(e.load_pe(exe.length));
  const allocate = bytes => { const ga = e.guest_alloc(bytes.length); assert(ga); mem.set(bytes, e.replacement_wa(ga)); return ga; };
  const filename = 'c:\\replacement.fon', name = allocate(Buffer.from(filename + '\0'));
  function install(bytes, file = false) {
    if (file) {
      h.hostCtx.vfs.files.set(filename, { data: Uint8Array.from(bytes), size: bytes.length });
      return e.replacement_file(name);
    }
    const ga = allocate(bytes);
    try { return e.replacement_buffer(name, ga, bytes.length); } finally { e.guest_free(ga); }
  }
  assert.strictEqual(install(strike), 1);
  const faceOffset = strike.readUInt32LE(105);
  const face = strike.subarray(faceOffset, strike.indexOf(0, faceOffset)).toString('ascii');
  const wide = allocate(Buffer.from(face + '\0', 'utf16le'));
  const dc = e.test_call_CreateCompatibleDC(0);
  const font = e.test_call_CreateFontW(-strike.readUInt16LE(88), 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, wide);
  assert(dc && font); e.test_call_SelectObject(dc, font);
  const bound = e.test_gdi_bitmap_font_selected(dc); assert(bound, 'fixture must bind the old FNT');
  function snapshot() {
    const table = e.replacement_table(), owned = [];
    for (let i = 0; i < 48; i++) if (dv.getUint32(table + i * 64, true)) {
      const p = dv.getUint32(table + i * 64 + 8, true), n = dv.getUint32(table + i * 64 + 12, true);
      owned.push([i, mem.slice(p, p + n)]);
    }
    return { records: mem.slice(table, table + 48 * 64), owned,
      lru: mem.slice(e.replacement_lru(), e.replacement_lru() + 48 * 4), clock: e.replacement_clock() };
  }
  for (const file of [false, true]) {
    for (const [label, bytes] of [['invalid FNT', Buffer.alloc(118)], ['later malformed FNT', repeated(2, true)], ['capacity overflow', repeated(49)]]) {
      const before = snapshot();
      assert.strictEqual(install(bytes, file), 0, label);
      assert.deepStrictEqual(snapshot(), before, `${file ? 'file' : 'buffer'} ${label}: preserve records, bytes, LRU and clock`);
      assert.strictEqual(e.test_gdi_bitmap_font_selected(dc), bound, 'failed replacement keeps bound HFONT');
      console.log(`PASS ${file ? 'file' : 'buffer'} ${label} replacement is atomic`);
    }
  }
  // Reserve enough for the private record/target table AND one owned strike;
  // the second strike must fail after staging real bytes, not at table setup.
  const tableReserved = e.test_dib_alloc(48 * 64 + 48 * 4);
  const ownedStrikeBytes = (strike.readUInt32LE(2) || strike.length) + Buffer.byteLength(filename) + 1;
  const reserved = e.test_dib_alloc(ownedStrikeBytes), pressure = [];
  assert(tableReserved && reserved);
  try {
    let p; while ((p = e.test_dib_alloc(65536))) pressure.push(p);
    while ((p = e.test_dib_alloc(4096))) pressure.push(p);
    e.test_dib_free(tableReserved); e.test_dib_free(reserved);
    for (const file of [false, true]) {
      const before = snapshot();
      assert.strictEqual(install(repeated(2), file), 0, 'second allocation must fail');
      assert.deepStrictEqual(snapshot(), before, 'allocation failure preserves old registration');
      assert.strictEqual(e.test_gdi_bitmap_font_selected(dc), bound);
      const recoveredTable = e.test_dib_alloc(48 * 64 + 48 * 4);
      const recoveredStrike = e.test_dib_alloc(ownedStrikeBytes);
      assert(recoveredTable && recoveredStrike, 'rollback releases both staging table and first owned strike');
      e.test_dib_free(recoveredStrike); e.test_dib_free(recoveredTable);
    }
    console.log('PASS both entrypoints preserve old registration on staged allocation failure');
  } finally { for (const p of pressure) e.test_dib_free(p); }
  for (const file of [false, true]) {
    const changed = Buffer.from(strike); changed[6] = file ? 0x42 : 0x41; // copyright byte, not structural metadata
    assert.strictEqual(install(changed, file), 1, 'valid same-path replacement succeeds');
    const records = snapshot().owned;
    assert.strictEqual(records.length, 1);
    assert.deepStrictEqual(Buffer.from(records[0][1]), changed.subarray(0, records[0][1].length));
  }
  console.log('PASS valid changed bytes replace same-path font through both entrypoints');
  const unrelated = allocate(Buffer.from('c:\\unrelated.fon\0'));
  const many = repeated(47), manyGA = allocate(many);
  try { assert.strictEqual(e.replacement_buffer(unrelated, manyGA, many.length), 47); }
  finally { e.guest_free(manyGA); }
  assert.strictEqual(e.test_gdi_bitmap_font_count(), 48);
  for (const file of [false, true]) {
    const before = snapshot();
    assert.strictEqual(install(repeated(2), file), 0, 'only one old-path slot is reusable; unrelated installed fonts are not victims');
    assert.deepStrictEqual(snapshot(), before, 'full installed registry remains exactly unchanged');
  }
  console.log('PASS full registry rejects replacement exceeding its old slots without retiring unrelated installed fonts');
  // Model regenerable strikes with real owned DIB allocations, not dangling
  // fake pointers. All other records remain protected installed state1.
  const table = e.replacement_table(), lru = e.replacement_lru();
  dv.setUint32(table + 46 * 64, 2, true);
  dv.setUint32(table + 47 * 64, 2, true);
  dv.setUint32(lru + 46 * 4, 10, true);
  dv.setUint32(lru + 47 * 4, 20, true);
  const beforeEviction = snapshot();
  assert.strictEqual(install(repeated(2)), 2, 'old slot plus one regenerable victim permits replacement');
  const afterEviction = snapshot();
  assert.strictEqual(e.test_gdi_bitmap_font_count(), 48);
  assert.strictEqual(dv.getUint32(table + 46 * 64, true), 1, 'coldest state2 victim becomes installed replacement');
  assert.strictEqual(dv.getUint32(table + 47 * 64, true), 2, 'warmer regenerable strike survives');
  for (let i = 1; i < 48; i++) if (i !== 46) {
    assert.deepStrictEqual(afterEviction.records.slice(i * 64, (i + 1) * 64), beforeEviction.records.slice(i * 64, (i + 1) * 64));
    assert.deepStrictEqual(afterEviction.owned.find(([index]) => index === i)[1], beforeEviction.owned.find(([index]) => index === i)[1]);
    assert.deepStrictEqual(afterEviction.lru.slice(i * 4, i * 4 + 4), beforeEviction.lru.slice(i * 4, i * 4 + 4));
  }
  console.log('PASS full registry replaces old slot and coldest regenerable strike only');
  e.guest_free(unrelated); e.guest_free(name); e.guest_free(wide);
})().catch(error => { console.error(error); process.exitCode = 1; });
