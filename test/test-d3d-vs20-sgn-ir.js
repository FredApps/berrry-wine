'use strict';
// Microsoft sgn---vs: two distinct temporary scratch registers, undefined
// afterward. Overlap with src0/dst is unspecified: accepted here, not claimed
// Windows conformance. Destination-written components supersede clobbering.
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(32768),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,8192);
 const D=(bank,index=0,mask=15)=>(0x80000000|bank<<28|mask<<16|index)>>>0;
 const S=(bank,index=0,swizzle=228,modifier=0)=>(0x80000000|bank<<28|swizzle<<16|index|modifier<<24)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args];
 const shader=(...body)=>[0xfffe0200,...I(31,0x80000000,D(1)),...body.flat(),...I(1,D(4),S(1)),65535];
 let count=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code){const p=compile(code);assert(p,`native error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);count++;}
 function bad(code,error){assert.strictEqual(compile(code),0);assert.strictEqual(e.d3d_shader_ir_error(),error);assert.strictEqual(e.ir_live(),0);count++;}
 good(shader(I(34,D(0),S(1),S(0,1),S(0,2))));
 for(let mask=1;mask<16;mask++){
  good(shader(I(1,D(0,0,mask),S(1)),I(34,D(0,3,mask),S(0),S(0,1),S(0,2))));
  for(let c=0;c<4;c++)if(mask&(1<<c)){
   const init=mask^(1<<c);
   bad(shader(init?I(1,D(0,0,init),S(1)):[],I(34,D(0,3,mask),S(0),S(0,1),S(0,2))),17);
  }
  // Adapter overlap policy: read source before clobber, then mark only the
  // written destination components initialized when it aliases scratch.
  for(const scratch of[1,2]){
   const sg=I(34,D(0,scratch,mask),S(0,scratch),S(0,1),S(0,2));
   good(shader(I(1,D(0,scratch),S(1)),sg,I(1,D(0,4,mask),S(0,scratch))));
   if(mask!==15)bad(shader(I(1,D(0,scratch),S(1)),sg,I(1,D(0,4,15^mask),S(0,scratch))),17);
  }
 }
 for(const scratch of[1,2]){
  bad(shader(I(1,D(0,scratch),S(1)),I(34,D(0),S(1),S(0,1),S(0,2)),I(1,D(0,4),S(0,scratch))),17);
  good(shader(I(34,D(0),S(1),S(0,1),S(0,2)),I(1,D(0,scratch),S(1)),I(1,D(0,4),S(0,scratch))));
 }
 for(let c=0;c<4;c++)good(shader(I(1,D(0,0,1<<c),S(1)),I(34,D(0,3),S(0,0,c*85,1),S(0,1),S(0,2))));
 good(shader(I(1,D(0,0,8),S(1)),I(34,D(0,3,1),S(0,0,27,1),S(0,1),S(0,2))));
 bad(shader(I(1,D(0,0,7),S(1)),I(34,D(0,3,1),S(0,0,27,1),S(0,1),S(0,2))),17);
 bad(shader(I(34,D(0),S(1),(S(0,1)&0x7fffffff)>>>0,S(0,2))),5);
 bad(shader(I(34,D(0),S(1),S(0,1)|16384,S(0,2))),5);
 good(shader(I(34,D(5),S(2,255),S(0,10,27,1),S(0,11,0))));
 bad(shader(I(34,D(0),S(1),S(0,1),S(0,1,27))),16);
 for(const bank of[1,2,3,4])for(const which of[0,1]){
  const scratch=[S(0,1),S(0,2)];scratch[which]=S(bank);
  bad(shader(I(34,D(0),S(1),...scratch)),16);
 }
 bad(shader(I(34,D(0),S(1),S(0,12),S(0,2))),16);
 bad(shader(I(34,D(0),S(1),S(0,1,228,2),S(0,2))),7);
 bad(shader(I(34,D(0),S(1),(S(0,1)|8192)>>>0,S(0,2))),8);
 good(shader(I(46,D(3,0,1),S(1,0,0)),I(34,D(0),S(2,255)|8192,S(3,0,0),S(0,1),S(0,2))));
 good(shader(Array(252).fill(0),I(34,D(0),S(1),S(0,1),S(0,2))));
 bad(shader(Array(253).fill(0),I(34,D(0),S(1),S(0,1),S(0,2))),19);
 bad(shader(I(34,D(0),S(1),S(0,1))),4);
 const code=shader(I(34,D(0),S(1),S(0,1),S(0,2)));words.set(code);
 assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
 const legacy=[0xfffe0101,34,D(0),S(1),S(0,1),S(0,2),1,D(4),S(1),65535];words.set(legacy);
 assert.strictEqual(e.d3d_shader_ir_compile(ptr,legacy.length),0);assert.strictEqual(e.d3d_shader_ir_error(),3);count++;
 e.guest_free(guest);console.log('PASS private VS2 SGN IR '+count+' scratch/clobber/init/slot cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
