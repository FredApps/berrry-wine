#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_shell_stack_base") (result i32)
    (call $w2g (region.addr $GUEST_STACK 524288)))
  (func (export "test_shell_parse_name")
      (param $name i32) (param $eaten i32) (param $out i32) (param $attrs i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $out))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $attrs))
    (call $handle_IShellFolder_ParseDisplayName
      (i32.const 0) (i32.const 0) (i32.const 0) (local.get $name)
      (local.get $eaten) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_get_display")
      (param $pidl i32) (param $flags i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IShellFolder_GetDisplayNameOf
      (i32.const 0) (local.get $pidl) (local.get $flags) (local.get $out)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_get_attributes")
      (param $count i32) (param $items i32) (param $inout i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IShellFolder_GetAttributesOf
      (i32.const 0) (local.get $count) (local.get $items) (local.get $inout)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_pidl_from_path") (param $path i32) (result i32)
    (call $shell_filesystem_pidl_from_path (local.get $path)))
  (func (export "test_shell_virtual_pidl") (param $csidl i32) (result i32)
    (call $shell_virtual_pidl_from_csidl (local.get $csidl)))
  (func (export "test_shell_pidl_kind") (param $pidl i32) (result i32)
    (call $shell_private_pidl_kind (local.get $pidl)))
  (func (export "test_shell_pidl_csidl") (param $pidl i32) (result i32)
    (call $gl32 (i32.add (local.get $pidl) (i32.const 6))))
  (func (export "test_shell_free") (param $ptr i32)
    (call $heap_free (local.get $ptr)))
`;

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const readHostString = (address, wide) => {
    const dv = new DataView(memory.buffer);
    let value = '';
    for (let p = address >>> 0; ; p += wide ? 2 : 1) {
      const ch = wide ? dv.getUint16(p, true) : dv.getUint8(p);
      if (!ch) return value;
      value += String.fromCharCode(ch);
    }
  };
  const harness = await bootRenderHarness({
    extraWat,
    memory,
    fonts: 'none',
    extraHostOverrides: {
      fs_get_file_attributes: (address, wide) => {
        const name = readHostString(address, wide);
        if (name.toUpperCase().includes('MISSING')) return -1;
        if (name.toUpperCase().endsWith('ARCHIVE')) return 0x10;
        return name.toUpperCase().includes('HIDDEN') ? 0x22 : 0x20;
      },
    },
  });
  const e = harness.exports;
  const stackBase = e.test_shell_stack_base() >>> 0;
  const dv = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const guestBase = e.get_guest_base() >>> 0;
  const imageBase = e.get_image_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const alloc = size => e.guest_alloc(size) >>> 0;
  const writeAnsi = value => {
    const out = alloc(value.length + 1);
    bytes.set(Buffer.from(`${value}\0`, 'latin1'), wa(out));
    return out;
  };
  const writeWide = value => {
    const out = alloc((value.length + 1) * 2);
    for (let i = 0; i < value.length; i++) {
      dv.setUint16(wa(out) + i * 2, value.charCodeAt(i), true);
    }
    dv.setUint16(wa(out) + value.length * 2, 0, true);
    return out;
  };
  const readAscii = guest => {
    let value = '';
    for (let p = wa(guest); bytes[p]; p++) value += String.fromCharCode(bytes[p]);
    return value;
  };
  const readStrret = (strret, pidl = 0) => {
    const type = e.guest_read32(strret) >>> 0;
    if (type === 1) return readAscii(pidl + (e.guest_read32(strret + 4) >>> 0));
    if (type === 2) return readAscii(strret + 4);
    throw new Error(`unexpected STRRET type ${type}`);
  };

  const S_OK = 0;
  const E_POINTER = 0x80004003;
  const E_INVALIDARG = 0x80070057;
  const HRESULT_FILE_NOT_FOUND = 0x80070002;
  const HRESULT_NO_UNICODE_TRANSLATION = 0x80070459;
  const SHGDN_INFOLDER = 0x0001;
  const SHGDN_FORPARSING = 0x8000;
  const SFGAO_HIDDEN = 0x00080000;
  const SFGAO_FOLDER = 1 << 29;
  const SFGAO_FILESYSANCESTOR = 0x10000000;
  const SFGAO_FILESYSTEM = 0x40000000;
  const SFGAO_FILE_CAPABILITIES = 0x00000177;

  const eaten = alloc(4);
  const out = alloc(4);
  const attrs = alloc(4);
  const archiveName = 'C:\\TOOLS\\ARCHIVE';
  e.guest_write32(out, 0xdeadbeef);
  e.guest_write32(eaten, 0xdeadbeef);
  e.guest_write32(attrs, 0xffffffff);
  assert.strictEqual(e.test_shell_parse_name(writeWide(archiveName), eaten, out, attrs) >>> 0, S_OK,
    'desktop folder parses an existing fully qualified filesystem name');
  const archive = e.guest_read32(out) >>> 0;
  assert.strictEqual(e.test_shell_pidl_kind(archive), 1, 'filesystem parse returns a private child PIDL');
  assert.strictEqual(e.guest_read32(eaten) >>> 0, archiveName.length,
    'pchEaten reports the number of consumed UTF-16 characters');
  assert.strictEqual(e.guest_read32(attrs) >>> 0,
    (SFGAO_FILESYSTEM | SFGAO_FOLDER | SFGAO_FILESYSANCESTOR) >>> 0,
    'pdwAttributes returns requested facts without unsupported operation capabilities');
  assert.strictEqual(e.get_esp() >>> 0, (stackBase + 32) >>> 0,
    'seven-argument ParseDisplayName preserves stdcall cleanup');

  e.guest_write32(out, 0xdeadbeef);
  e.guest_write32(eaten, 0xdeadbeef);
  assert.strictEqual(e.test_shell_parse_name(writeWide('C:\\MISSING.TXT'), eaten, out, 0) >>> 0,
    HRESULT_FILE_NOT_FOUND, 'ParseDisplayName validates filesystem existence');
  assert.strictEqual(e.guest_read32(out) >>> 0, 0, 'failed parse clears the PIDL output');
  assert.strictEqual(e.guest_read32(eaten) >>> 0, 0, 'failed parse consumes no characters');
  assert.strictEqual(e.test_shell_parse_name(writeWide('relative.txt'), eaten, out, 0) >>> 0,
    E_INVALIDARG, 'desktop folder declines relative filesystem syntax');
  assert.strictEqual(e.test_shell_parse_name(0, eaten, out, 0) >>> 0, E_POINTER,
    'required display-name pointer is validated');
  assert.strictEqual(e.test_shell_parse_name(0xf0000000, eaten, out, 0) >>> 0, E_POINTER,
    'unmapped display-name pointers fail without touching sentinel memory');
  assert.strictEqual(e.test_shell_parse_name(writeWide('C:\\TOOLS\\FILE.TXT'), eaten, 0, 0) >>> 0,
    E_POINTER, 'required PIDL output pointer is validated');
  assert.strictEqual(e.test_shell_parse_name(
    writeWide('C:\\TOOLS\\FILE.TXT'), 0xf0000000, out, 0) >>> 0, E_POINTER,
    'non-null pchEaten must address a writable ULONG');
  assert.strictEqual(e.test_shell_parse_name(
    writeWide('C:\\TOOLS\\FILE.TXT'), eaten, out, 0xf0000000) >>> 0, E_POINTER,
    'non-null pdwAttributes must address a readable and writable ULONG');
  assert.strictEqual(e.test_shell_parse_name(writeWide('C:\\TOOLS\\FILE.TXT'), 0, out, 0) >>> 0,
    S_OK, 'pchEaten is optional');
  const optionalEatenPidl = e.guest_read32(out) >>> 0;
  assert.strictEqual(e.test_shell_parse_name(writeWide(`C:\\${'A'.repeat(257)}`), eaten, out, 0) >>> 0,
    E_INVALIDARG, 'names at or beyond MAX_PATH are rejected before allocation');
  assert.strictEqual(e.test_shell_parse_name(writeWide('C:\\TOOLS\\\u0100.TXT'), eaten, out, 0) >>> 0,
    HRESULT_NO_UNICODE_TRANSLATION, 'unrepresentable UTF-16 does not alias an ANSI PIDL');

  const virtualNames = [
    [0x00, '::{00021400-0000-0000-C000-000000000046}', 'Desktop'],
    [0x11, '::{20d04fe0-3aea-1069-a2d8-08002b30309d}', 'My Computer'],
    [0x12, '::{208D2C60-3AEA-1069-A2D7-08002B30309D}', 'Network Neighborhood'],
  ];
  const parsedVirtual = [];
  for (const [csidl, parseName] of virtualNames) {
    e.guest_write32(out, 0);
    e.guest_write32(eaten, 0);
    e.guest_write32(attrs, SFGAO_FOLDER | SFGAO_FILESYSTEM | SFGAO_FILESYSANCESTOR);
    assert.strictEqual(e.test_shell_parse_name(writeWide(parseName), eaten, out, attrs) >>> 0, S_OK,
      `desktop folder parses CSIDL 0x${csidl.toString(16)} CLSID syntax case-insensitively`);
    const pidl = e.guest_read32(out) >>> 0;
    parsedVirtual.push(pidl);
    assert.strictEqual(e.test_shell_pidl_kind(pidl), 2, 'virtual parse returns a private child PIDL');
    assert.strictEqual(e.test_shell_pidl_csidl(pidl) >>> 0, csidl);
    assert.strictEqual(e.guest_read32(eaten) >>> 0, parseName.length);
    assert.strictEqual(e.guest_read32(attrs) >>> 0,
      (SFGAO_FOLDER | SFGAO_FILESYSANCESTOR) >>> 0,
      'virtual roots report folders and filesystem ancestry, not filesystem paths');
  }
  assert.strictEqual(e.test_shell_parse_name(
    writeWide('::{11111111-1111-1111-1111-111111111111}'), eaten, out, 0) >>> 0,
  E_INVALIDARG, 'foreign CLSID syntax is not broadened into an arbitrary namespace');

  const strret = alloc(264);
  assert.strictEqual(e.test_shell_get_display(archive, 0, strret) >>> 0, S_OK);
  assert.strictEqual(e.guest_read32(strret) >>> 0, 1, 'filesystem display name uses STRRET_OFFSET');
  assert.strictEqual(readStrret(strret, archive), 'ARCHIVE', 'normal name is parent-relative basename');
  assert.strictEqual(e.test_shell_get_display(archive, SHGDN_FORPARSING, strret) >>> 0, S_OK);
  assert.strictEqual(readStrret(strret, archive), archiveName,
    'desktop-relative parsing name is the full filesystem path');
  assert.strictEqual(e.test_shell_get_display(
    archive, SHGDN_FORPARSING | SHGDN_INFOLDER, strret) >>> 0, S_OK);
  assert.strictEqual(readStrret(strret, archive), 'ARCHIVE',
    'in-folder parsing name remains relative to the parent folder');
  assert.strictEqual(e.get_esp() >>> 0, (stackBase + 20) >>> 0,
    'four-argument GetDisplayNameOf preserves stdcall cleanup');

  for (let i = 0; i < virtualNames.length; i++) {
    const [csidl, canonicalParseName, displayName] = virtualNames[i];
    const pidl = parsedVirtual[i];
    assert.strictEqual(e.test_shell_get_display(pidl, 0, strret) >>> 0, S_OK);
    assert.strictEqual(e.guest_read32(strret) >>> 0, 2, 'virtual name uses inline STRRET_CSTR');
    assert.strictEqual(readStrret(strret), displayName, `CSIDL 0x${csidl.toString(16)} display label`);
    assert.strictEqual(e.test_shell_get_display(pidl, SHGDN_FORPARSING, strret) >>> 0, S_OK);
    assert.strictEqual(readStrret(strret).toUpperCase(), canonicalParseName.toUpperCase(),
      'virtual parsing name uses round-trippable ::{CLSID} syntax');
    assert.strictEqual(e.test_shell_get_display(
      pidl, SHGDN_FORPARSING | SHGDN_INFOLDER, strret) >>> 0, S_OK);
    assert.strictEqual(readStrret(strret), displayName,
      'in-folder parsing name remains relative to the desktop folder');
  }
  const foreign = alloc(12);
  e.guest_write32(foreign, 8);
  e.guest_write32(foreign + 2, 0x11223344);
  e.guest_write32(foreign + 8, 0);
  assert.strictEqual(e.test_shell_get_display(foreign, 0, strret) >>> 0, E_INVALIDARG,
    'foreign provider PIDLs fail instead of exposing private bytes');
  assert.strictEqual(e.guest_read32(strret) >>> 0, 2);
  assert.strictEqual(readStrret(strret), '', 'failed display lookup leaves a valid empty STRRET');
  assert.strictEqual(e.test_shell_get_display(archive, 0, 0) >>> 0, E_POINTER,
    'STRRET output pointer is required');
  assert.strictEqual(e.test_shell_get_display(archive, 0, 0xf0000000) >>> 0, E_POINTER,
    'the complete STRRET output range must be mapped');
  assert.strictEqual(e.test_shell_get_display(0xf0000000, 0, strret) >>> 0, E_INVALIDARG,
    'unmapped PIDLs are rejected as foreign rather than dereferenced');

  const file = e.test_shell_pidl_from_path(writeAnsi('C:\\TOOLS\\FILE.TXT')) >>> 0;
  const hidden = e.test_shell_pidl_from_path(writeAnsi('C:\\TOOLS\\HIDDEN.TXT')) >>> 0;
  const missing = e.test_shell_pidl_from_path(writeAnsi('C:\\MISSING.TXT')) >>> 0;
  const items = alloc(8);
  e.guest_write32(items, archive);
  e.guest_write32(items + 4, file);
  const requested = (SFGAO_HIDDEN | SFGAO_FOLDER | SFGAO_FILESYSANCESTOR |
    SFGAO_FILESYSTEM | SFGAO_FILE_CAPABILITIES) >>> 0;
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(2, items, attrs) >>> 0, S_OK,
    'GetAttributesOf accepts multiple validated child PIDLs');
  assert.strictEqual(e.guest_read32(attrs) >>> 0,
    SFGAO_FILESYSTEM >>> 0,
    'multi-item result is the requested attribute intersection');
  assert.strictEqual(e.get_esp() >>> 0, (stackBase + 20) >>> 0,
    'four-argument GetAttributesOf preserves stdcall cleanup');

  e.guest_write32(items + 4, parsedVirtual[1]);
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(2, items, attrs) >>> 0, S_OK);
  assert.strictEqual(e.guest_read32(attrs) >>> 0,
    (SFGAO_FOLDER | SFGAO_FILESYSANCESTOR) >>> 0,
    'filesystem directory and virtual root retain only common requested facts');
  e.guest_write32(items, hidden);
  e.guest_write32(attrs, SFGAO_HIDDEN | SFGAO_FOLDER | SFGAO_FILESYSTEM);
  assert.strictEqual(e.test_shell_get_attributes(1, items, attrs) >>> 0, S_OK);
  assert.strictEqual(e.guest_read32(attrs) >>> 0, (SFGAO_HIDDEN | SFGAO_FILESYSTEM) >>> 0,
    'filesystem flags are translated into only the requested shell attributes');
  e.guest_write32(items, missing);
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(1, items, attrs) >>> 0, HRESULT_FILE_NOT_FOUND,
    'stale filesystem PIDL reports a filesystem HRESULT');
  assert.strictEqual(e.guest_read32(attrs) >>> 0, 0, 'failed attribute query clears output');
  e.guest_write32(items, foreign);
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(1, items, attrs) >>> 0, E_INVALIDARG,
    'foreign PIDL is rejected by attribute lookup');
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(0, 0, attrs) >>> 0, S_OK,
    'zero-item cache refresh succeeds without an item array');
  assert.strictEqual(e.guest_read32(attrs) >>> 0, 0, 'cache refresh returns no item attributes');
  assert.strictEqual(e.test_shell_get_attributes(1, items, 0) >>> 0, E_POINTER,
    'attribute in/out pointer is required');
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(1, 0xf0000000, attrs) >>> 0, E_POINTER,
    'unmapped PIDL-array entries are rejected before loading');
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(0x40000000, items, attrs) >>> 0, E_INVALIDARG,
    'a child count whose pointer array size overflows is rejected');
  e.guest_write32(items, 0xf0000000);
  e.guest_write32(attrs, requested);
  assert.strictEqual(e.test_shell_get_attributes(1, items, attrs) >>> 0, E_INVALIDARG,
    'unmapped child PIDLs are rejected without exposing sentinel memory');

  for (const ptr of [archive, optionalEatenPidl, file, hidden, missing, foreign, ...parsedVirtual]) {
    e.test_shell_free(ptr);
  }
  assert.strictEqual(e.test_shell_pidl_kind(archive), 0,
    'returned PIDLs use task-allocator-compatible lifetime');

  console.log('PASS desktop IShellFolder parses, names, attributes, ownership, pointers, and ESP');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
