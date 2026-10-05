'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
// Microsoft rep---vs: x count, yzw unused, no IF straddling. Canonical
// identity/no-modifier syntax is our private subset, not a Windows oracle.
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
  (export "compile20" (func $d3d_shader_ir_compile20))
  (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))`});
 const guest=e.guest_alloc(32768),ptr=e.guest_to_wasm(guest),words=new Uint32Array(memory.buffer,ptr,8192);
 const D=(b,i=0,m=15)=>(0x80000000|(b&7)<<28|(b&24)<<8|m<<16|i)>>>0;
 const S=(b,i=0,s=228,m=0)=>(0x80000000|(b&7)<<28|(b&24)<<8|s<<16|i|m<<24)>>>0;
 const I=(op,...args)=>[(args.length<<24)|op,...args],REP=I(38,S(7)),END=I(39),IF=I(40,S(14)),ELSE=I(42),ENDIF=I(43);
 const declaration=I(31,0x80000000,D(1)),position=I(1,D(4),S(1));
 const shader=(...body)=>[0xfffe0200,...declaration,...body.flat(),...position,65535];
 let count=0;
 function compile(code){words.fill(0);words.set(code);return e.compile20(ptr,code.length)>>>0;}
 function good(code){const p=compile(code);assert(p,`native error ${e.d3d_shader_ir_error()} @${e.d3d_shader_ir_error_offset()}`);e.d3d_shader_ir_free(p);assert.strictEqual(e.ir_live(),0);count++;}
 function bad(code,error){assert.strictEqual(compile(code),0);assert.strictEqual(e.d3d_shader_ir_error(),error);assert.strictEqual(e.ir_live(),0);count++;}
 for(let i=0;i<16;i++)good(shader(I(38,S(7,i)),END));
 good(shader(IF,REP,END,ELSE,REP,END,ENDIF));good(shader(REP,IF,ELSE,ENDIF,END));
 for(const body of[END,REP,[...REP,...REP,...END,...END],[...REP,...IF,...REP,...END,...ENDIF,...END],
  [...REP,...IF,...END,...ENDIF],[...IF,...REP,...ENDIF,...END],[...IF,...REP,...ELSE,...END,...ENDIF],
  [...REP,...ENDIF,...END],[...REP,...ELSE,...END]])bad(shader(body),16);
 for(const b of[0,1,2,3,14])bad(shader(I(38,S(b)),END),16);
 bad(shader(I(38,S(7,16)),END),16);
 for(const s of[0,85,170,255,27])bad(shader(I(38,S(7,0,s)),END),16);
 for(const m of[1,13])bad(shader(I(38,S(7,0,228,m)),END),16);
 bad(shader(I(38,S(7)|8192),END),16);bad(shader(I(38,S(7)&0x7fffffff),END),5);
 bad(shader(I(38),END),4);bad(shader(REP,I(39,0)),4);
 for(let mask=1;mask<16;mask++){
  const write=I(1,D(0,0,mask),S(1)),read=I(1,D(0,1,mask),S(0));
  bad(shader(REP,write,END,read),17);
  good(shader(write,REP,read,write,END,read));
  bad(shader(REP,read,write,END),17);
 }
 const addr=I(46,D(3,0,1),S(1,0,0)),relative=I(1,D(0),S(2)|8192,S(3,0,0));
 bad(shader(REP,addr,END,relative),8);good(shader(addr,REP,END,relative));
 bad([0xfffe0200,...declaration,...REP,...position,...END,65535],10);
 // Even a local nonzero DEFI does not bypass zero-iteration conservative merge.
 bad(shader(I(48,D(7),1,0,0,0),REP,I(1,D(0),S(1)),END,I(1,D(0,1),S(0))),17);
 bad(shader(I(1,D(0),S(1)),REP,I(34,D(0,2),S(1),S(0),S(0,1)),END,I(1,D(0,3),S(0))),17);
 const init=I(1,D(0),S(1)),read=I(1,D(0,3),S(0)),kill=I(34,D(0,2),S(1),S(0),S(0,1));
 bad(shader(init,REP,read,kill,END),17); // second iteration reads clobbered scratch
 good(shader(init,REP,read,kill,init,END));
 good(shader(REP,init,read,kill,END)); // each iteration writes before read
 bad(shader(init,REP,IF,init,ENDIF,read,kill,END),17);
 good(shader(REP,IF,init,ELSE,init,ENDIF,read,kill,END));
 bad(shader(init,REP,read,I(37,D(0,0,1),S(1,0,0),S(2),S(2,1)),END),17);
 good(shader(init,REP,read,I(37,D(0,0,1),S(1,0,0),S(2),S(2,1)),init,END));
 const sincos=I(37,D(0,0,1),S(1,0,0),S(2),S(2,1));
 good(shader(init,REP,I(1,D(0,3,1),S(0,0,255)),sincos,END)); // only W is needed and preserved
 bad(shader(init,REP,I(1,D(0,3,1),S(0,0,85)),sincos,END),17); // selected Y is not
 const rows=[...I(1,D(0,4),S(1)),...I(1,D(0,5),S(1))],matrix=I(24,D(0,8,3),S(1),S(0,4));
 const killRow=I(34,D(0,2),S(1),S(0,5),S(0,6));
 bad(shader(rows,REP,matrix,killRow,END),17);
 good(shader(rows,REP,matrix,killRow,I(1,D(0,5),S(1)),END));
 good(shader(Array(16).fill([...REP,...END]).flat()));bad(shader(Array(17).fill([...REP,...END]).flat()),16);
 good(shader(Array(15).fill(IF).flat(),REP,END,Array(15).fill(ENDIF).flat()));
 bad(shader(Array(16).fill(IF).flat(),REP,END,Array(16).fill(ENDIF).flat()),16);
 good(shader(Array(7).fill([...IF,...ELSE,...ENDIF]).flat(),REP,END,REP,END));
 bad(shader(Array(8).fill([...IF,...ELSE,...ENDIF]).flat(),REP,END),16);
 good(shader(Array(250).fill(0),REP,END));bad(shader(Array(251).fill(0),REP,END),19);
 const code=shader(REP,END);words.set(code);assert.strictEqual(e.d3d_shader_ir_compile(ptr,code.length),0);assert.strictEqual(e.d3d_shader_ir_error(),2);count++;
 for(const op of[38,39]){const old=[0xfffe0101,op,...(op===38?[S(7)]:[]),...position,65535];words.set(old);assert.strictEqual(e.d3d_shader_ir_compile(ptr,old.length),0);assert.strictEqual(e.d3d_shader_ir_error(),3);count++;}
 const first=e.guest_alloc(896)>>>0;e.guest_free(first);
 for(let i=0;i<32;i++)bad(shader(REP,IF,END),16);
 const reused=e.guest_alloc(896)>>>0;assert.strictEqual(reused,first);e.guest_free(reused);
 e.guest_free(guest);console.log('PASS private VS2 REP IR '+count+' structure/zero-trip/slot/lifetime cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
