'use strict';
const assert=require('assert'),path=require('path'),puppeteer=require('puppeteer'),Shader=require('../lib/d3d9-shader');
const bits=x=>new Uint32Array(new Float32Array([x]).buffer)[0],label=0xa0e41000;
const I=(opcode,...args)=>({opcode,args});
const def=(n,v)=>I(81,0xa00f0000|n,...v.map(bits));
const make=(body,sub,extras=[])=>({stage:'vertex',version:0xfffe0200,instructions:[
 def(0,[.125,.25,.5,1]),def(1,[.125,0,0,0]),
 I(1,0xc00f0000,0x90e40000),I(1,0x800f0000,0xa0e40000),...body,
 I(1,0xd00f0000,0x80e40000),I(28),I(30,label),...sub,I(28),...extras,
].map((ins,i)=>({...ins,offset:i+1}))});
const add=I(2,0x80010000,0x80e40000,0xa0e40001),opts={experimentalVS20:true};
const fixtures=[];
for(const [name,body,sub,extras,red]of[
 ['twice',[I(25,label),I(25,label)],[add],[],96],
 ['false',[I(26,label,0xe0e40800)],[add],[I(47,0xe00f0800,0)],32],
 ['true',[I(26,label,0xe0e40800)],[add],[I(47,0xe00f0800,2)],64],
 ['not-false',[I(26,label,0xede40800)],[add],[I(47,0xe00f0800,0)],64],
 ['not-true',[I(26,label,0xede40800)],[add],[I(47,0xe00f0800,1)],32],
 ['callee-a0',[I(25,label),I(1,0x80010000,0xa0e42000)],
  [I(46,0xb0010000,0xa0000002)],[def(2,[1,0,0,0])],32],
 ['caller-a0',[I(46,0xb0010000,0xa0000002),I(25,label)],
  [I(1,0x80010000,0xa0e42000)],[def(2,[1,0,0,0])],32],
 ['inherited-al',[I(27,0xf0e40800,0xf0e40000),I(25,label),I(29)],
  [{...I(1,0x80010000,0xa0e42000),relativeAddressBanks:[null,'aL']}],
  [I(48,0xf00f0000,2,127,1,0),def(127,[.75,0,0,0]),def(128,[.375,0,0,0])],96],
 ])fixtures.push({name,shader:make(body,sub,extras),expected:[red,64,128,255]});
for(const f of fixtures){assert(Shader.compileIR(f.shader,opts));assert.throws(()=>Shader.compileIR(f.shader),/invalid D3D shader IR/);}
const many=make(Array.from({length:32},()=>I(25,label)),[add]);
const singleSource=Shader.compileIR(make([I(25,label)],[add]),opts).source;
const manySource=Shader.compileIR(many,opts).source;
assert.strictEqual((manySource.match(/void d3d_label_0\(/g)||[]).length,1);
assert(manySource.length-singleSource.length<1600,'callsite growth stays linear without body cloning');
for(const bad of [make([I(25,label+1)],[add]),make([I(25,label)],[I(25,label)]),
 make([I(26,label,0xe1e40800)],[add]),
 make([I(25,label)],[{...I(1,0x80010000,0xa0e42000),relativeAddressBanks:[null,'aL']}]),
 make([I(26,label,0xe0e40800),I(1,0x80010000,0xa0e42000)],[I(46,0xb0010000,0xa0000001)])])
 assert.throws(()=>Shader.compileIR(bad,opts),/CALL|call|aL|a0|Boolean/);
(async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-first-run','--no-default-browser-check']});
 try{const page=await browser.newPage();await page.addScriptTag({path:path.join(__dirname,'../lib/d3d9-shader.js')});
  const result=await page.evaluate(fixtures=>{
   const out=[];
   for(const version of [1,2]){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
    const gl=canvas.getContext(version===1?'webgl':'webgl2');if(!gl)throw Error('missing GL'+version);
    for(const fixture of fixtures){
     let vs=D3D9Shader.compileIR(fixture.shader,{experimentalVS20:true}).source;
     let fs='precision highp float;varying vec4 d3d_color0;void main(){gl_FragColor=d3d_color0;}';
     if(version===2){vs='#version 300 es\n'+vs.replaceAll('attribute ','in ').replaceAll('varying ','out ');
      fs='#version 300 es\n'+fs.replace('varying ','in ').replace('void main()','out vec4 color;void main()').replace('gl_FragColor','color');}
     const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)+'\n'+source);return s;};
     const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
     const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);
     const a=gl.getAttribLocation(p,'d3d_v0');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,4,gl.FLOAT,false,0,0);
     gl.drawArrays(gl.TRIANGLES,0,3);const pixel=new Uint8Array(4);gl.readPixels(1,1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
     out.push({version,name:fixture.name,pixel:Array.from(pixel),expected:fixture.expected,error:gl.getError()});
     gl.deleteBuffer(b);gl.deleteProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    }
   }return out;
  },fixtures);
  for(const r of result){assert.strictEqual(r.error,0);r.expected.forEach((v,i)=>assert(Math.abs(r.pixel[i]-v)<=1,JSON.stringify(r)));}
  console.log('PASS private CALL/CALLNZ shared registers, a0/aL, RET epilogue, linear source: '+result.length+' GL1/2 frames');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
