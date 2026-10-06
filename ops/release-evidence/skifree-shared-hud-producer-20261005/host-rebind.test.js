'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHostImports}=require('./source/lib/host-imports');
const {readSharedHud}=require('./shared-hud-metadata');
test('actual pinned host identical-bind refresh uses equivalent full byte view; passive proof stable',()=>{
 const buffer=new ArrayBuffer(65536),memory={buffer},v=new DataView(buffer),regions={GDI_WINDOW_SURFACE_TABLE:{base:256,size:8192},GDI_WINDOW_SURFACE_HWM:{base:128}};
 v.setUint32(128,1,true);[1,0x610001,20,10,10000,80].forEach((x,i)=>v.setUint32(256+i*4,x,true));
 const exports={wnd_get_style_export:h=>h===2?0x50000000:0x10000000,wnd_get_parent:h=>h===2?1:0},owner={exports};
 const {host,gdi}=createHostImports({getMemory:()=>buffer,exports:{}});
 const args=[0x610001,20,10,32,10000,80,1,0,0,0,0,0];assert.equal(host.gdi_surface_create(...args),1);
 const p=gdi.surfacePresentations.get(0x610001);p.targetHwnd=1; // Fixture attachment only; real create/rebind code unmodified.
 const read=()=>readSharedHud({exports,owner,memory,buffer,regions,root:1,child:2,presentation:p});
 const before=read(),surface=p.surface,canvas=p.canvas,view=p.surface.storage,version=p.version;
 assert.equal(host.gdi_surface_create(...args),1);assert.equal(gdi.surfacePresentations.get(0x610001),p);assert.equal(p.surface,surface);assert.equal(p.canvas,canvas);assert.notEqual(p.surface.storage,view);assert.equal(p.version,version+1);assert.deepEqual(read(),before);
 for(const storage of [new Uint8Array(new ArrayBuffer(65536)),new Uint8Array(buffer,1),new Uint8Array(buffer,0,32000)]){p.surface.storage=storage;assert.throws(read,/identity/);}
});
