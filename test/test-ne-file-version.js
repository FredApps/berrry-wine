#!/usr/bin/env node
'use strict';
// Actual NE imports and Win16 far-call ABI against real VFS file bytes.
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {createHostImports}=require('../lib/host-imports');
const {buildVersionBlob,buildVersionPe}=require('../tools/pe-version');
const {neFixture}=require('./test-win16-module-query');
const {GUEST_BASE}=require('../lib/region-map.generated');
const {compileSrcWasm}=require('./compile-src');
const wideQueryExport='\n(func (export "ne_query_w") (param $b i32) (param $p i32) (param $o i32) (param $l i32) (result i32) (call $version_query (local.get $b) (local.get $p) (local.get $o) (local.get $l) (i32.const 1)))\n(func (export "ne_size_a") (param $f i32) (param $h i32) (result i32) (local $esp i32) (local.set $esp (i32.load offset=16 (global.get $reg_base))) (call $handle_GetFileVersionInfoSizeA (local.get $f) (local.get $h) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)) (i32.store offset=16 (global.get $reg_base) (local.get $esp)) (i32.load (global.get $reg_base)))\n';
function ansiNode(key,value=Buffer.alloc(0),children=[]){const k=Buffer.from(key+'\0'),start=(4+k.length+3)&~3;let len=start+value.length;const parts=[];for(const child of children){const at=(len+3)&~3;parts.push([at,child]);len=at+child.length;}const b=Buffer.alloc(len);b.writeUInt16LE(len,0);b.writeUInt16LE(value.length,2);k.copy(b,4);value.copy(b,start);for(const [at,c]of parts)c.copy(b,at);return b;}
function neFile(blob){const b=Buffer.alloc(0x200+((blob.length+15)&~15));b.write('MZ');b.writeUInt32LE(0x40,60);b.write('NE',0x40);b.writeUInt16LE(0x40,0x64);b.writeUInt16LE(0x60,0x66);b.writeUInt16LE(4,0x80);b.writeUInt16LE(0x8010,0x82);b.writeUInt16LE(1,0x84);b.writeUInt16LE(0x20,0x8a);b.writeUInt16LE((blob.length+15)>>4,0x8c);b.writeUInt16LE(0x8001,0x90);blob.copy(b,0x200);return b;}
function caller(){const b=neFixture('VERQUERY'),stops={};b[0x130]=3;b.write('VER',0x131);b.fill(0,0x400,0x480);const code=[];const w=n=>code.push(n&255,n>>>8&255),push=n=>{code.push(0x68);w(n);},far=off=>{code.push(0x1e);push(off);};const emit=(start,ordinal,make)=>{code.length=0;make();const site=start+code.length+1;code.push(0x9a,255,255,0,0,0xa3,0,2,0x89,0x16,2,2,0xeb,0xfe);b.set(code,0x400+start);stops[ordinal]=start+code.length-2;return site;};
const sites=[emit(0,6,()=>{far(0x100);far(0x220);}),emit(0x20,7,()=>{far(0x100);code.push(0x66,0x6a,0);code.push(0x66,0xff,0x36,0x24,2);far(0x400);}),emit(0x50,11,()=>{far(0x400);far(0x280);far(0x240);far(0x244);})];b.writeUInt16LE(3,0x480);sites.forEach((site,i)=>{let p=0x482+i*8;b[p]=3;b[p+1]=1;b.writeUInt16LE(site,p+2);b.writeUInt16LE(1,p+4);b.writeUInt16LE([6,7,11][i],p+6);});return{b,stops};}
async function main(){
const module=await WebAssembly.compile(process.argv[2] ? fs.readFileSync(process.argv[2]) : compileSrcWasm((file, source) => file === '13-exports.wat' ? source + wideQueryExport : source)),memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true}),ctx={getMemory:()=>memory.buffer,renderer:null,resourceJson:{}},imports=createHostImports(ctx);imports.host.memory=memory;
const e=(await WebAssembly.instantiate(module,imports)).exports;ctx.exports=e;const u=new Uint8Array(memory.buffer),dv=new DataView(memory.buffer),fixture=caller();u.set(fixture.b,e.get_staging());assert.ok(e.load_ne(fixture.b.length)>=0);const code=e.win16_seg_base(1),data=e.win16_seg_base(2)+GUEST_BASE;
const fixed=Buffer.alloc(52);fixed.writeUInt32LE(0xfeef04bd);fixed.writeUInt32LE(0x10000,4);fixed.writeUInt32LE(0x30003,8);
const translation=Buffer.from([9,4,0xe4,4]);const blob=ansiNode('VS_VERSION_INFO',fixed,[ansiNode('StringFileInfo',Buffer.alloc(0),[ansiNode('040904E4',Buffer.alloc(0),[ansiNode('FileVersion',Buffer.from('3.3.0.0\0'))])]),ansiNode('VarFileInfo',Buffer.alloc(0),[ansiNode('Translation',translation)])]);
function mount(name,bytes){ctx.vfs.files.set('c:\\'+name,{data:new Uint8Array(bytes),attrs:0x20});}const image=neFile(blob);mount('version.exe',image);
function invoke(ord){e.clear_bp();e.set_eip(code+({6:0,7:0x20,11:0x50}[ord]));e.set_bp(code+fixture.stops[ord]);e.run(2000);assert.equal(e.get_eip()>>>0,code+fixture.stops[ord],'actual VER return block '+ord);return dv.getUint16(data+0x200,true)|(dv.getUint16(data+0x202,true)<<16);}
function filename(name){u.fill(0,data+0x100,data+0x200);u.set(Buffer.from('C:\\'+name+'\0'),data+0x100);}function query(sub){u.fill(0,data+0x280,data+0x380);u.set(Buffer.from(sub+'\0'),data+0x280);dv.setUint32(data+0x240,0,true);dv.setUint16(data+0x244,0xffff,true);const ok=invoke(11)&65535;return{ok,off:dv.getUint16(data+0x240,true),sel:dv.getUint16(data+0x242,true),length:dv.getUint16(data+0x244,true)};}
filename('version.exe');dv.setUint32(data+0x220,0xdeadbeef,true);assert.equal(invoke(6)>>>0,image.length-0x200,'NE file-backed VER6 must report resource size');assert.equal(dv.getUint32(data+0x220,true),0,'obsolete handle zeroed');
function copy(cap){dv.setUint32(data+0x224,cap,true);u.fill(0xa5,data+0x400,data+0xc00);assert.equal(invoke(7)&65535,1);assert.equal(u[data+0x400+cap],0xa5,'copy bound');}
copy(blob.length);assert.deepEqual(Buffer.from(u.subarray(data+0x400,data+0x400+blob.length)),blob,'original ANSI resource unchanged');let q=query('\\');assert.equal(q.ok,1);assert.equal(q.off,0x414);assert.equal(q.sel,(e.win16_auto_data()<<3)|7);assert.equal(q.length,52);assert.equal(dv.getUint32(data+q.off+8,true),0x30003);
q=query('\\StringFileInfo\\040904E4\\FileVersion');assert.equal(q.ok,1);assert.equal(q.length,8);assert.equal(Buffer.from(u.subarray(data+q.off,data+q.off+q.length)).toString(),'3.3.0.0\0');q=query('\\VarFileInfo\\Translation');assert.equal(q.ok,1);assert.equal(q.length,4);assert.deepEqual(Buffer.from(u.subarray(data+q.off,data+q.off+4)),translation);assert.equal(query('\\StringFileInfo\\040904E4\\Missing').ok,0);
// Query rejection is separate from file-range validation.
copy(blob.length);dv.setUint16(data+0x402,0xffff,true);assert.equal(query('\\').ok,0,'oversized ANSI value rejected');
copy(blob.length);dv.setUint16(data+0x400,19,true);assert.equal(query('\\').ok,0,'truncated root rejected');
if(e.ne_query_w){copy(blob.length);const text='\\StringFileInfo\\040904E4\\FileVersion';u.set(Buffer.from(text+'\0','utf16le'),data+0x280);const guestData=data-GUEST_BASE;assert.equal(e.ne_query_w(guestData+0x400,guestData+0x280,guestData+0x240,guestData+0x244),1);const ptr=dv.getUint32(data+0x240,true),len=dv.getUint32(data+0x244,true);assert.equal(len,8);const bytes=Array.from({length:len*2},(_,i)=>e.guest_read8(ptr+i));assert.equal(Buffer.from(bytes).toString('utf16le'),'3.3.0.0\0');}
copy(13);assert.deepEqual(Buffer.from(u.subarray(data+0x400,data+0x40d)),blob.subarray(0,13));copy(0);
// ANSI reports bytes, including bytes after an embedded NUL; only the wide
// conversion reports characters through NUL. Values have independent slots.
const strings=ansiNode('VS_VERSION_INFO',fixed,[ansiNode('StringFileInfo',Buffer.alloc(0),[
  ansiNode('040904E4',Buffer.alloc(0),[
    ansiNode('FileVersion',Buffer.from([0x80,0,0x58,0x59])),
    ansiNode('CompanyName',Buffer.from('Sierra\0')),
    ansiNode('Empty',Buffer.alloc(0)),
  ]),
])]);
mount('strings.exe',neFile(strings));filename('strings.exe');copy(strings.length);
q=query('\\StringFileInfo\\040904E4\\FileVersion');assert.equal(q.ok,1);assert.equal(q.length,4);
assert.deepEqual(Buffer.from(u.subarray(data+q.off,data+q.off+4)),Buffer.from([0x80,0,0x58,0x59]));
if(e.ne_query_w){
  const guestData=data-GUEST_BASE;
  function wideQuery(key){u.fill(0,data+0x280,data+0x380);u.set(Buffer.from('\\StringFileInfo\\040904E4\\'+key+'\0','utf16le'),data+0x280);assert.equal(e.ne_query_w(guestData+0x400,guestData+0x280,guestData+0x240,guestData+0x244),1);return{ptr:dv.getUint32(data+0x240,true),len:dv.getUint32(data+0x244,true)};}
  assert.equal(e.ne_size_a(guestData+0x100,guestData+0x220),strings.length*3,'Win32 reserves caller-owned wide trailer');
  const first=wideQuery('FileVersion');assert.equal(first.len,2);assert.equal((e.guest_read8(first.ptr)|(e.guest_read8(first.ptr+1)<<8)),0x20ac);
  const second=wideQuery('CompanyName');assert.equal(second.len,7);assert.notEqual(first.ptr,second.ptr);
  assert.equal((e.guest_read8(first.ptr)|(e.guest_read8(first.ptr+1)<<8)),0x20ac,'later query retains earlier answer within block');
  assert.equal(wideQuery('Empty').len,0);
  assert.ok(first.ptr >= guestData+0x400+strings.length);
  u.set(strings,data+0x900);u[data+0x900+q.off-0x400]=0x41;
  u.set(Buffer.from('\\StringFileInfo\\040904E4\\FileVersion\0','utf16le'),data+0x280);
  assert.equal(e.ne_query_w(guestData+0x900,guestData+0x280,guestData+0x240,guestData+0x244),1);
  assert.equal((e.guest_read8(dv.getUint32(data+0x240,true))|(e.guest_read8(dv.getUint32(data+0x240,true)+1)<<8)),0x41);
  assert.equal((e.guest_read8(first.ptr)|(e.guest_read8(first.ptr+1)<<8)),0x20ac,'another block cannot overwrite retained conversion');
}
// Corrupt table ranges/counts must fail without allocating a giant shifted blob.
for(const [name,change]of [['shift',b=>b.writeUInt16LE(32,0x80)],['overflow',b=>{b.writeUInt16LE(31,0x80);b.writeUInt16LE(65535,0x8a);}],['count',b=>b.writeUInt16LE(65535,0x84)],['range',b=>b.writeUInt16LE(65535,0x8c)],['table',b=>b.writeUInt16LE(0x41,0x66)],['missing',b=>b.writeUInt16LE(0x8005,0x82)]]){const b=Buffer.from(image);change(b);mount(name+'.exe',b);filename(name+'.exe');assert.equal(invoke(6),0,name+' rejected');assert.equal(invoke(7),0,name+' copy fails');}
filename('absent.exe');assert.equal(invoke(6),0);assert.equal(invoke(7),0);
// Same ABI must keep PE VERSION lookup/query working.
const peBlob=buildVersionBlob([0xfeef04bd,0x10000,0x50006,0x70008,0x9000a,0xb000c]);mount('pe.dll',buildVersionPe(peBlob));filename('pe.dll');assert.equal(invoke(6),peBlob.length);copy(peBlob.length);q=query('\\');assert.equal(q.ok,1);assert.equal(dv.getUint32(data+q.off+8,true),0x50006);
if(process.argv[3]){const original=fs.readFileSync(process.argv[3]);assert.equal(crypto.createHash('sha256').update(original).digest('hex'),'a11e70704b15c12424e771a1b7c331396f69644d7cb1f53a7a5b3999f9309bb4');mount('original.exe',original);filename('original.exe');assert.equal(invoke(6),432);copy(432);assert.deepEqual(Buffer.from(u.subarray(data+0x400,data+0x5b0)),original.subarray(417648,418080));q=query('\\');assert.equal(q.ok,1);assert.equal(q.off,0x414);assert.equal(dv.getUint32(data+q.off+8,true),0x30003);}
assert.ok([...ctx.vfs.handles.values()].every(handle => handle.closed),'all version-reader file handles closed (tombstones retained)');
console.log('PASS actual NE VER6/7/11: ANSI original bytes, bounded copies, root/text/translation queries, malformed ranges, PE controls');}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});module.exports={ansiNode,neFile,caller,wideQueryExport};
