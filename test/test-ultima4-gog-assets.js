'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {prepare}=require('../tools/prepare-ultima4-gog-assets');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ultima-overlay-'));
try {
 function put(p,b){fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),b);return {path:p,bytes:Buffer.byteLength(b),sha256:digest(b)};}
 const installer=put('candidate/setup.exe','original installer'),name='__support/save/PARTY.SAV',template=Buffer.from([0,1,255,17]);put('candidate/installed/'+name,template);
 const config=put('config.conf','[autoexec]\nmount C C:\\\nmount C C:\\cloud_saves -t overlay\nC:\nULTIMA.COM\n');
 const s={installer,installedRoot:'candidate/installed',files:[{path:name,bytes:4,sha256:digest(template)}],config,saveOverlay:{templates:[name]}};
 put('candidate/installed/cloud_saves/PARTY.SAV','existing player save');
 const first=prepare(root,s),mp=root+'/candidate/.wine-assembly-browser.json',before=fs.readFileSync(mp);
 assert.equal(first.saveTemplateAliases,1);assert.deepEqual(prepare(root,s),first);assert.deepEqual(fs.readFileSync(mp),before);
 assert.equal(fs.readFileSync(root+'/candidate/installed/cloud_saves/PARTY.SAV','utf8'),'existing player save');
 const alias=JSON.parse(before).files.find(f=>f.vfsPath==='c:\\cloud_saves\\PARTY.SAV');assert.equal(alias.url,'installed/'+name);assert.equal(alias.sha256,digest(template));assert.deepEqual(fs.readFileSync(root+'/candidate/installed/'+name),template);
 fs.writeFileSync(mp,'unknown local metadata');const cb=fs.readFileSync(root+'/candidate/ultima4-wa.conf');assert.throws(()=>prepare(root,s),/conflict/);assert.deepEqual(fs.readFileSync(root+'/candidate/ultima4-wa.conf'),cb);assert.equal(fs.readFileSync(mp,'utf8'),'unknown local metadata');
 s.config.previousManifestSha256=digest('unknown local metadata');prepare(root,s);assert.equal(fs.readFileSync(mp+'.before-'+s.config.previousManifestSha256,'utf8'),'unknown local metadata');
 fs.writeFileSync(root+'/candidate/installed/'+name,'changed');assert.throws(()=>prepare(root,s),/fixture mismatch/);
 const actual=require('../lib/ultima4-gog-source.json');assert.equal(actual.saveOverlay.templates.length,4);assert(actual.saveOverlay.templates.includes(name));
 const apps=fs.readFileSync(path.join(__dirname,'../lib/apps.js'),'utf8');const entry=apps.slice(apps.indexOf('      ultima4_gog: {')).split('\n      },')[0];assert(entry.includes("persistFiles: ['c:\\\\cloud_saves\\\\*.sav']"));assert(!entry.includes('persistReset'));
 const shell=fs.readFileSync(path.join(__dirname,'../lib/browser-shell.js'),'utf8');assert(shell.indexOf('VfsPersistence.attach',shell.indexOf('await wine.loadFiles(app.files'))>shell.indexOf('await wine.loadFiles(app.files'));
 const {VirtualFS}=require('../lib/filesystem'), persistence=require('../lib/vfs-persistence');
 const values=new Map(),storage={get length(){return values.size},key:i=>[...values.keys()][i]||null,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const user=new VirtualFS(),opts={appId:'ultima4_gog',patterns:['c:\\cloud_saves\\*.sav'],storage};
 const saved=persistence.attach(user,opts),handle=user.createFile('c:\\cloud_saves\\party.sav',0x40000000,2);user.writeFile(handle,Uint8Array.from([7,8,9]),3);saved.flush();saved.detach();
 const next=new VirtualFS(),seed=next.createFile('c:\\cloud_saves\\party.sav',0x40000000,2);next.writeFile(seed,template,template.length);const restored=persistence.attach(next,opts);assert.equal(restored.restored,1);assert.deepEqual([...next.files.get('c:\\cloud_saves\\party.sav').data],[7,8,9]);restored.detach();
 console.log('PASS original aliases, overlay order, idempotence, player-save preservation, conflict-before-write, pinned backup, source integrity, persistence registration/order');
}finally{fs.rmSync(root,{recursive:true,force:true});}
