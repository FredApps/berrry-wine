#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {split}=require('../lib/d3d-geometry-batches');
function fixture(primitive,count,indexed=false){
  const consumed=primitive===4?count*3:count+2,n=indexed?311:consumed;
  const vertices=new Uint8Array(n*4),view=new DataView(vertices.buffer);
  for(let i=0;i<n;i++)view.setUint32(i*4,i,true);
  return {primitive,primitiveCount:count,stride:4,vertices,
    ...(indexed?{indices:Uint32Array.from({length:consumed},(_,i)=>i%311)}:{})};
}
function triangles(s){
  const view=new DataView(s.vertices.buffer,s.vertices.byteOffset,s.vertices.byteLength);
  const value=i=>view.getUint32((s.indices?s.indices[i]:i)*s.stride,true),out=[];
  for(let i=0;i<s.primitiveCount;i++){
    const ids=s.primitive===4?[3*i,3*i+1,3*i+2]:s.primitive===6?[0,i+1,i+2]:[i+(i&1),i+1-(i&1),i+2];
    out.push(ids.map(value));
  }
  return out;
}
for(const primitive of [4,5,6])for(const indexed of [false,true]){
  const source=fixture(primitive,2950,indexed);
  if(indexed){source.indices[253]=source.indices[254];source.indices[255]=source.indices[254];}
  const expected=triangles(source),{batches,bytes}=split(source);
  assert(batches.length>1);
  assert.deepStrictEqual(batches.flatMap(triangles),expected,'global strip parity, fan hub and degenerates retained');
  for(const b of batches){assert(b.vertices.length/4<=256);assert(b.primitiveCount<=256);assert(b.indices instanceof Uint16Array);}
  assert.strictEqual(bytes,batches.reduce((n,b)=>n+b.vertices.byteLength+b.indices.byteLength,0));
  assert.strictEqual(split(source,bytes).bytes,bytes,'exact budget accepted');
  assert.throws(()=>split(source,bytes-1),/budget/);
  source.vertices.fill(0);if(source.indices)source.indices.fill(0);
  assert.deepStrictEqual(batches.flatMap(triangles),expected,'packed input remains immutable after guest reuse');
}
const bad=fixture(4,300,true);bad.indices[bad.indices.length-1]=999;
assert.throws(()=>split(bad),/outside/,'late invalid index fails before any batch is returned');
{
  const vertices=new Uint8Array(65539*4),view=new DataView(vertices.buffer);
  [65536,65537,65538].forEach(i=>view.setUint32(i*4,i,true));
  const source={primitive:4,primitiveCount:1,stride:4,vertices,indices:new Uint32Array([65536,65537,65538])};
  assert.deepStrictEqual(split(source).batches.flatMap(triangles),[[65536,65537,65538]],
    'INDEX32 source values are remapped, not truncated to16 bits');
}
for(const patch of [{primitive:1},{primitiveCount:-1},{stride:0},{indices:new Int16Array(900)},
  {primitiveCount:Number.MAX_SAFE_INTEGER},{vertices:new Uint8Array(3)}])
  assert.throws(()=>split({...fixture(4,300),...patch}),/D3D geometry batches/);
console.log('PASS geometry batches: 2950 triangles, all topologies, parity/degenerates, INDEX32 remap, immutable bytes and exact budgets');
