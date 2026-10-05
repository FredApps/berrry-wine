'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(32768),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,8192);
 const D=(bank,index=0,mask=15)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|mask<<16|index)>>>0;
 const S=(bank,index=0,swizzle=228,modifier=0)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|swizzle<<16|index|modifier<<24)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args],IF=I(40,S(14)),ELSE=I(42),END=I(43);
 const declaration=I(31,0x80000000,D(1)),position=I(1,D(4),S(1));
 const shader=(...body)=>[0xfffe0200,...declaration,...body.flat(),...position,65535];
 let count=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code){const p=compile(code);assert(p,`native error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);count++;}
 function bad(code,error){assert.strictEqual(compile(code),0);assert.strictEqual(e.d3d_shader_ir_error(),error);assert.strictEqual(e.ir_live(),0);count++;}
 good(shader(IF,END));
 for(let index=0;index<16;index++)good(shader(I(40,S(14,index)),ELSE,END));
 for(const code of[ELSE,END,[...IF,...ELSE,...ELSE,...END],IF,[...IF,...IF,...END]])bad(shader(code),16);
 for(const bank of[0,1,2,3,7])bad(shader(I(40,S(bank)),END),16);
 bad(shader(I(40,S(14,16)),END),16);
 for(const selector of[0,85,170,255,27])bad(shader(I(40,S(14,0,selector)),END),16);
 for(const modifier of[1,13])bad(shader(I(40,S(14,0,228,modifier)),END),16);
 bad(shader(I(40,S(14)|8192),END),16);
 bad(shader(I(40,S(14)&0x7fffffff),END),5);
 bad(shader(I(40),END),4);bad(shader(IF,I(42,0),END),4);bad(shader(IF,I(43,0)),4);
 for(let mask=1;mask<16;mask++){
  const write=I(1,D(0,0,mask),S(1)),read=I(1,D(0,1,mask),S(0));
  good(shader(IF,write,ELSE,write,END,read));
  bad(shader(IF,write,END,read),17);
  bad(shader(IF,write,ELSE,read,END),17);
  good(shader(write,IF,END,read));
 }
 // Nested joins must not union disjoint per-branch component writes.
 bad(shader(IF,I(1,D(0,0,1),S(1)),ELSE,I(1,D(0,0,2),S(1)),END,I(1,D(0,1,3),S(0))),17);
 good(shader(IF,IF,I(1,D(0),S(1)),ELSE,I(1,D(0),S(1)),END,ELSE,I(1,D(0),S(1)),END,I(1,D(0,1),S(0))));
 const addr=I(46,D(3,0,1),S(1,0,0)),relative=I(1,D(0),S(2)|8192,S(3,0,0));
 bad(shader(IF,addr,END,relative),8);bad(shader(IF,addr,ELSE,relative,END),8);
 good(shader(IF,addr,ELSE,addr,END,relative));
 good([0xfffe0200,...declaration,...IF,...position,...ELSE,...position,...END,65535]);
 bad([0xfffe0200,...declaration,...IF,...position,...END,65535],10);
 bad([0xfffe0200,...declaration,...IF,...I(1,D(4,0,3),S(1)),...ELSE,...I(1,D(4,0,12),S(1)),...END,65535],10);
 // SGN invalidates scratches on either path; a join cannot resurrect them.
 bad(shader(I(1,D(0),S(1)),IF,I(34,D(0,2),S(1),S(0),S(0,1)),END,I(1,D(0,3),S(0))),17);
 good(shader(Array(16).fill(IF).flat(),Array(16).fill(END).flat()));
 bad(shader(Array(17).fill(IF).flat(),Array(17).fill(END).flat()),16);
 good(shader(Array(8).fill([...IF,...ELSE,...END]).flat()));
 bad(shader(Array(9).fill([...IF,...ELSE,...END]).flat()),16);
 // Profile summary says IF3 versus instruction page1; conservative3 chosen.
 good(shader(Array(251).fill(0),IF,END));bad(shader(Array(252).fill(0),IF,END),19);
 const code=shader(IF,END);words.set(code);assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
 for(const op of[40,42,43]){const legacy=[0xfffe0101,op,...(op===40?[S(14)]:[]),...position,65535];words.set(legacy);assert.strictEqual(e.d3d_shader_ir_compile(ptr,legacy.length),0);assert.strictEqual(e.d3d_shader_ir_error(),3);count++;}
 // Repeated malformed nesting must release the temporary stack, not only IR.
 // Settle free-list coalescing left by differently sized successful IR blocks
 // before recording an exact-address reuse witness for this allocation shape.
 assert.strictEqual(compile(shader(IF,ELSE,ELSE)),0);
 const first=e.guest_alloc(896)>>>0;e.guest_free(first);
 for(let i=0;i<32;i++)bad(shader(IF,ELSE,ELSE),16);
 const reused=e.guest_alloc(896)>>>0;assert.strictEqual(reused,first);e.guest_free(reused);
 e.guest_free(guest);console.log('PASS private VS2 flow IR '+count+' structure/merge/lifetime cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
