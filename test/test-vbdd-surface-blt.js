'use strict';
const assert=require('assert/strict'),fs=require('fs');
const extraWat=String.raw`
(func (export "vb_mode") (param $w i32) (param $h i32) (call $dx_display_w_set (local.get $w)) (call $dx_display_h_set (local.get $h)))
(func (export "vb_clipper") (param $obj i32) (result i32) (call $dx_surface_clipper_get (call $dx_from_this (local.get $obj))))
(func (export "vb_factory") (param $out i32) (call $handle_IDirectX7_DirectDrawCreate (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0)))
(func (export "vb_bits") (param $obj i32) (result i32) (load.field DxObject misc1 (call $dx_from_this (local.get $obj))))
(func (export "vb_pitch") (param $obj i32) (result i32) (load.field DxObject pitch (call $dx_from_this (local.get $obj))))
(func (export "vb_refs") (param $obj i32) (result i32) (load.field DxObject refcount (call $dx_from_this (local.get $obj))))
(func (export "vb_vidmem") (result i32) (global.get $dx_vidmem_used))
(func (export "vb_native") (param $owner i32) (param $desc i32) (param $out i32) (call $handle_IDirectDraw_CreateSurface (local.get $owner) (local.get $desc) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0)))
`;
async function run(h,apis,notepad,fixture){
 const e=h.exports,u8=new Uint8Array(h.memory.buffer),v=new DataView(h.memory.buffer);u8.set(notepad,e.get_staging());assert(e.load_pe(notepad.length)>0);e.init_dx_com_thunks();
 const a=n=>e.guest_alloc(n)>>>0,w=(p,x)=>e.guest_write32(p,x),r=p=>e.guest_read32(p)>>>0,zero=(p,n)=>{for(let i=0;i<n;i++)e.guest_write8(p+i,0)};
 const stack=a(256),out=a(12),desc=a(240),status=a(12),rect=a(16);let cases=0;const check=(name,f)=>{f();cases++;console.log('PASS '+name)};
 const call=(o,slot,...args)=>{const thunk=r(r(o)+slot*4),api=apis[r(thunk+4)];assert.equal(r(thunk),0xcaca0010);assert.equal(api.nargs,args.length+1,api.name);w(stack,0);[o,...args].forEach((x,i)=>w(stack+4+i*4,x));const saved=Array.from({length:32},(_,i)=>r(stack+i*4));e.set_esp(stack);e.set_eip(thunk);e.run(1);assert.equal(e.get_eip(),0);assert.equal(e.get_esp()>>>0,stack+(api.nargs+1)*4,api.name+' cleanup');for(let i=0;i<32;i++)assert.equal(r(stack+i*4),saved[i],'original stack untouched');return e.get_eax()>>>0};
 e.vb_factory(out);const owner=r(out);assert(owner);
 const descriptor=(width=128,height=128)=>{zero(desc,240);w(desc,0xaabbccdd);w(desc+236,0xddccbbaa);const d=desc+4;w(d,124);w(d+4,7);w(d+8,height);w(d+12,width);w(d+200,0x840);return d};
 const d=descriptor();let dest;
 check('startup primary flags1/caps200 uses current native display dimensions',()=>{
  e.vb_mode(37,29);zero(d,232);w(d+4,1);w(d+200,0x200);
  assert.equal(call(owner,7,d,out),0,'startup primary request must remain supported');const primary=r(out);assert(primary);
  assert.equal(call(primary,40,d),0);assert.equal(r(d+12),37);assert.equal(r(d+8),29);assert.equal(r(d+104),16);
  assert.equal(call(owner,5,0,out),0);const clipper=r(out);assert.equal(e.vb_refs(clipper),1);
  assert.equal(call(primary,46,clipper),0);assert.equal(e.vb_clipper(primary)>>>0,clipper);assert.equal(e.vb_refs(clipper),2);
  assert.equal(call(primary,46,clipper),0);assert.equal(e.vb_refs(clipper),2);
  const fake=a(8);w(fake,r(clipper));w(fake+4,r(clipper+4));assert.equal(call(primary,46,fake),0x88760082);assert.equal(e.vb_clipper(primary)>>>0,clipper);assert.equal(e.vb_refs(clipper),2);
  assert.equal(call(primary,46,0),0);assert.equal(e.vb_refs(clipper),1);assert.equal(e.vb_clipper(primary),0);
  assert.equal(call(primary,46,clipper),0);assert.equal(call(primary,2),0);assert.equal(e.vb_refs(clipper),1);assert.equal(call(clipper,2),0);
  e.vb_mode(0,0);descriptor();
 });
 check('CreateSurface publishes exact 71-slot VB ABI, not native47 mix',()=>{assert.equal(call(owner,7,d,out),0);dest=r(out);assert(dest);for(let i=0;i<71;i++){const api=apis[r(r(r(dest)+i*4)+4)];assert(api);assert(api.name.startsWith('IVBImageSurface7_'),i+': '+api.name);}assert.equal(apis[r(r(r(dest)+24)+4)].name,'IVBImageSurface7_Blt');assert.equal(e.vb_refs(dest),1);assert.equal(r(desc),0xaabbccdd);assert.equal(r(desc+236),0xddccbbaa);assert.equal(r(d+200),0x840)});
 const table=r(dest),iid=a(16);[0x9f76fde8,0x11d18e92,0xc0000888,0x02c6c24f].forEach((x,i)=>w(iid+i*4,x));
 check('fresh created surface QI/GetSurfaceDesc/refcount share image identity',()=>{assert.equal(call(dest,0,iid,out),0);assert.equal(r(out),dest);assert.equal(e.vb_refs(dest),2);assert.equal(call(dest,2),1);assert.equal(call(dest,40,d),0);assert.equal(r(d+8),128);assert.equal(r(d+12),128);assert.equal(r(d+104),16);assert.equal(r(dest),table)});
 const text='C:\\blt.bmp',b=a(text.length*2+6);w(b,text.length*2);for(let i=0;i<text.length;i++)e.guest_write16(b+4+i*2,text.charCodeAt(i));e.guest_write16(b+4+text.length*2,0);h.hostCtx.vfs.files.set(text.toLowerCase(),{data:new Uint8Array(fixture),attrs:0x20});descriptor();w(d+4,0);assert.equal(call(owner,8,b+4,d,out),0);const src=r(out);assert.equal(r(src),table);const sb=e.vb_bits(src)>>>0,db=e.vb_bits(dest)>>>0,sp=e.vb_pitch(src),dp=e.vb_pitch(dest);
 const snapshot=p=>Buffer.from(u8.slice(p,p+128*256));
 check('actual image-to-created-surface full copy; COM result and drawing status separate',()=>{u8.fill(0,db,db+dp*128);w(status,0x12345678);w(status+4,0xdeadbeef);w(status+8,0x87654321);assert.equal(call(dest,6,0,src,0,0x01000000,status+4),0);assert.equal(r(status+4),0);for(let y=0;y<128;y++)assert.deepEqual(u8.slice(db+y*dp,db+y*dp+256),u8.slice(sb+y*sp,sb+y*sp+256));assert.equal(r(status),0x12345678);assert.equal(r(status+8),0x87654321)});
 check('zero RECT is full extent and nonzero RECT retains left/top/right/bottom',()=>{zero(rect,16);u8.fill(0,db,db+dp*128);assert.equal(call(dest,6,rect,src,rect,0,status+4),0);assert.equal(r(status+4),0);assert.equal(v.getUint16(db+47*dp+62,true),v.getUint16(sb+47*sp+62,true));[4,5,7,9].forEach((x,i)=>w(rect+i*4,x));u8.fill(0,db,db+dp*128);assert.equal(call(dest,6,rect,src,rect,0,status+4),0);assert.equal(r(status+4),0);for(let y=0;y<128;y++)for(let x=0;x<128;x++)assert.equal(v.getUint16(db+y*dp+x*2,true),x>=4&&x<7&&y>=5&&y<9?v.getUint16(sb+y*sp+x*2,true):0)});
 check('unsupported FX flags do not dereference statusOut as FX or draw',()=>{const before=snapshot(db);assert.equal(call(dest,6,0,src,0,0x400,status+4),0);assert.equal(r(status+4),0x80004001);assert.deepEqual(snapshot(db),before);assert.equal(r(status+8),0x87654321)});
 check('invalid source and output return COM failure without drawing or status write',()=>{const before=snapshot(db);w(status+4,0xabcdef01);assert.equal(call(dest,6,0,0,0,0,status+4),0x80070057);assert.equal(r(status+4),0xabcdef01);assert.equal(call(dest,6,0,src,0,0,0),0x80004003);assert.deepEqual(snapshot(db),before)});
 const base=0x39000000,neighbor=base+0x10000;for(const p of [base,neighbor,base+4096])e.test_virtual_map_commit(p,4096);assert.notEqual(e.guest_to_wasm(base)+4096,e.guest_to_wasm(base+4096));for(let i=0;i<256;i++)e.guest_write8(neighbor+i,0xa7);const split=base+4091;
 check('sparse cross-page RECT and status preserve unrelated backing',()=>{[1,2,5,6].forEach((x,i)=>w(split+i*4,x));assert.equal(call(dest,6,split,src,split,0,status+4),0);assert.equal(r(status+4),0);assert.equal(call(dest,6,0,src,0,0,base+4095),0);assert.equal(r(base+4095),0);for(let i=0;i<256;i++)assert.equal(e.guest_read8(neighbor+i),0xa7)});
 check('sparse 232-byte creation descriptor returns same VB identity',()=>{descriptor(11,7);for(let i=0;i<232;i++)e.guest_write8(split+i,e.guest_read8(d+i));assert.equal(call(owner,7,split,out),0);const o=r(out);assert.equal(r(o),table);assert.equal(call(o,40,d),0);assert.equal(r(d+12),11);assert.equal(r(d+8),7);assert.equal(call(o,2),0);for(let i=0;i<256;i++)assert.equal(e.guest_read8(neighbor+i),0xa7)});
 check('unsupported CreateSurface chain/foreign bits never publishes',()=>{for(const [off,value] of [[200,8],[36,123],[4,15],[12,0],[8,0x80000000]]){descriptor();w(d+off,value);w(out,0xdeadbeef);const used=e.vb_vidmem();assert.equal(call(owner,7,d,out),0x80004001);assert.equal(r(out),0);assert.equal(e.vb_vidmem(),used)}});
 check('native surface remains unchanged and is not silently cast to VB source',()=>{const nd=a(124);zero(nd,124);w(nd,124);w(nd+4,7);w(nd+8,4);w(nd+12,4);w(nd+104,0x840);e.vb_native(owner,nd,out);const native=r(out),nt=r(native);assert.notEqual(nt,table);assert.equal(call(dest,6,0,native,0,0,status+4),0x80070057);assert.equal(r(native),nt);assert.equal(call(native,2),0)});
 check('other unimplemented VB methods retain real-thunk E_NOTIMPL/stack ABI',()=>{for(let i=0;i<71;i++){const api=apis[r(r(table+i*4)+4)];if(api.stub)assert.equal(call(dest,i,...Array(api.nargs-1).fill(0)),0x80004001,api.name)}});
 check('created and image lifetime release independently to zero',()=>{assert.equal(e.vb_refs(src),1);assert.equal(e.vb_refs(dest),1);assert.equal(call(src,2),0);assert.equal(call(dest,2),0)});
 return {cases,limits:['no gameplay qualification','bounded offscreen same-format copy/WAIT only','no broad native DirectDraw or VB drawing support claim']};
}
const {bootRenderHarness}=require('./render-helper');
(async()=>{const h=await bootRenderHarness({extraWat,fonts:'none'});console.log(JSON.stringify({status:'PASS',...await run(h,require('../src/api_table.json'),fs.readFileSync(__dirname+'/binaries/notepad.exe'),fs.readFileSync(__dirname+'/fixtures/vbdd-image-helpers/asymmetric.bmp'))}));})().catch(e=>{console.error(e);process.exitCode=1;});
