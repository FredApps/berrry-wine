'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(65536*4),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,65536);
 const D=(b,n=0,m=15)=>(0x80000000|b<<28|m<<16|n)>>>0;
 const S=(b,n=0,s=228,rel=false,mod=0)=>(0x80000000|b<<28|s<<16|n|(rel?8192:0)|mod<<24)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args];
 const decl=I(31,0x80000000,D(1)),position=I(1,D(4),S(1));
 const shader=(...body)=>[0xfffe0200,...decl,...body.flat(),...position,65535];
 let tests=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code,check=()=>{}){const p=compile(code);assert(p,`error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);
  const u=new Uint32Array(memory.buffer,p,8);assert.strictEqual(u[0],0x44534952);assert.strictEqual(u[1],1);assert.strictEqual(u[3],0xfffe0200);
  check(p,u);const bytes=new Uint8Array(memory.buffer,p,u[6]).slice();words.fill(0);
  assert.deepStrictEqual(new Uint8Array(memory.buffer,p,bytes.length),bytes);e.d3d_shader_ir_free(p);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);tests++;}
 function bad(code,error){assert.strictEqual(compile(code),0);if(error!==undefined)assert.strictEqual(e.d3d_shader_ir_error(),error);
  assert.strictEqual(e.ir_live(),0);tests++;}
 const address=I(46,D(3,0,1),S(1,0,0)),relative=I(1,D(0),S(2,255,228,true),S(3,0,0));
 good(shader(address,relative),(p,u)=>{
  assert.strictEqual(u[7],1);const operand=new Uint32Array(memory.buffer,p+32+2*128+32,4);
  assert.deepStrictEqual(Array.from(operand),[2,255,228,256]);
  assert.strictEqual(new Uint32Array(memory.buffer,p+32+2*128,4)[2],2,'relative token normalized, not third operand');
 });
 for(const n of[0,95,96,127,128,255])good(shader(I(1,D(0),S(2,n))));
 good(shader(I(81,D(2,255),0x3f800000,0,0,0x3f800000),I(1,D(0),S(2,255))));
 for(const op of[1,19,35])good(shader(I(op,D(0),S(1))));
 for(const op of[2,3,5,8,9,10,11,12,13])good(shader(I(op,D(0),S(1),S(2,255))));
 good(shader(I(4,D(0),S(1),S(2,255),S(2,255))));
 for(const op of[6,7])good(shader(I(op,D(0),S(1,0,85))));
 good(shader(I(1,D(0,11,1),S(1)),I(46,D(3,0,1),S(0,11,0)),relative));
 good(shader([0x0002fffe,0xffffffff,0x02000001],address,relative));
 for(const code of[shader(address,relative),[0xfffe0101,...position,65535]]){
  words.set(code);if(code[0]===0xfffe0200){assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);tests++;}
  else bad(code,2);
 }
 bad(shader(I(1,D(0),S(2,256))),6);bad(shader(I(1,D(0,12),S(1))),6);
 bad(shader(relative),8);bad(shader(address,I(1,D(0),S(2,0,228,true))),8);
 for(const token of[S(3,0,85),S(3,1,0),S(3,0,0,true),S(3,0,0,false,1)])bad(shader(address,I(1,D(0),S(2,0,228,true),token)),8);
 good(shader(I(46,D(3),S(1))));bad(shader(I(1,D(3,0,1),S(1))),8);
 bad(shader(I(1,D(0),S(1,1))),13);bad(shader(decl),13);
 bad(shader(I(1,D(0),S(0))),17);bad(shader(I(1,D(0,0,1),S(1)),I(1,D(0,1),S(0))),17);
 bad(shader(I(2,D(0),S(2,1),S(2,2))),18);bad(shader(I(4,D(0),S(2),S(2),S(2))),18);
 bad(shader(I(6,D(0),S(1))),7);bad(shader(I(1,D(0),S(1,0,228,false,11))),7);
 bad(shader(I(1,D(0),S(1)&0x7fffffff)),5);bad(shader(I(1,D(0),S(1)|0x4000)),5);
 bad(shader(I(1,D(0)|8192,S(1))),7);bad(shader(I(81,D(2,256),0,0,0,0)),14);
 bad(shader(I(81,D(2,0,1),0,0,0,0)),14);bad(shader(I(31,0x8000000e,D(1,1))),13);
 good(shader(I(1,D(0,0,5),S(1)),I(1,D(0,1,3),S(0,0,0x88))));
 bad(shader([0x01000001,D(0),S(1)]),4);bad(shader([0x03000001,D(0),S(1),0]),4);
 for(const bit of[28,29,30,31,16])bad(shader([(0x02000001|(1<<bit))>>>0,D(0),S(1)]),3);
 bad(shader(I(20)),4);
 bad(shader(I(47)),4);bad(shader(I(40)),4);bad(shader(I(38)),4);
 bad(shader(I(27)),4);
 bad(shader(I(25)),4);
 for(const op of[28,41,42,44,45,66,87])bad(shader(I(op)),16);
 bad([0xfffe0200,...decl,...address,65535],10);
 bad([0xfffe0200,...decl,...position],4);bad([0xfffe0200,0x7ffffffe,65535],4);
 good(shader(Array(255).fill(0)));bad(shader(Array(256).fill(0)),19);
 assert.strictEqual(e.compile20(ptr+1,2),0);assert.strictEqual(e.d3d_shader_ir_error(),1);tests++;
 for(const [address,count]of[[0,2],[ptr,1],[ptr,65537],[memory.buffer.byteLength-4,2]]){
  assert.strictEqual(e.compile20(address,count),0);assert.strictEqual(e.d3d_shader_ir_error(),1);tests++;
 }
 const retained=[],large=shader(Array(255).fill(0));
 for(let i=0;i<256;i++){const p=compile(large);if(!p)break;retained.push(p);}
 assert(retained.length>1&&retained.length<256);assert.strictEqual(e.d3d_shader_ir_error(),12);
 assert(e.ir_live()<=4194304);for(const p of retained)e.d3d_shader_ir_free(p);
 assert.strictEqual(e.ir_live(),0);tests++;
 good(shader(address,relative));e.guest_free(guest);
 console.log('PASS private VS2.0 native IR '+tests+' validation/lifetime cases; public gate unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});
