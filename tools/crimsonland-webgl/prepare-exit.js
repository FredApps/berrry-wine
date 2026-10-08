'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {overlayWorker}=require('./exit-observer');
const [baseline,output]=process.argv.slice(2);
if(!baseline||!output)throw Error('usage: prepare-exit.js RETAINED_RUNTIME FRESH_OUTPUT');
if(fs.existsSync(output))throw Error('fresh output required');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pins=JSON.parse(fs.readFileSync(path.join(baseline,'browser-pins.json')));
if(pins.referenceCommit!=='f62ab3c9f1223ab47cf623470f6343d508257878'||
  pins.module!=='4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de')throw Error('reference drift');
for(const f of pins.files)if(sha(fs.readFileSync(path.join(baseline,'source',f.path)))!==f.sha256)throw Error('pin drift '+f.path);
fs.mkdirSync(output,{recursive:true});
const overlay=path.join(output,'overlay');fs.mkdirSync(overlay);
const files=[];
function write(rel,b){const p=path.join(overlay,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b,{flag:'wx'});files.push({path:rel,bytes:Buffer.byteLength(b),sha256:sha(b)});}
const worker=fs.readFileSync(path.join(baseline,'source/lib/guest-worker.js'),'utf8');
write('source/lib/guest-worker.js',overlayWorker(worker));
const plan=JSON.parse(fs.readFileSync(path.join(baseline,'serve-plan.json')));
const workerPin=pins.files.find(f=>f.path==='lib/guest-worker.js');
const originalWorkerSha=workerPin.sha256;
const privateWorker=files[0];workerPin.sha256=privateWorker.sha256;workerPin.bytes=privateWorker.bytes;
plan.sourceHashes['lib/guest-worker.js']=privateWorker.sha256;
write('browser-pins.json',JSON.stringify(pins,null,2));write('serve-plan.json',JSON.stringify(plan,null,2));
for(const name of ['browser.js','controls.js','backend.js','assets.js','cleanup.js','lifecycle.js','preflight.js','exit-observer.js','exit-observer.test.js','prepare-exit.js'])
  write(name,fs.readFileSync(path.join(__dirname,name)));
const harness=JSON.parse(fs.readFileSync(path.join(baseline,'runtime-overlay.json')));
for(const file of files)if(Object.hasOwn(harness.harness,file.path))harness.harness[file.path]=file.sha256;
harness.sourceImmutable=false;
harness.observer={originalWorkerSha,privateWorkerSha:privateWorker.sha256,readOnly:true};
write('runtime-overlay.json',JSON.stringify(harness,null,2));
// Immutable archive shares an inode only; never extract over or modify it.
fs.linkSync(path.join(baseline,'runtime.tar.gz'),path.join(output,'baseline-runtime.tar.gz'));
const baselineSha=sha(fs.readFileSync(path.join(output,'baseline-runtime.tar.gz')));
if(baselineSha!=='d5b52fc3829fbbc8e3ec2f085bdd55b074eda4bc55a7da6152577683f1b656c5')throw Error('runtime archive drift');
cp.execFileSync('tar',['-czf',path.join(output,'observer-overlay.tar.gz'),'-C',overlay,...fs.readdirSync(overlay)]);
const archive=fs.readFileSync(path.join(output,'observer-overlay.tar.gz'));
fs.writeFileSync(path.join(output,'READY.json'),JSON.stringify({status:'READY SOURCE/JS ONLY; root grant required',
  referenceCommit:pins.referenceCommit,module:pins.module,pins:pins.files.length,originalWorkerSha,
  privateWorkerSha:privateWorker.sha256,baselineSha,overlaySha:sha(archive),overlayBytes:archive.length,
  files,limits:{transferSeconds:240,browserSeconds:300,cleanupSeconds:90,perWorkerFaults:4,perWorkerExits:2,perWorkerReadBytes:16384},
  recipe:['Copy both archives into a fresh owned remote prefix after root grant and independent lifecycle checks.',
    'Extract baseline archive there, then overlay archive there. Overlay retains fixtures and redirects only Worker source path.',
    'Run node preflight.js PREFIX; all 530 pins must match, including explicit private Worker.',
    'Use existing browser.js/control.js ordinary reviewed native launcher route with private Puppeteer path.',
    'Review splash/backend first; one ordinary dismissal if needed, collect [crimson-owning-exit-fault] rows and exact terminal evidence.',
    'Stop on exit/fault or 300s guard; cleanup and copy/hash receipts before removing own prefix. No automatic repeat.'],
  runtimePerformed:false,cause:'unobserved',gameplay:false},null,2));
console.log(JSON.stringify({pins:pins.files.length,baselineSha,overlaySha:sha(archive),overlayBytes:archive.length}));
