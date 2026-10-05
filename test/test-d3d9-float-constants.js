'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),{Bridge}=require('../lib/d3d9-host');
(async()=>{
 let bridge;
 const names=['BeginStateBlock','EndStateBlock','Reset','Release'];
 for(const stage of ['Vertex','Pixel'])for(const type of ['F'])for(const op of ['Set','Get'])names.push(op+stage+'ShaderConstant'+type);
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
 const pp=alloc(64),out=alloc(8),input=alloc(4096),output=alloc(4104),invalid=0x8876086c;
 const bytes=(p,n)=>new Uint8Array(memory.buffer,wa(p),n),words=(p,n)=>new Uint32Array(memory.buffer,wa(p),n);
 const parameters=()=>{bytes(pp,64).fill(0);words(pp,9).set([8,8,21,1,0,0,1,1,1]);e.guest_write32(pp+52,0x80000000);};
 const ok=v=>assert.strictEqual(v>>>0,0,bridge.lastError||'HRESULT');
 const call=(d,n,...args)=>e['Device9_'+n](d,...args)>>>0;
 parameters();ok(e.device(pp,out));const d=read(out);parameters();ok(e.device(pp,out));const other=read(out);
 let cases=0;
 const banks=[];
 for(const stage of ['Vertex','Pixel'])for(const type of ['F']){
  const stride=4,limit=stage==='Vertex'?256:8,set='Set'+stage+'ShaderConstant'+type,get='Get'+stage+'ShaderConstant'+type;
  const values=Uint32Array.from({length:limit*stride},(_,i)=>[0x80000000,0x7fffffff,0xffffffff,0x7fc01234,0,2,0xdeadbeef][i%7]);
  banks.push({set,get,stride,limit,values});
  bytes(output,4104).fill(0xcc);ok(call(d,get,0,output,limit));assert(words(output,limit*stride).every(v=>v===0));
  words(input,values.length).set(values);ok(call(d,set,0,input,limit));assert.strictEqual(e.get_esp()>>>0,0x074ff014);
  bytes(input,4096).fill(0);ok(call(d,get,0,output,limit));assert.deepStrictEqual(words(output,values.length),values,'raw float words retained without float conversion');
  ok(call(other,get,0,output,limit));assert(words(output,values.length).every(v=>v===0),'device isolation');
  for(const [start,count,p] of [[limit+1,0,input],[limit,1,input],[limit-1,2,input],[0,0xffffffff,input],[0,1,0],[0,16,0xfffffff0]]){
   assert.strictEqual(call(d,set,start,p,count),invalid);assert.strictEqual(call(d,get,start,p,count),invalid);cases+=2;
  }
  ok(call(d,set,limit,0,0));ok(call(d,get,limit,0,0));
  assert.strictEqual(call(0,set,0,input,1),invalid);
  ok(call(d,get,0,output,limit));assert.deepStrictEqual(words(output,values.length),values);
  if(stage==='Vertex')for(const [start,count] of [[95,2],[127,2],[254,2]]){
   ok(call(d,get,start,output,count));assert.deepStrictEqual(words(output,count*4),values.subarray(start*4,(start+count)*4));
   words(input,count*4).set(values.subarray(start*4,(start+count)*4));ok(call(d,set,start,input,count));cases+=2;
  }
  ok(call(d,'BeginStateBlock'));words(input,2*stride).fill(0x12345678);ok(call(d,set,5,input,2));
  assert.strictEqual(call(d,set,9,0xfffffff0,2),invalid,'invalid recording cannot add masks');
  ok(call(d,get,0,output,limit));assert.deepStrictEqual(words(output,values.length),values,'recording leaves live values unchanged');
  if(stage==='Vertex')for(const index of [95,96,127,128,255]){words(input,4).fill(0x12345678);ok(call(d,set,index,input,1));}
  ok(call(d,'EndStateBlock',out));const block=read(out);
  words(input,values.length).fill(0x76543210);ok(call(d,set,0,input,limit));ok(e.StateBlock9_Apply(block));
  const applied=new Uint32Array(values.length).fill(0x76543210);applied.fill(0x12345678,5*stride,7*stride);if(stage==='Vertex')for(const index of [95,96,127,128,255])applied.fill(0x12345678,index*4,index*4+4);
  ok(call(d,get,0,output,limit));assert.deepStrictEqual(words(output,values.length),applied,'Apply touches selected registers only');
  words(input,2*stride).fill(0xabcdef01);ok(call(d,set,5,input,2));ok(e.StateBlock9_Capture(block));
  words(input,values.length).fill(0x99887766);ok(call(d,set,0,input,limit));ok(e.StateBlock9_Apply(block));
  applied.fill(0x99887766);applied.fill(0xabcdef01,5*stride,7*stride);if(stage==='Vertex')for(const index of [95,96,127,128,255])applied.fill(0x12345678,index*4,index*4+4);
  ok(call(d,get,0,output,limit));assert.deepStrictEqual(words(output,values.length),applied);
  ok(e.StateBlock9_Release(block));cases+=10;
 }
 // Successful Reset replaces the whole native constant state; failed Reset
 // preserves its old bytes transactionally (query them directly while lost).
 const old=e.state(d)>>>0,saved=bytes(old+22684,2560).slice();
 parameters();e.guest_write32(pp+24,0);assert.strictEqual(call(d,'Reset',pp),invalid);
 assert.strictEqual(e.state(d)>>>0,old);assert.deepStrictEqual(bytes(old+22684,2560),saved);
 parameters();ok(call(d,'Reset',pp));
 for(const {get,stride,limit} of banks){ok(call(d,get,0,output,limit));assert(words(output,limit*stride).every(v=>v===0));cases++;}
 ok(call(d,'Release'));ok(call(other,'Release'));
 for(const p of [pp,out,input,output])e.guest_free(p);
 console.log('PASS D3D9 float constants '+cases+' API/stateblock/reset/isolation cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
