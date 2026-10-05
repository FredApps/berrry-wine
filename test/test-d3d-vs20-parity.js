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
 const constants=[0,1,2,94,95,96,...Array.from({length:9},(_,i)=>126+i),252,253,254,255];
 const value=i=>[Math.fround(i/255),.25,.75,1];
 const make=base=>[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80000005,D(1,1)),
  ...constants.flatMap(i=>ins(81,D(2,i),...value(i).map(fbits))),
  ...ins(46,D(3,0,1),S(1,1,0)),...ins(1,D(0),S(2,base,228,true),S(3,0,0)),
  ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
 const inputs=[[-4,-4,0,1],[8,-4,0,1],[-4,8,0,1]];
 const cases=[[95,0,95],[127,0,127],[255,0,255],[95.5,0,96],[127.5,0,128],
  [.5,128,128],[1.5,128,130],[2.5,128,130],[-.5,128,128],[-1.5,128,126],[-2.5,128,126],[-1,0,-1],[128,128,-1]];
 const sources=new Map([[0,make(0)],[128,make(128)]]);
 const positionTolerances=new Map();
 for(const vector of[[1,0,0,0],[.25,.125,.0625,.125]])for(const [op,rows]of[[20,4],[21,3],[22,4],[23,3],[24,2]])for(const [relative,base,address,first]of[[false,127,0,127],[true,127,1.5,129],[true,252,3,255]]){
  const key=`matrix${op}/${relative}/${base}/${vector.join(',')}`;
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80000005,D(1,1)),...ins(31,0x80010005,D(1,2)),
   ...constants.flatMap(i=>ins(81,D(2,i),...value(i).map(fbits))),
   ...ins(46,D(3,0,1),S(1,1,0)),...ins(1,D(0),S(1,2)),
   ...ins(op,D(0,0,(1<<rows)-1),S(1,2),S(2,base,228,relative),...(relative?[S(3,0,0)]:[])),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
  // Independent row dot products distinguish three/four-component matrices.
  // Unwritten z/w retain initialization, rather than invented zero/one values.
  const expected=vector.slice(),columns=op<=21?4:3;
  for(let row=0;row<rows;row++){let dot=0;const values=first+row<256?value(first+row):[0,0,0,0];
   for(let c=0;c<columns;c++)dot=Math.fround(dot+Math.fround(values[c]*vector[c]));expected[row]=dot;}
  sources.set(key,tokens);cases.push([address,key,expected,vector]);
 }
 // Arithmetic uses exact binary expectations away from UNORM half ties. Both
 // backends consume the detached IR produced by the same native token decoder.
 for(const [op,vector,expected,mask=15]of[
  [14,[-2,9,9,9],[.25,.25,.25,.25]],
  [15,[2,9,9,9],[1,1,1,1]],
  [16,[.25,.0625,9,.5],[1,.25,.25,1]],
  [17,[.125,.5,.75,.25],[1,.25,.75,.75]],
  [18,[.25,.25,.75,1],[.25,.375,.625,.25]],
  [78,[-2,9,9,9],[.25,.25,.25,.25]],
  [79,[2,9,9,9],[1,1,1,1]],
  [33,[0,1,0,.25],[.25,0,0,.25],7],
  [36,[0,0,4,1],[0,0,1,.25]],
  [36,[0,0,0,0],[0,0,0,0]],
 ]){
  const key=`arithmetic${op}/${vector.join(',')}`,scalar=[14,15,78,79].includes(op);
  const b=op===33?[0,0,.25,99]:op===17?[1,.5,.25,.75]:[1,.75,.5,.25],c=[0,.25,1,.5];
  const args=[S(1,2,scalar?0:228)];if(op===17||op===18||op===33)args.push(S(2,255));
  if(op===18)args.push(S(0,2));
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80010005,D(1,2)),
   ...ins(81,D(2,255),...b.map(fbits)),...ins(81,D(2,254),...c.map(fbits)),
   ...ins(1,D(0,2),S(2,254)),...ins(1,D(0),S(1,2)),...ins(op,D(0,0,mask),...args),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
  sources.set(key,tokens);cases.push([0,key,expected,vector]);
 }
 // POW keeps its exponent in a different register, while deliberately
 // overwriting the initialized base. Exact binary results distinguish abs,
 // both scalar selectors, reciprocal powers, and exponent-zero behavior.
 for(const [name,vector,baseComponent,exponent,exponentComponent,result]of[
  ['negative-base',[-.5,9,9,9],0,[9,2,9,9],1,.25],
  ['negative-exponent',[9,9,-4,9],2,[9,9,9,-1],3,.25],
  ['fractional-exponent',[9,.0625,9,9],1,[.5,9,9,9],0,.25],
  ['zero-exponent',[9,9,9,-.5],3,[9,9,0,9],2,1],
  ['zero-to-zero',[0,9,9,9],0,[0,9,9,9],0,1],
 ]){
  const key=`pow32/${name}`;assert(!sources.has(key));
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80010005,D(1,2)),
   ...ins(81,D(2,255),...exponent.map(fbits)),...ins(1,D(0),S(1,2)),
   ...ins(32,D(0),S(0,0,baseComponent*85),S(2,255,exponentComponent*85)),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
  sources.set(key,tokens);cases.push([0,key,Array(4).fill(result),vector]);
 }
 // Map signs (-1,0,+1) to exact (.25,.5,.75); negative results must
 // influence observable pixels rather than disappear through UNORM clamping.
 for(const [name,vector,swizzle,negate,signs]of[
  ['signed',[-4,0,2,-0],228,false,[-1,0,1,0]],
  ['reverse-negate',[-4,0,2,1],27,true,[-1,-1,0,1]],
 ]){
  const key=`sgn34/${name}`;assert(!sources.has(key));
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80010005,D(1,2)),
   ...ins(81,D(2,255),...Array(4).fill(.25).map(fbits)),
   ...ins(81,D(2,254),...Array(4).fill(.5).map(fbits)),
   ...ins(34,D(0),S(1,2,swizzle)|(negate?1<<24:0),S(0,10),S(0,11)),
   ...ins(5,D(0),S(0),S(2,255)),...ins(2,D(0),S(0),S(2,254)),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
  sources.set(key,tokens);cases.push([0,key,signs.map(x=>x*.25+.5),vector]);
 }
 // SINCOS's unwritten XYZ are undefined in VS2, so reconstruct those channels
 // explicitly while proving that the preinitialized W survives. An affine
 // color map avoids UNORM half ties at the zero/quarter-turn boundaries.
 // Signed Taylor coefficients inferred from Microsoft's SINCOS Instruction
 // Format source-register formulas (its later pseudocode has conflicting
 // signs and a -1/16 term conflicting with the half-angle Taylor -1/8).
 // Official SDK macro links are unavailable. Mathematical lowering
 // does not consume them: this is NOT coefficient-expansion conformance.
 const sincosCoefficients=[[-1/(5040*128),-1/(720*64),1/(24*16),1/(120*32)],[-1/(6*8),-1/(2*4),1,.5]];
 for(const angle of[0,Math.fround(Math.PI/2),Math.fround(-Math.PI/2)])for(const mask of[1,2,3]){
  const key=`sincos37/${angle}/${mask}`;assert(!sources.has(key));
  const vector=[9,angle,9,9],expected=[mask&1?Math.cos(angle)*.25+.625:.625,mask&2?Math.sin(angle)*.25+.625:.625,.25,.75];
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80010005,D(1,2)),
   ...sincosCoefficients.flatMap((values,i)=>ins(81,D(2,254+i),...values.map(fbits))),
   ...ins(81,D(2,252),...Array(4).fill(.25).map(fbits)),
   ...ins(81,D(2,253),...[.625,.625,.25,.75].map(fbits)),
   ...ins(1,D(0,0,8),S(2,253)),...ins(37,D(0,0,mask),S(1,2,85),S(2,254),S(2,255)),
   ...ins(5,D(0,0,mask),S(0),S(2,252)),...ins(2,D(0,0,mask),S(0),S(2,253)),
   ...ins(1,D(0,0,7^mask),S(2,253)),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
  sources.set(key,tokens);positionTolerances.set(key,2e-6);cases.push([0,key,expected,vector]);
 }
 // Branches consume the exact same retained native IR on both backends.
 // Definitions intentionally follow the executable branches they control.
 const branchColors=[[.25,.375,.625,.75],[.75,.625,.375,.25],[.125,.25,.75,.875]];
 for(const [name,condition,nested,noElse,chosen]of[
  ['late-true',2,false,false,0],['late-false',0,false,false,1],
  ['nested-inner-false',1,true,false,2],['nested-outer-false',0,true,false,1],
  ['no-else-true',1,false,true,0],['no-else-false',0,false,true,1],
 ]){
  const key=`if40/${name}`,body=[];
  const emit=(op,...args)=>body.push(...ins(op,...args));
  if(noElse)emit(1,D(0),S(2,253));
  emit(40,0xe0e40800);
  if(nested){emit(40,0xe0e40801);emit(1,D(0),S(2,252));emit(42);emit(1,D(0),S(2,254));emit(43);}
  else emit(1,D(0),S(2,252));
  if(!noElse){emit(42);emit(1,D(0),S(2,253));}emit(43);
  emit(2,D(4),S(1),S(0));emit(1,D(5),S(0));
  emit(47,0xe00f0800,condition);if(nested)emit(47,0xe00f0801,0);
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),
   ...branchColors.flatMap((values,i)=>ins(81,D(2,252+i),...values.map(fbits))),...body,65535];
  sources.set(key,tokens);cases.push([0,key,branchColors[chosen]]);
 }
 for(const [name,count,innerIf,outerIf]of[
  ['zero',0,false,false],['one',1,false,false],['three',3,false,false],['maximum',255,false,false],
  ['false-if-inside',3,true,false],['inside-false-if',3,false,true],
 ]){
  const key=`rep38/${name}`,body=[];const emit=(op,...args)=>body.push(...ins(op,...args));
  emit(1,D(0),S(2,252));if(outerIf)emit(40,0xe0e40800);
  emit(38,0xf0e4000f);if(innerIf)emit(40,0xe0e40800);
  emit(2,D(0,0,1),S(0),S(2,253));
  if(innerIf)emit(43);emit(39);if(outerIf)emit(43);
  emit(2,D(4),S(1),S(0));emit(1,D(5),S(0));
  emit(48,0xf00f000f,count,0x80000000,0x7fffffff,0xffffffff);
  if(innerIf||outerIf)emit(47,0xe00f0800,0);
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),
   ...ins(81,D(2,252),...[.25,.375,.625,.75].map(fbits)),
   ...ins(81,D(2,253),...[1/1024,9,9,9].map(fbits)),...body,65535];
  sources.set(key,tokens);cases.push([0,key,[.25+(innerIf||outerIf?0:count/1024),.375,.625,.75]]);
 }
 // aL gathers distinguish signed stride and cross the physical c127/c128
 // storage boundary. All arithmetic is binary-exact, including native pixels.
 for(const [name,count,start,stride,innerIf,outerIf]of[
  ['forward-crossing',2,127,1,false,false],
  ['reverse-crossing',2,128,-1,false,false],
  ['zero-stride',3,128,0,false,false],
  ['zero-count',0,127,1,false,false],
  ['false-if-inside',2,127,1,true,false],
  ['inside-false-if',2,127,1,false,true],
 ]){
  const key=`loop27/${name}`,body=[],emit=(op,...args)=>body.push(...ins(op,...args));
  emit(1,D(0),S(2,252));if(outerIf)emit(40,0xe0e40800);
  emit(27,0xf0e40800,0xf0e4000f);if(innerIf)emit(40,0xe0e40800);
  emit(1,D(0,1),S(2,0,228,true),0xf0000800); // r1 = c[aL]
  emit(2,D(0,0,1),S(0),S(0,1));
  if(innerIf)emit(43);emit(29);if(outerIf)emit(43);
  emit(2,D(4),S(1),S(0));emit(1,D(5),S(0));
  // Last definition wins despite appearing after its executable consumer.
  emit(48,0xf00f000f,0,0,0,0);
  emit(48,0xf00f000f,count,start,stride>>>0,0);
  if(innerIf||outerIf)emit(47,0xe00f0800,0);
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),
   ...ins(81,D(2,252),...[.25,.375,.625,.75].map(fbits)),
   ...ins(81,D(2,127),...[1/32,0,0,0].map(fbits)),
   ...ins(81,D(2,128),...[1/16,0,0,0].map(fbits)),...body,65535];
  let red=.25;
  if(!innerIf&&!outerIf)for(let i=0;i<count;i++)red+=start+i*stride===127?1/32:1/16;
  sources.set(key,tokens);cases.push([0,key,[red,.375,.625,.75]]);
 }
 // Component metadata must survive native IR transport independently of the
 // value swizzle. Every nonempty MOVA mask is exercised on real GPU pixels.
 const addressVector=[1.5,-.5,2.5,-1.5],addressOffsets=[2,0,2,-2];
 for(let mask=1;mask<16;mask++)for(let component=0;component<4;component++)if(mask&(1<<component)){
  const key=`vector-a0/${mask}/${component}`;
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80010005,D(1,2)),
   ...constants.flatMap(i=>ins(81,D(2,i),...value(i).map(fbits))),
   ...ins(46,D(3,0,mask),S(1,2)),
   ...ins(1,D(0),S(2,128,228,true),S(3,0,component*85)),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
  sources.set(key,tokens);cases.push([0,key,value(128+addressOffsets[component]),addressVector]);
 }
 for(let component=0;component<4;component++)for(const calleeWrites of [false,true]){
  const key=`call-vector/${component}/${calleeWrites}`,label=0xa0e41001;
  const write=ins(46,D(3,0,1<<component),S(1,2));
  const read=ins(1,D(0),S(2,128,228,true),S(3,0,component*85));
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80010005,D(1,2)),
   ...constants.flatMap(i=>ins(81,D(2,i),...value(i).map(fbits))),
   ...(calleeWrites?[]:write),...ins(25,label),...(calleeWrites?read:[]),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),...ins(28),
   ...ins(30,label),...(calleeWrites?write:read),...ins(28),65535];
  sources.set(key,tokens);cases.push([0,key,value(128+addressOffsets[component]),addressVector]);
 }
 for(const truth of [0,0x80000000])for(const negate of [false,true]){
  const key=`callnz/${truth}/${negate}`,label=0xa0e41001;
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),
   ...ins(81,D(2,0),...[.25,.375,.625,.75].map(fbits)),
   ...ins(81,D(2,1),...[.125,0,0,0].map(fbits)),...ins(47,0xe00f0800,truth),
   ...ins(1,D(0),S(2)),...ins(26,label,negate?0xede40800:0xe0e40800),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),...ins(28),
   ...ins(30,label),...ins(2,D(0),S(0),S(2,1)),...ins(28),65535];
  sources.set(key,tokens);cases.push([0,key,[.25+((truth!==0)!==negate?.125:0),.375,.625,.75]]);
 }
 for(let component=0;component<4;component++){
  const key=`matrix-vector-a0/${component}`;
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),...ins(31,0x80010005,D(1,2)),
   ...constants.flatMap(i=>ins(81,D(2,i),...value(i).map(fbits))),
   ...ins(81,D(2,3),...[1,0,0,0].map(fbits)),...ins(1,D(0,1),S(2,3)),
   ...ins(46,D(3,0,1<<component),S(1,2)),
   ...ins(20,D(0),S(0,1),S(2,128,228,true),S(3,0,component*85)),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),65535];
  sources.set(key,tokens);cases.push([0,key,Array.from({length:4},(_,row)=>value(128+addressOffsets[component]+row)[0]),addressVector]);
 }
 for(const localLoop of [false,true]){
  const key=`call-aL/${localLoop}`,label=0xa0e41001;
  const loop=ins(27,0xf0e40800,0xf0e40000),end=ins(29);
  const read=ins(1,D(0),S(2,0,228,true),0xf0000800);
  const tokens=[0xfffe0200,...ins(31,0x80000000,D(1)),
   ...ins(81,D(2,127),...value(127).map(fbits)),...ins(81,D(2,128),...value(128).map(fbits)),
   ...ins(48,0xf00f0000,2,127,1,0),...ins(1,D(0),S(2,127)),
   ...(localLoop?[]:loop),...ins(25,label),...(localLoop?[]:end),
   ...ins(2,D(4),S(1),S(0)),...ins(1,D(5),S(0)),...ins(28),
   ...ins(30,label),...(localLoop?loop:[]),...read,...(localLoop?end:[]),...ins(28),65535];
  sources.set(key,tokens);cases.push([0,key,value(128)]);
 }
 const programs=new Map(),frames=[];
 const psTokens=[0xffff0101,1,D(0),S(1),65535],psIR=e.d3d_shader_ir_compile(put(psTokens),psTokens.length);
 assert(psIR);const ps=e.d3d_shader_vm_compile(psIR);assert(ps);e.d3d_shader_ir_free(psIR);
 try{
  for(const [base,tokens]of sources){
   const source=put(tokens),p=e.compile20(source,tokens.length);assert(p,`IR error ${e.d3d_shader_ir_error()}`);
   assert.strictEqual(e.d3d_shader_ir_compile(source,tokens.length),0,'public token profile gate');
   assert.strictEqual(e.d3d_shader_vm_compile(p),0,'public packet profile gate');
   assert.throws(()=>IR.read(memory.buffer,p),/layout bounds/);
   const ir=IR.read(memory.buffer,p,{experimentalVS20:true});
   assert.throws(()=>Shader.compileNativeIR(ir,{experimentalVS20:true}),/not enabled|layout bounds/);
   const lowered=Shader.compileIR(ir,{experimentalVS20:true}),program=e.d3d_shader_vm_compile_vs20(p);assert(program);
   new Uint32Array(memory.buffer,source,tokens.length).fill(0);e.d3d_shader_ir_free(p);
   programs.set(base,{program,bytes:Array.from(ir.nativeBytes),lowered});
  }
  for(const [address,base,index,vector=[1,0,0,0]]of cases){
   const {program}=programs.get(base),color=Array.isArray(index)?index:index<0?[0,0,0,0]:value(index);
   // Native VM output is inspected before rasterization, proving MOVA affects
   // real positions as well as final colors, including signed halfway inputs.
   const ctx=e.d3d_shader_vm_context(program,7);assert(ctx);const f=new Float32Array(memory.buffer);
   for(let c=0;c<4;c++)for(let lane=0;lane<3;lane++)f[(ctx+32+128*64+c*16)/4+lane]=inputs[lane][c];
   f.fill(address,(ctx+32+129*64)/4,(ctx+32+129*64)/4+4);
   for(let c=0;c<4;c++)f.fill(vector[c],(ctx+32+130*64+c*16)/4,(ctx+32+130*64+c*16)/4+4);
   assert.strictEqual(e.d3d_shader_vm_run(ctx,4096),0);
   for(let c=0;c<4;c++)for(let lane=0;lane<3;lane++){
    const actual=f[(ctx+32+512*64+c*16)/4+lane],expected=Math.fround(inputs[lane][c]+color[c]);
    if(positionTolerances.has(base))assert(Math.abs(actual-expected)<=positionTolerances.get(base),`${base} position ${actual} vs ${expected}`);
    else assert.strictEqual(actual,expected);
   }
   e.d3d_shader_vm_free(ctx);
   const vertices=alloc(3*48),target=alloc(8*8*4),desc=alloc(128);
   new Float32Array(memory.buffer,vertices,36).set(inputs.flatMap(pos=>[...pos,address,0,0,1,...vector]));
   new Uint8Array(memory.buffer,target,256).fill(0xa5);
   const words=new Uint32Array(memory.buffer,desc,32);words.fill(0);
   words.set([0x44535031,1,8,8,target,32,0,0,vertices,3,48,0,3,program,ps,0,0,0,0,0,0,8,8]);
   new Float32Array(memory.buffer,desc,32)[24]=1;words[26]=8;words[27]=15;words[28]=1;
   const raster=e.d3d_software_create(desc);assert(raster,'private VS program enters actual native raster');
   let status=1;while(status===1)status=e.d3d_software_step(raster,32);assert.strictEqual(status,0);e.d3d_software_free(raster);
   const native=Array.from(new Uint8Array(memory.buffer,target,256)),rgba=[];
   for(let i=0;i<256;i+=4)rgba.push(native[i+2],native[i+1],native[i],native[i+3]);
   assert.deepStrictEqual(rgba,Array.from({length:64},()=>color.map(v=>Math.round(v*255))).flat());
   frames.push({address,base,index,rgba,vector});
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
      const addr=gl.getAttribLocation(p,'d3d_v1');if(addr>=0){gl.disableVertexAttribArray(addr);gl.vertexAttrib4f(addr,frame.address,0,0,1);}
      const vector=gl.getAttribLocation(p,'d3d_v2');if(vector>=0){gl.disableVertexAttribArray(vector);gl.vertexAttrib4f(vector,...frame.vector);}
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
