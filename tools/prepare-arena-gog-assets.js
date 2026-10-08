#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function prepare(root,source){
 function read(rel,bytes,digest){if(path.isAbsolute(rel)||rel.split(/[\\/]/).includes('..'))throw Error('Unsafe source path');const data=fs.readFileSync(path.join(root,rel));if(data.length!==bytes||sha(data)!==digest)throw Error('Original fixture mismatch: '+rel);return data;}
 read(source.installer.path,source.installer.bytes,source.installer.sha256);
 if(source.files.some(f=>/^cloud_saves$/i.test(f.path)))throw Error('Save directory conflicts with original file');
 const files=source.files.map(f=>{read(source.installedRoot+'/'+f.path,f.bytes,f.sha256);return{url:'installed/'+f.path,vfsPath:'c:\\'+f.path.replaceAll('/','\\'),size:f.bytes,sha256:f.sha256};});
 const config=fs.readFileSync(path.join(root,source.config.path));if(sha(config)!==source.config.sha256)throw Error('Config mismatch');
 const steps=['mount C C:\\','mount C C:\\cloud_saves -t overlay','mount D C:\\ -t cdrom','@SET ARENADATA=C:','D:','ACD -Ssbpdig.adv -IOS220 -IRQS7 -DMAS1 -Mgenmidi.adv -IOM330 -IRQM2 -DMAM1'];let last=-1;const lines=config.toString().split(/\r?\n/);for(const step of steps){const index=lines.indexOf(step,last+1);if(index<0)throw Error('Original mount/launch order: '+step);last=index;}
 files.push({url:'arena-wa.conf',vfsPath:'c:\\arena-wa.conf',size:config.length,sha256:source.config.sha256});
 const candidate=path.dirname(source.installedRoot),manifest=Buffer.from(JSON.stringify({schemaVersion:1,source:'Original GOG Arena payload; original cloud_saves overlay/CD-ROM/ARENADATA launch; no invented save',files},null,2)+'\n');
 const outputs=[{file:path.join(root,candidate,'arena-wa.conf'),data:config,previous:source.config.previousSha256},{file:path.join(root,candidate,'.wine-assembly-browser.json'),data:manifest,previous:source.config.previousManifestSha256}];
 // Check both before writing anything; never overwrite unknown generated state.
 for(const o of outputs){o.old=fs.existsSync(o.file)?fs.readFileSync(o.file):null;if(o.old&&!o.old.equals(o.data)&&sha(o.old)!==o.previous)throw Error('Existing metadata conflict: '+o.file);}
 for(const o of outputs){if(o.old&&o.old.equals(o.data))continue;if(!o.old){fs.writeFileSync(o.file,o.data,{flag:'wx'});continue;}const backup=o.file+'.before-'+sha(o.old);if(fs.existsSync(backup)){if(!fs.readFileSync(backup).equals(o.old))throw Error('Backup conflict');}else fs.writeFileSync(backup,o.old,{flag:'wx'});if(!fs.readFileSync(o.file).equals(o.old))throw Error('Concurrent metadata change');const tmp=o.file+'.tmp-'+process.pid;fs.writeFileSync(tmp,o.data,{flag:'wx'});fs.renameSync(tmp,o.file);}
 return{originalFiles:source.files.length,manifestEntries:files.length,manifestSha256:sha(manifest),configSha256:sha(config)};
}
module.exports={prepare};
if(require.main===module)console.log(JSON.stringify(prepare(path.resolve(__dirname,'..'),require('../lib/arena-gog-source.json')),null,2));
