'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),{Device}=require('../lib/d3d9-software-backend');
const fixtures=require('./fixtures/d3d9-scissor-cases');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none'});
 const d=new Device({getExports:()=>e,getMemory:()=>memory.buffer,width:8,height:8}),base=d.bytes;
 let checked=0;
 try{
  for(const mode of[1,2,3]){
   const draw=fixtures.draw(mode);d.clear([0,0,0,1],1);d.draw(draw);const baseline=d.present().pixels.slice();
   assert(baseline.some((v,i)=>i%4===2&&v),'baseline primitive has actual coverage');
   for(const scissor of fixtures.cases()){
    draw.scissor=scissor;d.clear([0,0,0,1],1);d.queryBegin(checked+1);d.draw(draw);const count=d.queryEnd(checked+1).samplesLow;d.queryRelease(checked+1);
    const pixels=d.present().pixels;let covered=0;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
     const inside=!scissor.enabled||(x>=scissor.left&&x<scissor.right&&y>=scissor.top&&y<scissor.bottom),p=(y*8+x)*4;
     assert.strictEqual(pixels[p+2],inside?baseline[p+2]:0,`mode${mode} scissor${checked} at${x},${y}`);
     if(pixels[p+2])covered++;
    }
    if(mode!==2)assert.strictEqual(count,covered,'scissored pixels excluded from query count');
    assert.strictEqual(d.bytes,base);checked++;
   }
  }
  const draw=fixtures.draw(),attachment={id:17,width:8,height:8,format:75};draw.depthAttachment=attachment;
  draw.scissor={enabled:true,left:2,top:1,right:6,bottom:5};
  Object.assign(draw.state,{zenable:true,zwrite:true,zfunc:8,stencilEnable:true,stencilFunc:8,stencilPass:3,stencilRef:7,stencilMask:255,stencilWriteMask:255});
  d.clear([0,0,0,1],7,1,null,attachment,0);d.draw(draw);
  const surface=d.depthSurfaces.get(17),z=new Float32Array(memory.buffer,surface.wa,64),stencil=new Uint8Array(memory.buffer,surface.stencil,64);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const inside=x>=2&&x<6&&y>=1&&y<5;assert.strictEqual(stencil[y*8+x],inside?7:0);assert(Math.abs(z[y*8+x]-(inside?.5:1))<1e-6);}
  const prepared=d.prepare(draw),ctx=prepared.context,ptr=new Uint32Array(memory.buffer,ctx+284,1)[0];
  assert(ptr);assert.strictEqual(e.d3d_software_bind_scissor(ctx,1,-1,0,8,8),0);assert.strictEqual(new Uint32Array(memory.buffer,ctx+284,1)[0],ptr,'invalid bind preserves owned rectangle');
  draw.scissor.left=0;assert.strictEqual(new Int32Array(memory.buffer,ptr,4)[0],2,'context owns immutable rectangle');
  d.step(prepared);assert.strictEqual(e.d3d_software_bind_scissor(ctx,0,0,0,0,0),0,'cannot rebind after execution begins');d.cancel();
 }finally{d.destroy();assert.strictEqual(d.bytes,0);}
 console.log('PASS software scissor '+checked+' draw cases, depth/stencil/query exclusion, copied ownership and late-bind rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
