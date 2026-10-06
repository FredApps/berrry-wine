'use strict';

// Qualification contract, not a callback-rate counter. Debugger checkpoints
// make API HRESULT and completed software-copy evidence explicit.
(function(root) {
  const PLAN = Object.freeze({version:1, width:640, height:480,
    exeSha256:'e139648070ec1de00c7cbb135db664dd725c1cdb6d2ecad3108b8b9f906cf4de',
    // Explicit root-approved repin after DEBUG-BREAKPOINT-RETARGET canonical
    // build; attempt4's older d2c provenance is never rewritten.
    wasmSha256:'5ff4844e5e4a2cc54d752d2235de9793999a7f0e651015693f01c8dcf4309ce1',
    mappedSha256:'12b1ac35d7479b63ac654207ac66524595f7bfebf5b048ba8d0a129514ea9b99',
    diagnosticSha256:'4165a4eee16a0a89694db400f945632241a1a0cf90651bb908b6e213e0851777',
    checkpoints:[['complete',0xf857],['lockReturn',0x85de8],['copyEntry',0x89568],
      ['copyReturn',0x7858],['unlockReturn',0x85f6d],['complete',0xf857]]});
  const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
  const ptr=n=>uint(n)&&n>0;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
  const clone=x=>JSON.parse(JSON.stringify(x));
  function verifyLiveCode(ex,proof) {
    if(ex.get_image_base()!==0x400000||proof?.mappedSha256!==PLAN.mappedSha256||!Array.isArray(proof.spans)||proof.spans.length!==8)throw Error('original mapped identity required');
    if(!same(proof.spans.map(s=>[s.start,s.start+s.length]),[[0x40f1fb,0x40f2b0],[0x40f840,0x40f860],[0x4074e0,0x407a98],[0x44ff20,0x450273],[0x489568,0x4896c7],[0x485cf8,0x485f96],[0x46c000,0x46c009],[0x487d50,0x487d83]]))throw Error('required code range missing');
    let bytes=0;
    for(const s of proof.spans) {
      if(!ptr(s.start)||!Number.isInteger(s.length)||s.length<1||s.length>4096||s.start<0x401000||s.start+s.length>0x4b1000||typeof s.hex!=='string'||s.hex.length!==s.length*2||!/^[a-f0-9]+$/.test(s.hex)||(bytes+=s.length)>16384)throw Error('invalid bounded code span');
      for(let i=0;i<s.length;i++)if((ex.guest_read8(s.start+i)&255)!==parseInt(s.hex.slice(i*2,i*2+2),16))throw Error('live unpacked code mismatch');
    }
    return {base:0x400000,bytes,liveCodeVerified:true};
  }
  function validateRows(s) {
    const errors=[];
    if(!s||!ptr(s.dibWa)||s.pitch!==640||!ptr(s.sourceBitmap)||!ptr(s.screenBitmap)||s.sourceBitmap===s.screenBitmap)return ['invalid bitmap/DIB binding'];
    if(!Array.isArray(s.sourceRows)||!Array.isArray(s.destinationRows)||s.sourceRows.length!==480||s.destinationRows.length!==480)return ['exactly 480 source and destination rows required'];
    const sourceRanges=[];
    for(let i=0;i<480;i++) {
      const a=s.sourceRows[i],b=s.destinationRows[i];
      if(!a||!b||!ptr(a.va)||!ptr(a.wa)||!ptr(b.va)||!ptr(b.wa)||a.bytes!==640||b.bytes!==640||a.mapped!==true||b.mapped!==true||a.va+640>0x100000000||b.va+640>0x100000000||a.wa+640>0x100000000||b.wa+640>0x100000000) {errors.push('unmapped or invalid row');continue;}
      if(b.wa!==s.dibWa+i*640)errors.push('destination rows do not cover locked primary');
      if(a.wa<s.dibWa+480*640&&a.wa+640>s.dibWa)errors.push('source aliases destination');
      sourceRanges.push([a.wa,a.wa+640]);
    }
    sourceRanges.sort((a,b)=>a[0]-b[0]);
    if(sourceRanges.some((r,i)=>i&&r[0]<sourceRanges[i-1][1]))errors.push('source rows overlap');
    return [...new Set(errors)];
  }
  function stateErrors(s) {
    const errors=validateRows(s);
    if(!s||s.mode!==0||s.paletteEffect!==0||s.selected64!==0||!ptr(s.selectedObject)||!uint(s.selectedIndex)||s.selectedIndex>=4096)errors.push('unsupported output state');
    if(!same(s?.dimensions,[640,480,640,480])||!same(s?.clip,[0,640,0,480])||s?.bpp!==8||s?.descriptorErrors!==0||s?.sourceFlags!==0||![0x80000000,0x84000000].includes(s?.screenFlags))errors.push('clipped, alternate format or invalid descriptor');
    const t=s?.target;
    if(!t||!['surfaceId','hwnd','objectToken','windowToken','paletteWa','com'].every(k=>ptr(t[k]))||t.surfaceId!==0x200004||t.width!==640||t.height!==480||t.directDraw!==true)errors.push('invalid live primary target');
    if(!same(s?.callbacks,{sourceRow:0x46c000,screenRow:0x487d50,sourceCleanup:0x46c008,screenCleanup:0x487d68,copy:0x489568,acquire:0x485cf8,release:0x485f0c}))errors.push('unproven callback binding');
    return errors;
  }
  function evaluateWindow(w) {
    const errors=[];const bad=m=>errors.push(m);
    if(!w||!Array.isArray(w.checkpoints)||!Array.isArray(w.transfers)||!Array.isArray(w.errors))return {accepted:false,fps:null,reasons:['malformed evidence']};
    const c=w.checkpoints,first=c[0],last=c.at(-1);
    if(c.length<6||(c.length-1)%5!==0||c.length>501)return {accepted:false,fps:null,reasons:['incomplete or excessive checkpoint sequence']};
    if(!Number.isFinite(first.t)||!Number.isFinite(last.t)||last.t<=first.t)return {accepted:false,fps:null,reasons:['invalid time enclosure']};
    if(w.errors.length||w.dropped!==0)bad('observer errors or dropped events');
    const origins=w.enclosure?.origins;
    if(w.enclosure?.observerOwned!==true||!Array.isArray(origins)||origins.length<1||origins.length>32||!same(origins,w.enclosure?.stopOrigins))bad('immutable observer enclosure absent');
    else {
      const ids=new Set();
      for(const o of origins){if(!Number.isInteger(o.origin)||o.origin<=0||ids.has(o.origin)||!Number.isInteger(o.contextToken)||o.contextToken<=0||!Number.isInteger(o.recordToken)||o.recordToken<=0||typeof o.owner!=='boolean'||o.state!=='active'||[o.handle,o.tid,o.startAddr,o.param].some(n=>!Number.isInteger(n)||n<0||n>0xffffffff))bad('invalid origin inventory');ids.add(o.origin);}
      if(origins.filter(o=>o.owner).length!==1||origins.find(o=>o.owner)?.origin!==first.origin)bad('render owner mismatch');
      for(const c of w.checkpoints)if(!same(c.origins,origins))bad('checkpoint origin lifecycle changed');
    }
    const p=w.proof;
    if(!p||p.exeSha256!==PLAN.exeSha256||p.wasmSha256!==PLAN.wasmSha256||p.mappedSha256!==PLAN.mappedSha256||p.loadedBytesVerified!==true||p.liveCodeVerified!==true||!hash(p.observerSha256)||!hash(p.sourceReceiptSha256))bad('loaded binary/code provenance missing');
    const origin=first.origin;
    if(!ptr(origin)||first.base!==0x400000||!uint(first.markerCount))bad('invalid initial origin/base/count');
    let prev=first.t;
    for(let i=0;i<c.length;i++) {
      const e=c[i],stage=i===0?PLAN.checkpoints[0]:PLAN.checkpoints[(i-1)%5+1];
      if(e.kind!==stage[0]||e.eip!==0x400000+stage[1]||e.origin!==origin||e.base!==0x400000||e.halt!==5||!Number.isFinite(e.t)||e.t<prev||!uint(e.markerCount)||e.markerPace!==0||e.markerAddress!==0x40f857)bad('checkpoint order/origin/marker invalid');
      prev=e.t;
      // Breakpoint stops before that block's logical marker executes. Leaving
      // the initial completion increments once; the next boundary is pre-op.
      const expected=first.markerCount+Math.ceil(i/5);
      if(expected>0xffffffff||e.markerCount!==expected)bad('missing or extra completed iteration');
      // The initial completion is only an enclosure boundary. Every later
      // checkpoint must carry fresh bounded rows, not arm-time assertions.
      if(i)for(const m of stateErrors(e.state))bad(m);
      if(i>1) {
        const a=c[i-1].state,b=e.state;
        if(a&&b)for(const k of ['sourceBitmap','screenBitmap','dibWa','pitch','target','sourceRows','destinationRows','selectedObject','selectedIndex','callbacks'])if(!same(a[k],b[k]))bad('bitmap, selected object, rows or target changed');
      }
      if(e.kind==='lockReturn'||e.kind==='unlockReturn')if(e.eax!==0)bad('guest API HRESULT failed or absent');
      if(e.kind==='copyEntry') {
        if(!same(e.args,[e.state?.sourceBitmap,e.state?.screenBitmap,0,0,0,0,640,480])||e.returnAddress!==0x450268||e.outerOutputReturn!==0x40f857)bad('full copy ABI/caller missing');
      }
      if(i&&e.state?.depth!==(e.kind==='lockReturn'||e.kind==='copyEntry'||e.kind==='copyReturn'?1:0))bad('nested or missing lock');
    }
    for(let start=1;start<c.length;start+=5) {
      const phases=c.slice(start,start+5),[lock,copy,done,unlock,complete]=phases;
      const events=w.transfers.filter(e=>e.t>c[start-1].t&&e.t<=complete.t);
      if(!same(events.map(e=>e.kind),['lock','unlock','present','upload'])) {bad('expected exactly one complete Lock/Unlock/presentation chain');continue;}
      for(const e of events) {
        if(e.origin!==origin||!Number.isFinite(e.t)||!Number.isFinite(e.endT)||e.endT<e.t||!same(e.target,copy.state?.target))bad('transfer origin/target/enclosure invalid');
      }
      const [l,u,present,upload]=events;
      if(l.endT>lock.t||u.t<done.t||u.endT>unlock.t||u.endT>present.t||present.endT>upload.t||upload.endT>unlock.t||copy.t<lock.t||done.t<copy.t)bad('transfer/copy/API return ordering invalid');
      if(l.returnAddress!==0x485de8||l.rect!==0||u.returnAddress!==0x485f6d||u.outerReturn!==0x40f857||u.rect!==0)bad('wrong API caller or partial lock');
      if(upload.ok!==1||!same(upload.rect,[0,0,640,480])||upload.bitsWa!==copy.state?.dibWa||upload.paletteWa!==copy.state?.target?.paletteWa)bad('full canonical upload missing');
      if(present.dibWa!==copy.state?.dibWa||present.bpp!==8)bad('present source differs');
    }
    let time=first.t,sequence=0;
    for(const e of w.transfers){if(!ptr(e.sequence)||e.sequence<=sequence||!Number.isFinite(e.t)||e.t<time||e.t<=first.t||e.endT>last.t)bad('orphan or reordered transfer');time=e.t;sequence=e.sequence;}
    if(w.sceneReview?.continuousGameplay!==true||w.sceneReview?.ordinaryInput!==true||w.counterReview?.accepted!==true)bad('independent scene/counter review absent');
    const frames=(c.length-1)/5,durationMs=last.t-first.t;
    return {accepted:errors.length===0,reasons:[...new Set(errors)],frames,durationMs,fps:null,diagnosticIterationRate:errors.length?null:frames*1000/durationMs,metric:'diagnostic-complete-render-proof',displayedFps:null,p95FrameMs:null,instrumentation:'debugger stops at five checkpoints per iteration; not a gameplay performance measurement'};
  }
  // The adapter supplies bounded state reads; this recorder owns chronology
  // and copies all evidence. No caller-supplied start/stop can replace it.
  function createCheckpointObserver(ex,adapter) {
    let index=0,closed=false,checkpoints=[],transfers=[],errors=[];
    const origin=adapter.origin,proof=clone(adapter.proof),origins=clone(adapter.origins||[]);
    const next=()=>PLAN.checkpoints[index===0?0:(index-1)%5+1];
    function arm(){if(closed)throw Error('observer closed');ex.set_bp(0x400000+next()[1]);}
    return {
      arm,
      checkpoint(){
        if(closed||ex.get_last_run_halt()!==5||ex.get_eip()!==0x400000+next()[1])throw Error('unexpected debugger stop');
        const current=adapter.inventory();if(!same(current,origins))throw Error('origin lifecycle changed');
        const kind=next()[0],extra=adapter.capture(kind);
        checkpoints.push(clone({...extra,origins:current,kind,t:adapter.now(),origin,base:ex.get_image_base()>>>0,eip:ex.get_eip()>>>0,halt:ex.get_last_run_halt(),eax:ex.get_eax()>>>0,markerAddress:ex.get_logical_frame_addr()>>>0,markerPace:ex.get_logical_frame_pace(),markerCount:ex.get_logical_frame_count()>>>0}));
        index++;if(index>501)throw Error('checkpoint cap');arm();return kind;
      },
      transfer(e){if(closed||checkpoints.length===0)return;if(transfers.length>=500){errors.push('transfer cap');return;}transfers.push(clone(e));},
      stop(){if(closed)throw Error('observer already closed');const stopOrigins=adapter.inventory();closed=true;ex.clear_bp();transfers.sort((a,b)=>a.sequence-b.sequence);return clone({proof,checkpoints,transfers,errors,dropped:0,enclosure:{observerOwned:true,origins,stopOrigins}});},
    };
  }
  const api={PLAN,stateErrors,validateRows,evaluateWindow,createCheckpointObserver,verifyLiveCode};
  if(typeof module!=='undefined')module.exports=api;else root.IcyTowerFrameCounter=api;
})(typeof window==='undefined'?globalThis:window);
