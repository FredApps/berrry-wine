#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { callDllMain, callDllMainAsync } = require('../lib/dll-loader');
// $GUEST_BASE, from the map declared in src/00-regions.wat.
const RegionMap = require('../lib/region-map.generated.js');

function captureDllMainArgs(options, { sparseStack = false } = {}) {
  const memory = new WebAssembly.Memory({ initial: 128 });
  const dv = new DataView(memory.buffer);
  const imageBase = 0x00400000;
  const savedEsp = sparseStack ? 0x07500000 : 0x00420000;
  const contiguousG2w = guest => RegionMap.g2w(guest, imageBase);
  const sparseBase = 0x074ff000;
  const sparseWa = 0x00050000;
  const g2w = guest => sparseStack
    ? sparseWa + guest - sparseBase
    : contiguousG2w(guest);
  let captured;
  const e = {
    memory,
    get_image_base: () => imageBase,
    get_eip: () => 0x00401000,
    get_esp: () => savedEsp,
    get_fs_base: () => 0,
    get_eax: () => 1,
    set_eip: value => { e.eip = value >>> 0; },
    set_esp: value => { e.esp = value >>> 0; },
    run: () => {
      captured = [0, 4, 8, 12].map(offset =>
        dv.getUint32(g2w(e.esp + offset), true) >>> 0);
      e.eip = 0;
    },
  };
  if (sparseStack) e.guest_to_wasm = g2w;

  callDllMain(e, 0x0069d000, 0x006c0aa0, null, options);
  return captured;
}

function captureSleepResume() {
  const memory = new WebAssembly.Memory({ initial: 128 });
  const imageBase = 0x00400000;
  const savedEsp = 0x00420000;
  let eip = 0x00401000;
  let esp = savedEsp;
  let runs = 0;
  let sleepPending = false;
  let advancedMs = 0;
  const e = {
    memory,
    get_image_base: () => imageBase,
    get_eip: () => eip,
    get_esp: () => esp,
    get_fs_base: () => 0,
    get_eax: () => 1,
    get_last_run_halt: () => sleepPending ? 3 : 2,
    get_sleep_yielded: () => {
      const value = sleepPending ? 1 : 0;
      sleepPending = false;
      return value;
    },
    get_sleep_timeout: () => 500,
    set_eip: value => { eip = value >>> 0; },
    set_esp: value => { esp = value >>> 0; },
    run: () => {
      runs++;
      if (runs === 1) {
        sleepPending = true;
        eip = 0x006c0b10;
      } else {
        eip = 0;
      }
    },
  };

  callDllMain(e, 0x0069d000, 0x006c0aa0, null, {
    advanceGuestTime: ms => { advancedMs += ms; },
  });
  return { runs, eip, esp, advancedMs };
}

assert.deepStrictEqual(captureDllMainArgs({ lpReserved: 1 }),
  [0, 0x0069d000, 1, 1],
  'static startup DLLs must receive non-NULL lpReserved');
assert.deepStrictEqual(captureDllMainArgs(),
  [0, 0x0069d000, 1, 0],
  'dynamic LoadLibrary DLLs must receive NULL lpReserved');
assert.deepStrictEqual(captureDllMainArgs(1234),
  [0, 0x0069d000, 1, 0],
  'legacy numeric maxBlocks calls must remain dynamic-load compatible');
assert.deepStrictEqual(captureDllMainArgs({ reason: 2 }),
  [0, 0x0069d000, 2, 0],
  'new worker threads must deliver DLL_THREAD_ATTACH before their start routine');
assert.deepStrictEqual(captureDllMainArgs({ reason: 2 }, { sparseStack: true }),
  [0, 0x0069d000, 2, 0],
  'DLL_THREAD_ATTACH must push onto a sparse worker stack through guest_to_wasm');
assert.deepStrictEqual(captureSleepResume(),
  { runs: 2, eip: 0x00401000, esp: 0x00420000, advancedMs: 500 },
  'DllMain must advance guest time and resume a cooperative Sleep before restoring caller state');

console.log('PASS  DllMain receives the Windows static/dynamic load context');

(async () => {
  const memory = new WebAssembly.Memory({ initial: 128 });
  let eip = 0x401000, esp = 0x420000, halt = 0, reason = 0;
  const seen = [];
  const e = {
    memory, get_image_base: () => 0x400000, get_fs_base: () => 0,
    get_eip: () => eip, set_eip: v => { eip = v; },
    get_esp: () => esp, set_esp: v => { esp = v; },
    get_eax: () => 1, get_last_run_halt: () => halt,
    get_yield_reason: () => reason,
    run() {
      seen.push(eip);
      if (eip === 0x600000) {
        eip = 0x600100; halt = 4; reason = 5;
      } else {
        assert.ok(eip === 0x700000 || eip === 0x600100);
        eip = 0; halt = 2; reason = 0;
      }
    },
  };
  await callDllMainAsync(e, 0x600000, 0x600000, null, {
    async handleLoadLibraryYield() {
      assert.strictEqual(eip, 0x600100, 'outer initializer stays at the load continuation');
      assert.strictEqual(esp, 0x41fff0, 'outer initializer stack remains live across await');
      await Promise.resolve();
      await callDllMainAsync(e, 0x700000, 0x700000, null);
      assert.strictEqual(eip, 0x600100, 'nested initializer restores outer continuation');
      assert.strictEqual(esp, 0x41fff0, 'nested initializer restores outer stack');
    },
  });
  assert.deepStrictEqual(seen, [0x600000, 0x700000, 0x600100]);
  assert.strictEqual(eip, 0x401000);
  assert.strictEqual(esp, 0x420000);
  console.log('PASS  nested dynamic DLL initialization resumes before restoring caller state');
  seen.length = 0;
  const logs = [];
  await callDllMainAsync(e, 0x600000, 0x600000, line => logs.push(line), {
    async handleLoadLibraryYield() { throw new Error('nested load failed'); },
  });
  assert.deepStrictEqual(seen, [0x600000]);
  assert.strictEqual(eip, 0x401000, 'nested load rejection restores caller EIP');
  assert.strictEqual(esp, 0x420000, 'nested load rejection restores caller ESP');
  assert.ok(logs.some(line => line.includes('nested load failed')), 'nested failure remains visible');
  console.log('PASS  nested loader rejection restores the caller without running an incomplete initializer');
})().catch(error => { console.error(error); process.exitCode = 1; });
