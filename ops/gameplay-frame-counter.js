'use strict';

// Browser-injected qualification observer. No pixels/guest memory are written.
// The existing logical marker changes decoder instrumentation, with pacing off.
(function(root){
  const PLAN={app:'blobby_volley',exe:'packages/freeware/blobby-volley/volley.exe',
    exeSha256:'24dc221063fcb0000656752105fb9d58e56fd55bb37efa3c8dfbb5ddbe355821',
    wasmSha256:'6cdc021dbf55ccc68cbcdb22d622adef7a13bb42a4cb56e9c4a8f233f1868886',
    preferredBase:0x400000,markerRva:0x4528b,
    // Relative-call block contains no relocatable absolute pointers.
    proofRva:0x45280,proofHex:'8b45088b40fce8d1d7ffff8b45088b40fcc6802dd29700018b45088b40fc',
    blitReturnRvas:[0x4293c,0x429cf,0x42a3c]};
  function mappedProof(ex,readByte){
    const base=ex.get_image_base()>>>0;
    if(!base || !Number.isSafeInteger(base+PLAN.markerRva)) throw new Error('invalid mapped image base');
    const actual=Array.from({length:PLAN.proofHex.length/2},(_,i)=>readByte(base+PLAN.proofRva+i).toString(16).padStart(2,'0')).join('');
    if(actual!==PLAN.proofHex) throw new Error('mapped Blobby match marker bytes differ');
    return {base,address:base+PLAN.markerRva,proofAddress:base+PLAN.proofRva,proofHex:actual};
  }
  function evaluateWindow(sample){
    const reasons=[],start=sample.start,stop=sample.stop;
    if(!start||!stop||typeof start.t!=='number'||typeof stop.t!=='number'||!Number.isFinite(start.t)||!Number.isFinite(stop.t)||stop.t<=start.t) return {accepted:false,reasons:['invalid wall window'],fps:null};
    const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
    if(!Array.isArray(start.contexts)||!Array.isArray(stop.contexts)||!start.contexts.length||[...start.contexts,...stop.contexts].some(c=>!c||!['id','origin','base','address','pace','count'].every(k=>uint(c[k]))))return {accepted:false,reasons:['invalid origin vector'],fps:null};
    const initial=new Map(start.contexts.map(c=>[c.id,c]));
    if(initial.size!==start.contexts.length||new Set(stop.contexts.map(c=>c.id)).size!==stop.contexts.length)reasons.push('duplicate originating context');
    let frames=0;
    if(start.contexts.length!==stop.contexts.length) reasons.push('originating context set changed');
    for(const c of stop.contexts){
      const prev=initial.get(c.id);
      if(!prev){reasons.push('new originating context');continue;}
      if(prev.address!==c.address||c.address!==c.base+PLAN.markerRva||prev.base!==c.base||prev.pace!==0||c.pace!==0||prev.origin!==c.origin) reasons.push('marker identity or pacing changed');
      if(!Number.isInteger(c.count)||!Number.isInteger(prev.count)||c.count<prev.count) reasons.push('counter reset or wrap');
      else frames+=c.count-prev.count;
    }
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    if(!Array.isArray(start.targets)||!start.targets.length||!same(start.targets,stop.targets)) reasons.push('selected live target changed or absent');
    if(!Array.isArray(start.targets)||start.targets.length!==initial.size||new Set(start.targets.map(t=>t.context)).size!==initial.size||start.targets.some(t=>!initial.has(t.context)||!['context','token','surfaceId','hwnd','width','height','form','formCanvas'].every(k=>uint(t[k]))||!t.token||!t.surfaceId||!t.form||!t.formCanvas||t.hwnd!==65538||t.width!==800||t.height!==600))reasons.push('invalid selected target identity or geometry');
    const targets=new Map((start.targets||[]).map(t=>[t.context,t]));
    const owners=stop.contexts.filter(c=>initial.has(c.id)&&c.count!==initial.get(c.id).count);
    if(owners.length>1)reasons.push('multiple marker-owning contexts unqualified');
    const selected=(sample.uploads||[]).filter(e=>e.selected),groups=new Map();
    const totals=contexts=>contexts.reduce((n,c)=>n+c.count,0);
    const lo=totals(start.contexts),hi=totals(stop.contexts);
    let previousTime=start.t,previousVector=start.contexts;
    let gameObject=null;
    for(const e of sample.uploads||[]){
      const own=initial.get(e.context);
      if(!!e.selected!==!!(own&&PLAN.blitReturnRvas.includes(e.ret-own.base)))reasons.push('selected API callsite flag inconsistent');
      const target=targets.get(e.context);
      if(target&&e.surfaceId===target.surfaceId&&!e.selected)reasons.push('unattributed upload to selected live target');
    }
    for(const e of selected){
      if(!uint(e.gameObject)||e.gameObject===0){reasons.push('callback game object missing');continue;}
      if(gameObject===null)gameObject=e.gameObject;
      else if(e.gameObject!==gameObject){reasons.push('callback game object changed');continue;}
      const target=targets.get(e.context),coords=[e.left,e.top,e.right,e.bottom];
      if(!target||e.ok!==1||e.directDraw||e.targetToken!==target.token||e.hwnd!==target.hwnd||e.surfaceId!==target.surfaceId||e.width!==target.width||e.height!==target.height||
        coords.some(n=>!Number.isInteger(n))||Math.min(e.width,e.right)<=Math.max(0,e.left)||Math.min(e.height,e.bottom)<=Math.max(0,e.top)||
        !Array.isArray(e.args)||e.args.length!==9||e.args.some(n=>!uint(n))||e.args[3]<=0||e.args[4]<=0||e.args[8]!==0xcc0020||
        e.left!==(e.args[1]|0)||e.top!==(e.args[2]|0)||e.right!==e.left+e.args[3]||e.bottom!==e.top+e.args[4]||
        !e.form||!e.formCanvas||e.form!==target.form||e.formCanvas!==target.formCanvas||!e.formHdc||e.formHdc!==e.args[0]){reasons.push('selected blit upload failed or target invalid');continue;}
      if(!Number.isFinite(e.t)||e.t<previousTime||e.t<start.t||e.t>stop.t){reasons.push('upload outside immutable enclosure');continue;}
      previousTime=e.t;
      if(!Array.isArray(e.markerContexts)||e.markerContexts.length!==initial.size){reasons.push('upload origin vector missing');continue;}
      if(new Set(e.markerContexts.map(c=>c.id)).size!==initial.size||e.markerContexts.some(c=>{const a=initial.get(c.id),b=stop.contexts.find(x=>x.id===c.id),prev=previousVector.find(x=>x.id===c.id);return !a||!b||!prev||!['id','origin','base','address','pace','count'].every(k=>uint(c[k]))||c.origin!==a.origin||c.address!==a.address||c.base!==a.base||c.pace!==0||c.count<prev.count||c.count<a.count||c.count>b.count;})){reasons.push('upload origin vector changed');continue;}
      previousVector=e.markerContexts;
      const origin=e.markerContexts.find(c=>c.id===e.context);
      if(!origin||!PLAN.blitReturnRvas.includes(e.ret-origin.base)){reasons.push('selected API callsite unproven');continue;}
      const n=totals(e.markerContexts);
      if(n<lo||n>=hi){reasons.push('partial submission at window edge');continue;}
      if(!groups.has(n))groups.set(n,[]);groups.get(n).push(e);
    }
    if(groups.size!==frames)reasons.push('logical submission missing selected blit coverage');
    for(const events of groups.values()){
      const callsite=e=>e.ret-e.markerContexts.find(c=>c.id===e.context).base;
      const full=events.filter(e=>callsite(e)===PLAN.blitReturnRvas[0]);
      if(full.length){if(events.length!==1||full[0].args[3]!==800||full[0].args[4]!==600)reasons.push('full-frame callback has extra or incomplete transfers');continue;}
      const first=events[0];
      if(!Number.isInteger(first.list1Count)||!Number.isInteger(first.list2Count)||first.list1Count<0||first.list2Count<0||first.list1Count+first.list2Count<1||first.list1Count+first.list2Count>512){reasons.push('dirty-list size missing or invalid');continue;}
      if(events.some(e=>e.gameObject!==first.gameObject||e.list1Count!==first.list1Count||e.list2Count!==first.list2Count))reasons.push('dirty-list identity changed');
      for(const [ret,count]of[[PLAN.blitReturnRvas[1],first.list1Count],[PLAN.blitReturnRvas[2],first.list2Count]]){
        const list=events.filter(e=>callsite(e)===ret).map(e=>e.listIndex).sort((a,b)=>a-b);
        if(list.length!==count||list.some((v,i)=>v!==i+1))reasons.push('dirty-list callback has missing or duplicate transfers');
      }
    }
    if(sample.sceneReview?.continuousGameplay!==true) reasons.push('continuous gameplay review missing');
    if(sample.sceneReview?.ordinaryInput!==true) reasons.push('ordinary player control review missing');
    if(sample.counterReview?.oneSubmissionPerMarker!==true) reasons.push('one logical submission per marker qualification missing');
    if(sample.enclosure?.internalStart!==true||sample.enclosure?.stableOrigins!==true||sample.enclosure?.stableTarget!==true)reasons.push('observer enclosure proof absent');
    if(sample.exeSha256!==PLAN.exeSha256||sample.wasmSha256!==PLAN.wasmSha256) reasons.push('binary identity differs');
    if(sample.errors?.length) reasons.push('observer error');
    return {accepted:reasons.length===0,reasons:[...new Set(reasons)],frames,durationMs:stop.t-start.t,coveredSubmissions:groups.size,
      diagnosticLogicalSubmissionsPerSecond:frames*1000/(stop.t-start.t),
      fps:reasons.length?null:frames*1000/(stop.t-start.t),
      metric:'guest-logical-frame-submissions',displayedFps:null,
      notes:'Game-specific completed render submission count; never a physical display refresh count. Reviews are explicit external evidence assertions.'};
  }
  function install(){
    if(typeof root.createHostImports!=='function') throw new Error('install after host imports load, before launch');
    const original=root.createHostImports,contexts=[],uploads=[],errors=[],tokens=new WeakMap();
    let active=false,internalStart=null,armed=false,tokenCount=0,armOrigins=[],selectedTarget=null;
    const token=p=>{if(!tokens.has(p))tokens.set(p,++tokenCount);return tokens.get(p);};
    const getExports=c=>c.ctx.exports||c.ctx.instance?.exports;
    root.createHostImports=function(ctx){
      const result=original(ctx),id=contexts.length;
      contexts.push({id,ctx,result});
      const upload=result.host.gdi_surface_upload;
      result.host.gdi_surface_upload=function(surfaceId,left,top,right,bottom){
        const ok=upload(surfaceId,left,top,right,bottom);
        if(active){
          try {
            const ex=ctx.exports||ctx.instance?.exports,base=ex.get_image_base()>>>0,esp=ex.get_esp()>>>0;
            const ret=ex.guest_read32(esp)>>>0,p=result.gdi.surfacePresentations.get(surfaceId>>>0);
            const selected=PLAN.blitReturnRvas.includes(ret-base),object=selected?ex.get_ebx()>>>0:0;
            const form=selected?ex.guest_read32(ex.guest_read32(base+0x4df48)>>>0)>>>0:0;
            const formCanvas=form?ex.guest_read32(form+0x220)>>>0:0,formHdc=formCanvas?ex.guest_read32(formCanvas+4)>>>0:0;
            uploads.push({t:performance.now(),context:id,surfaceId:surfaceId>>>0,left,top,right,bottom,ok,
              hwnd:p?.targetHwnd||0,directDraw:!!p?.directDraw,width:p?.width,height:p?.height,targetToken:p?token(p):null,
              ret,selected,form,formCanvas,formHdc,
              gameObject:object,list1Count:selected?ex.guest_read32(object+0x97cc40)>>>0:null,list2Count:selected?ex.guest_read32(object+0x97cd84)>>>0:null,listIndex:selected?ex.get_esi()>>>0:null,
              logicalCount:ex.get_logical_frame_count()>>>0,
              markerContexts:snapshot().contexts,
              args:Array.from({length:9},(_,i)=>ex.guest_read32(esp+4+i*4)>>>0)});
          }catch(e){errors.push(String(e));}
        }
        return ok;
      };
      return result;
    };
    function snapshot(){
      return {t:performance.now(),contexts:contexts.map(c=>{
        const e=getExports(c);if(!e?.get_logical_frame_count)throw Error('origin lacks logical counter');
        if(armed&&armOrigins[c.id]!==e)throw Error('originating instance changed');
        return {id:c.id,origin:c.id+1,base:e.get_image_base()>>>0,address:e.get_logical_frame_addr()>>>0,pace:e.get_logical_frame_pace(),count:e.get_logical_frame_count()>>>0};
      }),targets:contexts.map(c=>{
        const matches=[...c.result.gdi.surfacePresentations.values()].filter(p=>p.targetHwnd===selectedTarget?.hwnd&&p.width===800&&p.height===600&&!p.directDraw);
        if(matches.length!==1)throw Error('selected800x600 match window absent or ambiguous');
        const p=matches[0],e=getExports(c),base=e.get_image_base()>>>0;
        const form=e.guest_read32(e.guest_read32(base+0x4df48)>>>0)>>>0,formCanvas=e.guest_read32(form+0x220)>>>0;
        return {context:c.id,token:token(p),surfaceId:p.id,hwnd:p.targetHwnd,width:p.width,height:p.height,form,formCanvas};
      })};
    }
    return {
      contexts,errors,uploads,snapshot,
      arm(wine,targetReceipt){
        if(active)throw Error('cannot rearm active window');
        if(wine.guestWorker||wine.threadManager?.backend!=='cooperative') throw new Error('qualification observer supports cooperative origins only');
        if(!targetReceipt?.reviewRef||targetReceipt.hwnd!==65538||!wine.renderer?.windows?.[targetReceipt.hwnd])throw Error('reviewed live target receipt required');
        selectedTarget={...targetReceipt};
        const proofs=contexts.map(c=>{const e=getExports(c);return {context:c.id,...mappedProof(e,va=>e.guest_read32(va)&255)};});
        armOrigins=contexts.map(getExports);
        for(const proof of proofs)armOrigins[proof.context].set_logical_frame(proof.address,0);
        armed=true;return proofs;
      },
      start(){if(!armed||active)throw Error('must arm inactive observer');uploads.length=0;errors.length=0;internalStart=snapshot();active=true;return structuredClone(internalStart);},
      stop(){if(!active)throw Error('observer not active');const stop=snapshot();active=false;const start=internalStart;internalStart=null;return {start,stop,uploads:[...uploads],errors:[...errors],enclosure:{internalStart:true,stableOrigins:contexts.length===armOrigins.length,stableTarget:JSON.stringify(start.targets)===JSON.stringify(stop.targets)}};},
      close(){active=false;root.createHostImports=original;for(const c of contexts){const e=c.ctx.exports||c.ctx.instance?.exports;if(e?.set_logical_frame)e.set_logical_frame(0,0);}}
    };
  }
  const api={PLAN,mappedProof,evaluateWindow,install};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.GameplayFrameCounter=api;
})(typeof window==='undefined'?globalThis:window);
