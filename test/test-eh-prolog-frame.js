#!/usr/bin/env node
'use strict';

// MSVCRT's _EH_prolog builds its caller's frame:
//
//   push -1; push eax; push fs:[0]; mov fs:[0], esp
//   mov [esp+12], ebp       ; the return-address slot keeps the old EBP
//   lea ebp, [esp+12]       ; EBP -> that saved EBP
//   ret                     ; back to the caller, ESP = entry ESP - 12
//
// It reaches us through $win32_dispatch, which restores the x86 nonvolatile
// registers after every handler. Restoring EBP undid the whole point of the
// call: LithTech's lithtech.exe (Die Hard: Nakatomi Plaza demo) opens
// constructors with it, ran them on its caller's frame, and returned through
// `leave; ret` into NULL at startup. This drives the real dispatch path.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const API_ID_EH_PROLOG = 743; // src/api_table.json (gen_dispatch's API_ID__EH_prolog)

const extraWat = String.raw`
  (func (export "test_set_image_base") (param $base i32)
    (global.set $image_base (local.get $base)))
  (func (export "test_set_fs_base") (param $base i32)
    (global.set $fs_base (local.get $base)))
  (func (export "test_set_regs") (param $eax i32) (param $esp i32) (param $ebp i32)
        (param $ebx i32) (param $esi i32) (param $edi i32)
    (i32.store offset=0 (global.get $reg_base) (local.get $eax))
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (i32.store offset=20 (global.get $reg_base) (local.get $ebp))
    (i32.store offset=12 (global.get $reg_base) (local.get $ebx))
    (i32.store offset=24 (global.get $reg_base) (local.get $esi))
    (i32.store offset=28 (global.get $reg_base) (local.get $edi)))
  (func (export "test_reg") (param $offset i32) (result i32)
    (i32.load (i32.add (global.get $reg_base) (local.get $offset))))
  (func (export "test_eip") (result i32) (global.get $eip))
  (func (export "test_call_eh_prolog") (param $api_id i32)
    ;; A resolved-ordinal thunk in slot 0 carrying the api id.
    (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
    (i32.store offset=4 (global.get $THUNK_BASE) (local.get $api_id))
    (call $win32_dispatch (i32.const 0)))
  (func (export "test_gl32") (param $ga i32) (result i32) (call $gl32 (local.get $ga)))
  (func (export "test_gs32") (param $ga i32) (param $v i32) (call $gs32 (local.get $ga) (local.get $v)))
`;

async function main() {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.test_set_image_base(0x00400000);

  const TIB = 0x00510000;          // guest TIB: fs:[0] is the SEH chain head
  const OLD_SEH = 0x0050ff00;
  const ENTRY_ESP = 0x00500000;    // [ESP] = return address into the caller
  const RET = 0x0048eb65;
  const HANDLER = 0x004dbfa7;
  const OLD_EBP = 0x0050fff8;
  e.test_set_fs_base(TIB);
  e.test_gs32(TIB, OLD_SEH);
  e.test_gs32(ENTRY_ESP, RET);
  e.test_set_regs(HANDLER, ENTRY_ESP, OLD_EBP, 0x11111111, 0x22222222, 0x33333333);

  e.test_call_eh_prolog(API_ID_EH_PROLOG);

  const esp = e.test_reg(16) >>> 0;
  const ebp = e.test_reg(20) >>> 0;
  assert.strictEqual(e.test_eip() >>> 0, RET, 'returns to the caller');
  assert.strictEqual(esp, ENTRY_ESP - 12, 'leaves three dwords: old SEH, handler, -1');
  assert.strictEqual(ebp, ENTRY_ESP,
    'EBP is the new frame (the dispatcher must not restore the caller\'s EBP)');
  assert.strictEqual(e.test_gl32(ebp) >>> 0, OLD_EBP, 'the frame slot holds the old EBP');
  assert.strictEqual(e.test_gl32(esp) >>> 0, OLD_SEH, '[ESP] = previous SEH head');
  assert.strictEqual(e.test_gl32(esp + 4) >>> 0, HANDLER, '[ESP+4] = handler from EAX');
  assert.strictEqual(e.test_gl32(esp + 8) >>> 0, 0xFFFFFFFF, '[ESP+8] = trylevel -1');
  assert.strictEqual(e.test_gl32(TIB) >>> 0, esp, 'fs:[0] points at the new record');
  assert.strictEqual(e.test_reg(12) >>> 0, 0x11111111, 'EBX preserved');
  assert.strictEqual(e.test_reg(24) >>> 0, 0x22222222, 'ESI preserved');
  assert.strictEqual(e.test_reg(28) >>> 0, 0x33333333, 'EDI preserved');

  console.log('PASS test-eh-prolog-frame');
}

main().catch(err => { console.error(err); process.exit(1); });
