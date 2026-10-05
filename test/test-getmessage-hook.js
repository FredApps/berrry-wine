'use strict';
// Requires a serialized private compile grant. This script never writes the
// canonical module or source. --before runs exactly the frozen control.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const {compileSrcWasm}=require(ROOT+'/test/compile-src');
const {createHostImports}=require(ROOT+'/lib/host-imports');
const apiTable=require(ROOT+'/src/api_table.json');
const variant='after';
const extra=String.raw`
  (func (export "gm_install") (param $proc i32) (param $owner i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowsHookExA (i32.const 3) (local.get $proc) (i32.const 0) (local.get $owner) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
  (func (export "gm_unhook") (param $handle i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_UnhookWindowsHookEx (local.get $handle) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
  (func (export "gm_keyboard") (param $proc i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowsHookExA (i32.const 2) (local.get $proc) (i32.const 0) (global.get $current_thread_id) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
  (func (export "gm_post") (param $tid i32) (param $msg i32) (param $wp i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_PostThreadMessageA (local.get $tid) (local.get $msg) (local.get $wp) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
  (func (export "gm_retrieve") (param $msg i32) (param $peek i32) (param $remove i32) (result i32)
    (global.set $yield_flag (i32.const 0))
    (global.set $yield_reason (i32.const 0))
    (global.set $code16 (i32.const 0))
    (global.set $eip (i32.const 0))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0))
    (if (local.get $peek)
      (then (call $handle_PeekMessageA (local.get $msg) (i32.const 0) (i32.const 0) (i32.const 0) (local.get $remove) (i32.const 0)))
      (else (call $handle_GetMessageA (local.get $msg) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (global.get $eip))
  (func (export "gm_thunk") (param $api i32) (result i32)
    (local $addr i32)
    (local.set $addr (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $addr) (i32.const 0))
    (i32.store offset=4 (local.get $addr) (local.get $api))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (i32.add (i32.sub (local.get $addr) (global.get $GUEST_BASE)) (global.get $image_base)))
`;
const start=Date.now();
const bytes=compileSrcWasm((name,s)=>{
 let source=s;
 if(variant==='after'&&name==='09a-handlers4-late.wat'){
   const anchor='(local.set $node (call $heap_alloc (size-of GetMessageHookNode)))';
   assert.equal(source.split(anchor).length,2,'actual allocation gap is unique');
   source=source.replace(anchor,anchor+'\n    (if (global.get $gm_test_retire) (then (global.set $gm_test_retire (i32.const 0)) (call $getmessage_hook_reset (local.get $tid))))');
 }
 const race=variant==='after'?String.raw`
  (global $gm_test_retire (mut i32) (i32.const 0))
  (func (export "gm_arm_retire_race") (global.set $gm_test_retire (i32.const 1)))
 `:'';
 return name==='13-exports.wat'?source+'\n'+extra+race:source;
});
const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
function imports(ctx){const i=createHostImports(ctx);i.host.memory=memory;
 Object.assign(i.host,{create_thread:()=>0,exit_thread:()=>0,terminate_thread:()=>0,
 create_event:()=>0,set_event:()=>0,reset_event:()=>0,wait_single:()=>0,wait_multiple:()=>0,
 check_input:()=>ctx.hardware?.shift()||0,check_input_hwnd:()=>0,check_input_lparam:()=>0x10001});return i;}
const moduleObj=new WebAssembly.Module(bytes),ctx={getMemory:()=>memory.buffer,onExit:()=>{}};
const e=new WebAssembly.Instance(moduleObj,imports(ctx)).exports;ctx.exports=e;
const fixture=fs.readFileSync(ROOT+'/test/binaries/calc.exe');
new Uint8Array(memory.buffer).set(fixture,e.get_staging());assert(e.load_pe(fixture.length));e.init_dx_com_thunks();
const base=e.get_image_base()>>>0,wa=e.get_guest_base()>>>0,view=new DataView(memory.buffer),mem=new Uint8Array(memory.buffer);
const off=a=>(a-base+wa)>>>0,put=(a,v)=>view.setUint32(off(a),v>>>0,true),get=a=>view.getUint32(off(a),true);
const u32=v=>[v&255,v>>>8&255,v>>>16&255,v>>>24&255];
const observed=e.guest_alloc(32)>>>0,msg=e.guest_alloc(28)>>>0,hook=e.guest_alloc(96)>>>0;
// Real stdcall HookProc records HC_ACTION/PM_* and original MSG pointer, edits
// MSG.wParam and returns nonzero. No host mock simulates hook delivery.
mem.set(Uint8Array.from([
 0xff,0x05,...u32(observed),
 0x8b,0x44,0x24,0x04,0xa3,...u32(observed+4),
 0x8b,0x44,0x24,0x08,0xa3,...u32(observed+8),
 0x8b,0x44,0x24,0x0c,0xa3,...u32(observed+12),
 0x8b,0x50,0x08,0x89,0x15,...u32(observed+16),
 0x8b,0x15,...u32(observed+20),0x89,0x15,...u32(observed+24),
 0xc7,0x40,0x08,...u32(0x12345678),
 0xb8,...u32(0xdeadbeef),0xc2,0x0c,0x00
]),off(hook));
const handle=e.gm_install(hook,1)>>>0;
assert.notEqual(handle,0,'WH_GETMESSAGE registration must succeed (expected frozen-before failure)');
function retrieve(owner,peek,remove){const sp=owner.get_esp()>>>0;owner.gm_retrieve(msg,peek,remove);
 for(let i=0;i<40&&owner.get_eip();i++)owner.run(5000);
 assert.equal(owner.get_eip()>>>0,0,'callback returns to actual USER caller');
 assert.equal(owner.get_esp()>>>0,sp+(peek?24:20),'exact stdcall and callback stack cleanup');return owner.get_eax()>>>0;}
