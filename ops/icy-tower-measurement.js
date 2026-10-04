'use strict';
// Completed logical submissions over an untrimmed scheduler-sampled interval.
// Never a displayed-frame or hardware-baseline measurement.
(function(root){
 const counter=typeof module!=='undefined'?require('./icy-tower-frame-counter'):root.IcyTowerFrameCounter;
 const clone=x=>JSON.parse(JSON.stringify(x)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),uint=x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff;
 const configOK=c=>c?.markerAddress===0x40f857&&c?.markerPace===0&&c?.breakpoint===0;
 const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
 function evaluate(w){
  const reasons=[],bad=s=>{if(!reasons.includes(s))reasons.push(s);};
  if(!w||!Array.isArray(w.events)||w.events.length>20000||!w.start||!w.stop)return {accepted:false,fps:null,reasons:['missing bounded interval']};
  const {start,stop}=w,delta=stop.count-start.count,duration=stop.t-start.t;
  if(!uint(start.count)||!uint(stop.count)||delta<=0||delta>5000||!Number.isFinite(start.t)||!Number.isFinite(stop.t)||duration<=0||!Number.isFinite(w.requestedMs)||w.requestedMs<100||w.requestedMs>10000||duration<w.requestedMs)bad('invalid full wall interval');
  if(!configOK(start.config)||!configOK(stop.config))bad('live marker configuration differs');
  if(w.observerOwned!==true||w.debuggerUsed!==false||w.errors?.length!==0||w.dropped!==0)bad('observer enclosure invalid');
  if(!Array.isArray(w.origins)||!same(w.origins,start.origins)||!same(w.origins,stop.origins)||w.origins.filter(o=>o.owner).length!==1)bad('origin inventory invalid');
  const owner=w.origins?.find(o=>o.owner)?.origin;
  if(w.proof?.exeSha256!==counter.PLAN.exeSha256||w.proof?.wasmSha256!==counter.PLAN.wasmSha256||w.proof?.liveCodeVerified!==true||w.proof?.loadedBytesVerified!==true||!hash(w.proof?.observerSha256)||!hash(w.proof?.sourceReceiptSha256))bad('actual source identity absent');
  const groups=new Map();let seq=0,time=-Infinity;
  for(const e of w.events){
   if(!configOK(e.config))bad('import marker configuration differs');
   if(!uint(e.markerCount)||!uint(e.sequence)||e.sequence<=seq||!Number.isFinite(e.t)||!Number.isFinite(e.endT)||e.t<time||e.endT<e.t||e.endT>stop.t||e.origin!==owner||!['lock','unlock','present','upload'].includes(e.kind))bad('unattributed/reordered event');
   seq=e.sequence;time=e.t;
   if(!groups.has(e.markerCount))groups.set(e.markerCount,[]);groups.get(e.markerCount).push(e);
  }
  const kinds=['lock','unlock','present','upload'];let baseline=null;
  for(const [count,g]of groups){
   if(count>stop.count)bad('future marker group');
   const counted=count>=start.count&&count<stop.count;
   if(counted&&!same(g.map(e=>e.kind),kinds)){bad('counted marker missing full chain');continue;}
   // Explicit trailing edge is an ordered prefix, never added to numerator.
   if(count===stop.count&&!same(g.map(e=>e.kind),kinds.slice(0,g.length)))bad('malformed trailing partial chain');
   if(!counted)continue;
   const [l,u,p,a]=g;
   if(l.endT>u.t||u.endT>p.t||p.endT>a.t)bad('imports overlap or reorder');
   if(l.returnAddress!==0x485de8||l.rect!==0||u.returnAddress!==0x485f6d||u.outerReturn!==0x40f857||u.rect!==0)bad('guest caller differs');
   for(const e of [l,u]){
    for(const error of counter.stateErrors(e.state))bad(error);
    if(e.state?.screenFlags!==0x84000000)bad('tracepoint lock flag differs');
    if(e.state?.depth!==(e.kind==='lock'?1:0))bad('lock depth differs');
    const state=clone(e.state||{});delete state.depth;delete state.screenFlags;
    if(baseline&&!same(baseline,state))bad('per-iteration rows/binding changed');baseline=state;
   }
   if(!same(l.target,u.target)||!same(u.target,p.target)||!same(p.target,a.target)||!same(a.target,u.state?.target))bad('target differs within chain');
   if(a.ok!==1||!same(a.rect,[0,0,640,480])||a.bitsWa!==u.state?.dibWa||a.paletteWa!==u.state?.target?.paletteWa||p.dibWa!==a.bitsWa||p.bpp!==8)bad('full canonical upload absent');
  }
  // Iterate observed data only; malformed huge deltas cannot force a loop.
  if([...groups.keys()].filter(n=>n>=start.count&&n<stop.count).length!==delta)bad('counted marker has no observed chain');
  if(w.sceneReview?.continuousGameplay!==true||w.sceneReview?.ordinaryInput!==true||w.counterReview?.accepted!==true)bad('independent reviews absent');
  return {accepted:reasons.length===0,reasons,frames:delta,durationMs:duration,fps:reasons.length?null:delta*1000/duration,metric:'guest-logical-frame-submissions',displayedFps:null,p95FrameMs:null,quantization:'integer completed-marker delta; partial edge chains retained, full wall denominator unchanged',instrumentation:'row/geometry checks and host import observation; not a hardware baseline'};
 }
 function createRecorder({origin,origins,proof,now,count,config,inventory,capture,requestedMs=1000}){
  if(!Number.isFinite(requestedMs)||requestedMs<100||requestedMs>10000)throw Error('bounded requested interval required');
  const events=[],errors=[];let start=null,stop=null,closed=false,sequence=0;
  const frozen=clone(origins),frozenProof=clone(proof);
  function checkedConfig(){const c=config();if(!configOK(c))throw Error('live marker configuration changed');return clone(c);}
  function edge(){const current=inventory();if(!same(current,frozen))throw Error('origin lifecycle changed');const configuration=checkedConfig(),c=count(),t=now();return {count:c,t,config:configuration,origins:clone(current)};}
  return {
   captureTransfer(e){e.config=checkedConfig();e.markerCount=count();if(e.origin===origin&&(e.kind==='lock'||e.kind==='unlock'))e.state=capture(e.kind).state;},
   transfer(e){if(closed)return;if(events.length>=20000){errors.push('event cap');return;}events.push(clone({...e,sequence:++sequence}));},
   sample(){if(closed)return true;const point=edge();if(!start){
     // One complete chain must precede arm. Initial partial warm-up stays raw.
     const g=events.filter(e=>e.markerCount===point.count-1);
     if(same(g.map(e=>e.kind),['lock','unlock','present','upload']))start=point;
    }else if(point.t-start.t>=requestedMs){stop=point;closed=true;}return closed;},
   finish(error){if(error)errors.push(String(error));if(!stop)stop=edge();closed=true;return clone({observerOwned:true,debuggerUsed:false,origins:frozen,proof:frozenProof,events,errors,dropped:0,start,stop,requestedMs});},
  };
 }
 const api={evaluate,createRecorder};if(typeof module!=='undefined')module.exports=api;else root.IcyTowerMeasurement=api;
})(typeof window==='undefined'?globalThis:window);
