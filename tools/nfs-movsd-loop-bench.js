#!/usr/bin/env node
'use strict';
// Fixed-work CPU benchmark, not a game FPS estimate. Run on the reserved box:
// node tools/nfs-movsd-loop-bench.js --baseline=before.wasm --candidate=after.wasm
//   --iterations=500 --pairs=7 --warmup=2 --out=movsd-loop.json
// No build or browser is started. Both modules must use the same guest ABI.
const fs=require('fs'),crypto=require('crypto'),os=require('os'),assert=require('assert');
const {newInstance,layout}=require('./bench-loops');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{
  const at=s.indexOf('=');return [s.slice(2,at),s.slice(at+1)];
}));
const integer=(name,fallback,max)=>{
  const n=Number(args[name]??fallback);
  if(!Number.isInteger(n)||n<1||n>max)throw new Error(`invalid --${name}`);
  return n;
};
const d32=v=>[v&255,v>>>8&255,v>>>16&255,v>>>24&255];
const regs=['eax','ecx','edx','ebx','esp','ebp','esi','edi'];
function assemble(a){
  const bytes=[],labels=new Map(),fixups=[];
  const emit=(...b)=>bytes.push(...b),label=s=>labels.set(s,bytes.length);
  const jump=(opcode,to)=>{emit(opcode,0);fixups.push([bytes.length-1,to]);};
  emit(0xFC); // CLD; ECX is the fixed outer repetition count.
  label('outer');
  emit(0xC7,0x45,0xF8,...d32(0),0xC7,0x45,0xFC,...d32(0));
  emit(0xBA,...d32(a.buf+1999*8),0x31,0xDB);jump(0xEB,'scan');
  // Exact demo instruction shape 0x4c5f17..0x4c5f41. Addresses are relocated
  // data registers, never a production address-specific optimization.
  label('link');emit(0x8B,0x3A,0x85,0xFF);jump(0x74,'next');
  emit(0x8B,0x45,0xFC,0x89,0x38,0x8B,0x42,0x04,0x89,0x45,0xFC);
  label('next');emit(0x83,0xEA,0x08,0x43,0x81,0xFB,...d32(2000));jump(0x7D,'end');
  label('scan');emit(0x83,0x7D,0xF8,0);jump(0x75,'link');
  emit(0x8D,0x7D,0xF8,0x89,0xD6,0xA5,0xA5);jump(0xEB,'next');
  label('end');emit(0x49);jump(0x75,'outer');emit(0xC3);
  for(const [at,to]of fixups){const relative=labels.get(to)-(at+1);
    assert(relative>=-128&&relative<=127);bytes[at]=relative&255;}
  return Uint8Array.from(bytes);
}
function seed(arm,shape,iterations){
  const {e,mem,g2w,a}=arm,v=new DataView(mem.buffer);
  mem.fill(0,g2w(a.buf),g2w(a.buf)+a.bufBytes);
  for(let i=0;i<2000;i++){
    v.setUint32(g2w(a.buf+i*8),shape==='mixed'&&i<500?a.buf+0x19000+i*4:0,true);
    v.setUint32(g2w(a.buf+i*8+4),a.buf+0x19000+i*4,true);
  }
  for(const name of regs)e['set_'+name](0);
  e.set_ecx(iterations);e.set_ebp(a.buf+0x18010);e.set_esp(a.stackTop);
  v.setUint32(g2w(a.stackTop),0,true);e.set_eip(a.code);
}
function execute(arm,shape,iterations){
  seed(arm,shape,iterations);
  const {e,mem,g2w,a}=arm;
  const before=Array.from({length:21},(_,i)=>e.uop_stats(i)>>>0);
  const cpu0=process.cpuUsage(),wall0=process.hrtime.bigint();
  let done=false;
  for(let i=0;i<4096;i++){e.run(0x7fffffff);if((e.get_eip()>>>0)===0){done=true;break;}}
  const wallMs=Number(process.hrtime.bigint()-wall0)/1e6,cpu=process.cpuUsage(cpu0);
  assert(done,'guest did not return');
  const state={regs:regs.map(r=>e['get_'+r]()>>>0),eip:e.get_eip()>>>0,flags:e.uop_flags()>>>0};
  assert.strictEqual(state.regs[1],0,'all repetitions completed');
  assert.strictEqual(state.regs[3],2000,'full 2000-record scan completed');
  assert.strictEqual(state.regs[2],a.buf-8,'scan reached its first record');
  const bytes=Buffer.from(mem.slice(g2w(a.buf),g2w(a.buf)+a.bufBytes));
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
  return {state,bytes,measurement:{wallMs,cpuMs:(cpu.user+cpu.system)/1000,
    userMs:cpu.user/1000,systemMs:cpu.system/1000,checksum,
    uopDelta:before.map((v,i)=>((e.uop_stats(i)>>>0)-v)>>>0)}};
}
const median=values=>{const a=[...values].sort((x,y)=>x-y),n=a.length;
  return n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2;};
