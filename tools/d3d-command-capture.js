'use strict';
// Diagnostic only: capture the immutable neutral commands between two Presents.
// V8 serialization preserves typed arrays and nonfinite float bits for replay.
const fs=require('fs'),os=require('os'),path=require('path'),v8=require('v8');
const {OPCODES}=require('../lib/d3d-command-stream');
function install(bridge,{maxBytes=128*1024*1024,maxCommands=2048,directory}={}){
 if(!bridge||typeof bridge._submit!=='function')throw new Error('D3D bridge required');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxCommands)||maxCommands<1)
  throw new Error('positive capture budgets required');
 directory=directory||fs.mkdtempSync(path.join(os.tmpdir(),'d3d-command-capture-'));
 const original=bridge._submit,packets=[];
 const status={directory,phase:'armed',bytes:0,commands:0,complete:false,error:null};
 let selected;
 // Command payloads may contain SharedArrayBuffer views. Copy those into
 // ordinary owned arrays, without losing types or retaining mutable storage.
 const copy=(value,seen=new Map())=>{
  if(!value||typeof value!=='object')return value;
  if(seen.has(value))return seen.get(value);
  if(ArrayBuffer.isView(value))return value instanceof DataView?
   new DataView(new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice().buffer):new value.constructor(value);
  if(value instanceof ArrayBuffer||value instanceof SharedArrayBuffer)return new Uint8Array(value).slice().buffer;
  const result=Array.isArray(value)?[]:{};seen.set(value,result);
  for(const [key,item]of Object.entries(value))result[key]=copy(item,seen);
  return result;
 };
 const restore=()=>{if(bridge._submit===wrapped)bridge._submit=original;};
 const finish=complete=>{
  restore();status.complete=complete;status.phase=complete?'complete':'stopped';
  try{
   const filename=path.join(directory,'frame.v8');
   fs.writeFileSync(filename,v8.serialize({version:1,complete,commands:packets.map(p=>v8.deserialize(p))}),{flag:'wx'});
   status.path=filename;
  }catch(error){status.error=String(error);status.complete=false;status.phase='error';}
 };
 function wrapped(entry,opcode,payload){
  try{
   if(status.phase==='armed'&&opcode===OPCODES.PRESENT){selected=entry;status.phase='capturing';}
   else if(status.phase==='capturing'&&entry===selected){
    const packet=v8.serialize({opcode,payload:copy(payload)});
    if(status.bytes+packet.length>maxBytes||status.commands>=maxCommands){status.error='capture budget exceeded';finish(false);}
    else{packets.push(packet);status.bytes+=packet.length;status.commands++;
     if(opcode===OPCODES.PRESENT)finish(true);}
   }
  }catch(error){status.error=String(error);status.phase='error';restore();}
  // Observation failures must neither swallow nor fabricate renderer results.
  return original.call(this,entry,opcode,payload);
 }
 bridge._submit=wrapped;
 return {status,cancel(){if(status.phase==='armed'||status.phase==='capturing')finish(false);}};
}
module.exports={install};
