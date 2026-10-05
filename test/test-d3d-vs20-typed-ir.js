'use strict';
// Microsoft D3DSHADER_INSTRUCTION_OPCODE_TYPE: DEFB any nonzero DWORD=true;
// DEFI four signed32 DWORDs. Full destination mask is the private canonical
// subset here, not evidence that Windows rejects scalar Boolean masks.
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
const Reader=require('../lib/d3d-shader-ir');
// Malformed serialized IR must not erase typed-immediate metadata while
// projecting into GLSL operands. No guest execution is needed for this seam.
for(const [opcode,bank,values]of[[47,14,[0x80000000]],[48,7,[0,0xffffffff,0x80000000,0x7fffffff]]]){
 const raw=new Uint32Array(40);
 raw.set([Reader.MAGIC,1,0,0xfffe0200,1,8,160,0]);
 raw.set([opcode,1,values.length+1,0],8);raw.set([bank,15,15,0],12);
 values.forEach((value,i)=>raw.set([255,value,0,0],16+i*4));
 assert.deepStrictEqual(Reader.read(raw.buffer,0,{experimentalVS20:true}).instructions[0].args.slice(1),values);
 for(let i=0;i<values.length;i++)for(const field of[2,3])for(const invalid of[1,0xffffffff]){
  const q=16+i*4+field;raw[q]=invalid;
  assert.throws(()=>Reader.read(raw.buffer,0,{experimentalVS20:true}),/typed immediate/);
  raw[q]=0;
 }
}
// The existing legacy DEF projection contract is deliberately unchanged.
{
 const raw=new Uint32Array(40);raw.set([Reader.MAGIC,1,0,0xfffe0101,1,8,160,0]);
 raw.set([81,1,5,0],8);raw.set([2,0,15,0],12);
 for(let i=0;i<4;i++)raw.set([255,0x3f800000,1,2],16+i*4);
 assert.deepStrictEqual(Reader.read(raw.buffer,0).instructions[0].args.slice(1),Array(4).fill(0x3f800000));
}
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(32768),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,8192);
 const D=(bank,index=0,mask=15)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|mask<<16|index)>>>0;
 const S=(bank,index=0,swizzle=228)=>(0x80000000|(bank&7)<<28|(bank&24)<<8|swizzle<<16|index)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args];
 const declaration=I(31,0x80000000,D(1));
 const shader=(...body)=>[0xfffe0200,...declaration,...body.flat(),...I(1,D(4),S(1)),65535];
 let count=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code,check=()=>{}){const p=compile(code);assert(p,`native error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);check(p);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);count++;}
 function bad(code,error){assert.strictEqual(compile(code),0);assert.strictEqual(e.d3d_shader_ir_error(),error);assert.strictEqual(e.ir_live(),0);count++;}
 good(shader(I(47,D(14),1)));
 for(const [op,bank,args]of[[47,14,[0]],[48,7,[0,1,0x80000000,0x7fffffff]]]){
  for(let index=0;index<16;index++)good(shader(I(op,D(bank,index),...args)),p=>{
   const ir=new Uint32Array(memory.buffer,p+32+128,32);
   assert.strictEqual(ir[0],op);assert.strictEqual(ir[2],args.length+1);
   assert.deepStrictEqual(Array.from(ir.slice(4,8)),[bank,index,15,0]);
   args.forEach((value,j)=>assert.deepStrictEqual(Array.from(ir.slice(8+j*4,12+j*4)),[255,value>>>0,0,0]));
  });
  for(const wrong of[0,1,2,3,4,bank===7?14:7])bad(shader(I(op,D(wrong),...args)),14);
  bad(shader(I(op,D(bank,16),...args)),14);
  for(const mask of[0,1,2,3,7,8])bad(shader(I(op,D(bank,0,mask),...args)),mask?14:7);
  bad(shader(I(op,D(bank)|1<<20,...args)),14);
  bad(shader(I(op,D(bank)|8192,...args)),7);
  bad(shader(I(op,D(bank)&0x7fffffff,...args)),5);
  bad(shader(I(op,D(bank),...args.slice(1))),4);
  bad(shader(I(op,D(bank),...args,0)),4);
  // Definitions neither consume executable slots nor make a following DCL late.
  good([0xfffe0200,...I(op,D(bank),...args),...declaration,...I(1,D(4),S(1)),65535]);
  good(shader(Array(255).fill(0),I(op,D(bank),...args)));
  bad(shader(Array(256).fill(0),I(op,D(bank),...args)),19);
  good(shader(I(1,D(0),S(1)),I(op,D(bank),...args),I(op,D(bank),...args)));
  bad(shader(I(1,D(0),S(1)),I(op,D(bank),...args),I(31,0x80000005,D(1,1))),13);
  bad(shader(I(op,D(bank),...args),I(1,D(0,1),S(0))),17);
  bad(shader(I(op,D(bank),...args),I(1,D(0),S(2)|8192,S(3,0,0))),8);
  bad(shader(I(op,D(bank),...args),I(1,D(0),S(bank))),6);
  const code=shader(I(op,D(bank),...args));words.set(code);
  assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
  const legacy=[0xfffe0101,op,D(bank),...args,1,D(4),S(1),65535];words.set(legacy);
  assert.strictEqual(e.d3d_shader_ir_compile(ptr,legacy.length),0);assert.strictEqual(e.d3d_shader_ir_error(),3);count++;
 }
 for(const value of[0,1,2,0xffffffff,0x80000000,0x7fc00000,65535,65534])good(shader(I(47,D(14),value)),p=>{
  assert.strictEqual(new Uint32Array(memory.buffer,p+32+128+32,4)[1],value>>>0);
 });
 for(const args of[[0xffffffff,0x80000000,0x7fffffff,0],[65535,65534,0x900f0000,0x7fc00000]])good(shader(I(48,D(7),...args)));
 // Definitions alone cannot manufacture the required position output.
 bad([0xfffe0200,...I(47,D(14),1),...I(48,D(7),0,0,0,0),65535],10);
 e.guest_free(guest);console.log('PASS private VS2 typed IR '+count+' raw/bank/setup/slot cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
