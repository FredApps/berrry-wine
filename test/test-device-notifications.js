#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { createAudioHost } = require('../lib/host-audio');
const apiTable = require('../src/api_table.json');

const AUDIO_GUID = [0x6994ad04, 0x11d093ef, 0xa000cca3, 0x963122c9];
const OTHER_GUID = [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00];

const extraWat = String.raw`
  (global $devnotify_test_delta (mut i32) (i32.const 0))

  (func (export "devnotify_register")
      (param $stack i32) (param $hwnd i32) (param $filter i32)
      (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_RegisterDeviceNotificationW
      (local.get $hwnd) (local.get $filter) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $devnotify_test_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $stack)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "devnotify_unregister")
      (param $stack i32) (param $handle i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_UnregisterDeviceNotification
      (local.get $handle) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $devnotify_test_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $stack)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "devnotify_delta") (result i32)
    (global.get $devnotify_test_delta))
  (func (export "devnotify_last_error") (result i32)
    (global.get $last_error))

  (func (export "devnotify_make_window") (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x10000000)))
    (local.get $hwnd))

  (func (export "devnotify_make_filter")
      (param $size i32) (param $type i32)
      (param $g0 i32) (param $g1 i32) (param $g2 i32) (param $g3 i32)
      (result i32)
    (local $filter i32)
    (local.set $filter (call $heap_alloc (i32.const 32)))
    (call $gs32 (local.get $filter) (local.get $size))
    (call $gs32 (i32.add (local.get $filter) (i32.const 4)) (local.get $type))
    (call $gs32 (i32.add (local.get $filter) (i32.const 8)) (i32.const 0))
    (call $gs32 (i32.add (local.get $filter) (i32.const 12)) (local.get $g0))
    (call $gs32 (i32.add (local.get $filter) (i32.const 16)) (local.get $g1))
    (call $gs32 (i32.add (local.get $filter) (i32.const 20)) (local.get $g2))
    (call $gs32 (i32.add (local.get $filter) (i32.const 24)) (local.get $g3))
    (call $gs32 (i32.add (local.get $filter) (i32.const 28)) (i32.const 0))
    (local.get $filter))

  (func (export "devnotify_free") (param $ptr i32)
    (call $heap_free (local.get $ptr)))

  (func (export "devnotify_record_word")
      (param $handle i32) (param $offset i32) (result i32)
    (local $rec i32)
    (local.set $rec (call $device_notify_record_from_handle (local.get $handle)))
    (if (i32.eqz (local.get $rec)) (then (return (i32.const 0))))
    (i32.load (i32.add (local.get $rec) (local.get $offset))))

  (func (export "devnotify_make_forged_handle") (result i32)
    (local $ptr i32)
    (local.set $ptr (call $heap_alloc (i32.const 48)))
    (call $gs32 (local.get $ptr) (i32.const 0xFD000020))
    (local.get $ptr))

  (export "devnotify_sparse_map" (func $virtual_map_commit))
  (export "devnotify_g2w" (func $g2w))
`;

function makeFilter(e, words = AUDIO_GUID, size = 32, type = 5) {
  return e.devnotify_make_filter(size, type, ...words) >>> 0;
}

function writeDword(e, address, value) {
  for (let i = 0; i < 4; i++) e.guest_write8(address + i, value >>> (i * 8));
}

class FakeMediaDevices {
  constructor(devices) {
    this.devices = devices.slice();
    this.listeners = new Set();
    this.rejectOnce = false;
  }
  enumerateDevices() {
    if (this.rejectOnce) {
      this.rejectOnce = false;
      return Promise.reject(new Error('permission transition'));
    }
    return Promise.resolve(this.devices.map(device => ({ ...device })));
  }
  addEventListener(type, fn) {
    if (type === 'devicechange') this.listeners.add(fn);
  }
  removeEventListener(type, fn) {
    if (type === 'devicechange') this.listeners.delete(fn);
  }
  emit() {
    for (const fn of Array.from(this.listeners)) fn({ type: 'devicechange' });
  }
}

