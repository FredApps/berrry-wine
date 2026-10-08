#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { hasPageScript } = require('./browser-runtime-scripts');

const ROOT = path.join(__dirname, '..');
const hostSource = fs.readFileSync(path.join(ROOT, 'host.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(ROOT, 'lib', 'browser-shell.js'), 'utf8');
const apps = require(path.join(ROOT, 'lib', 'apps.js')).APPS;
const context = { console };
vm.runInNewContext(hostSource + '\n;globalThis.WineAssembly = WineAssembly;', context);

const wine = new context.WineAssembly();

// COMI's main-thread wait can outlast one PCM buffer. Its reviewed matched
// run demonstrated why the independent timer default must reach the guest.
// Execute the actual launcher policy and pre-Worker boot block, not a copy
// of their boolean expressions. WASM is represented only by its setter sink.
function uniqueSlice(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0 && source.indexOf(start, a + start.length) < 0, 'unique source start');
  const b = source.indexOf(end, a + start.length);
  assert(b > a, 'source end exists');
  return source.slice(a, b);
}
const launchPolicy = uniqueSlice(shellSource,
  'wine.asyncMultimediaTimer = !!app.asyncMultimediaTimer;',
  'wine.x87Fusion = app.x87Fusion !== false;');
const bootPolicy = uniqueSlice(hostSource,
  '// ?mm-thread[=0] and ?async-mm[=0] override',
  'this._wasmModule = wasmModule;');
function configuredTimerMode(app, query = '') {
  const configured = new context.WineAssembly();
  const calls = [];
  configured.instance = { exports: { set_mm_timer_thread_mode(value) { calls.push(value); } } };
  vm.runInNewContext(launchPolicy, { wine: configured, app });
  vm.runInNewContext('(function(){' + bootPolicy + '\n}).call(wine)',
    { wine: configured, URLSearchParams, location: { search: query } });
  assert.strictEqual(calls.length, 1, 'one process-wide mode setting before Worker startup');
  return calls[0];
}
assert.strictEqual(wine.mmTimerThread, true, 'direct host construction defaults to independent timer thread');
assert.strictEqual(configuredTimerMode(apps.curse_monkey_island_demo), 1,
  'actual COMI registry launch installs independent timer delivery');
assert.strictEqual(configuredTimerMode({}), 1, 'absent app option preserves default');
assert.strictEqual(configuredTimerMode({ mmTimerThread: false }), 0, 'explicit app opt-out is honored');
assert.strictEqual(configuredTimerMode(apps.curse_monkey_island_demo, '?mm-thread=0'), 0,
  'explicit diagnostic query disables timer thread');
assert.strictEqual(configuredTimerMode({ mmTimerThread: false }, '?mm-thread=1'), 1,
  'explicit query overrides app opt-out');

let calls = 0;
wine.instance = {
  exports: {
    get_eip: () => 0x00401000,
    fire_mm_timer: () => { calls++; return 1; },
  },
};

assert.strictEqual(wine._pumpMultimediaTimer(), 0,
  'multimedia timer pumping is disabled unless the app opts in');
assert.strictEqual(calls, 0, 'disabled timer delivery must not call into WASM');

wine.asyncMultimediaTimer = true;
assert.strictEqual(wine._pumpMultimediaTimer(), 1,
  'an opted-in app pumps the cooperative multimedia callback');
assert.strictEqual(calls, 1, 'the browser calls the existing WASM timer hook once');

wine.instance.exports.get_eip = () => 0;
assert.strictEqual(wine._pumpMultimediaTimer(), 0,
  'an exited guest cannot receive a multimedia callback');
assert.strictEqual(calls, 1, 'the exited guest did not call the timer hook');

let mainSuspended = true;
wine.threadManager = {
  isMainThreadSuspended: () => mainSuspended,
};
wine.instance.exports.is_mm_timer_callback_active = () => 0;
assert.strictEqual(wine._isMainExecutionSuspended(), true,
  'ordinary suspended application code remains parked');
wine.instance.exports.is_mm_timer_callback_active = () => 1;
assert.strictEqual(wine._isMainExecutionSuspended(), false,
  'a serialized multimedia-timer context can run until it resumes the application thread');
mainSuspended = false;
assert.strictEqual(wine._isMainExecutionSuspended(), false,
  'an active application thread is never reported as suspended');

let closedHandle = 0;
wine.threadManager = {
  closeSyncHandle: handle => {
    closedHandle = handle >>> 0;
    return true;
  },
};
assert.strictEqual(wine._closeSyncHandle(0xE0007), true,
  'the browser delegates synchronization CloseHandle calls to ThreadManager');
assert.strictEqual(closedHandle, 0xE0007,
  'the browser preserves the process synchronization handle value');
assert(hostSource.includes('closeSyncHandle: handle => self._closeSyncHandle(handle)'),
  'browser filesystem imports expose the synchronization close callback');

assert.strictEqual(apps.diablo_demo.asyncMultimediaTimer, true,
  'Diablo opts into out-of-message-loop timeSetEvent delivery');
assert(shellSource.includes('wine.asyncMultimediaTimer = !!app.asyncMultimediaTimer'),
  'the browser launcher passes the per-app timer policy to WineAssembly');
assert(hostSource.includes('self._pumpMultimediaTimer();'),
  'the browser run loop pumps the opted-in timer after each main slice');
assert(hasPageScript('lib/apps.js'),
  'the browser centrally versions per-app launch metadata');
assert(hasPageScript('lib/browser-shell.js'),
  'the browser centrally versions per-app timer policy wiring');

console.log('PASS  browser multimedia timer delivery is isolated and per-app');
