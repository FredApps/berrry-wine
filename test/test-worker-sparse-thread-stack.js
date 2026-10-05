#!/usr/bin/env node
'use strict';

// A late CreateThread can arrive after the direct low guest heap has reached
// emulator-private memory. Its stack then lives in the sparse high guest arena,
// so worker setup must use the WAT's full guest-to-WASM translation rather than
// assuming every allocation is image-relative.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const { GuestThreadHost, WorkerLink } = require('../lib/guest-thread-host');
// $PAGE_INDEX_ARENA and $GUEST_BASE, from the map declared in
// src/00-regions.wat.
const RegionMap = require('../lib/region-map.generated.js');

const root = path.join(__dirname, '..');

async function main() {
  // DLL bootstrap is another Worker protocol boundary. Safari/WebKit rejects
  // the complete message if a host callback survives anywhere in its object
  // graph, even when a Win16 app has no PE DLLs to load.
  {
    const host = new GuestThreadHost({
      memory: null, module: null, sigs: {}, hostImports: {},
    });
    let message = null;
    host.link = {
      _ask: async value => {
        message = value;
        structuredClone(value);
        return { results: [] };
      },
    };
    const bytes = Uint8Array.of(0x4D, 0x5A);
    const exeBytes = Uint8Array.of(0x4E, 0x45);
    const configs = [{
      name: 'CARDS.DLL', path: 'C:\\WINDOWS\\SYSTEM\\CARDS.DLL', bytes,
      provider: { read() {} },
    }];
    const opts = {
      exeName: 'WEP16_RODENT.EXE', extraArgs: '-test', maxBlocks: 1234,
      registerDllResources() {}, advanceGuestTime() {},
      nested: { callback() {} },
    };
    await host.loadDlls(configs, exeBytes, opts);
    assert.deepStrictEqual(Object.keys(message.configs[0]).sort(), ['bytes', 'name', 'path']);
    assert.deepStrictEqual(message.opts, {
      exeName: 'WEP16_RODENT.EXE', extraArgs: '-test', maxBlocks: 1234,
    });
    assert.strictEqual(message.configs[0].bytes, bytes);
    assert.strictEqual(message.exeBytes, exeBytes);
    assert.strictEqual(configs[0].provider.read instanceof Function, true,
      'marshalling must not mutate the caller config');
    assert.strictEqual(opts.advanceGuestTime instanceof Function, true,
      'marshalling must not mutate the caller options');

    const link = new WorkerLink({
      slot: 7, memory: null, module: null, sigs: {}, broker: {},
    });
    link.worker = {
      postMessage() { throw new Error('The object can not be cloned.'); },
    };
    await assert.rejects(link._ask({ t: 'loadDlls' }, 1000),
      /worker 7 could not post loadDlls: The object can not be cloned/);
    assert.strictEqual(link._pending.size, 0,
      'a synchronous structured-clone failure must clear the pending request');
  }

  const module = await WebAssembly.compile(compileSrcWasm((file, source) =>
    file === '13-exports.wat' ? source + `
      (func (export "test_worker_sleep_ex") (param $ms i32)
        (call $handle_SleepEx (local.get $ms) (i32.const 1)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
    ` : source));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = {
    getMemory: () => memory.buffer,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
    onExit: () => {},
  };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  const apcs = [];
  const alertable = [];
  imports.host.dequeue_user_apc = (tid, outWa) => {
    assert.strictEqual(tid, 2, 'APCs must be dequeued by the target Worker');
    if (!apcs.length) return 0;
    if (outWa) {
      const item = apcs.shift();
      const words = new Uint32Array(memory.buffer, outWa >>> 0, 2);
      words[0] = item.callback;
      words[1] = item.data;
    }
    return 1;
  };
  imports.host.set_apc_alertable = (tid, flag) => alertable.push([tid, flag]);
  const sigs = JSON.parse(fs.readFileSync(
    path.join(root, 'lib', 'host-import-sigs.generated.json'), 'utf8')).sigs;
  const host = new GuestThreadHost({
    memory, module, sigs, hostImports: imports.host,
    workerUrl: path.join(root, 'lib', 'guest-worker.js'),
    clockIntervalMs: 0,
  });

  try {
    await host.start();
    const imageBase = 0x00400000;
    await host.callExport('init_thread', 0, imageBase, imageBase, 0x00600000,
      0x07500000, 0x07501000, 1, 1);
    // A 1MB private low-heap chunk starting here would cross PAGE_INDEX_ARENA
    // after g2w translation, forcing guest_alloc onto the sparse arena.
    const pageIndexArena = RegionMap.BASE.PAGE_INDEX_ARENA;
    const nearLowHeapEnd =
      imageBase + pageIndexArena - RegionMap.GUEST_BASE - 0x80000;
    await host.callExport('heap_init', nearLowHeapEnd);

    const thread = await host.spawnThread({
      tid: 1,
      imageBase,
      codeStart: imageBase,
      codeEnd: 0x00600000,
      thunkBase: 0x07500000,
      thunkEnd: 0x07501000,
      numThunks: 1,
      dllCount: 0,
      vlanIp: 0,
      tlsNextIndex: 0,
      stackSize: 0x10000,
      param: 0x12345678,
      startAddr: 0x00401000,
      hwndBase: 0x00020001,
    });
    assert(thread.stackBase >= 0x40000000,
      `expected sparse guest stack, got 0x${thread.stackBase.toString(16)}`);
    assert.strictEqual(await thread.callExport('guest_read32', thread.stackTop - 4),
      0x12345678);
    assert.strictEqual(await thread.callExport('guest_read32', thread.stackTop - 8), 0);
    const vector = await thread.callExport('get_tls_slots') >>> 0;
    assert(vector, 'real Worker setup registers its TLS vector');
    assert.strictEqual(await thread.callExport('test_call_TlsSetValue', 79, 0x12345678), 1);
    assert.strictEqual(await thread.callExport('guest_read32', vector + 79 * 4), 0x12345678);
    await host.callExport('set_tls_next_index', 80);
    assert.strictEqual(await host.callExport('test_call_TlsFree', 79), 1);
    assert.strictEqual(await thread.callExport('guest_read32', vector + 79 * 4), 0,
      'main instance Free clears the real guest Worker vector without a GetValue call');

    // Real x86 callbacks cross the same broker/Worker boundary used by the
    // browser. A queued-before-start callback must run before the entry point;
    // a later callback must wait until an alertable wait, even across slices.
    const marker = 0x00402000;
    const observed = marker + 4;
    const callback = 0x00401100;
    const loop = 0x0040100a;
    const putBytes = async (address, values) => {
      for (let off = 0; off < values.length; off += 4) {
        const word = Buffer.alloc(4);
        Buffer.from(values.slice(off, off + 4)).copy(word);
        await thread.callExport('guest_write32', address + off, word.readUInt32LE(0));
      }
    };
    const u32 = value => [...Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24)];
    // mov eax,[marker]; mov [observed],eax; jmp $
    await putBytes(0x00401000, [0xa1, ...u32(marker), 0xa3, ...u32(observed), 0xeb, 0xfe]);
    // mov eax,[esp+4]; add [marker],eax; ret 4
    await putBytes(callback, [0x8b, 0x44, 0x24, 4, 0x01, 0x05, ...u32(marker), 0xc2, 4, 0]);
    apcs.push({ callback, data: 7 });
    const startup = await thread.slice(1000);
    assert(!startup.trapped, JSON.stringify(startup));
    assert.strictEqual(await thread.callExport('guest_read32', observed), 7,
      'startup APC executes before the thread entry point');
    apcs.push({ callback, data: 11 });
    await thread.slice(1000);
    assert.strictEqual(await thread.callExport('guest_read32', marker), 7,
      'startup dispatch must not repeat on later slices');
    // Enter an alertable wait while its queue is empty, then queue an APC.
    const pending = apcs.pop();
    const esp = await thread.callExport('get_esp') >>> 0;
    await thread.callExport('set_esp', esp - 12);
    await thread.callExport('guest_write32', esp - 12, loop);
    await thread.callExport('test_worker_sleep_ex', 1000);
    assert.deepStrictEqual(alertable.at(-1), [2, 1]);
    apcs.push(pending);
    await thread.completeWait(0xc0, 12);
    await thread.slice(1000);
    assert.strictEqual(await thread.callExport('guest_read32', marker), 18,
      'wait completion must execute the queued guest callback');
    assert.strictEqual(await thread.callExport('get_eax'), 0xc0);
    assert.strictEqual(await thread.callExport('get_esp') >>> 0, esp,
      'APC completion balances the wait and callback stdcall frames');
    assert.deepStrictEqual(alertable.at(-1), [2, 0]);

    // A timed-out SleepEx returns zero (WAIT_TIMEOUT is a wait API result).
    await thread.callExport('set_esp', esp - 12);
    await thread.callExport('guest_write32', esp - 12, loop);
    await thread.callExport('test_worker_sleep_ex', 1000);
    await thread.completeWait(0x102, 12);
    assert.strictEqual(await thread.callExport('get_eax'), 0);
    assert.strictEqual(await thread.callExport('get_eip'), loop);
    assert.strictEqual(await thread.callExport('get_esp') >>> 0, esp);

    // An ordinary return to zero is not a WASM trap. Its final registers and
    // sparse-stack frames must come from the owning Worker nonetheless.
    const finish = 0x00401300;
    await putBytes(finish, [0xb8, ...u32(0x1234abcd), 0xc3]);
    const frame = thread.stackTop - 128;
    await thread.callExport('guest_write32', frame, 0);
    await thread.callExport('guest_write32', frame + 4, 0x00401500);
    await thread.callExport('set_ebp', frame);
    await thread.callExport('set_esp', thread.stackTop - 8);
    await thread.callExport('guest_write32', thread.stackTop - 8, 0);
    await thread.callExport('set_eip', finish);
    const exited = await thread.slice(1000);
    assert.strictEqual(exited.trapped, null);
    assert.strictEqual(exited.eip, 0);
    assert(exited.regs, 'non-trapping exit includes owning Worker registers');
    assert.strictEqual(exited.regs.eax, 0x1234abcd);
    assert(exited.regs.prevEip >= finish && exited.regs.prevEip < finish + 6);
    assert.deepStrictEqual(exited.regs.frames, [0x00401500]);
  } finally {
    host.stop();
  }

  console.log('PASS guest Worker clone boundary, sparse stack, startup APCs and alertable waits');
}

main().catch(error => { console.error(error); process.exit(1); });
