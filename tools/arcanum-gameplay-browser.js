#!/usr/bin/env node
'use strict';
// A bounded ordinary-input driver for the registered original demo. Commands
// are JSON files in OUT/commands/N.json; no guest state mutation is supported.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const cp=require('node:child_process'),crypto=require('node:crypto'),http=require('node:http');
const {installArcanumPresentationCounter}=require('./arcanum-presentation-counter');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]);
const backend=process.argv[3];
let activeBackend=backend;
if(!['software','webgl'].includes(backend)||fs.existsSync(out))throw Error('fresh output and explicit backend required');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(out+'/commands');
const puppeteer=require(path.join(root,'runtime/node_modules/puppeteer'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(name,v)=>fs.writeFileSync(out+'/'+name,JSON.stringify(v,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let browser,server,page,profile,poll,deadlineTimer,closing=false,counterActive=false;
const errors=[],consoleRows=[],inputs=[],requests=[],commands=[];
const start=Date.now(),deadline=start+1200000;
async function close(reason){
  if(closing)return;closing=true;clearInterval(poll);clearTimeout(deadlineTimer);
  const began=Date.now(),pid=browser?.process()?.pid;
  if(counterActive)try{save('measurement-interrupted.json',await page.evaluate(()=>globalThis.__arcanumCounter.stop()));}catch(e){errors.push(String(e));}
  let chromeTerminal=null;
  const child=browser?.process();
  const terminal=child?new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)r({code:child.exitCode,signal:child.signalCode});else child.once('exit',(code,signal)=>r({code,signal}));}):Promise.resolve(null);
  try{await browser?.close();chromeTerminal=await Promise.race([terminal,pause(10000).then(()=>null)]);}catch(e){errors.push(String(e));}
  await new Promise(r=>{if(!server)return r();server.close(r);server.closeAllConnections();});
  if(profile&&chromeTerminal)fs.rmSync(profile,{recursive:true,force:true});
  save('console.json',consoleRows);save('errors.json',errors);save('requests.json',requests);save('commands.json',commands);
  save('cleanup.json',{at:new Date().toISOString(),reason,pid:process.pid,chromePid:pid,chromeTerminal,elapsedSeconds:(Date.now()-began)/1000,browserWallSeconds:(Date.now()-start)/1000});
  console.log(JSON.stringify({closed:reason,chromeTerminal}));
}
async function state(){return page.evaluate(()=>{
  const a=(typeof runningApps!=='undefined'?runningApps:[]).find(a=>a.name==='arcanum_demo'),w=a?.wine,e=w?.instance?.exports;
  return {time:Date.now(),app:!!a,running:w?.running,guestWorker:!!w?.guestWorker,threads:w?.threadManager?.backend,
    backend:window.WineD3D?.renderer,gpuFlag:window.WINE_D3DIM_GPU,d3dimGpu:w?.d3dimGpu?.snapshot?.(),
    gpuUnavailable:w?.d3dimGpu?.unavailable,renderEndpoints:[...(w?._renderWorkerManager?.ports?.values()||[])].map(p=>({id:p.id,api:p.options.api,backend:p.options.backend,closed:p.closed})),
    memoryBytes:w?.memory?.buffer?.byteLength,eip:e?.get_eip?.(),batch:w?.batches,
    pointerLocked:!!document.pointerLockElement,
    inputs:globalThis.__arcanumInputs||[],
    windows:Object.values(w?.renderer?.windows||{}).map(v=>({hwnd:v.hwnd,title:v.title,visible:v.visible,minimized:v.minimized,x:v.x,y:v.y,w:v.w,h:v.h,
      layer:v._dxFrameLayer?{w:v._dxFrameLayer.w,h:v._dxFrameLayer.h,writeSeq:v._dxFrameLayer.writeSeq}:null})),
    launcher:document.getElementById('wine-launch-window')?.textContent?.slice(0,500),
    log:document.getElementById('log')?.textContent?.slice(-4000)};
});}
async function shot(name){
  if(!/^[a-z0-9-]+$/.test(name)||fs.existsSync(out+'/'+name+'.png'))throw Error('fresh safe shot name required');
  const b=await page.screenshot();if(b.length>8e6)throw Error('capture cap');fs.writeFileSync(out+'/'+name+'.png',b);
  save(name+'.json',{sha256:sha(b),state:await state()});
}
async function command(c){
  if(Date.now()+15000>=deadline&&c.action!=='quit')throw Error('immutable deadline reserve');
  commands.push({at:new Date().toISOString(),...c});
  if(c.action==='shot')return shot(c.name);
  if(c.action==='state')return save(c.name+'.json',await state());
  if(c.action==='quit')return close('ordinary driver stop');
  if(c.action==='registered-route'){
    if(!['software','webgl'].includes(c.backend))throw Error('explicit backend required');
    // Navigation restarts the registered original route. It does not restore
    // a guest snapshot or modify guest state, and retains the outer deadline.
    activeBackend=c.backend;
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?app=arcanum_demo&debug&no-threads&d3d-renderer='+activeBackend,{waitUntil:'load',timeout:45000});
    save('route-'+commands.length+'.json',{at:new Date().toISOString(),url:page.url(),backend:activeBackend,deadline:new Date(deadline).toISOString(),wasmSha256:sha(fs.readFileSync(root+'/build/wine-assembly.wasm'))});return;
  }
  if(!c.reviewRef||!fs.existsSync(out+'/'+c.reviewRef+'.png'))throw Error('reviewed screenshot reference required');
  if(c.action==='capture-pointer'){
    const button=c.button||'right';if(!['left','right'].includes(button))throw Error('capture button');
    await page.mouse.move(c.x,c.y);await page.mouse.down({button});await pause(100);await page.mouse.up({button});return;
  }
  if(c.action==='relative'){
    for(const k of ['dx','dy'])if(!Number.isInteger(c[k])||Math.abs(c[k])>600)throw Error('relative bounds');
    if(!await page.evaluate(()=>!!document.pointerLockElement))throw Error('ordinary pointer capture required');
    cp.execFileSync('/usr/bin/xdotool',['mousemove_relative','--',String(c.dx),String(c.dy)],{env:{...process.env,DISPLAY:':0'},timeout:5000});return;
  }
  if(c.action==='click'){
    cp.execFileSync('/usr/bin/xdotool',['mousedown','1'],{env:{...process.env,DISPLAY:':0'},timeout:5000});
    try{await pause(120);}finally{cp.execFileSync('/usr/bin/xdotool',['mouseup','1'],{env:{...process.env,DISPLAY:':0'},timeout:5000});}return;
  }
  if(c.action==='key'){
    if(!Number.isInteger(c.ms)||c.ms<50||c.ms>3000)throw Error('key hold bound');
    await page.keyboard.down(c.key);try{await pause(c.ms);}finally{await page.keyboard.up(c.key);}return;
  }
  if(c.action==='measure'){
    if(!Number.isInteger(c.seconds)||c.seconds<5||c.seconds>60)throw Error('measurement bound');
    const s=await state();if(s.guestWorker||s.backend!==activeBackend||(activeBackend==='webgl'&&(s.gpuUnavailable||!s.d3dimGpu?.draws)))throw Error('explicit live backend required');
    await shot(c.name+'-before');
    await page.evaluate(installArcanumPresentationCounter.toString()+`;globalThis.__arcanumCounter=installArcanumPresentationCounter(runningApps.find(a=>a.name==='arcanum_demo').wine.renderer,${Number(c.hwnd)},${Number(c.width)},${Number(c.height)});`);
    counterActive=true;
    try{for(let i=0;i<c.seconds;i++){await pause(1000);await page.evaluate(()=>globalThis.__arcanumCounter.sample());}
      save(c.name+'-samples.json',await page.evaluate(()=>globalThis.__arcanumCounter.stop()));counterActive=false;
      await shot(c.name+'-after');
    }finally{if(counterActive){save(c.name+'-interrupted.json',await page.evaluate(()=>globalThis.__arcanumCounter.stop()));counterActive=false;}}
    return;
  }
  throw Error('unsupported action');
}
async function main(){
  const pins=JSON.parse(fs.readFileSync(root+'/pins.json'));
  for(const p of pins.files)if(sha(fs.readFileSync(root+'/'+p.path))!==p.sha256)throw Error('source/fixture pin '+p.path);
  const module=fs.readFileSync(root+'/build/wine-assembly.wasm');
  const servedModuleHashes=[];
  server=http.createServer((req,res)=>{
    const rel=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1)||'index.html',p=path.resolve(root,rel);
    if(!p.startsWith(root+'/'))return res.writeHead(403).end();
    let stat;try{stat=fs.statSync(p);if(!stat.isFile())throw Error();}catch{return res.writeHead(404).end();}
    let a=0,b=stat.size-1,status=200;const range=req.headers.range;
    if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return res.writeHead(416).end();a=+m[1];b=m[2]?+m[2]:b;status=206;if(a>b||b>=stat.size)return res.writeHead(416).end();}
    const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css','.png':'image/png'}[path.extname(p)]||'application/octet-stream';
    const h={'Content-Type':mime,'Content-Length':b-a+1,'Cache-Control':'no-store','Accept-Ranges':'bytes','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};if(range)h['Content-Range']=`bytes ${a}-${b}/${stat.size}`;
    const row={rel,status,range:range||null,size:stat.size};requests.push(row);
    if(rel==='build/wine-assembly.wasm')servedModuleHashes.push(sha(module));
    res.writeHead(status,h);if(req.method==='HEAD')return res.end();const stream=fs.createReadStream(p,{start:a,end:b});res.on('close',()=>stream.destroy());stream.on('error',e=>{errors.push(String(e));res.destroy();});stream.pipe(res);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  profile=fs.mkdtempSync(path.join(os.tmpdir(),'arcanum-'));
  browser=await puppeteer.launch({headless:false,executablePath:'/usr/bin/google-chrome',userDataDir:profile,args:['--no-sandbox','--enable-unsafe-swiftshader'],protocolTimeout:30000,timeout:30000});
  page=await browser.newPage();await page.setViewport({width:900,height:720});
  page.on('console',m=>{if(consoleRows.length<4000)consoleRows.push({at:Date.now(),type:m.type(),text:m.text().slice(0,2000)});});page.on('pageerror',e=>errors.push(String(e)));
  await page.evaluateOnNewDocument(()=>{globalThis.__arcanumInputs=[];for(const type of ['mousemove','mousedown','mouseup','keydown','keyup'])document.addEventListener(type,e=>{const q=globalThis.__arcanumInputs;if(q.length>=256)q.shift();q.push({time:performance.now(),type,isTrusted:e.isTrusted,key:e.key,movementX:e.movementX,movementY:e.movementY,locked:!!document.pointerLockElement});},true);});
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?app=arcanum_demo&debug&no-threads&d3d-renderer='+backend,{waitUntil:'load',timeout:45000});
  save('identity.json',{startedAt:new Date(start).toISOString(),deadline:new Date(deadline).toISOString(),budgetSeconds:1200,boat:'bx_bdrvj38f',backend,commit:pins.commit,wasmSha256:sha(module),browserVersion:await browser.version(),node:process.version,pid:process.pid,chromePid:browser.process().pid,profile,servedModuleHashes,command:process.argv,scope:'registered original app; cooperative origins; ordinary trusted pointer/keyboard events only'});
  console.log(JSON.stringify({ready:true,pid:process.pid,chromePid:browser.process().pid,deadline:new Date(deadline).toISOString()}));
  let i=0,queue=Promise.resolve();
  poll=setInterval(()=>{const p=out+'/commands/'+i+'.json';if(fs.existsSync(p)){const c=JSON.parse(fs.readFileSync(p));i++;queue=queue.then(()=>closing?null:command(c)).then(()=>{save('progress.json',{done:i,time:new Date().toISOString()});}).catch(e=>{errors.push(String(e));save('command-error.json',{i,error:String(e)});});}},250);
  deadlineTimer=setTimeout(()=>close('immutable 1200s browser deadline'),Math.max(1,deadline-Date.now()));
}
main().catch(async e=>{errors.push(e.stack||String(e));await close('harness error');process.exitCode=1;});
