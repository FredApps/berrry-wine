'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {PLAN,validateRows,evaluateWindow,createCheckpointObserver}=require('./icy-tower-frame-counter');
const clone=x=>JSON.parse(JSON.stringify(x));
const {fixture,origins}=require('./icy-tower-test-fixture');
test('complete proof is diagnostic only, never FPS',()=>{const r=evaluateWindow(fixture());assert.equal(r.accepted,true,r.reasons.join(';'));assert.equal(r.frames,1);assert.equal(r.fps,null);assert.equal(r.metric,'diagnostic-complete-render-proof');});
for(const [name,mutate]of Object.entries({
  'missing last row':x=>x.checkpoints[2].state.sourceRows.pop(),
  'aliased rows':x=>x.checkpoints[2].state.sourceRows[479]=x.checkpoints[2].state.sourceRows[0],
  'wrong primary row':x=>x.checkpoints[2].state.destinationRows[400].wa++,
  'sparse row hole':x=>x.checkpoints[2].state.sourceRows[6].mapped=false,
  'copy bypass':x=>x.checkpoints.splice(2,1),
  'failed Lock':x=>x.checkpoints[1].eax=0x88760000,
  'failed Unlock':x=>x.checkpoints[4].eax=1,
  'no HRESULT':x=>delete x.checkpoints[4].eax,
  'partial copy':x=>x.checkpoints[2].args[6]=639,
  'alternate caller':x=>x.checkpoints[2].outerOutputReturn=0x40e1e9,
  'clipped':x=>x.checkpoints[2].state.clip[1]=320,
  'palette effect':x=>x.checkpoints[2].state.paletteEffect=1,
  'nested lock':x=>x.checkpoints[3].state.depth=2,
  'presentation replacement':x=>x.checkpoints[3].state.target.objectToken++,
  'row changed after copy':x=>x.checkpoints[3].state.sourceRows[0].va++,
  'marker gap':x=>x.checkpoints[5].markerCount++,
  'foreign origin':x=>x.checkpoints[3].origin++,
  'upload before copy':x=>x.transfers[1].t=250,
  'orphan upload':x=>x.transfers.push({...x.transfers[3],t:480,endT:490}),
  'false review string':x=>x.counterReview.accepted='true',
  'unverified loaded code':x=>x.proof.liveCodeVerified=false,
  'NaN row':x=>x.checkpoints[2].state.sourceRows[0].wa=NaN,
})) test('reject '+name,()=>{const x=fixture();mutate(x);assert.equal(evaluateWindow(x).accepted,false);});
test('row validator bounded and strict',()=>{assert.deepEqual(validateRows(fixture().checkpoints[2].state),[]);assert(validateRows({sourceRows:Array(1000000)}).length);});
test('observer owns snapshots and enforces actual breakpoint',()=>{
  let eip=0x40f857,count=20,bp=0;const ex={set_bp:v=>bp=v,clear_bp:()=>bp=0,get_last_run_halt:()=>5,get_eip:()=>eip,get_image_base:()=>0x400000,get_eax:()=>0,get_logical_frame_addr:()=>0x40f857,get_logical_frame_pace:()=>0,get_logical_frame_count:()=>count};
  const extra={state:{depth:0}},o=createCheckpointObserver(ex,{origin:1,proof:fixture().proof,origins,inventory:()=>clone(origins),now:()=>10,capture:()=>extra});o.arm();assert.equal(bp,0x40f857);o.checkpoint();extra.state.depth=999;assert.equal(bp,0x485de8);assert.throws(()=>o.checkpoint());const r=o.stop();assert.equal(r.checkpoints[0].state.depth,0);assert.equal(bp,0);assert.throws(()=>o.stop());
});

for(const [name,mutate]of Object.entries({
 'foreign primary submission':w=>w.transfers[2].origin=4,
 'unknown primary submission':w=>w.transfers[2].origin=999,
 'replaced origin at stop':w=>w.enclosure.stopOrigins[1].recordToken++,
 'added origin at checkpoint':w=>w.checkpoints[2].origins.push({...origins[1],origin:7}),
 'owner reassigned':w=>{w.enclosure.origins[0].owner=false;w.enclosure.origins[1].owner=true;},
 'duplicate origin':w=>w.enclosure.origins[1].origin=1,
}))test(name,()=>{const w=fixture();mutate(w);assert.equal(evaluateWindow(w).accepted,false);});

