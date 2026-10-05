'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
 (export "compile20" (func $d3d_shader_ir_compile20))
 (func (export "reverse_pointer") (param i32) (result i32) (call $w2g (local.get 0)))
 (func (export "free_head") (result i32) (global.get $free_list))`});
 assert.strictEqual(typeof e.d3d_software_create_deferred,'function','deferred native constructor');
 const allocations=[],alloc=n=>{const g=e.guest_alloc(n)>>>0;assert(g);allocations.push(g);return e.guest_to_wasm(g)>>>0;};
 const u=(p,n)=>new Uint32Array(memory.buffer,p,n),f=(p,n)=>new Float32Array(memory.buffer,p,n),b=(p,n)=>new Uint8Array(memory.buffer,p,n);
 const D=(bank,index=0,mask=15)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|mask<<16|index)>>>0;
 const S=(bank,index=0)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|228<<16|index)>>>0;
 const I=(op,...a)=>[(a.length<<24)|op,...a];
 const vs=[0xfffe0200,...I(31,0x80000000,D(1)),...I(81,D(2),0x3e800000,0x3f000000,0x3f400000,0x3f800000),
  ...I(1,D(4),S(1)),...I(1,D(5),S(2)),...I(38,S(7)),...Array(33).fill(I(1,D(0),S(1))).flat(),...I(39),65535];
 const ps=[0xffff0101,1,D(0),S(1),65535],programs=[];
 function program(code,vertex){const p=alloc(code.length*4);u(p,code.length).set(code);const ir=(vertex?e.compile20:e.d3d_shader_ir_compile)(p,code.length)>>>0;assert(ir);const result=(vertex?e.d3d_shader_vm_compile_vs20:e.d3d_shader_vm_compile)(ir)>>>0;e.d3d_shader_ir_free(ir);assert(result);programs.push(result);return result;}
 const vp=program(vs,true),pp=program(ps,false),target=alloc(8*8*4+16),vertices=alloc(6*48),desc=alloc(128),typed=alloc(640);
 const fill=()=>{b(vertices,6*48).fill(0);for(let i=0;i<6;i++)f(vertices+i*48,12).set([i%3===1?1:-1,i%3===2?-1:1,.5,1,1,1,1,1,0,0,0,1]);};fill();
 u(desc,32).set([0x44535031,1,8,8,target,32,0,0,vertices,6,48,0,6,vp,pp,0,0,0,0,0,0,8,8,0,0,0,4,15,1,0,0,0]);f(desc+92,2).set([0,1]);
 b(typed,640).fill(0);u(typed,1)[0]=255;b(target,272).fill(0x55);
 const ctx=e.d3d_software_create_deferred(desc,typed)>>>0;assert(ctx);assert.strictEqual(u(ctx+140,1)[0],2);
 assert.strictEqual(e.d3d_software_retained_bound(ctx),0,'pending context cannot use compact retained charge');
 assert.strictEqual(e.d3d_software_bind_fill(ctx,3,1),0,'binders reject unfinished transformed geometry');
 assert.strictEqual(e.d3d_software_step(ctx,1),1);assert(b(target,272).every(x=>x===0x55));
 b(vertices,288).fill(0xff);b(typed,640).fill(0xff); // immutable constructor snapshots
 assert.strictEqual(e.d3d_software_prepare_step(ctx,0,1),1);
 const vm=u(ctx+144,1)[0];assert(vm);assert.strictEqual(e.d3d_software_prepare_step(ctx,1,1),1);const pc=u(vm+8,1)[0];assert(pc>0);
 assert.strictEqual(e.d3d_software_prepare_step(ctx,1,1),1);assert.notStrictEqual(u(vm+8,1)[0],pc,'yield resumes packet PC');
 let status=1,steps=2,partialClip=false;while(status===1){status=e.d3d_software_prepare_step(ctx,7,1);if(status===1&&!u(ctx+144,1)[0]&&u(ctx+48,1)[0]===3)partialClip=true;assert(b(target,272).every(x=>x===0x55),'setup never writes target');assert(++steps<10000);}
 assert.strictEqual(status,0);assert(steps>2000,'long REP really spans many budgets');
 assert(partialClip,'primitive budget clips only one of two input triangles');
 assert.strictEqual(u(ctx+144,1)[0],0,'VS context retired once setup completes');
 assert(e.d3d_software_retained_bound(ctx)<=e.d3d_software_deferred_allocation_bound(6,6));
 ok(e.d3d_software_bind_fill(ctx,3,1));while(e.d3d_software_step(ctx,1)===1){}
 assert.deepStrictEqual([...b(target+32+4,4)],[191,128,64,255]);assert(b(target+256,16).every(x=>x===0x55));
 e.d3d_software_free(ctx);
 fill();b(typed,640).fill(0);u(typed,1)[0]=255;
 const synchronous=e.d3d_software_create_typed(desc,typed)>>>0;assert(synchronous,'legacy constructor preserves ready-on-return');
 assert.strictEqual(u(synchronous+140,1)[0],1);assert.strictEqual(u(synchronous+144,1)[0],0);e.d3d_software_free(synchronous);
 function owners(p){return [p,...[144,148,160,200].map(o=>u(p+o,1)[0])].filter(Boolean).map(p=>[e.reverse_pointer(p)-4,u(p-4,1)[0]]);}
 function retired(owned){const ranges=[];let p=e.free_head()>>>0;for(let i=0;p&&i<10000;i++){const at=e.guest_to_wasm(p);ranges.push([p,p+u(at,1)[0]]);p=u(at+4,1)[0];}assert.strictEqual(p,0);for(const [start,size]of owned)assert(ranges.some(([a,z])=>a<=start&&z>=start+size),'all setup/context children returned to allocator');}
 for(let i=0;i<16;i++){const p=e.d3d_software_create_deferred(desc,typed)>>>0;assert(p);const owned=owners(p);assert.strictEqual(e.d3d_software_prepare_step(p,3,1),1);e.d3d_software_cancel(p);assert.strictEqual(e.d3d_software_prepare_step(p,3,1),-2);e.d3d_software_free(p);retired(owned);}
 f(vertices,1)[0]=NaN;u(typed,1)[0]=0;b(target,272).fill(0x55);
 // A NaN in the vertex data used to make prepare_step refuse the whole draw
 // (-1). It now completes (1) with the offending vertex marked, and the
 // clipper drops the triangles that use it -- so the target stays untouched
 // either way, which is the property that actually matters here.
 const failed=e.d3d_software_create_deferred(desc,typed)>>>0;assert(failed);const owned=owners(failed);
 assert.strictEqual(e.d3d_software_prepare_step(failed,100,1),1);assert(b(target,272).every(x=>x===0x55));e.d3d_software_free(failed);retired(owned);
 for(const p of programs)e.d3d_shader_vm_free(p);for(const p of allocations)e.guest_free(p);
 console.log('PASS resumable native VS setup: REP>8192, packet PC, immutable inputs, clipping budget, cancellation and pixels');
 function ok(v){assert.strictEqual(v,1);}
})().catch(error=>{console.error(error);process.exitCode=1;});
