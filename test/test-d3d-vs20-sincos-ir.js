'use strict';
// Microsoft sincos---vs: VS2 clobbers unwritten XYZ, preserves W, costs8.
// Coefficient macro values are a runtime contract, not token constants.
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
 const coeff=[S(2,254),S(2,255)];
 good(shader(I(37,D(0,0,3),S(1,0,0),...coeff)));
 for(const mask of[1,2,3])for(let c=0;c<4;c++){
  good(shader(I(1,D(0,0,1<<c),S(1)),I(37,D(0,1,mask),S(0,0,c*85,1),...coeff)));
  bad(shader(I(1,D(0,0,15^(1<<c)),S(1)),I(37,D(0,1,mask),S(0,0,c*85),...coeff)),17);
  good(shader(I(1,D(0),S(1)),I(37,D(0,0,mask),S(1,0,c*85),...coeff),I(1,D(0,1,mask|8),S(0))));
  bad(shader(I(1,D(0),S(1)),I(37,D(0,0,mask),S(1,0,c*85),...coeff),I(1,D(0,1,7^mask),S(0))),17);
 }
 bad(shader(I(1,D(0),S(1)),I(37,D(0,0,3),S(0,0,0),...coeff)),16);
 for(const mask of[0,4,5,7,8,15])bad(shader(I(37,D(0,0,mask),S(1,0,0),...coeff)),mask?16:7);
 for(const bank of[1,2,3,4,5,6])bad(shader(I(37,D(bank,0,3),S(1,0,0),...coeff)),16);
 for(const swizzle of[228,27,57])bad(shader(I(37,D(0,0,3),S(1,0,swizzle),...coeff)),7);
 bad(shader(I(37,D(0,0,3),S(1,0,0),S(2,1),S(2,1))),16);
 for(const bank of[0,1,3])for(const which of[0,1]){const args=coeff.slice();args[which]=S(bank);bad(shader(I(37,D(0,0,3),S(1,0,0),...args)),16);}
 good(shader(I(37,D(0,0,3),S(2,253,0),...coeff)));
 // General coefficient token syntax is retained; supplying the required
 // effective macro values is the application's runtime contract. Same encoded
 // index is conservatively rejected even if one operand is relative.
 good(shader(I(37,D(0,0,3),S(1,0,0),S(2,254,27,1),S(2,255,57))));
 const address=I(46,D(3,0,1),S(1,0,0));
 good(shader(address,I(37,D(0,0,3),S(1,0,0),S(2,254)|8192,S(3,0,0),S(2,255))));
 good(shader(address,I(37,D(0,0,3),S(1,0,0),S(2,254),S(2,255)|8192,S(3,0,0))));
 bad(shader(address,I(37,D(0,0,3),S(1,0,0),S(2,255)|8192,S(3,0,0),S(2,255))),16);
 bad(shader(I(37,D(0,0,3),S(1,0,0),S(2,254,228,2),S(2,255))),7);
 bad(shader(I(37,D(0,0,3),S(1,0,0),S(2,256),S(2,255))),16);
 good(shader(Array(247).fill(0),I(37,D(0,0,3),S(1,0,0),...coeff)));
 bad(shader(Array(248).fill(0),I(37,D(0,0,3),S(1,0,0),...coeff)),19);
 bad(shader(I(37,D(0,0,3),S(1,0,0),S(2,254))),4);
 const code=shader(I(37,D(0,0,3),S(1,0,0),...coeff));words.set(code);
 assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
 const legacy=[0xfffe0101,37,D(0,0,3),S(1,0,0),...coeff,1,D(4),S(1),65535];words.set(legacy);
 assert.strictEqual(e.d3d_shader_ir_compile(ptr,legacy.length),0);assert.strictEqual(e.d3d_shader_ir_error(),3);count++;
 e.guest_free(guest);console.log('PASS private VS2 SINCOS IR '+count+' masks/clobber/scalar/slot cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
