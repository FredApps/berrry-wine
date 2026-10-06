#!/usr/bin/env node
'use strict';

// Browser Worker mode has two WebAssembly instances over one process memory:
// the guest Worker owns the parked MessageBox call, while the main-thread
// renderer shadow hit-tests and dispatches its WAT-built button. Private WASM
// globals cannot carry modal completion between those instances.

const assert = require('assert');
// Private fault injection at the real enqueue return boundary: emulate queue
// overflow allocation failure without exhausting the process's shared heap.
const compiler = require('./compile-src');
const compile = compiler.compileSrcWasm;
compiler.compileSrcWasm = (transform, options) => compile((file, source) => {
  if (file === '10-helpers.wat') {
    const signature = /(\(func \$post_queue_push_input\s+\(param \$hwnd i32\) \(param \$msg i32\) \(param \$wParam i32\) \(param \$lParam i32\) \(result i32\))/;
    assert(signature.test(source), 'queue failure injection must match actual enqueue helper');
    source = source.replace(signature, '$1\n    (if (global.get $test_modal_queue_fail) (then (return (i32.const 0))))');
  }
  return transform ? transform(file, source) : source;
}, options);
const { bootRenderHarness } = require('./render-helper');
compiler.compileSrcWasm = compile;

const extraWat = String.raw`
  (global $test_modal_queue_fail (mut i32) (i32.const 0))
  (func (export "test_queue_fail") (param $flag i32)
    (global.set $test_modal_queue_fail (local.get $flag)))
  (func (export "test_pending_input") (result i32) (global.get $pending_input_packed))
  (func (export "test_damage") (param $hwnd i32)
    (call $nc_flags_set (local.get $hwnd) (i32.const 2)))
  (func (export "test_damage_pending") (param $hwnd i32) (result i32)
    (i32.and (call $nc_flags_test (local.get $hwnd)) (i32.const 2)))
  (func (export "test_other_window") (param $hwnd i32) (param $tid i32)
    (global.set $current_thread_id (local.get $tid))
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000))
    (global.set $current_thread_id (i32.const 1)))
  (func (export "test_other_post") (param $hwnd i32)
    (drop (call $post_queue_push (local.get $hwnd) (i32.const 0x0601)
      (i32.const 77) (i32.const 88))))
  (func (export "test_real_messagebox") (param $text i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00120000))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00401000))
    (call $handle_MessageBoxA (i32.const 0) (local.get $text) (local.get $text)
      (i32.const 1) (i32.const 0) (i32.const 0))
    (global.get $modal_dlg_hwnd))
  (func (export "test_button") (param $dlg i32) (result i32)
    (call $ctrl_find_by_id (local.get $dlg) (i32.const 1)))
  (func (export "test_seed_completion") (param $seed i32)
    (global.set $modal_result (local.get $seed))
    (global.set $modal_ret_addr (i32.add (i32.const 0x401000) (local.get $seed)))
    (global.set $modal_saved_esp (i32.add (i32.const 0x120000) (local.get $seed)))
    (global.set $modal_esp_adjust (i32.add (i32.const 20) (local.get $seed)))
    (global.set $modal_restore_pending (i32.eqz (local.get $seed)))
    (global.set $modal_saved_ebx (i32.add (i32.const 11) (local.get $seed)))
    (global.set $modal_saved_esi (i32.add (i32.const 22) (local.get $seed)))
    (global.set $modal_saved_edi (i32.add (i32.const 33) (local.get $seed)))
    (global.set $modal_saved_ebp (i32.add (i32.const 44) (local.get $seed))))
  (func (export "test_restore_pending") (result i32) (global.get $modal_restore_pending))
  (func (export "test_complete_api")
    (i32.store (global.get $THUNK_BASE) (i32.const 0xCACA0006))
    (call $win32_dispatch (i32.const 0)))
  (func (export "test_modal_begin") (param $hwnd i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00120000))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00401000))
    (call $modal_begin (local.get $hwnd) (i32.const 20)))

  (func (export "test_modal_done") (param $result i32)
    (call $modal_done (local.get $result)))

  (func (export "test_modal_pump") (result i32)
    (call $modal_pump_step (global.get $modal_loop_thunk)))

  (func (export "test_modal_result") (result i32)
    (global.get $modal_result))
`;

(async () => {
  const memory = new WebAssembly.Memory({
    initial: 8192, maximum: 8192, shared: true,
  });
  let onDestroy = () => {};
  const worker = await bootRenderHarness({ extraWat, memory,
    extraHostOverrides: { destroy_window: hwnd => onDestroy(hwnd) } });
  const shadow = await bootRenderHarness({ extraWat, memory });
  const guest = worker.exports;
  const ui = shadow.exports;
  const hwnd = 0x10002;

  guest.test_modal_begin(hwnd);
  assert.strictEqual(guest.modal_dialog_hwnd() >>> 0, hwnd,
    'guest Worker publishes its common-modal hwnd');
  assert.strictEqual(ui.modal_dialog_hwnd() >>> 0, hwnd,
    'renderer shadow observes the Worker modal through shared memory');

  assert.strictEqual(guest.test_modal_pump(), 1, 'open modal remains in its pump');
  assert.strictEqual(guest.get_yield_reason(), 15, 'idle native modal uses queue sleep');
  guest.clear_yield();

  ui.test_modal_done(1);
  assert.strictEqual(ui.modal_dialog_hwnd() >>> 0, hwnd,
    'shadow only signals completion; the owning Worker performs teardown');
  assert.strictEqual(guest.test_modal_pump(), 0,
    'owning Worker consumes the shared completion on its next pump turn');
  assert.strictEqual(guest.test_modal_result(), 1,
    'MessageBox returns the button result in the owning instance');
  assert.strictEqual(guest.modal_dialog_hwnd(), 0,
    'Worker teardown clears the shared modal hwnd for the renderer');

  guest.test_modal_begin(hwnd);
  ui.modal_cancel_if_hwnd(hwnd);
  assert.strictEqual(guest.test_modal_pump(), 0,
    'renderer-side modal cancellation also resumes the owning Worker');
  assert.strictEqual(guest.test_modal_result(), 0,
    'renderer-side cancellation preserves the cancel result');

  // A reentrant teardown can finish another dialog on the same instance.
  // Inject its continuation writes, then exercise the actual CACA0006 return.
  for (const fromShadow of [false, true]) {
    guest.test_modal_begin(hwnd);
    guest.test_seed_completion(0);
    let reentries = 0;
    onDestroy = target => {
      assert.strictEqual(target >>> 0, hwnd);
      reentries++;
      guest.test_seed_completion(256);
    };
    (fromShadow ? ui : guest).test_modal_done(42);
    if (fromShadow) assert.strictEqual(guest.test_modal_pump(), 0);
    assert.strictEqual(reentries, 1);
    assert.strictEqual(guest.test_modal_result(), 42, 'outer completion owns the result');
    assert.strictEqual(guest.test_restore_pending(), 1, 'outer restore marker survives reentry');
    guest.test_complete_api();
    assert.strictEqual(guest.get_eax(), 42);
    assert.strictEqual(guest.get_eip(), 0x401000);
    assert.strictEqual(guest.get_esp(), 0x120000 + 20);
    assert.deepStrictEqual([guest.get_ebx(), guest.get_esi(), guest.get_edi(), guest.get_ebp()],
      [11, 22, 33, 44], 'outer nonvolatile registers survive nested completion');
    assert.strictEqual(guest.test_restore_pending(), 0);
  }
  console.log('PASS  common modal Worker completion and reentrant API frame ownership');

  // Unlike direct modal_done above, ordinary input starts in a renderer queue.
  // Two actual instances share HWND/control memory, but only one owns the API.
  const shared = new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
  let renderer, event=null, pulls=0, shadowCalls=0;
  const owner = await bootRenderHarness({extraWat,memory:shared,extraHostOverrides:{
    check_input:()=>{pulls++;event=renderer.takeInput();return event?((event.wParam<<16)|event.msg):0;},
    check_input_hwnd:()=>event?.hwnd||0,
    check_input_lparam:()=>event?.lParam||0,
  }});
  const page = await bootRenderHarness({extraWat,memory:shared,extraHostOverrides:{
    check_input:()=>{shadowCalls++;throw Error('shadow polled guest input');},
    get_window_rect:(...args)=>owner.host.get_window_rect(...args),
  }});
  const live=owner.exports, idle=page.exports;
  idle.set_host_shadow(1);
  // Geometry reads use the real second instance; any synchronous control or
  // dialog callback through its UI token is a regression, even if it happens
  // to complete this simple box using shared result fields.
  const forbidden=new Set(['send_message','dialog_route_mouse','dialog_route_mouse_screen','dialog_handle_key']);
  const pageToken={exports:Object.fromEntries(Object.entries(idle).map(([name,value])=>
    [name,forbidden.has(name)?()=>{shadowCalls++;throw Error('shadow callback '+name);}:value]))};
  renderer=owner.renderer;
  renderer.wasm=pageToken;
  renderer._inputWasmRunsInGuestWorker=()=>true;
  renderer._wakeMessageWait=()=>{};
  renderer._publishInputQueueDepth=()=>{};
  const text=live.guest_alloc(3);live.guest_write8(text,79);live.guest_write8(text+1,75);live.guest_write8(text+2,0);
  const open=()=>{
    const dlg=live.test_real_messagebox(text)>>>0;
    for(const win of Object.values(renderer.windows))win.wasm=pageToken;
    return {dlg,button:live.test_button(dlg)>>>0};
  };
  const first=open();
  live.test_other_window(0x18001,1);live.test_other_window(0x18002,2);
  live.test_other_post(0x18001);
  renderer.inputQueue.push({hwnd:0x18001,msg:0x200,wParam:3,lParam:0x00110022});
  renderer.inputQueue.push({hwnd:0x18002,msg:0x200,wParam:4,lParam:0x00330044});
  const x=live.wnd_window_screen_x(first.button)+12,y=live.wnd_window_screen_y(first.button)+12;
  renderer.handleMouseDown(x,y,0);
  renderer.handleMouseUp(x,y,0);
  assert(renderer.inputQueue.some(e=>e.msg===0x201&&e.hwnd===first.button),'real renderer publishes button down');
  assert(renderer.inputQueue.some(e=>e.msg===0x202&&e.hwnd===first.button),'real renderer publishes button up');
  for(let i=0;i<64&&live.modal_dialog_hwnd();i++){live.clear_yield();live.test_modal_pump();}
  assert.equal(live.modal_dialog_hwnd(),0,'owning pump pulls ordinary click and completes modal');
  assert.equal(live.test_modal_result(),1);
  assert.equal(renderer.inputQueue.length,0);
  assert(pulls>=2);
  assert.equal(shadowCalls,0);
  const base=require('../lib/region-map.generated').BASE,words=new DataView(shared.buffer);
  const queued=tid=>{
    const p=base.THREAD_MSG_QUEUES+(tid-1)*1040,count=words.getUint32(p,true),head=words.getUint32(p+4,true);
    return Array.from({length:count},(_,i)=>Array.from({length:4},(_,j)=>words.getUint32(p+16+((head+i)%64)*16+j*4,true)));
  };
  assert(queued(1).some(m=>m[0]===0x18001&&m[1]===0x601&&m[2]===77&&m[3]===88),'existing unrelated post survives modal');
  assert(queued(1).some(m=>m[0]===0x18001&&m[1]===0x200&&m[2]===3&&m[3]===0x00110022),'unrelated pulled input retained');
  assert(queued(2).some(m=>m[0]===0x18002&&m[1]===0x200&&m[2]===4&&m[3]===0x00330044),'other-thread input forwarded without callback');
  live.test_complete_api();
  assert.equal(live.get_eax(),1);assert.equal(live.get_eip(),0x401000);
  for(const [key,result]of [[13,1],[27,2]]){
    open();renderer.inputQueue.push({hwnd:0,msg:0x100,wParam:key,lParam:1});
    for(let i=0;i<64&&live.modal_dialog_hwnd();i++){live.clear_yield();live.test_modal_pump();}
    assert.equal(live.modal_dialog_hwnd(),0);assert.equal(live.test_modal_result(),result);
  }
  const cancelled=open(),cx=live.wnd_window_screen_x(cancelled.button),cy=live.wnd_window_screen_y(cancelled.button);
  renderer.handleMouseDown(cx+12,cy+12,0);
  for(let i=0;i<8;i++){live.clear_yield();live.test_modal_pump();}
  renderer.handleMouseUp(cx-4,cy+12,0);
  for(let i=0;i<8;i++){live.clear_yield();live.test_modal_pump();}
  assert.equal(live.modal_dialog_hwnd()>>>0,cancelled.dlg,'release outside button cancels press without IDOK');
  renderer.inputQueue.push({hwnd:0,msg:0x100,wParam:27,lParam:1});
  live.clear_yield();live.test_modal_pump();
  assert.equal(live.modal_dialog_hwnd(),0);assert.equal(shadowCalls,0);
  const fairness=open();
  for(let i=0;i<8;i++){live.clear_yield();live.test_modal_pump();}
  live.test_damage(fairness.dlg);
  for(let i=0;i<20;i++)renderer.inputQueue.push({hwnd:fairness.button,msg:0x200,wParam:0,lParam:0x000c000c});
  live.clear_yield();live.test_modal_pump();
  assert.equal(live.test_damage_pending(fairness.dlg),0,'pending erase progresses despite continuous input');
  assert.equal(renderer.inputQueue.length,19,'one event per pump preserves fairness');
  renderer.inputQueue.length=0;
  live.test_queue_fail(1);
  renderer.inputQueue.push({hwnd:0x18001,msg:0x200,wParam:5,lParam:0x00550066});
  live.clear_yield();live.test_modal_pump();const beforeRetry=pulls;
  assert.equal(live.test_pending_input(),(5<<16)|0x200,'failed local enqueue retains packed event');
  live.clear_yield();live.test_modal_pump();
  assert.equal(pulls,beforeRetry,'retry does not consume the next host event');
  live.test_queue_fail(0);live.clear_yield();live.test_modal_pump();
  assert.equal(live.test_pending_input(),0);
  assert(queued(1).some(m=>m[0]===0x18001&&m[1]===0x200&&m[2]===5&&m[3]===0x00550066),'retry preserves exact original target and lParam');
  renderer.inputQueue.push({hwnd:0,msg:0x100,wParam:27,lParam:1});live.clear_yield();live.test_modal_pump();
  assert.equal(live.modal_dialog_hwnd(),0);
  console.log('PASS real shared-memory owner pulls renderer down/up and modal keys without shadow callbacks');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
