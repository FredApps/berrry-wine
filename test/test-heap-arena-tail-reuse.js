'use strict';
const assert=require('assert'),fs=require('fs'),{compileSrcWasm}=require('./compile-src'),sigs=require('../lib/host-import-sigs.generated.json').sigs,regions=require('../lib/region-map.generated');
(async()=>{const module=await WebAssembly.compile(process.argv[2]?fs.readFileSync(process.argv[2]):compileSrcWasm()),imageBase=0x400000;
 const lowBase=regions.BASE.GUEST_HEAP_BASE-regions.GUEST_BASE+imageBase,lowEnd=regions.END.GUEST_HEAP_BASE-regions.GUEST_BASE+imageBase;
 async function boot(sparse){const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true}),host={memory};
  for(const[n,s]of Object.entries(sigs))host[n]=s.results?.length?()=>0:()=>{};
  const a=(await WebAssembly.instantiate(module,{host})).exports,b=(await WebAssembly.instantiate(module,{host})).exports;
  a.init_thread(0,imageBase,0,0,0,0,0);a.heap_init(sparse?lowEnd:lowBase);b.init_thread(1,imageBase,0,0,0,0,0);
  return {a,b,memory};
 }
 let count=0;
 for(const sparse of[false,true])for(const tailBytes of[16,24,64]){
  const {a,b,memory}=await boot(sparse),bytes=new Uint8Array(memory.buffer),dv=new DataView(memory.buffer),wa=p=>a.guest_to_wasm(p)>>>0;
  const ptr=()=>a[sparse?'get_heap_sparse_ptr':'get_heap_ptr']()>>>0,end=()=>a[sparse?'get_heap_sparse_end':'get_heap_end']()>>>0;
  const first=a.guest_alloc(32)>>>0;assert(first);bytes.fill(0x5a,wa(first),wa(first)+32);
  const fillerSize=end()-ptr()-tailBytes-4,filler=a.guest_alloc(fillerSize)>>>0;assert(filler);bytes.fill(0x6b,wa(filler),wa(filler)+fillerSize);
  const tail=ptr(),oldEnd=end();assert.strictEqual(oldEnd-tail,tailBytes);
  const large=a.guest_alloc(256)>>>0;assert(large&&large!==tail+4);bytes.fill(0x7c,wa(large),wa(large)+256);
  assert.notStrictEqual(end(),oldEnd,'successful allocation really replaces arena');
  assert.strictEqual(a.get_free_list()>>>0,tail,'old tail published to owner free list');
  assert.strictEqual(dv.getUint32(wa(tail),true),tailBytes,'published exact tail extent');
  const peer=b.guest_alloc(8)>>>0;assert(peer&&!(peer>=tail&&peer<oldEnd),'peer cannot consume owner tail');bytes.fill(0x8d,wa(peer),wa(peer)+8);
  const current=ptr(),reused=a.guest_alloc(tailBytes-4)>>>0;assert.strictEqual(reused,tail+4,'owner reuses complete tail');
  assert.strictEqual(ptr(),current,'tail reuse does not bump replacement');bytes.fill(0x9e,wa(reused),wa(reused)+tailBytes-4);
  for(const[p,n,v]of[[first,32,0x5a],[filler,fillerSize,0x6b],[large,256,0x7c],[peer,8,0x8d]])assert(bytes.subarray(wa(p),wa(p)+n).every(x=>x===v),'live owner/peer guards preserved');
  count++;
 }
 // A failed reservation must also leave the current tail directly allocatable.
 for(const sparse of[false,true]){const {a}=await boot(sparse),ptr=()=>a[sparse?'get_heap_sparse_ptr':'get_heap_ptr']()>>>0,end=()=>a[sparse?'get_heap_sparse_end':'get_heap_end']()>>>0;
  assert(a.guest_alloc(8));assert(a.guest_alloc(end()-ptr()-32-4));const tail=ptr(),oldEnd=end();
  assert.strictEqual(a.guest_alloc(0x40000000),0,'oversized reservation fails');
  assert.strictEqual(ptr(),tail,'failed reservation preserves current cursor');assert.strictEqual(end(),oldEnd,'failed reservation preserves end');
  assert.strictEqual(a.guest_alloc(28)>>>0,tail+4,'failed rollover retains usable tail');count++;
 }
 for(const sparse of[false,true]){const {a}=await boot(sparse),ptr=()=>a[sparse?'get_heap_sparse_ptr':'get_heap_ptr']()>>>0,end=()=>a[sparse?'get_heap_sparse_end':'get_heap_end']()>>>0;
  assert(a.guest_alloc(8));assert(a.guest_alloc(end()-ptr()-8-4));const tiny=ptr();assert(a.guest_alloc(32));
  assert.strictEqual(a.get_free_list(),0,'subminimum eight-byte tail is not published');
  assert.notStrictEqual(a.guest_alloc(8)>>>0,tiny+4,'subminimum tail cannot serve a block');count++;
 }
 // Low-to-sparse spill does not replace the low arena. Its small remainder
 // remains current, and must not be published as a duplicate free block.
 {const {a}=await boot(false);assert(a.guest_alloc(8));assert(a.guest_alloc((a.get_heap_end()>>>0)-(a.get_heap_ptr()>>>0)-32-4));
  const tail=a.get_heap_ptr()>>>0,oldEnd=a.get_heap_end()>>>0;
  const large=a.guest_alloc(8*1024*1024)>>>0;assert(large);assert(a.get_heap_sparse_ptr());
  assert.strictEqual(a.get_heap_ptr()>>>0,tail);assert.strictEqual(a.get_heap_end()>>>0,oldEnd);
  assert.strictEqual(a.get_free_list(),0,'current low tail not duplicated on free list');
  assert.strictEqual(a.guest_alloc(28)>>>0,tail+4,'small allocation still consumes retained low tail');count++;
 }
 console.log('Heap arena tail reuse PASS '+count+' cases, public exports only');
})().catch(e=>{console.error(e);process.exitCode=1;});
