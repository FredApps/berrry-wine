#!/usr/bin/env node
'use strict';

// WSACancelBlockingCall() (WSOCK32 ordinal 113): socket waits here never run
// a nested blocking hook (WSAIsBlocking is FALSE), so there is never a call to
// cancel -- Winsock 1.1 answers SOCKET_ERROR with WSAEINVAL, or with
// WSANOTINITIALISED before WSAStartup. stdcall, no arguments. Descent 3's demo
// imports it by ordinal; unmapped, the import crashed as "<ord>" at boot.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_cancel") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_WSACancelBlockingCall (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "t_last_error") (result i32) (global.get $wsa_last_error))
  (func (export "t_set_started") (param $n i32) (global.set $wsa_started (local.get $n)))
  (func (export "t_api_id") (result i32) (call $lookup_api_id "WSACancelBlockingCall"))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.t_set_started(0);
  assert.strictEqual(e.t_cancel(), -1, 'SOCKET_ERROR');
  assert.strictEqual(e.t_last_error(), 10093, 'WSANOTINITIALISED before WSAStartup');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300004, 'stdcall, no arguments');
  e.t_set_started(1);
  assert.strictEqual(e.t_cancel(), -1, 'SOCKET_ERROR');
  assert.strictEqual(e.t_last_error(), 10022, 'WSAEINVAL: no blocking call to cancel');
  assert.notStrictEqual(e.t_api_id(), -1, 'the API is in the name table');
  console.log('PASS  WSACancelBlockingCall reports no blocking call to cancel (WSAEINVAL / WSANOTINITIALISED)');
})().catch(error => { console.error(error); process.exit(1); });
