#!/usr/bin/env node
'use strict';
// Actual projection instructions copied from MW3; balanced ABBA fixed-work
// timing after warmup. This measures a kernel, not whole-game FPS.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const {createHostImports}=require('../lib/host-imports'),{readPE}=require('../lib/pe');
const exe=fs.readFileSync(path.resolve(__dirname,'../test/binaries/shareware/mw3/ex/Program_Files/mech3demo.exe'));
const pe=readPE(exe),body=exe.subarray(pe.va2off(0x4fd394),pe.va2off(0x4fd3e0));
const n=Number(process.env.MIXED_VERTICES||50000),rounds=Number(process.env.MIXED_ROUNDS||6);
const special=[0,0x80000000,0x3f000000,0x3f800000,0x40000000,0xbf800000,0x7f800000,0xff800000,0x7fc00123,1];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function arm(file,label){
  const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
  const ctx={exports:null,getMemory:()=>memory.buffer},host=createHostImports(ctx).host;
  Object.assign(host,{memory,log(){},log_i32(){},exit(){},crash_unimplemented(){throw Error('unimplemented');}});
  const bytes=fs.readFileSync(file),{instance}=await WebAssembly.instantiate(bytes,{host});
  const e=instance.exports;ctx.exports=e;new Uint8Array(memory.buffer).set(exe,e.get_staging());assert(e.load_pe(exe.length));
  const code=e.guest_alloc(body.length+16),src=e.guest_alloc(n*12),dst=e.guest_alloc(n*12),stack=e.guest_alloc(64)+32;
  for(let i=0;i<body.length;i++)e.guest_write8(code+i,body[i]);
  const fbuf=new DataView(new ArrayBuffer(4));const fbits=x=>{fbuf.setFloat32(0,x,true);return fbuf.getUint32(0,true);};
  for(const [a,v]of [[0x6fd8d0,320],[0x6fd8d4,-240],[0x6fd8c0,320],[0x6fd8c4,240],[0x6fd8c8,0.99]])e.guest_write32(a,fbits(v));
  e.set_x87_pipeline4_fusion(1);e.set_x87_island_predecode(1);e.set_uop(1);
  function input(edge){for(let i=0;i<n;i++)for(let j=0;j<3;j++)e.guest_write32(src+i*12+j*4,edge?special[(i*3+j)%special.length]:fbits(j===2?1+i%999:(i%127-63)*0.125));}
  function run(){
    e.guest_write32(stack,0);e.set_esp(stack);e.set_eax(n);e.set_ecx(src);e.set_edx(dst);e.set_eip(code);
    const before=e.get_x87_island_runs(),cpu=process.threadCpuUsage(),t=performance.now();e.run(10000000);
    const wallMs=performance.now()-t,used=process.threadCpuUsage(cpu);assert.equal(e.get_eip(),0,'kernel must finish');
    return {label,wallMs,threadCpuMs:(used.user+used.system)/1000,islands:(e.get_x87_island_runs()-before)>>>0};
  }
  function state(){const out=Buffer.alloc(n*12);for(let i=0;i<n*3;i++)out.writeUInt32LE(e.guest_read32(dst+i*4)>>>0,i*4);
    return {output:sha(out),eax:e.get_eax(),ecx:e.get_ecx()-src,edx:e.get_edx()-dst,esp:e.get_esp()-stack,
      top:e.get_fpu_top(),tag:e.get_fpu_tags(),sw:e.get_fpu_sw(),flags:['res','op','a','b','sign_shift'].map(x=>e['get_flag_'+x]())};}
  function census(){e.reset_handler_hist();e.set_handler_hist_enabled(1);run();e.set_handler_hist_enabled(0);
    const h=new Uint32Array(memory.buffer,e.get_handler_hist_base());
    return Object.fromEntries([3,64,65,188,189,190,451].map(i=>[i,h[i]]));}
  return {label,file,sha256:sha(bytes),input,run,state,census};
}
(async()=>{
  assert.equal(process.argv.length,4,'BASE.wasm CANDIDATE.wasm');
  const a=await arm(process.argv[2],'A'),b=await arm(process.argv[3],'B');
  const parity=[];for(const edge of [false,true]){a.input(edge);b.input(edge);const ra=a.run(),rb=b.run();assert.deepStrictEqual(b.state(),a.state());parity.push({edge,state:a.state(),runs:[ra,rb]});}
  a.input(false);b.input(false);for(let i=0;i<12;i++){a.run();b.run();}
  const samples=[];for(let i=0;i<rounds;i++)for(const x of i%2?[b,a,a,b]:[a,b,b,a])samples.push(x.run());
  assert.deepStrictEqual(b.state(),a.state());
  const census={A:a.census(),B:b.census()};
  if(a.sha256===b.sha256)assert.deepStrictEqual(census.B,census.A,'same-artifact control census');
  else if(process.env.MIXED_CONTROL==='1'){
    assert.equal(census.A[3],0,'mixed control must already absorb pointer ADDs');
    assert.equal(census.A[65],0,'mixed control must already absorb DEC');
    assert.deepStrictEqual(census.B,census.A,'predecode must preserve dispatched handler counts');
  }else{
    assert(census.A[3]>0&&census.B[3]===0,'candidate must absorb projection pointer ADDs');
    assert(census.A[65]>0&&census.B[65]===0,'candidate must absorb projection DEC');
  }
  const med=v=>v.slice().sort((a,b)=>a-b)[Math.floor(v.length/2)];
  const summary=Object.fromEntries([a,b].map(x=>[x.label,{file:x.file,sha256:x.sha256,cpuMedianMs:med(samples.filter(s=>s.label===x.label).map(s=>s.threadCpuMs)),wallMedianMs:med(samples.filter(s=>s.label===x.label).map(s=>s.wallMs))}]));
  console.log(JSON.stringify({node:process.version,v8:process.versions.v8,arch:process.arch,vertices:n,rounds,parity,census,samples,summary},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
