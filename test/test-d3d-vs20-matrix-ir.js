'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
const IR=require('../lib/d3d-shader-ir'),Shader=require('../lib/d3d9-shader');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(32768),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,8192);
 const D=(b,n=0,m=15)=>(0x80000000|b<<28|m<<16|n)>>>0;
 const S=(b,n=0,s=228,rel=false,mod=0)=>(0x80000000|b<<28|s<<16|n|(rel?8192:0)|mod<<24)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args];
 const declare=n=>I(31,0x80000000|n<<16,D(1,n));
 const shader=(...body)=>[0xfffe0200,...declare(0),...body.flat(),...I(1,D(4),S(1)),65535];
 const address=I(46,D(3,0,1),S(1,0,0));let count=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code,check=()=>{}){const p=compile(code);assert(p,`native error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);
  check(p);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);count++;}
 function bad(code,error){assert.strictEqual(compile(code),0);assert.strictEqual(e.d3d_shader_ir_error(),error);assert.strictEqual(e.ir_live(),0);count++;}
 for(const [op,rows,columns]of[[20,4,4],[21,3,4],[22,4,3],[23,3,3],[24,2,3]]){
  const mask=(1<<rows)-1,vectorMask=(1<<columns)-1;
  for(const base of[0,95,127,128,256-rows]){
   good(shader(I(op,D(0,0,mask),S(1),S(2,base))),p=>{
    const record=new Uint32Array(memory.buffer,p+32+128,16);
    assert.strictEqual(record[0],op);assert.strictEqual(record[2],3);
    assert.deepStrictEqual(Array.from(record.slice(12,16)),[2,base,228,0]);
    const lowered=Shader.compileIR(IR.read(memory.buffer,p,{experimentalVS20:true}),{experimentalVS20:true});
    for(let row=0;row<rows;row++)assert(lowered.uniforms.includes('d3d_vs_c'+(base+row)),'GLSL preserves logical row '+(base+row));
   });
   good(shader(address,I(op,D(0,0,mask),S(1),S(2,base,228,true),S(3,0,0))),p=>{
    assert.strictEqual(new Uint32Array(memory.buffer,p,8)[7],1);
    assert.deepStrictEqual(Array.from(new Uint32Array(memory.buffer,p+32+2*128+48,4)),[2,base,228,256]);
   });
  }
  for(const base of[257-rows,255]){
   bad(shader(I(op,D(0,0,mask),S(1),S(2,base))),15);
   bad(shader(address,I(op,D(0,0,mask),S(1),S(2,base,228,true),S(3,0,0))),15);
  }
  bad(shader(I(op,D(0,0,mask^1),S(1),S(2))),15);
  bad(shader(I(op,D(0,0,mask),S(1),S(2,0,0))),15);
  bad(shader(I(op,D(0,0,mask),S(1),S(2,0,228,false,1))),15);
  good(shader(I(op,D(0,0,mask),S(1,0,27,false,1),S(2))));
  const temps=Array.from({length:rows},(_,i)=>I(1,D(0,6+i,vectorMask),S(1))).flat();
  good(shader(temps,I(op,D(0,0,mask),S(2,255),S(0,6))));
  bad(shader(temps.slice(0,-3),I(op,D(0,0,mask),S(1),S(0,6))),17);
  bad(shader(temps,I(op,D(0,6+rows-1,mask),S(1),S(0,6))),15);
  bad(shader(I(1,D(0),S(1)),I(op,D(0,0,mask),S(0),S(2))),15);
  bad(shader(I(op,D(0,0,mask),S(2,127),S(2,127))),18);
  const declarations=Array.from({length:rows},(_,i)=>declare(4+i)).flat();
  good(shader(declarations,I(1,D(0,11,vectorMask),S(1)),I(op,D(0,0,mask),S(0,11),S(1,4))));
  bad(shader(declarations.slice(0,-3),I(1,D(0,11,vectorMask),S(1)),I(op,D(0,0,mask),S(0,11),S(1,4))),13);
  bad(shader(declarations,I(op,D(0,0,mask),S(1,4),S(1,4))),18);
  bad(shader(Array.from({length:rows-1},(_,i)=>I(1,D(0,12-rows+1+i),S(1))).flat(),I(op,D(0,0,mask),S(1),S(0,12-rows+1))),15);
  good(shader(I(1,D(0,11,vectorMask),S(1)),I(op,D(0,0,mask),S(0,11),S(2))));
  bad(shader(I(1,D(0,11,vectorMask^1),S(1)),I(op,D(0,0,mask),S(0,11),S(2))),17);
  good(shader(Array(255-rows).fill(0),I(op,D(0,0,mask),S(1),S(2))));
  bad(shader(Array(256-rows).fill(0),I(op,D(0,0,mask),S(1),S(2))),19);
  bad(shader(address,[(3<<24)|op,D(0,0,mask),S(1),S(2,0,228,true)]),8);
  const code=shader(I(op,D(0,0,mask),S(1),S(2)));words.set(code);
  assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
 }
 e.guest_free(guest);console.log('PASS private VS2 matrix IR '+count+' shape/row/init/port/slot/bounds cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
