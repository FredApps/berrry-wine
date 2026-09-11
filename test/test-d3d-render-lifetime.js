#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
  const extraWat=`(func (export "force_sparse_block") (result i32)
    (i32.add (call $heap_sparse_alloc (i32.const 32)) (i32.const 4)))
    (func (export "reverse_pointer") (param i32) (result i32)
      (call $w2g (local.get 0)))
    (func (export "new_map") (result i32)
      (call $virtual_map_commit (call $virtual_reserve_down (i32.const 65536)) (i32.const 4096)))
    (func (export "release_map") (param i32) (result i32)
      (call $virtual_map_release (local.get 0)))
    (func (export "dib_roundtrip") (result i32)
      (i32.eq (call $w2g (i32.add (global.get $DIB_BACKING_BASE) (i32.const 17)))
        (i32.add (global.get $DIB_GUEST_BASE) (i32.const 17))))`;
  const parent=await bootRenderHarness({fonts:'none',extraWat});
  const e=parent.exports,memory=parent.memory;
  const guard=e.guest_alloc(64)>>>0;
  assert.strictEqual(e.reverse_pointer(e.guest_to_wasm(guard))>>>0,guard,'direct allocation round trip');
  new Uint8Array(memory.buffer,e.guest_to_wasm(guard),64).fill(0xa7);
  const spare=e.guest_alloc(32);e.guest_free(spare);
  const originalHead=e.get_free_list()>>>0;
  const child=await bootRenderHarness({fonts:'none',extraWat,memory});
  const w=child.exports;w.d3dim_worker_init(e.get_image_base());
  const a=w.guest_alloc(56)>>>0,b=w.guest_alloc(128)>>>0;
  w.guest_free(a);w.guest_free(b);
  const tail=w.get_heap_ptr()>>>0,tailBytes=(w.get_heap_end()>>>0)-tail;
  const head=w.d3d_render_retire_heap()>>>0;
  assert.strictEqual(head,tail,'remaining current arena becomes a free block');
  assert.strictEqual(w.get_free_list(),0,'producer detaches ownership');
  assert.strictEqual(w.get_heap_ptr(),0);
  assert.strictEqual(w.d3d_render_retire_heap(),0,'repeat retirement cannot republish nodes');
  const view=new DataView(memory.buffer),at=e.guest_to_wasm(head)>>>0;
  const next=view.getUint32(at+4,true),size=view.getUint32(at,true);
  view.setUint32(at+4,head,true);
  assert.strictEqual(e.d3d_render_adopt_free_list(head),-1,'cycle rejected');
  assert.strictEqual(e.get_free_list()>>>0,originalHead,'cycle rejection is atomic');
  view.setUint32(at+4,next,true);view.setUint32(at,8,true);
  assert.strictEqual(e.d3d_render_adopt_free_list(head),-1,'malformed block rejected');
  assert.strictEqual(e.get_free_list()>>>0,originalHead);
  view.setUint32(at,size,true);
  for(const invalid of [head+1,0xfffffff8])assert.strictEqual(e.d3d_render_adopt_free_list(invalid),-1);
  assert.strictEqual(e.d3d_render_adopt_free_list(head),3,'tail and two freed allocations transferred');
  assert.strictEqual(e.d3d_render_adopt_free_list(head),-1,'double adoption rejected before mutation');
  assert.strictEqual(e.guest_alloc(tailBytes-4)>>>0,tail+4,'parent actually reuses retired unused capacity');
  assert.strictEqual(e.guest_alloc(128)>>>0,b,'parent actually reuses worker freed allocation');
  assert.strictEqual(e.guest_alloc(56)>>>0,a);
  assert(new Uint8Array(memory.buffer,e.guest_to_wasm(guard),64).every(v=>v===0xa7),'live parent bytes preserved');

  // Exercise the other allocator arena without needing to exhaust the entire
  // low window. This calls the production sparse allocator, not a fake mapping.
  const sparse=await bootRenderHarness({fonts:'none',extraWat,memory});
  const s=sparse.exports;s.d3dim_worker_init(e.get_image_base());
  const p=s.force_sparse_block()>>>0,wasm=s.guest_to_wasm(p)>>>0;
  for(const offset of [0,1,27])assert.strictEqual(s.reverse_pointer(wasm+offset)>>>0,p+offset,
    'sparse allocation and interior pointers round trip');
  s.d3d_shader_vm_free(wasm);
  assert.strictEqual(s.guest_alloc(28)>>>0,p,'native WASM-pointer release actually reuses sparse allocation');
  s.d3d_shader_vm_free(wasm);
  const sparseTail=s.get_heap_sparse_ptr()>>>0;
  const sparseBytes=(s.get_heap_sparse_end()>>>0)-sparseTail;
  const sparseHead=s.d3d_render_retire_heap()>>>0;
  assert.strictEqual(sparseHead,sparseTail);
  assert.strictEqual(e.d3d_render_adopt_free_list(sparseHead),2,'sparse block and tail transferred');
  assert.strictEqual(e.guest_alloc(sparseBytes-4)>>>0,sparseTail+4,'sparse tail reusable after retirement');
  assert.strictEqual(e.guest_alloc(28)>>>0,p,'sparse allocation reusable');
  const isolated=await bootRenderHarness({fonts:'none',extraWat,memory});
  const c=isolated.exports;c.d3dim_worker_init(e.get_image_base());
  assert.strictEqual(c.d3d_render_coalesce_heap(),0,'empty list');
  const group=Array.from({length:3},()=>c.guest_alloc(60)>>>0);
  const live=c.guest_alloc(60)>>>0,small=c.guest_alloc(28)>>>0;
  new Uint8Array(memory.buffer,c.guest_to_wasm(live),60).fill(0x6d);
  for(const index of [1,0,2])c.guest_free(group[index]);
  c.guest_free(small);
  assert.strictEqual(c.d3d_render_coalesce_heap(),2,'unsorted adjacent blocks merge');
  assert.strictEqual(c.d3d_render_coalesce_heap(),0,'coalescing is idempotent');
  assert.strictEqual(c.guest_alloc(28)>>>0,small,'small fit preserves larger merged extent');
  assert.strictEqual(c.guest_alloc(188)>>>0,group[0],'merged extent is actually reusable');
  assert(new Uint8Array(memory.buffer,c.guest_to_wasm(live),60).every(v=>v===0x6d),'live block remains untouched');
  c.guest_free(small);
  const header=c.guest_to_wasm(small-4)>>>0;
  view.setUint32(header+4,small-4,true);
  assert.strictEqual(c.d3d_render_coalesce_heap(),-1,'cycle rejected before sorting');
  assert.strictEqual(view.getUint32(header+4,true),small-4,'rejected chain remains untouched');
  view.setUint32(header+4,0,true);
  const overlapA=c.guest_alloc(60)>>>0,overlapB=c.guest_alloc(60)>>>0;
  assert.strictEqual(overlapA,small+32);
  assert.strictEqual(overlapB,overlapA+64);
  c.guest_free(overlapA);c.guest_free(overlapB);
  const overlapHeader=c.guest_to_wasm(overlapA-4)>>>0;
  view.setUint32(overlapHeader,128,true);
  assert.strictEqual(c.d3d_render_coalesce_heap(),-1,'overlapping free extents rejected');
  assert.strictEqual(view.getUint32(overlapHeader,true),128,'overlap rejection does not resize blocks');
  view.setUint32(overlapHeader,64,true);
  assert.strictEqual(c.d3d_render_coalesce_heap(),2,'repaired chain merges both blocks and adjacent small extent');
  assert.strictEqual(c.dib_roundtrip(),1,'DIB inverse remains independent of sparse maps');
  const maps=[c.new_map()>>>0,c.new_map()>>>0];
  assert(maps.every(Boolean));
  const backings=maps.map(g=>c.guest_to_wasm(g)>>>0);
  for(let i=0;i<2;i++)for(const offset of [0,4095])
    assert.strictEqual(c.reverse_pointer(backings[i]+offset)>>>0,maps[i]+offset);
  assert.strictEqual(c.release_map(maps[0]),1);
  assert.strictEqual(c.reverse_pointer(backings[0]),0,'released backing has no fabricated guest alias');
  assert.strictEqual(c.reverse_pointer(backings[1])>>>0,maps[1],'map-table compaction preserves live inverse');
  assert.strictEqual(c.release_map(maps[1]),1);
  assert.strictEqual(c.reverse_pointer(backings[1]),0);
  console.log('PASS native renderer heap retirement/adoption: low+sparse reuse, cycles, bounds, duplicate and live-data preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
