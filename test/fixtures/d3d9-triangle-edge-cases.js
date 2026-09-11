(function(root){'use strict';
 // Test-only independent implementation of Microsoft's integer-center,
 // top-left rule. No production coverage decision is made in JavaScript.
 function mask(points,width,height){let [a,b,c]=points;const edge=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  if(edge(a,b,c)<0)[b,c]=[c,b];const edges=[[a,b],[b,c],[c,a]];
  return Array.from({length:width*height},(_,i)=>edges.every(([u,v])=>{const e=edge(u,v,[i%width,Math.floor(i/width)]);return e>0||e===0&&(v[1]<u[1]||v[1]===u[1]&&v[0]>u[0]);}));
 }
 const cases=[
  ['top-horizontal',[[0,0],[4,0],[0,3]],4,3],
  ['top-horizontal-reversed',[[0,0],[0,3],[4,0]],4,3],
  ['bottom-horizontal',[[0,0],[4,3],[0,3]],4,3],
  ['left-vertical',[[1,0],[4,2],[1,4]],8,8],
  ['right-vertical',[[4,0],[4,4],[1,2]],8,8],
  ['shared-diagonal-first',[[0,0],[5,0],[5,5]],8,8],
  ['shared-diagonal-second',[[0,5],[0,0],[5,5]],8,8],
  ['fractional',[[.5,.5],[4.5,.5],[.5,4.5]],8,8],
  ['viewport-clipped',[[-2,1],[10,1],[3,9]],8,8],
  ['offset-viewport',[[2,1],[6,1],[2,4]],8,8,{x:2,y:1,width:4,height:3,minZ:0,maxZ:1}],
  ['nonunit-w',[[0,0,2],[8,0,2],[0,8,2]],8,8],
  ['varying-w',[[0,0,.5],[8,0,2],[0,8,4]],8,8],
  ['varying-w-fractional',[[.5,.5,4],[6.5,.5,.5],[.5,6.5,2]],8,8]
 ];
 function draw(points,width,height,clip=false,viewport){const vp=viewport||{x:0,y:0,width,height};
  const vertices=new Float32Array(points.flatMap(([x,y,w=1])=>clip?[((x-vp.x)*2/vp.width-1)*w,(1-(y-vp.y)*2/vp.height)*w,.5*w,w]:[x,y,.5,1/w]));
  return {primitive:4,primitiveCount:1,stride:16,vertices:new Uint8Array(vertices.buffer),attributes:[{register:0,usage:clip?0:9,usageIndex:0,type:3,offset:0}],
   vertexShader:clip?new Uint32Array([0xfffe0101,1,0xc00f0000,0x90e40000,1,0xd00f0000,0x90e40000,0xffff]):null,pixelShader:null,textures:[],depthAttachment:null,
   viewport,state:{cull:1,zenable:false,zwrite:false},fixedFunction:{lighting:false,specular:false,fog:false,textureFactor:0xffffffff,
    stages:[{colorOp:2,colorArg1:6,colorArg2:1,alphaOp:2,alphaArg1:6,alphaArg2:1,constant:0xffffffff,texCoordIndex:0,transformFlags:0},{colorOp:1}]}};
 }
 function viewportSequence(){return [[0,0,8,8],[2,1,4,4],[0,0,8,8],[1,2,4,4]].map(([x,y,width,height])=>({
  viewport:{x,y,width,height,minZ:0,maxZ:1},points:[[x+.5,y+.5,.5],[x+width-.5,y+.5,2],[x+.5,y+height-.5,4]]}));}
 // Independent analytic polygons, not a JavaScript copy of homogeneous clipping.
 // For near/far the projected Z plane cuts the two axis-aligned edges halfway.
 function clippingCases(){const result=[];
  const raw=(points,w,z)=>points.map(([x,y],i)=>[(x/4-1)*w[i],(1-y/4)*w[i],z[i]*w[i],w[i]]);
  for(const w of[[1,1,1],[.5,2,4]]){
   for(const [name,z]of[['near',[-.5,.5,.5]],['far',[1.5,.5,.5]]])
    result.push({name:name+'/'+w.join(),vertices:raw([[0,0],[8,0],[0,8]],w,z),polygon:[[0,4],[4,0],[8,0],[0,8]]});
   const source=[[-4,2],[6,2],[6,7]],polygon=[[0,4],[0,2],[6,2],[6,7]];
   for(const [name,transform]of[['left',([x,y])=>[x,y]],['right',([x,y])=>[8-x,y]],['top',([x,y])=>[y,x]],['bottom',([x,y])=>[y,8-x]]])
    result.push({name:name+'/'+w.join(),vertices:raw(source.map(transform),w,[.5,.5,.5]),polygon:polygon.map(transform)});
   result.push({name:'fully-near-rejected/'+w.join(),vertices:raw([[0,0],[8,0],[0,8]],w,[-1,-1,-1]),polygon:[]});
   result.push({name:'near-and-left/'+w.join(),vertices:raw([[-4,0],[8,0],[0,8]],w,[-.5,.5,.5]),polygon:[[0,2],[2,0],[8,0],[0,8]]});
   result.push({name:'on-near-plane/'+w.join(),vertices:raw([[0,0],[8,0],[0,8]],w,[0,.5,.5]),polygon:[[0,0],[8,0],[0,8]]});
  }
  // Eye-plane intersections are specified directly in homogeneous space.
  // The retained finite projected hulls below follow from the side/near planes.
  result.push({name:'negative-w',vertices:[[0,0,-.5,-1],[-.5,-.5,.5,1],[.5,-.5,.5,1]],polygon:[[8,8],[0,8],[2,6],[6,6]]});
  result.push({name:'nonzero-w-zero',vertices:[[0,.5,-.5,0],[-.5,-.5,.5,1],[.5,-.5,.5,1]],polygon:[[6,4],[2,4],[2,6],[6,6]]});
  return result;
 }
 function polygonMask(polygon,width,height){const result=Array(width*height).fill(false);
  for(let i=1;i+1<polygon.length;i++){const triangle=mask([polygon[0],polygon[i],polygon[i+1]],width,height);triangle.forEach((v,j)=>{result[j] ||= v;});}return result;
 }
 const api={cases,mask,draw,viewportSequence,clippingCases,polygonMask};if(typeof module!=='undefined')module.exports=api;else root.D3D9TriangleEdges=api;
})(typeof globalThis!=='undefined'?globalThis:this);
