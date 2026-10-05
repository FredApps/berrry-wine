#!/usr/bin/env node
'use strict';
const assert=require('assert');
const path=require('path');
const puppeteer=require('puppeteer');
const {startStaticServer,closeServer}=require('./static-server');
const {compileSrcWasm}=require('./compile-src');
const root=path.join(__dirname,'..');
// Reuse the actual-x86 production-route fixture for accelerated parity too.
const backend=process.argv.includes('--webgl')?'webgl':'software';
(async()=>{
  const wasm=compileSrcWasm();
  console.log(`Browser render worker: compiled ${wasm.length} canonical WASM bytes`);
  const server=await startStaticServer({root,crossOriginIsolated:true,cacheControl:'no-cache',
    handleRequest(request,response){
      if(!request.url.startsWith('/build/wine-assembly.wasm'))return false;
      response.writeHead(200,{'Content-Type':'application/wasm','Content-Length':wasm.length,
        'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
      response.end(wasm);return true;
    }});
  const browser=await puppeteer.launch({headless:true,
    executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--no-first-run','--no-default-browser-check']});
  try {
    for(const threaded of [false,true]){
      const page=await browser.newPage();const errors=[],consoleErrors=[];
      page.on('pageerror',error=>errors.push(String(error)));
      page.on('console',message=>{if(message.type()==='error'||/crash|trap|fatal|exception/i.test(message.text()))consoleErrors.push(message.text());});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug&frozen&d3d9-renderer=${backend}`,
        {waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction('typeof launchApp === "function"');
      console.log(`Browser render worker: launching ${threaded?'guest-worker':'cooperative'} calc`);
      await page.evaluate(async threaded=>{
        // Exercise the per-app profile used by local Black & White launches,
        // without loading its large assets for this focused COM regression.
        window.wineApps.APPS.calc.d3d9Programmable=true;
        await setThreads(threaded);document.getElementById('app-select').value='calc';launchApp();
      },threaded);
      await page.waitForFunction(()=>typeof runningApps!=='undefined' && runningApps[0]?.wine?.running && runningApps[0].wine._frozenStep,
        {timeout:120000}).catch(error=>{throw new Error(`${error.message}; browser: ${errors.concat(consoleErrors).join('\n')}`);});
      console.log('Browser render worker: guest frozen and ready');
      await page.evaluate(()=>{
        const wine=runningApps[0].wine,e=wine.instance.exports,ctx=wine.hostCtx,memory=wine.memory;
        const alloc=n=>e.guest_alloc(n)>>>0;
        const p=wine.d3dProbe={pp:alloc(64),out:alloc(4),vertices:alloc(48),marker:alloc(4),stack:alloc(4096),windowClass:alloc(8)};
        new Uint8Array(memory.buffer,e.guest_to_wasm(p.windowClass),8).set([83,84,65,84,73,67,0,0]);
        new Uint8Array(memory.buffer,e.guest_to_wasm(p.pp),64).fill(0);
        [8,8,21,1,0,0,1,1].forEach((v,i)=>e.guest_write32(p.pp+i*4,v));
        e.guest_write32(p.pp+44,1); // D3DPRESENTFLAG_LOCKABLE_BACKBUFFER
        const view=new DataView(memory.buffer),wa=e.guest_to_wasm(p.vertices);
        [[-1,1,.5],[1,1,.5],[-1,-1,.5]].forEach((v,i)=>{
          v.forEach((n,j)=>view.setFloat32(wa+i*16+j*4,n,true));view.setUint32(wa+i*16+12,0xffff0000,true);
        });
        const bridge=ctx.d3d9Bridge,call=bridge.call;p.calls=[];
        bridge.call=function(op,a,x){if(op===0x30002)p.target=view.getUint32(a+8,true);
          const result=call.call(this,op,a,x);p.calls.push([op,result]);return result;};
        p.call=async(name,args)=>{
          const id=ctx.apiTable.find(a=>a.name===name).id,base=e.get_thunk_base()>>>0;
          let thunk=0;for(let i=0;i<e.get_num_thunks();i++){
            const marker=e.guest_read32(base+i*8)>>>0;
            if((marker===0xcaca0010||marker>>>16!==0xcaca) && e.guest_read32(base+i*8+4)===id){thunk=base+i*8;break;}
          }
          if(!thunk)throw Error('missing '+name);
          const dw=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255],code=alloc(256);
          new Uint8Array(memory.buffer).set([...args.slice().reverse().flatMap(n=>[0x68,...dw(n)]),
            0xb8,...dw(thunk),0xff,0xd0,0xa3,...dw(p.marker),0xeb,0xfe],e.guest_to_wasm(code));
          e.guest_write32(p.marker,0xdeadbeef);
          const set=async(name,...args)=>wine.guestWorker?wine.guestWorker.callExport(name,...args):e[name](...args);
          await set('set_esp',p.stack+4000);await set('clear_yield');await set('set_eip',code);
        };
      });
      const call=async(name,args,handle=false)=>{
        await page.evaluate(({name,args})=>{const p=runningApps[0].wine.d3dProbe;
          return p.call(name,args.map(n=>typeof n==='string'?p[n]:n));},{name,args});
        const deadline=Date.now()+60000;
        while(Date.now()<deadline){
          await page.evaluate(()=>runningApps[0].wine.stepFrozen(4));
          const result=await page.evaluate(()=>{const w=runningApps[0]?.wine;return w?w.instance.exports.guest_read32(w.d3dProbe.marker)>>>0:null;});
          if(result===null)throw Error(`${name}: guest exited; ${errors.concat(consoleErrors).join('\n')}`);
          if(result!==0xdeadbeef){
            const reason=await page.evaluate(()=>{const w=runningApps[0].wine,b=w.hostCtx.d3d9Bridge;return JSON.stringify({
              error:String(b.lastError),backend:b.backend,async:b.asyncSoftware,enabled:b.options.enableProgrammable,calls:w.d3dProbe.calls});});
            const diagnostic=`${threaded?'Worker':'cooperative'} ${name}: ${reason}; ${errors.concat(consoleErrors)}`;
            if(handle)assert.notStrictEqual(result,0,diagnostic);else assert.strictEqual(result,0,diagnostic);return result;
          }
        }
        throw Error(`${name} never resumed: ${errors}`);
      };
      const hwnd=await call('CreateWindowExA',[0,'windowClass',0,0x10000000,0,0,8,8,0,0,0,0],true);
      await page.evaluate(hwnd=>{const w=runningApps[0].wine,p=w.d3dProbe;p.hwnd=hwnd;w.instance.exports.guest_write32(p.pp+28,hwnd);},hwnd);
      await call('IDirect3D9_CreateDevice',[0,0,1,'hwnd',0,'pp','out']);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.device=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      await call('IDirect3DDevice9_SetFVF',['device',0x42]);
      await call('IDirect3DDevice9_SetRenderState',['device',137,0]);
      await call('IDirect3DDevice9_SetRenderState',['device',22,1]);
      await call('IDirect3DDevice9_DrawPrimitiveUP',['device',4,1,'vertices',16]);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      const result=await page.evaluate(()=>{
        const w=runningApps[0].wine,b=w.hostCtx.d3d9Bridge,q=b.devices.get(w.d3dProbe.device).queue;
        return {pixel:new Uint32Array(w.memory.buffer,w.d3dProbe.target,64)[9],worker:!!b.workerConsumer?.initialized,backend:b.backend,
          guestWorker:!!w.guestWorker,pending:b.requests.size,submitted:q.submitted,completed:q.completed};
      });
      const submitted=backend==='software'?4:3;
      assert.deepStrictEqual(result,{pixel:0xffff0000,worker:backend==='software',backend,guestWorker:threaded,pending:0,submitted,completed:submitted});
      await call('IDirect3DDevice9_Clear',['device',0,0,1,0xff0000ff,0,0]);
      await page.evaluate(()=>{const w=runningApps[0].wine,p=w.d3dProbe;
        [2,0,4,2].forEach((v,i)=>w.instance.exports.guest_write32(p.pp+i*4,v));});
      await call('IDirect3DDevice9_SetScissorRect',['device','pp']);
      await call('IDirect3DDevice9_SetRenderState',['device',174,1]);
      await page.evaluate(()=>{const w=runningApps[0].wine,p=w.d3dProbe;
        for(let i=0;i<4;i++)w.instance.exports.guest_write32(p.pp+i*4,0x77777777);});
      await call('IDirect3DDevice9_DrawPrimitiveUP',['device',4,1,'vertices',16]);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      const scissorPixels=()=>page.evaluate(()=>{const w=runningApps[0].wine,
        p=new Uint32Array(w.memory.buffer,w.d3dProbe.target,64);return [p[10],p[9],p[18]];});
      assert.deepStrictEqual(await scissorPixels(),[0xffff0000,0xff0000ff,0xff0000ff]);
      await call('IDirect3DDevice9_Clear',['device',0,0,1,0xff00ff00,0,0]);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      assert.deepStrictEqual(await scissorPixels(),[0xff00ff00,0xff0000ff,0xff0000ff]);
      await call('IDirect3DDevice9_CreateRenderTarget',['device',4,3,21,0,0,1,'out',0]);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.color=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      await call('IDirect3DDevice9_SetRenderTarget',['device',0,'color']);
      await call('IDirect3DDevice9_SetRenderState',['device',174,0]);
      await call('IDirect3DDevice9_Clear',['device',0,0,1,0xff223344,0,0]);
      await call('IDirect3DDevice9_DrawPrimitiveUP',['device',4,1,'vertices',16]);
      await call('IDirect3DSurface9_LockRect',['color','pp',0,16]);
      const colorPixels=await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports,p=w.d3dProbe;
        const pitch=e.guest_read32(p.pp),bits=e.guest_read32(p.pp+4)>>>0;
        return {pitch,pixels:Array.from({length:12},(_,i)=>e.guest_read32(bits+i*4)>>>0)};});
      // Resource identity uses an interior sample. The clip-space triangle's
      // exact horizontal top edge differs between current GL/software coverage;
      // that remains a separate raster-conformance gap, not texture aliasing.
      assert.deepStrictEqual({pitch:colorPixels.pitch,first:colorPixels.pixels[4],last:colorPixels.pixels[11]},
        {pitch:16,first:0xffff0000,last:0xff223344},JSON.stringify(colorPixels));
      await call('IDirect3DSurface9_UnlockRect',['color']);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      assert.deepStrictEqual(await scissorPixels(),[0xff00ff00,0xff0000ff,0xff0000ff],
        'Present uses implicit backbuffer while independent color target remains bound');
      await call('IDirect3DDevice9_CreateTexture',['device',4,4,1,1,21,0,'out',0]);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.texture=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      await call('IDirect3DTexture9_GetSurfaceLevel',['texture',0,'out']);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.textureSurface=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      await call('IDirect3DDevice9_SetRenderTarget',['device',0,'textureSurface']);
      await call('IDirect3DDevice9_ColorFill',['device','textureSurface',0,0xff2468ac]);
      await call('IDirect3DDevice9_CreateOffscreenPlainSurface',['device',4,4,21,2,'out',0]);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.upload=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      await call('IDirect3DSurface9_LockRect',['upload','pp',0,0]);
      await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports,p=w.d3dProbe,bits=e.guest_read32(p.pp+4)>>>0;
        for(let i=0;i<16;i++)e.guest_write32(bits+i*4,0xff13579b);});
      await call('IDirect3DSurface9_UnlockRect',['upload']);
      await call('IDirect3DDevice9_UpdateSurface',['device','upload',0,'textureSurface',0]);
      await call('IDirect3DSurface9_Release',['upload']);
      await call('IDirect3DDevice9_SetRenderTarget',['device',0,'color']);
      await call('IDirect3DDevice9_SetTexture',['device',0,'texture']);
      await call('IDirect3DDevice9_SetFVF',['device',0x144]);
      await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports,p=w.d3dProbe;
        p.textured=e.guest_alloc(96)>>>0;const data=new DataView(w.memory.buffer,e.guest_to_wasm(p.textured),96);
        [[0,0],[4,0],[0,3]].forEach(([x,y],i)=>{const at=i*32;
          data.setFloat32(at,x,true);data.setFloat32(at+4,y,true);data.setFloat32(at+8,.5,true);
          data.setFloat32(at+12,1,true);data.setUint32(at+16,0xffffffff,true);
          data.setFloat32(at+20,.25,true);data.setFloat32(at+24,.25,true);
        });});
      await call('IDirect3DDevice9_DrawPrimitiveUP',['device',4,1,'textured',32]);
      await call('IDirect3DSurface9_LockRect',['color','pp',0,16]);
      assert.strictEqual(await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports;
        return e.guest_read32((e.guest_read32(w.d3dProbe.pp+4)>>>0)+20)>>>0;}),0xff13579b,'UpdateSurface texture is sampled through production queue');
      await call('IDirect3DSurface9_UnlockRect',['color']);
      await call('IDirect3DDevice9_SetTexture',['device',0,0]);
      await call('IDirect3DDevice9_GetBackBuffer',['device',0,0,0,'out']);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.backSurface=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      await call('IDirect3DDevice9_AddRef',['device'],true);
      const deviceRefsBeforeGetDevice=await call('IDirect3DDevice9_Release',['device'],true);
      await call('IDirect3DSurface9_GetDevice',['backSurface','out']);
      assert(await page.evaluate(()=>{const w=runningApps[0].wine;return (w.instance.exports.guest_read32(w.d3dProbe.out)>>>0)===w.d3dProbe.device;}),
        'backbuffer GetDevice returns its owning device');
      assert.strictEqual(await call('IDirect3DDevice9_Release',['device'],true),deviceRefsBeforeGetDevice,'release GetDevice reference');
      await call('IDirect3DDevice9_CreateOffscreenPlainSurface',['device',1,1,22,2,'out',0]);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.upload=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      await call('IDirect3DSurface9_LockRect',['upload','pp',0,0]);
      await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports;e.guest_write32(e.guest_read32(w.d3dProbe.pp+4),0x12556677);});
      await call('IDirect3DSurface9_UnlockRect',['upload']);
      await call('IDirect3DDevice9_UpdateSurface',['device','upload',0,'backSurface',0]);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      assert.strictEqual(await page.evaluate(()=>{const w=runningApps[0].wine;return new Uint32Array(w.memory.buffer,w.d3dProbe.target,64)[0];}),0xff556677,
        'UpdateSurface implicit upload presents while explicit target bound');
      await call('IDirect3DDevice9_ColorFill',['device','backSurface',0,0xffa0b0c0]);
      await call('IDirect3DSurface9_GetDC',['backSurface','out']);
      await page.evaluate(()=>{const w=runningApps[0].wine;w.d3dProbe.dc=w.instance.exports.guest_read32(w.d3dProbe.out)>>>0;});
      for(const name of['GetPixel','SetPixel']){
        const pointer=await page.evaluate(name=>{const w=runningApps[0].wine,e=w.instance.exports,p=e.guest_alloc(name.length+1)>>>0;
          new Uint8Array(w.memory.buffer,e.guest_to_wasm(p),name.length+1).set([...name].map(c=>c.charCodeAt(0)).concat(0));return p;},name);
        await call('GetProcAddress',[0,pointer],true);
      }
      assert.strictEqual(await call('GetPixel',['dc',0,0],true),0xc0b0a0,'GDI acquire fences rendering before Present');
      assert.strictEqual(await call('SetPixel',['dc',0,0,0x112233],true),0x112233);
      await call('IDirect3DSurface9_ReleaseDC',['backSurface','dc']);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      assert.strictEqual(await page.evaluate(()=>{const w=runningApps[0].wine;return new Uint32Array(w.memory.buffer,w.d3dProbe.target,64)[0];}),0xff332211,
        'GDI release uploads pixels before Present');
      await call('IDirect3DSurface9_LockRect',['backSurface','pp',0,0]);
      assert.strictEqual(await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports,p=e.guest_read32(w.d3dProbe.pp+4)>>>0;
        const prior=e.guest_read32(p)>>>0;e.guest_write32(p,0xffabcdef);return prior;}),0xff332211,'implicit LockRect reads rendered bytes');
      await call('IDirect3DSurface9_UnlockRect',['backSurface']);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      assert.strictEqual(await page.evaluate(()=>{const w=runningApps[0].wine;return new Uint32Array(w.memory.buffer,w.d3dProbe.target,64)[0];}),0xffabcdef,
        'implicit UnlockRect uploads canonical bytes');
      await call('IDirect3DDevice9_SetRenderTarget',['device',0,'backSurface']);
      await call('IDirect3DDevice9_Clear',['device',0,0,1,0x40123456,0x3f800000,0]);
      await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports,p=w.d3dProbe;
        p.lockRect=e.guest_alloc(16)>>>0;[1,1,2,2].forEach((v,i)=>e.guest_write32(p.lockRect+i*4,v));});
      await call('IDirect3DSurface9_LockRect',['backSurface','pp','lockRect',0]);
      await page.evaluate(()=>{const w=runningApps[0].wine,e=w.instance.exports,p=w.d3dProbe;
        e.guest_write32(e.guest_read32(p.pp+4),0x11556677);[0,0,8,8].forEach((v,i)=>e.guest_write32(p.lockRect+i*4,v));});
      await call('IDirect3DSurface9_UnlockRect',['backSurface']);
      await call('IDirect3DDevice9_Present',['device',0,0,0,0]);
      assert.deepStrictEqual(await page.evaluate(()=>{const w=runningApps[0].wine,pixels=new Uint32Array(w.memory.buffer,w.d3dProbe.target,64);
        return [pixels[0],pixels[9],pixels[10]];}),[0x40123456,0xff556677,0x40123456],'rect upload preserves outside alpha and snapshots bounds');
      await call('IDirect3DSurface9_Release',['upload']);
      await call('IDirect3DSurface9_Release',['textureSurface']);
      await call('IDirect3DTexture9_Release',['texture']);
      await call('IDirect3DSurface9_Release',['color']);
      assert.strictEqual(await call('IDirect3DDevice9_Release',['device'],true),1,'backbuffer retains device');
      await call('IDirect3DSurface9_GetDevice',['backSurface','out']);
      assert.strictEqual(await call('IDirect3DDevice9_Release',['device'],true),1,'GetDevice remains usable after original release');
      await call('IDirect3DSurface9_Release',['backSurface']);
      const retired=await page.evaluate(async()=>{
        const w=runningApps[0].wine,b=w.hostCtx.d3d9Bridge;
        await w.hostCtx.closeD3DRender();const info=b.workerConsumer?.shutdownInfo||{devices:b.devices.size};w.stop();return info;
      });
      if(backend==='software'){assert.strictEqual(retired.allocatedBytes,0);assert(retired.heapAdopted>=0);}
      else assert.strictEqual(retired.devices,0);
      assert.deepStrictEqual(errors,[]);
      await page.close();
      console.log(`PASS browser ${threaded?'guest-main Worker':'cooperative main'} -> ${backend} -> scissor, independent targets, render-to-texture sampling, Lock, implicit Present and native retirement`);
    }
  } finally {await browser.close();await closeServer(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
