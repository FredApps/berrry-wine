'use strict';
// Private lowering only. Public token/native compilation must still reject VS2.
const assert=require('assert'),path=require('path'),puppeteer=require('puppeteer');
const Shader=require('../lib/d3d9-shader'),IR=require('../lib/d3d-shader-ir');
const d=(b,n=0,m=15)=>(0x80000000|b<<28|m<<16|n)>>>0;
const s=(b,n=0)=>(0x80e40000|b<<28|n)>>>0;
const make=base=>({stage:'vertex',version:0xfffe0200,irVersion:1,length:12,instructions:[
 {opcode:1,offset:1,args:[d(4),s(1)]},
 {opcode:46,offset:4,args:[d(3,0,1),s(1,1)]},
 {opcode:1,offset:7,args:[d(5),s(2,base)|0x2000]},
]});
const shader=make(0);
assert.throws(()=>Shader.compileIR(shader),/invalid D3D shader IR/);
assert.throws(()=>Shader.compile(new Uint32Array([0xfffe0200,65535])),/unsupported shader version/);
const lowered=Shader.compileIR(shader,{experimentalVS20:true});
assert(lowered.uniforms.includes('d3d_vs_c255'));
assert.strictEqual(lowered.uniforms.length,256);
assert(lowered.source.includes('tie * mod(base, vec4(2.0))'));
const point=make(0);point.instructions.push({opcode:1,offset:10,args:[d(4,2,1)|0x00100000,s(1)]});
assert(Shader.compileIR(point,{experimentalVS20:true}).source.includes('clamp('),
 'native-admitted private point-size saturation has GLSL lowering');
const bad=make(0);bad.instructions[1].args[0]=d(0);
assert.throws(()=>Shader.compileIR(bad,{experimentalVS20:true}),/MOVA requires/);
// The projection option is explicit and does not open the production handoff.
const bytes=new Uint32Array(8);bytes.set([0x44534952,1,0,0xfffe0200,0,2,32,0]);
assert.throws(()=>IR.read(bytes.buffer,0),/layout bounds/);
assert.strictEqual(IR.read(bytes.buffer,0,{experimentalVS20:true}).version,0xfffe0200);
assert.throws(()=>Shader.compileNativeIR({irVersion:1,nativeBytes:new Uint8Array(bytes.buffer)},
 {experimentalVS20:true}),/layout bounds|not enabled/);
