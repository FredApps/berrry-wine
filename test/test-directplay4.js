#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const apis = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
  (func (export "test_object") (result i32)
    (call $dx_create_com_obj (i32.const 26) (global.get $DX_VTBL_DPLAY3)))
  (func (export "test_lobby") (result i32)
    (call $dx_create_com_obj (i32.const 27) (global.get $DX_VTBL_DPLAYLOBBY2)))
  (func (export "test_sync_lobby") (result i32)
    (global.set $DX_VTBL_DPLAYLOBBY3 (i32.const 0))
    (call $dx_sync_thread_vtables)
    (global.get $DX_VTBL_DPLAYLOBBY3))
  (export "test_enqueue" (func $dp_message_enqueue))
  (export "test_query" (func $dp_message_query))
  (func (export "test_sync") (result i32)
    (global.set $DX_VTBL_DPLAY4 (i32.const 0))
    (call $dx_sync_thread_vtables)
    (global.get $DX_VTBL_DPLAY4))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const exe = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert(e.load_pe(exe.length) > 0);
  e.init_dx_com_thunks();
  const alloc = n => e.guest_alloc(n) >>> 0;
  const read = p => e.guest_read32(p) >>> 0;
  const stack = alloc(64), out = alloc(4), bytes = alloc(4), data = alloc(4), iid = alloc(16);
  const owner = e.test_object() >>> 0, other = e.test_object() >>> 0;
  [0x0ab1c531, 0x11d14745, 0x0000a1a7, 0xfcab03f8].forEach((v, i) => e.guest_write32(iid + i * 4, v));
  const call = (object, slot, ...args) => {
    const thunk = read(read(object) + slot * 4);
    const api = apis[read(thunk + 4)];
    assert.strictEqual(read(thunk), 0xcaca0010);
    assert.strictEqual(api.nargs, args.length + 1);
    e.guest_write32(stack, 0);
    [object, ...args].forEach((v, i) => e.guest_write32(stack + (i + 1) * 4, v));
    e.set_esp(stack);
    e.set_eip(thunk);
    e.run(1);
    assert.strictEqual(e.get_eip(), 0, `${api.name} returns through the generated thunk`);
    assert.strictEqual(e.get_esp() >>> 0, stack + (api.nargs + 1) * 4, api.name);
    return e.get_eax() >>> 0;
  };
  const parent = read(owner);
  assert.strictEqual(call(owner, 0, iid, out), 0);
  assert.strictEqual(read(out), owner);
  const table = read(owner);
  assert.notStrictEqual(table, parent);
  for (let slot = 0; slot < 47; slot++) assert.strictEqual(read(table + slot * 4), read(parent + slot * 4));
  const tail = ['GetGroupOwner', 'SetGroupOwner', 'SendEx', 'GetMessageQueue', 'CancelMessage', 'CancelPriority'];
  tail.forEach((name, i) => assert.strictEqual(apis[read(read(table + (47 + i) * 4) + 4)].name, `IDirectPlay4_${name}`));
  assert.strictEqual(e.test_sync() >>> 0, table, 'thread vtable registry restores appended DP4');
  const player = object => {
    assert.strictEqual(call(object, 6, out, 0, 0, 0, 0, 0), 0);
    return read(out);
  };
  const p1 = player(owner), p2 = player(owner), foreign = player(other);
  assert.strictEqual(call(owner, 5, out, 0, 0, 0, 0), 0);
  const group = read(out);
  e.guest_write32(out, 0xfeedface);
  assert.strictEqual(call(owner, 47, group, out), 0x80004001);
  assert.strictEqual(read(out), 0xfeedface, 'unsupported ownership does not publish a guessed owner');
  assert.strictEqual(call(owner, 47, group, 0), 0x80070057);
  assert.strictEqual(call(owner, 47, p1, out), 0x8877009b);
  assert.strictEqual(call(owner, 48, group, p1), 0x80004001);
  assert.strictEqual(call(owner, 48, group, foreign), 0x88770096);
  assert.strictEqual(call(owner, 48, p1, p2), 0x8877009b);
  e.guest_write32(data, 0x12345678);
  assert.strictEqual(call(owner, 49, p1, p2, 0, data, 4, 77, 0, 0, out), 0);
  assert.strictEqual(read(out), 0xfeedface, 'synchronous SendEx does not publish an async ID');
  const received = e.test_query(owner, 1, p1, p2, 2) >>> 0;
  assert(received);
  assert.strictEqual(read(received + 24), 77);
  assert.strictEqual(read(read(received + 16)), 0x12345678);
  assert.strictEqual(call(owner, 49, p1, p2, 0, data, 4, 65536, 0, 0, out), 0x88770186);
  assert.strictEqual(call(owner, 49, p1, p2, 512, data, 4, 0, 0, 0, out), 0x80004001);
  assert.strictEqual(call(owner, 50, p1, p2, 2, out, bytes), 0);
  assert.strictEqual(read(out), 1);
  assert.strictEqual(read(bytes), 4);
  assert.strictEqual(call(owner, 50, 0, 0, 0, out, bytes), 0);
  assert.strictEqual(read(out), 0);
  assert.strictEqual(read(bytes), 0);
  assert.strictEqual(call(owner, 50, 0, 0, 2, 0, 0), 0);
  e.guest_write32(out, 0xfeedface);
  assert.strictEqual(call(owner, 50, 0, 0, 3, out, bytes), 0x88770078);
  assert.strictEqual(call(owner, 50, foreign, 0, 2, out, bytes), 0x88770096);
  assert.strictEqual(read(out), 0xfeedface);
  assert.strictEqual(call(owner, 51, read(received), 0), 0x8877017c, 'cannot cancel delivered messages');
  // Pending-send fixtures exercise cancellation without claiming an async producer.
  const pending = e.test_enqueue(owner, p1, p2, data, 4, 42, 0) >>> 0;
  const foreignPending = e.test_enqueue(other, foreign, foreign, data, 4, 42, 0) >>> 0;
  assert(pending && foreignPending);
  assert.strictEqual(call(owner, 51, pending, 1), 0x88770078);
  assert.strictEqual(call(owner, 51, foreignPending, 0), 0x8877017c);
  assert.strictEqual(call(owner, 51, pending, 0), 0);
  assert.strictEqual(call(owner, 51, pending, 0), 0x8877017c);
  assert(e.test_enqueue(owner, p1, p2, data, 4, 42, 0));
  assert.strictEqual(call(owner, 52, 42, 42, 1), 0x88770078);
  assert.strictEqual(call(owner, 52, 43, 42, 0), 0x88770186);
  assert.strictEqual(call(owner, 52, 0, 65536, 0), 0x88770186);
  assert.strictEqual(call(owner, 52, 42, 42, 0), 0);
  assert.strictEqual(e.test_query(owner, 0, 0, 0, 0), 0);
  assert.strictEqual(e.test_query(other, 0, 0, 0, 0), 1);
  assert.strictEqual(e.test_query(owner, 1, 0, 0, 0), 1);
  assert(e.test_enqueue(owner, p1, p2, data, 4, 0, 0));
  assert.strictEqual(call(owner, 51, 0, 0), 0);
  assert.strictEqual(e.test_query(owner, 0, 0, 0, 0), 0);
  assert.strictEqual(call(owner, 2), 1);
  assert.strictEqual(call(owner, 2), 0);
  assert.strictEqual(call(other, 2), 0);
  const lobby = e.test_lobby() >>> 0;
  const oldLobby = read(lobby);
  [0x2db72491, 0x11d1652c, 0x0000a8a7, 0xfcab03f8].forEach((v, i) => e.guest_write32(iid + i * 4, v));
  assert.strictEqual(call(lobby, 0, iid, 0), 0x80004003);
  assert.strictEqual(read(lobby), oldLobby, 'failed QI cannot change the interface');
  assert.strictEqual(call(lobby, 0, iid, out), 0, 'exact IWD Lobby3A request succeeds');
  assert.strictEqual(read(out), lobby);
  const lobbyTable = read(lobby);
  assert.notStrictEqual(lobbyTable, oldLobby);
  for (let slot = 0; slot < 15; slot++) assert.strictEqual(read(lobbyTable + slot * 4), read(oldLobby + slot * 4));
  ['ConnectEx', 'RegisterApplication', 'UnregisterApplication', 'WaitForConnectionSettings'].forEach((name, i) =>
    assert.strictEqual(apis[read(read(lobbyTable + (15 + i) * 4) + 4)].name, `IDirectPlayLobby3_${name}`));
  assert.strictEqual(e.test_sync_lobby() >>> 0, lobbyTable);
  e.guest_write32(iid, 0x2db72490);
  assert.strictEqual(call(lobby, 0, iid, out), 0x80004002, 'Unicode Lobby3 remains unsupported');
  assert.strictEqual(read(out), 0);
  e.guest_write32(out, 0xfeedface);
  assert.strictEqual(call(lobby, 15, 0, iid, out, 0), 0x80004001);
  assert.strictEqual(read(out), 0, 'ConnectEx cannot fabricate a connected object');
  assert.strictEqual(call(lobby, 15, 0, iid, 0, 0), 0x80070057);
  assert.strictEqual(call(lobby, 15, 0, 0, out, 0), 0x80070057);
  assert.strictEqual(call(lobby, 15, 0, iid, out, lobby), 0x80040110);
  const desc = alloc(52);
  e.guest_write32(desc, 52);
  for (const [slot, arg] of [[16, desc], [17, iid]]) {
    assert.strictEqual(call(lobby, slot, 0, arg), 0x80004001);
    assert.strictEqual(call(lobby, slot, 1, arg), 0x88770078);
    assert.strictEqual(call(lobby, slot, 0, 0), 0x80070057);
  }
  assert.strictEqual(call(lobby, 18, 0), 0x80004001);
  assert.strictEqual(call(lobby, 18, 1), 0x80004001);
  assert.strictEqual(call(lobby, 18, 2), 0x88770078);
  assert.strictEqual(call(lobby, 2), 1);
  assert.strictEqual(call(lobby, 2), 0);
  console.log('PASS Lobby3A 19-slot generated ABI, same identity, worker registry, and explicit unsupported operations');
  console.log('PASS DirectPlay4 53-slot generated ABI, local SendEx, queue/cancel contracts, and explicit unsupported modes');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
