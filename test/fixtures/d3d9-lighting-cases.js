(function(root){
 'use strict';
 const f=a=>new Float32Array(a),identity=()=>f([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 function draw(){
  const vertices=new Float32Array(3*15);
  [[-1,1,.5],[3,1,.5],[-1,-3,.5]].forEach((p,i)=>vertices.set([...p,0,0,1,.5,.25,.125,.75,.25,.5,.75,.25,0],i*15));
  return {primitive:4,primitiveCount:1,stride:60,vertices:new Uint8Array(vertices.buffer),vertexShader:null,pixelShader:null,textures:[],
   attributes:[{register:0,usage:0,usageIndex:0,type:2,offset:0},{register:3,usage:3,usageIndex:0,type:2,offset:12},
    {register:5,usage:10,usageIndex:0,type:3,offset:24},{register:6,usage:10,usageIndex:1,type:3,offset:40}],
   state:{zenable:false,cull:1},fixedFunction:{lighting:true,specular:false,fog:false,colorVertex:true,diffuseMaterialSource:0,
    ambientMaterialSource:0,emissiveMaterialSource:0,ambientColor:0,normalizeNormals:false,
    world:identity(),view:identity(),projection:identity(),textureFactor:0xffffffff,
    material:{diffuse:f([.5,.25,.125,.75]),ambient:f([0,0,0,0]),emissive:f([0,0,0,0]),specular:f([0,0,0,0]),power:0},
    lights:[{type:3,diffuse:f([1,1,1,0]),ambient:f([0,0,0,0]),direction:f([0,0,-1])}],
    stages:[{colorOp:2,colorArg1:0,colorArg2:1,alphaOp:2,alphaArg1:0,alphaArg2:1,texCoordIndex:0,transformFlags:0,constant:0xffffffff},{colorOp:1}]}};
 }
 function cases(){const out=[];const add=(name,edit,expected)=>{const d=draw();edit(d,d.fixedFunction);out.push({name,draw:d,expected});};
  add('front directional',()=>{},[128,64,32,191]);
  add('back directional',(d,s)=>s.lights[0].direction[2]=1,[0,0,0,191]);
  add('perpendicular',(d,s)=>s.lights[0].direction=f([1,0,0]),[0,0,0,191]);
  for(const normalize of[false,true])add('normal length '+normalize,(d,s)=>{s.normalizeNormals=normalize;const v=new Float32Array(d.vertices.buffer);for(let i=0;i<3;i++)v[i*15+5]=.5;},normalize?[128,64,32,191]:[64,32,16,191]);
  add('light direction normalized',(d,s)=>s.lights[0].direction[2]=-7,[128,64,32,191]);
  add('global ambient and emissive',(d,s)=>{s.lights=[];s.ambientColor=0xff804020;s.material.ambient=f([.5,1,1,0]);s.material.emissive=f([.125,.125,.125,0]);},[96,96,64,191]);
  add('light ambient',(d,s)=>{s.lights[0].diffuse.fill(0);s.lights[0].ambient=f([.25,.5,.75,1]);s.material.ambient=f([.5,.5,.5,0]);},[32,64,96,191]);
  add('eight lights',(d,s)=>{s.lights=Array.from({length:8},()=>({type:3,direction:f([0,0,-1]),diffuse:f([.125,.125,.125,1]),ambient:f([0,0,0,0])}));},[128,64,32,191]);
  for(const source of[0,1,2])add('diffuse source '+source,(d,s)=>{s.diffuseMaterialSource=source;s.material.diffuse=f([1,0,0,.5]);},[[255,0,0,128],[128,64,32,191],[64,128,191,64]][source]);
  add('COLORVERTEX off',(d,s)=>{s.diffuseMaterialSource=2;s.colorVertex=false;},[128,64,32,191]);
  add('missing COLOR2 falls back',(d,s)=>{s.diffuseMaterialSource=2;d.attributes=d.attributes.filter(a=>a.register!==6);},[128,64,32,191]);
  add('ambient COLOR2',(d,s)=>{s.lights=[];s.ambientColor=0xffffffff;s.ambientMaterialSource=2;},[64,128,191,191]);
  add('emissive COLOR1',(d,s)=>{s.lights=[];s.emissiveMaterialSource=1;},[128,64,32,191]);
  add('inverse transpose world',(d,s)=>{s.world[10]=2;s.projection[10]=.5;},[64,32,16,191]);
  add('inverse transpose normalized',(d,s)=>{s.world[10]=2;s.projection[10]=.5;s.normalizeNormals=true;},[128,64,32,191]);
  for(const length of[0,1e-30,1e30])add('degenerate direction '+length,(d,s)=>s.lights[0].direction[2]=length,[0,0,0,191]);
  return out;
 }
 const api={draw,cases};if(typeof module!=='undefined')module.exports=api;else root.D3D9LightingCases=api;
})(typeof globalThis!=='undefined'?globalThis:this);
