(function(root){
 'use strict';
 function draw(fillMode=3){
  const positions=fillMode===3?[[-1,-1],[17,-1],[-1,17]]:[[2,2],[6,2],[2,6]];
  return {primitive:4,primitiveCount:1,stride:16,vertices:new Uint8Array(new Float32Array(positions.flatMap(p=>[...p,.5,1])).buffer),
   attributes:[{register:0,usage:9,usageIndex:0,type:3,offset:0}],vertexShader:null,pixelShader:null,textures:[],
   state:{zenable:false,cull:1,fillMode},fixedFunction:{lighting:false,specular:false,fog:false,textureFactor:0xffffffff,
    stages:[{colorOp:2,colorArg1:6,colorArg2:1,alphaOp:2,alphaArg1:6,alphaArg2:1,constant:0xffff0000,texCoordIndex:0,transformFlags:0},{colorOp:1}]}};
 }
 function cases(){return[
  {enabled:true,left:1,top:2,right:5,bottom:7},
  {enabled:true,left:0,top:0,right:8,bottom:1},
  {enabled:true,left:7,top:1,right:8,bottom:8},
  {enabled:true,left:3,top:3,right:3,bottom:6},
  {enabled:false,left:1,top:1,right:2,bottom:2},
 ];}
 const api={draw,cases};if(typeof module!=='undefined')module.exports=api;else root.D3D9ScissorCases=api;
})(typeof globalThis!=='undefined'?globalThis:this);
