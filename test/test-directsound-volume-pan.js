'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');

const extraWat = String.raw`
  (func (export "ds_call") (param $id i32) (param $a i32) (param $b i32)
      (param $c i32) (param $d i32) (param $stack i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b)
      (local.get $c) (local.get $d) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`;

(async () => {
  const events = [];
  let nextVoice = 0;
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat,
    extraHostOverrides: {
      voice_open: () => { events.push(['open', ++nextVoice]); return nextVoice; },
      voice_set_volume_db: (id, value) => events.push(['volume', id, value]),
      voice_set_pan: (id, value) => events.push(['pan', id, value]),
      voice_play_ring: id => { events.push(['play', id]); return 0; },
      voice_stop: () => 0,
      voice_close: () => 0,
      voice_get_pos: () => 0,
    },
  });
  e.init_dx_com_thunks();
  const stack = e.guest_alloc(64), out = e.guest_alloc(16);
  const desc = e.guest_alloc(36), format = e.guest_alloc(20);
  function call(name, args, pop) {
    e.guest_write32(stack + pop, 0xdeadbeef);
    const result = e.ds_call(apis.find(a => a.name === name).id,
      ...Array.from({length: 4}, (_, i) => args[i] || 0), stack) >>> 0;
    assert.strictEqual(e.get_esp() >>> 0, stack + pop, name + ' stack');
    assert.strictEqual(e.guest_read32(stack + pop) >>> 0, 0xdeadbeef);
    return result;
  }
  const bufferCall = (method, obj, value = 0) =>
    call('IDirectSoundBuffer_' + method, [obj, value], ['Stop', 'Release'].includes(method) ? 8 : 12);
  assert.strictEqual(call('DirectSoundCreate', [0, out, 0], 16), 0);
  const root = e.guest_read32(out);
  [0x00010001, 22050, 44100, 0x00100002, 0].forEach((v, i) => e.guest_write32(format + 4*i, v));
  function create(caps) {
    [20, caps, 64, 0, format].forEach((v, i) => e.guest_write32(desc + 4*i, v));
    assert.strictEqual(call('IDirectSound_CreateSoundBuffer', [root, desc, out, 0], 20), 0);
    return e.guest_read32(out);
  }
  function get(method, obj, expected) {
    e.guest_write32(out, 0x12345678);
    e.guest_write32(out + 4, 0xcafebabe);
    assert.strictEqual(bufferCall('Get' + method, obj, out), 0);
    assert.strictEqual(e.guest_read32(out) | 0, expected);
    assert.strictEqual(e.guest_read32(out + 4) >>> 0, 0xcafebabe);
  }
  const original = create(0xc0); // CTRLVOLUME | CTRLPAN
  get('Volume', original, 0); get('Pan', original, 0);
  assert.strictEqual(bufferCall('SetVolume', original, -2400), 0);
  assert.strictEqual(bufferCall('SetPan', original, 870), 0);
  get('Volume', original, -2400); get('Pan', original, 870);
  // DWORD output straddles non-adjacent physical pages: no translate-once store.
  const base = 0x30000000;
  for (const address of [base, base + 0x8000, base + 4096]) {
    assert.strictEqual(e.test_virtual_map_commit(address, 4096) >>> 0, address);
  }
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  for (const [method, expected] of [['Volume', -2400], ['Pan', 870]]) {
    e.guest_write8(base + 4093, 0xa5); e.guest_write8(base + 4098, 0x5a);
    assert.strictEqual(bufferCall('Get' + method, original, base + 4094), 0);
    assert.strictEqual(e.guest_read32(base + 4094) | 0, expected);
    assert.strictEqual(e.guest_read8(base + 4093), 0xa5);
    assert.strictEqual(e.guest_read8(base + 4098), 0x5a);
  }
  assert.deepStrictEqual(events, [], 'controls do not allocate or play a voice');
  assert.strictEqual(call('IDirectSound_DuplicateSoundBuffer', [root, original, out], 16), 0);
  const duplicate = e.guest_read32(out);
  get('Volume', duplicate, -2400); get('Pan', duplicate, 870);
  assert.strictEqual(bufferCall('SetPan', duplicate, -600), 0);
  get('Pan', original, 870);
  for (const [obj, pan] of [[original, 870], [duplicate, -600]]) {
    assert.strictEqual(call('IDirectSoundBuffer_Play', [obj, 0, 0, 1], 20), 0);
    const id = nextVoice;
    assert.deepStrictEqual(events.splice(0), [
      ['open', id], ['volume', id, -2400], ['pan', id, pan], ['play', id],
    ], 'lazy voice inherits controls before playback');
  }
  for (const [method, values] of [['Volume', [-10000, -1, 0]], ['Pan', [-10000, 0, 10000]]]) {
    for (const value of values) {
      assert.strictEqual(bufferCall('Set' + method, original, value), 0);
      get(method, original, value);
      assert.deepStrictEqual(events.pop(), [method.toLowerCase(), 1, value]);
    }
    for (const value of (method === 'Volume' ? [-10001, 1, 0x80000000] : [-10001, 10001, 0x7fffffff])) {
      assert.strictEqual(bufferCall('Set' + method, original, value), 0x80070057);
      get(method, original, values.at(-1));
      assert.deepStrictEqual(events, [], 'rejection does not touch host');
    }
    assert.strictEqual(bufferCall('Get' + method, original, 0), 0x80070057);
  }
  const noControls = create(0);
  for (const method of ['Volume', 'Pan']) {
    e.guest_write32(out, 0x12345678);
    assert.strictEqual(bufferCall('Get' + method, noControls, out), 0x8878001e);
    assert.strictEqual(e.guest_read32(out), 0x12345678);
    assert.strictEqual(bufferCall('Set' + method, noControls, 0), 0x8878001e);
    assert.strictEqual(bufferCall('Set' + method, root, 0), 0x80070057);
  }
  for (const [caps, allowed, denied] of [[0x80, 'Volume', 'Pan'], [0x40, 'Pan', 'Volume']]) {
    const obj = create(caps);
    assert.strictEqual(bufferCall('Set' + allowed, obj, -600), 0);
    get(allowed, obj, -600);
    assert.strictEqual(bufferCall('Set' + denied, obj, 0), 0x8878001e);
    assert.strictEqual(bufferCall('Release', obj), 0);
  }
  const spatial = create(0x90); // CTRL3D | CTRLVOLUME
  assert.strictEqual(bufferCall('SetPan', spatial, 0), 0x8878001e);
  assert.strictEqual(bufferCall('SetVolume', spatial, -500), 0);
  get('Volume', spatial, -500);
  assert.strictEqual(bufferCall('Release', spatial), 0);
  assert.strictEqual(bufferCall('Stop', original), 0);
  get('Volume', original, 0); get('Pan', original, 10000);
  assert.strictEqual(call('IDirectSoundBuffer_Play', [original, 0, 0, 0], 20), 0);
  assert.deepStrictEqual(events.splice(0), [['play', 1]], 'restart retains the existing voice');
  for (const obj of [original, duplicate, noControls]) assert.strictEqual(bufferCall('Release', obj), 0);
  const fresh = create(0xc0);
  get('Volume', fresh, 0); get('Pan', fresh, 0);
  console.log('PASS DirectSound volume/pan state, lazy playback, duplication, validation, stack and slot reuse');
})().catch(error => { console.error(error); process.exitCode = 1; });
