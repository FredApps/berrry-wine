#!/usr/bin/env node
'use strict';

// The page keeps ONE current input event (host.js `_lastInputEvent`) for every
// guest thread, and a Worker thread reads that event's lParam/wParam/hwnd with
// separate RPCs after the check_input that took it. Another thread's empty
// poll in between clears the event, so the reader used to get 0.
//
// That is what left Moorhuhn stuck with its main thread in a Worker: its
// WinSock thread polls check_input too, every keyup reached the game's
// WH_KEYBOARD hook with lParam 0 -- which the hook reads as a key press -- and
// Space never came up. The broker now saves each slot's event when its
// check_input takes one and swaps it back in around that slot's reads.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const RPC = require('../lib/guest-rpc');

const hostSource = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
assert(/Object\.defineProperty\(h, 'inputEventScope'[\s\S]*?self\._lastInputEvent[\s\S]*?_activeInputEvent/.test(hostSource),
  'host.js exposes the input-event save/restore scope the broker swaps per slot');

const KEYUP_LPARAM = 0xc0390001 | 0;   // Space released: transition + previous
const MOUSE_HWND = 0x10002;

// The host's semantics, reduced to what matters: one current event, taken by
// whichever thread polls first and cleared by any empty poll.
const renderer = { inputQueue: [], _activeInputEvent: null };
const hostState = { last: null };
const table = {
  check_input: () => {
    const evt = renderer.inputQueue.shift() || null;
    if (!evt) {
      hostState.last = null;
      renderer._activeInputEvent = null;
      return 0;
    }
    hostState.last = evt;
    renderer._activeInputEvent = evt;
    return (evt.wParam << 16) | (evt.msg & 0xffff);
  },
  check_input_lparam: () => (hostState.last ? hostState.last.lParam | 0 : 0),
  check_input_wparam: () => (hostState.last ? hostState.last.wParam | 0 : 0),
  check_input_hwnd: () => (hostState.last ? hostState.last.hwnd | 0 : 0),
};
Object.defineProperty(table, 'inputEventScope', {
  enumerable: false,
  value: {
    save: () => [hostState.last, renderer._activeInputEvent],
    restore: saved => { hostState.last = saved[0]; renderer._activeInputEvent = saved[1]; },
  },
});

const sigs = {
  check_input: { params: [], results: ['i32'] },
  check_input_lparam: { params: [], results: ['i32'] },
  check_input_wparam: { params: [], results: ['i32'] },
  check_input_hwnd: { params: ['i32'], results: ['i32'] },
};
const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
const broker = RPC.createMainBroker(memory, table, sigs, {});
// Serve each request synchronously: the worker side then finds its answer
// already published and never parks.
const workerFor = slot => RPC.createWorkerImports(memory, sigs, message => {
  if (message.t === 'rpc') broker.serveRpc(message.slot);
}, { slot }).imports.host;
const mainThread = workerFor(0);
const sibling = workerFor(1);

// Both threads see input pending, so both polls go to the page.
broker.publish({ inputPending: 1 });
renderer.inputQueue.push({ msg: 0x0101, wParam: 0x20, lParam: KEYUP_LPARAM, hwnd: 0 });
assert.strictEqual(mainThread.check_input() >>> 0, ((0x20 << 16) | 0x0101) >>> 0,
  'the main thread takes the keyup');
assert.strictEqual(sibling.check_input(), 0,
  'the sibling thread polls an empty queue and the host clears its event');
assert.strictEqual(hostState.last, null, 'the shared host event really was cleared');
assert.strictEqual(mainThread.check_input_lparam(), KEYUP_LPARAM,
  'the main thread still reads ITS keyup lParam, transition bit set');
assert.strictEqual(mainThread.check_input_wparam(), 0x20,
  'and its wParam');
assert.strictEqual(hostState.last, null,
  'the swap puts the outer (cleared) event back afterwards');

// A later event taken by the sibling does not bleed into the main thread's
// reads, and each thread's hwnd is its own.
renderer.inputQueue.push({ msg: 0x0201, wParam: 1, lParam: 0x00640032, hwnd: MOUSE_HWND });
assert.notStrictEqual(sibling.check_input(), 0, 'the sibling takes a click');
assert.strictEqual(mainThread.check_input_hwnd(0), 0,
  'the main thread\'s keyup had no hwnd, whatever the sibling holds');
assert.strictEqual(sibling.check_input_hwnd(0), MOUSE_HWND,
  'the sibling reads the click\'s own hwnd');
assert.strictEqual(sibling.check_input_lparam(), 0x00640032, 'and the click\'s lParam');
assert.strictEqual(hostState.last.hwnd, MOUSE_HWND,
  'a slot reading its own current event leaves the host event unchanged');

// An empty poll by a thread forgets that thread's saved event.
broker.publish({ inputPending: 1 });
assert.strictEqual(mainThread.check_input(), 0, 'the main thread polls empty');
assert.strictEqual(mainThread.check_input_lparam(), 0,
  'after its own empty poll the main thread has no event to read');

console.log('PASS  worker input event reads stay per-slot across a sibling thread\'s poll');
