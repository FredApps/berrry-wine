'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),IR=require('../lib/d3d-shader-ir');
// Register reference + VS differences explicitly provide vector a0 in VS2;
// MOVA's 2_x wording conflicts. This implements the former, not a Windows oracle.
// https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx9-graphics-reference-asm-vs-registers-address
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:'(export "compile20" (func $d3d_shader_ir_compile20))'});
 const g=e.guest_alloc(32768),p=e.guest_to_wasm(g),w=new Uint32Array(memory.buffer,p,8192);
 const D=(b,i=0,m=15)=>(0x80000000|(b&7)<<28|(b&24)<<8|m<<16|i)>>>0;
 const S=(b,i=0,s=228,m=0)=>(0x80000000|(b&7)<<28|(b&24)<<8|s<<16|m<<24|i)>>>0;
 const I=(o,...a)=>[o|a.length<<24,...a],M=(mask)=>I(46,D(3,0,mask),S(1)),A=(c)=>S(3,0,c*85),
  read=(c)=>I(1,D(0),S(2)|8192,A(c)),F=I(40,S(14)),ELSE=I(42),EF=I(43),
  LOOP=I(27,S(15),S(7)),END=I(29),C=I(25,S(18)),N=I(26,S(18),S(14)),L=I(30,S(18)),R=I(28),pos=I(1,D(4),S(1));
 const raw=(...a)=>[0xfffe0200,...I(31,0x80000000,D(1)),...a.flat(),65535],code=(...a)=>raw(...a,pos);
 let n=0;
 function check(c,error){w.fill(0);w.set(c);const q=e.compile20(p,c.length)>>>0;if(error){assert.strictEqual(q,0);assert.strictEqual(e.d3d_shader_ir_error(),error);}else{assert(q,`error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);e.d3d_shader_ir_free(q);}n++;}
 for(let mask=1;mask<16;mask++)for(let c=0;c<4;c++)check(code(M(mask),read(c)),mask&(1<<c)?0:8);
 for(let c=0;c<4;c++){
  check(code(read(c)),8);check(code(F,M(1<<c),EF,read(c)),8);
  check(code(F,M(1<<c),ELSE,M(1<<c),EF,read(c)));
  check(code(LOOP,M(1<<c),END,read(c)),8);check(code(M(1<<c),LOOP,END,read(c)));
  check(raw(C,read(c),pos,R,L,M(1<<c),R));
  check(raw(N,read(c),pos,R,L,M(1<<c),R),8);
  check(raw(M(1<<c),N,read(c),pos,R,L,M(15),R));
 }
 check(code(M(0)),7);check(code(I(46,D(3,1,1),S(1))),8);
 check(code(I(46,D(3,0,1)|0x100000,S(1))),8);
 check(code(M(15),I(1,D(0),S(2)|8192,S(3,0,228))),8);
 for(let c=0;c<4;c++){
  const sh=code(M(15),read(c));w.set(sh);const q=e.compile20(p,sh.length),v=new DataView(memory.buffer);
  assert.strictEqual(v.getUint32(q+32+2*128+44,true),256|(c<<11));
  const ir=IR.read(memory.buffer,q,{experimentalVS20:true});
  assert.deepStrictEqual(ir.instructions[2].relativeAddressBanks,[null,'a0']);
  assert.deepStrictEqual(ir.instructions[2].relativeAddressComponents,[null,c]);
  assert(Object.isFrozen(ir.instructions[2].relativeAddressComponents));e.d3d_shader_ir_free(q);
 }
 for(let c=1;c<4;c++)check(code(LOOP,I(1,D(0),S(2)|8192,S(15,0,c*85)),END),8);
 check(code(M(15),I(2,D(0),S(2)|8192,A(0),S(2)|8192,A(1))),18);
 check(code(M(15),I(2,D(0),S(2)|8192,A(2),S(2)|8192,A(2))));
 for(let left=1;left<16;left++)for(let right=1;right<16;right++){
  const c=(left+right)%4;
  check(code(F,M(left),ELSE,M(right),EF,read(c)),(left&right)&(1<<c)?0:8);
 }
 for(let c=0;c<4;c++){
  const bit=1<<c;
  check(code(I(1,D(0,0,bit),S(1)),I(46,D(3,0,bit),S(0)),read(c)));
  check(code(I(1,D(0,0,bit),S(1)),I(46,D(3,0,15),S(0))),17);
  check(code(M(bit),I(20,D(0),S(1),S(2,127)|8192,A(c))));
  check(code(M(bit),I(1,D(0),S(2)|8192,(A(c)|1)>>>0)),8);
 }
 // Reader must not silently strip impossible aL component metadata.
 const invalid=code(LOOP,I(1,D(0),S(2)|8192,S(15,0,0)),END);w.set(invalid);
 const iq=e.compile20(p,invalid.length),iv=new DataView(memory.buffer),mp=iq+32+2*128+44;
 iv.setUint32(mp,1280|2048,true);assert.throws(()=>IR.read(memory.buffer,iq,{experimentalVS20:true}),/component/);
 iv.setUint32(mp,2048,true);assert.throws(()=>IR.read(memory.buffer,iq,{experimentalVS20:true}),/component/);
 e.d3d_shader_ir_free(iq);
 w.set(code(M(15),read(3)));assert.strictEqual(e.d3d_shader_ir_compile(p,code(M(15),read(3)).length),0);
 e.guest_free(g);console.log('PASS private vector a0 IR '+n+' component/init/branch/call cases');
})().catch(e=>{console.error(e);process.exitCode=1;});
