'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none'}),U=new Uint32Array(memory.buffer),F=new Float32Array(memory.buffer);
 const a=(b,n=0,s=228,m=0)=>[b,n,s,m];
 function compile(mask,component,modifier=256+(component<<11)){
  const g=e.guest_alloc(288)>>>0,p=e.guest_to_wasm(g)>>>0;U.fill(0,p/4,(p+288)/4);
  U.set([0x44534952,1,0,0xfffe0200,2,16,288,1],p/4);
  U.set([46,1,2,0,...a(3,0,mask),...a(1)],(p+32)/4);
  U.set([1,4,2,0,...a(0,0,15),...a(2,127,228,modifier)],(p+160)/4);
  const program=e.d3d_shader_vm_compile_vs20(p)>>>0;e.guest_free(g);return program;
 }
 const input=[[-1.5,-0.5,0.5,1.5],[0.5,1.5,2.5,3.5],[-128.5,-127.5,-126.5,-125.5],[126.5,127.5,128.5,129.5]];
 const rounded=[[-2,-0,0,2],[0,2,2,4],[-128,-128,-126,-126],[126,128,128,130]];
 let cases=0;
 for(let mask=1;mask<16;mask++)for(let component=0;component<4;component++)if(mask&(1<<component)){
  const p=compile(mask,component);assert(p,'vector MOVA/relative component compiles');
  const c=e.d3d_shader_vm_context(p,15)>>>0;assert(c);
  F.fill(-7,(c+24608)/4,(c+24672)/4);
  for(let k=0;k<4;k++)F.set(input[k],(c+8224)/4+k*4);
  for(let n=0;n<256;n++){const at=n<128?c+16416+n*64:c+65568+(n-128)*64;F.fill(n+1,at/4,(at+64)/4);}
  assert.strictEqual(e.d3d_shader_vm_run(c,1),1);
  for(let k=0;k<4;k++)for(let lane=0;lane<4;lane++)assert.strictEqual(F[(c+24608)/4+k*4+lane],mask&(1<<k)?rounded[k][lane]:-7);
  assert.strictEqual(e.d3d_shader_vm_run(c,1),0);
  for(let k=0;k<4;k++)for(let lane=0;lane<4;lane++){
   const index=127+rounded[component][lane];assert.strictEqual(F[(c+32)/4+k*4+lane],index>=0&&index<256?index+1:0);
  }
  e.d3d_shader_vm_free(c);e.d3d_shader_vm_free(p);cases++;
 }
 for(const modifier of [2048,4096,6144,256+8192,256+1024+2048]){
  assert.strictEqual(compile(15,0,modifier),0,'invalid relative component metadata');cases++;
 }
 console.log('PASS native vector a0 '+cases+' masks/components/rounding/gathers/bounds cases');
})().catch(e=>{console.error(e);process.exitCode=1;});
