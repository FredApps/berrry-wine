'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {assertWebGL,assertBackend}=require('./backend'),{validate,pressRelease}=require('./controls');
const good={queryBackend:'webgl',worker:true,renderEndpoints:[{api:'gl',backend:'webgl',closed:false}],renderWorkerEndpoints:[{api:'gl',backend:'webgl'}]};
assertWebGL(good);
for(const backend of ['software','webgl']){
 const state={...good,queryBackend:backend,renderEndpoints:[{id:1,api:'gl',backend,closed:false}],renderWorkerEndpoints:[{api:'gl',backend}]};
 assert.equal(assertBackend(state,backend).backend,backend);
 const other=backend==='software'?'webgl':'software';
 for(const key of ['renderEndpoints','renderWorkerEndpoints']){
  assert.throws(()=>assertBackend({...state,[key]:[{api:'gl',backend:other}]},backend));
  assert.throws(()=>assertBackend({...state,[key]:[{api:'gl',backend},{api:'gl',backend:other}]},backend));
  assert.throws(()=>assertBackend({...state,[key]:[{api:'gl',backend,closed:true}]},backend));
  assert.throws(()=>assertBackend({...state,[key]:[]},backend));
 }
 assert.throws(()=>assertBackend({...state,queryBackend:other},backend));
 assert.throws(()=>assertBackend({...state,worker:false},backend));
}
for(const key of ['renderEndpoints','renderWorkerEndpoints'])for(const api of ['neutral','legacy','glide'])assert.throws(()=>assertWebGL({...good,[key]:[{api,backend:'webgl'}]}));
assert.throws(()=>assertWebGL({...good,renderWorkerEndpoints:[{api:'gl',backend:'software'}]}));
const ctx={lastShot:'profiles',deadline:Date.now()+600000},review={sceneReviewed:true,sceneReceipt:'profiles'};
for(const key of ['A','B','C','Space','Escape'])validate({action:'key',key,ms:100,...review},ctx);
for(const button of ['left','right'])validate({action:'click',x:230,y:300,button,...review},ctx);
assert.throws(()=>validate({action:'click',x:230,y:300,button:'middle',...review},ctx));
assert.throws(()=>validate({action:'key',key:'Space',ms:100,...review,sceneReceipt:'stale'},ctx));
const s=fs.readFileSync(__dirname+'/browser.js','utf8');
assert(s.includes('d3d-render-worker.js'));assert(s.includes("get('gl-renderer')"));assert(s.includes("button:c.button||'left'"));assert(!s.includes('d3d9-renderer'));assert(!s.includes('Alien'));assert(s.includes('600000'));assert(s.includes("seq>=64"));
assert(s.includes('900000'));assert(s.includes('assertBackend(state,expectedBackend)'));assert.equal((s.match(/Pointer Lock active: absolute input refused/g)||[]).length,2);
(async()=>{const events=[];await assert.rejects(()=>pressRelease(()=>events.push('down'),()=>{throw Error('hold')},()=>events.push('up')));assert.deepEqual(events,['down','up']);console.log('OpenGL ownership negatives, ABC/Space/Escape/right-click review guards, release on error PASS')})().catch(e=>{console.error(e);process.exitCode=1});
