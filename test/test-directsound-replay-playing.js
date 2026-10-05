#!/usr/bin/env node
'use strict';

// Play on a DirectSound buffer that is already playing does not move its play
// cursor; only a Stop (or SetCurrentPosition) does. DX-Ball re-Plays its
// 132KB looping buffer every frame, and passing each of those to the host
// restarted the ring from its start byte and re-decoded the whole buffer.
// It also polls GetStatus on a looping ring every frame. A looping buffer
// cannot end on its own, so that poll must not reach the host: in Worker mode
// every host call here is a round trip to the page.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_dsbuf_create") (result i32)
    (local $obj i32) (local $entry i32) (local $state i32)
    (local.set $obj
      (call $dx_create_com_obj (i32.const 5) (global.get $DX_VTBL_DSBUF)))
    (local.set $entry (call $dx_from_this (local.get $obj)))
    (local.set $state (call $dx_surf_state_ptr (local.get $entry)))
    (i32.store offset=4 (local.get $state) (i32.const 0))
    (i32.store offset=12 (local.get $entry) (i32.const 64))
    (store.field DxObject bpp (local.get $entry) (i32.const 1))
    (store.field DxObject pitch (local.get $entry) (i32.const 8))
    (store.field DxObject misc1 (local.get $entry) (global.get $STRING_CONSTANTS))
    (store.field DxObject misc2 (local.get $entry) (i32.const 1000))
    (local.get $obj))

  (func (export "test_dsbuf_play")
      (param $this i32) (param $flags i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_Play
      (local.get $this) (i32.const 0) (i32.const 0) (local.get $flags)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_status")
      (param $this i32) (param $out i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_GetStatus
      (local.get $this) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
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
  const statusQueries = [];
  let hostPlaying = 1;
  const { exports: wat, memory } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      voice_open: () => 77,
      voice_play_ring: (...args) => { plays.push(args.map(value => value >>> 0)); return 0; },
      voice_is_playing: (id) => { statusQueries.push(id >>> 0); return hostPlaying; },
      voice_get_pos: () => 0,
      voice_stop: () => 0,
    },
  });
  const exe = fs.readFileSync(path.join(__dirname, 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(exe, wat.get_staging());
  assert(wat.load_pe(exe.length), 'fixture PE initializes DirectSound vtables');
  wat.init_dx_com_thunks();

  const out = wat.guest_alloc(4) >>> 0;
  const status = (buf) => {
    assert.strictEqual(wat.test_dsbuf_status(buf, out) >>> 0, 0);
    return wat.guest_read32(out) >>> 0;
  };

  // A stopped buffer never asks the host whether it is playing.
  const looping = wat.test_dsbuf_create() >>> 0;
  assert.strictEqual(status(looping), 0);
  assert.deepStrictEqual(statusQueries, [], 'a stopped buffer is answered from its own flags');

  // Looping: the first Play reaches the host, every re-Play while looping does not.
  assert.strictEqual(wat.test_dsbuf_play(looping, 1) >>> 0, 0);
  assert.strictEqual(plays.length, 1, 'the first looping Play starts the host voice');
  for (let i = 0; i < 5; i++) assert.strictEqual(wat.test_dsbuf_play(looping, 1) >>> 0, 0);
  assert.strictEqual(plays.length, 1,
    're-Playing a looping buffer that is still looping must not restart the host ring');
  hostPlaying = 0;
  assert.strictEqual(status(looping), 5, 'PLAYING|LOOPING');
  assert.deepStrictEqual(statusQueries, [],
    'a looping buffer cannot end on its own, so GetStatus must not ask the host');

  // A loop -> one-shot change of flags still reaches the host.
  hostPlaying = 1;
  assert.strictEqual(wat.test_dsbuf_play(looping, 0) >>> 0, 0);
  assert.strictEqual(plays.length, 2, 'changing DSBPLAY_LOOPING is passed on');
  assert.strictEqual(plays[1][4], 0);

  // After Stop the next looping Play starts the voice again.
  assert.strictEqual(wat.test_dsbuf_stop(looping) >>> 0, 0);
  assert.strictEqual(wat.test_dsbuf_play(looping, 1) >>> 0, 0);
  assert.strictEqual(plays.length, 3, 'Play after Stop starts the voice');

  // One-shot: GetStatus still retires it from the host's answer.
  const oneShot = wat.test_dsbuf_create() >>> 0;
  statusQueries.length = 0;
  assert.strictEqual(wat.test_dsbuf_play(oneShot, 0) >>> 0, 0);
  hostPlaying = 1;
  assert.strictEqual(status(oneShot), 1);
  hostPlaying = 0;
  assert.strictEqual(status(oneShot), 0, 'an ended one-shot reads as stopped');
  assert.strictEqual(statusQueries.length, 2, 'a playing one-shot asks the host each time');
  assert.strictEqual(status(oneShot), 0);
  assert.strictEqual(statusQueries.length, 2, 'once retired, it stops asking');

  console.log('PASS DirectSound re-Play of a looping buffer and its GetStatus stay off the host');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
