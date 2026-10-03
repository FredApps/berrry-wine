'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PLAN,mappedProof,evaluateWindow,selectsSurface}=require('./dxball-frame-counter');
const {readPE}=require('../lib/pe');
const context=count=>({id:0,origin:1,base:0x400000,address:0x40468b,pace:0,count});
const target={context:0,token:1,surfaceId:0x200003,hwnd:65538,windowToken:2,width:640,height:480};
const palette={context:0,com:120,vtable:220,slot:7,type:3,refs:1,dataWa:5000};
const front={com:100,vtable:200,slot:3,type:2,refs:1,backCom:108,width:640,height:480,bpp:8,pitch:640,dib:1000,flags:1};
const back={...front,com:108,slot:4,backCom:0,dib:2000,flags:2};
function sample(){
  const s={contractVersion:3,start:{t:10,contexts:[context(20)],targets:[target],palettes:[palette],surfaces:[{context:0,front,back}]},stop:{t:5010,contexts:[context(23)],targets:[target],palettes:[palette]},events:[],errors:[],
    exeSha256:PLAN.exeSha256,wasmSha256:PLAN.wasmSha256,enclosure:{internalStart:true,stableOrigins:true},sceneReview:{continuousGameplay:true,ordinaryInput:true},counterReview:{completedSubmissionPerMarker:true}};
  let f={...front},b={...back};
  for(let i=0;i<3;i++){
    [f,b]=[{...f,dib:b.dib},{...b,dib:f.dib}];
    const e={t:100+i*1500,context:0,contexts:[context(20+i)],state:1,pause:0,bypass:0,software:0,scrollHold:0xffffffff,exclusiveHwnd:65538,stackMapped:true,stack:[0x4016a6,100,0,0,123,0x404659,0,0,0,0,0,0,0],front:f,back:b,target,palette,primaryPaletteWa:palette.dataWa};
    s.events.push({...e,kind:'flip',args:[6,3,4,f.dib,b.dib]}, {...e,kind:'present',args:[5,3,8,f.dib,5000]}, {...e,kind:'upload',surfaceId:target.surfaceId,rect:[0,0,640,480],ok:1,bitsWa:f.dib,paletteWa:palette.dataWa,directDraw:true});
  }
  s.stop.surfaces=[{context:0,front:f,back:b}];return JSON.parse(JSON.stringify(s));
}
function withPalette(){
  const s=sample(),e=structuredClone(s.events[2]);
  e.stack=[0x402b91,palette.com,0,224,8,0x42c4c8,1,2,3,0x40467e,0x12,231,0x12];
  e.paletteSourceMapped=true;e.paletteSourceHex='12'.repeat(32);e.paletteDestinationHex=e.paletteSourceHex;
  const update={...e,kind:'palette',args:[4,palette.slot,224,8,palette.dataWa]},present={...e,kind:'present',args:[5,3,8,e.bitsWa,palette.dataWa]};
  s.events.splice(3,0,update,present,e);return JSON.parse(JSON.stringify(s));
}
test('real binary mapped proof checks relocated absolute operand and instruction bytes',()=>{
  const pe=readPE(PLAN.exe),base=0x400000,ex={get_image_base:()=>base,guest_read8:a=>pe.buf[pe.va2off(a)],guest_read32:a=>pe.buf.readUInt32LE(pe.va2off(a))};
  assert.equal(mappedProof(ex).address,0x40468b);
  const delta=0x100000;assert.equal(mappedProof({...ex,get_image_base:()=>base+delta,guest_read8:a=>ex.guest_read8(a-delta),guest_read32:a=>ex.guest_read32(a-delta)+delta}).address,0x50468b);
  assert.throws(()=>mappedProof({...ex,guest_read8:()=>0}),/differ/);
});
test('successful swaps and complete canonical groups qualify only logical submissions',()=>{
  const r=evaluateWindow(sample());assert.equal(r.accepted,true,r.reasons.join(';'));assert.equal(r.frames,3);assert.equal(r.fps,0.6);assert.equal(r.displayedFps,null);assert.equal(r.p95FrameMs,null);
});
test('marker bypass, software branch, non-game state, pause and failed upload reject',()=>{
  for(const mutate of [s=>s.events[0].bypass=1,s=>s.events[0].software=1,s=>s.events[0].state=0,s=>s.events[0].pause=1,s=>s.events[2].ok=0]){const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('actual swapped DIB values and canonical upload binding are mandatory',()=>{
  for(const mutate of [s=>s.events[0].front.dib=1000,s=>s.events[0].args[3]=1000,s=>s.events[2].bitsWa=1000,s=>s.events[2].rect=[0,0,1,1],s=>s.stop.surfaces[0].front.dib=1000]){const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('one group for many markers, repeated notifications and missing upload all reject',()=>{
  for(const mutate of [s=>s.stop.contexts[0].count=0xffffffff,s=>s.events.splice(1,0,structuredClone(s.events[0])),s=>s.events.splice(2,1),s=>s.events.push({...s.events[8],t:4900})]){const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('exact mapped originating API and wrapper callers required',()=>{
  for(const mutate of [s=>s.events[0].stack[0]++,s=>s.events[0].stack[5]=0x409801,s=>s.events[0].stack[1]=108,s=>s.events[0].stackMapped=false]){const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('lifecycle, context, geometry, malformed scalar and partial-window changes reject',()=>{
  for(const mutate of [s=>s.events[0].target.token++,s=>s.stop.targets[0].hwnd++,s=>s.events[0].front.refs=0,s=>s.events[0].target.width=Infinity,s=>s.start.t='10',s=>s.events[0].t=0,s=>s.events[0].contexts[0].count=23,s=>s.stop.contexts[0].origin++,s=>s.events[0].contexts[0].count=NaN]){const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('external truthy claims cannot replace exact identity and immutable evidence',()=>{
  for(const mutate of [s=>delete s.enclosure,s=>s.enclosure.internalStart='true',s=>s.sceneReview.continuousGameplay='true',s=>delete s.counterReview,s=>s.wasmSha256='old',s=>s.errors.push('lost event')]){const s=sample();mutate(s);assert.equal(evaluateWindow(s).fps,null);}
});
test('strict present argument arity and palette scalar',()=>{
  for(const mutate of [s=>s.events[1].args.pop(),s=>s.events[1].args[4]=NaN,s=>s.events[1].args[4]='5000']){const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('marker increments in another context do not prove this Flip completed',()=>{
  const s=sample();
  for(const snap of [s.start,s.stop]){
    snap.contexts.push({...snap.contexts[0],id:1,origin:2});snap.contexts[0].count=20;
    snap.targets.push({...target,context:1});snap.surfaces.push({...structuredClone(s.start.surfaces[0]),context:1});
    snap.palettes.push({...palette,context:1});
  }
  for(const e of s.events){e.contexts.push({...e.contexts[0],id:1,origin:2});e.contexts[0].count=20;}
  const result=evaluateWindow(s);assert.equal(result.accepted,false);assert.ok(result.reasons.includes('Flip completion and marker originate in different contexts'));
  s.stop.surfaces[1]=s.stop.surfaces[0];assert.ok(evaluateWindow(s).reasons.includes('duplicate or missing stop surface origin'));
});
test('fixed primary binding includes competing canonical surfaces at the same HWND',()=>{
  assert.equal(selectsSurface(target,target.surfaceId,undefined),true);
  assert.equal(selectsSurface(target,0x610001,{targetHwnd:target.hwnd}),true);
  assert.equal(selectsSurface(target,0x610001,{targetHwnd:target.hwnd+1}),false);
  assert.equal(selectsSurface(target,target.surfaceId,{targetHwnd:0}),true);
  const s=sample();s.events.push({...s.events[8],t:4900,surfaceId:0x610001});assert.equal(evaluateWindow(s).accepted,false);
});
test('surface deletion/reallocation notifications cannot be hidden by later matching state',()=>{
  const s=sample();s.events.splice(1,0,{...s.events[0],kind:'surface-lifecycle',args:[22,3,0,0,0]});assert.equal(evaluateWindow(s).accepted,false);
});
test('one optional fully copied active palette chain is part of one completed iteration',()=>{
  const r=evaluateWindow(withPalette());assert.equal(r.accepted,true,r.reasons.join(';'));assert.equal(r.frames,3);assert.equal(r.fps,0.6);
});
test('pause/other palette caller, range, helper argument and incomplete copy reject',()=>{
  for(const mutate of [s=>s.events[3].stack[9]=0x40450a,s=>s.events[3].stack[3]=200,s=>s.events[3].stack[12]=0,s=>s.events[3].paletteDestinationHex='00'.repeat(32),s=>s.events[3].paletteSourceMapped=false,s=>s.events[3].palette.com++,s=>s.events[3].primaryPaletteWa++,s=>s.events[5].paletteWa++]){const s=withPalette();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('missing palette trace/upload, duplicated cycle and late completion remain rejected',()=>{
  for(const mutate of [s=>s.events.splice(3,1),s=>s.events.splice(5,1),s=>s.events.splice(6,0,...structuredClone(s.events.slice(3,6))),s=>s.events[5].contexts[0].count++,s=>s.events[3].stack[0]=0x402a30]){const s=withPalette();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('old marker and old contract cannot be accepted under new palette model',()=>{
  for(const mutate of [s=>s.contractVersion=1,s=>s.start.contexts[0].address=0x404659]){const s=sample();mutate(s);assert.equal(evaluateWindow(s).accepted,false);}
});
test('exact immutable palette bytes must survive trace through completed upload',()=>{
  const s=withPalette();for(let i=3;i<6;i++){s.events[i].paletteSourceHex=String(i).repeat(64);s.events[i].paletteDestinationHex=s.events[i].paletteSourceHex;}
  assert.ok(evaluateWindow(s).reasons.includes('palette bytes changed before completed upload'));
  const t=withPalette();t.events[3].paletteSourceHex=[t.events[3].paletteSourceHex];t.events[3].paletteDestinationHex=t.events[3].paletteSourceHex;assert.equal(evaluateWindow(t).accepted,false);
});
test('palette helper reuses original start/direction slots for saved final blue/green',()=>{
  const s=withPalette();for(const e of s.events.slice(3,6)){e.paletteSourceHex='12'.repeat(28)+'89abcdef';e.paletteDestinationHex=e.paletteSourceHex;e.stack[10]=0xcd;e.stack[12]=0xab;}
  assert.equal(evaluateWindow(s).accepted,true);
  for(const [slot,value] of [[10,224],[12,1],[10,0x1cd],[11,230]]){const t=JSON.parse(JSON.stringify(s));t.events[3].stack[slot]=value;assert.equal(evaluateWindow(t).accepted,false);}
});
