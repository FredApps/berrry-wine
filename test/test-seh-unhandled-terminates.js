#!/usr/bin/env node
'use strict';

// An unhandled exception must END the guest, not merely tell the host.
//
// JigSawedME (before its IMalloc fix) wiped its own code and stack and fell
// into zeroed memory. $th_zero_entry raised EXCEPTION_ACCESS_VIOLATION, the SEH
// walk found no frame, and the unhandled path called host_exit -- and nothing
// else. $eip still named the zero block, so the batch ran straight back into
// it, raised again, and did that forever inside one wasm call, where neither
// --max-seconds nor SIGTERM can act. One run lived 15 hours.
//
// Two things are pinned here:
//
//  1. Unhandled: no SEH frame at all. One raise, one exit with 0xDE00|code,
//     EIP 0, yield reason 2 (exited), and the batch returns long before its
//     budget. A further run() does not raise again.
//
//  2. A raise storm the guest itself sustains: a frame handler that answers
//     ExceptionContinueExecution without repairing anything, so the thread
//     re-faults at the same instruction for ever. That is legal guest
//     behaviour and is not ours to terminate, but the batch must still hand
//     control back to the host every so often -- run() with a budget of
//     2^30 blocks has to return after a bounded number of raises.
//
// Run: node test/test-seh-unhandled-terminates.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHostImports } = require(path.join(__dirname, '..', 'lib/host-imports'));
const RegionMap = require('../lib/region-map.generated.js');

const RAISE_MARKER = 0xCAE8C000;
const HUGE_BUDGET = 0x40000000;

async function boot() {
  const ROOT = path.join(__dirname, '..');
  const WASM_PATH = process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const exeBytes = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const h = createHostImports(ctx).host;
  const state = { exits: [], raises: 0 };
  h.memory = memory;
  // A throw from an import unwinds the wasm call, so a regression fails here
  // quickly instead of spinning through the whole budget.
  h.exit = code => {
    state.exits.push(code >>> 0);
    if (state.exits.length > 100) {
      throw new Error(`host exit called ${state.exits.length}x inside one run(): `
        + 'the guest kept executing after an unhandled exception');
    }
  };
  h.log = () => {};
  h.log_i32 = v => {
    if ((v >>> 0) === RAISE_MARKER) state.raises++;
  };
  h.crash_unimplemented = () => {};

  const { instance } = await WebAssembly.instantiate(wasmBytes, { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const mem = new Uint8Array(e.memory.buffer);
  mem.set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);
  return { e, state };
}

function helpers(e) {
  const imageBase = e.get_image_base();
  const dv = new DataView(e.memory.buffer);
  const mem = new Uint8Array(e.memory.buffer);
  const g2w = a => RegionMap.g2w(a, imageBase);
  const le32 = v => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  return {
    imageBase,
    put: (addr, bytes) => mem.set(bytes, g2w(addr)),
    poke: (addr, v) => dv.setUint32(g2w(addr), v >>> 0, true),
    zero: (addr, len) => mem.fill(0, g2w(addr), g2w(addr) + len),
  };
}

async function unhandledZeroEntry() {
  const { e, state } = await boot();
  const { imageBase, poke, zero } = helpers(e);
  const ZEROS = imageBase + 0x3000;       // wiped code: `00 00` = add [eax],al
  const FS_SLOT = imageBase + 0x2000;
  const STACK_TOP = imageBase + 0xd00000;

  zero(ZEROS, 0x100);
  e.set_fs_base(FS_SLOT);
  poke(FS_SLOT, 0xffffffff);             // FS:[0] = end of chain: no handler
  e.set_eax(0);                          // unmapped, so the zeros fault
  e.set_esp(STACK_TOP);
  e.set_eip(ZEROS);

  e.run(HUGE_BUDGET);

  assert.strictEqual(state.raises, 1,
    `an unhandled fault must be raised once, not re-entered (raised ${state.raises}x)`);
  assert.deepStrictEqual(state.exits, [(0xDE00 | 0xC0000005) >>> 0],
    'the unhandled path reports 0xDE00|EXCEPTION_ACCESS_VIOLATION exactly once');
  assert.strictEqual(e.get_eip() >>> 0, 0, 'the guest is stopped at EIP 0');
  assert.strictEqual(e.get_yield_reason(), 2, 'yield reason 2 (exited)');
  assert.strictEqual(e.get_last_run_halt(), 2, 'run() halted on EIP 0');

  // The process is over: another slice must not start raising again.
  e.run(1000);
  assert.strictEqual(state.raises, 1, 'a later run() does not re-raise');
  assert.strictEqual(state.exits.length, 1, 'a later run() does not exit again');
}

async function continueExecutionStorm() {
  const { e, state } = await boot();
  const { imageBase, put, poke, zero } = helpers(e);
  const ZEROS = imageBase + 0x3000;
  const HANDLER = imageBase + 0x3200;
  const FS_SLOT = imageBase + 0x2000;
  const SEH_REC = imageBase + 0x2040;
  const STACK_TOP = imageBase + 0xd00000;

  zero(ZEROS, 0x100);
  // A raw frame handler (no MSVC scope table, so it is really called):
  //   31 C0   xor eax,eax     ; ExceptionContinueExecution
  //   C3      ret             ; cdecl
  // It changes nothing in the CONTEXT, so the thread resumes at the fault.
  put(HANDLER, [0x31, 0xc0, 0xc3]);
  poke(SEH_REC + 0, 0xffffffff);
  poke(SEH_REC + 4, HANDLER);
  poke(SEH_REC + 8, 0);                  // no scope table: not __except_handler3
  poke(SEH_REC + 12, 0);
  e.set_fs_base(FS_SLOT);
  poke(FS_SLOT, SEH_REC);
  e.set_eax(0);
  e.set_esp(STACK_TOP);
  e.set_eip(ZEROS);

  e.run(HUGE_BUDGET);

  // The first few raises are logged individually and the rest are counted
  // silently, so the marker count says only that it did raise.
  assert.ok(state.raises >= 2, `the storm reproduced (raised ${state.raises}x)`);
  assert.deepStrictEqual(state.exits, [],
    'a handled exception is not a termination, however often it repeats');
  assert.strictEqual(e.get_last_run_halt(), 3,
    'run() must hand control back (yield) during a raise storm instead of spending a 2^30-block budget');
  // The yield lands right after the 64th raise redirected the thread into its
  // handler, so the next slice picks the cycle up exactly where it stood.
  assert.strictEqual(e.get_eip() >>> 0, HANDLER >>> 0,
    'the guest is parked on its own handler, not stopped');
  e.run(HUGE_BUDGET);
  assert.strictEqual(e.get_last_run_halt(), 3, 'the next slice yields again');
  assert.deepStrictEqual(state.exits, [], 'and still does not terminate');
}

(async () => {
  await unhandledZeroEntry();
  await continueExecutionStorm();
  console.log('PASS unhandled SEH exception stops the guest (EIP 0, yield 2) and a '
    + 'ContinueExecution raise storm returns control to the host');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
