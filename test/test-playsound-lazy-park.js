#!/usr/bin/env node
'use strict';
// PlaySound(file) on a streamed (lazy) file parks instead of failing.
//
// lib/app-files.js used to keep every sound file of an app that names
// PlaySound/sndPlaySound eager, because the sound path read the whole file in
// one turn and a nonresident chunk made it return FALSE (no sound, silently).
// Colin McRae Rally's demo loaded 591 .wav files before its first frame for
// that reason. The read now parks on IO_WAIT like _lread: the stdcall frame is
// restored, EIP points back at the thunk, and the retry after the host fills
// the chunk plays the sound.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_play") (param $kind i32) (param $path i32) (param $flags i32)
      (param $reset i32) (result i32)
    (if (local.get $reset)
      (then
        (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
        (global.set $current_thunk_eip (i32.const 0x0013579b))
        (global.set $eip (i32.const 0))
        (global.set $handler_set_eip (i32.const 0))
        (global.set $yield_reason (i32.const 0))
        (global.set $yield_flag (i32.const 0)))
      (else
        ;; The host completed the IO_WAIT; the thunk runs the handler again.
        (global.set $handler_set_eip (i32.const 0))
        (global.set $yield_reason (i32.const 0))
        (global.set $yield_flag (i32.const 0))))
    (if (i32.eqz (local.get $kind))
      (then (call $handle_PlaySoundA (local.get $path) (i32.const 0) (local.get $flags)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_sndPlaySoundA (local.get $path) (local.get $flags)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (i32.load offset=0 (global.get $reg_base)))
`;

// A minimal valid RIFF/WAVE image: header + 4 sample bytes.
const wav = new Uint8Array(48);
const dv = new DataView(wav.buffer);
wav.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 40, true);
wav.set([0x57, 0x41, 0x56, 0x45], 8); wav.set([0x66, 0x6d, 0x74, 0x20], 12);
dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
dv.setUint32(24, 11025, true); dv.setUint32(28, 11025, true);
dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
wav.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, 4, true);

(async () => {
  let wat;
  let pendingReads = 0;
  let reads = 0;
  // The pending flag describes the most recent failed read.
  let lastPending = false;
  const played = [];
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      fs_create_file: () => 41,
      fs_get_file_size: () => wav.length,
      // As in lib/filesystem.js, closing the handle clears the pending-read
      // state, so the pending check must come before the close.
      fs_close_handle: () => { lastPending = false; return 1; },
      fs_read_file(handle, buffer, requested, count) {
        reads++;
        wat.guest_write32(count, 0);
        if (pendingReads > 0) { pendingReads--; return 0; }
        for (let i = 0; i < requested; i++) wat.guest_write8(buffer + i, wav[i]);
        wat.guest_write32(count, requested);
        return 1;
      },
      fs_read_pending: () => (lastPending ? 1 : 0),
      play_sound: (wa, size) => { played.push(size); return 7; },
      voice_close: () => 1,
      voice_is_playing: () => 0,
    },
  });
  wat = harness.exports;
  const path = (wat.get_image_base() >>> 0) + 0x2800;
  Array.from('C:\\snd.wav\0').forEach((c, i) => wat.guest_write8(path + i, c.charCodeAt(0)));

  for (const [kind, name, pop] of [[0, 'PlaySoundA', 0x10], [1, 'sndPlaySoundA', 0x0c]]) {
    played.length = 0;
    reads = 0;
    pendingReads = 1;
    lastPending = true;
    wat.test_play(kind, path, kind === 0 ? 0x20001 : 0x0001, 1);
    assert.strictEqual(wat.get_yield_reason(), 12, `${name}: a nonresident sound file parks on IO_WAIT`);
    assert.strictEqual(wat.get_esp() >>> 0, 0x00300000, `${name}: the parked stdcall frame is restored`);
    assert.strictEqual(wat.get_eip() >>> 0, 0x0013579b, `${name}: the retry goes through the original thunk`);
    assert.deepStrictEqual(played, [], `${name}: nothing plays before the bytes are in`);

    lastPending = false;
    assert.strictEqual(wat.test_play(kind, path, kind === 0 ? 0x20001 : 0x0001, 0), 1,
      `${name}: the retried call returns TRUE`);
    assert.deepStrictEqual(played, [wav.length], `${name}: the retry plays the whole file`);
    assert.strictEqual(wat.get_esp() >>> 0, 0x00300000 + pop, `${name}: the retry pops its frame once`);
    assert.strictEqual(reads, 2, `${name}: one pending read, retried once`);
  }

  // A read that fails for real (not pending) is still FALSE, with no park.
  reads = 0; pendingReads = 1; lastPending = false;
  assert.strictEqual(wat.test_play(0, path, 0x20001, 1), 0, 'a failed read reports FALSE');
  assert.strictEqual(wat.get_yield_reason(), 0, 'and does not park');
  console.log('PASS test-playsound-lazy-park');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
