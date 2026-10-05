'use strict';
const assert=require('assert'),path=require('path'),puppeteer=require('puppeteer'),Shader=require('../lib/d3d9-shader');
const make=(count,start,stride,base=0)=>({stage:'vertex',version:0xfffe0200,instructions:[
 {opcode:1,args:[0xc00f0000,0x90e40000]},
 {opcode:81,args:[0xa00f0000,0,0,0,0]},
 {opcode:1,args:[0xd00f0000,0xa0e40000]},
 {opcode:27,args:[0xf0e40800,0xf0e40000]},
 {opcode:1,args:[0xd00f0000,(0xa0e42000|base)>>>0],relativeAddressBanks:[null,'aL']},
 {opcode:29,args:[]},
 {opcode:48,args:[0xf00f0000,count>>>0,start>>>0,stride>>>0,0]},
].map((x,i)=>({...x,offset:i+1}))});
const opts={experimentalVS20:true};
for(const [c,y,z]of[[0,0,0],[255,255,-128],[1,0,127]])assert(Shader.compileIR(make(c,y,z),opts));
for(const [c,y,z]of[[-1,0,0],[256,0,0],[1,-1,0],[1,256,0],[1,0,-129],[1,0,128]])
 assert.throws(()=>Shader.compileIR(make(c,y,z),opts),/DEFI/);
const dynamic=make(1,0,0);dynamic.instructions.pop();
assert.deepStrictEqual(Shader.compileIR(dynamic,opts).integerUniformRanges,
 [[0,0,255],[1,0,255],[2,-128,127],[3,0,0]].map(([component,min,max])=>({name:'d3d_vs_i0',component,min,max})));
const outside=make(1,0,0);outside.instructions.splice(3,1);outside.instructions.splice(4,1);
assert.throws(()=>Shader.compileIR(outside,opts),/outside LOOP/);
assert.throws(()=>Shader.compileIR(make(1,0,0)),/invalid D3D shader IR/);
(async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-first-run','--no-default-browser-check']});
 try{
  const page=await browser.newPage();await page.addScriptTag({path:path.join(__dirname,'../lib/d3d9-shader.js')});
  const cases=[[0,0,0,0,0],[1,95,0,0,95],[2,127,1,0,128],[3,130,-1,0,128],[255,1,0,0,1],
   [2,0,-1,0,0],[2,255,1,0,0],[1,255,0,0,255],[2,0,1,127,128]];
  const result=await page.evaluate(({cases,programs})=>{
   const out=[];
   for(const version of[1,2]){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
    const gl=canvas.getContext(version===1?'webgl':'webgl2');if(!gl)throw Error('missing GL'+version);
    for(let k=0;k<cases.length;k++){
     let vs=D3D9Shader.compileIR(programs[k],{experimentalVS20:true}).source;
     let ps='precision highp float; varying vec4 d3d_color0; void main(){gl_FragColor=d3d_color0;}';
     if(version===2){vs='#version 300 es\n'+vs.replaceAll('attribute ','in ').replaceAll('varying ','out ');ps='#version 300 es\n'+ps.replace('varying ','in ').replace('void main()', 'out vec4 color; void main()').replace('gl_FragColor','color');}
     const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
     const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,ps),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
     const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);
     const a=gl.getAttribLocation(p,'d3d_v0');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,4,gl.FLOAT,false,0,0);
     for(let i=1;i<256;i++)gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c'+i),i/255,0,0,1);
     gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(64);gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     out.push({version,k,error:gl.getError(),red:Array.from(pixels).filter((_,i)=>i%4===0)});
     gl.deleteBuffer(b);gl.deleteProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    }
   }return out;
  },{cases,programs:cases.map(([c,y,z,b])=>make(c,y,z,b))});
  for(const r of result){assert.strictEqual(r.error,0);assert.deepStrictEqual(r.red,Array(16).fill(cases[r.k][4]),JSON.stringify(r));}
  console.log('PASS private LOOP GLSL '+result.length+' real GL1/2 frames + domain/metadata gates');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
