'use strict';
const assert=require('node:assert/strict');
const extraWat=String.raw`
(func (export "gwr_factory") (param $c i32) (param $i i32) (param $p i32)
 (call $handle_CoCreateInstance (local.get $c) (i32.const 0) (i32.const 1) (local.get $i) (local.get $p) (i32.const 0)))
(func (export "gwr_register") (param $wc i32) (param $name i32)
 (call $gs32 (i32.add (local.get $wc) (i32.const 4)) (global.get $WNDPROC_BUILTIN))
 (call $gs32 (i32.add (local.get $wc) (i32.const 36)) (local.get $name))
 (call $handle_RegisterClassA (local.get $wc) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
(func (export "gwr_create") (param $cls i32) (param $style i32) (param $x i32) (param $y i32) (param $w i32) (param $h i32) (param $parent i32) (param $sp i32) (result i32)
 (i32.store offset=16 (global.get $reg_base) (local.get $sp))
 (call $gs32 (local.get $sp) (i32.const 0))
 (call $gs32 (i32.add (local.get $sp) (i32.const 24)) (local.get $y))
 (call $gs32 (i32.add (local.get $sp) (i32.const 28)) (local.get $w))
 (call $gs32 (i32.add (local.get $sp) (i32.const 32)) (local.get $h))
 (call $gs32 (i32.add (local.get $sp) (i32.const 36)) (local.get $parent))
 (call $gs32 (i32.add (local.get $sp) (i32.const 40)) (i32.const 0))
 (call $gs32 (i32.add (local.get $sp) (i32.const 44)) (global.get $image_base))
 (call $gs32 (i32.add (local.get $sp) (i32.const 48)) (i32.const 0))
 (call $handle_CreateWindowExA (i32.const 0) (local.get $cls) (i32.const 0) (local.get $style) (local.get $x) (i32.const 0))
 (i32.load (global.get $reg_base)))
(func (export "gwr_native") (param $h i32) (param $p i32)
 (call $handle_GetWindowRect (local.get $h) (local.get $p) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
(func (export "gwr_destroy") (param $h i32)
 (call $handle_DestroyWindow (local.get $h) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
(func (export "gwr_move") (param $h i32) (param $x i32) (param $y i32)
 (drop (call $move_window_core (local.get $h) (i32.const 0) (local.get $x) (local.get $y) (i32.const 237) (i32.const 139) (i32.const 0x1c) (i32.const 0))))
(func (export "gwr_error") (result i32) (global.get $last_error))
`;
async function run(h,apis,pe){
 const e=h.exports,alloc=n=>e.guest_alloc(n)>>>0,read=p=>e.guest_read32(p)>>>0,write=(p,v)=>e.guest_write32(p,v),rect=p=>Array.from({length:4},(_,i)=>read(p+i*4)|0);
 new Uint8Array(h.memory.buffer).set(pe,e.get_staging());assert(e.load_pe(pe.length)>0);e.init_dx_com_thunks();
 const c=alloc(16),iid=alloc(16),out=alloc(4),stack=alloc(512)+256;
 [0xe1211353,0x11d18e94,0xc0000888,0x02c6c24f].forEach((x,i)=>write(c+4*i,x));[0xfafa3599,0x11d28b72,0xc000b290,0x02c6c24f].forEach((x,i)=>write(iid+4*i,x));e.gwr_factory(c,iid,out);assert.equal(e.get_eax(),0);const obj=read(out),vt=read(obj),thunk=read(vt+49*4);assert.equal(read(thunk),0xcaca0010);assert.equal(apis[read(thunk+4)].name,'IVBDirectX7_GetWindowRect');assert.equal(apis[read(thunk+4)].nargs,3);
 const invoke=(hwnd,p)=>{write(stack,0);[obj,hwnd,p].forEach((v,i)=>write(stack+4+i*4,v));write(stack+32,0xa5c3a5c3);e.set_esp(stack);e.set_eip(thunk);e.run(1);assert.equal(e.get_eip(),0);assert.equal(e.get_esp()>>>0,stack+16);assert.equal(read(stack+32),0xa5c3a5c3);assert.equal(read(obj),vt);return e.get_eax()>>>0;};
 const cls=alloc(32),wc=alloc(40);Buffer.from('VBRectProbe\0').forEach((v,i)=>e.guest_write8(cls+i,v));for(let i=0;i<40;i+=4)write(wc+i,0);e.gwr_register(wc,cls);assert(e.get_eax());const top=e.gwr_create(cls,0x10000000,31,47,237,139,0,stack)>>>0;assert(top);const buf=alloc(24),p=buf+4;write(buf,0x55aa55aa);write(buf+20,0xaa55aa55);
 assert.equal(invoke(top,p),0,'native-backed GetWindowRect must succeed for actual HWND');assert.deepEqual(rect(p),[31,47,268,186]);assert.equal(read(buf),0x55aa55aa);assert.equal(read(buf+20),0xaa55aa55);
 const native=alloc(16);e.gwr_native(top,native);assert.equal(e.get_eax(),1);assert.deepEqual(rect(p),rect(native));
 const child=e.gwr_create(cls,0x50000000,7,9,53,29,top,stack)>>>0;assert(child);assert.equal(invoke(child,p),0);assert.deepEqual(rect(p),[38,56,91,85]);e.gwr_native(child,native);assert.deepEqual(rect(p),rect(native));
 // Establish a negative origin through real window positioning, not the
 // renderer creation path which clamps its initial x to zero. Read the real
 // Win32 getter first and compare the COM result on that same actual HWND.
 e.gwr_move(top,-31,47);e.gwr_native(top,native);assert.equal(e.get_eax(),1);assert.deepEqual(rect(native),[-31,47,206,186],'real MoveWindow must establish negative origin before testing getter');assert.equal(invoke(top,p),0);assert.deepEqual(rect(p),rect(native));e.gwr_move(top,31,47);assert.equal(invoke(child,p),0);
 const old=rect(p);for(const invalid of [0,0xdeadbeef]){assert.equal(invoke(invalid,p),0x80004005);assert.deepEqual(rect(p),old);assert.equal(e.gwr_error(),1400);}
 e.gwr_destroy(child);assert.equal(invoke(child,p),0x80004005);assert.deepEqual(rect(p),old);
 for(const bad of [0,0xfffffff8,0x3a000000])assert.equal(invoke(top,bad),0x80004003);
 const sparse=0x38000000,neighbor=sparse+0x10000;for(const x of [sparse,neighbor,sparse+4096])e.test_virtual_map_commit(x,4096);assert.notEqual(e.guest_to_wasm(sparse+4096),e.guest_to_wasm(sparse)+4096);for(let i=0;i<32;i++)e.guest_write8(neighbor+i,0xa7);assert.equal(invoke(top,sparse+4090),0);assert.deepEqual(rect(sparse+4090),[31,47,268,186]);for(let i=0;i<32;i++)assert.equal(e.guest_read8(neighbor+i),0xa7);
 const partial=0x39000000;e.test_virtual_map_commit(partial,4096);for(let i=0;i<8;i++)e.guest_write8(partial+4088+i,0xb8);assert.equal(invoke(top,partial+4088),0x80004003);for(let i=0;i<8;i++)assert.equal(e.guest_read8(partial+4088+i),0xb8);
 for(let i=0;i<32;i++){assert.equal(invoke(top,p),0);assert.deepEqual(rect(p),[31,47,268,186]);}assert.equal(read(obj),vt);
 return {status:'PASS',cases:9,scope:'actual COM slot49, real top/child HWND screen coordinates, native BOOL/HRESULT, invalid+destroyed handle, sparse/nonmapped outputs, stack/canaries and repeated getter'};
}
module.exports={extraWat,run};

if(require.main===module){const fs=require('fs'),{bootRenderHarness}=require('./render-helper');(async()=>{const h=await bootRenderHarness({extraWat,fonts:'none'});console.log(JSON.stringify(await run(h,require('../src/api_table.json'),fs.readFileSync(__dirname+'/binaries/notepad.exe'))));})().catch(e=>{console.error(e);process.exitCode=1;});}
