'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readSharedHud}=require('./shared-hud-metadata');
function fixture(){
 const buffer=new ArrayBuffer(32768),v=new DataView(buffer),regions={GDI_WINDOW_SURFACE_TABLE:{base:256,size:8192},GDI_WINDOW_SURFACE_HWM:{base:128}};
 v.setUint32(128,1,true);[1,99,20,10,10000,80].forEach((x,i)=>v.setUint32(256+i*4,x,true));
 const styles={1:0x10000000,2:0x50000000},parents={1:0,2:1};
 const exports={wnd_get_style_export:h=>styles[h],wnd_get_parent:h=>parents[h]};
 return {buffer,memory:{buffer},owner:{exports},regions,root:1,child:2,exports,presentation:{id:99,targetHwnd:1,bitsWa:10000,byteLength:800,canvas:{width:20,height:10},surface:{storage:new Uint8Array(buffer),storageOffset:10000,stride:80,bpp:32,topDown:true}},v,styles,parents};
}
test('bounded native metadata matches shared HUD and performs no memory writes',()=>{const f=fixture(),before=Buffer.from(f.buffer);assert.equal(readSharedHud(f).record.id,99);assert.deepEqual(Buffer.from(f.buffer),before);});
for(const [label,mutate]of Object.entries({popup:f=>f.styles[2]=0x10000000,foreignParent:f=>f.parents[2]=3,cycle:f=>f.parents[2]=2,separateSurface:f=>{f.v.setUint32(128,2,true);f.v.setUint32(288,2,true);},badGenerationBinding:f=>f.presentation.id=98,overflow:f=>f.v.setUint32(272,0xfffffff0,true),countCap:f=>f.v.setUint32(128,257,true)}))test('reject '+label,()=>{const f=fixture();mutate(f);assert.throws(()=>readSharedHud(f));});
test('unstable native style rejects rather than certifies snapshot',()=>{const f=fixture();let n=0;f.exports.wnd_get_style_export=h=>h===2?(++n===1?0x50000000:0x50000001):0x10000000;assert.throws(()=>readSharedHud(f),/Unstable/);});

test('foreign owner or canonical memory cannot authenticate backing',()=>{for(const mutate of[f=>f.owner={exports:{}},f=>f.memory={buffer:new ArrayBuffer(32768)},f=>f.presentation.surface.storage=new Uint8Array(32768),f=>f.presentation.bitsWa++]){const f=fixture();mutate(f);assert.throws(()=>readSharedHud(f));}});
test('fresh equivalent full Uint8Array is accepted, offset/truncation/wrong type rejected',()=>{
 const f=fixture(),proof=readSharedHud(f);f.presentation.surface.storage=new Uint8Array(f.buffer);assert.deepEqual(readSharedHud(f),proof);
 for(const view of[new Uint8Array(f.buffer,1),new Uint8Array(f.buffer,0,32000),new Uint8ClampedArray(f.buffer)]){f.presentation.surface.storage=view;assert.throws(()=>readSharedHud(f),/identity/);}
});
