'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),{compileSrcWasm}=require('./compile-src'),{createHostImports}=require('../lib/host-imports');
// Exact BW2Demo instructions at 00925165..00925186, including the subsequent
// cursor += EBP use. Prefix CLD; append PUSHFD/POP EAX and RET for inspection.
const body=[0x8b,0x7c,0x24,0x14,0x8b,0xcd,0x8b,0xd1,0xc1,0xe9,2,0x8b,0xf0,3,0xb3,0x20,1,0,0,0xf3,0xa5,0x8b,0xca,0x83,0xe1,3,0xf3,0xa4,1,0xab,0x20,1,0,0];
(async()=>{const files=process.argv.slice(2),builds=files.length?files.map(file=>[file,fs.readFileSync(file)]):[['current-source',compileSrcWasm()]];
 for(const[name,wasm]of builds){const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true}),ctx={exports:null,getMemory:()=>memory.buffer},imports=createHostImports(ctx);
  Object.assign(imports.host,{memory,log:()=>{},log_i32:()=>{},exit:()=>{},wait_multiple:()=>0,terminate_thread:()=>0});
  const e=(await WebAssembly.instantiate(wasm,imports)).instance.exports;ctx.exports=e;
  const exe=fs.readFileSync(path.join(__dirname,'binaries/notepad.exe'));new Uint8Array(memory.buffer).set(exe,e.get_staging());e.load_pe(exe.length);
  const bytes=new Uint8Array(memory.buffer),view=new DataView(memory.buffer),wa=g=>e.guest_to_wasm(g)>>>0;
  const code=e.guest_alloc(128)>>>0,stack=e.guest_alloc(4096)>>>0,object=e.guest_alloc(512)>>>0,src=e.guest_alloc(512)>>>0,dst=e.guest_alloc(512)>>>0;
  assert(code&&stack&&object&&src&&dst,'heap allocations');bytes.set([0xfc,...body,0x9c,0x58,0xc3],wa(code));let cases=0;
  for(const count of[0,1,3,4,7,35,64,259])for(let cached=0;cached<2;cached++){
   const offset=7,begin=dst+16,sp=stack+2048;
   for(let i=0;i<512;i++)bytes[wa(src)+i]=(i*37+11)&255;bytes.fill(0xa5,wa(dst),wa(dst)+512);
   view.setUint32(wa(sp),0,true);view.setUint32(wa(sp+0x14),begin,true);view.setUint32(wa(object+0x120),offset,true);
   e.set_esp(sp);e.set_ebp(count);e.set_eax(src);e.set_ebx(object);e.set_ecx(0x12345678);e.set_edx(0x87654321);e.set_esi(0x11111111);e.set_edi(0x22222222);e.set_eip(code);e.run(10000);
   const label=name+'/'+count+'/'+cached;assert.strictEqual(e.get_eip()>>>0,0,label+' return');
   assert.strictEqual(e.get_ebp()>>>0,count,label+' EBP');assert.strictEqual(e.get_edx()>>>0,count,label+' EDX');assert.strictEqual(e.get_ecx()>>>0,0,label+' ECX');
   assert.strictEqual(e.get_eax()&0x400,0,label+' DF remains clear');
   assert.strictEqual(e.get_esi()>>>0,src+offset+count,label+' ESI');assert.strictEqual(e.get_edi()>>>0,begin+count,label+' EDI');
   assert.strictEqual(view.getUint32(wa(object+0x120),true),offset+count,label+' cursor');
   assert.deepStrictEqual(bytes.slice(wa(begin),wa(begin)+count),bytes.slice(wa(src)+offset,wa(src)+offset+count),label+' copy');
   assert(bytes.slice(wa(dst),wa(begin)).every(v=>v===0xa5),label+' lower guard');assert(bytes.slice(wa(begin)+count,wa(dst)+512).every(v=>v===0xa5),label+' upper guard');cases++;
  }console.log(name+' BW REP copy PASS '+cases+' (including35 bytes, cold/cached)');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