(async()=>{
 const browser=await puppeteer.launch({headless:true,
  executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--no-first-run','--no-default-browser-check']});
 try{
  const page=await browser.newPage();
  await page.addScriptTag({path:path.join(__dirname,'../lib/d3d9-shader.js')});
  const cases=[[-1,0,0],[.49,0,0],[.5,0,0],[1.5,0,2],[2.5,0,2],
   [95.5,0,96],[127.5,0,128],[254.6,0,255],[255.6,0,0],[-1.5,128,126],[-2.5,128,126]];
  const results=await page.evaluate(({shader,cases})=>{
   const results=[];
   for(const version of[1,2]){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
    const gl=canvas.getContext(version===2?'webgl2':'webgl');if(!gl)throw Error('missing GL'+version);
    for(const [address,base,expected]of cases){
     const input=structuredClone(shader);input.instructions[2].args[1]=(0xa0e42000|base)>>>0;
     let vs=D3D9Shader.compileIR(input,{experimentalVS20:true}).source;
     let ps='precision highp float; varying vec4 d3d_color0; void main(){gl_FragColor=d3d_color0;}';
     if(version===2){vs='#version 300 es\n'+vs.replaceAll('attribute ','in ').replaceAll('varying ','out ');
      ps='#version 300 es\n'+ps.replace('varying ','in ').replace('void main()', 'out vec4 outputColor; void main()').replace('gl_FragColor','outputColor');}
     const compile=(type,source)=>{const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;};
     const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,ps),p=gl.createProgram();
     gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
     if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
     const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
     gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);
     const pos=gl.getAttribLocation(p,'d3d_v0');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,4,gl.FLOAT,false,0,0);
     const addr=gl.getAttribLocation(p,'d3d_v1');gl.disableVertexAttribArray(addr);gl.vertexAttrib4f(addr,address,0,0,0);
     for(let i=0;i<256;i++)gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c'+i),i/255,0,0,1);
     gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(64);gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     results.push({version,address,base,expected,red:Array.from(pixels).filter((_,i)=>i%4===0),error:gl.getError()});
     gl.deleteBuffer(buffer);gl.deleteProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    }
   }return results;
  },{shader,cases});
  for(const result of results){assert.strictEqual(result.error,0);assert.deepStrictEqual(result.red,Array(16).fill(result.expected),JSON.stringify(result));}
  const logResults=await page.evaluate(()=>{
   const results=[];
   const shader={stage:'vertex',version:0xfffe0101,instructions:[
    {opcode:1,offset:1,args:[0xc00f0000,0x90e40000]},
    {opcode:15,offset:2,args:[0x800f0000,0x90000001]},
    {opcode:5,offset:3,args:[0x800f0000,0x80e40000,0xa0e40000]},
    {opcode:13,offset:4,args:[0xd00f0000,0x80e40000,0xa0e40001]},
   ]};
   // Multiplication by a NORMAL f32 avoids dependence on subnormal handling:
   // -FLT_MAX * 1e-37 is about -34.03 (>= -35); -Infinity stays below -35.
   // Replay the old unguarded expression as a red control, not merely a string check.
   for(const kind of['log','expp','lrp'])for(const version of[1,2])for(const negativeZero of kind==='lrp'?[false]:[false,true])for(const old of kind==='lrp'?[false]:[false,true]){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
    const gl=canvas.getContext(version===2?'webgl2':'webgl');if(!gl)throw Error('missing LOG GL'+version);
    // EXPP uses actual profile-specific lowering, not an injected reference:
    // VS1 emits (2^floor(x), fract(x), 2^x, 1), VS2 replicates 2^x.
    const selected=kind==='log'?shader:kind==='lrp'?{...shader,version:0xfffe0200,instructions:[
     shader.instructions[0],{opcode:1,offset:2,args:[0x800f0000,0x90000001]},
     {opcode:18,offset:3,args:[0x800f0001,0x80e40000,0xa0e40000,0xa0e40000]},
     {opcode:12,offset:4,args:[0xd00f0000,0x80e40001,0xa0e40001]},
    ]}:{...shader,version:old?0xfffe0101:0xfffe0200,instructions:[
     shader.instructions[0],{opcode:78,offset:2,args:[0x800f0000,0x90000001]},
     {opcode:5,offset:3,args:[0xd00f0000,0x80e40000,0xa0e40000]},
    ]};
    let vs=D3D9Shader.compileIR(selected,{experimentalVS20:kind==='lrp'||kind==='expp'&&!old}).source;
    if(old&&kind==='log')vs=vs.replace(/^vec4 result2 = .*$/m,'vec4 result2 = vec4(log2(abs(d3d_v1.x)));');
    let ps='precision highp float; varying vec4 d3d_color0; void main(){gl_FragColor=d3d_color0;}';
    if(version===2){vs='#version 300 es\n'+vs.replaceAll('attribute ','in ').replaceAll('varying ','out ');
     ps='#version 300 es\n'+ps.replace('varying ','in ').replace('void main()','out vec4 outputColor; void main()').replace('gl_FragColor','outputColor');}
    const compile=(type,source)=>{const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);
     if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;};
    const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,ps),p=gl.createProgram();
    gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(p,'d3d_v0');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,4,gl.FLOAT,false,0,0);
    const value=kind==='lrp'?2:kind==='log'?(negativeZero?-0:0):(negativeZero?-1.5:1.5);
    const input=gl.getAttribLocation(p,'d3d_v1');gl.disableVertexAttribArray(input);gl.vertexAttrib4f(input,value,0,0,0);
    // LRP: equal finite endpoints must remain finite even with weight2.
    // The legacy weighted-sum evaluation overflows its first product here.
    const scale=kind==='lrp'?2e38:kind==='log'?1e-37:.25;
    gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c0'),scale,scale,scale,scale);
    const threshold=kind==='lrp'?3e38:-35;
    gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c1'),threshold,threshold,threshold,threshold);
    gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(64);gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    results.push({kind,version,negativeZero,old,error:gl.getError(),pixels:Array.from(pixels)});
    gl.deleteBuffer(buffer);gl.deleteProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
   }return results;
  });
  for(const result of logResults){assert.strictEqual(result.error,0);
   if(result.kind==='log'||result.kind==='lrp')assert.deepStrictEqual(result.pixels,Array(64).fill(result.old?0:255),JSON.stringify(result));
   else{
    const value=result.negativeZero?-1.5:1.5;
    const expected=(result.old?[2**Math.floor(value),value-Math.floor(value),2**value,1]:Array(4).fill(2**value))
     .map(v=>Math.round(v*.25*255));
    result.pixels.forEach((actual,i)=>assert(Math.abs(actual-expected[i%4])<=1,JSON.stringify({result,expected,i,actual})));
   }
  }
  console.log('Private VS2 GLSL PASS '+results.length+' real WebGL1/2 rounding/constant cases; LOG signed-zero PASS8 current/old pixel oracles; EXPP profiles PASS8 pixel cases; LRP finite endpoints PASS2 pixel cases');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
