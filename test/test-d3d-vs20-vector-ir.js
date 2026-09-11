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
 good(shader(I(33,D(0,2,7),S(1),S(2,255))));
 good(shader(I(33,D(0,0,7),S(1),S(1))));
 good(shader(I(36,D(0),S(1))));
 for(let mask=1;mask<8;mask++){
  const needed=(mask&1?6:0)|(mask&2?5:0)|(mask&4?3:0);
  good(shader(I(1,D(0,0,needed),S(1)),I(1,D(0,1,needed),S(1)),I(33,D(0,2,mask),S(0),S(0,1))));
  good(shader(I(33,D(0,2,mask),S(1,0,228,false,1),S(2,255,228,false,1))));
  for(let component=0;component<3;component++)if(needed&(1<<component))for(const source of[0,1]){
   const masks=[needed,needed];masks[source]^=1<<component;
   const init=masks.flatMap((m,i)=>m?I(1,D(0,i,m),S(1)):[]);
   bad(shader(init,I(33,D(0,2,mask),S(0),S(0,1))),17);
  }
 }
 for(const mask of[0,8,9,15])bad(shader(I(33,D(0,2,mask),S(1),S(2))),mask?16:7);
 for(const bank of[4,5,6])bad(shader(I(33,D(bank,0,7),S(1),S(2))),16);
 for(const source of[0,1]){
  const args=[S(0),S(0,1)];bad(shader(I(1,D(0),S(1)),I(1,D(0,1),S(1)),I(33,D(0,source,7),...args)),16);
  for(const swizzle of[0,27,85,170,255]){const args=[S(1),S(2)];args[source]=S(source?2:1,0,swizzle);
   bad(shader(I(33,D(0,2,7),...args)),7);}
 }
 for(let mask=1;mask<16;mask++){
  const needed=7|(mask&8);
  good(shader(I(1,D(0,0,needed),S(1)),I(36,D(0,1,mask),S(0))));
  for(let component=0;component<4;component++)if(needed&(1<<component))
   bad(shader(I(1,D(0,0,needed^(1<<component)),S(1)),I(36,D(0,1,mask),S(0))),17);
 }
 // Swizzle selects the vector BEFORE computing its XYZ norm; a replicated
 // source only needs its one selected component, including a .w destination.
 for(let component=0;component<4;component++)good(shader(I(1,D(0,0,1<<component),S(1)),I(36,D(0,1,8),S(0,0,component*85,false,1))));
 good(shader(I(1,D(0,0,14),S(1)),I(36,D(0,1,7),S(0,0,0x39)))); // y,z,w,x
 for(const bank of[4,5,6])bad(shader(I(36,D(bank),S(1))),16);
 bad(shader(I(1,D(0),S(1)),I(36,D(0),S(0))),16);
 bad(shader(I(36,D(0,0,0),S(1))),7);
 for(const [op,cost,mask,args]of[[33,2,7,[S(1),S(2,255)]],[36,3,15,[S(2,255)]]]){
  good(shader(Array(255-cost).fill(0),I(op,D(0,2,mask),...args)));
  bad(shader(Array(256-cost).fill(0),I(op,D(0,2,mask),...args)),19);
  const operands=op===33?[S(1),S(2,255,228,true),S(3,0,0)]:[S(2,255,228,true),S(3,0,0)];
  good(shader(address,I(op,D(0,2,mask),...operands)),p=>assert.strictEqual(new Uint32Array(memory.buffer,p,8)[7],1));
  bad(shader([(1<<24)|op,D(0,2,mask)]),4);
  const code=shader(I(op,D(0,2,mask),...args));words.set(code);assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
  const vs1=[0xfffe0101,op,D(0,2,mask),...args,1,D(4),S(1),65535];words.set(vs1);
  assert.strictEqual(e.d3d_shader_ir_compile(ptr,vs1.length),0,'VS1 opcode admission unchanged');assert.strictEqual(e.d3d_shader_ir_error(),3);count++;
 }
 bad(shader(I(33,D(0,2,7),S(2,127),S(2,128))),18);
 bad(shader(I(36,D(0,12),S(1))),6);
 e.guest_free(guest);console.log('PASS private VS2 CRS/NRM IR '+count+' restriction/component/slot cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
