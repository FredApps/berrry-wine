'use strict';
function intersection(a,b){const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h);return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;}
function rect(r){return !!r&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.w>0&&r.h>0;}
function createInspect({renderer,presentation,hwnd,owner,document}) {
 const win=renderer.windows[hwnd],canvas=win?._backCanvas,surface=renderer.surface,ctx=renderer.ctx;
 if(!win||!owner||win.wasm!==owner||presentation.canvas!==canvas||presentation.targetHwnd!==hwnd)throw Error('Unbound owner/window');
 const geometry=()=>JSON.stringify([win.x,win.y,win.w,win.h,win.clientRect,canvas.width,canvas.height,renderer.canvas.width,renderer.canvas.height]);
 const initial=geometry(),receipt={reason:null,visibleClient:null,visibleFraction:null};
 const fail=reason=>{receipt.reason=reason;return false;};
 function inspect(){
  if(document.visibilityState!=='visible')return fail('hidden page');
  if(renderer.windows[hwnd]!==win||win.wasm!==owner||win._backCanvas!==canvas||presentation.canvas!==canvas||presentation.targetHwnd!==hwnd||renderer.surface!==surface||renderer.ctx!==ctx)return fail('identity changed');
  if(renderer._exclusiveFullscreen||renderer._exclusiveTransform||surface.isRaster!==false||surface.ctx!==ctx)return fail('unsupported display path');
  if(!win.visible||win._minimized||win.isChild||win.region||presentation.directDraw)return fail('hidden/minimized/unsupported target');
  if(initial!==geometry()||!rect(win.clientRect))return fail('geometry changed');
  const area=intersection(win.clientRect,{x:0,y:0,w:renderer.canvas.width,h:renderer.canvas.height});
  if(!area)return fail('client outside viewport');receipt.visibleClient=area;receipt.visibleFraction=area.w*area.h/(win.clientRect.w*win.clientRect.h);
  if(win._dxFrameLayer?.canvas||renderer._dropdownOverlayPaintState||renderer._resizeOutline||renderer._animatedRect||renderer._focusCaretRect)return fail('overlay present');
  // Exact pinned comparator: Progman below applications; stable insertion order breaks equal z.
  const tops=Object.values(renderer.windows).filter(w=>w.visible&&!w.isChild&&w.w>0&&w.h>0).sort((a,b)=>{const ad=String(a.className||'').toLowerCase()==='progman',bd=String(b.className||'').toLowerCase()==='progman';return ad!==bd?(ad?-1:1):(a.zOrder||0)-(b.zOrder||0);});
  const i=tops.indexOf(win);if(i<0)return fail('target absent');
  if(tops.slice(i+1).some(w=>rect(w)&&intersection(area,w)))return fail('higher window occlusion');
  if(Object.values(renderer.windows).some(w=>w!==win&&w.visible&&w.isChild&&rect(w)&&intersection(area,w)))return fail('visible child overlap');
  receipt.reason=null;return true;
 }
 return {inspect,receipt};
}
module.exports={createInspect,intersection};
