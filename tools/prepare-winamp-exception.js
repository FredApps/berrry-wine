'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='/home/user/wine-assembly';
const previous=path.join(root,'scratch/winamp-visualization-20261007');
const out=process.argv[2];
if (!out || !path.isAbsolute(out) || fs.existsSync(out)) throw Error('fresh absolute output directory required');
if (fs.statfsSync(root).bavail*fs.statfsSync(root).bsize<2147483648) throw Error('disk floor');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pins=JSON.parse(fs.readFileSync(path.join(previous,'attempt3-pins.json')));
const uploads=[...JSON.parse(fs.readFileSync(path.join(previous,'transfer-files.json'))),
  ...JSON.parse(fs.readFileSync(path.join(previous,'attempt3-uploads.json'))).uploads];
const byRemote=new Map(uploads.map(f=>[f.remote,f]));
const verified=pins.files.map(f=>{
  const rel=f.path.split('/source/')[1];if(!rel)throw Error('pin path shape');
  const local=rel.startsWith('test/binaries/')?path.join(root,rel):byRemote.get(f.path)?.local;
  if(!local)throw Error('missing local mapping '+rel);
  const bytes=fs.readFileSync(local);if(sha(bytes)!==f.sha256)throw Error('pin drift '+rel);
  return {rel,local,sha256:f.sha256,bytes:bytes.length};
});
const modulePin=verified.find(f=>f.rel==='build/wine-assembly.wasm');
if(modulePin.sha256!=='7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0')throw Error('module pin');
const originalWorker=verified.find(f=>f.rel==='lib/guest-worker.js');
let worker=fs.readFileSync(originalWorker.local,'utf8');
function replace(anchor,replacement){if(worker.split(anchor).length!==2)throw Error('nonunique/missing anchor');worker=worker.replace(anchor,replacement);}
replace("let parentPort = null;","let parentPort = null;\nlet winampExceptionObserver = null;");
replace('      installWaveRegistrationImports(built.imports.host);',
  `      importScripts(versionedWorkerUrl('winamp-exception-observer.js'));
      winampExceptionObserver = createWinampExceptionObserver({
        host:built.imports.host,getExports:()=>instance.exports,memory,
        translate:memUtils.g2w,
        emit:event=>send({t:'log',message:'[winamp-exception] '+JSON.stringify(event)})
      });
      installWaveRegistrationImports(built.imports.host);`);
replace('      guestThreadDetached = false;',
  `      guestThreadDetached = false;
      if ((msg.startAddr>>>0)===0x440330) {
        winampExceptionObserver.activate(msg);
        setTimeout(()=>winampExceptionObserver.finish(),20000);
      }`);
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
write('guest-worker.diagnostic.js',worker);
fs.copyFileSync(path.join(__dirname,'winamp-exception-observer.js'),path.join(out,'winamp-exception-observer.js'));
fs.copyFileSync(path.join(__dirname,'winamp-exception-observer.test.js'),path.join(out,'winamp-exception-observer.test.js'));
write('guest-worker.original.js',fs.readFileSync(originalWorker.local,'utf8'));
write('source-pins.json',{sourceCommit:pins.sourceCommit,moduleSha256:modulePin.sha256,files:verified});
write('original-fixtures.json',verified.filter(f=>f.rel.startsWith('test/binaries/')));
const remote='/home/user/winamp-exception-20261007';
const sourcePrefix='/home/user/winamp-visualization-20261007';
const plan=JSON.parse(fs.readFileSync(path.join(previous,'attempt3-plan.json')));
for(const key of Object.keys(plan.paths)) plan.paths[key]=plan.paths[key].replace(sourcePrefix,remote);
plan.paths['lib/winamp-exception-observer.js']=remote+'/source/lib/winamp-exception-observer.js';
write('serve-plan.json',plan);
const runtimeFiles=verified.map(f=>({local:f.local,remote:remote+'/source/'+f.rel,sha256:f.sha256}));
const workerFile=runtimeFiles.find(f=>f.remote.endsWith('/lib/guest-worker.js'));
workerFile.local=path.join(out,'guest-worker.diagnostic.js');workerFile.sha256=sha(Buffer.from(worker));
runtimeFiles.push({local:path.join(out,'winamp-exception-observer.js'),remote:plan.paths['lib/winamp-exception-observer.js'],
  sha256:sha(fs.readFileSync(path.join(out,'winamp-exception-observer.js')))});
write('browser-pins.json',{sourceCommit:pins.sourceCommit,moduleSha256:modulePin.sha256,
  diagnostic:true,files:runtimeFiles.map(f=>({path:f.remote,sha256:f.sha256}))});
let driver=fs.readFileSync(path.join(previous,'attempt3-browser.js'),'utf8');
driver=driver.replace("require('/home/user/wine-assembly/node_modules/puppeteer')","require(process.env.WINAMP_PUPPETEER)")
  .replace("'attempt3'","'attempt4'").replace("'commands3',commandIndex","'commands4',commandIndex")
  .replace('started+300000','started+240000')
  .replace('Date.parse("2026-10-07T22:51:07.784Z")-60000',"Date.parse(process.argv.find(v=>v.startsWith('--expires='))?.slice(10))-90000")
  .replace('if(deadline-started<240000)',"if(!Number.isFinite(deadline)||deadline-started<240000)")
  .replace('text:m.text().slice(0,2000)',"text:m.text().slice(0,m.text().includes('[winamp-exception]')?65536:2000)")
  .replace("await page.keyboard.press('p')","await pressRelease(()=>page.keyboard.down('p'),()=>pause(350),()=>page.keyboard.up('p'))");
if(driver.includes('2026-10-07T22:51:07'))throw Error('stale expiry remained');
write('browser.js',driver);
for(const name of ['assets.js','cleanup.js','controls.js','lifecycle.js'])fs.copyFileSync(path.join(previous,name),path.join(out,name));
for(const name of ['browser.js','browser-pins.json','serve-plan.json','assets.js','cleanup.js','controls.js','lifecycle.js'])
  runtimeFiles.push({local:path.join(out,name),remote:remote+'/'+name,sha256:sha(fs.readFileSync(path.join(out,name)))});
write('transfer-files.json',runtimeFiles);
const artifacts=fs.readdirSync(out).map(name=>({path:name,sha256:sha(fs.readFileSync(path.join(out,name)))}));
write('artifact-index.json',{artifacts});
write('READY.json',{status:'source-only ready; no native/build/remote execution',created:new Date().toISOString(),
  sourceCommit:pins.sourceCommit,moduleSha256:modulePin.sha256,sourcePinCount:verified.length,
  fixtureCount:verified.filter(f=>f.rel.startsWith('test/binaries/')).length,
  diagnosticWorkerSha256:sha(Buffer.from(worker)),originalWorkerSha256:originalWorker.sha256,
  bounds:{transferSeconds:120,browserSeconds:240,cleanupReserveSeconds:90,workerSeconds:20,
    workerEvents:512,apiHistory:128,exceptions:8,sehFrames:8,stackWords:32},
  request:'separate parent remote grant after priority lanes release; fresh actual sandbox/TTL >= 8min/no active browser/disk floor; unchanged original module and 15 fixtures; private JS observer only',
  artifacts:artifacts.map(f=>f.path)});
console.log(JSON.stringify({out,pins:verified.length,fixtures:verified.filter(f=>f.rel.startsWith('test/binaries/')).length,
  workerSha256:sha(Buffer.from(worker))}));
