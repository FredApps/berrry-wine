#!/usr/bin/env node
'use strict';
// Unicode DirectPlay as Populous: The Beginning's weanetr.dll creates it:
// CoCreateInstance(CLSID_DirectPlayLobby, IID_IDirectPlayLobby3) and
// CoCreateInstance(CLSID_DirectPlay, IID_IDirectPlay3) -- the W interfaces,
// not the A ones. Refusing them made MLDPlay::AreWeLobbied report "lobbied"
// and the game opened its multiplayer lobby instead of the main menu.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const apis = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const root = path.resolve(__dirname, '..');
const extraWat = String.raw`
(func (export "test_vtbl_dplay4w") (result i32) (global.get $DX_VTBL_DPLAY4W))
(func (export "test_vtbl_lobby3") (result i32) (global.get $DX_VTBL_DPLAYLOBBY3))
(func (export "test_vtbl_lobby3w") (result i32) (global.get $DX_VTBL_DPLAYLOBBY3W))
(func (export "test_registry_base") (result i32) (global.get $DX_VTBL_REGISTRY))
(func (export "test_registry_count") (result i32) (global.get $DX_VTBL_REGISTRY_COUNT))
(func (export "test_refs") (param $p i32) (result i32)
  (load.field DxObject refcount (call $dx_from_this (local.get $p))))
(func (export "test_cocreate") (param $clsid i32) (param $iid i32) (param $out i32) (param $sp i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (local.get $sp))
  (call $handle_CoCreateInstance (local.get $clsid) (i32.const 0) (i32.const 1)
    (local.get $iid) (local.get $out) (i32.const 0))
  (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const exe = fs.readFileSync(path.join(root, 'test/binaries/notepad.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert(e.load_pe(exe.length) > 0);
  e.init_dx_com_thunks();

  const alloc = n => e.guest_alloc(n) >>> 0;
  const read = p => e.guest_read32(p) >>> 0;
  const write = (p, v) => e.guest_write32(p, v);
  const guid = words => { const p = alloc(16); words.forEach((v, i) => write(p + i * 4, v)); return p; };
  const stack = alloc(128), out = alloc(4);
  const call = (object, slot, ...args) => {
    const thunk = read(read(object) + slot * 4), api = apis[read(thunk + 4)];
    assert.equal(read(thunk), 0xcaca0010);
    assert.equal(api.nargs, args.length + 1, `${api.name} arity`);
    write(stack, 0);
    [object, ...args].forEach((v, i) => write(stack + (i + 1) * 4, v));
    e.set_esp(stack); e.set_eip(thunk); e.run(1);
    assert.equal(e.get_eip(), 0);
    assert.equal(e.get_esp() >>> 0, stack + (api.nargs + 1) * 4, `${api.name} pops its arguments`);
    return e.get_eax() >>> 0;
  };
  const cocreate = (clsid, iid) => { write(out, 0xfeedface); return e.test_cocreate(clsid, iid, out, stack) >>> 0; };

  const CLSID_DirectPlay = guid([0xd1eb6d20, 0x11d08923, 0xa000979d, 0xcb430ac9]);
  const CLSID_DirectPlayLobby = guid([0x2fe8f810, 0x11d0b2a5, 0x000087a7, 0xfcab03f8]);
  const IID_IDirectPlay2 = guid([0x2b74f7c0, 0x11cf9154, 0xaa00cda9, 0xe3866800]);
  const IID_IDirectPlay3 = guid([0x133efe40, 0x11d032dc, 0xa000fb9c, 0xcb430ac9]);
  const IID_IDirectPlayLobby = guid([0xaf465c71, 0x11cf9588, 0xaa0020a0, 0xac576100]);
  const IID_IDirectPlayLobby2 = guid([0x0194c220, 0x11d0a303, 0xa0004f9c, 0x5e4205c9]);
  const IID_IDirectPlayLobby3 = guid([0x2db72490, 0x11d1652c, 0x0000a8a7, 0xfcab03f8]);
  const IID_IDirectPlayLobby2A = guid([0x1bb4af80, 0x11d0a303, 0xa0004f9c, 0x5e4205c9]);
  const IID_IDirectPlayLobby3A = guid([0x2db72491, 0x11d1652c, 0x0000a8a7, 0xfcab03f8]);

  // The W lobby vtable is a full 19-slot table appended at the registry tail,
  // so worker instances restore it by offset like every other interface.
  const lobbyW = e.test_vtbl_lobby3w() >>> 0;
  assert(lobbyW && lobbyW !== (e.test_vtbl_lobby3() >>> 0), 'separate W lobby vtable');
  for (let slot = 0; slot < 19; slot++) {
    const api = apis[read(read(lobbyW + slot * 4) + 4)];
    assert(api.name.startsWith('IDirectPlayLobby3W_'), `slot ${slot} is a Lobby3W method (${api.name})`);
  }
  // The registry is emulator memory, not guest memory: read it directly.
  const view = new DataView(memory.buffer);
  const base = e.test_registry_base() >>> 0, count = e.test_registry_count() >>> 0;
  assert.equal(view.getUint32(base, true), count);
  assert.equal(view.getUint32(base + count * 4, true), lobbyW, 'Lobby3W is the last registered vtable');

  // IDirectPlay2/3 (W) come back as the IDirectPlay4W wrapper, which extends
  // them slot for slot; the creation reference is released, leaving one.
  for (const [name, iid] of [['IDirectPlay2', IID_IDirectPlay2], ['IDirectPlay3', IID_IDirectPlay3]]) {
    assert.equal(cocreate(CLSID_DirectPlay, iid), 0, `${name} (W) is creatable`);
    const dp = read(out);
    assert.equal(read(dp), e.test_vtbl_dplay4w() >>> 0, `${name} (W) uses the Unicode vtable`);
    assert.equal(e.test_refs(dp), 1, `${name} (W) holds exactly the caller's reference`);
    assert.equal(call(dp, 2), 0, `${name} (W) releases to zero`);
  }

  // Every Unicode lobby IID gets the W vtable; the methods weanetr uses
  // answer as on a machine that was not launched by a lobby.
  for (const [name, iid] of [['IDirectPlayLobby', IID_IDirectPlayLobby],
    ['IDirectPlayLobby2', IID_IDirectPlayLobby2], ['IDirectPlayLobby3', IID_IDirectPlayLobby3]]) {
    assert.equal(cocreate(CLSID_DirectPlayLobby, iid), 0, `${name} (W) is creatable`);
    const lobby = read(out);
    assert.equal(read(lobby), lobbyW, `${name} (W) uses the Unicode lobby vtable`);
    assert.equal(e.test_refs(lobby), 1);
    const size = alloc(4);
    write(size, 0x1234);
    assert.equal(call(lobby, 8, 0, 0, size), 0x8877042e, `${name} GetConnectionSettings is DPERR_NOTLOBBIED`);
    assert.equal(call(lobby, 2), 0);
  }

  // Connect through the W lobby hands back an IDirectPlay2 (W) object.
  assert.equal(cocreate(CLSID_DirectPlayLobby, IID_IDirectPlayLobby3), 0);
  const lobby = read(out), dpOut = alloc(4);
  assert.equal(call(lobby, 3, 0, dpOut, 0), 0, 'W Connect succeeds');
  const connected = read(dpOut);
  assert.equal(read(connected), e.test_vtbl_dplay4w() >>> 0, 'W Connect returns a Unicode DirectPlay');
  assert.equal(e.test_refs(connected), 1, 'W Connect returns one reference');
  assert.equal(call(connected, 2), 0);
  assert.equal(call(lobby, 3, 0, 0, 0), 0x80004003, 'W Connect needs an output pointer');

  // An ANSI query on the same identity pins the ANSI vtable again, so a W
  // lobby never hands its slots to an ANSI caller (and the reverse).
  assert.equal(call(lobby, 0, IID_IDirectPlayLobby3A, out), 0);
  assert.equal(read(read(out)), e.test_vtbl_lobby3() >>> 0, 'Lobby3A pins the ANSI vtable');
  assert.equal(call(lobby, 0, IID_IDirectPlayLobby3, out), 0);
  assert.equal(read(read(out)), lobbyW, 'Lobby3 (W) pins the Unicode vtable');
  assert.equal(call(lobby, 0, IID_IDirectPlayLobby2A, out), 0);
  assert.equal(read(read(out)), e.test_vtbl_lobby3() >>> 0, 'Lobby2A pins the ANSI vtable too');
  assert.equal(e.test_refs(lobby), 4);

  console.log('PASS Unicode IDirectPlay2/3 and IDirectPlayLobby/2/3: creation, vtables, NOTLOBBIED, W Connect, A/W re-pinning');
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
