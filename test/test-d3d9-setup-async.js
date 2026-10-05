#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const {Device}=require('../lib/d3d9-software-backend');
const IR=require('../lib/d3d-shader-ir');
(async()=>{
  // Test-only admission of private VS2 IR; production reader/profile gates stay closed.
  const read=IR.read;
  IR.read=(buffer,address,options)=>read(buffer,address,{...options,experimentalVS20:true});
  const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:
    '(export "compile20" (func $d3d_shader_ir_compile20))'});
  const D=(bank,index=0)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|15<<16|index)>>>0;
  const S=(bank,index=0)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|228<<16|index)>>>0;
  const I=(op,...a)=>[(a.length<<24)|op,...a];
  function shader(code,vertex){
    const guest=e.guest_alloc(code.length*4)>>>0,p=e.guest_to_wasm(guest)>>>0;
    new Uint32Array(memory.buffer,p,code.length).set(code);
    const ir=(vertex?e.compile20:e.d3d_shader_ir_compile)(p,code.length)>>>0;assert(ir);
    const result=IR.read(memory.buffer,ir);e.d3d_shader_ir_free(ir);e.guest_free(guest);return result;
  }
  const vs=shader([0xfffe0200,...I(31,0x80000000,D(1)),
    ...I(81,D(2),0x3e800000,0x3f000000,0x3f400000,0x3f800000),
    ...I(1,D(4),S(1)),...I(1,D(5),S(2)),...I(38,S(7)),
    ...Array(33).fill(I(1,D(0),S(1))).flat(),...I(39),65535],true);
  const ps=shader([0xffff0101,1,D(0),S(1),65535],false);
  const scheduled=[];
  const device=new Device({width:8,height:8,quadBudget:1,schedule:fn=>scheduled.push(fn),
    getMemory:()=>memory.buffer,getExports:()=>({...e,
      d3d_shader_vm_compile(ir){return IR.read(memory.buffer,ir).version===0xfffe0200?
        e.d3d_shader_vm_compile_vs20(ir):e.d3d_shader_vm_compile(ir);}})});
  const baseline=device.bytes;
  function snapshot(){
    const vertices=new Float32Array([-1,1,.5,1,1,1,.5,1,-1,-1,.5,1]);
    const integers=new Int32Array(64);integers[0]=255;
    return {primitive:4,primitiveCount:1,stride:16,vertices:new Uint8Array(vertices.buffer),
      attributes:[{register:0,usage:0,usageIndex:0,type:3,offset:0}],
      vertexShader:vs,pixelShader:ps,vertexIntegerConstants:integers,
      textures:[],state:{zenable:false,zwrite:false,cull:1}};
  }
  try{
    const source=snapshot(),untouched=device.readPixels(),pending=device.drawAsync(source);
    source.vertices.fill(0);source.vertexIntegerConstants.fill(-1);
    assert.strictEqual(device.active.context,0,'no vertex execution before first scheduled callback');
    let ticks=0;
    while(scheduled.length){
      const setup=!!device.active?.setup;
      scheduled.shift()();ticks++;
      if(setup)assert.deepStrictEqual(new Uint8Array(memory.buffer,device.target.wa,256),untouched,
        'setup callbacks never publish pixels');
      assert(ticks<1000);
    }
    await pending;assert(ticks>8,'long REP spans multiple event-loop callbacks');
    assert.deepStrictEqual([...device.readPixels().slice(36,40)],[191,128,64,255]);
    assert.strictEqual(device.bytes,baseline,'snapshot/setup/program storage retires');
    for(const index of [95,96,127,128,255]){
      const source=snapshot();
      source.vertexShader=shader([0xfffe0200,...I(31,0x80000000,D(1)),
        ...I(1,D(4),S(1)),...I(1,D(5),S(2,index)),65535],true);
      source.vertexConstants=new Float32Array(1024);
      source.vertexConstants.set([.25,.5,.75,1],index*4);
      const pending=device.drawAsync(source);
      source.vertexConstants.fill(0);
      while(scheduled.length)scheduled.shift()();
      await pending;
      assert.deepStrictEqual([...device.readPixels().slice(36,40)],[191,128,64,255],
        `detached full256 constants preserve c${index} across deferred setup`);
      assert.strictEqual(device.bytes,baseline,'full256 payload reclaimed after completion');
    }
    for(const callbacks of [0,1,3]){
      const before=device.readPixels(),p=device.drawAsync(snapshot());
      for(let i=0;i<callbacks;i++)scheduled.shift()();
      device.cancel();await assert.rejects(p,/cancelled/);
      while(scheduled.length)scheduled.shift()();
      assert.deepStrictEqual(device.readPixels(),before);
      assert.strictEqual(device.bytes,baseline,'cancellation releases pending setup and detached payload');
    }
  }finally{device.destroy();IR.read=read;}
  assert.strictEqual(device.bytes,0);
  console.log('PASS native async setup: long REP yields, full256 constants detach, setup writes no pixels, cancellation releases storage');
})().catch(error=>{console.error(error);process.exitCode=1;});
