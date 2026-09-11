'use strict';
const assert=require('assert'),path=require('path'),puppeteer=require('puppeteer');
const {bootRenderHarness}=require('./render-helper');
const IR=require('../lib/d3d-shader-ir'),Shader=require('../lib/d3d9-shader');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:'(export "compile20" (func $d3d_shader_ir_compile20))'});
 const blocks=[];const alloc=bytes=>{const guest=e.guest_alloc(bytes)>>>0;assert(guest);blocks.push(guest);return e.guest_to_wasm(guest)>>>0;};
 const put=values=>{const p=alloc(values.length*4);new Uint32Array(memory.buffer,p,values.length).set(values);return p;};
 const fbits=x=>new Uint32Array(new Float32Array([x]).buffer)[0];
 const D=(bank,index=0,mask=15)=>(0x80000000|bank<<28|mask<<16|index)>>>0;
 const S=(bank,index=0,swizzle=228,relative=false)=>(0x80000000|bank<<28|swizzle<<16|index|(relative?8192:0))>>>0;
 const ins=(op,...args)=>[(args.length<<24)|op,...args];
 const constants=[0,1,2,94,95,96,126,127,128,129,130,254,255];
 const value=i=>[Math.fround(i/255),.25,.75,1];
 const make=base=>[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80000005,D(1,1)),
  ...constants.flatMap(i=>ins(81,D(2,i),...value(i).map(fbits))),
  ...ins(46,D(3,0,1),S(1,1,0)),...ins(1,D(0),S(2,base,228,true),S(3,0,0)),
  ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
 const inputs=[[-4,-4,0,1],[8,-4,0,1],[-4,8,0,1]];
 const cases=[[95,0,95],[127,0,127],[255,0,255],[95.5,0,96],[127.5,0,128],
  [.5,128,128],[1.5,128,130],[2.5,128,130],[-.5,128,128],[-1.5,128,126],[-2.5,128,126],[-1,0,-1],[128,128,-1]];
 const programs=new Map(),frames=[];
 const psTokens=[0xffff0101,1,D(0),S(1),65535],psIR=e.d3d_shader_ir_compile(put(psTokens),psTokens.length);
 assert(psIR);const ps=e.d3d_shader_vm_compile(psIR);assert(ps);e.d3d_shader_ir_free(psIR);
 try{
  for(const base of[0,128]){
   const tokens=make(base),source=put(tokens),p=e.compile20(source,tokens.length);assert(p,`IR error ${e.d3d_shader_ir_error()}`);
   assert.strictEqual(e.d3d_shader_ir_compile(source,tokens.length),0,'public token profile gate');
   assert.strictEqual(e.d3d_shader_vm_compile(p),0,'public packet profile gate');
   assert.throws(()=>IR.read(memory.buffer,p),/layout bounds/);
   const ir=IR.read(memory.buffer,p,{experimentalVS20:true});
   assert.throws(()=>Shader.compileNativeIR(ir,{experimentalVS20:true}),/not enabled|layout bounds/);
   const lowered=Shader.compileIR(ir,{experimentalVS20:true}),program=e.d3d_shader_vm_compile_vs20(p);assert(program);
   new Uint32Array(memory.buffer,source,tokens.length).fill(0);e.d3d_shader_ir_free(p);
   programs.set(base,{program,bytes:Array.from(ir.nativeBytes),lowered});
  }
  for(const [address,base,index]of cases){
   const {program}=programs.get(base),color=index<0?[0,0,0,0]:value(index);
   // Native VM output is inspected before rasterization, proving MOVA affects
   // real positions as well as final colors, including signed halfway inputs.
   const ctx=e.d3d_shader_vm_context(program,7);assert(ctx);const f=new Float32Array(memory.buffer);
   for(let c=0;c<4;c++)for(let lane=0;lane<3;lane++)f[(ctx+32+128*64+c*16)/4+lane]=inputs[lane][c];
   f.fill(address,(ctx+32+129*64)/4,(ctx+32+129*64)/4+4);
   assert.strictEqual(e.d3d_shader_vm_run(ctx,4096),0);
   for(let c=0;c<4;c++)for(let lane=0;lane<3;lane++)assert.strictEqual(f[(ctx+32+512*64+c*16)/4+lane],Math.fround(inputs[lane][c]+color[c]));
   e.d3d_shader_vm_free(ctx);
   const vertices=alloc(3*48),target=alloc(8*8*4),desc=alloc(128);
   new Float32Array(memory.buffer,vertices,36).set(inputs.flatMap(pos=>[...pos,address,0,0,1,0,0,0,1]));
   new Uint8Array(memory.buffer,target,256).fill(0xa5);
   const words=new Uint32Array(memory.buffer,desc,32);words.fill(0);
   words.set([0x44535031,1,8,8,target,32,0,0,vertices,3,48,0,3,program,ps,0,0,0,0,0,0,8,8]);
   new Float32Array(memory.buffer,desc,32)[24]=1;words[26]=8;words[27]=15;words[28]=1;
   const raster=e.d3d_software_create(desc);assert(raster,'private VS program enters actual native raster');
   let status=1;while(status===1)status=e.d3d_software_step(raster,32);assert.strictEqual(status,0);e.d3d_software_free(raster);
   const native=Array.from(new Uint8Array(memory.buffer,target,256)),rgba=[];
   for(let i=0;i<256;i+=4)rgba.push(native[i+2],native[i+1],native[i],native[i+3]);
   assert.deepStrictEqual(rgba,Array.from({length:64},()=>color.map(v=>Math.round(v*255))).flat());
   frames.push({address,base,index,rgba});
  }
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-first-run','--no-default-browser-check']});
  try{const page=await browser.newPage();for(const file of['d3d-shader-ir.js','d3d9-shader.js'])await page.addScriptTag({path:path.join(__dirname,'../lib',file)});
   const results=await page.evaluate(({programs,frames,inputs})=>{
    const results=[];
    for(const version of[1,2]){const canvas=document.createElement('canvas');canvas.width=canvas.height=8;
     const gl=canvas.getContext(version===2?'webgl2':'webgl');if(!gl)throw Error('missing GL'+version);
     const cache=new Map();
     for(const [base,record]of programs){const bytes=new Uint8Array(record.bytes),ir=D3DShaderIR.read(bytes.buffer,0,{experimentalVS20:true});
      let vs=D3D9Shader.compileIR(ir,{experimentalVS20:true}).source;
      if(vs!==record.lowered.source)throw Error('same immutable IR must lower identically after transport');
      let fs='precision highp float; varying vec4 d3d_color0; void main(){gl_FragColor=d3d_color0;}';
      if(version===2){vs='#version 300 es\n'+vs.replaceAll('attribute ','in ').replaceAll('varying ','out ');
       fs='#version 300 es\n'+fs.replace('varying ','in ').replace('void main()','out vec4 result; void main()').replace('gl_FragColor','result');}
      const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));cache.set(base,{p,v,f});
     }
     const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(inputs.flat()),gl.STATIC_DRAW);
     for(const frame of frames){const {p}=cache.get(frame.base);gl.useProgram(p);
      const pos=gl.getAttribLocation(p,'d3d_v0');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,4,gl.FLOAT,false,0,0);
      const addr=gl.getAttribLocation(p,'d3d_v1');gl.disableVertexAttribArray(addr);gl.vertexAttrib4f(addr,frame.address,0,0,1);
      gl.clearColor(.5,.5,.5,.5);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
      const pixels=new Uint8Array(256);gl.readPixels(0,0,8,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      results.push({version,address:frame.address,base:frame.base,pixels:Array.from(pixels),error:gl.getError()});
     }
     gl.deleteBuffer(buffer);for(const {p,v,f}of cache.values()){gl.deleteProgram(p);gl.deleteShader(v);gl.deleteShader(f);}
    }return results;
   },{programs:Array.from(programs),frames,inputs});
   for(const result of results){assert.strictEqual(result.error,0);const expected=frames.find(f=>f.base===result.base&&f.address===result.address);
    assert.deepStrictEqual(result.pixels,expected.rgba,JSON.stringify({version:result.version,address:result.address,base:result.base}));}
   console.log('PASS actual native VS2 IR -> SIMD positions/raster -> WebGL1/2: '+results.length+' full frames; public gates preserved');
  }finally{await browser.close();}
 }finally{for(const record of programs.values())e.d3d_shader_vm_free(record.program);e.d3d_shader_vm_free(ps);for(const guest of blocks)e.guest_free(guest);}
})().catch(error=>{console.error(error);process.exitCode=1;});
