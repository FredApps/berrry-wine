'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const {Bridge}=require('../lib/d3d9-host');
(async()=>{
 let bridge;
 const names=['SetFVF','SetRenderState','CreateVertexDeclaration','SetVertexDeclaration','CreateVertexShader','SetVertexShader','DrawPrimitiveUP','Present','Release'];
 const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraHostOverrides:{gpu_gl_call:(op,p,a)=>bridge.call(op,p,a)},extraWat:`
 (func (export "create") (param $pp i32) (param $out i32) (result i32)
  (global.set $esp (i32.const 0x00300000))
  (call $gs32 (i32.add (global.get $esp) (i32.const 24)) (local.get $pp))
  (call $gs32 (i32.add (global.get $esp) (i32.const 28)) (local.get $out))
  (call $handle_IDirect3D9_CreateDevice (i32.const 0) (i32.const 0) (i32.const 1) (i32.const 1) (i32.const 0) (i32.const 0)) (global.get $eax))
 (func (export "clear") (param $d i32) (result i32)
  (global.set $esp (i32.const 0x00300000))
  (call $gs32 (i32.add (global.get $esp) (i32.const 24)) (i32.const 1065353216))
  (call $gs32 (i32.add (global.get $esp) (i32.const 28)) (i32.const 0))
  (call $handle_IDirect3DDevice9_Clear (local.get $d) (i32.const 0) (i32.const 0) (i32.const 1) (i32.const -16777216) (i32.const 0)) (global.get $eax))
 (func (export "bits") (param $d i32) (result i32) (load.field DxObject misc1 (call $d3ddev_rt_entry (local.get $d))))
 ${names.map(n=>`(func (export "${n}") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (result i32)
  (global.set $esp (i32.const 0x00300000))
  (call $handle_IDirect3DDevice9_${n} (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0)) (global.get $eax))`).join('\n')}`});
 const wa=p=>e.guest_to_wasm(p)>>>0,alloc=n=>e.guest_alloc(n)>>>0;
 let descriptors=0;
 const native={...e,d3d_software_create(p){
  const d=new Uint32Array(memory.buffer,p,32);assert.strictEqual(d[1],4,'PSIZE uses explicit input ABI4');
  const original=d[31],stride=d[10];
  d[31]=original|0x1000000;assert.strictEqual(e.d3d_software_create(p),0,'reserved PSIZE map bits reject');
  d[31]=(original&0xfffff)|((d[29]&15)<<20);assert.strictEqual(e.d3d_software_create(p),0,'duplicate PSIZE register rejects');
  d[31]=original;d[10]=48;assert.strictEqual(e.d3d_software_create(p),0,'missing PSIZE bytes reject');d[10]=stride;
  descriptors++;return e.d3d_software_create(p);
 }};
 bridge=new Bridge({backend:'software',enableProgrammable:true,getExports:()=>native,getMemory:()=>memory.buffer,guestToWasm:wa});
 e.init_dx_com_thunks();
 const pp=alloc(56),out=alloc(4),vertices=alloc(72),v=new DataView(memory.buffer);
 new Uint32Array(memory.buffer,wa(pp),14).set([8,8,21,1,0,0,1,1,1,0,0,0,0,0x80000000]);
 const ok=(x,label)=>assert.strictEqual(x>>>0,0,label+': '+bridge.lastError);
 ok(e.create(pp,out),'CreateDevice');const device=e.guest_read32(out)>>>0;
 for(const [state,value]of [[8,1],[22,1],[7,0],[137,0],[154,0],[155,0],[166,1065353216]])ok(e.SetRenderState(device,state,value,0,0),'point state');
 function fill(transformed){const stride=transformed?24:20;
  [[1.4,1.4,.2],[5.4,1.4,1],[1.4,5.4,2]].forEach(([x,y,size],i)=>{
   const p=wa(vertices)+i*stride;
   [transformed?x:x/4-1,transformed?y:1-y/4,.5,...(transformed?[1]:[]),size].forEach((n,j)=>v.setFloat32(p+j*4,n,true));
   v.setUint32(p+stride-4,0xffff0000,true);
  });return stride;
 }
 function pixels(stride,label){ok(e.clear(device),'Clear');ok(e.DrawPrimitiveUP(device,4,1,vertices,stride),label);ok(e.Present(device,0,0,0,0),'Present');
  const frame=new Uint32Array(memory.buffer,e.bits(device)>>>0,64);
  const red=Array.from(frame,(n,i)=>n===0xffff0000?i:-1).filter(i=>i>=0);
  assert.deepStrictEqual(red,[13,41],label+' uses each vertex size and clamps cap1, not POINTSIZE=0');
 }
 for(const transformed of [false,true]){ok(e.SetFVF(device,transformed?0x64:0x62,0,0,0),'FVF PSIZE');pixels(fill(transformed),transformed?'XYZRHW PSIZE':'XYZ PSIZE');}
 const decl=alloc(32);new Uint8Array(memory.buffer,wa(decl),32).set([
  0,0,0,0,3,0,9,0, 0,0,16,0,0,0,4,0, 0,0,20,0,4,0,10,0, 255,0,0,0,17,0,0,0]);
 ok(e.CreateVertexDeclaration(device,decl,out,0,0),'PSIZE declaration');ok(e.SetVertexDeclaration(device,e.guest_read32(out),0,0,0),'bind declaration');
 pixels(fill(true),'declaration PSIZE at independent register');
 ok(e.SetFVF(device,0x62,0,0,0),'programmed FVF PSIZE');
 const tokens=new Uint32Array([0xfffe0101,1,0xc00f0000,0x90e40000,1,0xd00f0000,0x90e40005,1,0xc0010002,0x90000004,0xffff]);
 const shader=alloc(tokens.byteLength);new Uint32Array(memory.buffer,wa(shader),tokens.length).set(tokens);
 ok(e.CreateVertexShader(device,shader,out,0,0),'PSIZE-reading shader');ok(e.SetVertexShader(device,e.guest_read32(out),0,0,0),'bind shader');
 pixels(fill(false),'programmable v4 PSIZE -> oPts');
 assert.strictEqual(descriptors,4);
 const adapter=[...bridge.devices.values()][0].device;
 const wideVS=[...tokens.slice(0,-1)];for(let t=0;t<6;t++)wideVS.push(1,0xe00f0000+t,0x90e40007+t);wideVS.push(0xffff);
 const wideVertices=new Float32Array([[1.4,1.4,.2],[5.4,1.4,1],[1.4,5.4,2]].flatMap(([x,y,size])=>[x/4-1,1-y/4,.5,1,size,1,0,0,1,...Array(12).fill(.5)]));
 const draw={primitive:4,primitiveCount:1,stride:84,vertices:new Uint8Array(wideVertices.buffer),
  vertexShader:new Uint32Array(wideVS),pixelShader:new Uint32Array([0xffff0101,1,0x800f0000,0x90e40000,0xffff]),
  attributes:[{register:0,usage:0,usageIndex:0,type:3,offset:0},{register:4,usage:4,usageIndex:0,type:0,offset:16},
   {register:5,usage:10,usageIndex:0,type:3,offset:20},...Array.from({length:6},(_,t)=>({register:7+t,usage:5,usageIndex:t,type:1,offset:36+t*8}))],
  state:{fillMode:1,cull:1,zenable:false,pointSize:0,pointSizeMin:0,pointSizeMax:1},textures:[]};
 const bytes=adapter.bytes;adapter.clear([0,0,0,1],1);adapter.draw(draw);
 assert.deepStrictEqual(Array.from(new Uint32Array(adapter.present().pixels.buffer),(n,i)=>n===0xffff0000?i:-1).filter(i=>i>=0),[13,41],'ninth mapped input coexists with all six UVs');
 assert.strictEqual(adapter.bytes,bytes,'PSIZE/six-UV programs and temporary input retire');
 const invalid={...draw,attributes:draw.attributes.map(a=>a.usage===4?{...a,type:1}:a)};
 assert.throws(()=>adapter.draw(invalid),/PSIZE requires FLOAT1/);assert.strictEqual(adapter.bytes,bytes,'invalid PSIZE format retires temporary programs');
 assert.strictEqual(descriptors,5);await bridge.close();
 console.log('PASS actual COM FVF/declaration PSIZE, native fixed/programmed points, ABI bounds and pervertex cap1');
})().catch(error=>{console.error(error);process.exitCode=1;});
