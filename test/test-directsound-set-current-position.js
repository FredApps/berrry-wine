#!/usr/bin/env node
'use strict';

// Microsoft documents SetCurrentPosition as a secondary-buffer operation.
// A stopped buffer remembers the byte for its next Play; a live buffer moves
// immediately and continues. Exercise the WAT-to-browser voice boundary so a
// constant-success stub cannot satisfy this test.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_dsbuf_create") (param $caps i32) (result i32)
    (local $obj i32) (local $entry i32) (local $state i32)
    (local.set $obj
      (call $dx_create_com_obj (i32.const 5) (global.get $DX_VTBL_DSBUF)))
    (local.set $entry (call $dx_from_this (local.get $obj)))
    (local.set $state (call $dx_surf_state_ptr (local.get $entry)))
    (i32.store offset=4 (local.get $state) (local.get $caps))
    (i32.store offset=12 (local.get $entry) (i32.const 64))
    (store.field DxObject bpp (local.get $entry) (i32.const 1))
    (store.field DxObject pitch (local.get $entry) (i32.const 8))
    (store.field DxObject misc1 (local.get $entry) (global.get $STRING_CONSTANTS))
    (store.field DxObject misc2 (local.get $entry) (i32.const 1000))
    (local.get $obj))

  (func (export "test_ds_create_root") (result i32)
    (call $dx_create_com_obj (i32.const 4) (global.get $DX_VTBL_DSOUND)))

  (func (export "test_dsbuf_data_address") (result i32)
    (global.get $STRING_CONSTANTS))

  (func (export "test_dsbuf_set_position")
      (param $this i32) (param $position i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_SetCurrentPosition
      (local.get $this) (local.get $position)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_get_position")
      (param $this i32) (param $play i32) (param $write i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_GetCurrentPosition
      (local.get $this) (local.get $play) (local.get $write)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_play")
      (param $this i32) (param $flags i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_Play
      (local.get $this) (i32.const 0) (i32.const 0) (local.get $flags)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_stop") (param $this i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_Stop
      (local.get $this) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const plays = [];
  let hostPosition = 0;
  let stops = 0;
  const { exports: wat, memory } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      voice_open: () => 77,
      voice_play_ring: (...args) => { plays.push(args.map(value => value >>> 0)); return 0; },
      voice_get_pos: () => hostPosition,
      voice_stop: () => { stops++; return 0; },
    },
  });
  const exe = fs.readFileSync(path.join(__dirname, 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(exe, wat.get_staging());
  assert(wat.load_pe(exe.length), 'fixture PE initializes DirectSound vtables');
  wat.init_dx_com_thunks();

  const playOut = wat.guest_alloc(4) >>> 0;
  const writeOut = wat.guest_alloc(4) >>> 0;
  const secondary = wat.test_dsbuf_create(0) >>> 0;
  const primary = wat.test_dsbuf_create(1) >>> 0;
  const root = wat.test_ds_create_root() >>> 0;
  const dataAddress = wat.test_dsbuf_data_address() >>> 0;

  assert.strictEqual(wat.test_dsbuf_get_position(secondary, playOut, writeOut) >>> 0, 0);
  assert.strictEqual(wat.guest_read32(playOut) >>> 0, 0);
  assert.strictEqual(wat.guest_read32(writeOut) >>> 0, 15,
    'the stopped write cursor keeps the existing 15ms lead');

  assert.strictEqual(wat.test_dsbuf_set_position(secondary, 16) >>> 0, 0);
  assert.strictEqual(plays.length, 0, 'setting a stopped buffer does not start it');
  wat.test_dsbuf_get_position(secondary, playOut, writeOut);
  assert.strictEqual(wat.guest_read32(playOut) >>> 0, 16,
    'a stopped secondary remembers its requested play cursor');
  assert.strictEqual(wat.guest_read32(writeOut) >>> 0, 31);

  assert.strictEqual(wat.test_dsbuf_set_position(secondary, 64) >>> 0, 0x80070057,
    'an offset outside the buffer is invalid');
  assert.strictEqual(wat.test_dsbuf_set_position(primary, 0) >>> 0, 0x88780032,
    'primary buffers reject SetCurrentPosition');
  assert.strictEqual(wat.test_dsbuf_set_position(root, 0) >>> 0, 0x80070057,
    'a different DirectSound interface is not a sound buffer');

  assert.strictEqual(wat.test_dsbuf_play(secondary, 0) >>> 0, 0);
  assert.deepStrictEqual(plays.shift(), [77, dataAddress, 64, 16, 0],
    'Play begins at the remembered stopped cursor');
  hostPosition = 5;
  wat.test_dsbuf_get_position(secondary, playOut, writeOut);
  assert.strictEqual(wat.guest_read32(playOut) >>> 0, 21,
    'the host snapshot cursor is rebased onto its DirectSound origin');
  assert.strictEqual(wat.guest_read32(writeOut) >>> 0, 36);

  assert.strictEqual(wat.test_dsbuf_set_position(secondary, 24) >>> 0, 0);
  assert.deepStrictEqual(plays.shift(), [77, dataAddress, 64, 24, 0],
    'a playing buffer immediately restarts its snapshot at the new byte');
  hostPosition = 6;
  assert.strictEqual(wat.test_dsbuf_stop(secondary) >>> 0, 0);
  assert.strictEqual(stops, 1);
  hostPosition = 40;
  wat.test_dsbuf_get_position(secondary, playOut, writeOut);
  assert.strictEqual(wat.guest_read32(playOut) >>> 0, 30,
    'Stop freezes the live cursor instead of letting the host clock advance');

  assert.strictEqual(wat.test_dsbuf_play(secondary, 1) >>> 0, 0);
  assert.deepStrictEqual(plays.shift(), [77, dataAddress, 64, 30, 1]);
  assert.strictEqual(wat.test_dsbuf_set_position(secondary, 0) >>> 0, 0);
  assert.deepStrictEqual(plays.shift(), [77, dataAddress, 64, 0, 1],
    'the common looping-effect rewind continues with DSBPLAY_LOOPING');

  console.log('PASS DirectSound SetCurrentPosition owns stopped and live cursor state');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
