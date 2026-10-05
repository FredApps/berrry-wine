#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs'),path=require('path');
const {bootRenderHarness}=require('./render-helper');
const IR=require('../lib/d3d-shader-ir');
(async()=>{
  const manifest=fs.readFileSync(path.join(__dirname,'../src/main.watx'),'utf8');
  const extraWat=manifest.includes('09aj-d3d-fixed.wat')?'':fs.readFileSync(path.join(__dirname,'../src/09aj-d3d-fixed.wat'),'utf8');
  const{exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat});
  const u8=new Uint8Array(memory.buffer),u32=new Uint32Array(memory.buffer),f32=new Float32Array(memory.buffer);
  const alloc=n=>e.guest_to_wasm(e.guest_alloc(n))>>>0;
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  function fixed(options={}){
    const p=alloc(320);u32.fill(0,p/4,p/4+80);
    u32.set([0x44465831,options.abi||1,options.flags===undefined?6:options.flags,0,5,7,
      options.colorOp||4,options.arg1===undefined?2:options.arg1,options.arg2===undefined?0:options.arg2,
      options.alphaOp||2,options.alphaArg1===undefined?2:options.alphaArg1,options.alphaArg2===undefined?0:options.alphaArg2,
      options.factor===undefined?0xffffffff:options.factor,options.constant===undefined?0xffffffff:options.constant,
      options.stage1||1,options.transform||0,options.coordIndex||0,options.x||0,options.y||0,options.width||8,options.height||8],p/4);
    f32[p/4+21]=options.minZ===undefined?0:options.minZ;f32[p/4+22]=options.maxZ===undefined?1:options.maxZ;
    for(const[key,offset]of[['world',24],['view',40],['projection',56]])f32.set(options[key]||identity,p/4+offset);
    if(options.points)f32.set(options.points,p/4+72);
    if(options.mutate)options.mutate(p);
    return{desc:p,bundle:options.stage==='vertex'?e.d3d_fixed_compile_vertex(p,options.uvRequired||0):options.stage==='pixel'?e.d3d_fixed_compile_pixel(p):e.d3d_fixed_compile(p)};
  }
  const vertex=(x,y,z=.5,w=1,color=[1,0,0,1],uv=[.25,.25,0,1])=>[x,y,z,w,...color,...uv];
  const triangle=[vertex(-1,1),vertex(1,1),vertex(-1,-1)];
  function raster(bundle,vertices,options={}){
    assert.ok(bundle,'fixed state compiles');
    const width=options.targetWidth||8,height=options.targetHeight||8,pitch=width*4+8,base=alloc(pitch*height+32),target=base+16,depthBase=alloc(pitch*height+32),depth=depthBase+16;
    u8.fill(0x7d,base,base+pitch*height+32);u8.fill(0x6d,depthBase,depthBase+pitch*height+32);
    assert.strictEqual(e.d3d_software_clear(target,width,height,pitch,0xff000000,depth,pitch,1,3),0);
    const input=alloc(vertices.length*48);vertices.forEach((v,i)=>f32.set(v,input/4+i*12));
    const d=alloc(128);u32.fill(0,d/4,d/4+32);
    u32.set([0x44535031,1,width,height,target,pitch,depth,pitch,input,vertices.length,48,0,vertices.length,
      options.vs||u32[bundle/4+3],options.ps||u32[bundle/4+4],0,0,0,0,options.x||0,options.y||0,options.width||width,options.height||height],d/4);
    for(const[key,slot]of[['vsConstants',15],['psConstants',17]])if(options[key]){
      const p=alloc(options[key].length*4);f32.set(options[key],p/4);u32[d/4+slot]=p;u32[d/4+slot+1]=options[key].length/4;
    }
    f32[d/4+23]=options.minZ===undefined?0:options.minZ;f32[d/4+24]=options.maxZ===undefined?1:options.maxZ;
    u32.set([options.point?11:3,2,15,1,options.inputMap||u32[bundle/4+6],0,0],d/4+25);
    const ctx=e.d3d_software_create(d);assert.ok(ctx,'fixed programs create software draw');
    if(options.point){
      assert.strictEqual(e.d3d_software_bind_fill(ctx,1,1),1);
      const p=alloc(32);u32.fill(0,p/4,p/4+8);u32[p/4]=1;f32.set([1,0,64,64],p/4+2);
      assert.strictEqual(e.d3d_software_bind_points(ctx,p),1);
    }
    if(options.sampled||u32[bundle/4+5]){
      const pixels=alloc(16),sampler=alloc(36);u8.set(options.texture||Array(4).fill([255,255,255,255]).flat(),pixels);
      u32.set([pixels,2,2,8,0,3,3,1,0],sampler/4);assert.strictEqual(e.d3d_software_bind_texture(ctx,0,sampler),1);
    }
    let result=1,n=0;while(result===1){result=e.d3d_software_step(ctx,2);assert.ok(++n<10000);}assert.strictEqual(result,0);
    for(const[b,value]of[[base,0x7d],[depthBase,0x6d]]){
      assert.ok(u8.slice(b,b+16).every(v=>v===value));assert.ok(u8.slice(b+16+pitch*height,b+32+pitch*height).every(v=>v===value));
      for(let y=0;y<height;y++)assert.ok(u8.slice(b+16+y*pitch+width*4,b+16+(y+1)*pitch).every(v=>v===value));
    }
    e.d3d_software_free(ctx);
    return{pixel:(x,y)=>u32[(target+y*pitch+x*4)/4]>>>0,depth:(x,y)=>f32[(depth+y*pitch+x*4)/4]};
  }
  let cases=0;
  {
    const f=fixed({abi:2,flags:102,points:[.25,1,0,0]});
    const r=raster(f.bundle,[vertex(0,0),vertex(10,0),vertex(0,10)],{point:true});
    assert.strictEqual(r.pixel(3,3),0xffff0000,'fixed scaled point size2 reaches top-left corner');
    assert.strictEqual(r.pixel(5,4),0xff000000,'fixed scaled point right edge is exclusive');
    assert.strictEqual(r.depth(3,3),.5);e.d3d_fixed_free(f.bundle);cases++;
  }
  for(const [flags,coefficients,expected]of[[102,[2,1,0,0],16],[102,[2,0,0,1],8],[102,[2,1,2,3],16/Math.sqrt(17)],[38,[3,1,0,0],3],[119,[3,0,0,1],3]]){
    const f=fixed({abi:2,flags,points:coefficients}),program=u32[f.bundle/4+3];assert.ok(f.bundle);
    assert.strictEqual(e.d3d_shader_vm_has_point_size(program),1);
    const ctx=e.d3d_shader_vm_context(program,15),base=(ctx+32+128*64)/4;
    f32.fill(0,base,base+16);f32.fill(2,base+8,base+12);f32.fill(1,base+12,base+16);
    assert.strictEqual(e.d3d_shader_vm_run(ctx,128),0);
    for(let lane=0;lane<4;lane++)assert.ok(Math.abs(f32[(ctx+32928)/4+lane]-expected)<1e-4,'fixed point camera-distance law and POSITIONT exception');
    e.d3d_shader_vm_free(ctx);e.d3d_fixed_free(f.bundle);cases++;
  }
  function guest(words){
    const p=alloc(words.length*4);u32.set(words,p/4);
    const ir=e.d3d_shader_ir_compile(p,words.length);assert.ok(ir,'guest bytecode accepted');
    const program=e.d3d_shader_vm_compile(ir);assert.ok(program,'guest IR compiles');
    return{program,free(){e.d3d_shader_vm_free(program);e.d3d_shader_ir_free(ir);}};
  }
  {
    const ps=guest([0xffff0101,1,0x800f0000,0xa0e40000,0xffff]);
    const f=fixed({stage:'vertex',colorOp:999,arg1:999,stage1:999});
    assert.ok(f.bundle);assert.strictEqual(u32[f.bundle/4+2],0);assert.strictEqual(u32[f.bundle/4+4],0);
    assert.strictEqual(raster(f.bundle,triangle,{ps:ps.program,psConstants:[0,1,0,1],vsConstants:Array(52).fill(0)}).pixel(1,1),0xff00ff00,'fixed VS DEF constants independent from guest PS constants');
    e.d3d_fixed_free(f.bundle);ps.free();cases++;
  }
  {
    const vs=guest([0xfffe0101,1,0xc00f0000,0x90e40000,1,0xd00f0000,0xa0e40000,0xffff]);
    const f=fixed({stage:'pixel',colorOp:2,arg1:0,alphaOp:2,alphaArg1:0,mutate:p=>{u32[p/4+3]=999;u32[p/4+19]=0;f32[p/4+24]=NaN;}});
    assert.ok(f.bundle);assert.strictEqual(u32[f.bundle/4+1],0);assert.strictEqual(u32[f.bundle/4+3],0);
    assert.strictEqual(raster(f.bundle,triangle,{vs:vs.program,inputMap:0x750,vsConstants:[0,0,1,1],psConstants:Array(16).fill(0)}).pixel(1,1),0xff0000ff,'guest VS constants and fixed PS independently execute');
    e.d3d_fixed_free(f.bundle);vs.free();cases++;
  }
  {
    const ps=guest([0xffff0101,66,0xb00f0000,1,0x800f0000,0xb0e40000,0xffff]);
    const f=fixed({stage:'vertex',uvRequired:1,colorOp:1});
    assert.strictEqual(raster(f.bundle,triangle,{ps:ps.program,sampled:true,texture:Array(4).fill([0,255,255,255]).flat()}).pixel(1,1),0xff00ffff,'fixed VS UV output requested by guest PS independently of disabled combiners');
    e.d3d_fixed_free(f.bundle);ps.free();cases++;
    assert.strictEqual(fixed({stage:'vertex',flags:2,uvRequired:1}).bundle,0);cases++;
    assert.strictEqual(fixed({stage:'vertex',uvRequired:2}).bundle,0);cases++;
  }
  {
    const vs=guest([0xfffe0101,1,0xc00f0000,0x90e40000,1,0xd00f0000,0xa0e40000,1,0xe00f0000,0xa0e40001,0xffff]);
    const f=fixed({stage:'pixel',flags:8,colorOp:2,arg1:2,alphaOp:2,alphaArg1:2});
    assert.ok(f.bundle,'fixed PS texture consumes guest VS output without fixed UV input flag');
    const result=raster(f.bundle,triangle,{vs:vs.program,inputMap:0x750,vsConstants:[1,1,1,1,.75,.25,0,1],texture:[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]});
    assert.strictEqual(result.pixel(1,1),0xff00ff00,'guest VS texture coordinate reaches fixed sampler');
    e.d3d_fixed_free(f.bundle);vs.free();cases++;
  }
  for(const stage of['vertex','pixel']){
    const f=fixed({stage});assert.ok(f.bundle);e.d3d_fixed_free(f.bundle);
    const before=memory.buffer.byteLength;
    for(let i=0;i<1000;i++){
      const bundle=stage==='vertex'?e.d3d_fixed_compile_vertex(f.desc,0):e.d3d_fixed_compile_pixel(f.desc);
      assert.ok(bundle);e.d3d_fixed_free(bundle);
    }
    assert.strictEqual(memory.buffer.byteLength,before,'selected-stage bundle allocations are reclaimed');cases++;
  }
  {
    const f=fixed();assert.ok(f.bundle);
    const vs=IR.read(memory.buffer,u32[f.bundle/4+1]),ps=IR.read(memory.buffer,u32[f.bundle/4+2]);
    assert.strictEqual(vs.flags,4);assert.strictEqual(ps.flags,4,'fixed origin not guest bytecode');
    assert.strictEqual(vs.instructions.filter(i=>i.opcode===20).length,3,'real world/view/projection shader operations');
    const d=raster(f.bundle,triangle);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.strictEqual(d.pixel(x,y),x+y<8?0xffff0000:0xff000000,'identity fixed pixels');
    e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const world=identity.slice();world[12]=2;const f=fixed({world});const d=raster(f.bundle,triangle);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.strictEqual(d.pixel(x,y),0xff000000,'world translation really transforms/ clips geometry');e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const world=identity.slice(),view=identity.slice(),projection=identity.slice();world[12]=.25;view[0]=2;projection[0]=.25;
    const f=fixed({world,view,projection}),ctx=e.d3d_shader_vm_context(u32[f.bundle/4+3],1);assert.ok(ctx);
    const regs=(ctx+32)/4;f32[regs+128*16]=.25;f32[regs+128*16+12]=1;
    assert.strictEqual(e.d3d_shader_vm_run(ctx,100),0);assert.strictEqual(f32[regs+512*16],.25,'row-vector world then view then projection, correct column constants');
    e.d3d_shader_vm_free(ctx);e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const f=fixed({flags:4});assert.strictEqual(raster(f.bundle,triangle).pixel(1,1),0xffffffff,'missing diffuse is white');e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const f=fixed({flags:14,alphaOp:4}),verts=triangle.map(v=>[...v.slice(0,4),.5,.5,1,.25,...v.slice(8)]);
    const d=raster(f.bundle,verts,{texture:Array(4).fill([128,255,64,255]).flat()});assert.strictEqual(d.pixel(1,1),0x40408040,'texture/diffuse modulate and independent alpha');e.d3d_fixed_free(f.bundle);cases++;
  }
  for(let op=2;op<=11;op++){
    const f=fixed({colorOp:op,arg1:3,arg2:6,factor:0xff333333,constant:0xff666666,alphaOp:1});
    const d=raster(f.bundle,triangle),a=51/255,b=102/255;
    const result={2:a,3:b,4:a*b,5:2*a*b,6:4*a*b,7:a+b,8:a+b-.5,9:2*(a+b-.5),10:a-b,11:a+b-a*b}[op];
    const value=Math.round(Math.max(0,Math.min(1,result))*255),pixel=d.pixel(1,1);
    for(const shift of[0,8,16])assert.ok(Math.abs((pixel>>>shift&255)-value)<=1,`combiner ${op} normalized f32 precision`);
    assert.strictEqual(pixel>>>24,255);e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const f=fixed({colorOp:2,arg1:3|16|32,factor:0x40336699,alphaOp:1});const d=raster(f.bundle,triangle);assert.strictEqual(d.pixel(1,1),0xffbfbfbf,'complement and alpha replicate');e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const f=fixed({flags:7});const verts=[vertex(0,0),vertex(8,0),vertex(0,8)],d=raster(f.bundle,verts);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.strictEqual(d.pixel(x,y),x+y<8?0xffff0000:0xff000000,'POSITIONT uses integer centers without GL halfpixel shift');e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const options={flags:7,x:1,y:1,width:5,height:3,minZ:.2,maxZ:.6},f=fixed(options);
    const d=raster(f.bundle,[vertex(1,1,.4),vertex(6,1,.4),vertex(1,4,.4)],options);
    assert.strictEqual(d.pixel(1,1),0xffff0000);assert.strictEqual(d.pixel(0,0),0xff000000);assert.ok(Math.abs(d.depth(1,1)-.4)<1e-6);e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const f=fixed({flags:7}),d=raster(f.bundle,[vertex(0,0,.5,1,[1,0,0,1]),vertex(8,0,.5,.5,[0,1,0,1]),vertex(0,8,.5,.25,[0,0,1,1])]);
    assert.strictEqual(d.pixel(2,2),(0xff000000|Math.round(255*8/11)<<16|Math.round(255*2/11)<<8|Math.round(255/11))>>>0,'POSITIONT preserves RHW perspective');e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const options={flags:7,minZ:.4,maxZ:.4},f=fixed(options),d=raster(f.bundle,[vertex(0,0,.9),vertex(8,0,.9),vertex(0,8,.9)],options);
    assert.strictEqual(d.pixel(1,1),0xffff0000);assert.ok(Math.abs(d.depth(1,1)-.4)<1e-6,'zero depth range matches fixed viewport contract');e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const f=fixed(),verts=triangle.map(v=>[...v.slice(0,4),-1,2,.5,1.5,...v.slice(8)]);
    assert.strictEqual(raster(f.bundle,verts).pixel(1,1),0xff00ff80,'vertex diffuse clamped before interpolation');e.d3d_fixed_free(f.bundle);cases++;
  }
  {
    const f=fixed(),vsPtr=u32[f.bundle/4+1],psPtr=u32[f.bundle/4+2];
    const vsBytes=u8.slice(vsPtr,vsPtr+u32[vsPtr/4+6]),psBytes=u8.slice(psPtr,psPtr+u32[psPtr/4+6]);
    u32.fill(0,f.desc/4,f.desc/4+72);
    assert.strictEqual(raster(f.bundle,triangle).pixel(1,1),0xffff0000,'compiled bundle does not reread mutable fixed-state descriptor');
    assert.deepStrictEqual(u8.slice(vsPtr,vsPtr+vsBytes.length),vsBytes);assert.deepStrictEqual(u8.slice(psPtr,psPtr+psBytes.length),psBytes,'execution does not mutate shared IR');
    e.d3d_fixed_free(f.bundle);cases++;
  }
  for(const options of[{flags:32},{flags:16},{flags:128},{colorOp:12,arg1:0},{flags:14,transform:1},{flags:14,stage1:4},{flags:10},{flags:14,coordIndex:8}]){
    const f=fixed(options);assert.strictEqual(f.bundle,0,'unsupported fixed state rejects explicitly');cases++;
  }
  {
    const world=identity.slice();world[0]=NaN;assert.strictEqual(fixed({world}).bundle,0);cases++;
  }
  {
    const f=fixed();e.d3d_fixed_free(f.bundle);
    for(let i=0;i<1000;i++){const bundle=e.d3d_fixed_compile(f.desc);assert.ok(bundle,'bounded owned allocation can be reclaimed repeatedly');e.d3d_fixed_free(bundle);}
    cases++;
  }
  console.log(`PASS native fixed lowering: ${cases} cases, shared IR/VM, XYZ transforms, POSITIONT/RHW, stage0 combiners, pixels and explicit rejection`);
})().catch(error=>{console.error(error);process.exitCode=1;});
