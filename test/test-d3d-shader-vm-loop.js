#!/usr/bin/env node
'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
  const {exports:e,memory}=await bootRenderHarness({fonts:'none'});
  const U=new Uint32Array(memory.buffer),F=new Float32Array(memory.buffer);
  const arg=(bank,index=0,selector=228,modifier=0)=>[bank,index,selector,modifier];
  const instruction=(op,...operands)=>({op,operands});
  const bits=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
  const def=(index,color)=>instruction(81,arg(2,index,15),...color.map(n=>arg(255,bits(n),0)));
  function compile(items){
    const bytes=32+items.length*128,guest=e.guest_alloc(bytes)>>>0,p=e.guest_to_wasm(guest)>>>0;
    U.fill(0,p/4,(p+bytes)/4);U.set([0x44534952,1,0,0xfffe0200,items.length,64,bytes,1],p/4);
    items.forEach(({op,operands},i)=>{
      const at=(p+32+i*128)/4;U.set([op,i+1,operands.length,0],at);
      operands.forEach((a,j)=>U.set(a,at+4+j*4));
    });
    const result=e.d3d_shader_vm_compile_vs20(p)>>>0;e.guest_free(guest);return result;
  }
  const red=[1,0,0,1],green=[0,1,0,1],blue=[0,0,1,1];
  const body=[def(0,red),def(1,green),def(2,blue),
    instruction(1,arg(0,0,15),arg(2)),instruction(27,arg(15),arg(7)),
    instruction(1,arg(0,0,15),arg(2,0,228,1280)),instruction(29)];
  const program=compile(body);assert(program,'private LOOP packets compile');
  let cases=0;
  for(const [params,expected] of [[[3,0,1,0],blue],[[3,2,-1,0],red],[[2,1,0,0],green],
    [[0,255,-128,0],red],[[255,0,1,0],[0,0,0,0]],[[2,0,-1,0],[0,0,0,0]]]){
    const ctx=e.d3d_shader_vm_context(program,15)>>>0;assert(ctx);
    U.set(params,(ctx+73760)/4);let status=1,ticks=0;
    while(status===1){status=e.d3d_shader_vm_run(ctx,1);assert(++ticks<2000);}
    assert.strictEqual(status,0);
    for(let component=0;component<4;component++)for(let lane=0;lane<4;lane++)
      assert.strictEqual(F[(ctx+32)/4+component*4+lane],expected[component]);
    assert.deepStrictEqual(Array.from(new Int32Array(memory.buffer,ctx+73760,4)),params);
    e.d3d_shader_vm_free(ctx);cases++;
  }
  for(const params of [[-1,0,0,0],[256,0,0,0],[1,-1,0,0],[1,256,0,0],
    [1,0,-129,0],[1,0,128,0],[1,0,0,1],
    [0,-1,0,0],[0,0,-129,0],[0,0,0,1]]){
    const ctx=e.d3d_shader_vm_context(program,15)>>>0;U.set(params,(ctx+73760)/4);
    assert.strictEqual(e.d3d_shader_vm_run(ctx,1000),-5);e.d3d_shader_vm_free(ctx);cases++;
  }
  e.d3d_shader_vm_free(program);
  const loop=instruction(27,arg(15),arg(7)),end=instruction(29);
  const relative=instruction(1,arg(0,0,15),arg(2,0,228,1280));
  for(const invalid of [[end],[loop],[loop,instruction(39)],
    [instruction(38,arg(7)),end],[loop,loop,end,end],
    [loop,instruction(38,arg(7)),instruction(39),end],[relative],
    [instruction(38,arg(7)),relative,instruction(39)],
    [instruction(27,arg(15,1),arg(7)),end],
    [instruction(27,arg(15),arg(7,16)),end],
    [loop,instruction(1,arg(0,0,15),arg(2,0,228,1024)),end]]){
    assert.strictEqual(compile(invalid),0,'malformed loop rejected');cases++;
  }
  const high=compile([def(127,red),def(128,green),loop,
    instruction(1,arg(0,0,15),arg(2,127,228,1280)),end]);assert(high);
  const ctx=e.d3d_shader_vm_context(high,15)>>>0;
  U.set([2,0,1,0],(ctx+73760)/4);
  assert.strictEqual(e.d3d_shader_vm_run(ctx,3),1); // two DEFs and entry
  assert.strictEqual(U[(ctx+74088)/4],2);
  U.set([255,255,127,0],(ctx+73760)/4); // entry must have snapshotted all parameters
  assert.strictEqual(e.d3d_shader_vm_run(ctx,2),1);
  assert.strictEqual(U[(ctx+74092)/4],1);
  assert.strictEqual(e.d3d_shader_vm_run(ctx,2),0);
  for(let c=0;c<4;c++)for(let lane=0;lane<4;lane++)
    assert.strictEqual(F[(ctx+32)/4+c*4+lane],green[c]);
  e.d3d_shader_vm_free(ctx);cases++;
  for(const budget of [0,1,3,4]){
    const c=e.d3d_shader_vm_context(high,15)>>>0;U.set([255,0,1,0],(c+73760)/4);
    assert.strictEqual(e.d3d_shader_vm_run(c,budget),1);
    e.d3d_shader_vm_cancel(c);assert.strictEqual(e.d3d_shader_vm_run(c,1000),-2);
    e.d3d_shader_vm_free(c);cases++;
  }
  const closing=high+16+4*64;
  const corrupt=e.d3d_shader_vm_context(high,15)>>>0;U.set([2,0,1,0],(corrupt+73760)/4);
  assert.strictEqual(e.d3d_shader_vm_run(corrupt,3),1);
  U[closing/4]=66; // cannot replace ENDLOOP with ENDREP after validated entry
  assert.strictEqual(e.d3d_shader_vm_run(corrupt,100),-1);
  e.d3d_shader_vm_free(corrupt);e.d3d_shader_vm_free(high);cases++;
  console.log('PASS private LOOP VM '+cases+' count/stride/relative/budget/domain cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
