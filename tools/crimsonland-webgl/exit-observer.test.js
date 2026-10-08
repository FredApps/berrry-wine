'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {installExitFaultObserver, overlayWorker} = require('./exit-observer');

function fixture(options = {}) {
  let clock = 0, reads = 0, gets = 0;
  const memory = {buffer:new ArrayBuffer(8192)}, rows = [], calls = [];
  const ex = {};
  for (const name of ['get_current_thread_id','get_image_base','get_eip','get_esp','get_ebp',
    'get_eax','get_ebx','get_ecx','get_edx','get_esi','get_edi'])
    ex[name] = () => { gets++; return name === 'get_esp' ? 1024 : name === 'get_ebp' ? 2048 : 4096; };
  new DataView(memory.buffer).setUint32(1016, 4096, true);
  ex.guest_to_wasm = p => { reads++; return p; };
  const host = {exit(...args) { calls.push(['exit',this,args]); return 77; },
    log_i32(...args) { calls.push(['log',this,args]); return 88; }};
  const originals = {...host};
  const observer = installExitFaultObserver(host, () => ({ex,memory}), r => rows.push(r),
    {now:()=>clock, durationMs:100, ...options});
  return {host,ex,memory,rows,calls,originals,observer,setClock:v=>clock=v,
    metrics:()=>({reads,gets})};
}
{
  const f = fixture();
  for (let i=0;i<5000;i++) assert.equal(f.host.log_i32(i),88);
  assert.deepEqual(f.metrics(),{reads:0,gets:0});
  f.host.log_i32(0xcae8c000); f.host.log_i32(0xc0000005); f.host.log_i32(0x123456);
  assert.equal(f.rows[0].kind,'fault'); assert.equal(f.rows[0].eip,0x123456);
  assert.equal(f.rows[0].code,0xc0000005);
  assert.equal(f.host.exit(0,'extra'),77);
  const row = f.rows.find(r=>r.kind==='exit');
  assert.equal(row.returnAddress,4096); assert.equal(row.stack.address,1016);
  assert.deepEqual(f.calls.at(-1),['exit',f.host,[0,'extra']]);
  assert.equal(f.calls.length,5004);
  for(let i=0;i<100;i++) { f.host.log_i32(0xcae8c000);f.host.log_i32(1);f.host.log_i32(4096);f.host.exit(0); }
  assert.equal(f.observer.summary().faults,4); assert.equal(f.observer.summary().exits,2);
  assert.ok(f.observer.summary().readBytes<=16384);
  const before=f.metrics(); f.host.exit(0); assert.deepEqual(f.metrics(),before);
  f.observer.stop(); assert.equal(f.host.exit,f.originals.exit);
}
{
  const f=fixture(); f.setClock(100); f.host.exit(0);
  assert.deepEqual(f.metrics(),{reads:0,gets:0}); assert.equal(f.calls.length,1);
}
{
  const f=fixture(); f.ex.get_current_thread_id=()=>{f.setClock(100);return 2;};
  f.host.exit(0); assert.equal(f.metrics().reads,0); assert.match(f.rows[0].error,/deadline/);
  assert.equal(f.calls.length,1);
}
{
  const f=fixture(); f.ex.guest_to_wasm=()=>{f.setClock(100); return 512;};
  f.host.exit(0); assert.equal(f.observer.summary().readBytes,0);
  assert.match(f.rows[0].error,/deadline/); assert.equal(f.calls.length,1);
}
{
  const f=fixture(); f.ex.guest_to_wasm=()=>0xf0; f.host.exit(0);
  assert.equal(f.rows[0].stack.unmapped,true);assert.equal(f.observer.summary().readBytes,0);
  const newer=()=>9; f.host.exit=newer; f.observer.stop(); assert.equal(f.host.exit,newer);
}
{
  const host={exit:()=>1}; const exit=host.exit;
  assert.throws(()=>installExitFaultObserver(host,()=>{},()=>{}),/log_i32/);
  assert.equal(host.exit,exit);
  const f=fixture(); const bad=()=>{throw Error('original');}; f.observer.stop();f.host.exit=bad;
  installExitFaultObserver(f.host,()=>{throw Error('state');},()=>{throw Error('emit');});
  assert.throws(()=>f.host.exit(0),/original/);
}
{
  const workerPath=require('node:path').resolve(__dirname,'../../lib/guest-worker.js');
  const source=fs.existsSync(workerPath) ? fs.readFileSync(workerPath,'utf8') :
    require('node:child_process').execFileSync('git',['show','HEAD:lib/guest-worker.js'],
      {cwd:require('node:path').resolve(__dirname,'../..'),encoding:'utf8'});
  const overlay=overlayWorker(source); new vm.Script(overlay);
  assert.throws(()=>overlayWorker('drift'),/anchor drift/);
  // Run the exact injected function expression, including its lazy instance closure.
  const anchor='      const result = await WebAssembly.instantiate(msg.module, built.imports);';
  const before=source.indexOf(anchor), inserted=overlay.slice(before,overlay.indexOf(anchor));
  const f=fixture();f.observer.stop();
  const logs=[];
  vm.runInNewContext(inserted,{built:{imports:{host:f.host}},instance:{exports:f.ex},memory:f.memory,
    console:{log:x=>logs.push(x)},Date,Uint8Array,Reflect});
  assert.equal(f.host.exit(0),77);assert.equal(logs.length,2);
  assert.equal(JSON.parse(logs[0].split('] ')[1]).returnAddress,4096);
}
console.log('PASS passive owning fault/exit, exact forwarding, caps, deadlines, restore, real Worker overlay');
