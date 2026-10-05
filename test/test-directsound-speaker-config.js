#!/usr/bin/env node
'use strict';

// IDirectSound speaker configuration is device state on Windows 98, not a
// write-only hint. Exercise initialized and COM-created roots independently so
// zero (DSSPEAKER_DIRECTOUT) cannot be confused with "not initialized".

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const extraWat = String.raw`
  (func (export "test_ds_create") (param $output i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_DirectSoundCreate
      (i32.const 0) (local.get $output) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ds_create_raw") (param $type i32) (result i32)
    (call $dx_create_com_obj (local.get $type) (global.get $DX_VTBL_DSOUND)))

  (func (export "test_ds_get_speaker")
      (param $this i32) (param $output i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectSound_GetSpeakerConfig
      (local.get $this) (local.get $output)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ds_set_speaker")
      (param $this i32) (param $config i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectSound_SetSpeakerConfig
      (local.get $this) (local.get $config)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ds_initialize") (param $this i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectSound_Initialize
      (local.get $this) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

async function main() {
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

  const output = e.guest_alloc(4) >>> 0;
  const soundOutput = e.guest_alloc(4) >>> 0;
  assert.strictEqual(e.test_ds_create(soundOutput) >>> 0, 0);
  assert.strictEqual(e.test_esp() >>> 0, 0x30010,
    'DirectSoundCreate consumes return address and three arguments');
  const sound = e.guest_read32(soundOutput) >>> 0;
  assert(sound, 'DirectSoundCreate returns a live initialized root');

  assert.strictEqual(e.test_ds_get_speaker(sound, output) >>> 0, 0);
  assert.strictEqual(e.test_esp() >>> 0, 0x3000c,
    'GetSpeakerConfig consumes return address, this, and output');
  assert.strictEqual(e.guest_read32(output) >>> 0, 0x00140004,
    'the default is packed DSSPEAKER_STEREO with WIDE geometry');

  for (const config of [
    0x00000000, // DSSPEAKER_DIRECTOUT: proves zero is retained as real state
    0x00000001, // DSSPEAKER_HEADPHONE
    0x00000002, // DSSPEAKER_MONO
    0x00000003, // DSSPEAKER_QUAD
    0x00000005, // DSSPEAKER_SURROUND
    0x00000006, // DSSPEAKER_5POINT1
    0x00000007, // DSSPEAKER_7POINT1
    0x00050004, // stereo, MIN geometry
    0x000a0004, // stereo, NARROW geometry
    0x00140004, // stereo, WIDE geometry
    0x00b40004, // stereo, MAX geometry
  ]) {
    assert.strictEqual(e.test_ds_set_speaker(sound, config) >>> 0, 0,
      `SetSpeakerConfig accepts 0x${config.toString(16)}`);
    assert.strictEqual(e.test_esp() >>> 0, 0x3000c,
      'SetSpeakerConfig keeps its two-argument stdcall ABI');
    e.guest_write32(output, 0xfeedface);
    assert.strictEqual(e.test_ds_get_speaker(sound, output) >>> 0, 0);
    assert.strictEqual(e.guest_read32(output) >>> 0, config,
      'GetSpeakerConfig returns the configuration stored on this root');
  }

  assert.strictEqual(e.test_ds_set_speaker(sound, 4) >>> 0, 0);
  assert.strictEqual(e.test_ds_get_speaker(sound, output) >>> 0, 0);
  assert.strictEqual(e.guest_read32(output) >>> 0, 0x00140004,
    'plain stereo assumes the documented WIDE geometry');

  for (const config of [
    0x00000008, // Vista-era 7.1 SURROUND, not a Win98 configuration
    0x00000009, // Vista-era 5.1 SURROUND
    0x00010004, // unknown stereo geometry
    0x00140003, // geometry is valid only with stereo
    0x00000104, // reserved byte
    0x01000004, // reserved high byte
  ]) {
    assert.strictEqual(e.test_ds_set_speaker(sound, config) >>> 0, 0x80070057,
      `invalid Win98 speaker configuration 0x${config.toString(16)} is rejected`);
  }
  assert.strictEqual(e.test_ds_get_speaker(sound, output) >>> 0, 0);
  assert.strictEqual(e.guest_read32(output) >>> 0, 0x00140004,
    'failed SetSpeakerConfig calls leave prior device state intact');

  assert.strictEqual(e.test_ds_get_speaker(sound, 0) >>> 0, 0x80070057,
    'GetSpeakerConfig rejects a null output pointer');

  const uninitialized = e.test_ds_create_raw(4) >>> 0;
  assert(uninitialized, 'raw type-4 object models the CoCreateInstance state');
  e.guest_write32(output, 0xfeedface);
  assert.strictEqual(e.test_ds_get_speaker(uninitialized, output) >>> 0, 0x887800aa);
  assert.strictEqual(e.guest_read32(output) >>> 0, 0xfeedface,
    'an uninitialized query does not modify its output');
  assert.strictEqual(e.test_ds_set_speaker(uninitialized, 3) >>> 0, 0x887800aa);
  assert.strictEqual(e.test_ds_initialize(uninitialized) >>> 0, 0);
  assert.strictEqual(e.test_esp() >>> 0, 0x3000c,
    'Initialize consumes return address, this, and GUID');
  assert.strictEqual(e.test_ds_get_speaker(uninitialized, output) >>> 0, 0);
  assert.strictEqual(e.guest_read32(output) >>> 0, 0x00140004,
    'Initialize installs the default speaker state');
  assert.strictEqual(e.test_ds_initialize(uninitialized) >>> 0, 0x88780082,
    'Initialize reports DSERR_ALREADYINITIALIZED after success');
  assert.strictEqual(e.test_ds_initialize(sound) >>> 0, 0x88780082,
    'DirectSoundCreate objects are already initialized');

  const nonSound = e.test_ds_create_raw(5) >>> 0;
  e.guest_write32(output, 0xfeedface);
  assert.strictEqual(e.test_ds_get_speaker(nonSound, output) >>> 0, 0x80070057,
    'a live DirectSoundBuffer is not a DirectSound root');
  assert.strictEqual(e.guest_read32(output) >>> 0, 0xfeedface);
  assert.strictEqual(e.test_ds_set_speaker(nonSound, 4) >>> 0, 0x80070057);
  assert.strictEqual(e.test_ds_initialize(nonSound) >>> 0, 0x80070057);

  console.log('PASS DirectSound speaker configuration is validated root state');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
