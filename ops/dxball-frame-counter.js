'use strict';

// Diagnostic first: no public onGuestFrame callbacks are counted. Acceptance
// needs exact synchronous Flip/upload and optional active-palette update/upload
// before the completion marker. Death/fade palette calls are never accepted.
(function(root){
  const PLAN={app:'dxball',exe:'packages/freeware/dxball/dxball.exe',
    exeSha256:'191c113582e1f31016a158d40372fa21ea68d9348bf847bbfbc8e7c7bdfe195f',
    wasmSha256:'3d374324cd29153dd9354b855c98f0c52b44b709facbb8d1b67941fd9f05dddf',
    contractVersion:3,markerRva:0x468b,flipReturnRva:0x16a6,
    renderReturnRva:0x4659,paletteReturnRva:0x2b91,paletteOuterRva:0x467e};
  const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
  const pos=n=>uint(n)&&n>0;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const selectsSurface=(selected,id,p)=>!!selected&&(id===selected.surfaceId||p?.targetHwnd===selected.hwnd);
  function mappedProof(ex){
    const base=ex.get_image_base()>>>0;
    if(!pos(base)||!uint(base+0x349c8))throw Error('invalid mapped image base');
    const spans=[[0x4652,'7505e8f7cfffff'],[0x16a0,'508b08ff512c8bf085f6741981fec20176887505e8e793000081fe1c02768874d685f67537'],
      [0x4667,'83c40885c0741d5368e700000068e0000000e872e4ffff83c40ce89a940000'],[0x2b27,'8844241888542410eb0a'],[0x2b85,'8b32405750516a0052ff56185b5e5fc3']];
    for(const [rva,hex] of spans){
      const actual=Array.from({length:hex.length/2},(_,i)=>(ex.guest_read8(base+rva+i)&255).toString(16).padStart(2,'0')).join('');
      if(actual!==hex)throw Error('mapped DX-Ball instruction bytes differ');
    }
    if((ex.guest_read32(base+0x468c)>>>0)!==base+0x31c3c||ex.guest_read8(base+0x468b)!==0xa1)throw Error('relocated marker operand differs');
    return {base,address:base+PLAN.markerRva,spans,relocatedOperand:base+0x31c3c};
  }
  function evaluateWindow(s){
    const reasons=[];const fail=m=>reasons.push(m);
    if(!s||!s.start||!s.stop||!Number.isFinite(s.start.t)||!Number.isFinite(s.stop.t)||s.stop.t<=s.start.t)return {accepted:false,reasons:['invalid wall window'],fps:null};
    const a=s.start,b=s.stop;
    const validContext=c=>c&&['id','origin','base','address','pace','count'].every(k=>uint(c[k]))&&c.origin>0&&c.base>0&&c.address===c.base+PLAN.markerRva&&c.pace===0;
    if(!Array.isArray(a.contexts)||!Array.isArray(b.contexts)||!a.contexts.length||!a.contexts.every(validContext)||!b.contexts.every(validContext))return {accepted:false,reasons:['invalid context vector'],fps:null};
    const initial=new Map(a.contexts.map(c=>[c.id,c]));
    if(initial.size!==a.contexts.length||b.contexts.length!==initial.size||new Set(b.contexts.map(c=>c.id)).size!==initial.size)fail('changed context identities');
    let frames=0,owners=0,ownerId=null;
    for(const c of b.contexts){const prev=initial.get(c.id);if(!prev||c.origin!==prev.origin||c.base!==prev.base||c.address!==prev.address||c.count<prev.count)fail('context replaced or counter reset');else{frames+=c.count-prev.count;if(c.count>prev.count){owners++;ownerId=c.id;}}}
    if(owners!==1||frames<=0)fail('expected one active marker owner');
    const validSurface=p=>p&&['com','vtable','slot','type','refs','backCom','width','height','bpp','pitch','dib','flags'].every(k=>uint(p[k]))&&p.com>0&&p.vtable>0&&p.slot<4096&&p.type===2&&p.refs>0&&p.width===640&&p.height===480&&p.bpp===8&&p.pitch>=640&&p.dib>0;
    const identity=p=>{const {dib,...identity}=p;return identity;};
    const validTarget=p=>p&&['context','token','surfaceId','hwnd','windowToken','width','height'].every(k=>uint(p[k]))&&p.token>0&&p.hwnd>0&&p.windowToken>0&&p.width===640&&p.height===480;
    if(!Array.isArray(a.targets)||a.targets.length!==initial.size||!a.targets.every(validTarget)||!same(a.targets,b.targets))fail('selected presentation owner changed');
    const targets=new Map((a.targets||[]).map(t=>[t.context,t]));
    if(targets.size!==initial.size)fail('target context identity ambiguous');
    const validPalette=p=>p&&['context','com','vtable','slot','type','refs','dataWa'].every(k=>uint(p[k]))&&initial.has(p.context)&&p.com>0&&p.vtable>0&&p.slot<4096&&p.type===3&&p.refs>0&&p.dataWa>0;
    if(!Array.isArray(a.palettes)||!Array.isArray(b.palettes)||a.palettes.length!==initial.size||new Set(a.palettes.map(p=>p.context)).size!==initial.size||!a.palettes.every(validPalette)||!same(a.palettes,b.palettes))return {accepted:false,reasons:[...reasons,'palette binding changed or missing'],fps:null};
    const palettes=new Map(a.palettes.map(p=>[p.context,p]));
    if(!Array.isArray(a.surfaces)||!Array.isArray(b.surfaces)||a.surfaces.length!==initial.size||b.surfaces.length!==initial.size)return {accepted:false,reasons:[...reasons,'missing surface records'],fps:null};
    if(new Set(b.surfaces.map(p=>p.context)).size!==initial.size||b.surfaces.some(p=>!initial.has(p.context)))fail('duplicate or missing stop surface origin');
    const surfaces=new Map();
    for(const p of a.surfaces){
      if(!initial.has(p.context)||surfaces.has(p.context)||!validSurface(p.front)||!validSurface(p.back)||p.front.com===p.back.com||p.front.slot===p.back.slot||p.front.dib===p.back.dib||p.front.backCom!==p.back.com||!(p.front.flags&1)||!(p.back.flags&2)||targets.get(p.context)?.surfaceId!==0x200000+p.front.slot)fail('invalid primary/back binding');
      else surfaces.set(p.context,{front:p.front,back:p.back});
    }
    const total=v=>v.reduce((n,c)=>n+c.count,0),lo=total(a.contexts),hi=total(b.contexts),groups=new Map();
    let previousVector=a.contexts,previousTime=a.t;
    for(const e of s.events||[]){
      if(!Number.isFinite(e.t)||e.t<previousTime||e.t<a.t||e.t>b.t){fail('event outside immutable enclosure');continue;}previousTime=e.t;
      const own=initial.get(e.context),pair=surfaces.get(e.context),target=targets.get(e.context);
      if(!own||!pair||!target){fail('unknown event origin');continue;}
      if(e.context!==ownerId)fail('Flip completion and marker originate in different contexts');
      if(!Array.isArray(e.contexts)||e.contexts.length!==initial.size||new Set(e.contexts.map(c=>c.id)).size!==initial.size||e.contexts.some(c=>{const p=previousVector.find(x=>x.id===c.id),q=b.contexts.find(x=>x.id===c.id);return !p||!q||!validContext(c)||c.origin!==p.origin||c.address!==p.address||c.base!==p.base||c.count<p.count||c.count>q.count;})){fail('event origin vector invalid');continue;}previousVector=e.contexts;
      if(!same(e.target,target)||e.state!==1||e.pause===1||!uint(e.pause)||e.bypass!==0||e.software!==0||e.scrollHold!==0xffffffff||e.exclusiveHwnd!==target.hwnd)fail('non-gameplay state or presentation mode');
      const palette=palettes.get(e.context);
      if(!same(e.palette,palette)||e.primaryPaletteWa!==palette.dataWa)fail('primary palette identity changed');
      let phase='unknown';
      if(!Array.isArray(e.stack)||e.stack.length!==13||e.stack.some(n=>!uint(n))||e.stackMapped!==true)fail('mapped complete API stack missing');
      else if(e.stack[0]===own.base+PLAN.flipReturnRva){
        phase='flip';if(e.stack[1]!==pair.front.com||e.stack[2]!==0||e.stack[3]!==0||e.stack[5]!==own.base+PLAN.renderReturnRva)fail('Flip/gameplay caller not proven');
      }else if(e.stack[0]===own.base+PLAN.paletteReturnRva){
        phase='palette';if(e.stack[1]!==palette.com||e.stack[2]!==0||e.stack[3]!==224||e.stack[4]!==8||e.stack[5]!==own.base+0x2c4c8||e.stack[9]!==own.base+PLAN.paletteOuterRva||e.stack[11]!==231)fail('active palette caller/range/buffer not proven');
        if(e.paletteSourceMapped!==true||typeof e.paletteSourceHex!=='string'||typeof e.paletteDestinationHex!=='string'||!/^[a-f0-9]{64}$/.test(e.paletteSourceHex)||e.paletteSourceHex!==e.paletteDestinationHex)fail('active palette copy completion missing');
        // 402b27/402b2b reuse helper argument slots as local byte storage.
        // At API entry arg1's low byte is saved blue and arg3's is saved green;
        // both are copied into the final rotated entry231, not still224/1.
        if(typeof e.paletteSourceHex!=='string'||e.stack[10]!==parseInt(e.paletteSourceHex.slice(60,62),16)||e.stack[12]!==parseInt(e.paletteSourceHex.slice(58,60),16))fail('palette helper saved color bytes inconsistent');
      }else fail('unqualified API caller including fade');
      if(!validSurface(e.front)||!validSurface(e.back)||!same(identity(e.front),identity(pair.front))||!same(identity(e.back),identity(pair.back)))fail('surface lifecycle changed');
      const n=total(e.contexts);if(n<lo||n>=hi){fail('partial frame at measurement edge');continue;}
      if(!groups.has(n))groups.set(n,[]);groups.get(n).push(e);
      if(e.kind==='flip'){
        if(phase!=='flip'||!Array.isArray(e.args)||e.args.length!==5||!same(e.args,[6,pair.front.slot,pair.back.slot,pair.back.dib,pair.front.dib])||e.front.dib!==pair.back.dib||e.back.dib!==pair.front.dib)fail('actual synchronous surface swap missing');
        pair.front={...e.front};pair.back={...e.back};
      }else if(e.kind==='palette'){
        if(phase!=='palette'||!same(e.args,[4,palette.slot,224,8,palette.dataWa])||e.front.dib!==pair.front.dib||e.back.dib!==pair.back.dib)fail('active palette trace does not match completed copy');
      }else if(e.kind==='present'){
        if(!Array.isArray(e.args)||e.args.length!==5||e.args.some(n=>!uint(n))||!same(e.args,[5,pair.front.slot,pair.front.bpp,pair.front.dib,palette.dataWa])||e.front.dib!==pair.front.dib||e.back.dib!==pair.back.dib)fail('canonical present does not match swap');
      }else if(e.kind==='upload'){
        if(e.ok!==1||!same(e.rect,[0,0,640,480])||e.bitsWa!==pair.front.dib||e.paletteWa!==palette.dataWa||e.surfaceId!==target.surfaceId||e.directDraw!==true||e.front.dib!==pair.front.dib||e.back.dib!==pair.back.dib)fail('completed canonical upload missing');
      }else fail('unattributed selected-surface event');
    }
    if(groups.size!==frames)fail('marker count and completed groups differ');
    for(const events of groups.values()){
      const kinds=events.map(e=>e.kind),base=initial.get(events[0].context).base;
      if(!(same(kinds,['flip','present','upload'])||same(kinds,['flip','present','upload','palette','present','upload']))||!events.every((e,i)=>same(e.contexts,events[0].contexts)&&e.context===events[0].context&&e.stack?.[0]===base+(i<3?PLAN.flipReturnRva:PLAN.paletteReturnRva)))fail('expected one Flip chain plus optional active palette chain');
      if(events.length===6&&!events.slice(3).every(e=>e.paletteSourceHex===events[3].paletteSourceHex&&e.paletteDestinationHex===events[3].paletteDestinationHex))fail('palette bytes changed before completed upload');
    }
    for(const p of b.surfaces){const expected=surfaces.get(p.context);if(!expected||!same({front:p.front,back:p.back},expected))fail('stop surfaces do not match observed swaps');}
    if(s.enclosure?.internalStart!==true||s.enclosure?.stableOrigins!==true)fail('observer-owned enclosure missing');
    if(!Array.isArray(s.errors)||s.errors.length)fail('observer errors');
    if(s.exeSha256!==PLAN.exeSha256||s.wasmSha256!==PLAN.wasmSha256)fail('loaded binary identity mismatch');
    if(s.contractVersion!==PLAN.contractVersion)fail('old or unknown collector contract');
    if(s.sceneReview?.continuousGameplay!==true||s.sceneReview?.ordinaryInput!==true)fail('continuous gameplay/input review missing');
    if(s.counterReview?.completedSubmissionPerMarker!==true)fail('independent source/counter review missing');
    return {accepted:reasons.length===0,reasons:[...new Set(reasons)],frames,durationMs:b.t-a.t,fps:reasons.length?null:frames*1000/(b.t-a.t),metric:'guest-logical-frame-submissions',displayedFps:null,p95FrameMs:null};
  }
  function install(){
    if(typeof root.createHostImports!=='function')throw Error('install before launch');
    const original=root.createHostImports,contexts=[],tokens=new WeakMap();let nextToken=1,armed=false,active=false,origins=[],events=[],errors=[],start=null;
    const token=x=>{if(!x)return 0;if(!tokens.has(x))tokens.set(x,nextToken++);return tokens.get(x);};
    const exportsOf=c=>c.ctx.exports||c.ctx.instance?.exports;
    const vector=()=>contexts.map(c=>{const e=exportsOf(c);if(!e?.get_logical_frame_count||armed&&origins[c.id]!==e)throw Error('origin changed or missing');return {id:c.id,origin:token(e),base:e.get_image_base()>>>0,address:e.get_logical_frame_addr()>>>0,pace:e.get_logical_frame_pace(),count:e.get_logical_frame_count()>>>0};});
    function readSurface(c,com){
      const ex=exportsOf(c),mem=c.ctx.getMemory(),wa=root.memUtils.guestToWasm(com,ex,mem,ex.get_image_base()>>>0),regions=root.RegionMap;
      if(!['COM_WRAPPERS','COM_WRAPPERS_AUX'].some(k=>wa>=regions.BASE[k]&&wa+8<=regions.BASE[k]+regions.SIZE[k]&&(wa-regions.BASE[k])%8===0))throw Error('surface COM wrapper unmapped');
      const dv=new DataView(mem),slot=dv.getUint32(wa+4,true);if(slot>=4096)throw Error('surface slot invalid');
      const p=regions.BASE.DX_OBJECTS+slot*32;
      return {com,vtable:dv.getUint32(wa,true),slot,type:dv.getUint32(p,true),refs:dv.getUint32(p+4,true),backCom:dv.getUint32(p+8,true),width:dv.getUint16(p+12,true),height:dv.getUint16(p+14,true),bpp:dv.getUint16(p+16,true),pitch:dv.getUint16(p+18,true),dib:dv.getUint32(p+20,true),flags:dv.getUint32(p+28,true)};
    }
    function pair(c){const e=exportsOf(c),base=e.get_image_base()>>>0,front=readSurface(c,e.guest_read32(base+0x349ac)>>>0),back=readSurface(c,front.backCom);return {context:c.id,front,back};}
    function palette(c){const e=exportsOf(c),base=e.get_image_base()>>>0,p=readSurface(c,e.guest_read32(base+0x349b8)>>>0);return {context:c.id,com:p.com,vtable:p.vtable,slot:p.slot,type:p.type,refs:p.refs,dataWa:p.dib};}
    function target(c,pair){const p=c.result.gdi.surfacePresentations.get(0x200000+pair.front.slot),e=exportsOf(c),hwnd=e.get_dx_exclusive_hwnd()>>>0;return {context:c.id,token:token(p),surfaceId:p?.id||0,hwnd:p?.targetHwnd||0,windowToken:token(c.ctx.renderer?.windows?.[hwnd]),width:p?.width||0,height:p?.height||0};}
    function snapshot(){const surfaces=contexts.map(pair);return {t:performance.now(),contexts:vector(),surfaces,palettes:contexts.map(palette),targets:contexts.map((c,i)=>target(c,surfaces[i]))};}
    function selectedSurface(c,id){
      const selected=start?.targets.find(t=>t.context===c.id),p=c.result.gdi.surfacePresentations.get(id);
      // Keep the initial binding even if guest globals change. Competing
      // canonical surfaces attached to the same live HWND must not disappear.
      return selectsSurface(selected,id,p);
    }
    function record(c,data){if(!active)return;try{
      const e=exportsOf(c),base=e.get_image_base()>>>0,esp=e.get_esp()>>>0,mem=c.ctx.getMemory(),wa=root.memUtils.guestToWasm(esp,e,mem,base),p=pair(c);
      const stackMapped=wa>0xf0&&wa+52<=mem.byteLength&&root.memUtils.guestToWasm(esp+51,e,mem,base)===wa+51;
      const stack=Array.from({length:13},(_,i)=>e.guest_read32(esp+4*i)>>>0),pal=palette(c);
      let paletteSourceMapped=false,paletteSourceHex=null,paletteDestinationHex=null;
      if(stack[0]===base+PLAN.paletteReturnRva){
        const sourceWa=root.memUtils.guestToWasm(stack[5],e,mem,base),dest=pal.dataWa+224*4;
        paletteSourceMapped=sourceWa>0xf0&&sourceWa+32<=mem.byteLength&&root.memUtils.guestToWasm(stack[5]+31,e,mem,base)===sourceWa+31&&dest>0&&dest+32<=mem.byteLength;
        if(paletteSourceMapped){const hex=wa=>Array.from(new Uint8Array(mem,wa,32),x=>x.toString(16).padStart(2,'0')).join('');paletteSourceHex=hex(sourceWa);paletteDestinationHex=hex(dest);}
      }
      events.push({t:performance.now(),context:c.id,contexts:vector(),state:e.guest_read32(base+0x31fd0)>>>0,pause:e.guest_read32(base+0x31c74)>>>0,bypass:e.guest_read32(base+0x17a04)>>>0,software:e.guest_read32(base+0x349c8)>>>0,scrollHold:e.get_dx_scroll_hold_slot()>>>0,exclusiveHwnd:e.get_dx_exclusive_hwnd()>>>0,stackMapped,stack,front:p.front,back:p.back,target:target(c,p),palette:pal,primaryPaletteWa:e.get_dx_primary_pal_wa()>>>0,paletteSourceMapped,paletteSourceHex,paletteDestinationHex,...data});
    }catch(e){errors.push(String(e));}}
    root.createHostImports=function(ctx){const result=original(ctx),c={id:contexts.length,ctx,result};contexts.push(c);
      const dx=result.host.dx_trace;result.host.dx_trace=function(...args){const out=dx(...args);if(active){try{
        if(args[0]===5||args[0]===6){if(selectedSurface(c,0x200000+args[1])||args[1]===pair(c).front.slot)record(c,{kind:args[0]===6?'flip':'present',args:args.map(x=>x>>>0)});}
        if(args[0]===4){const old=start.palettes.find(p=>p.context===c.id);if(args[1]===old?.slot||args[1]===palette(c).slot)record(c,{kind:'palette',args:args.map(x=>x>>>0)});}
        if(args[0]===21||args[0]===22){const old=start.surfaces.find(p=>p.context===c.id),pal=start.palettes.find(p=>p.context===c.id);if(old&&(args[1]===old.front.slot||args[1]===old.back.slot||args[1]===pal?.slot))record(c,{kind:'surface-lifecycle',args:args.map(x=>x>>>0)});}
      }catch(e){errors.push(String(e));}}return out;};
      const upload=result.host.gdi_surface_upload;result.host.gdi_surface_upload=function(id,l,t,r,b){const relevant=active&&selectedSurface(c,id);const ok=upload(id,l,t,r,b);if(active){try{if(relevant||selectedSurface(c,id)){const p=result.gdi.surfacePresentations.get(id);record(c,{kind:'upload',surfaceId:id,rect:[l,t,r,b],ok,bitsWa:p?.bitsWa,paletteWa:p?.paletteWa,directDraw:p?.directDraw});}}catch(e){errors.push(String(e));}}return ok;};
      const remove=result.host.gdi_surface_delete;result.host.gdi_surface_delete=function(id){if(active&&selectedSurface(c,id))record(c,{kind:'surface-delete',surfaceId:id});return remove(id);};
      return result;
    };
    return {contexts,snapshot,arm(wine){
      if(active||wine.guestWorker||wine.threadManager?.backend!=='cooperative')throw Error('only inactive cooperative session qualified');
      const proofs=contexts.map(c=>({context:c.id,...mappedProof(exportsOf(c))}));origins=contexts.map(exportsOf);
      for(const p of proofs)origins[p.context].set_logical_frame(p.address,0);
      armed=true;return proofs;
    },start(){if(!armed||active)throw Error('observer not armed or already active');events=[];errors=[];start=snapshot();active=true;return structuredClone(start);},
    stop(){if(!active)throw Error('not active');const stop=snapshot();active=false;return {contractVersion:PLAN.contractVersion,start:structuredClone(start),stop,events:structuredClone(events),errors:[...errors],enclosure:{internalStart:true,stableOrigins:contexts.length===origins.length}};},
    close(){active=false;root.createHostImports=original;for(const e of origins)e.set_logical_frame(0,0);}};
  }
  const api={PLAN,mappedProof,evaluateWindow,selectsSurface,install};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DxballFrameCounter=api;
})(typeof window==='undefined'?globalThis:window);
