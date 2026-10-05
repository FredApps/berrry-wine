'use strict';
const assert=require('assert/strict');
const extraWat=String.raw`
(func (export "dd34_factory") (param $out i32) (call $handle_IDirectX7_DirectDrawCreate (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0)))
(func (export "dd34_native_test") (param $obj i32) (result i32)
 (local $eax i32) (local $esp i32) (local $hr i32)
 (local.set $eax (i32.load (global.get $reg_base))) (local.set $esp (i32.load offset=16 (global.get $reg_base)))
 (call $handle_IDirectDraw4_TestCooperativeLevel (local.get $obj) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
 (local.set $hr (i32.load (global.get $reg_base)))
 (i32.store (global.get $reg_base) (local.get $eax)) (i32.store offset=16 (global.get $reg_base) (local.get $esp)) (local.get $hr))
`;
async function run(h,apis,notepad,oracle) {
 const e=h.exports,u=new Uint8Array(h.memory.buffer);u.set(notepad,e.get_staging());assert(e.load_pe(notepad.length)>0);e.init_dx_com_thunks();
 const a=n=>e.guest_alloc(n)>>>0,r=p=>e.guest_read32(p)>>>0,w=(p,v)=>e.guest_write32(p,v),stack=a(256),out=a(16);let cases=0;
 const check=(name,f)=>{f();cases++;console.log('PASS '+name);};
 e.dd34_factory(out);const owner=r(out),table=r(owner);assert(owner&&table);
 check('full factory supplies actual callable native slot31',()=>{const thunk=r(table+31*4);assert(thunk&&r(thunk)===0xcaca0010,'DirectDraw7 slot31 must be a real callable thunk');assert.equal(apis[r(thunk+4)].name,'IVBDirectDraw7_TestCooperativeLevel');});
 const invoke=(object,slot,args=[],tableOverride=table)=>{const target=r(tableOverride+slot*4),api=apis[r(target+4)];assert.equal(r(target),0xcaca0010);assert.equal(api.nargs,args.length+1,api.name);for(let i=0;i<64;i++)w(stack+i*4,0xa7a70000+i);w(stack,0);[object,...args].forEach((x,i)=>w(stack+4+i*4,x));const before=Array.from({length:64},(_,i)=>r(stack+i*4));e.set_esp(stack);e.set_eip(target);e.run(1);assert.equal(e.get_eip(),0);assert.equal(e.get_esp()>>>0,stack+4*(api.nargs+1),api.name+' exact stdcall');for(let i=0;i<64;i++)assert.equal(r(stack+i*4),before[i],api.name+' stack canary');return e.get_eax()>>>0;};
 check('all34 initialized slots preserve old IDs and exact native arity',()=>{for(let i=0;i<34;i++){const t=r(table+i*4);assert(t);assert.equal(r(t),0xcaca0010);const id=r(t+4);assert.equal(id,i<30?2534+i:4089+i-30);const method=oracle.interface.methods.find(m=>m.vtableOffset===i*4);if(method)assert.equal(apis[id].nargs,1+method.args.length,method.name);}});
 const originalTable=Array.from({length:34},(_,i)=>r(table+i*4)),scratch=a(32);for(let i=0;i<8;i++)w(scratch+i*4,0xface0000+i);
 check('TestCooperativeLevel forwards native status separately from COM HRESULT',()=>{const expected=e.dd34_native_test(owner)>>>0;w(out,0xaaaaaaaa);w(out+4,0xbbbbbbbb);w(out+8,0xcccccccc);assert.equal(invoke(owner,31,[out+4]),0);assert.equal(r(out+4),expected);assert.equal(r(out),0xaaaaaaaa);assert.equal(r(out+8),0xcccccccc);});
 check('TestCooperativeLevel repeated calls preserve table and adjacent allocation',()=>{for(let i=0;i<10;i++)assert.equal(invoke(owner,31,[out+4]),0);assert.deepEqual(Array.from({length:34},(_,i)=>r(table+i*4)),originalTable);for(let i=0;i<8;i++)assert.equal(r(scratch+i*4),0xface0000+i);});
 check('TestCooperativeLevel null/unmapped/wrapping output fails without state mutation',()=>{for(const ptr of [0,0x7f000000,0xfffffffe])assert.equal(invoke(owner,31,[ptr]),0x80004003);});
 check('TestCooperativeLevel invalid object fails before output write',()=>{w(out+4,0x13572468);assert.equal(invoke(0,31,[out+4]),0x80070057);const fake=a(8);w(fake,0);w(fake+4,0);assert.equal(invoke(fake,31,[out+4]),0x80070057);w(fake,r(owner));w(fake+4,r(owner+4));assert.equal(invoke(fake,31,[out+4]),0x80070057,'copied live wrapper bytes are not the actual owner');assert.equal(r(out+4),0x13572468);});
 check('TestCooperativeLevel split status preserves noncontiguous neighboring page',()=>{const p=0x54000000,n=p+0x10000;for(const q of[p,n,p+4096])e.test_virtual_map_commit(q,4096);assert.notEqual(e.guest_to_wasm(p)+4096,e.guest_to_wasm(p+4096));for(let i=0;i<64;i++)e.guest_write8(n+i,0x9a);assert.equal(invoke(owner,31,[p+4095]),0);assert.equal(r(p+4095),e.dd34_native_test(owner)>>>0);for(let i=0;i<64;i++)assert.equal(e.guest_read8(n+i),0x9a);});
 check('new unsupported tail never fakes display/wait/identifier success',()=>{for(const slot of[30,32,33]){const count=oracle.interface.methods.find(m=>m.vtableOffset===slot*4).args.length;w(out+4,0x76543210);assert.equal(invoke(owner,slot,Array(count).fill(out+4)),0x80004001);assert.equal(r(out+4),0x76543210);}});
 check('every old unsupported method consumes complete typelib ABI',()=>{for(const m of oracle.interface.methods){const slot=m.vtableOffset/4;if(slot>=30||[5,7,8,29].includes(slot))continue;w(out+4,0x55aa55aa);assert.equal(invoke(owner,slot,Array(m.args.length).fill(out+4)),0x80004001,m.name);assert.equal(r(out+4),0x55aa55aa,m.name+' output untouched');}});
 check('second factory preserves first table without neighbor overwrite',()=>{e.dd34_factory(out+12);const second=r(out+12);assert(second&&second!==owner);const secondTable=r(second);for(let i=0;i<34;i++)assert.equal(r(r(secondTable+i*4)+4),r(r(table+i*4)+4));assert.equal(invoke(second,31,[out+4],secondTable),0);assert.equal(invoke(second,2,[],secondTable),0);assert.deepEqual(Array.from({length:34},(_,i)=>r(table+i*4)),originalTable);});
 check('AddRef/Release retain prior native lifetime and stale object rejected',()=>{assert.equal(invoke(owner,1),2);assert.equal(invoke(owner,2),1);assert.equal(invoke(owner,31,[out+4]),0);assert.equal(invoke(owner,2),0);w(out+4,0x90807060);assert.equal(invoke(owner,31,[out+4]),0x80070057);assert.equal(r(out+4),0x90807060);});
 return{cases,tableSlots:34};
}
const fs=require('fs');const {bootRenderHarness}=require('./render-helper');
(async()=>{const h=await bootRenderHarness({extraWat,fonts:'none'});const result=await run(h,require('../src/api_table.json'),fs.readFileSync(__dirname+'/binaries/notepad.exe'),require('./fixtures/directdraw7-typelib.json'));console.log(JSON.stringify({status:'PASS',...result}));})().catch(e=>{console.error(e);process.exitCode=1;});