function makeAudioHost(mediaDevices, events, threadId = 0) {
  const ctx = {
    threadId,
    mediaDevices,
    sharedAudio: {},
    exports: { device_notify_audio_change: event => events.push(event >>> 0) },
  };
  const audio = createAudioHost(ctx, {
    readStr: () => '',
    readStrW: () => '',
    readVfsFile: () => null,
    readVfsFileAsync: () => Promise.resolve(null),
    profileNow: () => 0,
    profileEvent: () => {},
    getHost: () => ({}),
  });
  return { ctx, audio };
}

(async () => {
  for (const [name, nargs] of [
    ['RegisterDeviceNotificationW', 3],
    ['UnregisterDeviceNotification', 1],
  ]) {
    const row = apiTable.find(entry => entry.name === name);
    assert(row, `${name} is registered`);
    assert.strictEqual(row.nargs, nargs, `${name} keeps its documented ABI`);
    assert.strictEqual(row.convention, 'stdcall');
    assert.strictEqual(row.stub, undefined, `${name} is not a metadata stub`);
  }

  const first = await bootRenderHarness({ extraWat, fonts: 'none' });
  const second = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    memory: first.memory,
  });
  const a = first.exports;
  const b = second.exports;
  const stack = 0x074ff000;
  const hwnd = a.devnotify_make_window() >>> 0;
  const audioFilter = makeFilter(a);

  assert.strictEqual(a.devnotify_register(stack, 0x12345678, audioFilter, 0), 0,
    'registration rejects an invalid recipient window');
  assert.strictEqual(a.devnotify_last_error(), 1400,
    'bad recipient reports ERROR_INVALID_WINDOW_HANDLE');
  assert.strictEqual(a.devnotify_delta(), 16,
    'RegisterDeviceNotificationW pops return address plus three arguments');
  assert.strictEqual(a.devnotify_register(stack, hwnd, 0, 0), 0,
    'registration rejects a NULL filter');
  assert.strictEqual(a.devnotify_last_error(), 87);
  assert.strictEqual(a.devnotify_register(stack, hwnd, audioFilter, 1), 0,
    'the unsupported service-handle form is rejected honestly');
  assert.strictEqual(a.devnotify_last_error(), 87);
  const shortFilter = makeFilter(a, AUDIO_GUID, 28, 5);
  assert.strictEqual(a.devnotify_register(stack, hwnd, shortFilter, 0), 0,
    'a truncated DEVICEINTERFACE filter is rejected');
  const wrongType = makeFilter(a, AUDIO_GUID, 32, 2);
  assert.strictEqual(a.devnotify_register(stack, hwnd, wrongType, 0), 0,
    'unsupported DEV_BROADCAST_HANDLE filters are rejected');
  a.devnotify_free(shortFilter);
  a.devnotify_free(wrongType);

  const sparseBase = 0x30000000;
  assert.strictEqual(a.devnotify_sparse_map(sparseBase, 0x1000) >>> 0, sparseBase);
  assert.strictEqual(a.devnotify_sparse_map(0x28000000, 0x3000) >>> 0, 0x28000000);
  assert.strictEqual(a.devnotify_sparse_map(sparseBase + 0x1000, 0x1000) >>> 0,
    sparseBase + 0x1000);
  assert.notStrictEqual(
    (a.devnotify_g2w(sparseBase + 0xfff) + 1) >>> 0,
    a.devnotify_g2w(sparseBase + 0x1000) >>> 0,
    'fixture places adjacent sparse guest pages in non-affine backing');
  const sparseFilter = sparseBase + 0xff0;
  [32, 5, 0, ...AUDIO_GUID, 0].forEach((word, index) =>
    writeDword(a, sparseFilter + index * 4, word));
  const audioHandle = a.devnotify_register(stack, hwnd, sparseFilter, 0) >>> 0;
  assert.strictEqual(audioHandle >>> 24, 0xfd,
    'a non-affine sparse filter produces an opaque HDEVNOTIFY');
  assert.deepStrictEqual(
    [16, 20, 24, 28].map(offset => a.devnotify_record_word(audioHandle, offset) >>> 0),
    AUDIO_GUID,
    'the interface class GUID is copied by value into private shared state');
  writeDword(a, sparseFilter + 12, OTHER_GUID[0]);

  a.set_post_queue_count(0);
  assert.strictEqual(a.device_notify_audio_change(0x8000), 1,
    'an audio arrival reaches the matching registered HWND');
  assert.strictEqual(a.post_queue_depth(), 1);
  assert.strictEqual(a.post_queue_peek(0, 0) >>> 0, hwnd);
  assert.strictEqual(a.post_queue_peek(0, 1), 0x0219, 'message is WM_DEVICECHANGE');
  assert.strictEqual(a.post_queue_peek(0, 2) >>> 0, 0x8000, 'wParam is DBT_DEVICEARRIVAL');
  const payload = a.post_queue_peek(0, 3) >>> 0;
  assert(payload, 'lParam names a guest-readable event payload');
  assert.deepStrictEqual(
    Array.from({ length: 8 }, (_, i) => a.guest_read32(payload + i * 4) >>> 0),
    [32, 5, 0, ...AUDIO_GUID, 0],
    'lParam is a complete DEV_BROADCAST_DEVICEINTERFACE_W for KSCATEGORY_AUDIO');

  const otherFilter = makeFilter(a, OTHER_GUID);
  const otherHandle = a.devnotify_register(stack, hwnd, otherFilter, 0) >>> 0;
  const allFilter = makeFilter(a, OTHER_GUID);
  const allHandle = a.devnotify_register(stack, hwnd, allFilter, 4) >>> 0;
  assert(otherHandle && allHandle);
  a.set_post_queue_count(0);
  assert.strictEqual(a.device_notify_audio_change(0x8004), 2,
    'class-specific and ALL_INTERFACE_CLASSES records receive removal');
  assert.strictEqual(a.post_queue_depth(), 2,
    'the unrelated class-specific record is filtered out');
  assert.deepStrictEqual([0, 1].map(i => a.post_queue_peek(i, 2) >>> 0),
    [0x8004, 0x8004]);
  a.set_post_queue_count(0);
  assert.strictEqual(a.device_notify_audio_change(0x1234), 0,
    'undocumented browser event codes are not injected');
  assert.strictEqual(a.post_queue_depth(), 0);

  assert.strictEqual(b.devnotify_record_word(audioHandle, 0) >>> 0, audioHandle,
    'another Worker-style WASM instance sees shared registration state');
  assert.strictEqual(b.devnotify_unregister(stack, audioHandle), 1,
    'another process thread can retire the exact live HDEVNOTIFY');
  assert.strictEqual(a.guest_read32(payload), 32,
    'an already-queued WM_DEVICECHANGE keeps its lParam payload after unregister');
  assert.strictEqual(a.guest_read32(payload + 12) >>> 0, AUDIO_GUID[0]);
  assert.strictEqual(b.devnotify_delta(), 8,
    'UnregisterDeviceNotification pops return address plus one argument');
  assert.strictEqual(a.devnotify_unregister(stack, audioHandle), 0,
    'a consumed HDEVNOTIFY cannot be unregistered twice');
  assert.strictEqual(a.devnotify_last_error(), 6,
    'stale handles report ERROR_INVALID_HANDLE');
  const replacement = a.devnotify_register(stack, hwnd, audioFilter, 0) >>> 0;
  assert.notStrictEqual(replacement, audioHandle,
    'slot reuse advances the public handle generation');
  assert.strictEqual(a.devnotify_unregister(stack, audioHandle), 0,
    'the old generation cannot consume its replacement');
  const forged = a.devnotify_make_forged_handle() >>> 0;
  assert.strictEqual(a.devnotify_unregister(stack, forged), 0,
    'ordinary heap bytes cannot forge registration ownership');
  a.devnotify_free(forged);
  assert.strictEqual(a.devnotify_unregister(stack, 0), 0);
  assert.strictEqual(a.devnotify_unregister(stack, replacement), 1);
  assert.strictEqual(a.devnotify_unregister(stack, otherHandle), 1);
  assert.strictEqual(a.devnotify_unregister(stack, allHandle), 1);

  const capacity = Array.from({ length: 32 }, () =>
    a.devnotify_register(stack, hwnd, audioFilter, 0) >>> 0);
  assert(capacity.every(Boolean));
  assert.strictEqual(new Set(capacity).size, 32,
    'all registration slots publish distinct handles');
  assert.strictEqual(a.devnotify_register(stack, hwnd, audioFilter, 0), 0,
    'a full table fails instead of overwriting a live registration');
  assert.strictEqual(a.devnotify_last_error(), 8,
    'table exhaustion reports ERROR_NOT_ENOUGH_MEMORY');
  for (const handle of capacity) assert.strictEqual(b.devnotify_unregister(stack, handle), 1);
  a.devnotify_free(audioFilter);
  a.devnotify_free(otherFilter);
  a.devnotify_free(allFilter);

  const mediaDevices = new FakeMediaDevices([
    { kind: 'audioinput', deviceId: 'mic-a' },
    { kind: 'videoinput', deviceId: 'camera-a' },
  ]);
  const eventsA = [];
  const eventsB = [];
  const eventsWorker = [];
  const hostA = makeAudioHost(mediaDevices, eventsA);
  const hostB = makeAudioHost(mediaDevices, eventsB);
  const workerHost = makeAudioHost(mediaDevices, eventsWorker, 2);
  await Promise.all([
    hostA.audio.deviceNotificationsReady,
    hostB.audio.deviceNotificationsReady,
    workerHost.audio.deviceNotificationsReady,
  ]);
  assert.strictEqual(mediaDevices.listeners.size, 1,
    'all process hosts share one native devicechange listener');
  assert.deepStrictEqual(eventsA, [], 'initial enumeration is not a synthetic arrival');

  mediaDevices.devices.push({ kind: 'audiooutput', deviceId: 'speaker-a' });
  mediaDevices.emit();
  await Promise.all([hostA.audio.flushDeviceNotifications(), hostB.audio.flushDeviceNotifications()]);
  assert.deepStrictEqual(eventsA, [0x8000]);
  assert.deepStrictEqual(eventsB, [0x8000]);
  assert.deepStrictEqual(eventsWorker, [], 'worker import closures never duplicate delivery');

  mediaDevices.devices.push({ kind: 'videoinput', deviceId: 'camera-b' });
  mediaDevices.emit();
  await hostA.audio.flushDeviceNotifications();
  assert.deepStrictEqual(eventsA, [0x8000], 'video-only changes are ignored');

  mediaDevices.devices = [
    { kind: 'audiooutput', deviceId: 'speaker-b' },
    { kind: 'videoinput', deviceId: 'camera-b' },
  ];
  mediaDevices.emit();
  await hostA.audio.flushDeviceNotifications();
  assert.deepStrictEqual(eventsA, [0x8000, 0x8004, 0x8000],
    'audio replacement is reported as removal followed by arrival');

  mediaDevices.rejectOnce = true;
  mediaDevices.emit();
  await hostA.audio.flushDeviceNotifications();
  assert.deepStrictEqual(eventsA, [0x8000, 0x8004, 0x8000],
    'enumeration failure emits no speculative notification');

  hostA.ctx.stopAudio();
  assert.strictEqual(mediaDevices.listeners.size, 1,
    'the shared listener remains while another process subscribes');
  hostB.ctx.stopAudio();
  workerHost.ctx.stopAudio();
  assert.strictEqual(mediaDevices.listeners.size, 0,
    'the last process teardown removes the native listener');

  console.log('PASS  HDEVNOTIFY lifecycle, KSCATEGORY_AUDIO delivery, and browser device diffs are real');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
