'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const cp=require('node:child_process'),readline=require('node:readline'),puppeteer=require('puppeteer');
const {closeResources}=require('./recorder');
const {measure}=require('./measure');
const subtreeSource=require('./subtree-page');
const {startDownhill}=require('./start-downhill');
const {diskReceipt,watchChrome}=require('./runtime-health');
const samplerSource=()=> '('+subtreeSource()+').sample';
const {altEnter,fullscreenSnapshot}=require('./controls');
const base=__dirname,repo='/home/user/wine-assembly',root=path.join(base,'source'),app='ski32';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function snapshot(){
 const entry=runningApps.find(a=>a.name==='ski32'),wine=entry?.wine;
 if(!wine?.running)throw Error('Exact live SkiFree missing');
 const voices=wine.hostCtx?._voices,ac=wine._audioCtx||voices?._ac;
 const scalars=(obj,names)=>Object.fromEntries(names.filter(n=>obj&&['number','boolean','string'].includes(typeof obj[n])).map(n=>[n,obj[n]]));
 return {at:new Date().toISOString(),monotonicMs:performance.now(),app:entry.name,mmTimerThread:wine.mmTimerThread,
  backend:wine.threadManager?.backend,hasWorker:!!wine.guestWorker,pageVisible:document.visibilityState,
  context:ac?scalars(ac,['state','sampleRate','currentTime','baseLatency','outputLatency']):null,
  voices:Object.values(voices?._map||{}).slice(0,16).map(v=>({...scalars(v,['id','rate','channels','bits','mode','paused','bytesWritten','nextTime','streamStartTime','streamStartTimeMs','gainValue']),sourceCount:v.sources?.size,streamChunkCount:v.streamChunks?.length})),
  windows:Object.values(wine.renderer?.windows||{}).slice(0,16).map(w=>({hwnd:w.hwnd,title:w.title,visible:w.visible,isChild:!!w.isChild,parentHwnd:w.parentHwnd,x:w.x,y:w.y,w:w.w,h:w.h})),
  threads:wine.threadManager?.threads instanceof Map ? [...wine.threadManager.threads].slice(0,16).map(([handle,t])=>({handle,...scalars(t,['state','startAddr','param','lastEip','yieldReason','threadId'])})) : null,
  waveStats:wine.hostCtx?._waveStats||null,
  waveQueue:(wine.hostCtx?.sharedAudio?.waveFunctionDoneQueue||[]).slice(0,16).map(x=>({handle:x.handle,waveHdrGA:x.waveHdrGA,submission:x.submission,deliveryStatus:x.deliveryStatus,ownerSlot:x.registration?.owner?.slot,generation:x.registration?.owner?.stream?.generation,retired:x.registration?.retired})),
  waveQueueLength:wine.hostCtx?.sharedAudio?.waveFunctionDoneQueue?.length,
  registrations:[...(wine.hostCtx?.sharedAudio?.waveRegistrations?.values()||[])].slice(0,16).map(r=>({handle:r.handle,type:r.type,callback:r.callback,instance:r.instance,retired:r.retired,ownerKind:r.owner?.kind,ownerSlot:r.owner?.slot,generation:r.owner?.stream?.generation,offerToken:r.owner?.link?._waveOffer?.token})),
  midi:{guestDriver:'unknown; open native device is evidence, no device does not prove AdLib',
   devices:[...(wine.hostCtx?._midiOut?.devices?.values()||[])].slice(0,16).map(d=>({handle:d.handle,deviceId:d.deviceId,flags:d.flags,volume:d.volume,program:Array.isArray(d.program)?d.program.slice(0,16):null,channelVolume:Array.isArray(d.channelVolume)?d.channelVolume.slice(0,16):null,fallbackActiveKeys:d.active instanceof Map?[...d.active.keys()].slice(0,64):null,tinySynth:!!d.tinySynth})),
   synth: wine.hostCtx?._tinySynth?{contextState:wine.hostCtx._tinySynth.ac?.state,clock:wine.hostCtx._tinySynth.ac?.currentTime,notes:Array.isArray(wine.hostCtx._tinySynth.synth?.notetab)?wine.hostCtx._tinySynth.synth.notetab.slice(0,64).map(n=>({channel:n.ch,note:n.n,start:n.t,end:n.e,released:n.f})):null}:null},
  fullscreenElement:document.fullscreenElement?.tagName||null};
}
function launchUrl(origin){const url=new URL('/',origin);url.searchParams.set('app',app);return url.href;}
function parentOf(pid){try{return Number(fs.readFileSync('/proc/'+pid+'/status','utf8').match(/^PPid:\s+(\d+)/m)?.[1]||0);}catch{return 0;}}
function sourceMap(){
 const receipt=JSON.parse(fs.readFileSync(base+'/source-closure.json'));
 const map=new Map();
 for(const row of receipt.runtimePaths){const file=root+'/'+row.name;if(sha(fs.readFileSync(file))!==row.sha256)throw Error('Private source drift '+row.name);map.set(row.name,{file,sha256:row.sha256});}
 const module=root+'/build/wine-assembly.wasm';if(!fs.existsSync(module))throw Error('Exact private fullbuild missing');
 const build=JSON.parse(fs.readFileSync(base+'/build-receipt.json'));
 if(build.sourceCommit!==receipt.ref||build.moduleSha256!==sha(fs.readFileSync(module))||build.fullGatesPassed!==true)throw Error('Fullbuild receipt mismatch');
 map.set('build/wine-assembly.wasm',{file:module,sha256:build.moduleSha256});
 const decl=require(root+'/lib/apps').APPS[app];
 const paths=[decl.exe,...(decl.dlls||[]),...(decl.files||[]).map(f=>typeof f==='string'?f:f.url)];
 for(const name of paths){if(name.includes('..')||path.isAbsolute(name))throw Error('Asset path escape');const file=repo+'/'+name;map.set(name,{file,sha256:sha(fs.readFileSync(file))});}
 const dllRoot=repo+'/test/binaries/dlls';for(const name of fs.readdirSync(dllRoot)){if(!/^[\w.-]+\.dll$/i.test(name))continue;const file=dllRoot+'/'+name;if(!fs.statSync(file).isFile())continue;const row={file,sha256:sha(fs.readFileSync(file))};map.set('binaries/dlls/'+name,row);map.set('test/binaries/dlls/'+name,row);}
 return {map,receipt,build,decl};
}
async function main(){
 if(process.argv.includes('--auto-record'))throw Error('Fullscreen-only route; recording disabled');
 const attempt=process.argv[2];if(!/^attempt\d+$/.test(attempt||'')||!process.argv.includes('--slot-granted')||!process.stdin.isTTY)throw Error('Fresh attempt, explicit grant and TTY required');
 const {map,receipt,build,decl}=sourceMap(),out=path.join(base,attempt);fs.mkdirSync(out);
 const save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
 for(const name of ['surface-regions.js','shared-hud-metadata.js','shared-hud-metadata.test.js','runtime-health.js','runtime-health.test.js','browser-subtree.js','start-downhill.js','start-downhill.test.js','subtree-page.js','subtree-observer.js','subtree-inspect.js','subtree-preflight.js','subtree-sample.js','subtree.test.js','subtree-ready.json','controls.js','recorder.js','measure.js','measure.test.js','identity.test.js','observer.js','inspect.js','sample.js','page-sampler.js','PLAN.md','source-closure.json','build-receipt.json','pins.json','ready.json'])fs.copyFileSync(base+'/'+name,out+'/'+name);
 save('pins.json',Object.fromEntries([...map].map(([n,r])=>[n,r.sha256])));
 save('plan.json',{app,sourceCommit:receipt.ref,module:build.moduleSha256,budgetMs:120000,ordinary:true,workerModified:false,timerOverride:false,recordingAllowed:false,decl});
 const disk=[diskReceipt(out)];let chromeHealth;
 const resources={},inputs=[],responses=[],logs=[],errors=[],pending=new Set(),snapshots=[];let rl,closing,page,sampled=false;
 const started=Date.now();
 async function finish(reason){if(closing)return closing;closing=(async()=>{const result=await closeResources(resources);result.reason=reason;result.ownedBrowserPid=resources.browser?.process?.()?.pid??null;result.ownedBrowserExitCode=resources.browser?.process?.()?.exitCode??null;result.ownedBrowserSignal=resources.browser?.process?.()?.signalCode??null;disk.push(diskReceipt(out));try{save('runtime-health.json',{disk,chrome:chromeHealth?.stop()??{unavailable:true}});}catch(e){errors.push('health receipt: '+String(e));}if(!result.complete)process.exitCode=1;await Promise.race([Promise.allSettled([...pending]),pause(2000)]);if(pending.size)errors.push('Pending response receipts at cleanup: '+pending.size);for(const[n,v]of Object.entries({'cleanup.json':result,'inputs.json':inputs,'responses.json':responses,'console.json':logs,'errors.json':errors,'snapshots.json':snapshots}))save(n,v);rl?.close();console.log(JSON.stringify({closed:result}));return result;})();return closing;}
 const guard=setTimeout(()=>finish('120sec guard').then(()=>process.exit(2)),120000);
 try{
  resources.server=http.createServer((req,res)=>{
   res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Cache-Control','no-store');
   let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';}catch{res.writeHead(400).end();return;}
   const row=map.get(name);if(!row||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
   const size=fs.statSync(row.file).size;let start=0,end=size-1,status=200;
   if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416).end();return;}start=+m[1];end=m[2]?+m[2]:end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=size){res.writeHead(416).end();return;}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);}
   const ext=path.extname(name).toLowerCase();res.setHeader('Content-Type',({'.js':'application/javascript','.json':'application/json','.html':'text/html','.wasm':'application/wasm','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[ext]||'application/octet-stream');res.setHeader('Content-Length',end-start+1);res.writeHead(status);if(req.method==='HEAD')res.end();else fs.createReadStream(row.file,{start,end}).on('error',()=>res.destroy()).pipe(res);
  });await new Promise(resolve=>resources.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+resources.server.address().port;
  resources.browser=await puppeteer.launch({headless:false,executablePath:'/usr/bin/google-chrome',ignoreDefaultArgs:['--mute-audio'],args:['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--no-first-run'],protocolTimeout:20000});
  chromeHealth=watchChrome(resources.browser.process());
  page=await resources.browser.newPage();await page.setViewport({width:1024,height:768});await page.setRequestInterception(true);page.on('request',r=>{const url=r.url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))r.continue().catch(()=>{});else{errors.push('Blocked external request '+url);r.abort().catch(()=>{});}});
  page.on('console',m=>{if(logs.length<300)logs.push({at:Date.now(),type:m.type(),text:m.text().slice(0,2000)});});page.on('pageerror',e=>errors.push(String(e)));page.on('requestfailed',r=>errors.push({url:r.url(),failure:r.failure()}));
  page.on('response',r=>{if(r.request().method()!=='GET')return;const job=(async()=>{const u=new URL(r.url());if(u.origin!==origin)return;const name=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html';if(!/\.(?:js|wasm|html|exe|dll|json)$/i.test(name)||r.status()!==200)return;const b=await r.buffer(),expected=map.get(name)?.sha256,hash=sha(b);responses.push({name,status:r.status(),sha256:hash,expected,matches:hash===expected,headers:r.headers()});if(hash!==expected)throw Error('Served mismatch '+name);const target=path.join(out,'served',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);})();pending.add(job);job.catch(e=>errors.push(String(e))).finally(()=>pending.delete(job));});
  await page.goto(launchUrl(origin),{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>typeof runningApps!=='undefined'&&runningApps.some(a=>a.name==='ski32'&&a.wine?.running&&a.wine?.guestWorker),{timeout:60000});
  await pause(1000);await page.screenshot({path:out+'/startup.png'});save('initial.json',await page.evaluate(snapshot));const startup=await startDownhill({page,snapshot,source:subtreeSource,sleep:pause,save,out,inputs,started});console.log(JSON.stringify({startup}));console.log('READY review downhill scene, then {sample:true,sceneReviewed:true,hwnd:EXACT}; ordinary commands: {"click":[x,y],"shot":"name"}, {"key":"Enter","shot":"name"}, {"sample":true,"sceneReviewed":true}, {"quit":true}');
  rl=readline.createInterface({input:process.stdin});
  for await(const line of rl){const command=JSON.parse(line);if(command.quit)break;
   if(command.preflight){if(!Number.isSafeInteger(command.preflight)||command.preflight<=0)throw Error('Exact HWND required');const proof=await page.evaluate('('+subtreeSource()+').preflight('+command.preflight+')');save('subtree-preflight.json',proof);console.log(JSON.stringify({preflight:proof}));continue;}
   if(command.sample){if(sampled)throw Error('Only one sample');sampled=true;await page.screenshot({path:out+'/sample-before.png'});const result=await measure({page,sleep:pause,source:samplerSource(),hwnd:command.hwnd,reviewed:command.sceneReviewed});save('sample.json',result);inputs.push({at:Date.now()-started,key:'ArrowRight',holdMs:150,duringSample:true});await page.screenshot({path:out+'/sample-after.png'});console.log(JSON.stringify({sample:result}));break;}
   if(command.chord){if(command.chord!=='Alt+Enter')throw Error('Only normal Alt+Enter supported');inputs.push(await altEnter(page,pause));}
   if(command.fullscreenShot){const name=command.fullscreenShot;if(!/^[a-z0-9-]+$/.test(name))throw Error('Invalid fullscreen name');await pause(1000);await page.screenshot({path:out+'/'+name+'.png'});try{save(name+'.json',await page.evaluate(fullscreenSnapshot));}catch(error){save(name+'.json',{at:new Date().toISOString(),ownerUnavailable:String(error),terminalScreenshotPreserved:true});}}
   if(command.click){const[x,y]=command.click;await page.mouse.move(x,y);await page.mouse.down();await pause(150);await page.mouse.up();inputs.push({at:Date.now()-started,click:[x,y],holdMs:150});}
   if(command.key){await page.keyboard.down(command.key);await pause(150);await page.keyboard.up(command.key);inputs.push({at:Date.now()-started,key:command.key,holdMs:150});}
   if(command.shot){if(!/^[a-z0-9-]+$/.test(command.shot))throw Error('Invalid screenshot name');await pause(1000);await page.screenshot({path:out+'/'+command.shot+'.png'});save(command.shot+'.json',await page.evaluate(snapshot));}
  }
  await finish('ordinary stop');
 }catch(error){errors.push(String(error.stack||error));process.exitCode=1;await finish('harness error');}
 finally{clearTimeout(guard);}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={snapshot,sourceMap,launchUrl};
