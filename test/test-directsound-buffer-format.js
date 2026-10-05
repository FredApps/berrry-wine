#!/usr/bin/env node
'use strict';

// A primary DirectSound buffer is created without lpwfxFormat. Miles calls
// SetFormat and immediately reads it back; losing that state leaves its
// bytes-per-interval divisor at zero and aborts Heroes III during startup.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const extraWat = String.raw`
  (func (export "test_ds_create") (param $output i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_DirectSoundCreate
      (i32.const 0) (local.get $output) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ds_set_cooperative_level")
        (param $this i32) (param $hwnd i32) (param $level i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSound_SetCooperativeLevel
      (local.get $this) (local.get $hwnd) (local.get $level)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ds_get_caps") (param $this i32) (param $caps i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSound_GetCaps
      (local.get $this) (local.get $caps) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ds_compact") (param $this i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSound_Compact
      (local.get $this) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ds_make_window")
        (param $style i32) (param $parent i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x401000))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
    (call $wnd_set_parent (local.get $hwnd) (local.get $parent))
    (local.get $hwnd))

  (func (export "test_ds_create_buffer")
        (param $this i32) (param $desc i32) (param $output i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSound_CreateSoundBuffer
      (local.get $this) (local.get $desc) (local.get $output)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_get_caps")
        (param $this i32) (param $caps i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_GetCaps
      (local.get $this) (local.get $caps)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_get_status")
        (param $this i32) (param $status i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_GetStatus
      (local.get $this) (local.get $status)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_set_format")
        (param $this i32) (param $format i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_SetFormat
      (local.get $this) (local.get $format)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsbuf_get_format")
        (param $this i32) (param $format i32) (param $allocated i32)
        (param $written i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_IDirectSoundBuffer_GetFormat
      (local.get $this) (local.get $format) (local.get $allocated)
      (local.get $written) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

async function main() {
  // Plain append: src fragments are self-balanced, so there is no trailing `)`
  // for the old splice to match — it silently dropped the fragment.
  const wasm = compileSrcWasm((file, source) =>
    file === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const imports = createHostImports({
    getMemory: () => memory.buffer,
    renderer: null,
    resourceJson: {},
  });
  imports.host.memory = memory;
  Object.assign(imports.host, {
    create_thread: () => 0, exit_thread: () => 0, terminate_thread: () => 0,
    create_event: () => 0, set_event: () => 0, reset_event: () => 0,
    wait_single: () => 0, wait_multiple: () => 0,
    com_create_instance: () => 0x80004002,
  });

  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = instance.exports;
  const exe = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert(e.load_pe(exe.length), 'fixture PE initializes guest memory and DX vtables');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const dv = new DataView(memory.buffer);
  const format = e.guest_alloc(18) >>> 0;
  const output = e.guest_alloc(18) >>> 0;
  const written = e.guest_alloc(4) >>> 0;
  const desc = e.guest_alloc(20) >>> 0;
  const bufferOutput = e.guest_alloc(4) >>> 0;
  const caps = e.guest_alloc(20) >>> 0;
  const soundOutput = e.guest_alloc(4) >>> 0;
  const status = e.guest_alloc(4) >>> 0;
  const formatWa = wa(format);
  const outputWa = wa(output);
  const writtenWa = wa(written);
  const descWa = wa(desc);
  const bufferOutputWa = wa(bufferOutput);
  const capsWa = wa(caps);
  const soundOutputWa = wa(soundOutput);
  const statusWa = wa(status);

  assert.strictEqual(e.test_ds_create(soundOutput) >>> 0, 0);
  const sound = dv.getUint32(soundOutputWa, true);
  assert(sound, 'DirectSound fixture allocates');
  // Miles reads DSCAPS_EMULDRIVER (0x20) as "no real driver", drops
  // DirectSound for waveOut, and reports ~1.5s of latency that overflows
  // Bink's audio-buffer divide (Arcanum's first movie).
  const devCaps = e.guest_alloc(96) >>> 0;
  dv.setUint32(wa(devCaps), 96, true);
  assert.strictEqual(e.test_ds_get_caps(sound, devCaps) >>> 0, 0);
  const devFlags = dv.getUint32(wa(devCaps) + 4, true);
  assert.strictEqual(devFlags & 0x20, 0, 'the device is not an emulated driver');
  assert.strictEqual(devFlags & 0xa0a, 0xa0a,
    'primary and secondary stereo 16-bit are supported');
  const topLevel = e.test_ds_make_window(0x10000000, 0) >>> 0;
  const child = e.test_ds_make_window(0x50000000, topLevel) >>> 0;

  assert.strictEqual(e.test_ds_set_cooperative_level(sound, 0, 2) >>> 0,
    0x80070057, 'NULL is not a cooperative-level window');
  assert.strictEqual(e.test_ds_set_cooperative_level(sound, child, 2) >>> 0,
    0x80070057, 'DirectSound requires a top-level application window');
  assert.strictEqual(e.test_ds_set_cooperative_level(sound, topLevel, 0) >>> 0,
    0x80070057, 'zero is not a DSSCL value');
  assert.strictEqual(e.test_ds_set_cooperative_level(sound, topLevel, 5) >>> 0,
    0x80070057, 'unknown DSSCL values are rejected');

  assert.strictEqual(e.test_ds_set_cooperative_level(sound, topLevel, 1) >>> 0, 0,
    'DSSCL_NORMAL is accepted');
  assert.strictEqual(e.test_ds_compact(sound) >>> 0, 0x88780046,
    'Compact requires at least DSSCL_PRIORITY');
  dv.setUint32(descWa, 20, true);
  dv.setUint32(descWa + 4, 1, true); // DSBCAPS_PRIMARYBUFFER
  dv.setUint32(descWa + 8, 0, true); // required for a primary buffer
  dv.setUint32(descWa + 16, 0, true); // primary format is set separately
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0, 0);
  const buffer = dv.getUint32(bufferOutputWa, true);
  assert(buffer, 'DirectSound primary buffer fixture allocates');

  dv.setUint32(statusWa, 0xfeedface, true);
  assert.strictEqual(e.test_dsbuf_get_status(buffer, status) >>> 0, 0);
  assert.strictEqual(dv.getUint32(statusWa, true), 0,
    'a newly created primary buffer is stopped, not spuriously playing');

  assert.strictEqual(e.test_dsbuf_get_caps(buffer, caps) >>> 0, 0);
  assert.strictEqual(dv.getUint32(capsWa + 8, true), 0x10000,
    'primary buffer exposes device-owned backing storage despite dwBufferBytes=0');

  function writePcm(channels, rate, bits) {
    const align = channels * bits / 8;
    dv.setUint16(formatWa, 1, true);
    dv.setUint16(formatWa + 2, channels, true);
    dv.setUint32(formatWa + 4, rate, true);
    dv.setUint32(formatWa + 8, rate * align, true);
    dv.setUint16(formatWa + 12, align, true);
    dv.setUint16(formatWa + 14, bits, true);
    dv.setUint16(formatWa + 16, 0, true);
  }

  function readPcm() {
    return {
      tag: dv.getUint16(outputWa, true),
      channels: dv.getUint16(outputWa + 2, true),
      rate: dv.getUint32(outputWa + 4, true),
      average: dv.getUint32(outputWa + 8, true),
      align: dv.getUint16(outputWa + 12, true),
      bits: dv.getUint16(outputWa + 14, true),
      extra: dv.getUint16(outputWa + 16, true),
    };
  }

  writePcm(2, 44100, 16);
  assert.strictEqual(e.test_dsbuf_set_format(buffer, format) >>> 0, 0x88780046,
    'DSSCL_NORMAL cannot change the primary format');
  assert.strictEqual(e.test_ds_set_cooperative_level(sound, topLevel, 2) >>> 0, 0,
    'DSSCL_PRIORITY is accepted after buffers already exist');
  assert.strictEqual(e.test_ds_compact(sound) >>> 0, 0,
    'DSSCL_PRIORITY permits Compact');
  dv.setUint16(formatWa, 3, true); // WAVE_FORMAT_IEEE_FLOAT, not modeled here
  assert.strictEqual(e.test_dsbuf_set_format(buffer, format) >>> 0, 0x88780064,
    'unsupported primary formats fail with DSERR_BADFORMAT');
  writePcm(2, 44100, 16);
  assert.strictEqual(e.test_dsbuf_set_format(buffer, format) >>> 0, 0);
  new Uint8Array(memory.buffer).fill(0xcc, outputWa, outputWa + 18);
  dv.setUint32(writtenWa, 0, true);
  assert.strictEqual(e.test_dsbuf_get_format(buffer, output, 18, written) >>> 0, 0);
  assert.strictEqual(dv.getUint32(writtenWa, true), 18);
  assert.deepStrictEqual(readPcm(), {
    tag: 1, channels: 2, rate: 44100, average: 176400,
    align: 4, bits: 16, extra: 0,
  });

  // The NULL-output query reports the exact PCM WAVEFORMATEX allocation.
  dv.setUint32(writtenWa, 0, true);
  assert.strictEqual(e.test_dsbuf_get_format(buffer, 0, 0, written) >>> 0, 0);
  assert.strictEqual(dv.getUint32(writtenWa, true), 18);

  // Refuse a partial struct instead of overwriting the caller's allocation.
  new Uint8Array(memory.buffer).fill(0x5a, outputWa, outputWa + 18);
  assert.strictEqual(e.test_dsbuf_get_format(buffer, output, 17, written) >>> 0,
    0x80070057);
  assert.deepStrictEqual(Array.from(new Uint8Array(memory.buffer, outputWa, 18)),
    new Array(18).fill(0x5a));

  // A later primary-format change replaces all canonical PCM fields.
  writePcm(1, 22050, 8);
  assert.strictEqual(e.test_dsbuf_set_format(buffer, format) >>> 0, 0);
  assert.strictEqual(e.test_dsbuf_get_format(buffer, output, 18, written) >>> 0, 0);
  assert.deepStrictEqual(readPcm(), {
    tag: 1, channels: 1, rate: 22050, average: 22050,
    align: 1, bits: 8, extra: 0,
  });
  assert.strictEqual(e.test_dsbuf_set_format(buffer, 0) >>> 0, 0x80070057);

  assert.strictEqual(e.test_ds_set_cooperative_level(buffer, topLevel, 2) >>> 0,
    0x80070057, 'a DirectSoundBuffer is not a DirectSound device');

  // SetFormat is a primary-buffer operation. Secondary buffers receive their
  // immutable PCM format in DSBUFFERDESC instead.
  dv.setUint32(descWa + 4, 0, true);
  dv.setUint32(descWa + 8, 64, true);
  dv.setUint32(descWa + 16, format, true);
  dv.setUint32(bufferOutputWa, 0, true);
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0, 0);
  const secondary = dv.getUint32(bufferOutputWa, true);
  assert(secondary, 'secondary DirectSound buffer fixture allocates');
  assert.strictEqual(e.test_dsbuf_set_format(secondary, format) >>> 0, 0x88780032,
    'SetFormat rejects secondary buffers with DSERR_INVALIDCALL');
  dv.setUint32(descWa + 8, 0, true);
  dv.setUint32(bufferOutputWa, 0xfeedface, true);
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0,
    0x80070057, 'secondary buffers require non-empty storage');
  assert.strictEqual(dv.getUint32(bufferOutputWa, true), 0);
  dv.setUint32(descWa + 8, 64, true);
  dv.setUint32(descWa + 16, 0, true);
  dv.setUint32(bufferOutputWa, 0xfeedface, true);
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0,
    0x80070057, 'secondary buffers require a creation format');
  assert.strictEqual(dv.getUint32(bufferOutputWa, true), 0);

  // The primary descriptor contract is structural, not advisory. Failed
  // creation clears the caller's output and leaves the existing object intact.
  dv.setUint32(descWa + 4, 1, true);
  dv.setUint32(bufferOutputWa, 0xfeedface, true);
  dv.setUint32(descWa + 8, 64, true);
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0,
    0x80070057, 'primary buffers require dwBufferBytes == 0');
  assert.strictEqual(dv.getUint32(bufferOutputWa, true), 0);
  dv.setUint32(descWa + 8, 0, true);
  dv.setUint32(descWa + 16, format, true);
  dv.setUint32(bufferOutputWa, 0xfeedface, true);
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0,
    0x80070057, 'primary buffers require lpwfxFormat == NULL');
  assert.strictEqual(dv.getUint32(bufferOutputWa, true), 0);
  dv.setUint32(descWa + 16, 0, true);
  dv.setUint32(descWa + 12, 1, true);
  dv.setUint32(bufferOutputWa, 0xfeedface, true);
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0,
    0x80070057, 'DSBUFFERDESC.dwReserved must be zero');
  assert.strictEqual(dv.getUint32(bufferOutputWa, true), 0);
  dv.setUint32(descWa + 12, 0, true);
  dv.setUint32(descWa, 24, true);
  dv.setUint32(bufferOutputWa, 0xfeedface, true);
  assert.strictEqual(e.test_ds_create_buffer(sound, desc, bufferOutput) >>> 0,
    0x80070057, 'Win98 accepts only its 20- and 36-byte descriptor layouts');
  assert.strictEqual(dv.getUint32(bufferOutputWa, true), 0);

  assert.strictEqual(e.test_ds_set_cooperative_level(sound, topLevel, 3) >>> 0, 0,
    'DSSCL_EXCLUSIVE is accepted');
  assert.strictEqual(e.test_ds_set_cooperative_level(sound, topLevel, 4) >>> 0, 0,
    'DSSCL_WRITEPRIMARY is accepted by the modeled hardware primary ring');

  console.log('PASS DirectSound cooperative level gates primary-buffer format and Compact');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
