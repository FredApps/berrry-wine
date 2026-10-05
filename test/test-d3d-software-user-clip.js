'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none'});
 const u8=new Uint8Array(memory.buffer),u32=new Uint32Array(memory.buffer),f32=new Float32Array(memory.buffer);
 const allocations=[];const alloc=n=>{const p=e.guest_to_wasm(e.guest_alloc(n))>>>0;assert(p);allocations.push(p);return p;};
 const program=t=>{const p=alloc(t.length*4);u32.set(t,p/4);const ir=e.d3d_shader_ir_compile(p,t.length);assert(ir);const vm=e.d3d_shader_vm_compile(ir);e.d3d_shader_ir_free(ir);assert(vm);return vm;};
 const vs=program([0xfffe0101,1,0xc00f0000,0x90e40000,1,0xd00f0000,0x90e40001,0xffff]);
 const ps=program([0xffff0101,1,0x800f0000,0x90e40000,0xffff]);
 const vsPoints=program([0xfffe0101,1,0xc00f0000,0x90e40000,1,0xd00f0000,0x90e40001,1,0xc0010002,0x90000002,0xffff]);
 const planes=alloc(96),desc=alloc(128),color=alloc(288),depth=alloc(288),vertices=alloc(6*48),indices=alloc(768*2);
 const plane=(n,v)=>f32.set(v,planes/4+n*4);
 function begin(mask,options={}){
  const corners=options.expansive?[[-4,4],[4,4],[0,-4],[-4,4],[4,4],[0,-4]]:[[-1,1],[1,1],[-1,-1],[-1,-1],[1,1],[1,-1]];
  corners.forEach(([x,y],i)=>{const w=options.varyW?[1,2,4,4,2,3][i]:1,scale=options.points?.5:1;
   f32.set([x*w*scale,y*w*scale,.5*w,w,1,0,0,1,2,0,0,1],vertices/4+i*12);});
  u8.fill(0x5a,color,color+288);u8.fill(0x6b,depth,depth+288);
  u32.fill(0xff000000,(color+16)/4,(color+272)/4);f32.fill(1,(depth+16)/4,(depth+272)/4);
  u32.fill(0,desc/4,desc/4+32);u32.set([0x44535031,1,8,8,color+16,32,depth+16,32,vertices,6,48,0,6,vs,ps,0,0,0,0,0,0,8,8],desc/4);
  f32[desc/4+24]=1;u32.set([options.flags??3,2,15,1],desc/4+25);
  if(options.points)u32[desc/4+13]=vsPoints;
  const ctx=e.d3d_software_create_deferred_clipped(desc,0,planes,mask);
  return ctx;
 }
 function prepare(ctx){let result=1,steps=0;while(result===1){result=e.d3d_software_prepare_step(ctx,1,1);assert(++steps<1000);}assert.strictEqual(result,0);}
 function run(ctx,fill=3){prepare(ctx);if(fill!==3)assert.strictEqual(e.d3d_software_bind_fill(ctx,fill,1),1);
  if(fill===1){const state=alloc(32);u32.fill(0,state/4,state/4+8);u32[state/4]=1;f32.set([1,0,64,64],state/4+2);assert.strictEqual(e.d3d_software_bind_points(ctx,state),1);}
  let result=1;while(result===1)result=e.d3d_software_step(ctx,1);assert.strictEqual(result,0);
  for(const [p,v]of[[color,0x5a],[depth,0x6b]]){assert(u8.slice(p,p+16).every(x=>x===v));assert(u8.slice(p+272,p+288).every(x=>x===v));}
 }
 const pixels=()=>Array.from(u32.slice((color+16)/4,(color+272)/4));
 const half=Array.from({length:64},(_,i)=>i%8>=4?0xffff0000:0xff000000);
 let cases=0;
 try{
  assert.strictEqual(e.d3d_software_clipped_allocation_bound(6,768,0),e.d3d_software_deferred_allocation_bound(6,768));
  assert(e.d3d_software_clipped_allocation_bound(6,630,63)>e.d3d_software_deferred_allocation_bound(6,630));
  assert.strictEqual(e.d3d_software_clipped_allocation_bound(6,633,1),0);
  assert.strictEqual(e.d3d_software_clipped_allocation_bound(6,6,64),0);
  for(let n=0;n<6;n++)for(const varyW of [false,true]){
   f32.fill(0,planes/4,planes/4+24);plane(n,[1,0,0,.125]);
   const ctx=begin(1<<n,{varyW});assert(ctx);
   const owned=u32[(u32[(ctx+160)/4]+56)/4];assert.notStrictEqual(owned,planes);
   f32.fill(99,planes/4,planes/4+24); // caller changes after constructor cannot affect pending work
   run(ctx);assert.deepStrictEqual(pixels(),half,`plane${n}/varyW${varyW}`);
   for(let i=0;i<64;i++)assert(Math.abs(f32[(depth+16)/4+i]-(i%8>=4?.5:1))<2e-7);
   e.d3d_software_free(ctx);cases++;
  }
  f32.fill(0,planes/4,planes/4+24);for(let n=0;n<6;n++)plane(n,[1,0,0,.125]);
  let ctx=begin(63);run(ctx);assert.deepStrictEqual(pixels(),half);e.d3d_software_free(ctx);cases++;
  [[1,1,0,1.6],[-1,1,0,1.6],[1,-1,0,1.6],[-1,-1,0,1.6],[1,.3,0,.98],[-1,-.3,0,.98]].forEach((v,n)=>plane(n,v));
  ctx=begin(63,{expansive:true});prepare(ctx);
  assert(u32[(ctx+48)/4]>42,'combined frustum/user planes exceed old seven-triangle fan capacity');
  run(ctx);e.d3d_software_free(ctx);cases++;
  ctx=begin(0);const bytes=u32[(ctx+196)/4];run(ctx);assert(pixels().every(x=>x===0xffff0000));e.d3d_software_free(ctx);
  ctx=begin(0);assert.strictEqual(u32[(ctx+196)/4],bytes);e.d3d_software_free(ctx);cases++;
  plane(0,[0,0,0,-1]);ctx=begin(1);run(ctx);assert(pixels().every(x=>x===0xff000000));assert(f32.slice((depth+16)/4,(depth+272)/4).every(x=>x===1));assert.strictEqual(e.d3d_software_samples(ctx),0n);e.d3d_software_free(ctx);cases++;
  plane(0,[1,0,0,.125]);ctx=begin(1);run(ctx,2);
  // New vertical clip edge through x3.5 must not appear in wireframe.
  assert.strictEqual(u32[(color+16)/4+2*8+4],0xff000000);e.d3d_software_free(ctx);cases++;
  ctx=begin(1,{flags:8,points:true});run(ctx,1);
  assert.strictEqual(e.d3d_software_samples(ctx),12n,'original indexed points retain oPts sidecar through clipping/compaction');
  assert.strictEqual(pixels().filter(x=>x===0xffff0000).length,8,'no intersection-generated points');
  e.d3d_software_free(ctx);cases++;
  for(const value of [NaN,Infinity,-Infinity]){plane(0,[value,0,0,0]);assert.strictEqual(begin(1),0);cases++;}
  f32.fill(0,planes/4,planes/4+24);assert.strictEqual(begin(64),0);assert.strictEqual(begin(1,{flags:4}),0);cases+=2;
  ctx=begin(1);assert(ctx);e.d3d_software_cancel(ctx);assert.strictEqual(e.d3d_software_prepare_step(ctx,1,1),-2);e.d3d_software_free(ctx);cases++;
  // Internal clipped batch bound; mask0 retains the ordinary768-index API.
  begin(64);new Uint16Array(memory.buffer,indices,768).fill(0);u32[desc/4+11]=indices;u32[desc/4+12]=633;
  assert.strictEqual(e.d3d_software_create_deferred_clipped(desc,0,planes,1),0);
  ctx=e.d3d_software_create_deferred_clipped(desc,0,planes,0);assert(ctx);e.d3d_software_free(ctx);cases++;
  u32[desc/4+12]=630;ctx=e.d3d_software_create_deferred_clipped(desc,0,planes,63);assert(ctx);run(ctx);e.d3d_software_free(ctx);cases++;
  console.log('PASS native user clip planes '+cases+' cases: six planes, snapshots, W, shared edges, depth, wireframe, bounds/cancel');
 }finally{e.d3d_shader_vm_free(vs);e.d3d_shader_vm_free(vsPoints);e.d3d_shader_vm_free(ps);for(const p of allocations)e.d3d_shader_vm_free(p);}
})().catch(error=>{console.error(error);process.exitCode=1;});
