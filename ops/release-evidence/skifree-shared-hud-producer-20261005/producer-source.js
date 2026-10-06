'use strict';
// Serialized CPU lease required: this compiles the exact pinned WAT closure.
// Guest-state setup below is synthetic fixture setup, NEVER browser observation.
const assert = require('node:assert/strict');
const path = require('node:path');
const source = path.join(__dirname, 'source');
const {bootRenderHarness} = require(path.join(source, 'test/render-helper'));
const Regions = require(path.join(source, 'lib/region-map.generated'));
async function main() {
  if (!process.argv.includes('--cpu-slot-granted')) throw Error('Explicit CPU lease required');
  const h = await bootRenderHarness({width:320,height:200,fonts:'none'});
  const {exports:e,renderer:r,memory,gdi,instance} = h;
  const root = {hwnd:65537,x:10,y:10,w:200,h:140,visible:true,isChild:false,style:0x10000000,
    clientRect:{x:13,y:15,w:194,h:132},wasm:instance,wasmMemory:memory};
  const child = {hwnd:65538,x:100,y:0,w:80,h:30,visible:true,isChild:true,parentHwnd:root.hwnd,style:0x50000000,
    clientRect:{x:113,y:15,w:80,h:30},wasm:instance,wasmMemory:memory};
  r.windows[root.hwnd]=root;r.windows[child.hwnd]=child;
  for (const w of [root,child]) {
    e.wnd_table_set(w.hwnd,0);e.ctrl_set_geom(w.hwnd,w.x,w.y,w.w,w.h);
    e.wnd_set_style_export(w.hwnd,w.style);
  }
  e.test_wnd_set_parent(child.hwnd,root.hwnd);
  e.test_gdi_client_rect_set(root.hwnd,3,5,197,137);
  e.test_gdi_client_rect_set(child.hwnd,0,0,80,30);
  const desc=Regions.BASE.GDI_LINE_DESC,dv=new DataView(memory.buffer);
  const descriptor=hdc=>{
    assert.equal(e.test_gdi_surface_descriptor(hdc,desc),1);
    return {bits:dv.getUint32(desc,true),id:dv.getUint32(desc+68,true),
      x:dv.getInt32(desc+72,true),y:dv.getInt32(desc+76,true)};
  };
  const rootDC=e.test_call_GetDC(root.hwnd),childDC=e.test_call_GetDC(child.hwnd);
  assert(rootDC&&childDC);
  const a=descriptor(rootDC),b=descriptor(childDC);
  assert.equal(b.id,a.id,'actual child GetDC descriptor must name root surface');
  assert.equal(b.bits,a.bits,'actual child descriptor must share root pixel backing');
  assert.deepEqual([a.x,a.y,b.x,b.y],[3,5,103,5],'actual child offset includes parent client origin');
  const p=gdi.surfacePresentations.get(a.id);assert(p);assert.equal(p.targetHwnd,root.hwnd);
  r._flushCanonicalCanvas(p.canvas);const before=p.flushCount,version=p.version;
  assert.equal(e.test_call_SetPixel(childDC,2,3,0x000000ff)>>>0,0x000000ff);
  assert(p.version>version,'actual WAT raster must invoke canonical host upload');
  r._flushCanonicalCanvas(p.canvas);
  assert.equal(p.flushCount,before+1,'child write advances root canonical generation once');
  const pixel=p.canvas.getContext('2d').getImageData(105,8,1,1).data;
  assert.deepEqual([...pixel],[255,0,0,255]);
  assert.equal(child._backCanvas,undefined,'no private child backing manufactured');
  let childDraws=0;const draw=r._drawImageClipped;
  r._drawImageClipped=function(...args){childDraws++;return draw.apply(this,args);};
  try { r._compositeChildSurfaces(root); } finally { r._drawImageClipped=draw; }
  assert.equal(childDraws,0,'real non-own child compositor emits no separate layer');
  // An owned popup has a parent link but no WS_CHILD; it must NOT alias root.
  e.wnd_set_style_export(child.hwnd,0x10000000);child.isChild=false;child.style=0x10000000;
  assert.notEqual(descriptor(childDC).id,a.id,'style-negative control must resolve separate backing');
  console.log(JSON.stringify({passed:true,root:a,child:b,flushBefore:before,flushAfter:p.flushCount,
    limitation:'Synchronous actual host upload/flush; existing JS suite separately covers Worker broker and CanvasSurface. No browser measurement.'}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