assert.equal(e.gm_post(1,0x400,0x69),1);assert.equal(retrieve(e,1,0),1);
assert.equal(get(observed),1);assert.equal(get(observed+4),0);assert.equal(get(observed+8),0);
assert.equal(get(observed+12),msg);assert.equal(get(msg+8),0x12345678);
assert.equal(retrieve(e,1,1),1);assert.equal(get(observed),2);assert.equal(get(observed+8),1);
assert.equal(get(observed+16),0x69,'PM_NOREMOVE edits did not rewrite queued original');
assert.equal(retrieve(e,1,1),0);assert.equal(get(observed),2,'empty peek invokes no hook');
assert.equal(e.gm_post(1,0x400,0x70),1);assert.equal(retrieve(e,0,1),1);
assert.equal(get(observed),3);assert.equal(get(observed+8),1);
assert.equal(e.gm_post(1,0x12,0),1);assert.equal(retrieve(e,0,1),0,'WM_QUIT result ignores nonzero hook result');
const nextThunk=e.gm_thunk(apiTable.find(x=>x.name==='CallNextHookEx').id)>>>0;
const unhookThunk=e.gm_thunk(apiTable.find(x=>x.name==='UnhookWindowsHookEx').id)>>>0;
const newer=e.guest_alloc(160)>>>0,handleCell=e.guest_alloc(4)>>>0;
function chainCode(selfRemove){return [
 ...(selfRemove?[0xff,0x35,...u32(handleCell),0xb8,...u32(unhookThunk),0xff,0xd0]:[]),
 0x8b,0x44,0x24,0x04,0x8b,0x4c,0x24,0x08,0x8b,0x54,0x24,0x0c,
 0x52,0x51,0x50,0x68,...u32(0xdeadbeef),0xb8,...u32(nextThunk),0xff,0xd0,
 0xa3,...u32(observed+28),0xb8,...u32(0x9999),0xc2,0x0c,0x00];}
