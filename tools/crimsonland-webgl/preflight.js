'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),assert=require('assert'),cp=require('child_process');
const {assertWebGL}=require('./backend'),{validate,pressRelease}=require('./controls'),{createAssetHandler,drainStreams}=require('./assets');
async function main(){
 const dir=process.argv[2]||__dirname,plan=JSON.parse(fs.readFileSync(dir+'/serve-plan.json')),pins=JSON.parse(fs.readFileSync(dir+'/browser-pins.json'));
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const f of pins.files){const b=fs.readFileSync(dir+'/source/'+f.path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);}
 for(const n of ['browser.js','backend.js','controls.js','assets.js','cleanup.js','lifecycle.js','prepare.js'])if(fs.existsSync(dir+'/'+n))cp.execFileSync(process.execPath,['--check',dir+'/'+n]);
 const good={queryBackend:'webgl',worker:true,renderEndpoints:[{api:'neutral',backend:'webgl',closed:false}],renderWorkerEndpoints:[{api:'neutral',backend:'webgl'}]};assertWebGL(good);
 for(const bad of [{...good,worker:false},{...good,queryBackend:'software'},{...good,renderWorkerEndpoints:[]},{...good,renderEndpoints:[{api:'legacy',backend:'webgl'}]},{...good,renderWorkerEndpoints:[{api:'neutral',backend:'software'}]}])assert.throws(()=>assertWebGL(bad));
 const ctx={lastShot:'tutorial-hover',deadline:Date.now()+300000};validate({action:'move',x:303,y:357,sceneReviewed:true,sceneReceipt:'tutorial-hover'},ctx);validate({action:'key',key:'w',ms:2000,sceneReviewed:true,sceneReceipt:'tutorial-hover'},ctx);assert.throws(()=>validate({action:'click',x:303,y:357},ctx));assert.throws(()=>validate({action:'key',key:'w',ms:0,sceneReviewed:true,sceneReceipt:'tutorial-hover'},ctx));
 assert.throws(()=>validate({action:'key',key:'w',ms:1000,sceneReviewed:true,sceneReceipt:'tutorial-hover'},{...ctx,deadline:Date.now()+1000}));
 const events=[];await assert.rejects(()=>pressRelease(()=>events.push('down'),()=>{throw Error('hold failure')},()=>events.push('up')));assert.deepEqual(events,['down','up']);
 const responses=[],errors=[],pending=new Set();
 const requestFile=u=>{const rel=decodeURIComponent(new URL(u,'http://local').pathname).slice(1);if(!Object.hasOwn(plan.paths,rel)&&!plan.optionalAbsent.includes(rel))throw Error('unlisted');return{rel,p:path.resolve(dir,plan.paths[rel]||'absent')}};
 const rangeFor=(v,n)=>{if(!v)return{start:0,end:n-1,status:200};const m=/^bytes=(\d+)-(\d+)$/.exec(v);if(!m||+m[1]>+m[2]||+m[2]>=n)throw Error('range');return{start:+m[1],end:+m[2],status:206}};
 const server=http.createServer(createAssetHandler({plan,root:dir+'/source',fixtureRoot:dir+'/source',responses,errors,pending,requestFile,rangeFor}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  for(const f of pins.files){const r=await fetch(origin+'/'+f.path,{method:'HEAD'});assert.equal(r.status,200);assert.equal(+r.headers.get('content-length'),f.bytes);assert.equal(r.headers.get('cross-origin-embedder-policy'),'require-corp');}
  for(const rel of ['index.html','host.js','lib/guest-worker.js','lib/apps.js','lib/d3d-render-worker.js','build/wine-assembly.wasm','test/binaries/candidates/reflexive-crimsonland/game/crimsonland.exe','test/binaries/candidates/reflexive-crimsonland/.wine-assembly-browser.json']){const r=await fetch(origin+'/'+rel);assert.equal(r.status,200);assert.equal(sha(Buffer.from(await r.arrayBuffer())),plan.sourceHashes[rel]);}
  const rel='build/wine-assembly.wasm',r=await fetch(origin+'/'+rel,{headers:{Range:'bytes=0-63'}});assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),fs.readFileSync(dir+'/source/'+rel).subarray(0,64));
  for(const rel of plan.optionalAbsent){const r=await fetch(origin+'/'+rel);assert.equal(r.status,404);await r.arrayBuffer();}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 assert.equal((await drainStreams(pending,1000)).pending,0);assert.deepEqual(errors,[]);
 const result={at:new Date().toISOString(),pinsVerified:pins.files.length,httpHead:pins.files.length,httpGet:8,range:true,streamDrain:true,ordinaryInputs:'review gate/bounds/hold/release on error PASS',backend:'matching host and owning neutral WebGL; five negative controls PASS',nativeBuildRun:false,browserRun:false};fs.writeFileSync(dir+'/preflight.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1});
