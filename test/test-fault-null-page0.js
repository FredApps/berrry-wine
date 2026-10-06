#!/usr/bin/env node
'use strict';

// set_fault_unmapped mode 4 (--fault-null=page0, an app's `nullPageFaults`):
// Win98's own rule for unmapped low memory. Only the 4KB guard page at 0
// faults -- the rest below the image is the readable DOS/Win16 arena -- and
// only a GUEST access may raise: a handler translating a NULL argument it was
// handed (GetPrivateProfileStringA(NULL, ...)) must not hand the guest an
// access violation for the emulator's own read. Dark Reign's debug allocator
// walks the EBP chain until reading the outermost frame's [4] faults into its
// __except, and on the quiet sentinel it walked forever.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_init")
    (global.set $image_base (i32.const 0x00400000)))
  (func (export "t_probe") (param $ga i32) (param $in_handler i32) (result i32)
    (global.set $fault_address (i32.const 0x7777))
    (global.set $api_handler_depth (local.get $in_handler))
    (drop (call $g2w (local.get $ga)))
    (global.set $api_handler_depth (i32.const 0))
    (global.get $fault_address))
  (func (export "t_sentinel") (param $ga i32) (result i32)
    (i32.eq (call $g2w (local.get $ga)) (global.get $NULL_SENTINEL)))
`;

(async () => {
  const exits = [];
  const { exports: e, hostCtx } = await bootRenderHarness({ extraWat, fonts: 'none' });
  hostCtx.onExit = code => exits.push(code);
  e.t_init();
  const UNTOUCHED = 0x7777;

  // Mode 0 (default): nothing raises anywhere.
  e.set_fault_unmapped(0);
  assert.strictEqual(e.t_probe(4, 0), UNTOUCHED, 'default: a NULL read is quiet');

  e.set_fault_unmapped(4);
  assert.strictEqual(e.t_sentinel(0x2000), 1, 'above the guard page: still the sentinel');
  assert.strictEqual(e.t_probe(0x2000, 0), UNTOUCHED, 'above 0x1000 does not raise (DOS arena)');
  assert.strictEqual(e.t_probe(0xac44, 0), UNTOUCHED, "mss32's 0xac44 probe does not raise");
  assert.strictEqual(e.t_probe(4, 1), UNTOUCHED, 'inside an API handler a NULL read does not raise');
  assert.strictEqual(e.t_probe(0, 1), UNTOUCHED);
  assert.strictEqual(e.t_probe(4, 0) >>> 0, 4, 'a guest read of [4] raises with the faulting address');
  assert.strictEqual(e.t_probe(0xffc, 0) >>> 0, 0xffc, 'the last guard-page dword raises');
  e.set_fault_unmapped(0);

  // Every host arms it the same way, and worker threads inherit it.
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert(/nullPageFaults === true \? 4 : 0/.test(read('test/run.js')), 'run.js maps nullPageFaults to mode 4');
  assert(/faultUnmapped: FAULT_NULL_MODE/.test(read('test/run.js')), 'run.js hands the mode to worker threads');
  assert(/wine\.nullPageFaults = app\.nullPageFaults === true/.test(read('lib/browser-shell.js')),
    'the browser shell copies the app flag');
  const host = read('host.js');
  assert(/set_fault_unmapped\(4\)/.test(host) && /callExport\('set_fault_unmapped', 4\)/.test(host)
    && /faultUnmapped: this\.nullPageFaults \? 4 : 0/.test(host),
    'host.js arms the main instance, the Worker slot 0 and spawned threads');
  console.log('PASS fault-null page0: guest guard-page accesses raise; DOS arena and handler reads stay quiet');
})().catch(error => { console.error(error); process.exitCode = 1; });
