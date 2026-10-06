#!/usr/bin/env node
'use strict';

// KERNEL32!DebugBreak and FatalAppExitA. Carmageddon 2's BRender driver loader
// resolves both by name through GetProcAddress and refuses to load a renderer
// when either is missing ("Could not resolve imported symbol KERNEL32:...").
// DebugBreak is an int3: EXCEPTION_BREAKPOINT to the caller's SEH chain,
// resuming after the call if a handler continues, ending the process when
// nothing handles it. FatalAppExitA logs its text and exits with 0, as Wine
// does after its message box.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_init")
    (global.set $image_base (i32.const 0x00400000))
    (global.set $fs_base (i32.const 0x00450000)))
  ;; [esp] = return address, then call the handler as the dispatcher would.
  (func (export "t_call") (param $which i32) (param $esp i32) (param $ret i32)
      (param $a1 i32) (param $a2 i32)
    (call $gs32 (local.get $esp) (local.get $ret))
    (call $gs32 (i32.add (local.get $esp) (i32.const 4)) (local.get $a1))
    (call $gs32 (i32.add (local.get $esp) (i32.const 8)) (local.get $a2))
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (global.set $delphi_exception_record (i32.const 0))
    (if (i32.eqz (local.get $which))
      (then (call $handle_DebugBreak (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_FatalAppExitA (local.get $a1) (local.get $a2) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))))
  (func (export "t_set_chain") (param $rec i32)
    (call $gs32 (global.get $fs_base) (local.get $rec)))
  (func (export "t_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "t_resume_eip") (result i32) (global.get $delphi_resume_eip))
  (func (export "t_code") (result i32)
    (if (result i32) (global.get $delphi_exception_record)
      (then (call $gl32 (global.get $delphi_exception_record)))
      (else (i32.const 0))))
  (func (export "t_poke_str") (param $at i32) (param $c0 i32) (param $c1 i32)
    (call $gs32 (local.get $at) (local.get $c0))
    (call $gs32 (i32.add (local.get $at) (i32.const 4)) (local.get $c1)))
`;

(async () => {
  const exits = [];
  const logs = [];
  let memory = null;
  const { exports: e, hostCtx, memory: mem } = await bootRenderHarness({
    extraWat, fonts: 'none',
    extraHostOverrides: {
      exit: code => exits.push(code >>> 0),
      log: (wa, len) => logs.push(Buffer.from(memory.buffer, wa, len).toString('latin1')),
    },
  });
  memory = mem;
  hostCtx.onExit = code => exits.push(code >>> 0);
  {
    e.t_init();
    const STACK = 0x00480000, RET = 0x00401234, SEH = 0x00470000;

    // DebugBreak with a registered handler: EXCEPTION_BREAKPOINT reaches the
    // chain, the frame resumes after the call, the return address is popped.
    e.t_poke_str(SEH, 0xffffffff, 0x00401500);   // {next=-1, handler}
    e.t_set_chain(SEH);
    e.t_call(0, STACK, RET, 0, 0);
    assert.strictEqual(e.t_code() >>> 0, 0x80000003, 'DebugBreak raises EXCEPTION_BREAKPOINT');
    assert.strictEqual(e.t_resume_eip() >>> 0, RET, 'a continuing handler resumes after the call');
    assert.deepStrictEqual(exits, [], 'a handled breakpoint does not end the process');

    // No handler at all: the process ends instead of running on.
    e.t_set_chain(0xffffffff);
    e.t_call(0, STACK, RET, 0, 0);
    assert.strictEqual(exits.length, 1, 'an unhandled breakpoint ends the process');
    exits.length = 0;

    // FatalAppExitA(0, "Boom"): the text reaches the log, exit code 0, and
    // both arguments are popped.
    const MSG = 0x00460000;
    e.t_poke_str(MSG, 0x6d6f6f42, 0);             // "Boom\0"
    e.t_call(1, STACK, RET, 0, MSG);
    assert.deepStrictEqual(exits, [0], 'FatalAppExitA exits with code 0');
    assert.strictEqual(e.t_esp() >>> 0, STACK + 12, 'stdcall pops the return address and two arguments');
  }
  assert(logs.some(line => line.includes('Boom')), `FatalAppExitA logs its message (got ${JSON.stringify(logs.slice(-5))})`);
  console.log('PASS DebugBreak raises EXCEPTION_BREAKPOINT to the SEH chain; FatalAppExitA logs and exits 0');
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
