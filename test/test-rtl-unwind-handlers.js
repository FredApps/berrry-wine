#!/usr/bin/env node
'use strict';

// RtlUnwind must call every frame handler between FS:[0] and TargetFrame with
// EXCEPTION_UNWINDING set, unlink each one after its handler returns, leave
// TargetFrame itself installed, and return to its caller with ReturnValue.
// The old handler only rewrote FS:[0] = TargetFrame->next: no __finally or C++
// unwind code ever ran in the frames it tore down, which left msvcr71's
// FRAMEINFO chain holding a dead stack frame and hung UT2004's map load.
//
// The handlers are guest code, so this drives the 0xCACA0039 continuation by
// hand: check where RtlUnwind sent the thread, "return" from the handler with
// a disposition in EAX, and dispatch the thunk the handler returned to.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const FS = 0x00310000;
const A = 0x00300100;       // innermost (top) registration, above the raiser like a caller frame
const B = 0x00300200;
const T = 0x00300300;       // target
const OUTER = 0x00300400;
const HA = 0x00401000, HB = 0x00402000, HT = 0x00403000;
const RET = 0x00405555;
const REC = 0x00320000;

const extraWat = String.raw`
  (func (export "t_init")
    (global.set $image_base (i32.const 0))
    (global.set $thunk_guest_base (i32.sub (global.get $THUNK_BASE) (global.get $GUEST_BASE)))
    (global.set $fs_base (i32.const ${FS})))
  (func (export "t_w") (param $a i32) (param $v i32) (call $gs32 (local.get $a) (local.get $v)))
  (func (export "t_r") (param $a i32) (result i32) (call $gl32 (local.get $a)))
  (func (export "t_reg") (param $i i32) (result i32)
    (i32.load (i32.add (global.get $reg_base) (i32.shl (local.get $i) (i32.const 2)))))
  (func (export "t_set_reg") (param $i i32) (param $v i32)
    (i32.store (i32.add (global.get $reg_base) (i32.shl (local.get $i) (i32.const 2))) (local.get $v)))
  (func (export "t_eip") (result i32) (global.get $eip))
  (func (export "t_steps") (result i32) (global.get $steps))
  ;; Guest call RtlUnwind(target, ip, rec, retval): ESP at the return address.
  (func (export "t_call") (param $target i32) (param $rec i32) (param $retval i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $gs32 (i32.const ${STACK}) (i32.const ${RET}))
    (call $gs32 (i32.const ${STACK + 4}) (local.get $target))
    (call $gs32 (i32.const ${STACK + 8}) (i32.const 0x00409999))
    (call $gs32 (i32.const ${STACK + 12}) (local.get $rec))
    (call $gs32 (i32.const ${STACK + 16}) (local.get $retval))
    (global.set $steps (i32.const 77))
    (call $handle_RtlUnwind (local.get $target) (i32.const 0x00409999)
      (local.get $rec) (local.get $retval) (i32.const 0) (i32.const 0)))
  ;; RtlUnwind called from a handler running on the stack at $esp.
  (func (export "t_call_at") (param $esp i32) (param $target i32) (param $rec i32) (param $retval i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs32 (local.get $esp) (i32.const ${RET}))
    (call $gs32 (i32.add (local.get $esp) (i32.const 4)) (local.get $target))
    (call $gs32 (i32.add (local.get $esp) (i32.const 12)) (local.get $rec))
    (call $gs32 (i32.add (local.get $esp) (i32.const 16)) (local.get $retval))
    (call $handle_RtlUnwind (local.get $target) (i32.const 0)
      (local.get $rec) (local.get $retval) (i32.const 0) (i32.const 0)))
  ;; Guest code calling handler(rec, frame, 0, dc) where handler is a thunk.
  (func (export "t_call_handler") (param $h i32) (param $rec i32) (param $frame i32) (param $dc i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK - 0x800}))
    (call $gs32 (i32.const ${STACK - 0x800}) (i32.const ${RET}))
    (call $gs32 (i32.const ${STACK - 0x800 + 4}) (local.get $rec))
    (call $gs32 (i32.const ${STACK - 0x800 + 8}) (local.get $frame))
    (call $gs32 (i32.const ${STACK - 0x800 + 12}) (i32.const 0))
    (call $gs32 (i32.const ${STACK - 0x800 + 16}) (local.get $dc))
    (global.set $steps (i32.const 77))
    (call $win32_dispatch
      (i32.div_u (i32.sub (local.get $h) (global.get $thunk_guest_base)) (i32.const 8))))
  ;; RaiseException's dispatch, entered with ESP at the raiser's stack.
  (func (export "t_raise") (param $code i32)
    (if (i32.eqz (global.get $delphi_seh_thunk))
      (then (global.set $delphi_seh_thunk (call $com_cont_thunk (i32.const 0xCACA000E)))))
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $raise_delphi_exception (local.get $code) (i32.const 0) (i32.const 0) (i32.const 0)))
  (func (export "t_rec") (result i32) (global.get $delphi_exception_record))
  ;; The running handler executes RET with a disposition in EAX; the return
  ;; address it pops is the continuation thunk, which the thread then enters.
  (func (export "t_handler_returns") (param $disp i32) (result i32)
    (local $esp i32) (local $thunk i32)
    (local.set $esp (i32.load offset=16 (global.get $reg_base)))
    (local.set $thunk (call $gl32 (local.get $esp)))
    (i32.store offset=16 (global.get $reg_base) (i32.add (local.get $esp) (i32.const 4)))
    (i32.store offset=0 (global.get $reg_base) (local.get $disp))
    (call $win32_dispatch
      (i32.div_u (i32.sub (local.get $thunk) (global.get $thunk_guest_base)) (i32.const 8)))
    (local.get $thunk))
`;

