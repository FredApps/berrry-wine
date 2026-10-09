'use strict';
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const root=path.resolve(__dirname,'..');
const out=process.argv[2] || path.join(root,'scratch/runs',new Date().toISOString().replace(/[:.]/g,'-')+'-gl-border-web');
const puppeteer=require(root+'/node_modules/puppeteer');
fs.mkdirSync(out,{recursive:true});
let browser;const startedAt=new Date().toISOString();
const guard=setTimeout(()=>{if(browser)browser.process().kill('SIGKILL');process.exitCode=1;},120000);
(async()=>{try{
 browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const page=await browser.newPage();
 for(const f of ['gpu-backend.js','gl-command-stream.js','gl-compat.js'])await page.addScriptTag({path:root+'/lib/'+f});
 fs.writeFileSync(out+'/identity.json',JSON.stringify({startedAt,pid:process.pid,chromePid:browser.process().pid,browser:await browser.version(),source:'working tree gl-compat.js pinned by SHA256',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(root+'/lib/gl-compat.js')).digest('hex')}));
 const results=await page.evaluate(()=>{
  const results=[];
  for(const version of [1,2]){
   const canvas=document.createElement('canvas');canvas.width=canvas.height=64;document.body.appendChild(canvas);
   const b=new GpuBackend.WebGLBackend(canvas,{apiVersion:version,preserveDrawingBuffer:true,antialias:false,alpha:true});
   const f=new OpenGLCompat.FixedFunctionGL(b),G=OpenGLCompat.constants,g=b.gl;g.viewport(0,0,64,64);g.disable(g.DITHER);
   f.bindTexture(1);f.setEnabled(G.TEXTURE_2D,true);f.setTextureMode(G.REPLACE);
   const upload=(level,size,color)=>f.texImage(level,G.RGBA,size,size,0,G.RGBA,G.UNSIGNED_BYTE,new Uint8Array(Array.from({length:size*size},()=>color).flat()));
   upload(0,4,[255,255,255,255]);f.texParameter(G.TEXTURE_MIN_FILTER,G.LINEAR);f.texParameter(G.TEXTURE_MAG_FILTER,G.LINEAR);
   f.texParameter(G.TEXTURE_WRAP_S,G.CLAMP);f.texParameter(G.TEXTURE_WRAP_T,G.CLAMP);f.texBorderColor([1,0,0,0]);
   function draw(label,u,v,expected,vRange=0){
    const vertices=[];
    for(const[x,y]of[[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]])vertices.push(x,y,0,1,1,1,1,u,vRange?(y+1)*vRange/2:v,0,0,1,u,vRange?(y+1)*vRange/2:v);
    f.enqueuePacked(G.TRIANGLES,new Float32Array(vertices));f.flushPendingDraw();
    const pixel=new Uint8Array(4);g.readPixels(32,32,1,1,g.RGBA,g.UNSIGNED_BYTE,pixel);const error=g.getError();
    results.push({version,label,pixel:Array.from(pixel),expected,error});
    if(error||pixel.some((c,i)=>Math.abs(c-expected[i])>2))throw Error(JSON.stringify(results.at(-1)));
   }
   draw('linear edge',0,.5,[255,128,128,128]);draw('linear corner',0,0,[255,64,64,64]);
   f.texParameter(G.TEXTURE_MAG_FILTER,G.NEAREST);draw('nearest edge',0,.5,[255,255,255,255]);
   f.texParameter(G.TEXTURE_MAG_FILTER,G.LINEAR);f.texParameter(G.TEXTURE_WRAP_S,G.CLAMP_TO_EDGE);f.texParameter(G.TEXTURE_WRAP_T,G.CLAMP_TO_EDGE);
   draw('return to ordinary shader',0,0,[255,255,255,255]);
   upload(0,4,[0,0,255,255]);upload(1,2,[0,255,0,255]);
   f.texParameter(G.TEXTURE_WRAP_S,G.CLAMP);f.texParameter(G.TEXTURE_WRAP_T,G.REPEAT);f.texParameter(G.TEXTURE_MIN_FILTER,0x2701);
   draw('incomplete mip chain disables texture',0,0,[255,255,255,255],32);
   upload(2,1,[255,255,0,255]);
   draw('mip1 border footprint',0,0,[128,128,0,128],32);
   f.texParameter(G.TEXTURE_MIN_FILTER,0x2703);draw('trilinear border footprint',0,0,[191,128,0,128],32*Math.SQRT2);
   f.setActiveTexture(0x84C1);f.bindTexture(2);f.setEnabled(G.TEXTURE_2D,true);f.setTextureMode(G.REPLACE);
   upload(0,4,[255,255,255,255]);f.texParameter(G.TEXTURE_MIN_FILTER,G.LINEAR);f.texParameter(G.TEXTURE_MAG_FILTER,G.LINEAR);
   f.texParameter(G.TEXTURE_WRAP_S,G.CLAMP);f.texParameter(G.TEXTURE_WRAP_T,G.CLAMP);f.texBorderColor([0,1,0,0]);
   draw('independent unit1 green border',0,.5,[128,255,128,128]);
   const preview=document.createElement('canvas');preview.width=preview.height=64;
   const raw=new Uint8Array(64*64*4);g.readPixels(0,0,64,64,g.RGBA,g.UNSIGNED_BYTE,raw);
   const ctx=preview.getContext('2d'),frame=ctx.createImageData(64,64);
   for(let y=0;y<64;y++)frame.data.set(raw.subarray(y*256,(y+1)*256),(63-y)*256);
   ctx.putImageData(frame,0,0);canvas.replaceWith(preview);
   b.destroy();
  }
  return results;
 });
 fs.writeFileSync(out+'/pixels.json',JSON.stringify(results,null,2));await page.screenshot({path:out+'/pixels.png'});
 console.log(JSON.stringify(results));
}catch(e){fs.writeFileSync(out+'/error.json',JSON.stringify({error:e.stack||String(e)}));console.error(e.stack);process.exitCode=1;
}finally{if(browser)await browser.close();clearTimeout(guard);fs.writeFileSync(out+'/cleanup.json',JSON.stringify({finishedAt:new Date().toISOString(),pid:process.pid,exitCode:process.exitCode||0}));}})();
