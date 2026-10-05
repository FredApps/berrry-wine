'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:'(export "compile20" (func $d3d_shader_ir_compile20))'});
 const U=new Uint32Array(memory.buffer),F=new Float32Array(memory.buffer);
 const bits=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
 for(const records of [1101,4096]){
  const code=[0xfffe0200];
  for(let i=0;i<records-2;i++)code.push(0x05000051,0xa00f0000,bits(i===records-3?3:1),0,0,bits(1));
  code.push(0x02000001,0xc00f0000,0xa0e40000,0x02000001,0xc0010002,0xa0000000,0xffff);
  const g=e.guest_alloc(code.length*4)>>>0,p=e.guest_to_wasm(g)>>>0;U.set(code,p/4);
  const ir=e.compile20(p,code.length)>>>0;assert(ir,'shared IR accepts zero-slot definitions');
  assert.strictEqual(U[(ir+16)/4],records);
  const program=e.d3d_shader_vm_compile_vs20(ir)>>>0;assert(program,'executor accepts shared IR record budget');
  assert.strictEqual(e.d3d_shader_vm_has_point_size(program),1);
  const ctx=e.d3d_shader_vm_context(program,15)>>>0;assert(ctx);
  let status=1,ticks=0;while(status===1){status=e.d3d_shader_vm_run(ctx,17);assert(++ticks<500);}
  assert.strictEqual(status,0);assert(ticks>60,'large definitions still yield');
  for(let lane=0;lane<4;lane++){assert.strictEqual(F[(ctx+32800)/4+lane],3);assert.strictEqual(F[(ctx+32928)/4+lane],3);}
  e.d3d_shader_vm_free(ctx);
  U[(program+8)/4]=4097;assert.strictEqual(e.d3d_shader_vm_context(program,15),0);
  assert.strictEqual(e.d3d_shader_vm_has_point_size(program),0);
  e.d3d_shader_vm_free(program);e.d3d_shader_ir_free(ir);e.guest_free(g);
 }
 {
  const I=(op,...args)=>[(args.length<<24)|op,...args];
  const code=[0xfffe0200,...I(81,0xa00f0000,0,0,0,0),
   ...I(81,0xa00f0001,bits(1),bits(1),bits(1),bits(1)),
   ...I(48,0xf00f0000,255,0,1,0),...I(1,0x800f0000,0xa0e40000),
   ...I(27,0xf0e40800,0xf0e40000),
   ...Array.from({length:14},()=>I(25,0xa0e41001)).flat(),...I(29),
   ...I(1,0xc00f0000,0x80e40000),...I(28),...I(30,0xa0e41001),
   ...Array.from({length:200},()=>I(2,0x800f0000,0x80e40000,0xa0e40001)).flat(),...I(28),65535];
  const guest=e.guest_alloc(code.length*4)>>>0,p=e.guest_to_wasm(guest)>>>0;U.set(code,p/4);
  const ir=e.compile20(p,code.length)>>>0;assert(ir,`long LOOP+CALL IR error ${e.d3d_shader_ir_error()}`);
  const program=e.d3d_shader_vm_compile_vs20(ir)>>>0;assert(program);
  for(const cancel of [false,true]){
   const ctx=e.d3d_shader_vm_context(program,15)>>>0;assert(ctx);
   let status=1,ticks=0;
   while(status===1){
    const before=U[(ctx+20)/4];status=e.d3d_shader_vm_run(ctx,257);
    assert(U[(ctx+20)/4]-before<=257,'each slice obeys packet budget');
    assert(++ticks<4000,'finite loop and subroutine execution completes');
    if(cancel&&U[(ctx+20)/4]>65535){e.d3d_shader_vm_cancel(ctx);status=e.d3d_shader_vm_run(ctx,257);break;}
   }
   assert(U[(ctx+20)/4]>65535,'execution counter is not a 16-bit lifetime limit');
   if(cancel)assert.strictEqual(status,-2,'long-running shader cancels explicitly');
   else{
    assert.strictEqual(status,0);assert(ticks>2500);
    for(let component=0;component<4;component++)for(let lane=0;lane<4;lane++)
     assert.strictEqual(F[(ctx+32800+component*16+lane*4)/4],255*14*200);
    assert.strictEqual(U[(ctx+74104)/4],0,'return state retired');
   }
   e.d3d_shader_vm_free(ctx);
  }
  e.d3d_shader_vm_free(program);e.d3d_shader_ir_free(ir);e.guest_free(guest);
 }
 console.log('PASS shared IR/VM record budgets and >65535 LOOP+CALL execution, bounded slices/cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