(async () => {
  const exits = [];
  const { exports: wat } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: { exit: code => exits.push(code >>> 0) },
  });
  const u = v => v >>> 0;
  wat.t_init();

  function chain() {
    wat.t_w(FS, A);
    wat.t_w(A, B); wat.t_w(A + 4, HA);
    wat.t_w(B, T); wat.t_w(B + 4, HB);
    wat.t_w(T, OUTER); wat.t_w(T + 4, HT);
    wat.t_w(OUTER, 0xFFFFFFFF); wat.t_w(OUTER + 4, 0x00404000);
  }
  // Handler call frame: [ESP]=thunk, +4 rec, +8 establisher, +12 ctx, +16 &dispatcher.
  function frame() {
    const esp = u(wat.t_reg(4));
    return {
      esp, thunk: u(wat.t_r(esp)), rec: u(wat.t_r(esp + 4)),
      est: u(wat.t_r(esp + 8)), ctx: u(wat.t_r(esp + 12)), dc: u(wat.t_r(esp + 16)),
    };
  }

  // --- targeted unwind with a caller-supplied record ---------------------
  chain();
  wat.t_w(REC, 0xE06D7363); wat.t_w(REC + 4, 1);
  wat.t_set_reg(3, 0x0B0B0B0B); wat.t_set_reg(6, 0x5151); wat.t_set_reg(7, 0xD1D1); wat.t_set_reg(5, 0xBEBE);
  wat.t_call(T, REC, 0x1234);
  assert.strictEqual(u(wat.t_eip()), HA, 'the innermost frame handler runs first');
  assert.strictEqual(wat.t_steps(), 0, 'RtlUnwind owns EIP');
  let f = frame();
  assert.ok(f.esp < STACK, 'the handler runs below the RtlUnwind caller frame');
  assert.strictEqual(f.rec, REC, 'handlers see the caller\'s exception record');
  assert.strictEqual(u(wat.t_r(REC + 4)), 1 | 2, 'EXCEPTION_UNWINDING is set in place');
  assert.strictEqual(f.est, A, 'establisher frame is the frame being unwound');
  assert.strictEqual(u(wat.t_r(f.ctx + 0xb8)), RET, 'CONTEXT.Eip is the caller\'s return address');
  assert.strictEqual(u(wat.t_r(f.ctx + 0xc4)), STACK + 20, 'CONTEXT.Esp has the stdcall frame popped');
  assert.strictEqual(u(wat.t_r(FS)), A, 'a frame stays linked while its handler runs');

  // The handler clobbers callee-saved registers and its own argument slots.
  wat.t_set_reg(3, 0); wat.t_set_reg(5, 0); wat.t_w(f.esp + 8, 0xDEAD);
  wat.t_handler_returns(1);
  assert.strictEqual(u(wat.t_r(FS)), B, 'A is unlinked after its handler returns');
  assert.strictEqual(u(wat.t_eip()), HB, 'then B\'s handler runs');
  f = frame();
  assert.strictEqual(f.est, B, 'B is its establisher even after A clobbered its args');

  wat.t_handler_returns(1);
  assert.deepStrictEqual(exits, []);
  assert.strictEqual(u(wat.t_r(FS)), T, 'TargetFrame stays installed');
  assert.strictEqual(u(wat.t_eip()), RET, 'RtlUnwind returns to its caller');
  assert.strictEqual(u(wat.t_reg(4)), STACK + 20, 'stdcall: four arguments popped');
  assert.strictEqual(u(wat.t_reg(0)), 0x1234, 'EAX = ReturnValue');
  assert.strictEqual(u(wat.t_reg(3)), 0x0B0B0B0B, 'EBX restored');
  assert.strictEqual(u(wat.t_reg(5)), 0xBEBE, 'EBP restored');
  assert.strictEqual(u(wat.t_reg(6)), 0x5151, 'ESI preserved');
  assert.strictEqual(u(wat.t_reg(7)), 0xD1D1, 'EDI preserved');

  // --- unwinding to the frame that is already on top is a no-op call -----
  chain();
  wat.t_call(A, REC, 7);
  assert.strictEqual(u(wat.t_eip()), RET, 'no frame above the target: straight back');
  assert.strictEqual(u(wat.t_r(FS)), A);
  assert.strictEqual(u(wat.t_reg(0)), 7);

  // --- exit unwind (TargetFrame NULL) with no record ---------------------
  chain();
  wat.t_call(0, 0, 0);
  f = frame();
  assert.strictEqual(u(wat.t_eip()), HA);
  assert.strictEqual(u(wat.t_r(f.rec)), 0xC0000027, 'a missing record becomes STATUS_UNWIND');
  assert.strictEqual(u(wat.t_r(f.rec + 4)), 2 | 4, 'UNWINDING | EXIT_UNWIND');
  assert.strictEqual(u(wat.t_r(f.rec + 12)), RET, 'raised at the caller\'s return address');
  wat.t_handler_returns(1);
  wat.t_handler_returns(1);
  assert.strictEqual(u(wat.t_eip()), HT, 'an exit unwind runs past the target frames too');
  wat.t_handler_returns(1);
  assert.strictEqual(u(wat.t_eip()), 0x00404000);
  wat.t_handler_returns(1);
  assert.strictEqual(u(wat.t_r(FS)), 0xFFFFFFFF, 'the whole chain is gone');
  assert.strictEqual(u(wat.t_eip()), RET);

  // --- ExceptionCollidedUnwind resumes from the dispatcher context frame --
  chain();
  wat.t_call(OUTER, REC, 0);
  f = frame();
  wat.t_w(f.dc, B);             // a nested unwind already reached B
  wat.t_handler_returns(3);
  assert.strictEqual(u(wat.t_r(FS)), T, 'the collided frame B is unlinked, not re-run');
  assert.strictEqual(u(wat.t_eip()), HT, 'the walk continues at B\'s successor');
  wat.t_handler_returns(1);
  assert.strictEqual(u(wat.t_r(FS)), OUTER);
  assert.strictEqual(u(wat.t_eip()), RET);

  // --- the dispatcher's own registration node ----------------------------
  // msvcr71 _UnwindNestedFrames: saved = FS:[0]; RtlUnwind(catching frame);
  // saved->next = FS:[0]; FS:[0] = saved. With the catching frame on top and
  // no dispatcher node, saved IS that frame and the relink points it at itself.
  chain();
  wat.t_raise(0xE06D7363);
  f = frame();
  assert.strictEqual(u(wat.t_eip()), HA, 'the search calls the top frame\'s handler');
  assert.strictEqual(f.est, A);
  const node = u(wat.t_r(FS));
  assert.notStrictEqual(node, A, 'a dispatcher node heads the chain while the handler runs');
  assert.strictEqual(u(wat.t_r(node)), A, 'the node links to the chain head');
  assert.ok(node > f.esp && node < STACK, 'the node sits between the handler frame and the raiser');

  // Handler A returns ExceptionContinueSearch: the node goes, B is offered it.
  wat.t_handler_returns(1);
  assert.strictEqual(u(wat.t_eip()), HB, 'continue search reaches B');
  f = frame();
  const node2 = u(wat.t_r(FS));
  assert.strictEqual(u(wat.t_r(node2)), A, 'a fresh node for B over the untouched chain');

  // B catches: _UnwindNestedFrames(B) as msvcr71 writes it.
  const saved = u(wat.t_r(FS));
  const handlerEsp = f.esp;
  wat.t_set_reg(4, handlerEsp - 64);
  wat.t_call_at(handlerEsp - 64, B, u(wat.t_rec()), 0);
  assert.strictEqual(u(wat.t_eip()), HA, 'A is unwound');
  wat.t_handler_returns(1);
  assert.strictEqual(u(wat.t_eip()), RET, 'the node is unlinked without a call, B stays');
  assert.strictEqual(u(wat.t_r(FS)), B);
  wat.t_w(saved, u(wat.t_r(FS)));
  wat.t_w(FS, saved);
  assert.strictEqual(u(wat.t_r(B)), T, 'B keeps its own next link: no self-cycle');
  assert.strictEqual(u(wat.t_r(saved)), B, 'the node is relinked over B, as on NT');

  // A later raise (the catch block rethrowing) skips the stale node.
  wat.t_raise(0xE06D7363);
  f = frame();
  assert.strictEqual(u(wat.t_eip()), HB, 'the old node is skipped, not called');
  assert.strictEqual(f.est, B);

  // The node's handler, called by guest code: nested exception / continue search.
  const nodeThunk = u(wat.t_r(saved + 4));
  wat.t_w(REC + 4, 0);
  const dcAddr = REC + 0x40;
  wat.t_call_handler(nodeThunk, REC, saved, dcAddr);
  assert.strictEqual(u(wat.t_reg(0)), 2, 'search phase: ExceptionNestedException');
  assert.strictEqual(u(wat.t_r(dcAddr)), B, 'names the frame whose handler was running');
  assert.strictEqual(u(wat.t_eip()), RET, 'and returns');
  wat.t_w(REC + 4, 2);
  wat.t_call_handler(nodeThunk, REC, saved, dcAddr);
  assert.strictEqual(u(wat.t_reg(0)), 1, 'unwinding: ExceptionContinueSearch');

  assert.deepStrictEqual(exits, []);
  console.log('PASS  RtlUnwind calls intermediate handlers with EXCEPTION_UNWINDING and keeps the target');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
