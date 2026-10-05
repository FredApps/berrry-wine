'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),IR=require('../lib/d3d-shader-ir');
// Microsoft shader-relative-addressing and source-parameter-token: bank15,
// index0, scalar X gives 0xf0000800. LOOP operands use identity swizzle.
// https://learn.microsoft.com/en-us/windows-hardware/drivers/display/shader-relative-addressing
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:'(export "compile20" (func $d3d_shader_ir_compile20))'});
 const g=e.guest_alloc(32768),p=e.guest_to_wasm(g),w=new Uint32Array(memory.buffer,p,8192);
 const D=(b,i=0,m=15)=>(0x80000000|(b&7)<<28|(b&24)<<8|m<<16|i)>>>0;
 const S=(b,i=0,s=228)=>(0x80000000|(b&7)<<28|(b&24)<<8|s<<16|i)>>>0;
 const I=(o,...a)=>[o|a.length<<24,...a],L=I(27,S(15),S(7)),E=I(29),R=I(38,S(7)),ER=I(39),F=I(40,S(14)),EF=I(43);
 const pos=I(1,D(4),S(1)),code=(...a)=>[0xfffe0200,...I(31,0x80000000,D(1)),...a.flat(),...pos,65535];
 let n=0;
 function check(c,error){w.fill(0);w.set(c);const q=e.compile20(p,c.length)>>>0;if(error){assert.strictEqual(q,0);assert.strictEqual(e.d3d_shader_ir_error(),error);}else{assert(q,`IR error ${e.d3d_shader_ir_error()}`);e.d3d_shader_ir_free(q);}n++;}
 for(let i=0;i<16;i++)check(code(I(27,S(15),S(7,i)),E));
 const rel=(a=S(15,0,0),idx=0)=>I(1,D(0),S(2,idx)|8192,a);
 check(code(L,rel(),E));check(code(F,L,rel(),E,EF));check(code(L,F,rel(),EF,E));
 check(code(rel()),8);check(code(R,rel(),ER),8);check(code(L,E,rel()),8);
 for(const a of [S(15),S(15,1,0),S(15,0,85),S(3,0,0)])check(code(L,rel(a),E),8);
 for(const body of [E,L,[...L,...R,...ER,...E],[...R,...L,...E,...ER],[...L,...L,...E,...E],
  [...L,...ER],[...R,...E],[...L,...F,...E,...EF],[...F,...L,...EF,...E]])check(code(body),16);
 for(const a of [S(0),S(15,1),S(15,0,0)])check(code(I(27,a,S(7)),E),16);
 check(code(I(27,S(15),S(7,16)),E),16);check(code(I(27,S(15)),E),4);
 const init=I(1,D(0),S(1)),read=I(1,D(0,3),S(0)),kill=I(34,D(0,2),S(1),S(0),S(0,1));
 check(code(L,init,E,read),17);check(code(init,L,read,kill,E),17);
 check(code(init,L,read,kill,init,E));check(code(L,init,read,kill,E));
 for(let mask=1;mask<16;mask++){
  const wr=I(1,D(0,0,mask),S(1)),rd=I(1,D(0,3,mask),S(0));
  check(code(L,wr,E,rd),17);check(code(wr,L,rd,wr,E));
 }
 const addr=I(46,D(3,0,1),S(1,0,0));
 check(code(addr,L,I(2,D(0),S(2)|8192,S(3,0,0),S(2)|8192,S(15,0,0)),E),18);
 check(code(L,I(2,D(0),S(2)|8192,S(15,0,0),S(2)|8192,S(15,0,0)),E));
 check(code(L,I(20,D(0),S(1),S(2,252)|8192,S(15,0,0)),E));
 check(code(L,I(20,D(0),S(1),S(2,253)|8192,S(15,0,0)),E),15);
 check(code(Array(16).fill([...L,...E]).flat()));check(code(Array(17).fill([...L,...E]).flat()),16);
 check(code(Array(250).fill(0),L,E));check(code(Array(251).fill(0),L,E),19);
 w.set(code(L,rel(),E));const q=e.compile20(p,code(L,rel(),E).length),dv=new DataView(memory.buffer);
 assert.strictEqual(dv.getUint32(q+32+2*128+16+16+12,true),1280,'aL relative retains bits8+10');e.d3d_shader_ir_free(q);
 w.set(code(L,rel(),E));const ir=e.compile20(p,code(L,rel(),E).length);
 const projected=IR.read(memory.buffer,ir,{experimentalVS20:true});
 assert.deepStrictEqual(projected.instructions[1].relativeAddressBanks,[null,null]);
 assert.deepStrictEqual(projected.instructions[2].relativeAddressBanks,[null,'aL']);
 assert(Object.isFrozen(projected.instructions[2].relativeAddressBanks));
 assert.strictEqual(new DataView(projected.nativeBytes.buffer).getUint32(32+2*128+44,true),1280);
 e.d3d_shader_ir_free(ir);
 w.set(code(L,E));assert.strictEqual(e.d3d_shader_ir_compile(p,code(L,E).length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);
 for(const op of[27,29]){w.set([0xfffe0101,op,65535]);assert.strictEqual(e.d3d_shader_ir_compile(p,3),0);}
 // Repeated errors must return the bounded validation stack to the allocator.
 check(code(L,F,E),16);
 const scratch=e.guest_alloc(896)>>>0;e.guest_free(scratch);
 for(let i=0;i<32;i++)check(code(L,F,E),16);
 const reused=e.guest_alloc(896)>>>0;assert.strictEqual(reused,scratch);e.guest_free(reused);
 e.guest_free(g);console.log('PASS private LOOP IR '+n+' cases');
})().catch(e=>{console.error(e);process.exitCode=1;});
