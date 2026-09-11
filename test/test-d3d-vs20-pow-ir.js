'use strict';
// Microsoft pow---vs and dx9-graphics-reference-asm-vs-instructions-vs-2-0:
// scalar sources, temporary destination distinct from exponent, three slots.
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(32768),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,8192);
 const D=(bank,index=0,mask=15)=>(0x80000000|bank<<28|mask<<16|index)>>>0;
 const S=(bank,index=0,swizzle=0,relative=false,modifier=0)=>(0x80000000|bank<<28|swizzle<<16|index|(relative?8192:0)|modifier<<24)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args];
 const shader=(...body)=>[0xfffe0200,...I(31,0x80000000,D(1)),...body.flat(),...I(1,D(4),S(1,0,228)),65535];
 let count=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code){const p=compile(code);assert(p,`native error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);count++;}
 function bad(code,error){assert.strictEqual(compile(code),0);assert.strictEqual(e.d3d_shader_ir_error(),error);assert.strictEqual(e.ir_live(),0);count++;}
 good(shader(I(32,D(0),S(1),S(2,255))));
 for(let mask=1;mask<16;mask++)for(let component=0;component<4;component++){
  good(shader(I(1,D(0,0,1<<component),S(1)),I(32,D(0,0,mask),S(0,0,component*85),S(2,255,component*85,false,1))));
  bad(shader(I(1,D(0,0,15^(1<<component)),S(1)),I(32,D(0,2,mask),S(0,0,component*85),S(2))),17);
  bad(shader(I(1,D(0,0,15^(1<<component)),S(1)),I(32,D(0,2,mask),S(2),S(0,0,component*85))),17);
 }
 bad(shader(I(1,D(0),S(1)),I(32,D(0),S(2),S(0))),16);
 for(const bank of[1,2,3,4,5,6])bad(shader(I(32,D(bank),S(1),S(2))),16);
 for(const source of[0,1])for(const swizzle of[228,27,57]){const args=[S(1),S(2)];args[source]=S(source?2:1,0,swizzle);bad(shader(I(32,D(0),...args)),7);}
 bad(shader(I(32,D(0,0,0),S(1),S(2))),7);
 bad(shader(I(32,D(0,12),S(1),S(2))),6);
 good(shader(I(32,D(0),S(2,255),S(2,255,85))));
 good(shader(I(32,D(0),S(1,0,170,false,1),S(1,0,255))));
 bad(shader(I(31,0x80000001,D(1,1)),I(32,D(0),S(1),S(1,1))),18);
 bad(shader(I(32,D(0),S(2,254),S(2,255))),18);
 for(const source of[0,1]){
  const args=source?[S(1),S(2,255,170,true),S(3)]:[S(2,255,170,true),S(3),S(1)];
  good(shader(I(46,D(3,0,1),S(1)),I(32,D(0),...args)));
  bad(shader(I(32,D(0),...args)),8);
 }
 bad(shader(I(32,D(0),S(1),S(2,256))),6);
 good(shader(Array(252).fill(0),I(32,D(0),S(1),S(2))));
 bad(shader(Array(253).fill(0),I(32,D(0),S(1),S(2))),19);
 bad(shader([(2<<24)|32,D(0),S(1)]),4);
 const code=shader(I(32,D(0),S(1),S(2)));words.set(code);
 assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
 const legacy=[0xfffe0101,32,D(0),S(1),S(2),1,D(4),S(1,0,228),65535];words.set(legacy);
 assert.strictEqual(e.d3d_shader_ir_compile(ptr,legacy.length),0);assert.strictEqual(e.d3d_shader_ir_error(),3);count++;
 e.guest_free(guest);console.log('PASS private VS2 POW IR '+count+' scalar/alias/init/port/slot cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
