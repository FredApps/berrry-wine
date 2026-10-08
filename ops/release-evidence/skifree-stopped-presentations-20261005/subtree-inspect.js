'use strict';
const {intersection}=require('./inspect');
const {readSharedHud}=require('./shared-hud-metadata');
const PINNED_REGIONS=require('./surface-regions');
function prepare({wine,hwnd,document,regions=PINNED_REGIONS}) {
 const renderer=wine.renderer,root=renderer?.windows[hwnd],owner=root?.wasm;
 if(!wine.running||!root||!owner||root.isChild)throw Error('Missing exact root owner');
 const surface=renderer.surface,ctx=renderer.ctx,registry=wine._mainImports?.gdi?.surfacePresentations;
 if(!(registry instanceof Map)||registry.size>64)throw Error('Missing canonical registry');
 const finiteRect=r=>r&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.w>0&&r.h>0;
 function origin(w){const e=w.wasm?.exports;if(typeof e?.wnd_window_screen_x!=='function'||typeof e?.wnd_window_screen_y!=='function')throw Error('No proven screen-coordinate getters');const x=e.wnd_window_screen_x(w.hwnd),y=e.wnd_window_screen_y(w.hwnd);if(!Number.isInteger(x)||!Number.isInteger(y))throw Error('Invalid screen coordinates');return{x,y,w:w.w,h:w.h};}
 function describe(){
  const all=Object.values(renderer.windows),members=[],seen=new Set();if(all.length>32)throw Error('Window cap');
  function visit(w,depth){if(depth>4||seen.has(w.hwnd)||members.length>=8)throw Error('Subtree bounds/cycle');seen.add(w.hwnd);if(w.wasm!==owner||!w.visible||w._minimized||w.region||w._parentSnapshot||w._dxFrameLayer?.canvas||w._gpuFrameLayer?.canvas)throw Error('Unsupported subtree member');members.push(w);for(const child of all.filter(c=>c.parentHwnd===w.hwnd&&c.visible).sort((a,b)=>(a.zOrder||0)-(b.zOrder||0)))visit(child,depth+1);}
  visit(root,0);
  const viewport={x:0,y:0,w:renderer.canvas.width,h:renderer.canvas.height},rootRect=origin(root);
  if(!finiteRect(root.clientRect))throw Error('Missing client geometry');
  const visibleClient=intersection(root.clientRect,viewport);if(!visibleClient)throw Error('Root client invisible');
  const layers=[],states=[];
  for(const w of members){const own=w===root||w._canonicalOwnSurface===true,rect=origin(w);if(!finiteRect(rect))throw Error('Invalid member geometry');
   if(w!==root&&(!w.isChild||!seen.has(w.parentHwnd)))throw Error('Unproved parent link');
   let nativeBacking=null;
   if(!own){
    if(w._backCanvas||w.wasmMemory!==root.wasmMemory)throw Error('Unsupported non-own child canvas/memory');
    const rootMatches=[...registry.values()].filter(p=>p.targetHwnd===root.hwnd&&p.canvas===root._backCanvas&&!p.directDraw);
    if(rootMatches.length!==1)throw Error('Ambiguous shared root presentation');
    nativeBacking=readSharedHud({exports:owner.exports,owner,memory:root.wasmMemory,buffer:root.wasmMemory?.buffer,regions,root:root.hwnd,child:w.hwnd,presentation:rootMatches[0]});
    for(const n of nativeBacking.chain){const js=renderer.windows[n.hwnd];if(!js||js.wasm!==owner||(js.parentHwnd||0)!==n.parent||!!js.isChild!==!!(n.style&0x40000000))throw Error('Native/renderer parent-style mismatch');}
   }
   states.push({hwnd:w.hwnd,parentHwnd:w.parentHwnd||0,own,nativeBacking,isChild:!!w.isChild,drawsIntoParent:!!w._drawsIntoParent,z:w.zOrder||0,rect,client:w.clientRect||null,canvasWidth:w._backCanvas?.width||0,canvasHeight:w._backCanvas?.height||0});
   if(!own)continue;
   const canvas=w._backCanvas,matches=[...registry.values()].filter(p=>p.targetHwnd===w.hwnd&&p.canvas===canvas);
   if(!canvas||matches.length!==1||matches[0].directDraw)throw Error('Ambiguous/unsupported canonical layer');
   const p=matches[0];if(!Number.isSafeInteger(p.flushCount)||p.flushCount<0)throw Error('Invalid generation');
   const clip=w===root?viewport:rootRect,visible=intersection(intersection(rect,clip)||{x:0,y:0,w:0,h:0},viewport);
   if(!visible)throw Error('Invisible own layer');
   layers.push({hwnd:w.hwnd,win:w,p,canvas,rect,clip,visible,root:w===root});
  }
  if(new Set(layers.map(l=>l.canvas)).size!==layers.length)throw Error('Aliased layer canvases');
  return {members,layers,states,visibleClient,visibleFraction:visibleClient.w*visibleClient.h/(root.clientRect.w*root.clientRect.h)};
 }
 let identities;
 const viewportSize=[renderer.canvas.width,renderer.canvas.height];
 const initial=describe(),signature=JSON.stringify(initial.states),receipt={reason:null,visibleClient:initial.visibleClient,visibleFraction:initial.visibleFraction,sharedHudAttribution:initial.states.some(s=>!s.own)?'Shared HUD updates coalesce with root; HUD-only count cannot distinguish them.':'Separate canonical layers',layers:initial.layers.map(l=>({hwnd:l.hwnd,rect:l.rect,clip:l.clip,visible:l.visible,root:l.root})),members:initial.states};
 identities={members:initial.members.map(w=>({w,memory:w.wasmMemory,buffer:w.wasmMemory?.buffer,exports:w.wasm?.exports})),layers:initial.layers.map(l=>({p:l.p,surface:l.p.surface,buffer:l.p.surface?.storage?.buffer,byteOffset:l.p.surface?.storage?.byteOffset,byteLength:l.p.surface?.storage?.byteLength}))};
 function inspect(){try{
  for(const x of identities.members)if(x.w.wasmMemory!==x.memory||x.w.wasmMemory?.buffer!==x.buffer||x.w.wasm?.exports!==x.exports)throw Error('Native owner memory/exports replaced');
  for(const x of identities.layers)if(x.p.surface!==x.surface||x.p.surface?.storage?.buffer!==x.buffer||x.p.surface?.storage?.byteOffset!==x.byteOffset||x.p.surface?.storage?.byteLength!==x.byteLength)throw Error('Canonical storage replaced');
  if(renderer.canvas.width!==viewportSize[0]||renderer.canvas.height!==viewportSize[1])throw Error('Viewport changed');
  if(!wine.running||wine.renderer!==renderer||renderer.surface!==surface||renderer.ctx!==ctx||surface.isRaster!==false||surface.ctx!==ctx||document.visibilityState!=='visible')throw Error('Owner/surface/page changed');
  if(renderer._exclusiveFullscreen||renderer._exclusiveTransform||renderer._dropdownOverlayPaintState||renderer._resizeOutline||renderer._animatedRect||renderer._focusCaretRect)throw Error('Unsupported overlay/display');
  const now=describe();if(JSON.stringify(now.states)!==signature||now.members.some((w,i)=>w!==initial.members[i])||now.layers.some((l,i)=>l.p!==initial.layers[i]?.p||l.canvas!==initial.layers[i]?.canvas||registry.get(l.p.id)!==l.p))throw Error('Topology/geometry/layer replaced');
  const tops=Object.values(renderer.windows).filter(w=>w.visible&&!w.isChild).sort((a,b)=>{const x=String(a.className||'').toLowerCase()==='progman',y=String(b.className||'').toLowerCase()==='progman';return x!==y?(x?-1:1):(a.zOrder||0)-(b.zOrder||0);});
  const at=tops.indexOf(root);if(at<0)throw Error('Root absent');
  for(const w of tops.slice(at+1))if(initial.layers.some(l=>intersection(origin(w),l.visible)))throw Error('Foreign higher occlusion');
  for(const w of Object.values(renderer.windows))if(w.visible&&w.isChild&&!initial.members.includes(w)&&initial.layers.some(l=>intersection(origin(w),l.visible)))throw Error('Foreign child occlusion');
  receipt.reason=null;return true;
 }catch(e){receipt.reason=String(e.message||e);return false;}}
 if(!inspect())throw Error(receipt.reason);
 return {renderer,layers:initial.layers,inspect,receipt};
}
module.exports={prepare};
