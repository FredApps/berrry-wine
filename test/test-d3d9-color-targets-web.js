'use strict';
const assert=require('assert'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-first-run','--no-default-browser-check']});
 try{const page=await browser.newPage();
  for(const file of['lib/gpu-backend.js','lib/d3d9-shader.js','lib/d3d9-fixed.js','lib/d3d9-backend.js','test/fixtures/d3d9-color-cases.js'])await page.addScriptTag({path:path.join(__dirname,'..',file)});
  const results=await page.evaluate(async()=>{
   const results=[];for(const version of[1,2]){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const d=new D3D9Backend.Device(canvas,{webglVersion:version});
    try{results.push(await D3D9ColorCases.run({create:r=>d.createColor(r),update:(...a)=>d.updateColor(...a),clear:(...a)=>d.clear(...a),
     draw:r=>d.draw(r),read:r=>d.readColor(r),present:()=>{d.present();return d.readColor(null);},release:id=>d.releaseColor(id)}));
     const resource={id:301,width:4,height:4,format:21},depth={id:302,width:8,height:8,format:75},g=d.gpu,gl=g.gl;
     d.createColor(resource);const bytes=g._targetBytes,original=gl.checkFramebufferStatus;let calls=0,failed=false;
     gl.checkFramebufferStatus=function(...args){return ++calls===2?gl.FRAMEBUFFER_UNSUPPORTED:original.apply(this,args);};
     try{d.clear([1,0,0,1],3,1,null,depth,0,resource);}catch(e){failed=/attachment incomplete/.test(e.message);}
     finally{gl.checkFramebufferStatus=original;}
     if(!failed||g._targetBytes!==bytes||g._depthStores.has(depth.id)||g._colorResources.get(resource.id).variants.size)
       throw Error('failed FBO creation leaked new depth/color allocation');
     d.clear([1,0,0,1],3,1,null,depth,0,resource);
     if(!d.readColor(resource).pixels.every((v,i)=>v===[0,0,255,255][i%4]))throw Error('allocation retry failed');
     d.releaseColor(resource.id);d.releaseDepth(depth.id);
     if(d.gpu.getError())throw Error('GL error');
    }finally{d.destroy();}
   }return results;
  });assert(results.every(v=>v>20));console.log('WebGL independent color cases PASS '+results.join('/'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
