'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {deriveReleaseReadiness,loadReleaseReview}=require('./release-readiness');
const candidate={id:'game',name:'Game',appIds:['game_app'],category:{id:'arcade'},fixtureStatus:'present',localDesktopAppIds:['game_app']};
const run={key:'scratch/runs/ok',candidateId:'game',verification:'reviewed',gameplayScreenshots:[{name:'game.png'}],startedAt:'2026-10-03T10:00:00Z',outcome:'unknown'};
const decision={sourceValidation:'current',id:'game',reviewer:'root',reviewedAt:'2026-10-03T11:00:00Z',basedOnRunKey:run.key,gates:Object.fromEntries(['gameplay','input','correctness','performance','distribution','package'].map(g=>[g,{status:'passed',summary:'Explicit reviewed '+g,source:'review.json'}]))};
function derive(extra={}){return deriveReleaseReadiness({candidates:[candidate],runs:[run],tasks:[],review:{production:{status:'verified',appIds:[]},reviews:[decision]},...extra});}
test('local desktop and screenshot alone never establish production or readiness',()=>{
 const x=derive({review:{production:{status:'unknown'},reviews:[]}}).entries[0];assert.equal(x.status,'unknown');assert.equal(x.productionMembership,'unknown');
 const y=derive({review:{production:{status:'verified',appIds:[]},reviews:[]}}).entries[0];assert.equal(y.status,'review-needed');assert.equal(y.prospect,'gameplay-reviewed');
});
test('explicit complete review plus real reviewed gameplay is ready; missing run fails closed',()=>{
 assert.equal(derive().entries[0].status,'ready');assert.equal(derive({runs:[]}).entries[0].status,'review-needed');
 const d=structuredClone(decision);d.gates.distribution.status='unknown';assert.equal(derive({review:{production:{status:'verified',appIds:[]},reviews:[d]}}).entries[0].status,'review-needed');
});
test('new diagnostic does not erase accepted gameplay; newer failed gameplay blocks',()=>{
 assert.equal(derive({runs:[{...run,key:'new',startedAt:'2026-10-03T12:00:00Z',outcome:'unknown',gameplayScreenshots:[]},run]}).entries[0].status,'ready');
 assert.equal(derive({runs:[{...run,key:'bad',startedAt:'2026-10-03T12:00:00Z',outcome:'failed',route:'ordinary gameplay',gameplayScreenshots:[]},run]}).entries[0].status,'blocked');
});
test('current associated blockers override release review; done task does not',()=>{
 const t={id:'fault',explicitCandidates:['game'],status:'blocked',blocker:'Wrong rendering',line:20};assert.equal(derive({tasks:[t]}).entries[0].status,'blocked');assert.equal(derive({tasks:[{...t,status:'done'}]}).entries[0].status,'ready');
});
test('verified production membership is separate from compatibility and tools excluded counts',()=>{
 const r=derive({candidates:[candidate,{...candidate,id:'tool',name:'Tool',category:{id:'tools'}}],review:{production:{status:'verified',appIds:['game_app']},reviews:[]}});assert.equal(r.counts['already-production'],1);assert.equal(r.nonGameCount,1);assert.equal(r.entries[0].productionMembership,'yes');
});
test('optional invalid config and snapshot tampering fail closed; extracted IDs must agree',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'release-readiness-'));try{
 await fs.mkdir(path.join(root,'ops'));assert.equal((await loadReleaseReview(root)).production.status,'unknown');
 const source="const DESKTOP_APPS = [\n ['live', 'Live'],\n];\n";await fs.writeFile(path.join(root,'apps.js'),source);await fs.writeFile(path.join(root,'index.html'),'public');const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const data={production:{checkedAt:'2026-10-03T11:00:00Z',url:'https://example.test/apps.js',artifact:'apps.js',sha256:hash(source),indexArtifact:'index.html',indexSha256:hash('public'),appIds:['live']},reviews:[]};const save=()=>fs.writeFile(path.join(root,'ops/release-readiness.json'),JSON.stringify(data));await save();assert.equal((await loadReleaseReview(root)).production.status,'verified');data.production.appIds=['invented'];await save();assert.equal((await loadReleaseReview(root)).production.status,'unknown');data.production.appIds=['live'];await save();await fs.writeFile(path.join(root,'apps.js'),'changed');assert.equal((await loadReleaseReview(root)).production.status,'unknown');
 data.production.appIds={bad:true};await save();assert.equal((await loadReleaseReview(root)).production.status,'unknown');
 await fs.writeFile(path.join(root,'ops/release-readiness.json'),'null');assert.equal((await loadReleaseReview(root)).production.status,'unknown');
 await fs.writeFile(path.join(root,'ops/release-readiness.json'),'{');assert.equal((await loadReleaseReview(root)).production.status,'unknown');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('stale source cannot be ready; installed executable avoids obsolete manifest alternative blocker',()=>{
 const d={...decision,sourceValidation:'missing-or-mismatched'};assert.equal(derive({review:{production:{status:'verified',appIds:[]},reviews:[d]}}).entries[0].status,'review-needed');
 const c={...candidate,fixtureStatus:'partial',registeredExecutables:[{present:true}]};assert.equal(derive({candidates:[c]}).entries[0].status,'ready');
});

test('release source receipts are checked against actual files, never a supplied valid flag',async()=>{
 const {SOURCE_KEYS}=require('./release-readiness');const root=await fs.mkdtemp(path.join(os.tmpdir(),'release-source-'));
 try {
  await fs.mkdir(path.join(root,'ops'));const hashes={};for(const name of SOURCE_KEYS){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),name);hashes[name]=crypto.createHash('sha256').update(name).digest('hex');}
  const record={reviews:[{...decision,sourceHashes:hashes,sourceValidation:'current'}]};await fs.writeFile(path.join(root,'ops/release-readiness.json'),JSON.stringify(record));assert.equal((await loadReleaseReview(root)).reviews[0].sourceValidation,'current');
  await fs.writeFile(path.join(root,'host.js'),'changed');assert.equal((await loadReleaseReview(root)).reviews[0].sourceValidation,'missing-or-mismatched');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
