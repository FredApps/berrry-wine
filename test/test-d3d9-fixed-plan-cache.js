'use strict';
const assert=require('assert');
const Fixed=require('../lib/d3d9-fixed');
const viewport={x:0,y:0,width:640,height:480,minZ:0,maxZ:1};
function draw(){
  return {vertexShader:null,pixelShader:null,state:{},textures:[{width:16,height:16}],
    attributes:[[0,9,0,3,0],[5,10,0,4,16],[7,5,0,1,24],[6,10,1,4,20]].map(
      ([register,usage,usageIndex,type,offset])=>({register,usage,usageIndex,type,offset})),
    fixedFunction:{lighting:false,specular:false,fog:true,fogColor:0xff112233,
      alphaTest:true,alphaFunc:7,alphaRef:16,textureFactor:0xffffffff,colorKey:false,
      stages:[{colorOp:4,colorArg1:2,colorArg2:0,alphaOp:4,alphaArg1:2,alphaArg2:0,
        constant:0xffffffff,transformFlags:0,texCoordIndex:0},{colorOp:1}]}};
}
const cache=new Fixed.TLCache(2),d=draw();
const first=cache.compile(d,viewport);
assert.deepStrictEqual(first,Fixed.compile(d,viewport));
const second=cache.compile(d,viewport);
assert.strictEqual(second.vertex,first.vertex,'reuse static vertex plan');
assert.strictEqual(second.pixel,first.pixel,'reuse static pixel plan');
d.fixedFunction.fogColor=0xffabcdef;d.fixedFunction.alphaRef=192;
const moved={x:8,y:12,width:320,height:200,minZ:.2,maxZ:.8};
const changed=cache.compile(d,moved);
assert.strictEqual(changed.pixel,first.pixel,'dynamic uniforms do not regenerate shaders');
assert.deepStrictEqual(changed,Fixed.compile(d,moved),'refresh all dynamic uniforms');
assert.strictEqual(first.values.d3d_ff_alpha.value[0],Math.fround(16/255),'previous snapshot remains independent');
for(const edit of [
  d=>{d.fixedFunction.stages[0].colorOp=2;},
  d=>{d.fixedFunction.fog=false;},
  d=>{d.fixedFunction.colorKey=true;},
  d=>{d.fixedFunction.alphaFunc=5;},
  d=>{d.textures=[];},
  d=>{d.attributes[2].register=8;},
  d=>{d.textures[0].faces=Array(6).fill({});},
]){
  const next=draw();edit(next);
  assert.deepStrictEqual(cache.compile(next,viewport),Fixed.compile(next,viewport),'state mutation matches uncached lowering');
  assert(cache.plans.size<=2,'bounded cache');
}
// Invalid state must not hit an earlier valid plan; test in-place mutation.
for(const edit of [
  d=>{d.fixedFunction.stages[0].colorOp=999;},
  d=>{d.fixedFunction.alphaFunc=999;},
  d=>{d.fixedFunction.stages[0].transformFlags=1;},
  d=>{d.fixedFunction.stages[0].texCoordIndex=0x10000;},
  d=>{d.attributes[0].usage=0;d.fixedFunction.world=new Float32Array(16).fill(NaN);},
]){
  const next=draw();cache.compile(next,viewport);edit(next);
  assert.throws(()=>cache.compile(next,viewport));
}
// Mixed stages remain on the original linkage compiler, even after a cache hit.
const mixed=draw();mixed.fixedFunction.fog=false;mixed.pixelShader={};
const linked={source:'varying vec4 d3d_color0; void main(){}',version:0xffff0200};
assert.deepStrictEqual(cache.compile(mixed,viewport,linked),Fixed.compile(mixed,viewport,linked));
mixed.fixedFunction.fog=true;
assert.throws(()=>cache.compile(mixed,viewport,linked),/programmed fog/);
const line=draw();line.textures=[];line.attributes.pop();
Object.assign(line.fixedFunction,{fog:false,alphaTest:false});
Object.assign(line.fixedFunction.stages[0],{colorOp:2,colorArg1:0,alphaOp:2,alphaArg1:0});
const linePlan=cache.compile(line,viewport);
assert.deepStrictEqual(linePlan,Fixed.compile(line,viewport));
assert.strictEqual(cache.compile(line,viewport).pixel,linePlan.pixel,'untextured D3DIM lines also reuse plans');
cache.clear();assert.strictEqual(cache.plans.size,0);
console.log('PASS fixed TL plan cache: source reuse, dynamic uniforms, state mutation, validation, linkage and bounded lifetime');