async function main(){
  if(!args.baseline||!args.candidate)throw new Error('require --baseline=FILE --candidate=FILE');
  const iterations=integer('iterations',500,50000),pairs=integer('pairs',7,31),warmup=integer('warmup',2,10);
  const arms=[];
  for(const name of ['baseline','candidate']){
    const file=args[name],instance=await newInstance(file),a=layout(instance.imageBase,0x20000);
    instance.mem.set(assemble(a),instance.g2w(a.code));
    instance.e.set_uop(1);instance.e.set_uop_trace_heads(0);instance.e.set_branch_clock(0);
    instance.e.set_handler_hist_enabled?.(0);
    arms.push({...instance,a,name,file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  }
  assert.strictEqual(arms[0].imageBase,arms[1].imageBase,'identical guest layout');
  const result={kind:'NFSIII record-loop CPU microbenchmark',node:process.version,platform:process.platform,
    arch:process.arch,cpu:os.cpus()[0]?.model,loadStart:os.loadavg(),iterations,recordsPerScan:2000,
    recordsPerSample:iterations*2000,pairs,warmup,
    artifacts:arms.map(({name,file,sha256})=>({name,file,sha256})),shapes:[],
    caveat:'Fixed periodic guest loop; excludes GPU/game work and is not an FPS prediction. CPU usage is process-wide; wall time includes scheduling.'};
  for(const shape of ['all-zero','mixed']){
    let expected;
    const checked=arm=>{
      const run=execute(arm,shape,iterations);
      if(!expected)expected={state:run.state,bytes:run.bytes};
      else{assert.deepStrictEqual(run.state,expected.state,`${shape} register/flag parity`);
        assert.deepStrictEqual(run.bytes,expected.bytes,`${shape} complete memory parity`);}
      return run.measurement;
    };
    for(let i=0;i<warmup;i++)for(const arm of i%2?[...arms].reverse():arms)checked(arm);
    const samples=[];
    for(let i=0;i<pairs;i++){
      const pair={pair:i+1,order:i%2?['candidate','baseline']:['baseline','candidate']};
      for(const name of pair.order)pair[name]=checked(arms.find(a=>a.name===name));
      pair.cpuReductionPct=100*(1-pair.candidate.cpuMs/pair.baseline.cpuMs);
      pair.wallReductionPct=100*(1-pair.candidate.wallMs/pair.baseline.wallMs);
      samples.push(pair);
      console.error(`${shape} pair${i+1}: CPU ${pair.baseline.cpuMs.toFixed(2)} -> ${pair.candidate.cpuMs.toFixed(2)}ms; parity OK`);
    }
    result.shapes.push({shape,state:expected.state,samples,
      medianPairedCpuReductionPct:median(samples.map(s=>s.cpuReductionPct)),
      medianPairedWallReductionPct:median(samples.map(s=>s.wallReductionPct))});
  }
  result.loadEnd=os.loadavg();
  const json=JSON.stringify(result,null,2)+'\n';if(args.out)fs.writeFileSync(args.out,json);
  process.stdout.write(json);
}
main().catch(error=>{console.error(error.stack||error);process.exit(1);});
