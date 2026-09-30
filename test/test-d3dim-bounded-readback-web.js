#!/usr/bin/env node
'use strict';
// Real GPU A/B: each fence must leave the COMPLETE padded DIB identical to
// full readback. Expected pixels separately guard against shared mistakes.
const assert = require('assert');
const path = require('path');
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless:true,
    executablePath:process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--no-first-run','--no-default-browser-check',
      ...(process.argv.includes('--no-sandbox')?['--no-sandbox']:[]),
      ...(process.argv.includes('--swiftshader')?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
  try {
    const page = await browser.newPage();
    for (const name of ['gpu-backend','d3d9-shader','d3d9-fixed','d3d9-backend','d3dim-gpu'])
      await page.addScriptTag({path:path.join(__dirname,'../lib',name+'.js')});
    const results = await page.evaluate(() => {
      function run(boundedReadback,bpp) {
        const memory=new ArrayBuffer(131072),dv=new DataView(memory),u8=new Uint8Array(memory);
        const desc=4096,vertices=8192,command=12288,rt=16384,clear=20480,dib1=32768,dib2=49152;
        const width=32,height=32,pitch=width*(bpp/8)+8;
        let dib=dib1;
        const set=(i,v)=>dv.setUint32(desc+i*4,v,true);
        [rt,width,height,bpp,pitch,dib,1].forEach((v,i)=>set(i,v));
        set(17,8);set(19,0);set(20,5);set(21,6);set(27,1);set(28,2);
        [width,height,bpp,pitch].forEach((v,i)=>dv.setUint16(rt+12+i*2,v,true));
        dv.setUint32(rt+20,dib,true);
        const putPixel=(base,x,y,r,g,b)=>{
          const p=base+y*pitch+x*(bpp/8);
          if(bpp===32)u8.set([b,g,r,255],p);
          else dv.setUint16(p,((r>>3)<<11)|((g>>2)<<5)|(b>>3),true);
        };
        for(const base of [dib1,dib2]) {
          u8.fill(0xa5,base,base+height*pitch);
          for(let y=0;y<height;y++)for(let x=0;x<width;x++)
            putPixel(base,x,y,...(base===dib1?[16,32,64]:[0,0,255]));
        }
        const errors=[],writes=[];
        const gpu=new D3DIMGpu.D3DIMGpu({boundedReadback,getMemory:()=>memory,
          getExports:()=>({d3dim_gpu_describe:()=>desc,guest_to_wasm:x=>x,
            d3dim_gpu_surface_fmt:()=>1,page_watch_write:(a,n)=>writes.push([a,n])}),
          createCanvas:(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},
          onError:e=>errors.push(e)});
        const ok=v=>{if(v!==1)throw Error('GPU rejected: '+errors.join(';'));};
        function draw(color,points,primitive=4,rhw=1) {
          [1,primitive,3,vertices,points.length].forEach((v,i)=>dv.setUint32(command+i*4,v,true));
          points.forEach(([x,y],i)=>{
            const p=vertices+i*32;
            [x,y,.5,rhw].forEach((v,j)=>dv.setFloat32(p+j*4,v,true));
            dv.setUint32(p+16,color,true);dv.setUint32(p+20,0,true);
            dv.setFloat32(p+24,0,true);dv.setFloat32(p+28,0,true);
          });
          ok(gpu.call(D3DIMGpu.OPCODES.DRAW,command));
        }
        const snapshots=[];
        function snap(label) {
          ok(gpu.fence());
          snapshots.push({label,dib,bytes:Array.from(u8.slice(dib,dib+height*pitch))});
        }
        function clearRect(flags,color,x,y,w,h) {
          [rt,flags,color].forEach((v,i)=>dv.setUint32(clear+i*4,v,true));
          dv.setFloat32(clear+12,1,true);
          [x,y,w,h].forEach((v,i)=>dv.setInt32(clear+16+i*4,v,true));
          ok(gpu.call(D3DIMGpu.OPCODES.CLEAR,clear));
        }
        draw(0xffff0000,[[2,2],[9,2],[2,9]]);snap('small triangle');
        const small=gpu.snapshot();
        // Adjacent accepted chunks share state but have disjoint bounds.
        set(19,1);
        draw(0x8000ff00,[[2,2],[9,2],[2,9]]);
        draw(0x8000ff00,[[15,2],[22,2],[15,9]]);
        draw(0x800000ff,[[3,3],[8,3],[3,8]]);
        snap('disjoint and overlapping alpha');
        clearRect(1,0xffffff00,20,20,4,3);snap('partial clear');
        const beforeDepth=gpu.snapshot();
        clearRect(2,0,0,0,width,height);snap('depth-only clear');
        const afterDepth=gpu.snapshot();
        // A clean-target CPU barrier must still arm _prepare's write check.
        putPixel(dib,28,28,255,0,255);
        set(19,0);draw(0xffff0000,[[2,12],[8,12],[2,18]]);snap('CPU outside GPU bounds');
        set(19,1);draw(0x8000ff00,[[26,26],[31,26],[26,31]]);snap('GPU blends CPU change');
        // Once a full color clear saturates the dirty union, accepted draws
        // must skip their bounds calculation and keep conservative coverage.
        clearRect(1,0xff000000,0,0,width,height);
        const saturatedBounds=[],submit=gpu._submit;
        gpu._submit=function(target,draw,...args){
          saturatedBounds.push(draw.colorBounds);
          return submit.call(this,target,draw,...args);
        };
        set(19,0);
        draw(0xffffff00,[[2,2],[9,2],[2,9]]);
        draw(0xffffff00,[[15,2],[22,2],[15,9]]);
        gpu._submit=submit;
        snap('saturated full target');
        // Integer/subpixel edges and native line endpoints cannot escape bbox.
        set(19,0);draw(0xffffffff,[[0,31],[31,31],[31,0]],3);
        draw(0xff00ffff,[[-.5,-.5],[5.5,-.5],[-.5,5.5]]);snap('target edges and lines');
        const firstBeforeSwap=Array.from(u8.slice(dib1,dib1+height*pitch));
        dib=dib2;set(5,dib);dv.setUint32(rt+20,dib,true);
        draw(0xffff0000,[[2,2],[9,2],[2,9]]);snap('new backing');
        const firstAfterSwap=Array.from(u8.slice(dib1,dib1+height*pitch));
        dib=dib1;set(5,dib);dv.setUint32(rt+20,dib,true);
        draw(0xff00ff00,[[12,12],[18,12],[12,18]]);snap('restored backing');
        const beforeUncertain=gpu.snapshot();
        draw(0xffff0000,[[4,4],[6,4],[4,6]],4,-1);snap('uncertain homogeneous bound');
        const afterUncertain=gpu.snapshot();
        const stats=gpu.snapshot();gpu.stop();
        return {boundedReadback,bpp,pitch,snapshots,small,beforeDepth,afterDepth,
          beforeUncertain,afterUncertain,firstBeforeSwap,firstAfterSwap,saturatedBounds,stats,errors,writes};
      }
      return [16,32].map(bpp=>[run(false,bpp),run(true,bpp)]);
    });
    for(const [full,bounded] of results) {
      assert.deepStrictEqual(full.errors,[]);assert.deepStrictEqual(bounded.errors,[]);
      assert.deepStrictEqual(bounded.snapshots,full.snapshots,`${bounded.bpp}-bit complete DIB parity at every fence`);
      assert.deepStrictEqual(bounded.firstAfterSwap,bounded.firstBeforeSwap,'backing swap cannot write old DIB');
      assert.deepStrictEqual(bounded.saturatedBounds,[null,null],'full dirty target skips per-draw bounds');
      assert.deepStrictEqual(full.saturatedBounds,[null,null],'full-readback control skips per-draw bounds');
      assert.strictEqual(bounded.afterDepth.syncs,bounded.beforeDepth.syncs,'depth-only clear needs no color readback');
      assert(bounded.small.syncPixels<32*32,'small geometry reads a strict subrectangle');
      assert.strictEqual(full.small.syncPixels,32*32,'control materializes full target');
      assert(bounded.stats.syncPixels<full.stats.syncPixels,'fewer GPU read pixels');
      assert.strictEqual(bounded.stats.syncBytes,bounded.stats.syncPixels*4,'stats count RGBA bytes read from GPU');
      assert.strictEqual(bounded.stats.fullReadPixelsEquivalent,bounded.stats.syncs*32*32);
      assert.strictEqual(bounded.afterUncertain.syncPixels-bounded.beforeUncertain.syncPixels,32*32,'negative W uses conservative full target');
      const frame=name=>bounded.snapshots.find(s=>s.label===name).bytes;
      const pixel=(name,x,y)=>{
        const data=frame(name),p=y*bounded.pitch+x*(bounded.bpp/8);
        if(bounded.bpp===32)return [data[p+2],data[p+1],data[p]];
        const v=data[p]|(data[p+1]<<8),r=v>>11,g=(v>>5)&63,b=v&31;
        return [(r<<3)|(r>>2),(g<<2)|(g>>4),(b<<3)|(b>>2)];
      };
      assert.deepStrictEqual(pixel('small triangle',3,3),[255,0,0]);
      assert.deepStrictEqual(pixel('partial clear',21,21),[255,255,0]);
      assert.deepStrictEqual(pixel('CPU outside GPU bounds',28,28),[255,0,255]);
      const blended=pixel('GPU blends CPU change',28,28);
      assert(blended.every((v,i)=>Math.abs(v-[127,128,127][i])<=8),'GPU actually samples uploaded CPU change');
      assert.deepStrictEqual(pixel('saturated full target',3,3),[255,255,0]);
      assert.deepStrictEqual(pixel('new backing',28,28),[0,0,255]);
      for(const snap of bounded.snapshots)for(let y=0;y<32;y++)
        assert(snap.bytes.slice(y*bounded.pitch+32*(bounded.bpp/8),(y+1)*bounded.pitch).every(v=>v===0xa5),'pitch padding remains untouched');
    }
    console.log('PASS D3DIM bounded readback: exact padded DIB A/B, alpha/edges/lines, clears, CPU writes, backing swaps and byte accounting');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
