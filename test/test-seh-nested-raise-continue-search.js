#!/usr/bin/env node
'use strict';
// A raise inside an exception handler, and the outer dispatch that resumes
// after it.
//
// MSVC runs a catch block -- and that block's `throw;` -- from inside the
// frame handler, so a nested RaiseException during the first pass is
// ordinary C++. The software dispatch used to keep its walk state in
// $delphi_* globals that the nested dispatch overwrote; when the inner
// handler then returned ExceptionContinueSearch for the original exception,
// the outer walk resumed with the nested raise's record and chain position.
// Unreal Tournament's unguard rethrow was handed to every outer frame with a
// null ThrowInfo, all of them declined, and the int it threw went unhandled.
//
// Frames: A (outer) records each code it is handed and continues execution;
// B (inner) raises 0x2222 from inside its handler when handed 0x1111, then
// returns ExceptionContinueSearch. A must see 0x2222 and then 0x1111.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = `
  (func (export "test_window") (param $proc i32) (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $host_register_dialog_frame (local.get $h) (i32.const 0)
      (i32.const 0) (i32.const 32) (i32.const 24) (i32.const 0))
    (call $wnd_table_set (local.get $h) (local.get $proc))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x90000000)))
    (local.get $h))
  (func (export "test_send_completed") (result i32) (global.get $wnd_send_completed))
  ;; The PE loader allocates the software-dispatch continuation thunk; this
  ;; harness loads no PE, so allocate it here or every handler returns to 0.
  (func (export "test_set_fs") (param $tib i32)
    (global.set $fs_base (local.get $tib))
    (if (i32.eqz (global.get $delphi_seh_thunk))
      (then (global.set $delphi_seh_thunk (call $com_cont_thunk (i32.const 0xCACA000E))))))
  (func (export "test_fs_head") (result i32) (call $gl32 (global.get $fs_base)))
  (func (export "test_thunk") (param $id i32) (result i32)
    (local $p i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $p (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $p)))
`;

const u32 = v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => b & 255);

(async () => {
  const exits = [];
  const { exports: e } = await bootRenderHarness({
    extraWat, fonts: 'none',
    extraHostOverrides: { exit: code => exits.push(code >>> 0) },
  });
  // A TIB of its own, SEH head = -1 (end of chain).
  const tib = e.guest_alloc(0x40);
  e.guest_write32(tib, 0xffffffff);
  e.test_set_fs(tib);
  const raiseId = apiTable.findIndex(a => a.name === 'RaiseException');
  assert(raiseId >= 0, 'RaiseException is in the API table');
  const raise = e.test_thunk(raiseId);
  const log = e.guest_alloc(16);
  e.guest_write32(log, 0);

  const code = bytes => {
    const at = e.guest_alloc(bytes.length);
    bytes.forEach((b, i) => e.guest_write8(at + i, b));
    return at;
  };
  // push 0; push 0; push 0; push CODE; mov eax,RaiseException; call eax
  const raiseOf = c => [0x6a, 0, 0x6a, 0, 0x6a, 0, 0x68, ...u32(c), 0xb8, ...u32(raise), 0xff, 0xd0];

  // A: log[1 + log[0]++] = rec->code; return ExceptionContinueExecution.
  const handlerA = code([
    0x8b, 0x44, 0x24, 0x04,             // mov eax,[esp+4]
    0x8b, 0x00,                         // mov eax,[eax]
    0x8b, 0x0d, ...u32(log),            // mov ecx,[log]
    0x89, 0x04, 0x8d, ...u32(log + 4),  // mov [log+4+ecx*4],eax
    0xff, 0x05, ...u32(log),            // inc dword [log]
    0x31, 0xc0,                         // xor eax,eax
    0xc3,                               // ret
  ]);
  // B: if rec->code == 0x1111, RaiseException(0x2222); return ContinueSearch.
  const bBody = [
    0x8b, 0x44, 0x24, 0x04,             // mov eax,[esp+4]
    0x81, 0x38, ...u32(0x1111),         // cmp dword [eax],0x1111
  ];
  const bRaise = raiseOf(0x2222);
  const handlerB = code([
    ...bBody,
    0x75, bRaise.length,                // jne done
    ...bRaise,
    0xb8, ...u32(1),                    // done: mov eax,1
    0xc3,                               // ret
  ]);
  // The procedure: register A then B, raise 0x1111, unlink both, return 0x5a5a.
  const proc = code([
    0x68, ...u32(handlerA), 0x64, 0xff, 0x35, ...u32(0), 0x64, 0x89, 0x25, ...u32(0),
    0x68, ...u32(handlerB), 0x64, 0xff, 0x35, ...u32(0), 0x64, 0x89, 0x25, ...u32(0),
    ...raiseOf(0x1111),
    0x8b, 0x04, 0x24, 0x64, 0xa3, ...u32(0), 0x83, 0xc4, 0x08,   // fs:[0] = B.next; pop B
    0x8b, 0x04, 0x24, 0x64, 0xa3, ...u32(0), 0x83, 0xc4, 0x08,   // fs:[0] = A.next; pop A
    0xb8, ...u32(0x5a5a), 0xc2, 0x10, 0x00,                      // mov eax,0x5a5a; ret 16
  ]);

  const headBefore = e.test_fs_head() >>> 0;
  const h = e.test_window(proc);
  const result = e.send_message(h, 0x0400, 0, 0) >>> 0;

  assert.deepStrictEqual(exits, [], 'nothing went unhandled');
  assert.strictEqual(e.test_send_completed(), 1, 'the procedure ran to its return');
  const seen = [];
  for (let i = 0; i < e.guest_read32(log); i++) seen.push(e.guest_read32(log + 4 + i * 4) >>> 0);
  assert.deepStrictEqual(seen, [0x2222, 0x1111],
    'the outer walk resumes with the original exception, not the nested one');
  assert.strictEqual(result, 0x5a5a, 'both RaiseExceptions returned into the guest');
  assert.strictEqual(e.test_fs_head() >>> 0, headBefore, 'the SEH chain is restored');
  console.log('PASS test-seh-nested-raise-continue-search');
})().catch(err => { console.error(err); process.exit(1); });
