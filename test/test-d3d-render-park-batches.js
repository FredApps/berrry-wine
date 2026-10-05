#!/usr/bin/env node
'use strict';
// A software-D3D draw parks the guest main thread (yield 16) while the render
// worker rasterizes. The CLI batch loop used to spend a whole batch per
// "still parked?" check: run() was skipped, the batch was counted, and the
// guest clock moved on without the guest running one instruction. UT2003 and
// UT2004 read as "stuck forever in the first DrawIndexedPrimitive" because of
// it -- a 1500-batch probe spent almost all of its budget parked and got 30
// draws in. The draw itself was never the problem.
//
// This drives the exact shape through real COM thunks entered by x86 CALL: a
// frame-sized triangle through DrawPrimitiveUP and a Present on a software
// device, with one control `step` large enough to cover both. The fixed loop
// must spend no batch parked (it waits in wall time for the request instead);
// the --no-render-park-wait arm keeps the old behaviour and must still skip
// batches, so the assertion is proven to see the difference.
const assert=require('assert');
const path=require('path');
const {startControlSession}=require('./control-session');
const root=path.join(__dirname,'..');

const runArm=async(extra)=>{
  const session=startControlSession(['test/run.js','--exe=test/binaries/calc.exe',
    '--no-build','--d3d9-renderer=software','--d3d9-programmable','--control-stdin','--frozen',
    '--quiet-api','--max-seconds=45','--max-batches=1000000','--batch-size=100',...extra],
    {cwd:root,idPrefix:'park'});
  const {child,exited,send,output}=session;
  const deadline=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGTERM');},90000);
  const command=(action,fields={})=>send({action,...fields});
  const evaluate=code=>command('eval',{code});
  try {
    await command('ping');
    await evaluate(`(()=>{
      const e=exports,alloc=n=>e.guest_alloc(n)>>>0;
      const p=ctx.parkProbe={out:alloc(4),pp:alloc(64),vertices:alloc(48),marker:alloc(4),stack:alloc(4096)};
      new Uint8Array(memory.buffer,e.guest_to_wasm(p.pp),64).fill(0);
      // 512x512 A8R8G8B8 back buffer: a triangle covering half the frame is
      // enough raster work that the worker cannot answer within the batch.
      [512,512,21,1,0,0,1,1].forEach((n,i)=>e.guest_write32(p.pp+i*4,n));
      const view=new DataView(memory.buffer),wa=e.guest_to_wasm(p.vertices);
      [[-1,1,.5],[1,1,.5],[-1,-1,.5]].forEach((v,i)=>{
        v.forEach((n,j)=>view.setFloat32(wa+i*16+j*4,n,true));view.setUint32(wa+i*16+12,0xff00ff00,true);
      });
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
    const call=async(name,args,steps)=>{
      await evaluate(`ctx.parkProbe.call(${JSON.stringify(name)},${args})`);
      await command('step',{n:steps});
      return await evaluate('exports.guest_read32(ctx.parkProbe.marker)>>>0');
    };
    // Setup calls get generous budgets; only the draw/present window is read.
    assert.strictEqual(await call('IDirect3D9_CreateDevice',
      '[0,0,1,1,0,ctx.parkProbe.pp,ctx.parkProbe.out]',200),0,'CreateDevice');
    await evaluate('ctx.parkProbe.device=exports.guest_read32(ctx.parkProbe.out)>>>0');
    assert.strictEqual(await call('IDirect3DDevice9_SetFVF','[ctx.parkProbe.device,0x42]',50),0);
    assert.strictEqual(await call('IDirect3DDevice9_SetRenderState','[ctx.parkProbe.device,137,0]',50),0);
    assert.strictEqual(await call('IDirect3DDevice9_SetRenderState','[ctx.parkProbe.device,22,1]',50),0);
    const before=await evaluate('({...ctx.renderParkStats})');
    const draw=await call('IDirect3DDevice9_DrawPrimitiveUP',
      '[ctx.parkProbe.device,4,1,ctx.parkProbe.vertices,16]',40);
    const present=await call('IDirect3DDevice9_Present','[ctx.parkProbe.device,0,0,0,0]',40);
    const after=await evaluate('({...ctx.renderParkStats})');
    await call('IDirect3DDevice9_Release','[ctx.parkProbe.device]',200);
    await command('quit');const exitCode=await exited;assert.strictEqual(exitCode,0,output());
    return {draw,present,
      waits:after.waits-before.waits,skipped:after.skippedBatches-before.skippedBatches};
  } catch (error) {
    error.message+=`\n--- run.js ${extra.join(' ')||'(default)'} output tail ---\n${output().slice(-4000)}`;
    throw error;
  } finally {clearTimeout(deadline);if(child.exitCode===null)child.kill('SIGTERM');}
};

(async()=>{
  const fixed=await runArm([]);
  assert.strictEqual(fixed.draw,0,'DrawPrimitiveUP resumed within its step');
  assert.strictEqual(fixed.present,0,'Present resumed within its step');
  assert(fixed.waits>=1,`the draw window parked on a render request (${JSON.stringify(fixed)})`);
  assert.strictEqual(fixed.skipped,0,`no batch was spent parked (${JSON.stringify(fixed)})`);
  const legacy=await runArm(['--no-render-park-wait']);
  assert.strictEqual(legacy.waits,0,JSON.stringify(legacy));
  assert(legacy.skipped>0,`the old loop spends batches parked, so this test can see the bug (${JSON.stringify(legacy)})`);
  console.log(`PASS software D3D park: fixed loop waited on ${fixed.waits} requests and skipped 0 batches; `
    +`--no-render-park-wait skipped ${legacy.skipped}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
