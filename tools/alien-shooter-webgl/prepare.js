'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),zlib=require('node:zlib');
const [prior,media,out]=process.argv.slice(2);
if(!prior||!media||!out||fs.existsSync(out))throw Error('prior immutable runtime, original media, fresh output required');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const archive=path.join(prior,'baseline-runtime.tar.gz');
if(sha(fs.readFileSync(archive))!=='d5b52fc3829fbbc8e3ec2f085bdd55b074eda4bc55a7da6152577683f1b656c5')throw Error('accepted archive drift');
const b=zlib.gunzipSync(fs.readFileSync(archive)),base=new Map();
for(let at=0;at+512<=b.length;){const h=b.subarray(at,at+512);if(!h.some(Boolean))break;const str=(a,n)=>h.subarray(a,a+n).toString().replace(/\0.*$/s,'');const name=str(0,100).replace(/^\.\//,''),size=parseInt(str(124,12).trim()||'0',8);if(!Number.isSafeInteger(size))throw Error('tar size');if(str(156,1)==='0'||!str(156,1))base.set(name,b.subarray(at+512,at+512+size));at+=512+Math.ceil(size/512)*512;}
const pins=JSON.parse(base.get('browser-pins.json')),plan=JSON.parse(base.get('serve-plan.json'));
if(pins.referenceCommit!=='f62ab3c9f1223ab47cf623470f6343d508257878'||pins.module!=='4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de')throw Error('reference closure mismatch');
fs.mkdirSync(out,{recursive:true});const overlay=path.join(out,'overlay');fs.mkdirSync(overlay);
function write(root,n,data){const p=path.join(root,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data,{flag:'wx'});}
for(const f of pins.files){const data=base.get('source/'+f.path);if(!data||sha(data)!==f.sha256)throw Error('baseline pin '+f.path);const dest=path.join(out,'source',f.path),original=path.join(media,f.path);fs.mkdirSync(path.dirname(dest),{recursive:true});if(fs.existsSync(original)&&sha(fs.readFileSync(original))===f.sha256)fs.linkSync(original,dest);else write(out,'source/'+f.path,data);}
const registry=base.get('source/lib/apps.js');const authenticated=cp.execFileSync('git',['show',pins.referenceCommit+':lib/apps.js']);if(!registry.equals(authenticated))throw Error('registry source mismatch');
const fixture='test/binaries/candidates/reflexive-alien-shooter/',manifest=fixture+'.wine-assembly-browser.json';
const m=JSON.parse(fs.readFileSync(path.join(media,manifest))),paths=new Set([manifest,fixture+'game/AlienShooter.exe',...m.files.map(f=>fixture+f.url)]);
const missing=[...paths].filter(n=>!fs.existsSync(path.join(media,n)));if(missing.length)throw Error('Missing exact fixture paths: '+JSON.stringify(missing));
for(const n of paths){const original=path.join(media,n),data=fs.readFileSync(original),digest=sha(data);if(n.endsWith('/AlienShooter.exe')&&digest!=='aae2547ccec2e235344bc9cf6e5e9ef4c9923b13c9e8fbd1fe14c65b64252446')throw Error('original EXE drift');const entry=m.files.find(f=>fixture+f.url===n);if(entry&&entry.size!==data.length)throw Error('manifest size '+n);for(const root of [out,overlay]){const dest=path.join(root,'source',n);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.linkSync(original,dest);}pins.files.push({path:n,bytes:data.length,sha256:digest});plan.paths[n]='./source/'+n;plan.sourceHashes[n]=digest;}
for(const n of ['browser.js','backend.js','controls.js','assets.js','cleanup.js','lifecycle.js','relative-input.js','relative-input.test.js','preflight.js','prepare.js']){const data=fs.readFileSync(path.join(__dirname,n));write(out,n,data);write(overlay,n,data);}
for(const [n,obj] of [['browser-pins.json',pins],['serve-plan.json',plan]])for(const root of [out,overlay])write(root,n,Buffer.from(JSON.stringify(obj,null,2)));
fs.linkSync(archive,path.join(out,'baseline-runtime.tar.gz'));
cp.execFileSync(process.execPath,[path.join(out,'preflight.js'),out],{stdio:'inherit'});
cp.execFileSync('tar',['czf',path.join(out,'observer-overlay.tar.gz'),'-C',overlay,'.']);
write(out,'prepared-identity.json',Buffer.from(JSON.stringify({reference:pins.referenceCommit,module:pins.module,pins:pins.files.length,originalExe:plan.sourceHashes[fixture+'game/AlienShooter.exe'],manifest:plan.sourceHashes[manifest],baselineSha:sha(fs.readFileSync(archive)),overlaySha:sha(fs.readFileSync(path.join(out,'observer-overlay.tar.gz'))),scope:'Accepted unmodified baseline source/host/module; original registered Alien Shooter fixture; scoped ordinary input harness; no passive exit overlay or production patch'},null,2)));
