'use strict';
const assert = require('assert');
const fs = require('fs');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
  (func (export "test_dialog_thunk") (result i32) (global.get $dialog_proc_ret_thunk))
  (func (export "test_clear_dialog_thunk") (global.set $dialog_proc_ret_thunk (i32.const 0)))
  (func (export "test_thunk") (param $id i32) (result i32)
    (local $addr i32)
    (local.set $addr (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $addr) (i32.const 0))
    (i32.store offset=4 (local.get $addr) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (i32.add (i32.sub (local.get $addr) (global.get $GUEST_BASE)) (global.get $image_base)))
  (func (export "test_start") (param $hwnd i32) (param $sub i32) (param $proc i32) (param $stack i32) (param $done i32) (param $msg i32)
    (call $wnd_table_set (local.get $hwnd) (local.get $sub))
    (drop (call $dialog_proc_set (local.get $hwnd) (local.get $proc)))
    (call $dialog_extra_set (local.get $hwnd) (i32.const 0) (i32.const 31))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $gs32 (local.get $stack) (local.get $done))
    (call $gs32 (i32.add (local.get $stack) (i32.const 4)) (local.get $hwnd))
    (call $gs32 (i32.add (local.get $stack) (i32.const 8)) (local.get $msg))
    (call $gs32 (i32.add (local.get $stack) (i32.const 12)) (i32.const 1559))
    (call $gs32 (i32.add (local.get $stack) (i32.const 16)) (i32.const 0x10004))
    (global.set $eip (local.get $sub)))
  (func (export "test_close") (param $hwnd i32)
    (local $esp i32)
    (local.set $esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_EndDialog (local.get $hwnd) (i32.const 99) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $esp)))
  (func (export "test_install") (param $hwnd i32) (param $sub i32) (param $proc i32)
    (call $wnd_table_set (local.get $hwnd) (local.get $sub))
    (drop (call $dialog_proc_set (local.get $hwnd) (local.get $proc))))
  (func (export "test_default") (param $proc i32) (param $stack i32) (param $msg i32)
    (call $wnd_table_set (i32.const 0x10024) (global.get $WNDPROC_DIALOG))
    (drop (call $dialog_proc_set (i32.const 0x10024) (local.get $proc)))
    (call $dialog_extra_set (i32.const 0x10024) (i32.const 0) (i32.const 77))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $gs32 (local.get $stack) (i32.const 0x401234))
    (call $handle_CallWindowProcA (global.get $WNDPROC_DIALOG)
      (i32.const 0x10024) (local.get $msg) (i32.const 0) (i32.const 0) (i32.const 0)))
