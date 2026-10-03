#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
async function main(){
  if(!process.argv[2])throw Error('Usage: node verify-snapshot.js PRIVATE_SNAPSHOT_DIRECTORY');
  const root=path.resolve(process.argv[2]),manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  let count=0;
  for(const entry of [...manifest.files,...manifest.archives]){
    const file=path.resolve(root,entry.path);
    if(!file.startsWith(root+path.sep))throw Error('Path outside snapshot');
    if(entry.symlink!==undefined){if(await fs.readlink(file)!==entry.symlink)throw Error('Symlink differs: '+entry.path);}
    else{
      const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
      if(hash.digest('hex')!==entry.sha256)throw Error('Checksum differs: '+entry.path);
    }
    count++;
  }
  console.log(JSON.stringify({verified:count,head:manifest.head,changedDuringSnapshot:manifest.changedDuringSnapshot,warnings:manifest.warnings}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
