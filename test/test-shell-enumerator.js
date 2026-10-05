#!/usr/bin/env node
'use strict';

// The desktop enumerator is deliberately small, but it is still a real COM
// enumerator: WinRAR requests SHCONTF_FOLDERS and consumes each returned PIDL
// through the folder's attribute and display-name methods.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_shell_stack_base") (result i32)
    (call $w2g (region.addr $GUEST_STACK 524288)))
  (func (export "test_shell_folder_create") (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_SHGetDesktopFolder
      (local.get $out) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_enum")
      (param $folder i32) (param $flags i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IShellFolder_EnumObjects
      (local.get $folder) (i32.const 0x00010003) (local.get $flags)
      (local.get $out) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_next")
      (param $enumerator i32) (param $count i32) (param $items i32)
      (param $fetched i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IEnumIDList_Next
      (local.get $enumerator) (local.get $count) (local.get $items)
      (local.get $fetched) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_skip")
      (param $enumerator i32) (param $count i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IEnumIDList_Skip
      (local.get $enumerator) (local.get $count) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_reset") (param $enumerator i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IEnumIDList_Reset
      (local.get $enumerator) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_enum_release") (param $enumerator i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IEnumIDList_Release
      (local.get $enumerator) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_folder_release") (param $folder i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IShellFolder_Release
      (local.get $folder) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_get_display")
      (param $folder i32) (param $pidl i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IShellFolder_GetDisplayNameOf
      (local.get $folder) (local.get $pidl) (i32.const 0) (local.get $out)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_get_attributes")
      (param $folder i32) (param $count i32) (param $items i32)
      (param $attrs i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_IShellFolder_GetAttributesOf
      (local.get $folder) (local.get $count) (local.get $items) (local.get $attrs)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_shell_enum_flags") (param $enumerator i32) (result i32)
    (load.field DxObject misc0 (call $dx_from_this (local.get $enumerator))))
  (func (export "test_shell_enum_cursor") (param $enumerator i32) (result i32)
    (load.field DxObject misc1 (call $dx_from_this (local.get $enumerator))))
  (func (export "test_shell_object_type") (param $object i32) (result i32)
    (load.field DxObject type (call $dx_from_this (local.get $object))))
  (func (export "test_shell_pidl_kind") (param $pidl i32) (result i32)
    (call $shell_private_pidl_kind (local.get $pidl)))
  (func (export "test_shell_pidl_csidl") (param $pidl i32) (result i32)
    (call $gl32 (i32.add (local.get $pidl) (i32.const 6))))
  (func (export "test_shell_free") (param $pidl i32)
    (call $heap_free (local.get $pidl)))
  ;; Leave exactly one PIDL-sized free block, then exhaust both allocation
  ;; arenas.  Next(celt=2) can allocate its first item but must roll it back
  ;; when allocation of the second fails.  This poisons only this test instance
  ;; and is deliberately used after every ordinary allocation assertion.
  (func (export "test_shell_prepare_partial_oom")
    (local $pidl i32)
    (local.set $pidl (call $shell_virtual_pidl_from_csidl (i32.const 0x11)))
    (call $heap_free (local.get $pidl))
    (global.set $free_list (i32.sub (local.get $pidl) (i32.const 4)))
    (i32.store offset=4
      (call $g2w (i32.sub (local.get $pidl) (i32.const 4))) (i32.const 0))
    (global.set $heap_ptr (i32.const 0))
    (global.set $heap_end (i32.const 0))
    (global.set $heap_arena_record (i32.const 0))
    (global.set $heap_sparse_ptr (i32.const 0))
    (global.set $heap_sparse_end (i32.const 0))
    (global.set $heap_sparse_record (i32.const 0))
    (i32.atomic.store (global.get $HEAP_SHARED)
      (call $w2g (region.end $GUEST_HEAP_BASE)))
    (global.set $virtual_alloc_top (call $virtual_alloc_min))
    (i32.atomic.store offset=8 (global.get $VIRTUAL_MAP_STATE)
      (call $virtual_alloc_min))
    (i32.store offset=20 (global.get $VIRTUAL_MAP_STATE) (i32.const 1)))
`;

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const { exports: e } = await bootRenderHarness({ extraWat, memory, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const guestBase = e.get_guest_base() >>> 0;
  const imageBase = e.get_image_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const readAscii = guest => {
    let text = '';
    for (let p = wa(guest); bytes[p]; p++) text += String.fromCharCode(bytes[p]);
    return text;
  };
  const alloc = size => e.guest_alloc(size) >>> 0;
  const read32 = address => e.guest_read32(address) >>> 0;
  const write32 = (address, value) => e.guest_write32(address, value);

  const S_OK = 0;
  const S_FALSE = 1;
  const E_POINTER = 0x80004003;
  const E_OUTOFMEMORY = 0x8007000e;
  const E_INVALIDARG = 0x80070057;
  const SHCONTF_FOLDERS = 0x20;
  const SHCONTF_NONFOLDERS = 0x40;
  // Spell the flag as its documented bit so the region-address census does
  // not mistake its value for today's coincident THREAD_RPC exclusive end.
  const SFGAO_FOLDER = 1 << 29;
  const SFGAO_FILESYSANCESTOR = 0x10000000;
  const stack = e.test_shell_stack_base() >>> 0;
  const out = alloc(4);
  const fetched = alloc(4);
  const items = alloc(12);
  const strret = alloc(264);
  const attrs = alloc(4);

  write32(out, 0xdeadbeef);
  assert.strictEqual(e.test_shell_folder_create(out) >>> 0, S_OK);
  const folder = read32(out);
  assert.notStrictEqual(folder, 0, 'SHGetDesktopFolder returns the real interface path');
  assert.strictEqual(e.get_esp() >>> 0, (stack + 8) >>> 0,
    'SHGetDesktopFolder pops its stdcall frame');

  write32(out, 0xdeadbeef);
  assert.strictEqual(e.test_shell_enum(folder, SHCONTF_FOLDERS, out) >>> 0, S_OK);
  const firstEnum = read32(out);
  assert.notStrictEqual(firstEnum, 0, 'EnumObjects creates an enumerator');
  assert.strictEqual(e.get_esp() >>> 0, (stack + 20) >>> 0,
    'EnumObjects pops this plus four arguments');
  assert.strictEqual(e.test_shell_enum_flags(firstEnum) >>> 0, SHCONTF_FOLDERS,
    'the type-33 instance retains its requested SHCONTF flags');
  assert.strictEqual(e.test_shell_enum_cursor(firstEnum) >>> 0, 0,
    'each enumerator starts at its own cursor zero');

  write32(items, 0xdeadbeef);
  write32(fetched, 0xdeadbeef);
  assert.strictEqual(e.test_shell_next(firstEnum, 1, items, fetched) >>> 0, S_OK,
    'Next returns S_OK when it fills the one-item request');
  assert.strictEqual(e.get_esp() >>> 0, (stack + 20) >>> 0,
    'Next pops this plus four arguments');
  assert.strictEqual(read32(fetched), 1);
  const computer = read32(items);
  assert.strictEqual(e.test_shell_pidl_kind(computer), 2, 'enumeration uses the canonical virtual PIDL');
  assert.strictEqual(e.test_shell_pidl_csidl(computer) >>> 0, 0x11,
    'My Computer is the first desktop child');
  assert.strictEqual(e.test_shell_get_display(folder, computer, strret) >>> 0, S_OK);
  assert.strictEqual(read32(strret), 2, 'virtual display names use STRRET_CSTR');
  assert.strictEqual(readAscii(strret + 4), 'My Computer');
  write32(attrs, (SFGAO_FOLDER | SFGAO_FILESYSANCESTOR) >>> 0);
  assert.strictEqual(e.test_shell_get_attributes(folder, 1, items, attrs) >>> 0, S_OK);
  assert.strictEqual(read32(attrs), (SFGAO_FOLDER | SFGAO_FILESYSANCESTOR) >>> 0,
    'enumerated My Computer feeds the canonical attribute helper');

  write32(items, 0xdeadbeef);
  write32(items + 4, 0xcafebabe);
  write32(fetched, 0xdeadbeef);
  assert.strictEqual(e.test_shell_next(firstEnum, 2, items, fetched) >>> 0, S_FALSE,
    'Next reports S_FALSE for a non-empty partial result at end of enumeration');
  assert.strictEqual(read32(fetched), 1);
  const network = read32(items);
  assert.strictEqual(e.test_shell_pidl_csidl(network) >>> 0, 0x12,
    'Network Neighborhood is the second and final desktop child');
  assert.strictEqual(read32(items + 4), 0xcafebabe,
    'a partial request does not publish an unowned trailing pointer');
  assert.strictEqual(e.test_shell_get_display(folder, network, strret) >>> 0, S_OK);
  assert.strictEqual(readAscii(strret + 4), 'Network Neighborhood');
  write32(attrs, (SFGAO_FOLDER | SFGAO_FILESYSANCESTOR) >>> 0);
  assert.strictEqual(e.test_shell_get_attributes(folder, 1, items, attrs) >>> 0, S_OK);
  assert.strictEqual(read32(attrs), (SFGAO_FOLDER | SFGAO_FILESYSANCESTOR) >>> 0,
    'enumerated Network Neighborhood feeds the canonical attribute helper');
  assert.strictEqual(e.test_shell_next(firstEnum, 1, items, fetched) >>> 0, S_FALSE,
    'Next remains at end of enumeration');
  assert.strictEqual(read32(fetched), 0);

  assert.strictEqual(e.test_shell_reset(firstEnum) >>> 0, S_OK);
  assert.strictEqual(e.get_esp() >>> 0, (stack + 8) >>> 0, 'Reset pops this');
  assert.strictEqual(e.test_shell_enum_cursor(firstEnum), 0, 'Reset rewinds the cursor');
  assert.strictEqual(e.test_shell_next(firstEnum, 2, items, fetched) >>> 0, S_OK,
    'a multi-celt request returns both supported roots');
  assert.strictEqual(read32(fetched), 2);
  const resetComputer = read32(items);
  const resetNetwork = read32(items + 4);
  assert.strictEqual(e.test_shell_pidl_csidl(resetComputer), 0x11);
  assert.strictEqual(e.test_shell_pidl_csidl(resetNetwork), 0x12);

  assert.strictEqual(e.test_shell_reset(firstEnum) >>> 0, S_OK);
  assert.strictEqual(e.test_shell_skip(firstEnum, 1) >>> 0, S_OK,
    'Skip returns S_OK when every requested element was skipped');
  assert.strictEqual(e.get_esp() >>> 0, (stack + 12) >>> 0,
    'Skip pops this plus two arguments');
  assert.strictEqual(e.test_shell_next(firstEnum, 1, items, 0) >>> 0, S_OK,
    'pceltFetched may be NULL for celt == 1');
  const skippedToNetwork = read32(items);
  assert.strictEqual(e.test_shell_pidl_csidl(skippedToNetwork), 0x12);
  assert.strictEqual(e.test_shell_reset(firstEnum) >>> 0, S_OK);
  assert.strictEqual(e.test_shell_skip(firstEnum, 3) >>> 0, S_FALSE,
    'Skip saturates at end and reports an unfulfilled request');
  assert.strictEqual(e.test_shell_enum_cursor(firstEnum), 2);
  assert.strictEqual(e.test_shell_skip(firstEnum, 0) >>> 0, S_OK,
    'skipping zero elements is a complete request');

  assert.strictEqual(e.test_shell_reset(firstEnum) >>> 0, S_OK);
  write32(items, 0xdeadbeef);
  assert.strictEqual(e.test_shell_next(firstEnum, 2, items, 0) >>> 0, E_POINTER,
    'pceltFetched is required for multi-celt requests');
  assert.strictEqual(e.test_shell_enum_cursor(firstEnum), 0,
    'a rejected request does not consume enumeration state');
  assert.strictEqual(read32(items), 0xdeadbeef, 'a rejected request owns no output');
  assert.strictEqual(e.test_shell_next(firstEnum, 1, 0xf0000000, fetched) >>> 0, E_POINTER,
    'rgelt must cover every requested pointer slot');
  assert.strictEqual(e.test_shell_next(firstEnum, 1, items, 0xf0000000) >>> 0, E_POINTER,
    'non-null pceltFetched must be mapped');
  assert.strictEqual(e.test_shell_next(firstEnum, 0x40000000, items, fetched) >>> 0, E_POINTER,
    'a pointer-span overflow is rejected before enumeration');
  assert.strictEqual(e.test_shell_next(firstEnum, 0, 0, fetched) >>> 0, S_OK,
    'a zero-celt request succeeds without rgelt storage');
  assert.strictEqual(read32(fetched), 0);

  write32(out, 0);
  assert.strictEqual(e.test_shell_enum(folder, SHCONTF_FOLDERS, out) >>> 0, S_OK);
  const independent = read32(out);
  assert.strictEqual(e.test_shell_next(independent, 1, items, fetched) >>> 0, S_OK);
  const independentComputer = read32(items);
  assert.strictEqual(e.test_shell_pidl_csidl(independentComputer), 0x11,
    'a second enumerator has an independent cursor');

  write32(out, 0);
  assert.strictEqual(e.test_shell_enum(folder, SHCONTF_NONFOLDERS, out) >>> 0, S_OK);
  const nonfolders = read32(out);
  write32(items, 0xdeadbeef);
  assert.strictEqual(e.test_shell_next(nonfolders, 1, items, fetched) >>> 0, S_FALSE,
    'unsupported non-folder namespace contents are not invented');
  assert.strictEqual(read32(fetched), 0);
  assert.strictEqual(read32(items), 0xdeadbeef);

  for (const pidl of [computer, network, resetComputer, resetNetwork,
    skippedToNetwork, independentComputer]) e.test_shell_free(pidl);
  write32(out, 0);
  assert.strictEqual(e.test_shell_enum(folder, SHCONTF_FOLDERS, out) >>> 0, S_OK);
  const oomEnum = read32(out);
  e.test_shell_prepare_partial_oom();
  write32(items, 0xdeadbeef);
  write32(items + 4, 0xcafebabe);
  write32(fetched, 0xdeadbeef);
  assert.strictEqual(e.test_shell_next(oomEnum, 2, items, fetched) >>> 0, E_OUTOFMEMORY,
    'failure after one allocation rolls the whole Next call back');
  assert.strictEqual(read32(fetched), 0, 'an allocation failure publishes no fetched ownership');
  assert.strictEqual(read32(items), 0, 'the PIDL allocated by the failed call was freed and cleared');
  assert.strictEqual(read32(items + 4), 0xcafebabe,
    'the slot whose allocation failed was never published');
  assert.strictEqual(e.test_shell_enum_cursor(oomEnum), 0,
    'an allocation failure restores the entry cursor for a retry');
  assert.strictEqual(e.test_shell_enum_release(oomEnum), 0);
  assert.strictEqual(e.test_shell_enum_release(nonfolders), 0);
  assert.strictEqual(e.test_shell_enum_release(independent), 0);
  assert.strictEqual(e.test_shell_enum_release(firstEnum), 0);
  assert.strictEqual(e.test_shell_object_type(firstEnum), 0,
    'final Release returns the type-33 object to the COM pool');
  assert.strictEqual(e.test_shell_next(firstEnum, 1, items, fetched) >>> 0, E_INVALIDARG,
    'a released enumerator cannot be used through the handler');
  assert.strictEqual(e.test_shell_folder_release(folder), 0);

  assert.strictEqual(e.test_shell_enum(0xf0000000, SHCONTF_FOLDERS, out) >>> 0, E_INVALIDARG,
    'EnumObjects validates its interface pointer');
  assert.strictEqual(e.test_shell_enum(folder, SHCONTF_FOLDERS, 0xf0000000) >>> 0, E_POINTER,
    'EnumObjects validates and clears only a mapped output pointer');

  console.log('PASS  desktop IEnumIDList exposes two owned virtual roots with COM cursor semantics');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
