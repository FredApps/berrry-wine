'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none'}),U=new Uint32Array(memory.buffer),F=new Float32Array(memory.buffer);
 const a=(b,n=0,s=228,m=0)=>[b,n,s,m],ins=(op,...args)=>({op,args});
 function compile(items){
  const bytes=32+128*items.length,g=e.guest_alloc(bytes)>>>0,p=e.guest_to_wasm(g)>>>0;
  U.fill(0,p/4,(p+bytes)/4);U.set([0x44534952,1,0,0xfffe0200,items.length,128,bytes,1],p/4);
  items.forEach(({op,args},i)=>{const q=(p+32+128*i)/4;U.set([op,i+1,args.length,0],q);args.forEach((v,j)=>U.set(v,q+4+4*j));});
  const program=e.d3d_shader_vm_compile_vs20(p)>>>0;e.guest_free(g);return program;
 }
 const mov=ins(1,a(0,0,15),a(2)),add=ins(2,a(0,0,15),a(0),a(2,1));
 const label=ins(30,a(18,7)),ret=ins(28),call=ins(25,a(18,7));
 const program=compile([mov,call,call,ret,label,add,ret]);assert(program,'CALL program compiles');
 let cases=0;
 for(const budget of [1,2,3,100]){
  const c=e.d3d_shader_vm_context(program,15)>>>0;
  F.fill(1,(c+32+16384)/4,(c+32+16384+64)/4);F.fill(2,(c+32+16384+64)/4,(c+32+16384+128)/4);
  let status=1,ticks=0;while(status===1){status=e.d3d_shader_vm_run(c,budget);assert(++ticks<100);}
  assert.strictEqual(status,0);assert.deepStrictEqual(Array.from(F.slice((c+32)/4,(c+96)/4)),Array(16).fill(5));
  e.d3d_shader_vm_free(c);cases++;
 }
 for(const budget of [0,1,2,3,4,5,6,7,8]){
  const c=e.d3d_shader_vm_context(program,15)>>>0;
  assert.strictEqual(e.d3d_shader_vm_run(c,budget),1);
  e.d3d_shader_vm_cancel(c);assert.strictEqual(e.d3d_shader_vm_run(c,100),-2);
  e.d3d_shader_vm_free(c);cases++;
 }
 // Both forward target and suspended return addresses are checked on resume.
 for(const fault of ['target','return','return-noncall']){
  const c=e.d3d_shader_vm_context(program,15)>>>0;
  if(fault==='target')U[(program+16+64+8)/4]=0;
  else {assert.strictEqual(e.d3d_shader_vm_run(c,2),1);U[(c+74100)/4]=fault==='return'?0:1;}
  assert.strictEqual(e.d3d_shader_vm_run(c,100),-1);
  U[(program+16+64+8)/4]=4;e.d3d_shader_vm_free(c);cases++;
 }
 e.d3d_shader_vm_free(program);
 for(const mod of [0,13])for(const value of [0,1,0x80000000]){
  const p=compile([mov,ins(26,a(18,7),a(14,0,228,mod)),ret,label,add,ret]);assert(p);
  const c=e.d3d_shader_vm_context(p,15)>>>0;U[(c+74016)/4]=value;
  F.fill(2,(c+32+16384+64)/4,(c+32+16384+128)/4);
  let status=1;while(status===1)status=e.d3d_shader_vm_run(c,1);
  assert.strictEqual(status,0);assert.strictEqual(F[(c+32)/4],((value!==0)!==(mod===13))?2:0);
  e.d3d_shader_vm_free(c);e.d3d_shader_vm_free(p);cases++;
 }
 const loop=ins(27,a(15),a(7)),endloop=ins(29),relative=ins(1,a(0,0,15),a(2,127,228,1280));
 for(const items of [[loop,call,endloop,ret,label,relative,ret],
   [call,ret,label,loop,relative,endloop,ret]]){
  const p=compile(items);assert(p,'caller or callee LOOP allowed without nesting');
  const c=e.d3d_shader_vm_context(p,15)>>>0;U.set([2,0,1,0],(c+73760)/4);
  F.fill(3,(c+65568)/4,(c+65568+64)/4); // c128
  let status=1,ticks=0;while(status===1){status=e.d3d_shader_vm_run(c,1);assert(++ticks<100);}
  assert.strictEqual(status,0);assert.strictEqual(F[(c+32)/4],3);
  assert.strictEqual(U[(c+74088)/4],0);assert.strictEqual(U[(c+74104)/4],0);
  e.d3d_shader_vm_free(c);e.d3d_shader_vm_free(p);cases++;
 }
 for(const items of [[call,ret],[label,ret],[mov,ret,label,ret,label,ret],
   [call,ret,label,call,ret],[call,ret,label,add],[mov,ret,add],
   [ins(40,a(14)),ret,ins(43)],[ins(25,a(18,2048)),ret,label,ret],
   [call,ret,label,relative,ret],
   [loop,call,endloop,ret,label,loop,relative,endloop,ret],
   [loop,call,endloop,call,ret,label,relative,ret],
   [ins(26,a(18,7),a(14,16)),ret,label,ret],
   [ins(26,a(18,7),a(14,0,228,1)),ret,label,ret]]){
  assert.strictEqual(compile(items),0,'invalid routine structure');cases++;
 }
 const noPoint=compile([mov,ins(25,a(18,514)),ret,ins(0),ins(0),ins(30,a(18,514)),ret]);
 // NOPs after RET are invalid; put them in main to make the odd target collide
 // with the legacy point-size destination/mask words without invalid syntax.
 assert.strictEqual(noPoint,0);
 const pointCollision=compile([ins(0),ins(0),mov,ins(25,a(18,514)),ret,ins(30,a(18,514)),ret]);
 assert(pointCollision);assert.strictEqual(e.d3d_shader_vm_has_point_size(pointCollision),0);
 e.d3d_shader_vm_free(pointCollision);cases++;
 console.log('PASS native shader CALL '+cases+' execution/condition/structure cases');
})().catch(e=>{console.error(e);process.exitCode=1;});
