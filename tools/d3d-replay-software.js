#!/usr/bin/env node
'use strict';
// Trusted local diagnostic capture replay; no prior framebuffer history.
const fs=require('fs'),v8=require('v8'),{PNG}=require('pngjs');
const {bootRenderHarness}=require('../test/render-helper');
const {Device}=require('../lib/d3d9-software-backend');
const {OPCODES:O}=require('../lib/d3d-command-stream');
(async()=>{
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('usage: node tools/d3d-replay-software.js capture/frame.v8 output.png');
 const frame=v8.deserialize(fs.readFileSync(input));
 if(frame.version!==1||!frame.complete||!Array.isArray(frame.commands)||frame.commands.at(-1)?.opcode!==O.PRESENT)
  throw Error('complete version1 Present-terminated capture required');
 if(frame.commands.some(c=>![O.DRAW,O.PRESENT].includes(c.opcode)))throw Error('unsupported command/history replay');
 const {width,height}=frame.commands.at(-1).payload;
 const {exports:e,memory}=await bootRenderHarness({fonts:'none'});
 const d=new Device({getExports:()=>e,getMemory:()=>memory.buffer,width,height});
 try{
  let draws=0;
  d.clear([0,0,0,0],3);
  for(const {opcode,payload}of frame.commands)if(opcode===O.DRAW){d.draw(payload);draws++;}
  const bytes=d.readPixels(),png=new PNG({width,height});
  // Native canonical color storage is BGRA, top-to-bottom.
  for(let i=0;i<bytes.length;i+=4){png.data[i]=bytes[i+2];png.data[i+1]=bytes[i+1];png.data[i+2]=bytes[i];png.data[i+3]=bytes[i+3];}
  fs.writeFileSync(output,PNG.sync.write(png));
  console.log(JSON.stringify({output,width,height,draws,initialColor:'transparent black'}));
 }finally{d.destroy();}
})().catch(error=>{console.error(error);process.exitCode=1;});
