#!/usr/bin/env node
'use strict';
// Checked original CAB extraction only. Does not simulate Windows installation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const SOURCE_SHA256='a501306cad88c0fc41f986d92109343d68ac79fc11aaa6611724d84be628f3f8';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function extract(source,output){
  const b=fs.readFileSync(source);
  if(b.length!==192188416||sha(b)!==SOURCE_SHA256)throw Error('original installer identity mismatch');
  if(fs.existsSync(output))throw Error('fresh output required');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const disk=fs.statfsSync(path.dirname(output),{bigint:true});
  if(disk.bavail*disk.bsize-398573090n<2n*1024n**3n)throw Error('CAB and payload would cross 2GiB floor');
  const cab=b.subarray(464312,464312+191706128);
  if(cab.toString('ascii',0,4)!=='MSCF'||cab.readUInt32LE(8)!==191706128||cab.readUInt16LE(26)!==3||cab.readUInt16LE(28)!==37||cab.readUInt16LE(30)!==0)throw Error('cabinet header mismatch');
  let pos=cab.readUInt32LE(16);const entries=[],seen=new Set();
  for(let i=0;i<37;i++){
    const bytes=cab.readUInt32LE(pos),folder=cab.readUInt16LE(pos+8);pos+=16;
    const end=cab.indexOf(0,pos);if(end<pos)throw Error('unterminated cabinet name');
    const name=cab.toString('ascii',pos,end),parts=name.split('\\');pos=end+1;
    if(folder>2||parts.some(p=>!p||p==='.'||p==='..'||/[:/]/.test(p))||seen.has(name.toLowerCase()))throw Error('unsafe cabinet entry');
    seen.add(name.toLowerCase());entries.push({path:parts.join('/'),bytes});
  }
  if(entries.reduce((n,e)=>n+e.bytes,0)!==206866962)throw Error('cabinet size inventory mismatch');
  const temp=output+'.original.cab';fs.writeFileSync(temp,cab,{flag:'wx'});
  const receipt={schemaVersion:1,method:'cabextract integrity test and extraction; original CAB directory and sizes checked',installedState:false,source:{name:path.basename(source),bytes:b.length,sha256:SOURCE_SHA256},cabinet:{offset:464312,bytes:cab.length,sha256:sha(cab)},files:[]};
  try{
    receipt.tool=cp.execFileSync('cabextract',['--version'],{encoding:'utf8'}).trim();
    receipt.integrity=cp.execFileSync('cabextract',['-t',temp],{encoding:'utf8',timeout:120000});
    fs.mkdirSync(output);receipt.extraction=cp.execFileSync('cabextract',['-d',output,temp],{encoding:'utf8',timeout:120000});
    for(const e of entries){const data=fs.readFileSync(path.join(output,e.path));if(data.length!==e.bytes)throw Error('extracted size mismatch: '+e.path);receipt.files.push({...e,sha256:sha(data)});}
    fs.writeFileSync(path.join(output,'.original-package.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
  }finally{fs.unlinkSync(temp);}
}
if(require.main===module){const root=path.join(__dirname,'../test/binaries/win98-games-a-d');const r=extract(process.argv[2]||path.join(root,'DungeonSiege-demo-D3D.exe'),process.argv[3]||path.join(root,'DungeonSiege demo-D3D/extracted'));console.log(JSON.stringify(r,null,2));}
module.exports={extract,SOURCE_SHA256};
