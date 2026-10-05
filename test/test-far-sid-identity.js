#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const LAST_ERROR_SENTINEL = 0x6a5b4c3d;

const extraWat = String.raw`
  (global $test_sid_esp_delta (mut i32) (i32.const 0))

  (func (export "test_call_OpenProcessToken")
      (param $process i32) (param $access i32) (param $out i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_OpenProcessToken
      (local.get $process) (local.get $access) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_GetTokenInformation")
      (param $token i32) (param $class i32) (param $info i32)
      (param $length i32) (param $return_length i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetTokenInformation
      (local.get $token) (local.get $class) (local.get $info)
      (local.get $length) (local.get $return_length) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_CopySid")
      (param $length i32) (param $destination i32) (param $source i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CopySid
      (local.get $length) (local.get $destination) (local.get $source)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_sid_esp_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $saved_esp)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_LookupAccountSid")
      (param $system i32) (param $sid i32)
      (param $name i32) (param $name_len i32)
      (param $domain i32) (param $domain_len i32)
      (param $use i32) (param $wide i32) (result i32)
    (local $saved_esp i32) (local $frame i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (local.set $frame (call $heap_alloc (i32.const 32)))
    (i32.store offset=16 (global.get $reg_base) (local.get $frame))
    (call $gs32 (i32.add (local.get $frame) (i32.const 24)) (local.get $domain_len))
    (call $gs32 (i32.add (local.get $frame) (i32.const 28)) (local.get $use))
    (if (local.get $wide)
      (then
        (call $handle_LookupAccountSidW
          (local.get $system) (local.get $sid) (local.get $name) (local.get $name_len)
          (local.get $domain) (i32.const 0)))
      (else
        (call $handle_LookupAccountSidA
          (local.get $system) (local.get $sid) (local.get $name) (local.get $name_len)
          (local.get $domain) (i32.const 0))))
    (global.set $test_sid_esp_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $frame)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_sid_esp_delta") (result i32)
    (global.get $test_sid_esp_delta))
  (func (export "test_sid_last_error") (result i32)
    (global.get $last_error))
  (func (export "test_sid_set_last_error") (param $value i32)
    (global.set $last_error (local.get $value)))
  (func (export "test_copy_sid_api_id") (result i32)
    (call $lookup_api_id "CopySid"))
  (func (export "test_lookup_account_sid_a_api_id") (result i32)
    (call $lookup_api_id "LookupAccountSidA"))
`;

