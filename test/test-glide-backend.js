const assert = require('assert');
const Glide = require('../lib/glide-backend');
assert.deepStrictEqual(Glide.dimensions(0,0),[256,32]);
assert.deepStrictEqual(Glide.dimensions(8,6),[1,1]);
assert.deepStrictEqual(Glide.textureLayout(3,0,3,10,1).levels.map(x=>x.lod),[0,2]);
assert.deepStrictEqual([1,.875,.75,.625,.5,.25,0].map(Glide.wDepth),[0,1024,2048,3072,4096,8192,65535]);
assert.deepStrictEqual(Array.from(Glide.decodeTexture(Uint8Array.from([0,248,224,7,31,0]),10)),[255,0,0,255,0,255,0,255,0,0,255,255]);
assert.throws(()=>Glide.decodeTexture(new Uint8Array(1),1),/texture format/);
const palette=new Uint32Array(256);palette[7]=0x123456;
assert.deepStrictEqual(Array.from(Glide.decodeTexture(Uint8Array.of(7),5,palette)),[18,52,86,255]);
function packet(values){return new Uint8Array(new Uint32Array(values).buffer);}
const unsupported=new Glide.Device({});
assert.throws(()=>unsupported.submit(1,packet([0,32,32,0,0])),/GPU backend/);
assert.throws(()=>unsupported.submit(0,packet([5,999])),/batch/);
const hgl=require('../lib/headless-gl');
if(!hgl.available()) {console.log('Glide format/packet checks pass; GPU checks SKIP: '+hgl.unavailableReason());process.exit(0);}
const {createCanvas}=require('../lib/canvas-compat'),{WebGLBackend}=require('../lib/gpu-backend');
const backend=new WebGLBackend(createCanvas(32,32));let presents=0;
const device=new Glide.Device({backend,onPresent(){presents++;}});
function draw(rgb,z=1000,overrides={},vertex={},defer=false){
  const bytes=new Uint8Array(436),s=new Uint32Array(bytes.buffer,0,64),v=new DataView(bytes.buffer);
  s[0]=1;s[5]=1;s[11]=1;s[12]=1;s[13]=1;s[14]=4;s[16]=4;s[18]=7;s[28]=32;s[29]=32;s[30]=1;s[31]=1;s[45]=1;s[61]=1;
  for(const [k,value]of Object.entries(overrides))s[k]=value;
  for(let i=0;i<3;i++){
    const xy=[[0,0],[32,0],[0,32]][i],f=[...xy,0,...rgb,z,255,1,0,0,1,0,0,1];
    f.forEach((x,j)=>v.setFloat32(256+i*60+j*4,vertex[j]===undefined?x:vertex[j],true));
  }
  if(!defer)device.submit(5,bytes);return bytes;
}
const read=()=>{const p=new Uint8Array(4);backend.readPixels(4,27,1,1,backend.gl.RGBA,backend.gl.UNSIGNED_BYTE,p);return Array.from(p);};
try{
  device.submit(1,packet([1,32,32,0,0]));device.submit(3,packet([0,255,65535]));
  draw([255,0,0],1000);assert.deepStrictEqual(read(),[255,0,0,255]);
  draw([0,255,0],2000);assert.deepStrictEqual(read(),[255,0,0,255],'far triangle must fail Z');
  draw([0,0,255],500);assert.deepStrictEqual(read(),[0,0,255,255]);
  device.submit(4,new Uint8Array());assert.strictEqual(presents,1);
  const lfb=new Uint8Array(20+32*32*2);lfb.set(packet([0,0,0,32,32]));device.submit(9,lfb);
  assert.strictEqual(new DataView(lfb.buffer).getUint16(20+(4*32+4)*2,true),31);
  new DataView(lfb.buffer).setUint16(20+(4*32+4)*2,0x7e0,true);const beforeFront=device.stats.presents;device.submit(10,lfb);device.bind(0);assert.deepStrictEqual(read(),[0,255,0,255]);assert.strictEqual(device.stats.presents,beforeFront+1,'front LFB write publishes without a swap');assert.strictEqual(device.stats.swaps,1);
  // A 2x2 mip's coordinates remain in the nominal 256-wide Glide domain.
  const upload=new Uint8Array(36);upload.set(packet([0,7,7,3,10,3,8]));upload.set([0,248,224,7,31,0,255,255],28);device.submit(6,upload);
  const textureState={0:3,1:8,3:1,11:0,32:0,33:7,34:7,35:3,36:10,37:3,38:1,39:1,46:1,48:1};
  draw([255,255,255],1,textureState,{9:192,10:32});assert.deepStrictEqual(read(),[0,255,0,255],'nominal texture coordinate picks upper-right texel');
  const minified=draw([255,255,255],1,{...textureState,42:1},{},true),minView=new DataView(minified.buffer);
  [0,4096,0].forEach((s,i)=>minView.setFloat32(256+i*60+9*4,s,true));
  [0,0,4096].forEach((t,i)=>minView.setFloat32(256+i*60+10*4,t,true));
  device.submit(5,minified);assert.deepStrictEqual(read(),[255,255,255,255],'truncated chain clamps to its last real mip');
  upload.set([0,0,31,0,0,0,0,0],28);device.submit(6,upload);draw([255,255,255],1,textureState,{9:192,10:32});assert.deepStrictEqual(read(),[0,0,255,255],'overwrite invalidates cached texture');
  assert.strictEqual(device.ranges.length,1,'texture replacement retains coverage rather than upload history');
  const pal=packet(Array.from({length:256},(_,i)=>i===7?0xff0000:0));device.submit(7,pal);
  const indexed=new Uint8Array(29);indexed.set(packet([16,8,8,3,5,3,1]));indexed[28]=7;device.submit(6,indexed);
  const indexedState={...textureState,32:16,33:8,34:8,36:5};draw([255,255,255],1,indexedState);assert.deepStrictEqual(read(),[255,0,0,255]);
  new Uint32Array(pal.buffer)[7]=0xffff00;device.submit(7,pal);draw([255,255,255],1,indexedState);assert.deepStrictEqual(read(),[255,255,0,255],'palette generations invalidate cached views');
  device.submit(8,new Uint8Array(64).fill(255));draw([255,0,0],1,{11:0,22:2,23:0xff0000ff},{8:.5});assert.deepStrictEqual(read(),[0,0,255,255],'table fog full opacity');
  if(backend.version===2||backend.gl.getExtension('EXT_frag_depth')){
    device.submit(3,packet([0,255,65535]));draw([255,0,0],1,{11:2},{8:.5});draw([0,255,0],1,{11:2},{8:.25});assert.deepStrictEqual(read(),[255,0,0,255],'far W triangle rejected');
    draw([0,0,255],1,{11:2},{8:.75});assert.deepStrictEqual(read(),[0,0,255,255],'near W triangle accepted');
  }
  device.submit(3,packet([0,255,65535]));
  const red=draw([255,0,0],1,{11:0,14:1,15:5},{7:128},true),green=draw([0,255,0],1,{11:0,14:1,15:5},{7:128},true);
  const batch=new Uint8Array((8+red.length)*2);batch.set(packet([5,red.length]));batch.set(red,8);batch.set(packet([5,green.length]),8+red.length);batch.set(green,16+red.length);
  const before=device.stats.draws;device.submit(0,batch);assert.strictEqual(device.stats.draws-before,1,'adjacent immutable state batches once');assert.strictEqual(device.stats.mergedDraws,1);
  const blended=read();assert(Math.abs(blended[0]-64)<=1&&Math.abs(blended[1]-128)<=1&&blended[2]===0,'transparent triangles retain source order');
  // A swap publishes the completed frame and reuses the old front as back.
  device.submit(4,new Uint8Array());lfb.set(packet([0,0,0,32,32]));device.submit(9,lfb);const frontPixel=new DataView(lfb.buffer).getUint16(20+(4*32+4)*2,true);
  device.submit(3,packet([0xffffff,255,65535]));device.submit(9,lfb);assert.strictEqual(new DataView(lfb.buffer).getUint16(20+(4*32+4)*2,true),frontPixel,'back clear preserves front identity');
  device.submit(4,new Uint8Array());device.submit(9,lfb);assert.strictEqual(new DataView(lfb.buffer).getUint16(20+(4*32+4)*2,true),65535,'swap changes front identity');
  device.submit(3,packet([0,255,65535]));
  const line=draw([255,0,0],1,{11:0},{},true).slice(0,376),lineView=new DataView(line.buffer);
  lineView.setFloat32(256+4,4.5,true);lineView.setFloat32(316+4,4.5,true);
  device.submit(11,line);assert.deepStrictEqual(read(),[255,0,0,255],'line primitive draws one-pixel horizontal coverage');
  new Uint32Array(batch.buffer,8,64)[45]=0;new Uint32Array(batch.buffer,16+red.length,64)[45]=0;
  const frontPresents=device.stats.presents,frontSwaps=device.stats.swaps;device.submit(0,batch);
  assert.strictEqual(device.stats.presents-frontPresents,1,'front batch publishes once');assert.strictEqual(device.stats.swaps,frontSwaps,'front publication preserves swap identity');
  assert.strictEqual(backend.getError(),0);console.log('Glide formats, packet validation, Z/W occlusion, textures, palette replacement, fog, presentation, RGB565 LFB PASS');
}finally{device.destroy();backend.destroy();}
