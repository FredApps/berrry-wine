#!/usr/bin/env node
'use strict';
const assert=require('assert');
const path=require('path');
const {Worker}=require('worker_threads');
const {Producer}=require('../lib/gl-software-producer');
const {Manager}=require('../lib/render-worker');
const {Encoder}=require('../lib/d3d-command-stream');
const {CALL_INDEX}=require('../lib/gl-compat');
const {bootRenderHarness}=require('./render-helper');

function setupProtocol(){
  let enabled=0,bitmap=0;const calls=[];
  const e={gl_sw_enabled:()=>enabled,gl_sw_bitmap:()=>bitmap,
    gl_sw_set_enabled:on=>{enabled=on;calls.push(['enabled',on]);},
    gl_sw_bind_bitmap:id=>{bitmap=id;calls.push(['bitmap',id]);return 1;},
    gl_sw_unbind_bitmap:()=>{bitmap=0;calls.push(['unbind']);},
    gl_sw_set_default_size:(w,h)=>calls.push(['size',w,h])};
  const producer=new Producer(()=>e);
  producer.config.set([1,64,48,0]);producer.configure();producer.configure();
  assert.strictEqual(calls.filter(c=>c[0]==='enabled').length,1,'unchanged config does not fence/reinitialize GL');
  producer.config.set([1,64,48,7]);producer.configure();producer.configure();
  assert.strictEqual(calls.filter(c=>c[0]==='bitmap').length,1,'unchanged bitmap keeps binding');
  producer.config.set([1,80,48,7]);producer.configure();
  assert.strictEqual(calls.filter(c=>c[0]==='bitmap').length,2,'resized bitmap refreshes native descriptor');
  producer.config.set([1,80,60,0]);producer.configure();assert.strictEqual(bitmap,0);
  producer.config.set([0,0,0,0]);producer.configure();assert.strictEqual(enabled,0);
}

async function bitmapPixels(){
  let encoder=null;
  const h=await bootRenderHarness({fonts:'none',extraHostOverrides:{gpu_gl_call(op,wa){
    return encoder ? encoder.call(op,wa) : 0;
  }}});
  const e=h.exports,memory=h.memory;
  e.init_thread(1,0x400000,0,0,0,0,0);e.heap_init(0x800000);
  const alloc=n=>e.guest_alloc(n)>>>0,wa=p=>e.guest_to_wasm(p)>>>0;
  const width=32,height=32,bmi=alloc(40),out=alloc(4);
  new Uint8Array(memory.buffer,wa(bmi),40).fill(0);
  for(const [at,value]of[[0,40],[4,width],[8,-height]])e.guest_write32(bmi+at,value);
  e.guest_write16(bmi+12,1);e.guest_write16(bmi+14,32);
  const bitmap=e.test_call_CreateDIBSection(0,bmi,0,out,0,0)>>>0;
  assert(bitmap,'native DIB allocation');
  const pixels=new Uint8Array(memory.buffer,wa(e.guest_read32(out)),width*height*4);
  const producer=new Producer(()=>e);
  producer.config.set([1,width,height,bitmap]);producer.configure();
  const stack=wa(alloc(32));
  new Int32Array(memory.buffer,stack,5).set([0,0,0,width,height]);
  e.gl_mtx_observe(CALL_INDEX.glViewport,stack);
  e.gl_mtx_set_mode(0x1700);e.gl_mtx_load_identity();
  e.gl_mtx_set_mode(0x1701);e.gl_mtx_load_identity();
  const vertices=wa(alloc(3*56));
  for(const [i,x,y]of[[0,-1,-1],[1,1,-1],[2,-1,1]]){
    const f=new Float32Array(memory.buffer,vertices+i*56,14);f.fill(0);
    f[0]=x;f[1]=y;f[3]=1;f[6]=1;
  }
  pixels.fill(0);e.gl_sw_emit_triangles(vertices,3);
  const direct=Uint8Array.from(pixels);
  const pixel=(x,y)=>new DataView(direct.buffer).getUint32((y*width+x)*4,true)&0xffffff;
  assert.strictEqual(pixel(4,24),0xff0000,'triangle interior is red');
  assert.strictEqual(pixel(24,4),0,'opposite corner stays clear');
  assert.strictEqual(e.gl_sw_triangles(),1,'direct baseline rasterizes on producer');

  e.gl_sw_reset();producer.configure();pixels.fill(0);
  const manager=new Manager({module:h.module,memory,
    sigs:require('../lib/host-import-sigs.generated.json').sigs,imageBase:e.get_image_base()>>>0,
    workerFactory:()=>new Worker(path.join(__dirname,'../lib/d3d-render-worker.js')),
    reclaimHeap:head=>e.d3d_render_adopt_free_list(head)});
  try{
    await manager.ready;
    const port=manager.createEndpoint({api:'legacy',backend:'software'});await port.ready;
    encoder=new Encoder({module:h.module,memory,sigs:require('../lib/host-import-sigs.generated.json').sigs,
      getImageBase:()=>e.get_image_base()>>>0,guestToWasm:wa,workerFactory:()=>port,explicitFence:true,strictReady:true});
    assert(encoder.ready(),'shared native endpoint is ready');
    e.gl_sw_emit_triangles(vertices,3);
    // No explicit test fence: bitmap visibility is required at draw return,
    // including direct guest reads and the immediately following GDI call.
    assert.deepStrictEqual(Uint8Array.from(pixels),direct,'queued bitmap draw matches direct pixels before draw returns');
    assert.strictEqual(e.gl_sw_triangles(),0,'producer did not rasterize queued bitmap triangle');
    assert(encoder.snapshot().glQueued>=1,'bitmap draw went through shared renderer queue');
    pixels.fill(0);e.gl_sw_emit_triangles(vertices,3);
    assert.deepStrictEqual(Uint8Array.from(pixels),direct,'guest bitmap writes precede next queued draw');
    producer.config.set([1,48,40,0]);producer.configure();
    assert.strictEqual(e.gl_sw_bitmap(),0,'window rebind releases bitmap targeting');
    e.gl_sw_emit_triangles(vertices,3);encoder.fence();
    assert.notStrictEqual(e.gl_sw_entry(),0,'window target allocated after bitmap unbind');
    assert.deepStrictEqual(Uint8Array.from(pixels),direct,'window draw does not overwrite old bitmap');
    encoder.stop();encoder=null;
  }finally{await manager.stop();}
}
setupProtocol();
bitmapPixels().then(()=>console.log('PASS software GL producer setup, resize, shared bitmap raster parity and synchronous visibility'))
  .catch(error=>{console.error(error);process.exitCode=1;});