`;
const u32 = n => [n, n >>> 8, n >>> 16, n >>> 24].map(x => x & 255);
(async () => {
  const { exports: e, memory, module, host } = await bootRenderHarness({extraWat});
  const pe = fs.readFileSync(require('path').join(__dirname, 'binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(pe, e.get_staging());
  assert(e.load_pe(pe.length));
  const dialogThunk = e.test_dialog_thunk();
  assert(dialogThunk,'PE loader initializes the dialog continuation');
  e.test_clear_dialog_thunk();
  e.sync_thunk_state(e.get_thunk_end(),e.get_num_thunks());
  assert.strictEqual(e.test_dialog_thunk(),dialogThunk,'thunk sync restores the continuation');
  const bytes = new Uint8Array(memory.buffer), view = new DataView(memory.buffer);
  const addr = p => p - e.get_image_base() + e.get_guest_base();
  const alloc = n => e.guest_alloc(n) >>> 0;
  const thunk = name => e.test_thunk(require('../src/api_table.json').find(x => x.name === name).id);
  const setLong = thunk('SetWindowLongA'), send = thunk('SendMessageA');
  // The DLGPROC itself stores DWL_MSGRESULT through the Win32 API.
  const setResult = value => [0x68,...u32(value),0x6a,0,0xff,0x74,0x24,12,
    0xb8,...u32(setLong),0xff,0xd0];
  const seen = alloc(32), template = alloc(64), nested = alloc(64), proc = alloc(128), sub = alloc(128), done = alloc(16);
  bytes.fill(0, addr(template), addr(template) + 64);
  view.setUint32(addr(template), 0x80000000, true);
  view.setUint16(addr(template) + 14, 80, true); view.setUint16(addr(template) + 16, 40, true);
  // The nested dialog remains open until the harness supplies EndDialog.
  bytes.set([0x81,0x7c,0x24,8,...u32(0x110),0x75,9,0x8b,0x44,0x24,4,0xa3,...u32(seen),0x31,0xc0,0xc2,16,0], addr(nested));
  bytes.set([0x6a,0,0x68,...u32(nested),0x6a,0,0x68,...u32(template),0x6a,0,0xb8,...u32(thunk('DialogBoxIndirectParamA')),0xff,0xd0,0xa3,...u32(seen+4),...setResult(77),0xb8,1,0,0,0,0xc2,16,0],addr(proc));
  // Subclass forwards its original four arguments and the native dialog marker.
  const forward = [0xff,0x74,0x24,16];
  bytes.set([...forward,...forward,...forward,...forward,0x68,...u32(0xffff0004),0xb8,...u32(thunk(process.env.DIALOG_CALL_VARIANT || 'CallWindowProcA')),0xff,0xd0,0xa3,...u32(seen+12),0xc7,0x05,...u32(seen+8),...u32(1),0xc2,16,0],addr(sub));
  bytes.set([0xeb,0xfe],addr(done));
  const stack = alloc(8192)+4096;
  const handled = alloc(16);
  for (const msg of [0x111,0x400,0x110,0x14]) for (const bool of
    (msg === 0x110 || msg === 0x14 ? [1] : [1,0])) {
    const callback = alloc(64); // fresh code: decoded x86 blocks are cached
    bytes.set([...setResult(77),0xb8,...u32(bool),0xc2,16,0],addr(callback));
    bytes.fill(0,addr(seen),addr(seen)+32);
    e.test_start(0x10020,sub,callback,stack,done,msg);
    e.run(100000);
    assert.strictEqual(view.getUint32(addr(seen+12),true),bool ? (msg === 0x110 ? 1 : 77) : 0,
      `actual x86 caller msg=${msg.toString(16)} BOOL=${bool} receives DWL_MSGRESULT/default`);
    assert.strictEqual(e.get_esp()>>>0,stack+20,'actual subclass and CallWindowProc stack cleanup');
    assert.strictEqual(e.get_eip()>>>0,done,'actual x86 caller resumes');
  }
  for (const msg of [0x111,0x400]) {
    e.test_start(0x10020,sub,0,stack,done,msg); e.run(100000);
    assert.strictEqual(view.getUint32(addr(seen+12),true),0,'no DLGPROC receives default zero through actual caller');
    assert.strictEqual(e.get_esp()>>>0,stack+20,'no DLGPROC caller stack cleanup');
  }
  // A nested SendMessage chains through another real subclass/CallWindowProc.
  // Inner FALSE and TRUE must neither overwrite the outer handled decision
  // nor make it read the other HWND's DWL_MSGRESULT.
  for (const bool of [0,1]) {
    const inner = alloc(64), outer = alloc(128), innerSub = alloc(128);
    bytes.set([...setResult(88),0xb8,...u32(bool),0xc2,16,0],addr(inner));
    bytes.set([...forward,...forward,...forward,...forward,0x68,...u32(0xffff0004),
      0xb8,...u32(thunk(process.env.DIALOG_CALL_VARIANT || 'CallWindowProcA')),0xff,0xd0,0xc2,16,0],addr(innerSub));
    e.test_install(0x10028,innerSub,inner);
    bytes.set([...setResult(77),0x6a,0,0x6a,0,0x68,...u32(0x400),0x68,...u32(0x10028),
      0xb8,...u32(send),0xff,0xd0,0xa3,...u32(seen+16),0xb8,1,0,0,0,0xc2,16,0],addr(outer));
    e.test_start(0x10020,sub,outer,stack,done,0x111); e.run(100000);
    assert.strictEqual(view.getUint32(addr(seen+16),true),bool ? 88 : 0,'nested sender receives its own result');
    assert.strictEqual(view.getUint32(addr(seen+12),true),77,'outer invocation retains its HWND and handled result');
    assert.strictEqual(e.get_esp()>>>0,stack+20,'nested send restores exact outer stack');
  }
  bytes.fill(0,addr(seen),addr(seen)+32);
  e.test_start(0x10020,sub,proc,stack,done,0x111);
  for(let i=0;i<8 && !view.getUint32(addr(seen),true);i++) e.run(100000);
  const hwnd = view.getUint32(addr(seen),true);
  assert(hwnd,'real nested WM_INITDIALOG ran');
  assert.strictEqual(view.getUint32(addr(seen+8),true),0,'subclass must remain suspended while nested dialog is open');
  // A second WASM thread runs a different invocation while the main callback
  // is parked in its modal loop. It shares memory and thunks, not live frames.
  const worker = (await WebAssembly.instantiate(module,{host})).exports;
  worker.init_thread(1,e.get_image_base(),e.get_code_start(),e.get_code_end(),
    e.get_thunk_base(),e.get_thunk_end(),e.get_num_thunks(),0);
  assert.strictEqual(worker.test_dialog_thunk(),dialogThunk,'worker restores the shared continuation address');
  const workerProc = alloc(64), workerStack = alloc(8192)+4096;
  bytes.set([...setResult(88),0xb8,1,0,0,0,0xc2,16,0],addr(workerProc));
  const parkedEsp = e.get_esp()>>>0;
  worker.test_start(0x10030,sub,workerProc,workerStack,done,0x400);
  worker.run(100000);
  assert.strictEqual(worker.get_eax(),88,'other thread receives its invocation result');
  assert.strictEqual(worker.get_esp()>>>0,workerStack+20,'other thread unwinds its own stack');
  assert.strictEqual(e.get_esp()>>>0,parkedEsp,'parked main thread stack is untouched');
  view.setUint32(addr(seen+8),0,true); // worker used the same recording subclass
  e.test_close(hwnd); e.clear_yield(); for(let i=0;i<8;i++) e.run(100000);
  assert.strictEqual(view.getUint32(addr(seen+4),true),99,'modal result reaches original DLGPROC');
  assert.strictEqual(view.getUint32(addr(seen+8),true),1,'original subclass resumes after modal completion');
  assert.strictEqual(view.getUint32(addr(seen+12),true),77,'modal continuation applies DWL_MSGRESULT after TRUE');
  assert.strictEqual(e.get_esp()>>>0,stack+20,'both stdcall frames unwind exactly');
  assert.strictEqual(e.get_eip()>>>0,done,'original dispatcher caller resumes');
  bytes.set([0xb8,1,0,0,0,0xc2,16,0],addr(handled));
  for(const [msg,result] of [[0x110,1],[0x14,77]]) {
    e.test_default(handled,stack,msg);
    assert.strictEqual(e.get_eax(),result,'default processing retains BOOL / DWL_MSGRESULT semantics');
    assert.strictEqual(e.get_esp()>>>0,stack+24,'synchronous default consumes the original five-argument frame');
  }
  e.test_default(0,stack,0);
  assert.strictEqual(e.get_eax(),0,'dialog without a DLGPROC retains default WM_NULL result');
  assert.strictEqual(e.get_esp()>>>0,stack+24,'no-DLGPROC default consumes all five arguments');
  console.log('PASS subclass CallWindowProc dialog nested modal continuation');
})().catch(err=>{console.error(err);process.exit(1);});
