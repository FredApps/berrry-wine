'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const api=require('./icy-tower-measurement');
const config={markerAddress:0x40f857,markerPace:0,breakpoint:0};
function fixture(){const raw=require('./icy-tower-test-fixture').fixture();raw.transfers=[...raw.transfers,...raw.transfers.map(e=>({...e}))];raw.checkpoints.push(...raw.checkpoints.slice(1));const events=raw.transfers.map((e,i)=>({...e,config,sequence:i+1,t:10+i*10,endT:11+i*10,markerCount:Math.floor(i/4)+1}));for(let i=0;i<2;i++){events[i*4].state=raw.checkpoints[1+i*5].state;events[i*4+1].state=raw.checkpoints[4+i*5].state;}return {observerOwned:true,debuggerUsed:false,origins:raw.enclosure.origins,proof:raw.proof,events,errors:[],dropped:0,start:{config,t:15,count:1,origins:raw.enclosure.origins},stop:{config,t:1015,count:3,origins:raw.enclosure.origins},requestedMs:1000,sceneReview:{continuousGameplay:true,ordinaryInput:true},counterReview:{accepted:true}};}
test('full wall interval retains leading partial transfer chain without trimming',()=>{const w=fixture(),r=api.evaluate(w);assert.equal(r.accepted,true,r.reasons.join(';'));assert.equal(r.frames,2);assert.equal(r.durationMs,1000);assert.equal(r.fps,2);});
test('trailing incomplete chain retained and not counted',()=>{const w=fixture();w.events.push({...w.events[4],sequence:9,markerCount:3,t:1010,endT:1011});const r=api.evaluate(w);assert.equal(r.accepted,true,r.reasons.join(';'));assert.equal(r.frames,2);assert.equal(r.durationMs,1000);});
for(const [name,mutate]of Object.entries({missing:w=>w.events.splice(2,1),foreign:w=>w.events[3].origin=4,overlap:w=>w.events[1].endT=35,rows:w=>w.events[1].state.sourceRows.pop(),HRESULTpath:w=>w.events[1].outerReturn++,future:w=>w.events[4].markerCount=5,wrap:w=>w.stop.count=0,huge:w=>w.stop.count=0xffffffff,trim:w=>w.stop.t=500,debug:w=>w.debuggerUsed=true,orphan:w=>w.events.push({...w.events[0],sequence:9,t:900,endT:901,markerCount:3,kind:'unattributed'}),afterStop:w=>w.events[7].endT=2000}))test(name,()=>{const w=fixture();mutate(w);assert.equal(api.evaluate(w).accepted,false);});
test('recorder owns samples and retains prearm chain',()=>{const w=fixture();let t=10,c=1;const r=api.createRecorder({origin:1,origins:w.origins,proof:w.proof,now:()=>t,count:()=>c,config:()=>config,inventory:()=>w.origins,capture:()=>({state:{}}),requestedMs:1000});for(const e of w.events.slice(0,4))r.transfer({...e,markerCount:0});assert.equal(r.sample(),false);t=1010;c=2;assert.equal(r.sample(),true);const receipt=r.finish();assert.equal(receipt.start.t,10);assert.equal(receipt.stop.t,1010);assert.equal(receipt.events.length,4);w.origins[0].origin=999;assert.equal(receipt.origins[0].origin,1);});
for(const [name,mutate]of Object.entries({
 'changed marker config':w=>w.events[2].config={...config,markerAddress:123},
 'active breakpoint':w=>w.start.config={...config,breakpoint:123},
 'pace enabled':w=>w.stop.config={...config,markerPace:1},
 'missing helper hash':w=>delete w.proof.observerSha256,
 'missing source receipt':w=>delete w.proof.sourceReceiptSha256,
 'prematurely cleared lock flag':w=>w.events[1].state.screenFlags=0x80000000,
}))test(name,()=>{const w=fixture();mutate(w);assert.equal(api.evaluate(w).accepted,false);});