mem.set(Uint8Array.from(chainCode(false)),off(newer));let newerHandle=e.gm_install(newer,1)>>>0;
let count=get(observed);assert.equal(e.gm_post(1,0x400,0x69),1);assert.equal(retrieve(e,1,1),1);
assert.equal(get(observed),count+1);assert.equal(get(observed+28),0xdeadbeef,'CallNext exact LRESULT');
assert.equal(e.gm_unhook(newerHandle),1);
// Fresh code allocation avoids assuming cached machine code self-modification.
const self=e.guest_alloc(160)>>>0;mem.set(Uint8Array.from(chainCode(true)),off(self));
newerHandle=e.gm_install(self,1)>>>0;put(handleCell,newerHandle);count=get(observed);
assert.equal(e.gm_post(1,0x400,0x69),1);assert.equal(retrieve(e,1,1),1);
assert.equal(get(observed),count+1,'self-unhook retains next node until callback unwinds');
assert.equal(e.gm_unhook(newerHandle),0);
const keyboard=e.guest_alloc(32)>>>0;
mem.set(Uint8Array.from([0xc7,0x05,...u32(observed+20),...u32(1),0xb8,...u32(0),0xc2,0x0c,0x00]),off(keyboard));
const kh=e.gm_keyboard(keyboard)>>>0;assert.notEqual(kh,0);count=get(observed);
ctx.hardware=[(0x1b<<16)|0x100];assert.equal(retrieve(e,1,1),1);
assert.equal(get(observed),count+1,'class3 follows existing keyboard hook exactly once');
assert.equal(get(observed+24),1,'keyboard callback completed before class3');
assert.equal(e.gm_unhook(kh),1,'legacy keyboard handle removal preserved');
// Real reentrant guest Get/Peek inside a HookProc: nested MSG stays distinct,
// CallNext observes each original pointer, and both callback frames unwind.
for(const peek of [0,1]){
 const nestedMsg=e.guest_alloc(32)>>>0,nestedProc=e.guest_alloc(160)>>>0;
 const thunk=e.gm_thunk(apiTable.find(x=>x.name===(peek?'PeekMessageA':'GetMessageA')).id)>>>0;
 const body=[...(peek?[0x6a,1]:[]),0x6a,0,0x6a,0,0x6a,0,0x68,...u32(nestedMsg),0xb8,...u32(thunk),0xff,0xd0,0xa3,...u32(observed+32)];
 assert.ok(body.length<128);
 const code=[0x8b,0x44,0x24,0x0c,0x83,0x78,0x08,0x71,0x75,body.length,...body,...chainCode(false)];
 mem.set(Uint8Array.from(code),off(nestedProc));const h=e.gm_install(nestedProc,1)>>>0;assert.notEqual(h,0);
 const n=get(observed);assert.equal(e.gm_post(1,0x400,0x71),1);assert.equal(e.gm_post(1,0x400,0x72),1);
 assert.equal(retrieve(e,1,1),1);assert.equal(get(observed),n+2,'nested and outer hook each run once');
 assert.equal(get(observed+32),1,'nested USER return survives HookProc results');
 assert.equal(get(nestedMsg+8),0x12345678);assert.equal(get(msg+8),0x12345678);
 assert.equal(get(observed+12),msg,'outer MSG pointer restored after nested retrieval');assert.equal(e.gm_unhook(h),1);
}
// A real second instance over the same memory owns its own registers/queue.
const ctx2={getMemory:()=>memory.buffer,onExit:()=>{}};
const e2=new WebAssembly.Instance(moduleObj,imports(ctx2)).exports;ctx2.exports=e2;
e2.init_thread(1,base,e.get_code_start(),e.get_code_end(),e.get_thunk_base(),e.get_thunk_end(),e.get_num_thunks(),0);
e2.init_dx_com_thunks();e2.set_esp((e.guest_alloc(4096)>>>0)+3840);
const second=e.gm_install(hook,2)>>>0;assert.notEqual(second,0,'remote registration targets initialized owner');
const before=get(observed);assert.equal(retrieve(e2,1,1),0);assert.equal(get(observed),before);
assert.equal(e.gm_post(2,0x400,0x69),1);assert.equal(retrieve(e,1,1),0,'foreign pump cannot steal owner message');
assert.equal(retrieve(e2,1,1),1);assert.equal(get(observed),before+1);
assert.equal(e.gm_unhook(second),1,'cross-owner unhook finds exact live handle');
assert.equal(e.gm_post(2,0x400,0x69),1);assert.equal(retrieve(e2,1,1),1);assert.equal(get(observed),before+1);
// Suspend at the actual HookProc entry after USER selected its node. A different
// real instance removes that handle before the owning guest runs the callback.
const active=e.gm_install(hook,2)>>>0;assert.notEqual(active,0);const activeCount=get(observed),activeSp=e2.get_esp()>>>0;
assert.equal(e.gm_post(2,0x400,0x69),1);assert.equal(e2.gm_retrieve(msg,1,1)>>>0,hook);
assert.equal(e.gm_unhook(active),1,'foreign unhook during active delivery');
for(let i=0;i<40&&e2.get_eip();i++)e2.run(5000);
assert.equal(e2.get_eip()>>>0,0);assert.equal(e2.get_esp()>>>0,activeSp+24);
assert.equal(get(observed),activeCount+1,'already selected callback remains valid through foreign removal');
assert.equal(e.gm_post(2,0x400,0x69),1);assert.equal(retrieve(e2,1,1),1);
assert.equal(get(observed),activeCount+1,'removed hook never selected again');
const retired=e.gm_install(hook,2);assert.notEqual(retired,0);e.reset_thread_message_queue(2);
assert.equal(e.gm_unhook(retired),0);assert.equal(e.gm_install(hook,2),0,'retired owner cannot inherit a hook');
// Reuse via real init_thread creates a new generation; an old instance must not
// gain delivery rights just because its current_thread_id still equals two.
const ctx3={getMemory:()=>memory.buffer,onExit:()=>{}},e3=new WebAssembly.Instance(moduleObj,imports(ctx3)).exports;ctx3.exports=e3;
e3.init_thread(1,base,e.get_code_start(),e.get_code_end(),e.get_thunk_base(),e.get_thunk_end(),e.get_num_thunks(),0);e3.init_dx_com_thunks();e3.set_esp((e.guest_alloc(4096)>>>0)+3840);
const reused=e.gm_install(hook,2);assert.notEqual(reused,0);
assert.equal(e2.gm_install(hook,2),0,'stale owner instance cannot register into new generation');
e.gm_arm_retire_race();assert.equal(e.gm_install(hook,2),0,'retirement during allocation prevents stale publication');
assert.equal(e.gm_unhook(reused),0,'retirement removed previously linked owner node');
assert.equal(e.gm_unhook(handle),1);assert.equal(e.gm_unhook(handle),0);
console.log(JSON.stringify({variant,passed:true,elapsedMs:Date.now()-start,groups:16,
 pending:['full layout/shake gates','ordinary Hype qualification']}));
