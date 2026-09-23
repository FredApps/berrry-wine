#!/usr/bin/env node

'use strict';

// A SendMessage from another thread reaches its receiver only while the
// receiver is inside a message call (GetMessage, PeekMessage, WaitMessage,
// MsgWaitForMultipleObjects, or its own SendMessage) -- never between two
// arbitrary instructions. The cooperative scheduler used to run the WndProc
// wherever the receiver's last slice happened to stop. Blobby Volley's game
// thread Synchronize()s into the main thread every frame, and one landed
// inside TControlCanvas.FreeHandle between ReleaseDC and clearing the cached
// DC: the paint adopted the released HDC and the host's picture froze for good.
//
// Two halves: the WAT message calls stop on their own thunk (yield 17) when
// a send is pending, and ThreadManager holds a send until that happens.

const path = require('path');
const fs = require('fs');
const { ThreadManager } = require('../lib/thread-manager');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

let passed = 0, failed = 0;
function check(ok, label, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

const apiId = name => {
  const table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'api_table.json'), 'utf8'));
  const entry = table.find(e => e.name === name);
  if (!entry) throw new Error(`${name} missing from api_table.json`);
  return entry.id;
};

(async () => {
  console.log('Cross-thread SendMessage delivery timing\n');

  // --- WAT: PeekMessageA parks on its thunk while a send is pending ---------
  {
    const module = await WebAssembly.compile(compileSrcWasm());
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const ctx = {
      getMemory: () => memory.buffer,
      resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
      onExit: () => {},
    };
    const imports = createHostImports(ctx);
    imports.host.memory = memory;
    for (const name of ['create_thread', 'exit_thread', 'create_event', 'set_event',
      'reset_event', 'wait_single', 'wait_multiple']) imports.host[name] = () => 0;
    const { exports: e } = await WebAssembly.instantiate(module, imports);
    ctx.exports = e;

    const thunkGuest = 0x7500000;
    const thunkWasm = 0x07112000;
    new DataView(memory.buffer).setUint32(thunkWasm + 4, apiId('PeekMessageA'), true);
    e.init_thread(0, 0x400000, 0x400000, 0x600000, thunkGuest, thunkGuest + 16, 2);

    // push PM_REMOVE; push 0; push 0; push 0; push msg; call PeekMessageA;
    // mov ebx,eax; jmp $
    const code = 0x401000, msgBuf = 0x520000;
    const toWasm = g => g - 0x400000 + 0x12000;
    const prog = new Uint8Array(22);
    prog.set([0x6A, 0x01, 0x6A, 0x00, 0x6A, 0x00, 0x6A, 0x00, 0x68], 0);
    new DataView(prog.buffer).setUint32(9, msgBuf, true);
    prog[13] = 0xE8;
    new DataView(prog.buffer).setInt32(14, (thunkGuest - (code + 18)) | 0, true);
    prog.set([0x89, 0xC3, 0xEB, 0xFE], 18);
    new Uint8Array(memory.buffer).set(prog, toWasm(code));
    const start = () => { e.set_esp(0x510000); e.set_eip(code); e.set_ebx(0xDEAD); e.clear_yield(); };

    // Control: nothing pending, so PeekMessage just returns.
    start();
    e.run(200);
    check((e.get_yield_reason() | 0) !== 17 && (e.get_ebx() | 0) !== 0xDEAD,
      'with no send pending PeekMessageA returns normally',
      `yield=${e.get_yield_reason()} eip=0x${(e.get_eip() >>> 0).toString(16)}`);

    start();
    e.set_incoming_send_pending(1);
    e.run(200);
    check((e.get_yield_reason() | 0) === 17 && (e.get_eip() >>> 0) === thunkGuest
      && (e.get_ebx() | 0) === 0xDEAD,
      'a pending incoming send stops PeekMessageA on its own thunk before it runs',
      `yield=${e.get_yield_reason()} eip=0x${(e.get_eip() >>> 0).toString(16)}`);
    check((e.get_esp() >>> 0) === 0x510000 - 24,
      'the parked call keeps its arguments and return address on the stack',
      `esp=0x${(e.get_esp() >>> 0).toString(16)}`);

    // The scheduler clears the flag once it has delivered, then the call runs.
    e.set_incoming_send_pending(0);
    e.clear_yield();
    e.run(200);
    check((e.get_yield_reason() | 0) !== 17 && (e.get_ebx() | 0) !== 0xDEAD,
      'once serviced, the same PeekMessageA call re-runs and returns',
      `yield=${e.get_yield_reason()} eip=0x${(e.get_eip() >>> 0).toString(16)}`);
  }

  // --- Scheduler: hold the send until the receiver is at a message call ----
  {
    const machine = yieldReason => {
      const s = { yieldReason, pending: 0, begins: 0, clears: 0, eip: 0x401234 };
      const ex = {
        get_sync_table: () => 0,
        get_yield_reason: () => s.yieldReason,
        get_yield_flag: () => (s.yieldReason ? 1 : 0),
        set_yield_state: y => { s.yieldReason = y; },
        clear_yield: () => { s.yieldReason = 0; s.clears++; },
        get_eip: () => s.eip, set_eip: v => { s.eip = v; },
        set_incoming_send_pending: v => { s.pending = v; },
        get_incoming_send_pending: () => s.pending,
        get_sleep_yielded: () => 0,
      };
      for (const r of ['esp', 'ebp', 'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'handler_set_eip', 'steps']) {
        ex['get_' + r] = () => s[r] || 0; ex['set_' + r] = v => { s[r] = v; };
      }
      return { s, ex };
    };
    const main = machine(0);
    // The WndProc "runs" by returning at once (EIP 0), with LRESULT 0x55.
    main.ex.thread_send_begin = () => { main.s.begins++; main.s.yieldReason = 0; return 1; };
    main.ex.run = () => { main.s.eip = 0; };
    main.ex.thread_send_end = () => 0x55;

    const sender = machine(10);
    let delivered = null;
    sender.ex.get_send_target_tid = () => 1;
    for (const n of ['hwnd', 'msg', 'wparam', 'lparam', 'post_kind']) sender.ex['get_send_' + n] = () => 0;
    sender.ex.complete_thread_send = v => { delivered = v; sender.s.yieldReason = 0; };

    const tm = new ThreadManager({}, new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }),
      { exports: main.ex }, () => ({ host: {} }), {});
    tm._log = () => {};
    tm.threads.set(1, { tid: 1, state: 'active', sleepCount: 0, sleepUntil: 0, waitPolls: 0,
      instance: { exports: sender.ex } });

    // Main is between two arbitrary instructions (last slice ran out).
    check(tm.resolveCooperativeThreadSend(sender.ex) === false && main.s.begins === 0,
      'a send to a receiver mid-code is held, not dispatched');
    check(main.s.pending === 1 && (sender.s.yieldReason | 0) === 10,
      'the receiver is flagged and the sender stays parked');

    // Main's next message call stops for it (yield 17 on its thunk).
    main.s.yieldReason = 17;
    main.s.eip = 0x7500000;
    const stillParked = tm.checkMainYield();
    check(main.s.begins === 1 && delivered === 0x55,
      'the receiver\'s message call delivers the held send', `result=${delivered}`);
    check(main.s.pending === 0 && main.s.yieldReason === 0 && !stillParked
      && main.s.eip === 0x7500000,
      'then the interrupted message call is resumed on its thunk');

    // A receiver already waiting in GetMessage (yield 7) takes it immediately.
    const sender2 = machine(10);
    let delivered2 = null;
    sender2.ex.get_send_target_tid = () => 1;
    for (const n of ['hwnd', 'msg', 'wparam', 'lparam', 'post_kind']) sender2.ex['get_send_' + n] = () => 0;
    sender2.ex.complete_thread_send = v => { delivered2 = v; sender2.s.yieldReason = 0; };
    main.s.yieldReason = 7;
    main.s.eip = 0x401234;
    check(tm.resolveCooperativeThreadSend(sender2.ex) === true && delivered2 === 0x55
      && main.s.pending === 0 && main.s.yieldReason === 7,
      'a receiver blocked in GetMessage takes a send at once and stays blocked');
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed) process.exitCode = 1;
})().catch(err => { console.error(err); process.exitCode = 1; });
