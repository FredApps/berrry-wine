'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),{Bridge}=require('../lib/d3d9-host');
(async()=>{
 let bridge;
 const names=['BeginStateBlock','EndStateBlock','Reset','Release'];
 for(const stage of ['Vertex','Pixel'])for(const type of ['I','B'])for(const op of ['Set','Get'])names.push(op+stage+'ShaderConstant'+type);
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraHostOverrides:{gpu_gl_call:(...args)=>bridge.call(...args)},extraWat:`
 (func (export "state") (param $d i32) (result i32) (call $d3d9_program_state (local.get $d)))
 (func (export "device") (param $pp i32) (param $out i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $pp))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $out))
   (call $handle_IDirect3D9_CreateDevice (i32.const 0) (i32.const 0) (i32.const 1) (i32.const 1) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
 ${[...names.map(n=>['Device9',n]),...['Apply','Capture','Release'].map(n=>['StateBlock9',n])].map(([t,n])=>`
 (func (export "${t}_${n}") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $handle_${require('../src/api_table.json').find(a=>a.name===`IDirect3D${t}_${n}`).handler||`IDirect3D${t}_${n}`} (local.get $a) (local.get $b) (local.get $c) (local.get $d) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))`).join('\n')}`});
 e.d3dim_worker_init(0x400000);e.init_dx_com_thunks();
 const alloc=n=>e.guest_alloc(n)>>>0,wa=p=>e.guest_to_wasm(p)>>>0,read=p=>e.guest_read32(p)>>>0;
 bridge=new Bridge({backend:'software',enableProgrammable:true,getExports:()=>e,getMemory:()=>memory.buffer,guestToWasm:wa});
 const pp=alloc(64),out=alloc(8),input=alloc(256),output=alloc(264),invalid=0x8876086c;
 const bytes=(p,n)=>new Uint8Array(memory.buffer,wa(p),n),words=(p,n)=>new Uint32Array(memory.buffer,wa(p),n);
 const parameters=()=>{bytes(pp,64).fill(0);words(pp,9).set([8,8,21,1,0,0,1,1,1]);e.guest_write32(pp+52,0x80000000);};
 const ok=v=>assert.strictEqual(v>>>0,0,bridge.lastError||'HRESULT');
 const call=(d,n,...args)=>e['Device9_'+n](d,...args)>>>0;
 parameters();ok(e.device(pp,out));const d=read(out);parameters();ok(e.device(pp,out));const other=read(out);
 let cases=0;
 const banks=[];
 for(const stage of ['Vertex','Pixel'])for(const type of ['I','B']){
  const stride=type==='I'?4:1,set='Set'+stage+'ShaderConstant'+type,get='Get'+stage+'ShaderConstant'+type;
  const values=Uint32Array.from({length:16*stride},(_,i)=>[0x80000000,0x7fffffff,0xffffffff,0x7fc01234,0,2,0xdeadbeef][i%7]);
  banks.push({set,get,stride,values});
  bytes(output,264).fill(0xcc);ok(call(d,get,0,output,16));assert(words(output,16*stride).every(v=>v===0));
  words(input,values.length).set(values);ok(call(d,set,0,input,16));assert.strictEqual(e.get_esp()>>>0,0x074ff014);
  bytes(input,256).fill(0);ok(call(d,get,0,output,16));assert.deepStrictEqual(words(output,values.length),values,'raw I/BOOL words retained without float conversion');
  ok(call(other,get,0,output,16));assert(words(output,values.length).every(v=>v===0),'device isolation');
  for(const [start,count,p] of [[17,0,input],[16,1,input],[15,2,input],[0,0xffffffff,input],[0,1,0],[0,16,0xfffffff0]]){
   assert.strictEqual(call(d,set,start,p,count),invalid);assert.strictEqual(call(d,get,start,p,count),invalid);cases+=2;
  }
  ok(call(d,set,16,0,0));ok(call(d,get,16,0,0));
  assert.strictEqual(call(0,set,0,input,1),invalid);
  ok(call(d,get,0,output,16));assert.deepStrictEqual(words(output,values.length),values);
  ok(call(d,'BeginStateBlock'));words(input,2*stride).fill(0x12345678);ok(call(d,set,5,input,2));
  assert.strictEqual(call(d,set,9,0xfffffff0,2),invalid,'invalid recording cannot add masks');
  ok(call(d,get,0,output,16));assert.deepStrictEqual(words(output,values.length),values,'recording leaves live values unchanged');
  ok(call(d,'EndStateBlock',out));const block=read(out);
  words(input,values.length).fill(0x76543210);ok(call(d,set,0,input,16));ok(e.StateBlock9_Apply(block));
  const applied=new Uint32Array(values.length).fill(0x76543210);applied.fill(0x12345678,5*stride,7*stride);
  ok(call(d,get,0,output,16));assert.deepStrictEqual(words(output,values.length),applied,'Apply touches selected registers only');
  words(input,2*stride).fill(0xabcdef01);ok(call(d,set,5,input,2));ok(e.StateBlock9_Capture(block));
  words(input,values.length).fill(0x99887766);ok(call(d,set,0,input,16));ok(e.StateBlock9_Apply(block));
  applied.fill(0x99887766);applied.fill(0xabcdef01,5*stride,7*stride);
  ok(call(d,get,0,output,16));assert.deepStrictEqual(words(output,values.length),applied);
  ok(e.StateBlock9_Release(block));cases+=10;
 }
 // Successful Reset replaces the whole native constant state; failed Reset
 // preserves its old bytes transactionally (query them directly while lost).
 const old=e.state(d)>>>0,saved=bytes(old+22044,640).slice();
 parameters();e.guest_write32(pp+24,0);assert.strictEqual(call(d,'Reset',pp),invalid);
 assert.strictEqual(e.state(d)>>>0,old);assert.deepStrictEqual(bytes(old+22044,640),saved);
 parameters();ok(call(d,'Reset',pp));
 for(const {get,stride} of banks){ok(call(d,get,0,output,16));assert(words(output,16*stride).every(v=>v===0));cases++;}
 ok(call(d,'Release'));ok(call(other,'Release'));
 for(const p of [pp,out,input,output])e.guest_free(p);
 console.log('PASS D3D9 typed constants '+cases+' API/stateblock/reset/isolation cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
