#!/usr/bin/env node
'use strict';
const assert=require('assert'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-first-run','--no-default-browser-check']});
 try{
  const page=await browser.newPage();
  for(const f of ['gpu-backend.js','d3d9-shader.js','d3d9-fixed.js','d3d9-backend.js'])await page.addScriptTag({path:path.join(__dirname,'../lib',f)});
  const result=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
   const d=new D3D9Backend.Device(canvas),g=d.gpu,gl=g.gl;
   const a={id:1,width:4,height:4,format:75},b={id:2,width:8,height:7,format:75};
   const vs=new Uint32Array([0xfffe0101,1,0xc00f0000,0x90e40000,0xffff]),ps=new Uint32Array([0xffff0101,1,0x800f0000,0xa0e40000,0xffff]);
   const draw=(state={},attachment=a,reverse=false)=>d.draw({vertexShader:vs,pixelShader:ps,primitive:4,primitiveCount:1,stride:16,
    vertices:new Uint8Array(new Float32Array(reverse?[-1,-1,.5,1,-1,3,.5,1,3,-1,.5,1]:[-1,-1,.5,1,3,-1,.5,1,-1,3,.5,1]).buffer),
    attributes:[{register:0,type:3,offset:0}],pixelConstants:new Float32Array([1,0,0,1]),depthAttachment:attachment,
    state:{cull:1,zenable:false,stencilEnable:true,...state}});
   const clear=(value,attachment=a,rects=null)=>d.clear([0,0,0,1],7,1,rects,attachment,value);
   const check=(value,attachment=a,x=1,y=1)=>{
    d.clear([0,0,0,1],1,1,null,attachment);
    draw({stencilFunc:3,stencilRef:value,stencilWriteMask:0},attachment);
    return g.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4))[0]===255;
   };
   const cases=[];
   for(const [func,expected]of [[1,false],[2,true],[3,false],[4,true],[5,false],[6,true],[7,false],[8,true]]){
    clear(8);draw({stencilFunc:func,stencilRef:7});
    cases.push((g.readPixels(1,1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4))[0]===255)===expected);
   }
   for(const [op,seed,expected]of [[1,9,9],[2,9,0],[3,9,37],[4,255,255],[5,0,0],[6,15,240],[7,255,0],[8,0,255]]){
    clear(seed);draw({stencilPass:op,stencilRef:37});cases.push(check(expected));
   }
   clear(9);draw({stencilFunc:1,stencilFail:3,stencilRef:42});cases.push(check(42));
   clear(9);draw({zenable:true,zfunc:1,stencilZFail:3,stencilRef:43});cases.push(check(43));
   clear(0xaa);draw({stencilPass:3,stencilRef:0x55,stencilWriteMask:15});cases.push(check(0xa5));
   clear(0xab);draw({stencilFunc:3,stencilRef:0x1b,stencilMask:15,stencilPass:2});cases.push(check(0));
   clear(0);draw({twoSidedStencil:true,stencilPass:3,ccwStencilPass:7,stencilRef:7});cases.push(check(1));
   clear(0);draw({twoSidedStencil:true,stencilPass:3,ccwStencilPass:7,stencilRef:7},a,true);cases.push(check(7));
   clear(12,a);clear(34,b);cases.push(check(12,a));cases.push(check(34,b));
   clear(255,a,[[0,0,2,2]]);cases.push(check(255,a,0,3));cases.push(check(12,a,3,0));
   clear(66);draw({stencilWriteMask:0});clear(77);cases.push(check(77));
   d.present();cases.push(check(77));
   d.releaseDepth(1);cases.push(check(0));
   const errors=[];
   for(const depth of [null,{id:3,width:4,height:4,format:77},{id:4,width:4,height:4,format:80}]){
    try{draw({},depth);errors.push(false);}catch(e){errors.push(true);}
    try{clear(1,depth);errors.push(false);}catch(e){errors.push(true);}
   }
   const error=g.getError();d.destroy();return {cases,errors,error};
  });
  assert(result.cases.every(Boolean),JSON.stringify(result));assert(result.errors.every(Boolean));assert.strictEqual(result.error,0);
  console.log('PASS GPU D24S8 stencil: 8 operations, fail/zfail/pass, masks, two-sided winding, oversized identity, rectangular Clear and release');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
