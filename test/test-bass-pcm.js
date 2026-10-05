#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = String.raw`
  (global $bass_test_eax (mut i32) (i32.const 0))
  (global $bass_test_delta (mut i32) (i32.const 0))

  (func $bass_test_record (param $saved i32)
    (global.set $bass_test_eax (i32.load offset=0 (global.get $reg_base)))
    (global.set $bass_test_delta (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $saved)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved)))
  (func (export "bass_test_eax") (result i32) (global.get $bass_test_eax))
  (func (export "bass_test_delta") (result i32) (global.get $bass_test_delta))
  (func (export "bass_sample_stop_api_id") (result i32)
    (call $lookup_api_id "BASS_SampleStop"))
  (func (export "bass_stop_api_id") (result i32)
    (call $lookup_api_id "BASS_Stop"))
  (func (export "bass_pause_api_id") (result i32)
    (call $lookup_api_id "BASS_Pause"))

  (func (export "bass_init") (param $freq i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_Init (i32.const -1) (local.get $freq) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_error")
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_ErrorGetCode (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_sample_load") (param $path i32) (param $max i32) (param $flags i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (local.get $s) (i32.const 24)) (local.get $max))
    (call $gs32 (i32.add (local.get $s) (i32.const 28)) (local.get $flags))
    (call $handle_BASS_SampleLoad (i32.const 0) (local.get $path)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_sample_load_mem") (param $ptr i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (local.get $s) (i32.const 24)) (i32.const 1))
    (call $gs32 (i32.add (local.get $s) (i32.const 28)) (i32.const 0))
    (call $handle_BASS_SampleLoad (i32.const 1) (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 48) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_get_channel") (param $sample i32) (param $onlynew i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_SampleGetChannel (local.get $sample) (local.get $onlynew)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_channel_play") (param $channel i32) (param $restart i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_ChannelPlay (local.get $channel) (local.get $restart)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_channel_pause") (param $channel i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_ChannelPause (local.get $channel) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_channel_stop") (param $channel i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_ChannelStop (local.get $channel) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_sample_stop") (param $sample i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_SampleStop (local.get $sample) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_sample_free") (param $sample i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_SampleFree (local.get $sample) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_config") (param $option i32) (param $value i32)
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_SetConfig (local.get $option) (local.get $value)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_pause")
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_Pause (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_start")
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_Start (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_stop")
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_Stop (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_stream")
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_StreamCreateFile (i32.const 0) (i32.const 1)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_music")
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_MusicLoad (i32.const 0) (i32.const 1)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
  (func (export "bass_free")
    (local $s i32) (local.set $s (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BASS_Free (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $bass_test_record (local.get $s)))
`;

function makeWave({ format = 1, bits = 8, data = [0x80, 0x90, 0x70, 0x80] } = {}) {
  const channels = 1;
  const rate = 8000;
  const align = channels * bits / 8;
  const bytes = new Uint8Array(44 + data.length);
  const view = new DataView(bytes.buffer);
  bytes.set(Buffer.from('RIFF'), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(Buffer.from('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * align, true);
  view.setUint16(32, align, true);
  view.setUint16(34, bits, true);
  bytes.set(Buffer.from('data'), 36);
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return bytes;
}

(async () => {
  let nextVoice = 100;
  const opened = [];
  const played = [];
  const stopped = [];
  const closed = [];
  const volumes = [];
  let memory;
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      voice_open(rate, channels, bits) {
        const id = nextVoice++;
        opened.push({ id, rate, channels, bits });
        return id;
      },
      voice_play_ring(id, ptr, length, offset, loop) {
        played.push({ id, offset, loop,
          pcm: [...new Uint8Array(memory.buffer, ptr >>> 0, length >>> 0)] });
        return 0;
      },
      voice_get_pos() { return 2; },
      voice_is_playing() { return 1; },
      voice_stop(id) { stopped.push(id); return 0; },
      voice_close(id) { closed.push(id); return 0; },
      voice_set_volume_linear(id, value) { volumes.push({ id, value }); },
    },
  });
  memory = harness.memory;
  const e = harness.exports;
  for (const [name, nargs] of [
    ['BASS_Init', 5], ['BASS_SampleLoad', 7], ['BASS_SampleGetChannel', 2],
    ['BASS_ChannelPlay', 2], ['BASS_SampleStop', 1], ['BASS_Stop', 0],
    ['BASS_Pause', 0], ['BASS_ErrorGetCode', 0], ['BASS_Free', 0],
  ]) {
    const row = apiTable.find(entry => entry.name === name);
    assert(row, `${name} is registered`);
    assert.strictEqual(row.nargs, nargs, `${name} nargs`);
    assert.strictEqual(row.convention, 'stdcall', `${name} calling convention`);
    assert.strictEqual(row.stub, undefined, `${name} dispatches to its real handler`);
  }
  assert.strictEqual(e.bass_sample_stop_api_id(),
    apiTable.find(entry => entry.name === 'BASS_SampleStop').id,
    'generated hash table resolves BASS_SampleStop');
  assert.strictEqual(e.bass_stop_api_id(),
    apiTable.find(entry => entry.name === 'BASS_Stop').id,
    'generated hash table resolves BASS_Stop');
  assert.strictEqual(e.bass_pause_api_id(),
    apiTable.find(entry => entry.name === 'BASS_Pause').id,
    'generated hash table resolves BASS_Pause');
  const bytes = new Uint8Array(memory.buffer);
  const wa = guest => e.guest_to_wasm(guest) >>> 0;
  const putString = value => {
    const encoded = Buffer.from(`${value}\0`, 'latin1');
    const ptr = e.guest_alloc(encoded.length) >>> 0;
    bytes.set(encoded, wa(ptr));
    return ptr;
  };
  const call = (name, args, expectedDelta) => {
    e[name](...args);
    assert.strictEqual(e.bass_test_delta(), expectedDelta, `${name} stdcall cleanup`);
    return e.bass_test_eax() >>> 0;
  };
  const error = () => call('bass_error', [], 4);

  assert.strictEqual(call('bass_sample_load', [putString('C:\\tone.wav'), 1, 0], 32), 0,
    'SampleLoad fails before initialization');
  assert.strictEqual(error(), 8, 'pre-init failure reports BASS_ERROR_INIT');
  assert.strictEqual(call('bass_init', [44100], 24), 1, 'BASS_Init initializes output');
  assert.strictEqual(error(), 0);
  assert.strictEqual(call('bass_init', [44100], 24), 0, 'double initialization is rejected');
  assert.strictEqual(error(), 14, 'double initialization reports BASS_ERROR_ALREADY');

  const wave = makeWave();
  harness.hostCtx.vfs.files.set('c:\\tone.wav', { data: wave.slice(), attrs: 0x20 });
  harness.hostCtx.vfs.files.set('c:\\bad.wav', {
    data: new Uint8Array(Buffer.from('not a RIFF waveform')), attrs: 0x20,
  });
  harness.hostCtx.vfs.files.set('c:\\compressed.wav', {
    data: makeWave({ format: 3 }), attrs: 0x20,
  });
  harness.hostCtx.vfs.files.set('c:\\empty.wav', {
    data: makeWave({ data: [] }), attrs: 0x20,
  });

  assert.strictEqual(call('bass_sample_load', [putString('C:\\missing.wav'), 1, 0], 32), 0);
  assert.strictEqual(error(), 2, 'missing VFS file reports BASS_ERROR_FILEOPEN');
  assert.strictEqual(call('bass_sample_load', [putString('C:\\bad.wav'), 1, 0], 32), 0);
  assert.strictEqual(error(), 41, 'malformed RIFF reports BASS_ERROR_FILEFORM');
  assert.strictEqual(call('bass_sample_load', [putString('C:\\compressed.wav'), 1, 0], 32), 0);
  assert.strictEqual(error(), 6, 'unsupported WAVE encoding reports BASS_ERROR_FORMAT');
  assert.strictEqual(call('bass_sample_load', [putString('C:\\empty.wav'), 1, 0], 32), 0);
  assert.strictEqual(error(), 31, 'empty PCM chunk reports BASS_ERROR_EMPTY');
  assert.strictEqual(call('bass_sample_load_mem', [1], 32), 0,
    'unsupported memory loads do not fabricate a sample');
  assert.strictEqual(error(), 20, 'unsupported memory mode reports BASS_ERROR_ILLPARAM');

  const path = putString('C:\\tone.wav');
  const sample = call('bass_sample_load', [path, 1, 0], 32);
  assert.strictEqual(sample >>> 24, 0xb1, 'SampleLoad returns a typed HSAMPLE');
  assert.notStrictEqual(sample, 0x0ba55001, 'legacy dummy handle is gone');
  harness.hostCtx.vfs.files.get('c:\\tone.wav').data.fill(0xff);

  const channel = call('bass_get_channel', [sample, 0], 12);
  assert.strictEqual(channel >>> 24, 0xb2, 'SampleGetChannel returns a distinct HCHANNEL type');
  assert.notStrictEqual(channel, sample);
  assert.strictEqual(call('bass_get_channel', [sample, 1], 12), 0,
    'onlynew honors the sample max-channel limit');
  assert.strictEqual(error(), 18, 'channel exhaustion reports BASS_ERROR_NOCHAN');

  assert.strictEqual(call('bass_config', [4, 8000], 12), 1);
  assert.strictEqual(call('bass_channel_play', [channel, 1], 12), 1);
  assert.deepStrictEqual(opened.pop(), { id: 100, rate: 8000, channels: 1, bits: 8 });
  assert.deepStrictEqual(played.pop(), { id: 100, offset: 0, loop: 0,
    pcm: [0x80, 0x90, 0x70, 0x80] }, 'playback uses the owned VFS copy and raw PCM range');
  assert.deepStrictEqual(volumes.pop(), { id: 100, value: 52428 },
    'BASS_CONFIG_GVOL_SAMPLE reaches the shared host voice gain');

  assert.strictEqual(call('bass_channel_pause', [channel], 8), 1);
  assert.strictEqual(stopped.pop(), 100, 'ChannelPause stops the live host voice');
  assert.strictEqual(call('bass_channel_play', [channel, 0], 12), 1);
  assert.strictEqual(played.pop().offset, 2, 'ChannelPlay(FALSE) resumes at the saved byte position');

  assert.strictEqual(call('bass_pause', [], 4), 1);
  assert.strictEqual(stopped.pop(), 100, 'BASS_Pause pauses active sample channels');
  assert.strictEqual(call('bass_start', [], 4), 1);
  assert.strictEqual(played.pop().offset, 2, 'BASS_Start resumes globally-paused channels');
  assert.strictEqual(call('bass_stop', [], 4), 1);
  assert.strictEqual(stopped.pop(), 100, 'BASS_Stop reaches the host voice');

  const replacementChannel = call('bass_get_channel', [sample, 0], 12);
  assert.notStrictEqual(replacementChannel, channel,
    'max-channel reuse advances the HCHANNEL generation');
  assert.strictEqual(closed.pop(), 100, 'reusing the oldest channel releases its host voice');
  assert.strictEqual(call('bass_sample_stop', [sample], 8), 1);
  assert.strictEqual(call('bass_sample_free', [sample], 8), 1);
  assert.strictEqual(call('bass_channel_play', [replacementChannel, 1], 12), 0,
    'SampleFree invalidates every derived channel handle');
  assert.strictEqual(error(), 5, 'stale channel reports BASS_ERROR_HANDLE');

  harness.hostCtx.vfs.files.set('c:\\tone.wav', { data: wave.slice(), attrs: 0x20 });
  const replacementSample = call('bass_sample_load', [path, 1, 0], 32);
  assert.notStrictEqual(replacementSample, sample,
    'reusing a sample slot advances the HSAMPLE generation');
  assert.strictEqual(call('bass_sample_free', [sample], 8), 0,
    'stale sample handle cannot free its replacement');
  assert.strictEqual(error(), 5);

  assert.strictEqual(call('bass_stream', [], 32), 0,
    'compressed stream path fails instead of returning a fake HSTREAM');
  assert.strictEqual(error(), 41);
  assert.strictEqual(call('bass_music', [], 32), 0,
    'tracker music path fails instead of returning a fake HMUSIC');
  assert.strictEqual(error(), 41);
  assert.strictEqual(call('bass_free', [], 4), 1, 'BASS_Free releases process audio state');
  assert.strictEqual(call('bass_sample_free', [replacementSample], 8), 0,
    'handles are invalid after BASS_Free');
  assert.strictEqual(error(), 8);

  console.log('PASS  BASS PCM samples use typed handles, VFS copies, and real host voices');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
