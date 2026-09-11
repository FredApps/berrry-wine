(function(root){'use strict';
 const sampler={addressU:3,addressV:3,min:1,mag:1,mip:0};
 const level=r=>({width:r.width,height:r.height,resource:r});
 function draw(texture,uv=[.25,.25,0,1],programmed=false){return {primitive:4,primitiveCount:1,stride:32,
  vertices:new Uint8Array(new Float32Array([-1,-1,.5,1,...uv,31,-1,.5,1,...uv,-1,31,.5,1,...uv]).buffer),
  attributes:[{register:0,usage:9,usageIndex:0,type:3,offset:0},{register:7,usage:5,usageIndex:0,type:3,offset:16}],
  vertexShader:null,pixelShader:programmed?new Uint32Array([0xffff0101,66,0xb00f0000,1,0x800f0000,0xb0e40000,0xffff]):null,
  textures:[texture],depthAttachment:null,state:{zenable:false,zwrite:false,cull:1},fixedFunction:{lighting:false,specular:false,fog:false,textureFactor:0xffffffff,
   stages:[{colorOp:2,colorArg1:2,colorArg2:1,alphaOp:2,alphaArg1:2,alphaArg2:1,constant:0xffffffff,texCoordIndex:0,transformFlags:0},{colorOp:1}]}};}
 async function run(api){let count=0;const check=(v,s)=>{if(!v)throw Error(s);count++;};
  const solid=async(expected,label)=>{const frame=await api.read(null);check(frame.pixels.every((v,i)=>Math.abs(v-expected[i%4])<=1),label+' got '+Array.from(frame.pixels.slice(0,4)));};
  const a={id:401,width:2,height:2,format:21},b={id:402,width:1,height:1,format:21};
  await api.create(a);await api.create(b);
  const pattern=new Uint8Array([0,0,255,255,0,255,0,128,255,0,0,64,255,255,255,255]);
  await api.update(a,pattern,8);await api.update(b,new Uint8Array([13,47,89,255]),4);
  const texture={...level(a),sampler};
  for(const programmed of[false,true])for(let corner=0;corner<4;corner++){
   await api.draw(draw(texture,[corner%2?.75:.25,corner>1?.75:.25,0,1],programmed));
   await solid(Array.from(pattern.slice(corner*4,corner*4+4)),`orientation ${programmed}/${corner}`);
  }
  await api.draw(draw(texture));const copies=api.copies?.();await api.draw(draw(texture));await solid([0,0,255,255],'repeat cached sample');
  if(copies!==undefined)check(api.copies()===copies,'unchanged resource reuses assembled GPU texture');
  await api.clear([0,1,1,.5],1,1,null,null,0,a);await api.draw(draw(texture));await solid([255,255,0,128],'clear invalidates cached sample');
  const feedback=draw(texture);feedback.colorAttachment=a;let rejected=false;
  try{await api.draw(feedback);}catch(e){rejected=/feedback/i.test(e.message);}check(rejected,'feedback explicitly rejected');
  check((await api.read(a)).pixels.every((v,i)=>Math.abs(v-[255,255,0,128][i%4])<=1),'feedback preserves source');
  const mixed={width:2,height:2,levels:[level(a),{width:1,height:1,pixels:new Uint8Array([91,51,17,255])}],sampler:{...sampler,mip:1,maxMipLevel:1}};
  await api.draw(draw(mixed));await solid([17,51,91,255],'mixed CPU mip selected');
  mixed.levels[1]=level(b);await api.draw(draw(mixed));await solid([13,47,89,255],'resource mip selected');
  const hardware={...mixed,sampler:{...sampler,mip:1}},minified=draw(hardware),vf=new Float32Array(minified.vertices.buffer);
  vf[4]=vf[5]=0;vf[12]=32;vf[13]=0;vf[20]=0;vf[21]=32;
  await api.draw(minified);await solid([13,47,89,255],'hardware mip selection from gradients');
  const render=draw({...level(b),sampler});render.colorAttachment=a;await api.draw(render);
  await api.draw(draw(texture));await solid([13,47,89,255],'rendering into alias invalidates assembled texture');
  await api.update(a,pattern,8);await api.draw(draw(texture));await solid([0,0,255,255],'upload invalidates assembled texture');
  const colors=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255],[255,0,255,255],[0,255,255,255]];
  const dirs=[[1,0,0,1],[-1,0,0,1],[0,1,0,1],[0,-1,0,1],[0,0,1,1],[0,0,-1,1]];
  const cube={width:1,height:1,faces:colors.map((pixels,i)=>i===0?level(b):{width:1,height:1,pixels:new Uint8Array(pixels)}),sampler};
  for(const programmed of[false,true])for(let face=0;face<6;face++){await api.draw(draw(cube,dirs[face],programmed));const c=colors[face];await solid(face===0?[13,47,89,255]:[c[2],c[1],c[0],c[3]],'mixed cube face '+face+'/'+programmed);}
  await api.release(a.id);let stale=false;try{await api.draw(draw(texture));}catch(e){stale=true;}check(stale,'released alias cannot sample cached image');
  await api.release(b.id);return count;
 }
 const api={run,draw,level};if(typeof module!=='undefined')module.exports=api;else root.D3D9ColorAliasCases=api;
})(typeof globalThis!=='undefined'?globalThis:this);
