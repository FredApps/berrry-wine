#!/usr/bin/env node
'use strict';
// Diagnostic launch of the genuine extracted demo, with no EXE/capability
// patching. Assets stay outside the repository; no production app registration.
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os');
const puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..');
const game=path.resolve(process.env.BW2_ROOT||'/private/tmp/black-white-full.ntZDCF/extracted/MainApp');
const seconds=Number(process.env.BW2_SECONDS||300);
// Optional, explicit browser input in seconds after launch: [{at:60,key:'Escape'}]
// or [{at:60,x:400,y:400}]. No guest-memory writes or game-state bypasses.
const inputs=JSON.parse(process.env.BW2_INPUTS||'[]');
if(!Array.isArray(inputs)||inputs.some(a=>!Number.isFinite(a.at)||a.at<0||
  !(typeof a.key==='string'||(Number.isFinite(a.x)&&Number.isFinite(a.y)))))
  throw new Error('Invalid BW2_INPUTS');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'black-white-browser-'));
const files=[];
function walk(dir,prefix='') {
  for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
    const rel=prefix+item.name;
    if(item.isDirectory())walk(path.join(dir,item.name),rel+'/');
    else if(item.isFile())files.push(rel);
  }
}
walk(game);
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const base=name.startsWith('/game/')?game:root;
  const relative=name.startsWith('/game/')?name.slice(6):name==='/'?'index.html':name.slice(1);
  const file=path.resolve(base,relative);
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Cache-Control','no-store');
  if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){res.writeHead(404);res.end();return;}
    const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json',
      '.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.setHeader('Content-Length',stat.size);
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await puppeteer.launch({headless:process.env.BW2_HEADFUL!=='1',
      executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args:['--no-first-run','--no-default-browser-check'],protocolTimeout:120000});
    const page=await browser.newPage();await page.setViewport({width:1100,height:800});
    page.on('console',message=>console.log('[browser]',message.text()));
    page.on('pageerror',error=>console.error('[pageerror]',error.message));
    const query=process.env.BW2_PROGRAMMABLE==='1'?'&d3d9-programmable':'';
    console.log('Artifacts:',output,'assets:',files.length);
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug&perf${query}`,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.wineApps?.APPS && window.wineShell?.launchApp,{timeout:120000});
    await page.evaluate(({files,drawSnapshots,introTrace})=>{
      window.__bw2IntroTrace=!!introTrace;
      if(drawSnapshots){
        const draw=D3D9Backend.Device.prototype.draw;let count=0;const categories=new Map();
        D3D9Backend.Device.prototype.draw=function(snapshot){
          const category=snapshot.primitive+':'+!!snapshot.indices;
          const seen=categories.get(category)||0;
          if(snapshot.fixedFunction)categories.set(category,seen+1);
          const capture=!!snapshot.fixedFunction && seen<8;count++;
          if(capture)console.log('[BW2 draw snapshot]',JSON.stringify({
            count,primitive:snapshot.primitive,primitiveCount:snapshot.primitiveCount,stride:snapshot.stride,
            attributes:snapshot.attributes,state:snapshot.state,viewport:snapshot.viewport,
            fixed:snapshot.fixedFunction,
            vertices:Array.from(new Float32Array(snapshot.vertices.buffer,snapshot.vertices.byteOffset,
              Math.min(40,Math.floor(snapshot.vertices.byteLength/4)))),
            bytes:Array.from(snapshot.vertices.slice(0,snapshot.stride*3)),
            indices:snapshot.indices?Array.from(snapshot.indices.slice(0,12)):null,
            textures:snapshot.textures.map(t=>t?{width:t.width,height:t.height,levels:t.levels?.length||1,
              sampler:t.sampler,nonzero:t.pixels.some(v=>v),first:Array.from(t.pixels.slice(0,16))}:null)
          }));
          const result=draw.call(this,snapshot);
          if(capture){
            const gl=this.gpu.gl,pixels=this.gpu.readPixels(0,0,this.gpu.canvas.width,this.gpu.canvas.height,
              gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(this.gpu.canvas.width*this.gpu.canvas.height*4));
            let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2])colored++;
            console.log('[BW2 draw pixels]',JSON.stringify({count,colored,error:this.gpu.getError()}));
          }
          return result;
        };
      }
      const traceNames=new Set(['ReadFileEx','OutputDebugStringA','SleepEx','ExitProcess','ExitThread',
        'PostQuitMessage','DestroyWindow','LoadLibraryA','LoadLibraryW','GetProcAddress','CreateFileA',
        'IDirect3DDevice9_CreateTexture','IDirect3DDevice9_CreateCubeTexture',
        'IDirect3DDevice9_CreateQuery','IDirect3DQuery9_Issue','IDirect3DQuery9_GetData',
        'IDirect3DDevice9_CreateVertexShader','IDirect3DDevice9_CreatePixelShader',
        'IDirect3DDevice9_SetVertexShader','IDirect3DDevice9_SetPixelShader',
        'IDirect3DDevice9_DrawPrimitiveUP','IDirect3DDevice9_DrawIndexedPrimitiveUP',
        'IDirect3DDevice9_DrawPrimitive','IDirect3DDevice9_DrawIndexedPrimitive','IDirect3DDevice9_Present']);
      let sleeps=0;
      const drawCounts=new Map();
      traceNames.has=name=>{
        if(!Set.prototype.has.call(traceNames,name))return false;
        if(name==='SleepEx')return sleeps++<5;
        if(/_Draw|_Present|_SetVertexShader|_SetPixelShader|IDirect3DQuery9_/.test(name)){
          const count=drawCounts.get(name)||0;drawCounts.set(name,count+1);return count<12;
        }
        return true;
      };
      window.__waTraceApiNames=traceNames;
      window.__waTraceApiDetails=true;
      const fileTrace=[];
      window.__waProfileEipHit=eip=>{
        if(eip===0x00526d93){
          const ex=window.wineShell.currentWine?.instance?.exports;if(!ex)return;
          const object=ex.get_esi()>>>0;
          const float=offset=>new Float32Array(new Uint32Array([ex.guest_read32(object+offset)]).buffer)[0];
          window.__bw2IntroState={object,frame:ex.guest_read32(object+0x20),
            target:ex.guest_read32(object),finishFrame:ex.guest_read32(object+0x24),
            completion:float(0x28),interaction:ex.guest_read32(object+0x1c)};
          return;
        }
        const ex=window.wineShell?.currentWine?.instance?.exports;if(!ex)return;
        fileTrace.push({eip:eip.toString(16),eax:(ex.get_eax()>>>0).toString(16),
          esi:(ex.get_esi()>>>0).toString(16),edi:(ex.get_edi()>>>0).toString(16)});
        if(fileTrace.length>32)fileTrace.shift();
      };
      // Capture before shell teardown: a null indirect call otherwise looks
      // like a normal exit and the next snapshot belongs to the idle shell.
      const stop=WineAssembly.prototype.stop;
      WineAssembly.prototype.stop=function(...args){
        const ex=this.instance?.exports;
        if(ex){
          const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');
          const esp=ex.get_esp()>>>0;
          const maps=new Uint32Array(this.memory.buffer,RegionMap.BASE.VIRTUAL_MAP_STATE,2);
          const records=new Uint32Array(this.memory.buffer,RegionMap.BASE.VIRTUAL_MAP_TABLE,maps[0]*4);
          let liveBytes=0;for(let i=0;i<maps[0];i++)liveBytes+=records[i*4+1];
          console.log('[BW2 stop]',JSON.stringify({
            registers:Object.fromEntries(['eip','esp','ebp','eax','ebx','ecx','edx','esi','edi'].map(r=>[r,hex(ex['get_'+r]?.())])),
            stack:Array.from({length:24},(_,i)=>hex(ex.guest_read32(esp+i*4))),
            yield:ex.get_yield_reason?.(),fileTrace,mappings:{count:maps[0],liveBytes,hasMapFree:!!ex.guest_map_free,backingTop:hex(maps[1]),
              backingEnd:hex(RegionMap.REGIONS.VIRTUAL_BACKING_BASE.end)}
          }));
        }
        return stop.apply(this,args);
      };
      const url=rel=>'/game/'+rel.split('/').map(encodeURIComponent).join('/');
      window.wineApps.APPS.black_white_2_probe={exe:url('BW2Demo.exe'),
        dlls:['d3dx9_25.dll','binkw32.dll','dbghelp.dll'].map(url),
        files:files.filter(rel=>rel!=='BW2Demo.exe').map(rel=>({url:url(rel),vfsPath:'c:\\'+rel.replace(/\//g,'\\')})),
        requiredFiles:true};
      window.wineShell.launchApp('black_white_2_probe');
    },{files,drawSnapshots:process.env.BW2_DRAW_SNAPSHOTS==='1',introTrace:process.env.BW2_INTRO_TRACE==='1'});
    const start=Date.now();let tick=0;const sentInputs=new Set();
    while(Date.now()-start<seconds*1000) {
      await new Promise(resolve=>setTimeout(resolve,10000));
      for(const [i,input] of inputs.entries())if(!sentInputs.has(i)&&Date.now()-start>=input.at*1000){
        sentInputs.add(i);
        if(input.key){
          await page.keyboard.down(input.key);
          await new Promise(resolve=>setTimeout(resolve,250));
          await page.keyboard.up(input.key);
        }
        else await page.mouse.click(input.x,input.y);
        console.log('[input]',JSON.stringify(input));
      }
      const state=await page.evaluate(()=>{
        const shell=window.wineShell,wine=shell.currentWine;
        const ex=wine?.instance?.exports;
        const colors=canvas=>{
          if(!canvas)return null;
          const ctx=canvas.getContext('2d');if(!ctx)return null;
          const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2])colored++;
          return colored;
        };
        if(ex?.set_count && !wine._bw2Counters) {
          ex.set_count(0,0x00b53100);ex.set_count(1,0x00938961);wine._bw2Counters=true;
          if(window.__bw2IntroTrace){
            ex.set_trace_eip_range(1,0x00526d93,0x00526d97);
            ex.set_count(2,0x00526185);ex.set_count(3,0x0052619d);
          }
          else ex.set_trace_eip_range(1,0x00924fc0,0x009250c0);
        }
        return{status:document.getElementById('status')?.textContent,intro:window.__bw2IntroState,
          introTiming:window.__bw2IntroTrace&&ex?{
            deltaMs:ex.guest_read32(0x0177cb18),
            catchupUpdates:ex.get_count(2),renderIterations:ex.get_count(3)}:undefined,
          stack:window.__bw2IntroTrace&&ex?Array.from({length:64},(_,i)=>
            '0x'+(ex.guest_read32((ex.get_esp()>>>0)+i*4)>>>0).toString(16).padStart(8,'0')):undefined,
          eip:ex?.get_eip?.()>>>0,esi:ex?.get_esi?.()>>>0,
          ioCallbackHits:ex?.get_count?.(0),alertableCallHits:ex?.get_count?.(1),
          ioOverlapped:ex?Array.from({length:5},(_,i)=>ex.guest_read32(0x4fda0300+i*4)>>>0):[],
          windows:Object.values(shell.renderer?.windows||{}).filter(w=>w.visible).map(w=>({
            title:w.title,w:w.w,h:w.h,frame:w._gpuFrameLayer?.writeSeq,
            gpuColored:colors(w._gpuFrameLayer?.canvas),hasBacking:!!w._backCanvas,
            sameLayer:w._dxFrameLayer===w._gpuFrameLayer})),
          log:document.getElementById('log')?.textContent?.slice(-6000),running:!!wine?.running};
      });
      console.log('[state]',JSON.stringify(state));
      if(++tick%3===0)await page.screenshot({path:path.join(output,`frame-${tick}.png`)});
      if(state.windows.some(w=>/Fatal Error/i.test(w.title)) || /UNIMPLEMENTED API|FATAL:|ERROR:/.test(state.log||''))break;
    }
    await page.screenshot({path:path.join(output,'final.png')});
    console.log('Probe finished; screenshots are observations, not a gameplay pass.');
  } finally {
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
