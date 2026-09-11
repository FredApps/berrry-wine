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
const sign={stage:'vertex',version:0xfffe0200,instructions:[
 {opcode:1,offset:0,args:[d(4),s(1)]},
 {opcode:34,offset:1,args:[d(0),s(1),s(0,2),s(0,3)]},
]};
assert.throws(()=>Shader.compileIR(sign),/invalid D3D shader IR/);
const signSource=Shader.compileIR(sign,{experimentalVS20:true}).source;
assert(!/\br[23]\b/.test(signSource),'SGN scratch operands must not become GLSL value reads');
const typed={stage:'vertex',version:0xfffe0200,instructions:[
 {opcode:1,offset:1,args:[d(4),s(1)]},
 {opcode:47,offset:2,args:[0xe00f080f,0]},
 {opcode:48,offset:3,args:[0xf00f000f,0x80000000,0x7fffffff,0xffffffff,0]},
 {opcode:47,offset:4,args:[0xe00f080f,0x80000000]},
]};
assert.throws(()=>Shader.compileIR(typed),/invalid D3D shader IR/);
const typedSource=Shader.compileIR(typed,{experimentalVS20:true}).source;
assert(typedSource.includes('const bool d3d_vs_b15 = true;'));
assert(typedSource.includes('const highp ivec4 d3d_vs_i15 = ivec4((-2147483647 - 1), 2147483647, -1, 0);'));
assert.strictEqual((typedSource.match(/const bool d3d_vs_b15/g)||[]).length,1,'last definition wins');
assert(typedSource.indexOf('const bool')<typedSource.indexOf('void main()'),'definitions are hoisted');
for(const value of[-1,.5,0x100000000,NaN]){
 const malformed={...typed,instructions:[typed.instructions[0],{opcode:48,offset:2,args:[0xf00f0000,value,0,0,0]}]};
 assert.throws(()=>Shader.compileIR(malformed,{experimentalVS20:true}),/invalid DEFI/);
}
for(const source of[0xe0e40800,0xf0e40000]){
 const ordinary={...typed,instructions:[typed.instructions[0],{opcode:1,offset:2,args:[d(0),source]}]};
 assert.throws(()=>Shader.compileIR(ordinary,{experimentalVS20:true}),/register/,'typed constants are not float arithmetic sources');
}
for(const token of[0xe00f0810,0xe0010800,0xe01f0800,0x800f0000]){
 const bad={...typed,instructions:[typed.instructions[0],{opcode:47,offset:2,args:[token,1]}]};
 assert.throws(()=>Shader.compileIR(bad,{experimentalVS20:true}),/invalid DEFB/);
}
for(const token of[0xf00f0010,0xf0010000,0xf01f0000,0xa00f0000]){
 const bad={...typed,instructions:[typed.instructions[0],{opcode:48,offset:2,args:[token,0,0,0,0]}]};
 assert.throws(()=>Shader.compileIR(bad,{experimentalVS20:true}),/invalid DEFI/);
}
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
  const vectorResults=await page.evaluate(()=>{
   const results=[];
   const fixtures=[
    {name:'crs right hand and W',op:33,mask:7,input:[1,0,0,0],matrix:[0,1,0,0],expected:[.5,.5,1,.8]},
    {name:'crs partial mask',op:33,mask:1,input:[0,1,0,0],matrix:[0,0,1,0],expected:[1,.65,.7,.8]},
    {name:'crs negate',op:33,mask:7,input:[1,0,0,0],matrix:[0,1,0,0],negate:true,expected:[.5,.5,0,.8]},
    {name:'nrm XYZ length scales W',op:36,input:[3,4,0,10],bias:0,expected:[.15,.2,0,.5]},
    {name:'nrm swizzle and negate',op:36,input:[0,3,4,10],swizzle:201,negate:true,bias:.5,expected:[.35,.3,.5,0]},
    {name:'nrm zero XYZ finite W',op:36,input:[0,0,0,1],zero:true,expected:[0,0,0,Math.fround(Math.fround(3.4028234663852886e38*Math.fround(1e-37)))*.025]},
    {name:'pow fractional exponent',op:32,input:[.25,0,0,0],exponent:.5,expected:[.5,.5,.5,.5]},
    {name:'pow abs swizzled base and partial mask',op:32,input:[9,-.5,9,9],swizzle:85,exponent:2,mask:5,expected:[.25,.3,.25,.6]},
    {name:'pow source negation and negative exponent',op:32,input:[.5,0,0,0],negate:true,exponent:2,exponentNegate:true,scale:.125,expected:[.5,.5,.5,.5]},
    // Explicit finite-input adapter policy, not a native-driver zero oracle.
    {name:'pow zero exponent',op:32,input:[0,0,0,0],exponent:0,scale:.5,expected:[.5,.5,.5,.5]},
    {name:'pow negative zero exponent',op:32,input:[-.5,0,0,0],exponent:-0,scale:.5,expected:[.5,.5,.5,.5]},
    // NORMAL exponent avoids a driver flushing it to zero. Amplification
    // also distinguishes using standalone LOG's finite -FLT_MAX sentinel.
    {name:'pow zero tiny positive exponent',op:32,input:[0,0,0,0],exponent:1e-37,scale:1e10,expected:[0,0,0,0]},
    {name:'pow negative zero positive exponent',op:32,input:[-0,0,0,0],exponent:2,expected:[0,0,0,0]},
    {name:'pow zero negative exponent infinity',op:32,input:[0,0,0,0],exponent:-2,infinite:true,expected:[1,1,1,1]},
    {name:'pow negative zero negative exponent infinity',op:32,input:[-0,0,0,0],exponent:-2,infinite:true,expected:[1,1,1,1]},
    {name:'sgn signs and signed zeros',op:34,input:[-2,3,0,-0],expected:[0,1,.5,.5]},
    {name:'sgn swizzle and negate',op:34,input:[-2,0,3,-0],swizzle:27,negate:true,expected:[.5,0,.5,1]},
    {name:'sgn partial mask preserves YW',op:34,mask:5,input:[-2,3,4,-5],expected:[0,.65,1,.8]},
    {name:'sgn finite extremes',op:34,input:[-3.4028234663852886e38,3.4028234663852886e38,-1e-37,1e-37],expected:[0,1,0,1]},
    {name:'sgn infinities',op:34,input:[-Infinity,Infinity,0,-0],expected:[0,1,.5,.5]},
    {name:'sincos zero XY and preserved W',op:37,mask:3,input:[0,0,0,0],expected:[1,.5,.7,.8]},
    {name:'sincos positive half pi XY',op:37,mask:3,input:[Math.PI/2,0,0,0],expected:[.5,1,.7,.8]},
    {name:'sincos positive half pi X',op:37,mask:1,input:[Math.PI/2,0,0,0],expected:[.5,.65,.7,.8]},
    {name:'sincos negative half pi Y',op:37,mask:2,input:[-Math.PI/2,0,0,0],expected:[.6,0,.7,.8]},
    {name:'sincos W swizzle and NEG',op:37,mask:3,swizzle:255,negate:true,input:[9,9,9,Math.PI/2],expected:[.5,0,.7,.8]},
    {name:'typed definitions false and signed integers',op:47,boolean:0,ints:[-3,2,0,1],expected:[0,1,1,1]},
    {name:'typed definitions noncanonical true and signed integers',op:47,boolean:0x80000000,ints:[3,-2,0,-1],expected:[1,1,1,1]},
   ];
   for(const version of[1,2])for(const fixture of fixtures){
    const instructions=[{opcode:1,offset:1,args:[0xc00f0000,0x90e40000]}];
    const src=(0x90000001|((fixture.swizzle??([32,37].includes(fixture.op)?0:228))<<16)|(fixture.negate?0x01000000:0))>>>0;
    if(fixture.op===47){
     instructions.push({opcode:1,offset:2,args:[0xd00f0000,0x90e40001]},
      {opcode:47,offset:3,args:[0xe00f080f,fixture.boolean?0:1]},
      {opcode:48,offset:4,args:[0xf00f000f,0,0,0,0]},
      // Definitions following executable instructions still hoist; last wins.
      {opcode:47,offset:5,args:[0xe00f080f,fixture.boolean]},
      {opcode:48,offset:6,args:[0xf00f000f,...fixture.ints.map(v=>v>>>0)]});
    }else if(fixture.op===32){
     instructions.push({opcode:1,offset:2,args:[0x800f0000,0xa0e40002]},
      {opcode:32,offset:3,args:[0x80000000|((fixture.mask??15)<<16),src,(0xa0ff0003|(fixture.exponentNegate?0x01000000:0))>>>0]},
      fixture.infinite?{opcode:12,offset:4,args:[0xd00f0000,0xa0e40000,0x80e40000]}:
       {opcode:5,offset:4,args:[0xd00f0000,0x80e40000,0xa0e40000]});
    }else if(fixture.op===37){
     instructions.push({opcode:1,offset:2,args:[0x800f0000,0xa0e40002]},
      {opcode:37,offset:3,args:[0x80000000|(fixture.mask<<16),src,0xa0e40003,0xa0e40004]},
      // VS2 leaves unwritten XYZ undefined: redefine them before observing
      // color. W alone must retain its preinstruction value.
      {opcode:1,offset:4,args:[0x80000000|((7^fixture.mask)<<16),0xa0e40002]},
      {opcode:5,offset:5,args:[0x800f0001,0x80e40000,0xa0e40000]},
      {opcode:2,offset:6,args:[0xd00f0000,0x80e40001,0xa0e40001]});
    }else if(fixture.op===34){
     // r2/r3 are undefined scratch outputs, not initialized value sources.
     instructions.push({opcode:1,offset:2,args:[0x800f0000,0xa0e40002]},
      {opcode:34,offset:3,args:[0x80000000|((fixture.mask??15)<<16),src,0x80e40002,0x80e40003]},
      {opcode:5,offset:4,args:[0x800f0001,0x80e40000,0xa0e40000]},
      {opcode:2,offset:5,args:[0xd00f0000,0x80e40001,0xa0e40001]});
    }else if(fixture.op===33){
     instructions.push({opcode:1,offset:2,args:[0x800f0000,0xa0e40002]},
      {opcode:33,offset:3,args:[0x80000000|(fixture.mask<<16),src,0xa0e40003]},
      {opcode:5,offset:4,args:[0x800f0001,0x80e40000,0xa0e40000]},
      {opcode:2,offset:5,args:[0xd00f0000,0x80e40001,0xa0e40001]});
    }else{
     instructions.push({opcode:36,offset:2,args:[0x800f0000,src]});
     if(fixture.zero)instructions.push({opcode:5,offset:3,args:[0xd00f0000,0x80e40000,0xa0e40000]});
     else instructions.push({opcode:5,offset:3,args:[0x800f0001,0x80e40000,0xa0e40000]},
      {opcode:2,offset:4,args:[0xd00f0000,0x80e40001,0xa0e40001]});
    }
    let vs=D3D9Shader.compileIR({stage:'vertex',version:0xfffe0200,instructions},{experimentalVS20:true}).source;
    if(fixture.op===47){
     // Test-only consumer until real flow instructions are admitted. Compare
     // small exact integers as integers, not through a float conversion.
     const witness=`d3d_color0 = vec4(d3d_vs_b15 ? 1.0 : 0.0, d3d_vs_i15.x == ${fixture.ints[0]} ? 1.0 : 0.0, d3d_vs_i15.y == ${fixture.ints[1]} ? 1.0 : 0.0, all(equal(d3d_vs_i15.zw, ivec2(${fixture.ints[2]}, ${fixture.ints[3]}))) ? 1.0 : 0.0);`;
     vs=vs.replace(/\}\s*$/,witness+'\n}');
    }
    let ps='precision highp float; varying vec4 d3d_color0; void main(){gl_FragColor=d3d_color0;}';
    // Keep the second scale across the raster interface: a driver can legally
    // reassociate two VS products into a subnormal multiplier and flush it.
    if(fixture.zero)ps=ps.replace('gl_FragColor=d3d_color0','gl_FragColor=d3d_color0/40.0');
    if(version===2){vs='#version 300 es\n'+vs.replaceAll('attribute ','in ').replaceAll('varying ','out ');
     ps='#version 300 es\n'+ps.replace('varying ','in ').replace('void main()','out vec4 outputColor; void main()').replace('gl_FragColor','outputColor');}
    const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
    const gl=canvas.getContext(version===2?'webgl2':'webgl');if(!gl)throw Error('missing vector GL'+version);
    const compile=(type,source)=>{const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);
     if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;};
    const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,ps),p=gl.createProgram();
    gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(p,'d3d_v0');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,4,gl.FLOAT,false,0,0);
    const input=gl.getAttribLocation(p,'d3d_v1');if(input>=0){gl.disableVertexAttribArray(input);gl.vertexAttrib4f(input,...(fixture.input||[0,0,0,0]));}
    const scalar=(n,x)=>gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c'+n),x,x,x,x);
    scalar(0,fixture.op===32?(fixture.infinite?3.4028234663852886e38:fixture.scale??1):[33,34,37].includes(fixture.op)?.5:fixture.zero?1e-37:.25);
    scalar(1,[33,34,37].includes(fixture.op)?.5:fixture.zero?.025:fixture.bias);
    gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c2'),.2,.3,.4,.6);
    if(fixture.matrix)gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c3'),...fixture.matrix);
    if(fixture.op===32)scalar(3,fixture.exponent);
    if(fixture.op===37){
     // Signed half-angle Taylor coefficients derived from the DDI's
     // mathematical expansion, NOT independently verified SDK macro bytes.
     // Its coefficient table conflicts with its Taylor formula at -1/8.
     gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c3'),-1/(5040*128),-1/(720*64),1/(24*16),1/(120*32));
     gl.uniform4f(gl.getUniformLocation(p,'d3d_vs_c4'),-1/(6*8),-1/8,1,.5);
    }
    gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(64);gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    results.push({version,name:fixture.name,expected:fixture.expected.map(x=>Math.round(x*255)),pixels:Array.from(pixels),error:gl.getError()});
    gl.deleteBuffer(buffer);gl.deleteProgram(p);gl.deleteShader(v);gl.deleteShader(f);gl.getExtension('WEBGL_lose_context')?.loseContext();
   }return results;
  });
  for(const result of vectorResults){assert.strictEqual(result.error,0);result.pixels.forEach((actual,i)=>
   assert(Math.abs(actual-result.expected[i%4])<=1,JSON.stringify({result,i,actual})));}
  console.log('Private VS2 GLSL PASS '+results.length+' rounding/constant +8 LOG +8 EXPP +2 LRP +'+vectorResults.length+' vector/typed-definition actual WebGL1/2 pixel cases');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
