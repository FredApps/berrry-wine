'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),zlib=require('node:zlib');
const [prior,out]=process.argv.slice(2);if(!prior||!out||fs.existsSync(out))throw Error('prior final runtime and fresh output required');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function unpack(p){const b=zlib.gunzipSync(fs.readFileSync(p)),m=new Map();for(let at=0;at+512<=b.length;){const h=b.subarray(at,at+512);if(!h.some(Boolean))break;const str=(a,n)=>h.subarray(a,a+n).toString().replace(/\0.*$/s,'');const name=str(0,100),size=parseInt(str(124,12).trim()||'0',8);if(!Number.isSafeInteger(size))throw Error('tar size');if(str(156,1)==='0'||!str(156,1))m.set(name,b.subarray(at+512,at+512+size));at+=512+Math.ceil(size/512)*512;}return m;}
fs.mkdirSync(out,{recursive:true});const overlay=path.join(out,'overlay');fs.mkdirSync(overlay);
const archive=path.join(prior,'baseline-runtime.tar.gz');if(sha(fs.readFileSync(archive))!=='d5b52fc3829fbbc8e3ec2f085bdd55b074eda4bc55a7da6152577683f1b656c5')throw Error('baseline drift');
const base=unpack(archive),old=unpack(path.join(prior,'observer-overlay.tar.gz'));for(const[k,v]of old)base.set(k,v);
const pins=JSON.parse(base.get('browser-pins.json'));for(const f of pins.files)if(sha(base.get('source/'+f.path))!==f.sha256)throw Error('pin '+f.path);
const files=[];function write(n,b){const p=path.join(overlay,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);files.push({path:n,sha256:sha(b),bytes:b.length});}
for(const[k,v]of old)write(k,v);
for(const n of ['browser.js','relative-input.js','relative-input.test.js','prepare-relative.js'])write(n,fs.readFileSync(path.join(__dirname,n)));
const identity=JSON.parse(base.get('runtime-overlay.json'));for(const f of files)if(identity.harness[f.path])identity.harness[f.path]=f.sha256;identity.harness['relative-input.js']=sha(fs.readFileSync(path.join(__dirname,'relative-input.js')));write('runtime-overlay.json',Buffer.from(JSON.stringify(identity,null,2)));
for(const n of ['browser-pins.json','serve-plan.json','runtime-overlay.json'])fs.copyFileSync(path.join(overlay,n),path.join(out,n));
fs.linkSync(archive,path.join(out,'baseline-runtime.tar.gz'));cp.execFileSync('tar',['czf',path.join(out,'observer-overlay.tar.gz'),'-C',overlay,'.']);
fs.writeFileSync(path.join(out,'prepared-identity.json'),JSON.stringify({reference:pins.referenceCommit,module:pins.module,pins:pins.files.length,baselineSha:sha(fs.readFileSync(archive)),overlaySha:sha(fs.readFileSync(path.join(out,'observer-overlay.tar.gz'))),files,scope:'original530 pins plus preserved passive owning-exit observer; desktop relative input harness only'},null,2));
console.log(JSON.stringify({pins:pins.files.length,files:files.length,overlaySha:sha(fs.readFileSync(path.join(out,'observer-overlay.tar.gz')))}));
