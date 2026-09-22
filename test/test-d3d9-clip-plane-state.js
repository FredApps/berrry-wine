'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),{Bridge}=require('../lib/d3d9-host');
(async()=>{
 let bridge;
 const names=['CreateStateBlock','BeginStateBlock','EndStateBlock','Reset','Release','SetClipPlane','GetClipPlane','SetRenderState','GetRenderState'];
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
 const data=Uint32Array.from([0x80000000,0x7fc01234,0x3f800000,0xffffffff]);
 for(let i=0;i<6;i++){
  ok(call(d,'GetClipPlane',i,output));assert(words(output,4).every(v=>v===0));
  words(input,4).set(data);ok(call(d,'SetClipPlane',i,input));bytes(input,16).fill(0);
  ok(call(d,'GetClipPlane',i,output));assert.deepStrictEqual(words(output,4),data);
  ok(call(other,'GetClipPlane',i,output));assert(words(output,4).every(v=>v===0));cases+=3;
 }
 for(const index of[6,0xffffffff])for(const op of['Set','Get']){assert.strictEqual(call(d,op+'ClipPlane',index,input),invalid);cases++;}
 for(const p of[0,0xfffffff8])for(const op of['Set','Get']){assert.strictEqual(call(d,op+'ClipPlane',0,p),invalid);cases++;}
 ok(call(d,'GetRenderState',152,output));assert.strictEqual(read(output),0,'setting coefficients does not enable planes');
 ok(call(d,'BeginStateBlock'));words(input,4).fill(123);ok(call(d,'SetClipPlane',2,input));
 assert.strictEqual(call(d,'SetClipPlane',3,0xfffffff8),invalid);
 ok(call(d,'GetClipPlane',2,output));assert.deepStrictEqual(words(output,4),data,'recording leaves live plane unchanged');
 ok(call(d,'EndStateBlock',out));const selective=read(out);
 words(input,4).fill(456);for(let i=0;i<6;i++)ok(call(d,'SetClipPlane',i,input));
 ok(e.StateBlock9_Apply(selective));
 for(let i=0;i<6;i++){ok(call(d,'GetClipPlane',i,output));assert(words(output,4).every(v=>v===(i===2?123:456)));cases++;}
 words(input,4).fill(789);ok(call(d,'SetClipPlane',2,input));ok(e.StateBlock9_Capture(selective));
 words(input,4).fill(0);ok(call(d,'SetClipPlane',2,input));ok(e.StateBlock9_Apply(selective));
 ok(call(d,'GetClipPlane',2,output));assert(words(output,4).every(v=>v===789));ok(e.StateBlock9_Release(selective));
 for(const type of[1,2,3]){
  words(input,4).fill(111);for(let i=0;i<6;i++)ok(call(d,'SetClipPlane',i,input));
  ok(call(d,'SetRenderState',152,63));ok(call(d,'CreateStateBlock',type,out));const b=read(out);
  words(input,4).fill(222);for(let i=0;i<6;i++)ok(call(d,'SetClipPlane',i,input));
  ok(call(d,'SetRenderState',152,0));ok(e.StateBlock9_Apply(b));
  for(let i=0;i<6;i++){ok(call(d,'GetClipPlane',i,output));assert(words(output,4).every(v=>v===(type===1?111:222)));cases++;}
  ok(call(d,'GetRenderState',152,output));assert.strictEqual(read(output),type===2?0:63);
  ok(e.StateBlock9_Release(b));
 }
 const state=e.state(d),saved=bytes(state+25244,96).slice();
 parameters();e.guest_write32(pp+24,0);assert.strictEqual(call(d,'Reset',pp),invalid);assert.deepStrictEqual(bytes(state+25244,96),saved);
 parameters();ok(call(d,'Reset',pp));
 for(let i=0;i<6;i++){ok(call(d,'GetClipPlane',i,output));assert(words(output,4).every(v=>v===0));cases++;}
 ok(call(d,'GetRenderState',152,output));assert.strictEqual(read(output),0);
 ok(call(d,'Release'));ok(call(other,'Release'));for(const p of[pp,out,input,output])e.guest_free(p);
 console.log('PASS clip-plane state '+cases+' raw-bit/API/stateblock/reset cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
