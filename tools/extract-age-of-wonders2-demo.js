#!/usr/bin/env node
'use strict';
// Extract only the pinned local self-extracting ZIP. This is a payload tree,
// not a claim that the configuration program or a Windows installer ran.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const zip=require('../lib/zip-mount');
const SOURCE_SHA256='1244f0114965d011d1e28b97e207db15c902d124ebb25af8a6c97748beb73dc0';
const EXE_SHA256='a10590e5dbd013d154b00ea53e66670f4e74d38ab33adb2523f0a662af8f89f7';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function extract(source,output){
  const bytes=fs.readFileSync(source);
  if(bytes.length!==101537511||sha(bytes)!==SOURCE_SHA256)throw Error('original package identity mismatch');
  if(fs.existsSync(output))throw Error('fresh extraction directory required');
  const disk=fs.statfsSync(path.dirname(output),{bigint:true});
  if(disk.bavail*disk.bsize-197002538n<2n*1024n**3n)throw Error('extraction would cross 2GiB free disk floor');
  const src=zip.toSource(bytes),entries=zip.readCatalogSync(src);
  zip.mountPlan(entries,{root:'c:\\aow2demo',unwrap:false}); // validates names and case collisions
  if(entries.length!==1104||entries.filter(e=>!e.isDirectory).length!==1063||entries.reduce((n,e)=>n+e.uncompressedSize,0)!==197002538)throw Error('unexpected original catalog');
  const receipt={schemaVersion:1,method:'ZipMount checked ZIP extraction; CRC checked per file',source:{name:path.basename(source),bytes:bytes.length,sha256:SOURCE_SHA256},installedState:false,files:[]};
  fs.mkdirSync(output);
  for(const e of entries){const dest=path.join(output,...zip.guestRelative(e.name).split('\\'));if(e.isDirectory){fs.mkdirSync(dest,{recursive:true});continue;}
    const b=Buffer.from(zip.extractSync(src,e,{maxEntryBytes:64*1024*1024}));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);receipt.files.push({path:e.name,bytes:b.length,sha256:sha(b)});
  }
  if(sha(fs.readFileSync(path.join(output,'AoW2.exe')))!==EXE_SHA256)throw Error('game identity mismatch');
  fs.writeFileSync(path.join(output,'.original-package.json'),JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}
if(require.main===module){const root=path.join(__dirname,'../test/binaries/win98-games-a-d');const source=process.argv[2]||path.join(root,'Age of Wonders2 demo-SW.exe'),output=process.argv[3]||path.join(root,'Age of Wonders2 demo-SW/extracted');fs.mkdirSync(path.dirname(output),{recursive:true});const r=extract(source,output);console.log(JSON.stringify({output,files:r.files.length,bytes:r.files.reduce((n,f)=>n+f.bytes,0),exeSha256:EXE_SHA256}));}
module.exports={extract,SOURCE_SHA256,EXE_SHA256};
