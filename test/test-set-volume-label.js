#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const LAST_ERROR_SENTINEL = 0x6a5b4c3d;

const extraWat = String.raw`
  (global $test_set_volume_label_esp_delta (mut i32) (i32.const 0))

  (func (export "test_set_volume_label")
      (param $root i32) (param $label i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetVolumeLabelA
      (local.get $root) (local.get $label)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_set_volume_label_esp_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $saved_esp)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_set_volume_label_esp_delta") (result i32)
    (global.get $test_set_volume_label_esp_delta))
  (func (export "test_set_volume_label_last_error") (result i32)
    (global.get $last_error))
  (func (export "test_set_volume_label_set_last_error") (param $value i32)
    (global.set $last_error (local.get $value)))
  (func (export "test_set_volume_label_api_id") (result i32)
    (call $lookup_api_id "SetVolumeLabelA"))
`;

function installGuestHelpers(e) {
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
      const byte = e.guest_read8(ptr + i);
      if (!byte) return Buffer.from(bytes).toString('latin1');
      bytes.push(byte);
    }
    throw new Error('unterminated ANSI result');
  };
  return { alloc, writeA, readA };
}

(async () => {
  const { exports: e, hostCtx } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const api = apiTable.find(entry => entry.name === 'SetVolumeLabelA');
  assert(api, 'SetVolumeLabelA is registered in the generated API table');
  assert.strictEqual(api.nargs, 2);
  assert.strictEqual(api.convention, 'stdcall');
  assert.strictEqual(e.test_set_volume_label_api_id(), api.id,
    'runtime import hashing resolves SetVolumeLabelA to its registered id');
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);
  e.heap_init(0x00420000);
  const { alloc, writeA, readA } = installGuestHelpers(e);
  const rootC = writeA('C:\\');
  const rootD = writeA('D:\\');
  const volumeOut = alloc(32);
  const volumeStack = alloc(36);
  const getLabel = root => {
    e.set_esp(volumeStack);
    for (let i = 0; i < 32; i++) e.guest_write8(volumeOut + i, 0xcc);
    assert.strictEqual(
      e.test_call_GetVolumeInformationA(root, volumeOut, 32, 0, 0, 0, 0, 0), 1);
    assert.strictEqual(e.get_esp() >>> 0, volumeStack);
    return readA(volumeOut);
  };

  e.test_set_volume_label_set_last_error(LAST_ERROR_SENTINEL);
  assert.strictEqual(e.test_set_volume_label(rootC, writeA('ARCHIVE')), 1,
    'a bounded FAT label is accepted on the writable system volume');
  assert.strictEqual(e.test_set_volume_label_last_error() >>> 0, LAST_ERROR_SENTINEL,
    'success leaves LastError unspecified rather than fabricating an error');
  assert.strictEqual(e.test_set_volume_label_esp_delta(), 12,
    'SetVolumeLabelA pops two stdcall arguments and the return address');
  assert.strictEqual(hostCtx.vfs.volumeLabels.get('c'), 'ARCHIVE',
    'success mutates the actual VFS volume-label state');
  assert.strictEqual(getLabel(rootC), 'ARCHIVE',
    'GetVolumeInformationA observes the new label');

  assert.strictEqual(e.test_set_volume_label(0, writeA('CURRENT')), 1,
    'a NULL root selects the current drive');
  assert.strictEqual(getLabel(rootC), 'CURRENT');

  assert.strictEqual(e.test_set_volume_label(rootC, writeA('ELEVENCHARS')), 1,
    'an eleven-character FAT label is accepted');
  assert.strictEqual(getLabel(rootC), 'ELEVENCHARS');
  assert.strictEqual(e.test_set_volume_label(rootC, writeA('TWELVECHARS!')), 0,
    'a label beyond the documented FAT limit is rejected');
  assert.strictEqual(e.test_set_volume_label_last_error(), 154,
    'overlong labels report ERROR_LABEL_TOO_LONG');
  assert.strictEqual(getLabel(rootC), 'ELEVENCHARS',
    'a rejected label leaves the previous state intact');

  assert.strictEqual(e.test_set_volume_label(writeA('C:'), writeA('BADROOT')), 0,
    'an explicit drive root requires the documented trailing backslash');
  assert.strictEqual(e.test_set_volume_label_last_error(), 123,
    'malformed root syntax reports ERROR_INVALID_NAME');
  assert.strictEqual(e.test_set_volume_label(writeA('Z:\\'), writeA('MISSING')), 0,
    'an unassigned drive cannot acquire fabricated volume state');
  assert.strictEqual(e.test_set_volume_label_last_error(), 15,
    'an unassigned drive reports ERROR_INVALID_DRIVE');
  assert.strictEqual(e.test_set_volume_label(0x90000000, writeA('BADPTR')), 0,
    'an unmapped root is rejected before a host read');
  assert.strictEqual(e.test_set_volume_label_last_error(), 87,
    'an inaccessible root reports ERROR_INVALID_PARAMETER');

  hostCtx.vfs.driveTypes = new Map([['d', 5]]);
  hostCtx.vfs.readOnlyDrives.add('d');
  hostCtx.vfs.volumeLabels.set('d', 'INSTALL_CD');
  assert.strictEqual(e.test_set_volume_label(rootD, writeA('MUTATE')), 0,
    'mounted immutable media rejects label writes');
  assert.strictEqual(e.test_set_volume_label_last_error(), 19,
    'immutable media reports ERROR_WRITE_PROTECT');
  assert.strictEqual(hostCtx.vfs.volumeLabels.get('d'), 'INSTALL_CD',
    'a failed write does not mutate mounted-media identity');

  assert.strictEqual(e.test_set_volume_label(rootC, 0), 1,
    'a NULL label removes the existing label');
  assert.strictEqual(hostCtx.vfs.volumeLabels.has('c'), false,
    'label deletion updates VFS state');
  assert.strictEqual(getLabel(rootC), '',
    'GetVolumeInformationA observes label deletion');
  assert.strictEqual(e.test_set_volume_label_esp_delta(), 12,
    'failure and deletion paths preserve exact stdcall cleanup');

  console.log('PASS  SetVolumeLabelA mutates the writable VFS volume identity');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
