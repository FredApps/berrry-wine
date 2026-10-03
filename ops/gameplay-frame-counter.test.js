'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PLAN,mappedProof,evaluateWindow}=require('./gameplay-frame-counter');
const context=count=>({id:0,origin:1,base:PLAN.preferredBase,address:PLAN.preferredBase+PLAN.markerRva,pace:0,count});
const target={context:0,token:1,surfaceId:6356993,hwnd:65538,width:800,height:600,form:123,formCanvas:124};
function sample(){return {start:{t:10,contexts:[context(20)],targets:[target]},stop:{t:5010,contexts:[context(23)],targets:[target]},
  uploads:[20,21,22].flatMap((count,i)=>[1,2].map(list=>({selected:true,context:0,ok:1,hwnd:65538,targetToken:1,surfaceId:6356993,width:800,height:600,directDraw:false,left:0,top:0,right:100,bottom:100,
    t:100+i*1500,form:123,formCanvas:124,formHdc:1,args:[1,0,0,100,100,2,0,0,0xcc0020],ret:PLAN.preferredBase+PLAN.blitReturnRvas[list],
    markerContexts:[context(count)],gameObject:1000,list1Count:1,list2Count:1,listIndex:1}))),
  exeSha256:PLAN.exeSha256,wasmSha256:PLAN.wasmSha256,enclosure:{internalStart:true,stableOrigins:true,stableTarget:true},
  sceneReview:{continuousGameplay:true,ordinaryInput:true},counterReview:{oneSubmissionPerMarker:true}};}
test('relocated mapped marker uses real image base and checks every signature byte',()=>{
  const bytes=Buffer.from(PLAN.proofHex,'hex'),base=0x500000;
  assert.equal(mappedProof({get_image_base:()=>base},va=>bytes[va-base-PLAN.proofRva]).address,base+PLAN.markerRva);
  assert.throws(()=>mappedProof({get_image_base:()=>base},()=>0),/differ/);
});
test('dirty rectangles count one completed submission per group and never display FPS',()=>{
  const r=evaluateWindow(sample());assert.equal(r.accepted,true,r.reasons.join(';'));assert.equal(r.frames,3);assert.equal(r.fps,0.6);assert.equal(r.displayedFps,null);
});
test('150 markers plus one upload fails regardless external receipt',()=>{
  const s=sample();s.stop.contexts[0].count=170;s.uploads=s.uploads.slice(0,1);
  assert.equal(evaluateWindow(s).accepted,false);assert.equal(evaluateWindow(s).fps,null);
});
test('each exact dirty-list index is required; duplicated upload cannot hide a missing index',()=>{
  const s=sample();s.uploads[1]={...s.uploads[0]};assert.equal(evaluateWindow(s).accepted,false);
});
test('same ID replacement, empty clamped upload, and changed geometry reject',()=>{
  for(const mutate of [s=>s.uploads[0].targetToken=2,s=>{s.uploads[0].left=900;s.uploads[0].right=1000;},s=>s.stop.targets=[{...target,width:1000}],s=>s.uploads[0].args[3]=0]){
    const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);
  }
});
test('counter reset, replaced origin, missing vector and partial window edge reject',()=>{
  for(const mutate of [s=>s.stop.contexts[0].count=0,s=>s.stop.contexts[0].origin=9,s=>delete s.uploads[0].markerContexts,s=>s.uploads[0].markerContexts[0].count=23,s=>s.uploads[0].t=5]){
    const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);
  }
});
test('review receipts, immutable enclosure and exact binaries are mandatory',()=>{
  for(const mutate of [s=>delete s.sceneReview,s=>delete s.counterReview,s=>delete s.enclosure,s=>s.exeSha256='different',s=>s.uploads.forEach(e=>delete e.gameObject)]){
    const s=sample();mutate(s);assert.equal(evaluateWindow(s).fps,null);
  }
});
test('zero completed submissions remains zero FPS when explicitly reviewed as active gameplay',()=>{
  const s=sample();s.stop.contexts[0].count=20;s.uploads=[];assert.equal(evaluateWindow(s).fps,0);
});

test('nonfinite geometry, fractional identities, negative pointers, coerced timestamps and truthy strings reject',()=>{
  for(const mutate of [s=>{s.start.targets=[{...target,width:Infinity}];s.stop.targets=s.start.targets;s.uploads.forEach(e=>e.width=Infinity);},s=>{s.start.targets=[{...target,token:0.5}];s.stop.targets=s.start.targets;s.uploads.forEach(e=>e.targetToken=0.5);},s=>{s.start.targets=[{...target,form:-1}];s.stop.targets=s.start.targets;s.uploads.forEach(e=>e.form=-1);},s=>s.start.t='10',s=>s.sceneReview.continuousGameplay='false',s=>{s.uploads[0].right=1;s.uploads[0].bottom=1;}]){
    const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);
  }
});
test('orphan upload to selected target rejects even when flagged unselected',()=>{
  const s=sample();s.uploads.push({...s.uploads[0],t:4500,selected:false,ret:0x400001});
  assert.equal(evaluateWindow(s).accepted,false);
});
test('enormous counter delta rejects without iterating absent frames',()=>{
  const s=sample();s.stop.contexts[0].count=0xffffffff;
  assert.equal(evaluateWindow(s).accepted,false);
});
