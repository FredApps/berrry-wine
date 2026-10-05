'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(32768),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,8192);
 const D=(bank,index=0,mask=15)=>(0x80000000|bank<<28|mask<<16|index)>>>0;
 const S=(bank,index=0,swizzle=228,relative=false,modifier=0)=>(0x80000000|bank<<28|swizzle<<16|index|(relative?8192:0)|modifier<<24)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args];
 const shader=(...body)=>[0xfffe0200,...I(31,0x80000000,D(1)),...body.flat(),...I(1,D(4),S(1)),65535];
 const address=I(46,D(3,0,1),S(1,0,0));let count=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code,check=()=>{}){const p=compile(code);assert(p,`native error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);
  check(p);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);count++;}
 function bad(code,error){assert.strictEqual(compile(code),0);assert.strictEqual(e.d3d_shader_ir_error(),error);assert.strictEqual(e.ir_live(),0);count++;}
 // VS2 EXPP replicates exp2 into EVERY written component: .w is not the
 // constant-one result of VS1 EXPP, so selected source initialization matters.
 for(const op of[14,15,78,79]){
  for(const component of[0,1,2,3])for(const mask of[1,8,15]){
   const swizzle=component*85;
   good(shader(I(op,D(0,1,mask),S(1,0,swizzle))));
   good(shader(I(1,D(0,0,1<<component),S(1)),I(op,D(0,1,mask),S(0,0,swizzle))));
   bad(shader(I(1,D(0,0,15^(1<<component)),S(1)),I(op,D(0,1,mask),S(0,0,swizzle))),17);
  }
  bad(shader(I(op,D(0),S(1))),7);
  good(shader(address,I(op,D(0,0,8),S(2,255,170,true,1),S(3,0,0))),p=>{
   assert.strictEqual(new Uint32Array(memory.buffer,p,8)[7],1);
   assert.deepStrictEqual(Array.from(new Uint32Array(memory.buffer,p+32+2*128+32,4)),[2,255,170,257]);
  });
  good(shader(Array(254).fill(0),I(op,D(0),S(1,0,0))));
  bad(shader(Array(255).fill(0),I(op,D(0),S(1,0,0))),19);
  bad(shader([(1<<24)|op,D(0)]),4);
 }
 // LIT.x/w are constant; y depends on x; z requires x/y/w even if a
 // particular input would dynamically short-circuit the lighting formula.
 good(shader(I(16,D(0,1,9),S(0))));
 good(shader(I(1,D(0,0,1),S(1)),I(16,D(0,1,2),S(0))));
 bad(shader(I(16,D(0,1,2),S(0))),17);
 good(shader(I(1,D(0,0,11),S(1)),I(16,D(0,1,4),S(0))));
 for(const component of[0,1,3])bad(shader(I(1,D(0,0,11^(1<<component)),S(1)),I(16,D(0,1,4),S(0))),17);
 // DST = (1, src0.y*src1.y, src0.z, src1.w).
 good(shader(I(17,D(0,2,1),S(0),S(0,1))));
 good(shader(I(1,D(0,0,2),S(1)),I(1,D(0,1,2),S(1)),I(17,D(0,2,2),S(0),S(0,1))));
 good(shader(I(1,D(0,0,4),S(1)),I(17,D(0,2,4),S(0),S(0,1))));
 good(shader(I(1,D(0,1,8),S(1)),I(17,D(0,2,8),S(0),S(0,1))));
 bad(shader(I(1,D(0,0,2),S(1)),I(17,D(0,2,2),S(0),S(0,1))),17);
 bad(shader(I(1,D(0,1,2),S(1)),I(17,D(0,2,2),S(0),S(0,1))),17);
 for(const [op,cost,args]of[[16,3,[S(1)]],[17,1,[S(1),S(2,127)]],[18,2,[S(1),S(2,127),S(2,127)]]]){
  good(shader(I(op,D(0),...args)));
  good(shader(Array(255-cost).fill(0),I(op,D(0),...args)));
  bad(shader(Array(256-cost).fill(0),I(op,D(0),...args)),19);
  const code=shader(I(op,D(0),...args));words.set(code);
  assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
 }
 good(shader(address,I(18,D(0),S(1),S(2,127,228,true),S(3,0,0),S(2,127,228,true),S(3,0,0))));
 bad(shader(address,I(18,D(0),S(1),S(2,127),S(2,127,228,true),S(3,0,0))),18);
 bad(shader(I(18,D(0),S(2),S(2),S(2))),18);
 bad(shader(I(17,D(0),S(2,127),S(2,128))),18);
 bad(shader(I(18,D(0),S(1),S(0),S(2))),17);
 good(shader(I(1,D(0,0,8),S(1)),I(18,D(0,1,8),S(1),S(0),S(2))));
 e.guest_free(guest);console.log('PASS private VS2 arithmetic IR '+count+' scalar/component/slot/relative cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
