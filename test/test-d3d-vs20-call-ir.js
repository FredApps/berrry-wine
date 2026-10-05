'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),IR=require('../lib/d3d-shader-ir');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:'(export "compile20" (func $d3d_shader_ir_compile20))'});
 const g=e.guest_alloc(65536),p=e.guest_to_wasm(g),w=new Uint32Array(memory.buffer,p,16384);
 const D=(b,i=0,m=15)=>(0x80000000|(b&7)<<28|(b&24)<<8|m<<16|i)>>>0;
 const S=(b,i=0,s=228,m=0)=>(0x80000000|(b&7)<<28|(b&24)<<8|s<<16|m<<24|i)>>>0;
 const I=(o,...a)=>[o|a.length<<24,...a],C=(n=0)=>I(25,S(18,n)),N=(n=0,b=0,m=0)=>I(26,S(18,n),S(14,b,228,m)),L=(n=0)=>I(30,S(18,n)),R=I(28),F=I(40,S(14)),EF=I(43),LOOP=I(27,S(15),S(7)),END=I(29);
 const pos=I(1,D(4),S(1)),init=I(1,D(0),S(1)),read=I(1,D(0,3),S(0));
 const code=(...a)=>[0xfffe0200,...I(31,0x80000000,D(1)),...a.flat(),65535];
 let n=0;
 function check(c,error){w.fill(0);w.set(c);const q=e.compile20(p,c.length)>>>0;if(error){assert.strictEqual(q,0);assert.strictEqual(e.d3d_shader_ir_error(),error);}else{assert(q,`error ${e.d3d_shader_ir_error()} at${e.d3d_shader_ir_error_offset()}`);e.d3d_shader_ir_free(q);}n++;}
 check(code(C(),pos,R,L(),R));check(code(C(),R,L(),pos,R));
 check(code(C(),read,pos,R,L(),init,R));check(code(N(),read,pos,R,L(),init,R),17);
 check(code(init,N(),read,pos,R,L(),init,R));
 for(const m of[0,13])for(const b of[0,15])check(code(N(0,b,m),pos,R,L(),R));
 for(const label of[1,255,2047])check(code(C(label),pos,R,L(label),R));
 for(const a of[[...C(),...pos],[...C(),...pos,...R],[...pos,...L(),...R],[...pos,...R,...L()],
  [...pos,...R,...L(),...R,...L(),...R],[...C(),...pos,...R,...L(),...C(1),...R,...L(1),...R],
  [...C(),...pos,...R,...L(),...N(1),...R,...L(1),...R],[...pos,...R,...init],
  [...F,...R,...EF,...pos],[...F,...L(),...EF,...pos]])check(code(a),16);
 const rel=I(1,D(0),S(2)|8192,S(15,0,0));
 check(code(LOOP,C(),END,pos,R,L(),rel,R));check(code(C(),pos,R,L(),rel,R),8);
 check(code(LOOP,C(),END,C(),pos,R,L(),rel,R),8);
 check(code(LOOP,C(),END,pos,R,L(),LOOP,END,R),16);
 const kill=I(34,D(0,2),S(1),S(0),S(0,1));
 check(code(init,LOOP,read,C(),END,pos,R,L(),kill,R),17);
 check(code(init,LOOP,read,C(),init,END,pos,R,L(),kill,R));
 check(code(init,N(),read,pos,R,L(),kill,R),17);
 check(code(N(),R,L(),pos,R),10);
 check(code(pos,R));check(code(pos));
 const a0=I(46,D(3,0,1),S(1,0,0)),arel=I(1,D(0),S(2)|8192,S(3,0,0));
 check(code(C(),arel,pos,R,L(),a0,R));check(code(N(),arel,pos,R,L(),a0,R),8);
 check(code(C(),pos,R,L(),F,init,I(42),init,EF,R));
 for(let mask=1;mask<16;mask++){
  const wr=I(1,D(0,0,mask),S(1)),rd=I(1,D(0,3,mask),S(0));
  check(code(C(),rd,pos,R,L(),wr,R));
  check(code(N(),rd,pos,R,L(),wr,R),17);
  check(code(wr,N(),rd,pos,R,L(),wr,R));
 }
 check(code(C(),pos,R,L(),read,R),17); // callee cannot read caller-undefined r0
 check(code(init,C(),pos,R,L(),read,R));
 check(code(C(),read,pos,R,L(),F,init,EF,R),17);
 check(code(init,C(),pos,R,L(),read,kill,R)); // reads precede scratch clobber
 check(code(init,C(),read,pos,R,L(),kill,R),17);
 check(code(LOOP,init,N(),read,END,pos,R,L(),kill,R),17);
 check(code(LOOP,init,N(),init,read,END,pos,R,L(),kill,R));
 check(code(Array(16).fill(C()).flat(),pos,R,L(),R));
 check(code(Array(17).fill(C()).flat(),pos,R,L(),R),16);
 check(code(Array(251).fill(0),C(),pos,R,L(),R));
 check(code(Array(252).fill(0),C(),pos,R,L(),R),19);
 check(code(Array(250).fill(0),N(),pos,R,L(),R));
 check(code(Array(251).fill(0),N(),pos,R,L(),R),19);
 for(const label of[S(0),S(18,0,0),S(18,0,228,1),S(18)|8192])check(code(I(25,label),pos,R,L(),R),16);
 for(const bool of[S(14,16),S(14,0,0),S(14,0,228,1),S(14)|8192,S(7)])check(code(I(26,S(18),bool),pos,R,L(),R),16);
 check(code(I(25),pos,R,L(),R),4);check(code(C(),pos,I(28,0),L(),R),4);
 // Calls within outer structured blocks cannot use RET to escape that block.
 check(code(F,C(),EF,pos,R,L(),R));
 check(code(F,C(),EF,pos,R,L(),EF,R),16);
 for(const close of[EF,I(42)])check(code(F,C(),EF,pos,R,L(),close,F,R),16);
 check(code(LOOP,C(),END,pos,R,L(),END,LOOP,R),16);
 // An unreferenced routine has no caller aL obligation; any actual call is checked.
 check(code(pos,R,L(),rel,R));
 w.set(code(C(),pos,R,L(),R));const q=e.compile20(p,code(C(),pos,R,L(),R).length);
 assert(IR.read(memory.buffer,q,{experimentalVS20:true}).instructions[1].args[0]===S(18));e.d3d_shader_ir_free(q);
 const neg=code(N(0,15,13),pos,R,L(),R);w.set(neg);const nq=e.compile20(p,neg.length);
 const nr=IR.read(memory.buffer,nq,{experimentalVS20:true});assert.strictEqual(nr.instructions[1].args[1],S(14,15,228,13));e.d3d_shader_ir_free(nq);
 w.set(neg);assert.strictEqual(e.d3d_shader_ir_compile(p,neg.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);
 check(code(C(),pos,R,L()),16);
 const scratch=e.guest_alloc(896)>>>0;e.guest_free(scratch);
 for(let i=0;i<32;i++)check(code(C(),pos,R,L()),16);
 const reuse=e.guest_alloc(896)>>>0;assert.strictEqual(reuse,scratch);e.guest_free(reuse);
 e.guest_free(g);console.log('PASS private CALL IR '+n+' cases');
})().catch(e=>{console.error(e);process.exitCode=1;});
