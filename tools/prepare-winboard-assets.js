#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),source=require('../lib/winboard-source.json');
const arg=process.argv.find(x=>x.startsWith('--payload='));if(!arg)throw Error('Usage: node tools/prepare-winboard-assets.js --payload=original-extracted-group');
const payload=path.resolve(arg.slice(10)),fixture=path.join(ROOT,'test/binaries/candidates/winboard-installer'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(hash(path.join(fixture,'winboard-4_2_7.exe'))!==source.installer.sha256)throw Error('Original installer hash mismatch');
for(const f of source.files){if(path.basename(f.name)!==f.name)throw Error('Unsafe name');const p=path.join(payload,f.name);if(fs.statSync(p).size!==f.bytes||hash(p)!==f.sha256)throw Error('Original payload mismatch '+f.name);}
fs.mkdirSync(path.join(fixture,'installed'),{recursive:true});
for(const f of source.files){const dest=path.join(fixture,'installed',f.name);if(fs.existsSync(dest)){if(hash(dest)!==f.sha256)throw Error('Preserving conflicting existing asset '+f.name);}else fs.copyFileSync(path.join(payload,f.name),dest,fs.constants.COPYFILE_EXCL);}
const files=source.files.map(f=>({url:'installed/'+f.name,vfsPath:'c:\\'+f.name,size:f.bytes,sha256:f.sha256}));
fs.writeFileSync(path.join(fixture,'.wine-assembly-browser.json'),JSON.stringify({schemaVersion:1,source:'Original WinBoard4.2.7 installer static InstallShield extraction; not installer runtime acceptance',files},null,2));
console.log(JSON.stringify({prepared:true,files:files.length,gameplayVerified:false}));