function fillGuest(e, ptr, length, value) {
  for (let i = 0; i < length; i++) e.guest_write8(ptr + i, value);
}

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const copySidApi = apiTable.find(entry => entry.name === 'CopySid');
  const lookupApi = apiTable.find(entry => entry.name === 'LookupAccountSidA');
  assert(copySidApi && lookupApi, 'both FAR SID APIs are registered');
  assert.strictEqual(copySidApi.nargs, 3);
  assert.strictEqual(lookupApi.nargs, 7);
  assert.strictEqual(e.test_copy_sid_api_id(), copySidApi.id);
  assert.strictEqual(e.test_lookup_account_sid_a_api_id(), lookupApi.id);
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;
  const view = new DataView(memory.buffer);
  const alloc = size => {
    const ptr = e.guest_alloc(size) >>> 0;
    assert(ptr, `allocated ${size} guest bytes`);
    return ptr;
  };
  const writeA = value => {
    const ptr = alloc(value.length + 1);
    for (let i = 0; i < value.length; i++) e.guest_write8(ptr + i, value.charCodeAt(i));
    e.guest_write8(ptr + value.length, 0);
    return ptr;
  };
  const readA = ptr => {
    const bytes = [];
    for (let i = 0; i < 64; i++) {
      const value = e.guest_read8(ptr + i);
      if (!value) return Buffer.from(bytes).toString('latin1');
      bytes.push(value);
    }
    throw new Error('unterminated ANSI account string');
  };

  // Obtain the SID from the existing process-token model rather than creating
  // a second identity fixture for these two APIs.
  const tokenOut = alloc(4);
  const groups = alloc(28);
  const returnLength = alloc(4);
  assert.strictEqual(e.test_call_OpenProcessToken(-1, 8, tokenOut), 1,
    'the modeled process token opens for TOKEN_QUERY');
  const token = view.getUint32(toWasm(tokenOut), true);
  assert.strictEqual(e.test_call_GetTokenInformation(token, 2, groups, 28, returnLength), 1,
    'TokenGroups publishes the process identity');
  const adminSid = view.getUint32(toWasm(groups + 4), true);
  assert.strictEqual(adminSid, groups + 12,
    'the identity source is the packed token-group SID');

  const copiedSid = alloc(68);
  fillGuest(e, copiedSid, 68, 0xcc);
  e.test_sid_set_last_error(LAST_ERROR_SENTINEL);
  assert.strictEqual(e.test_call_CopySid(16, copiedSid, adminSid), 1,
    'CopySid copies the complete variable-length process SID');
  assert.strictEqual(e.test_sid_last_error() >>> 0, LAST_ERROR_SENTINEL,
    'successful CopySid preserves LastError');
  assert.strictEqual(e.test_sid_esp_delta(), 16,
    'CopySid pops three stdcall arguments and the return address');
  assert.deepStrictEqual(
    Array.from(new Uint8Array(memory.buffer, toWasm(copiedSid), 16)),
    Array.from(new Uint8Array(memory.buffer, toWasm(adminSid), 16)),
    'the copied bytes retain S-1-5-32-544 exactly');

  const rejected = alloc(68);
  fillGuest(e, rejected, 68, 0xa5);
  assert.strictEqual(e.test_call_CopySid(15, rejected, adminSid), 0,
    'a destination shorter than GetLengthSid is rejected');
  assert.strictEqual(e.test_sid_last_error(), 122,
    'a short destination reports ERROR_INSUFFICIENT_BUFFER');
  assert.deepStrictEqual(
    Array.from(new Uint8Array(memory.buffer, toWasm(rejected), 16)),
    new Array(16).fill(0xa5), 'short-buffer failure is atomic');

  const malformedSid = alloc(16);
  for (let i = 0; i < 16; i++) e.guest_write8(malformedSid + i, e.guest_read8(adminSid + i));
  e.guest_write8(malformedSid, 2);
  assert.strictEqual(e.test_call_CopySid(16, rejected, malformedSid), 0,
    'CopySid rejects a malformed source SID');
  assert.strictEqual(e.test_sid_last_error(), 1337,
    'a malformed SID reports ERROR_INVALID_SID');
  assert.deepStrictEqual(
    Array.from(new Uint8Array(memory.buffer, toWasm(rejected), 16)),
    new Array(16).fill(0xa5), 'invalid-source failure does not touch destination');
  assert.strictEqual(e.test_call_CopySid(16, rejected, 0x90000000), 0,
    'an unmapped source SID fails safely');
  assert.strictEqual(e.test_sid_last_error(), 1337);
  assert.strictEqual(e.test_call_CopySid(16, 0x90000000, adminSid), 0,
    'an unmapped destination fails before copying');
  assert.strictEqual(e.test_sid_last_error(), 87,
    'an invalid destination reports ERROR_INVALID_PARAMETER');

  const name = alloc(64);
  const domain = alloc(32);
  const nameLen = alloc(4);
  const domainLen = alloc(4);
  const use = alloc(4);
  const setLookupState = (nameCap, domainCap) => {
    fillGuest(e, name, 64, 0xcc);
    fillGuest(e, domain, 32, 0xdd);
    view.setUint32(toWasm(nameLen), nameCap, true);
    view.setUint32(toWasm(domainLen), domainCap, true);
    view.setUint32(toWasm(use), 0xdecafbad, true);
  };

  setLookupState(0, 0);
  assert.strictEqual(
    e.test_call_LookupAccountSid(0, copiedSid, 0, nameLen, 0, domainLen, use, 0), 0,
    'LookupAccountSidA supports an output sizing query');
  assert.strictEqual(e.test_sid_last_error(), 122,
    'a sizing query reports ERROR_INSUFFICIENT_BUFFER');
  assert.strictEqual(view.getUint32(toWasm(nameLen), true), 15,
    'account-name capacity includes the NUL');
  assert.strictEqual(view.getUint32(toWasm(domainLen), true), 8,
    'domain capacity includes the NUL');
  assert.strictEqual(view.getUint32(toWasm(use), true) >>> 0, 0xdecafbad,
    'a sizing query does not publish a partial SID_NAME_USE');
  assert.strictEqual(e.test_sid_esp_delta(), 32,
    'LookupAccountSidA pops seven stdcall arguments and the return address');

  setLookupState(15, 8);
  e.test_sid_set_last_error(LAST_ERROR_SENTINEL);
  assert.strictEqual(
    e.test_call_LookupAccountSid(0, copiedSid, name, nameLen, domain, domainLen, use, 0), 1,
    'LookupAccountSidA resolves the copied process-group identity');
  assert.strictEqual(readA(name), 'Administrators');
  assert.strictEqual(readA(domain), 'BUILTIN');
  assert.strictEqual(view.getUint32(toWasm(nameLen), true), 14,
    'successful account-name length excludes NUL');
  assert.strictEqual(view.getUint32(toWasm(domainLen), true), 7,
    'successful domain length excludes NUL');
  assert.strictEqual(view.getUint32(toWasm(use), true), 4,
    'the modeled principal is SidTypeAlias');
  assert.strictEqual(e.test_sid_last_error() >>> 0, LAST_ERROR_SENTINEL,
    'successful account lookup preserves LastError');

  setLookupState(14, 8);
  assert.strictEqual(
    e.test_call_LookupAccountSid(0, copiedSid, name, nameLen, domain, domainLen, use, 0), 0,
    'either undersized payload buffer rejects the complete result');
  assert.strictEqual(e.test_sid_last_error(), 122);
  assert.strictEqual(view.getUint32(toWasm(nameLen), true), 15);
  assert.strictEqual(view.getUint32(toWasm(domainLen), true), 8,
    'both required sizes are returned together');
  assert.strictEqual(e.guest_read8(name), 0xcc);
  assert.strictEqual(e.guest_read8(domain), 0xdd);
  assert.strictEqual(view.getUint32(toWasm(use), true) >>> 0, 0xdecafbad,
    'insufficient-buffer failure leaves payload outputs atomic');

  const unknownSid = alloc(16);
  for (let i = 0; i < 16; i++) e.guest_write8(unknownSid + i, e.guest_read8(adminSid + i));
  view.setUint32(toWasm(unknownSid + 12), 545, true); // BUILTIN\Users: valid, not modeled.
  setLookupState(15, 8);
  assert.strictEqual(
    e.test_call_LookupAccountSid(0, unknownSid, name, nameLen, domain, domainLen, use, 0), 0,
    'a valid SID without a published account is not assigned a fake identity');
  assert.strictEqual(e.test_sid_last_error(), 1332,
    'an unknown valid SID reports ERROR_NONE_MAPPED');
  assert.strictEqual(view.getUint32(toWasm(nameLen), true), 15);
  assert.strictEqual(view.getUint32(toWasm(domainLen), true), 8);
  assert.strictEqual(e.guest_read8(name), 0xcc);
  assert.strictEqual(e.guest_read8(domain), 0xdd);
  assert.strictEqual(view.getUint32(toWasm(use), true) >>> 0, 0xdecafbad,
    'unmapped identity failure preserves every output');

  setLookupState(15, 8);
  assert.strictEqual(
    e.test_call_LookupAccountSid(0, malformedSid, name, nameLen, domain, domainLen, use, 0), 0,
    'LookupAccountSidA validates the SID before name translation');
  assert.strictEqual(e.test_sid_last_error(), 1337);
  const remote = writeA('REMOTE');
  assert.strictEqual(
    e.test_call_LookupAccountSid(remote, copiedSid, name, nameLen, domain, domainLen, use, 0), 0,
    'the browser does not fabricate a remote account database');
  assert.strictEqual(e.test_sid_last_error(), 53,
    'a named remote system reports ERROR_BAD_NETPATH');
  assert.strictEqual(
    e.test_call_LookupAccountSid(0, copiedSid, name, 0x90000000, domain, domainLen, use, 0), 0,
    'an unmapped mandatory length pointer fails safely');
  assert.strictEqual(e.test_sid_last_error(), 87);

  setLookupState(15, 8);
  assert.strictEqual(
    e.test_call_LookupAccountSid(0, unknownSid, name, nameLen, domain, domainLen, use, 1), 0,
    'LookupAccountSidW shares ANSI recognition instead of naming every valid SID');
  assert.strictEqual(e.test_sid_last_error(), 1332);
  assert.strictEqual(e.test_sid_esp_delta(), 32,
    'the Unicode wrapper retains the same seven-argument ABI');

  console.log('PASS  FAR SID copy/account lookup uses the process token identity');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
