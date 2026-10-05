#!/usr/bin/env node
'use strict';
// Drive the shipped CLI scheduler via its control channel. Guest calls enter
// real COM thunks through x86 CALL, not test-only native handler exports.
const assert=require('assert');
const path=require('path');
const {startControlSession}=require('./control-session');
const root=path.join(__dirname,'..');
(async()=>{
  // One reply parser for every --control-stdin test (test-control-stdin-cli
  // checks that no test grows a private one): the helper owns framing, ids,
  // reply routing, output capture and pending-request teardown, and this file
  // keeps the schedule and the assertions.
  const session=startControlSession(['test/run.js','--exe=test/binaries/calc.exe',
    '--no-build','--d3d9-renderer=software','--d3d9-programmable','--control-stdin','--frozen',
    '--quiet-api','--max-seconds=45','--max-batches=1000000','--batch-size=100'],
    {cwd:root,idPrefix:'d3d'});
  const {child,exited,send,output}=session;
  // A pending request is rejected by the helper when the child exits, so the
  // deadline only has to end the child.
  const deadline=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGTERM');},90000);
  const command=(action,fields={})=>send({action,...fields});
  const evaluate=code=>command('eval',{code});
  try {
    await command('ping');
    await evaluate(`(()=>{
      const e=exports,alloc=n=>e.guest_alloc(n)>>>0;
      const p=ctx.d3dProbe={out:alloc(4),pp:alloc(64),vertices:alloc(48),marker:alloc(4),stack:alloc(4096)};
      new Uint8Array(memory.buffer,e.guest_to_wasm(p.pp),64).fill(0);
      [8,8,21,1,0,0,1,1].forEach((n,i)=>e.guest_write32(p.pp+i*4,n));
      const view=new DataView(memory.buffer),wa=e.guest_to_wasm(p.vertices);
      [[-1,1,.5],[1,1,.5],[-1,-1,.5]].forEach((v,i)=>{
        v.forEach((n,j)=>view.setFloat32(wa+i*16+j*4,n,true));view.setUint32(wa+i*16+12,0xffff0000,true);
      });
      const bridge=ctx.d3d9Bridge,call=bridge.call;
      bridge.call=function(op,a,x){if(op===0x30002)p.target=view.getUint32(a+8,true);return call.call(this,op,a,x);};
      p.call=(name,args)=>{
        const id=ctx.apiTable.find(a=>a.name===name).id,base=e.get_thunk_base()>>>0;
        let thunk=0;for(let i=0;i<e.get_num_thunks();i++){
          if((e.guest_read32(base+i*8)>>>0)===0xcaca0010 && e.guest_read32(base+i*8+4)===id){thunk=base+i*8;break;}
        }
        if(!thunk)throw Error('missing thunk '+name);
        const dword=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
        const code=alloc(256),bytes=[...args.slice().reverse().flatMap(n=>[0x68,...dword(n)]),
          0xb8,...dword(thunk),0xff,0xd0,0xa3,...dword(p.marker),0xeb,0xfe];
        new Uint8Array(memory.buffer).set(bytes,e.guest_to_wasm(code));
        e.guest_write32(p.marker,0xdeadbeef);e.set_esp(p.stack+4000);e.clear_yield();e.set_eip(code);
      };
      return true;
    })()`);
    const call=async(name,args)=>{
      await evaluate(`ctx.d3dProbe.call(${JSON.stringify(name)},${args})`);
      for(let i=0;i<120;i++){
        await command('step',{n:10});
        const value=await evaluate('exports.guest_read32(ctx.d3dProbe.marker)>>>0');
        if(value!==0xdeadbeef){assert.strictEqual(value,0,name);return;}
      }
      throw new Error(name+' did not resume\n'+output());
    };
    await call('IDirect3D9_CreateDevice','[0,0,1,1,0,ctx.d3dProbe.pp,ctx.d3dProbe.out]');
    await evaluate('ctx.d3dProbe.device=exports.guest_read32(ctx.d3dProbe.out)>>>0');
    await call('IDirect3DDevice9_SetFVF','[ctx.d3dProbe.device,0x42]');
    await call('IDirect3DDevice9_SetRenderState','[ctx.d3dProbe.device,137,0]');
    await call('IDirect3DDevice9_SetRenderState','[ctx.d3dProbe.device,22,1]');
    await call('IDirect3DDevice9_DrawPrimitiveUP','[ctx.d3dProbe.device,4,1,ctx.d3dProbe.vertices,16]');
    await call('IDirect3DDevice9_Present','[ctx.d3dProbe.device,0,0,0,0]');
    const result=await evaluate(`({pixel:new Uint32Array(memory.buffer,ctx.d3dProbe.target,64)[9],
      worker:ctx.d3d9Bridge.workerConsumer.initialized,pending:ctx.d3d9Bridge.requests.size,
      submitted:ctx.d3d9Bridge.devices.get(ctx.d3dProbe.device).queue.submitted,
      completed:ctx.d3d9Bridge.devices.get(ctx.d3dProbe.device).queue.completed})`);
    assert.strictEqual(result.pixel,0xffff0000);assert(result.worker);assert.strictEqual(result.pending,0);
    assert.strictEqual(result.submitted,4);assert.strictEqual(result.completed,4);
    await call('IDirect3DDevice9_Release','[ctx.d3dProbe.device]');
    await command('quit');const exitCode=await exited;assert.strictEqual(exitCode,0,output());
    assert(!/retirement failed|RECLAIM|ORPHANED/.test(output()),output());
    console.log('PASS real CLI x86 COM -> render_wait -> production software Worker -> canonical red pixel -> graceful exit');
  } finally {clearTimeout(deadline);if(child.exitCode===null)child.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
