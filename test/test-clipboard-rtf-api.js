#!/usr/bin/env node
// Low-level regression coverage for non-OLE Rich Text Format clipboard support.
// Tests the shared WAT helpers used by RegisterClipboardFormatA/W,
// SetClipboardData/GetClipboardData, IsClipboardFormatAvailable, and
// CountClipboardFormats.

'use strict';

const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

async function main() {
  const wasmBytes = compileSrcWasm();
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer, renderer: null, resourceJson: {} };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  imports.host.create_thread = () => 0;
  imports.host.exit_thread = () => 0;
  imports.host.terminate_thread = () => 0;
  imports.host.create_event = () => 0;
  imports.host.set_event = () => 0;
  imports.host.reset_event = () => 0;
  imports.host.wait_single = () => 0;
  imports.host.wait_multiple = () => 0;
  imports.host.com_create_instance = () => 0x80004002;

  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const e = instance.exports;
  const u8 = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const wa = gp => gp - e.get_image_base() + e.get_guest_base();

  let pass = 0;
  let fail = 0;
  function check(name, ok, detail = '') {
    if (ok) {
      pass++;
      console.log('PASS  ' + name);
    } else {
      fail++;
      console.log('FAIL  ' + name + (detail ? '  ' + detail : ''));
    }
  }

  function writeAscii(s) {
    const g = e.guest_alloc(s.length + 1);
    const p = wa(g);
    for (let i = 0; i < s.length; i++) u8[p + i] = s.charCodeAt(i) & 0xff;
    u8[p + s.length] = 0;
    return g;
  }

  function writeWide(s) {
    const g = e.guest_alloc((s.length + 1) * 2);
    const p = wa(g);
    for (let i = 0; i < s.length; i++) dv.setUint16(p + i * 2, s.charCodeAt(i), true);
    dv.setUint16(p + s.length * 2, 0, true);
    return g;
  }

  function readAscii(g, max = 1024) {
    const p = wa(g);
    let s = '';
    for (let i = 0; i < max; i++) {
      const ch = u8[p + i];
      if (!ch) break;
      s += String.fromCharCode(ch);
    }
    return s;
  }

  e.clipboard_clear_all_data();

  const rtfNameA = writeAscii('Rich Text Format');
  const rtfNameW = writeWide('Rich Text Format');
  const rtfMixedCaseW = writeWide('rIcH tExT fOrMaT');
  const htmlNameA = writeAscii('HTML Format');
  const fmtMixedCaseW = e.clipboard_register_format_w(rtfMixedCaseW) >>> 0;
  const fmtFirstLookup = e.clipboard_get_rtf_format_id() >>> 0;
  const fmtA = e.clipboard_register_format_a(rtfNameA) >>> 0;
  const fmtW = e.clipboard_register_format_w(rtfNameW) >>> 0;
  const fmtAgain = e.clipboard_get_rtf_format_id() >>> 0;
  const htmlFmt = e.clipboard_register_format_a(htmlNameA) >>> 0;

  check('RegisterClipboardFormatW returns registered RTF id', fmtW >= 0xc000, `0x${fmtW.toString(16)}`);
  check('RegisterClipboardFormatA reuses a W-first RTF id', fmtA === fmtW, `A=0x${fmtA.toString(16)} W=0x${fmtW.toString(16)}`);
  check('RegisterClipboardFormat compares mixed-case A/W names case-insensitively',
    fmtMixedCaseW === fmtA, `mixed=0x${fmtMixedCaseW.toString(16)} A=0x${fmtA.toString(16)}`);
  check('a mixed-case W-first RTF registration updates the shared RTF identity',
    fmtFirstLookup === fmtMixedCaseW,
    `lookup=0x${fmtFirstLookup.toString(16)} mixed=0x${fmtMixedCaseW.toString(16)}`);
  check('RegisterClipboardFormatA/W reject a NULL format name',
    e.clipboard_register_format_a(0) === 0 && e.clipboard_register_format_w(0) === 0);
  check('RTF id remains stable after repeated lookup', fmtAgain === fmtA, `again=0x${fmtAgain.toString(16)}`);
  check('other registered formats receive a distinct id', htmlFmt !== fmtA && htmlFmt >= 0xc000, `html=0x${htmlFmt.toString(16)}`);
  check('empty clipboard has no advertised formats', e.clipboard_count_formats() === 0);
  check('empty clipboard has no RTF availability', e.clipboard_is_format_available(fmtA) === 0);

  const dib = e.guest_alloc(40);
  for (let i = 0; i < 40; i++) u8[wa(dib) + i] = (i * 9 + 1) & 0xff;
  const storedDib = e.clipboard_store_binary_data(8, dib) >>> 0;
  check('CF_DIB HGLOBAL bytes are copied into clipboard ownership', storedDib !== 0 && storedDib !== dib);
  u8[wa(dib)] = 0xee;
  check('CF_DIB is advertised and returned independently',
    e.clipboard_is_format_available(8) === 1 && e.clipboard_get_data_handle(8) === storedDib && u8[wa(storedDib)] === 1);
  check('CountClipboardFormats includes the binary DIB slot', e.clipboard_count_formats() === 1);
  e.clipboard_clear_all_data();

  const rtfText = '{\\rtf1\\ansi api\\par smoke}';
  const rtfData = writeAscii(rtfText);
  const stored = e.clipboard_store_rtf_data(rtfData) >>> 0;
  const handle = e.clipboard_get_data_handle(fmtA) >>> 0;

  check('SetClipboardData-style RTF store succeeds', stored !== 0);
  check('CountClipboardFormats counts the RTF format', e.clipboard_count_formats() === 1);
  check('IsClipboardFormatAvailable reports RTF', e.clipboard_is_format_available(fmtA) === 1);
  check('GetClipboardData returns the stored RTF handle', handle !== 0 && handle === stored,
    `stored=0x${stored.toString(16)} handle=0x${handle.toString(16)}`);
  check('GetClipboardData RTF bytes round-trip', readAscii(handle) === rtfText, readAscii(handle));

  // An owning duplicate must not inherit guest_strlen's 64-KiB scan cap.
  for (const length of [65535, 65536, 65537, 70000]) {
    const longText = '{\\rtf1 ' + 'Q'.repeat(length - 8) + '}';
    const source = writeAscii(longText);
    const owned = e.clipboard_store_rtf_data(source) >>> 0;
    check(`RTF preserves all ${length} bytes and NUL`, owned !== 0 &&
      readAscii(owned, length + 1) === longText && u8[wa(owned) + length] === 0);
    check(`RTF reports its full ${length}-byte length`, e.clipboard_rtf_len() === length);
    u8[wa(source)] = 0x58;
    check(`RTF ${length}-byte snapshot is independent`, u8[wa(owned)] === 0x7b);
  }
  const current = e.clipboard_get_data_handle(fmtA) >>> 0;
  const aliasText = readAscii(current, 70001);
  const alias = e.clipboard_store_rtf_data(current) >>> 0;
  check('RTF can duplicate its current owned buffer', alias !== 0 &&
    readAscii(alias, 70001) === aliasText);
  const suffixText = aliasText.slice(7);
  const suffix = e.clipboard_store_rtf_data(alias + 7) >>> 0;
  check('RTF can duplicate an overlapping suffix before retiring old storage', suffix !== 0 &&
    readAscii(suffix, 70001) === suffixText);
  check('NULL RTF source fails without discarding current data',
    e.clipboard_store_rtf_data(0) === 0 && e.clipboard_get_data_handle(fmtA) >>> 0 === suffix &&
    readAscii(suffix, 70001) === suffixText);

  const page = 0x30000000;
  for (const address of [page, 0x28000000, page + 4096]) {
    if ((e.test_virtual_map_commit(address, 4096) >>> 0) !== address)
      throw new Error('failed to construct sparse clipboard source');
  }
  if (e.guest_to_wasm(page + 4096) === e.guest_to_wasm(page) + 4096)
    throw new Error('sparse source must have nonadjacent physical backing');
  const sparseText = '{\\rtf1 sparse pages\\par owned copy}';
  const sparseSource = page + 4096 - 9;
  [...Buffer.from(sparseText + '\0', 'ascii')].forEach((byte, i) =>
    e.guest_write8(sparseSource + i, byte));
  const sparseOwned = e.clipboard_store_rtf_data(sparseSource) >>> 0;
  check('RTF gathers a source crossing noncontiguous guest pages',
    sparseOwned !== 0 && readAscii(sparseOwned) === sparseText &&
    e.clipboard_rtf_len() === sparseText.length);
  e.guest_write8(sparseSource, 0x58);
  check('sparse RTF copy owns its bytes independently', readAscii(sparseOwned) === sparseText);

  e.clipboard_clear_all_data();
  check('EmptyClipboard clears RTF availability', e.clipboard_is_format_available(fmtA) === 0);
  check('EmptyClipboard clears format count', e.clipboard_count_formats() === 0);

  console.log('');
  console.log(`${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
