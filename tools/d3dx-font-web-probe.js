#!/usr/bin/env node
'use strict';
// Run the native-D3DX fixture through the browser's actual guest/COM/WebGL path.
// Build the EXE with d3dx-font-probe.js; supply a matching canonical WASM build.
const fs=require('fs'),path=require('path'),os=require('os');
const puppeteer=require('puppeteer');
const {PNG}=require('pngjs');
const {startStaticServer,closeServer}=require('../test/static-server');
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
(async()=>{
  const exe=arg('exe'),dll=arg('dll'),wasm=arg('wasm');
  if(!exe||!dll||!wasm)throw Error('usage: node tools/d3dx-font-web-probe.js --exe=/path/probe.exe --dll=/path/d3dx9_25.dll --wasm=/path/current.wasm');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'d3dx-font-web-'));
  const assets=new Map([
    ['/native-font/probe.exe',fs.readFileSync(exe)],
    ['/native-font/d3dx9_25.dll',fs.readFileSync(dll)],
    ['/build/wine-assembly.wasm',fs.readFileSync(wasm)],
  ]);
  const server=await startStaticServer({root:path.resolve(__dirname,'..'),crossOriginIsolated:true,
    cacheControl:'no-cache',handleRequest(req,res){
      const pathname=new URL(req.url,'http://localhost').pathname,bytes=assets.get(pathname);
      if(!bytes)return false;
      res.writeHead(200,{'Content-Type':pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'});
      res.end(bytes);return true;
    }});
  let browser;const logs=[];
  try{
    browser=await puppeteer.launch({headless:true,
      executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args:['--no-first-run','--no-default-browser-check']});
    const page=await browser.newPage();
    page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push('PAGEERROR '+String(e)));
    page.on('dialog',dialog=>dialog.dismiss());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug&d3d9-renderer=webgl&d3d9-programmable`,
      {waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction('typeof launchApp === "function" && typeof D3D9Backend !== "undefined"');
    await page.evaluate(async()=>{
      // Observe final target pixels before normal ExitProcess tears it down.
      // Do not modify guest output, timing, shader state, or HRESULTs.
      const present=D3D9Backend.Device.prototype.present;
      D3D9Backend.Device.prototype.present=function(...args){
        const g=this.gpu,gl=g.gl,w=g.canvas.width,h=g.canvas.height;
        if(w===320&&h===160){
          const pixels=g.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(w*h*4));
          window.fontProbeFrame={width:w,height:h,version:g.version,pixels:Array.from(pixels),error:g.getError()};
        }
        return present.apply(this,args);
      };
      window.wineApps.APPS.native_font_probe={exe:'native-font/probe.exe',
        title:'Native D3DX font probe',dlls:['native-font/d3dx9_25.dll']};
      await setThreads(false);
      const select=document.getElementById('app-select');
      select.add(new Option('Native D3DX font probe','native_font_probe'));
      select.value='native_font_probe';
      launchApp();
    });
    await page.waitForFunction(()=>window.fontProbeFrame,{timeout:120000});
    const frame=await page.evaluate(()=>window.fontProbeFrame);
    const png=new PNG({width:frame.width,height:frame.height}),pixels=Buffer.from(frame.pixels);
    for(let y=0;y<frame.height;y++)pixels.copy(png.data,y*frame.width*4,
      (frame.height-y-1)*frame.width*4,(frame.height-y)*frame.width*4);
    fs.writeFileSync(path.join(directory,'frame.png'),PNG.sync.write(png));
    let white=0,blue=0;
    for(let i=0;i<png.data.length;i+=4){const r=png.data[i],g=png.data[i+1],b=png.data[i+2];
      if(r>220&&g>220&&b>220)white++;if(r===32&&g===64&&b===128)blue++;}
    console.log(JSON.stringify({directory,width:frame.width,height:frame.height,webgl:frame.version,white,blue,error:frame.error}));
    if(frame.error||white<20||blue<40000)throw Error('native D3DX WebGL text-pixel acceptance failed');
    console.log('PASS native D3DX font -> browser guest GDI -> WebGL text pixels');
  }finally{
    fs.writeFileSync(path.join(directory,'browser.log'),logs.join('\n'));
    console.log('Artifacts: '+directory);
    if(browser)await browser.close();await closeServer(server);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
