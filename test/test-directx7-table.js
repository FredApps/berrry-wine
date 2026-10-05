'use strict';
// Execute with the granted private before/candidate full-source overlay only.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const extraWat=String.raw`
(func (export "dx7_factory") (param $clsid i32) (param $iid i32) (param $out i32)
 (call $handle_CoCreateInstance (local.get $clsid) (i32.const 0) (i32.const 1) (local.get $iid) (local.get $out) (i32.const 0)))
`;
async function run(h,apis,typelib,exe){
 const e=h.exports,write=(p,v)=>e.guest_write32(p,v),read=p=>e.guest_read32(p)>>>0,alloc=n=>e.guest_alloc(n)>>>0;
 new Uint8Array(h.memory.buffer).set(exe,e.get_staging());assert(e.load_pe(exe.length)>0);e.init_dx_com_thunks();
 const clsid=alloc(16),iid=alloc(16),out=alloc(4),stack=alloc(128);[0xe1211353,0x11d18e94,0xc0000888,0x02c6c24f].forEach((x,i)=>write(clsid+i*4,x));[0xfafa3599,0x11d28b72,0xc000b290,0x02c6c24f].forEach((x,i)=>write(iid+i*4,x));e.dx7_factory(clsid,iid,out);assert.equal(e.get_eax(),0);const obj=read(out),table=read(obj);assert(obj);
 // Before-control must fail here, without executing an out-of-table pointer.
 const tickThunk=read(table+44*4);assert.equal(read(tickThunk),0xcaca0010,'slot44 must point to actual COM thunk');assert.equal(apis[read(tickThunk+4)]?.name,'IVBDirectX7_TickCount','slot44 exact TickCount target');
 const expected=['QueryInterface','AddRef','Release',...typelib.interface.methods.map(x=>x.name)];
 for(let i=0;i<58;i++){const thunk=read(table+i*4);assert.equal(read(thunk),0xcaca0010,'slot'+i+' executable COM thunk');const api=apis[read(thunk+4)];assert(api);assert.equal(api.name,'IVBDirectX7_'+expected[i],'slot'+i+' exact ABI identity');}
 const invoke=(slot,args)=>{const thunk=read(table+slot*4),api=apis[read(thunk+4)];assert.equal(api.nargs,args.length+1);write(stack-0+100,0x5a5a5a5a);write(stack,0);[obj,...args].forEach((x,i)=>write(stack+4+i*4,x));e.set_esp(stack);e.set_eip(thunk);e.run(1);assert.equal(e.get_eip(),0);assert.equal(e.get_esp()>>>0,stack+(api.nargs+1)*4);assert.equal(read(stack+100),0x5a5a5a5a);return e.get_eax()>>>0;};
 let ticks=123456;h.hostCtx.guestNowMs=()=>ticks;const result=alloc(12);write(result,0x12345678);write(result+8,0xabcdef01);assert.equal(invoke(44,[result+4]),0);assert.equal(read(result+4),ticks);assert.equal(read(result),0x12345678);assert.equal(read(result+8),0xabcdef01);ticks=987654;assert.equal(invoke(44,[result+4]),0);assert.equal(read(result+4),ticks);assert.equal(invoke(44,[0]),0x80004003);assert.equal(invoke(44,[0xfffffffe]),0x80004003);
 const base=0x38000000,neighbor=base+0x10000;for(const p of [base,neighbor,base+4096])e.test_virtual_map_commit(p,4096);assert.notEqual(e.guest_to_wasm(base+4096),e.guest_to_wasm(base)+4096);for(let i=0;i<16;i++)e.guest_write8(neighbor+i,0xa7);assert.equal(invoke(44,[base+4094]),0);assert.equal(read(base+4094),ticks);for(let i=0;i<16;i++)assert.equal(e.guest_read8(neighbor+i),0xa7);
 for(let slot=3;slot<58;slot++){const api=apis[read(read(table+slot*4)+4)];if(api.stub){assert.equal(invoke(slot,Array(api.nargs-1).fill(result+4)),0x80004001);assert.equal(read(result+4),ticks);}}
 assert.equal(invoke(0,[iid,out]),0);assert.equal(read(out),obj);assert.equal(read(obj),table);assert.equal(invoke(2,[]),1);assert.equal(invoke(2,[]),0);
 return{status:'PASS',slots:58,clockValues:[123456,987654],scope:'actual factory/vtable/stdcall and sparse TickCount output; no ordinary gameplay claim'};
}
module.exports={extraWat,run};

if(require.main===module){const {bootRenderHarness}=require('./render-helper');(async()=>{const h=await bootRenderHarness({extraWat,fonts:'none'});console.log(await run(h,require('../src/api_table.json'),require('./fixtures/directx7-typelib.json'),fs.readFileSync(path.join(__dirname,'binaries/notepad.exe'))));})().catch(e=>{console.error(e);process.exitCode=1;});}
