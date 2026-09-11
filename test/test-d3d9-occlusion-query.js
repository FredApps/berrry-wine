#!/usr/bin/env node
'use strict';
const assert=require('assert'),path=require('path');
const {Worker}=require('worker_threads');
const {bootRenderHarness}=require('./render-helper');
const {Bridge}=require('../lib/d3d9-host');
const {WorkerConsumer}=require('../lib/d3d-command-stream');
const sigs=require('../lib/host-import-sigs.generated.json').sigs;
(async()=>{
  let bridge;
  const {exports:e,memory,module}=await bootRenderHarness({fonts:'none',
    extraHostOverrides:{gpu_gl_call:(op,p,a)=>bridge.call(op,p,a)},extraWat:`
    (func (export "device") (param $pp i32) (param $out i32) (result i32)
      (global.set $esp (i32.const 0x074ff000))
      (call $gs32 (i32.add (global.get $esp) (i32.const 24)) (local.get $pp))
      (call $gs32 (i32.add (global.get $esp) (i32.const 28)) (local.get $out))
      (call $handle_IDirect3D9_CreateDevice (i32.const 0) (i32.const 0) (i32.const 1)
        (i32.const 1) (i32.const 0) (i32.const 0)) (global.get $eax))
    (func (export "query") (param $device i32) (param $out i32) (result i32)
      (call $d3d9_query_create (local.get $device) (i32.const 9) (local.get $out)) (global.get $eax))
    ${[['Device9','SetFVF'],['Device9','SetRenderState'],['Device9','DrawPrimitiveUP'],['Device9','Release'],['Device9','Reset'],
      ['Query9','Issue'],['Query9','GetData'],['Query9','Release']].map(([type,name])=>`
    (func (export "${type}_${name}") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (result i32)
      (global.set $esp (i32.const 0x074ff000))
      (call $handle_IDirect3D${type}_${name} (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
      (global.get $eax))`).join('\n')}`});
  e.d3dim_worker_init(0x400000);e.init_dx_com_thunks();
  const alloc=n=>e.guest_alloc(n)>>>0,wa=p=>e.guest_to_wasm(p)>>>0,read=p=>e.guest_read32(p)>>>0;
  const out=alloc(8),pp=alloc(64),vertices=alloc(60),view=new DataView(memory.buffer);
  const presentationParameters=()=>{
    new Uint8Array(memory.buffer,wa(pp),64).fill(0);
    [8,8,21,1,0,0,1,1,1].forEach((v,i)=>e.guest_write32(pp+i*4,v));
  };
  [[0,0],[8,0],[0,8]].forEach(([x,y],i)=>{
    const p=wa(vertices)+i*20;[x,y,.5,1].forEach((v,j)=>view.setFloat32(p+j*4,v,true));view.setUint32(p+16,0xffff0000,true);
  });
  const originalVertices=Buffer.from(new Uint8Array(memory.buffer,wa(vertices),60));
  let firstDraw;
  for(const async of [false,true]){
    // Reset mutates this [in,out] structure: width/height/count become zero.
    // Reusing it would create the second device at the640x480 fallback size.
    presentationParameters();
    assert.deepStrictEqual(Buffer.from(new Uint8Array(memory.buffer,wa(vertices),60)),originalVertices,'retained guest vertices survive device teardown');
    let worker,consumer;
    bridge=new Bridge({backend:'software',enableProgrammable:true,softwareQuadBudget:1,
      getExports:()=>e,getMemory:()=>memory.buffer,guestToWasm:wa,
      ...(async?{createSoftwareWorker(){
        worker=new Worker(path.join(__dirname,'../lib/d3d-render-worker.js'));
        consumer=new WorkerConsumer(worker,{module,memory,sigs,imageBase:e.get_image_base()>>>0,
          reclaimHeap:head=>e.d3d_render_adopt_free_list(head)});return consumer;
      }}:{})});
    const submit=bridge._submit.bind(bridge);
    bridge._submit=(entry,opcode,payload)=>{
      if(opcode===1)assert.deepStrictEqual([payload.width,payload.height],[8,8],'worker query target size');
      if(opcode===5){
        if(!async)assert.deepStrictEqual([entry.device.width,entry.device.height],[8,8],'query target size');
        if(firstDraw)assert.deepStrictEqual(payload,firstDraw,'fresh device draw snapshot matches prior device');
        else firstDraw=structuredClone(payload);
      }
      return submit(entry,opcode,payload);
    };
    const ok=(v,label)=>assert.strictEqual(v>>>0,0,`${label}: ${bridge.lastError||''}`);
    async function invoke(fn,...args){let result=fn(...args);while(e.get_d3d_render_token()){
      await bridge.wait(e.get_d3d_render_token());result=fn(...args);
    }return result;}
    try{
      ok(e.device(pp,out),'device');const d=read(out);
      ok(e.query(d,0),'support probe');ok(e.query(d,out),'query');const q=read(out);
      ok(e.Device9_SetFVF(d,0x44),'FVF');ok(e.Device9_SetRenderState(d,137,0),'lighting');
      ok(e.Device9_SetRenderState(d,22,1),'cull');ok(e.Device9_SetRenderState(d,7,0),'depth');
      ok(e.Query9_GetData(q,out,4,0),'new query');assert.strictEqual(read(out),0);
      assert.strictEqual(e.Query9_Issue(q,3)>>>0,0x8876086c);
      ok(e.Query9_Issue(q,2),'BEGIN');assert.strictEqual(e.get_d3d_render_token(),0,'BEGIN never parks');
      assert.strictEqual(e.Query9_GetData(q,out,4,0)>>>0,0x8876086c,'building result invalid');
      ok(await invoke(e.Device9_DrawPrimitiveUP,d,4,1,vertices,20),'draw');
      ok(e.Query9_Issue(q,1),'END');assert.strictEqual(e.get_d3d_render_token(),0,'END never parks');
      e.guest_write32(out,0xdeadbeef);e.guest_write32(out+4,0x12345678);
      let result=e.Query9_GetData(q,out,4,0);
      if(async){assert.strictEqual(result,1,'unfinished query returns S_FALSE');assert.strictEqual(read(out),0xdeadbeef);}
      const deadline=Date.now()+60000;
      while(result===1){assert(Date.now()<deadline,'query completion deadline');await new Promise(r=>setTimeout(r,1));result=e.Query9_GetData(q,out,4,1);}
      ok(result,'GetData');assert.strictEqual(read(out),36,`${async?'worker':'direct'} triangle sample count`);assert.strictEqual(read(out+4),0x12345678);
      for(const [p,n,f]of[[out,3,0],[0,4,0],[out,4,2]])assert.strictEqual(e.Query9_GetData(q,p,n,f)>>>0,0x8876086c);
      ok(e.Query9_GetData(q,0,0,0),'status-only poll');
      if(async){
        const limit=bridge.maxRequests;bridge.maxRequests=1;
        const occupied={};bridge.requests.set(-999,occupied);
        try{
          ok(e.Query9_GetData(q,out,4,0),'query polling independent of parked-call capacity');
          assert.strictEqual(bridge.requests.get(-999),occupied);
        }finally{bridge.requests.delete(-999);bridge.maxRequests=limit;}
      }
      ok(e.Query9_Issue(q,2),'pre-reset BEGIN');ok(e.Query9_Issue(q,1),'pre-reset END');
      e.guest_write32(pp,4096);
      assert.strictEqual(await invoke(e.Device9_Reset,d,pp)>>>0,0x8876086c,'invalid Reset fails');
      e.guest_write32(out,0xdeadbeef);
      assert.strictEqual(e.Query9_GetData(q,out,4,0)>>>0,0x88760868,'failed Reset makes query polling device-lost');
      assert.strictEqual(read(out),0xdeadbeef,'lost-device polling preserves output');
      assert.strictEqual(e.Query9_Issue(q,2)>>>0,0x88760868,'lost-device BEGIN rejected');
      presentationParameters();
      ok(await invoke(e.Device9_Reset,d,pp),'Reset with retained query');
      assert.deepStrictEqual([read(pp),read(pp+4),read(pp+12)],[0,0,0],'Reset writes back presentation dimensions/count');
      e.guest_write32(out,0xdeadbeef);
      assert.strictEqual(e.Query9_GetData(q,out,4,0)>>>0,0x88760868,'Reset invalidates previous query result');
      assert.strictEqual(read(out),0xdeadbeef,'invalidated result leaves output untouched');
      ok(e.Query9_Issue(q,2),'post-reset restart');ok(e.Query9_Issue(q,1),'post-reset empty END');
      result=e.Query9_GetData(q,out,4,0);
      const resetDeadline=Date.now()+60000;
      while(result===1){assert(Date.now()<resetDeadline);await new Promise(r=>setTimeout(r,1));result=e.Query9_GetData(q,out,4,0);}
      ok(result,'post-reset query');assert.strictEqual(read(out),0,'new bracket does not inherit pre-reset samples');
      ok(e.Query9_Issue(q,2),'restart');ok(e.Query9_Issue(q,1),'empty END');
      assert.strictEqual(await invoke(e.Query9_Release,q),0);
      const recycled=e.guest_alloc(40)>>>0;
      assert.strictEqual(recycled,q,'query allocation immediately reusable');
      new Uint8Array(memory.buffer,wa(recycled),40).fill(0xa5);
      await bridge.devices.get(d).queue.fence();
      assert(new Uint8Array(memory.buffer,wa(recycled),40).every(v=>v===0xa5),'late result never writes freed guest query');
      e.guest_free(recycled);
      ok(e.query(d,out),'final child query');const last=read(out);
      ok(e.Query9_Issue(last,2),'final child BEGIN');ok(e.Query9_Issue(last,1),'final child END');
      assert.strictEqual(e.Device9_Release(d),1,'query retains final parent reference');
      assert.strictEqual(await invoke(e.Query9_Release,last),0,'final query safely drives async device teardown');
    }finally{await bridge.close();}
  }
  console.log('PASS native D3D9 occlusion: direct/worker draw counts, nonblocking polling, output guards and pending release');
})().catch(error=>{console.error(error);process.exitCode=1;});
