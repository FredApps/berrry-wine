#!/usr/bin/env node
'use strict';
// Rebuild only the ignored browser manifest from the exact already-installed
// original local package; never executes or silently substitutes the installer.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),source=require('../lib/ultima4-gog-source.json');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function verify(rel,bytes,digest){const f=path.join(root,rel);if(!fs.statSync(f).isFile()||fs.statSync(f).size!==bytes||sha(f)!==digest)throw Error('Original fixture mismatch: '+rel);return f;}
verify(source.installer.path,source.installer.bytes,source.installer.sha256);
const candidate=path.dirname(source.installedRoot);
const files=source.files.map(entry=>{if(path.isAbsolute(entry.path)||entry.path.split(/[\\/]/).some(x=>x==='..'))throw Error('Unsafe source member');verify(source.installedRoot+'/'+entry.path,entry.bytes,entry.sha256);return{url:'installed/'+entry.path,vfsPath:'c:\\'+entry.path.replaceAll('/','\\'),size:entry.bytes,sha256:entry.sha256};});
const config=path.join(root,source.config.path);if(sha(config)!==source.config.sha256)throw Error('Documented DOSBox config changed');
const target=path.join(root,candidate,'ultima4-wa.conf');if(fs.existsSync(target)){if(sha(target)!==source.config.sha256)throw Error('Existing config conflict');}else fs.copyFileSync(config,target,fs.constants.COPYFILE_EXCL);
files.push({url:'ultima4-wa.conf',vfsPath:'c:\\ultima4-wa.conf',size:fs.statSync(config).size,sha256:source.config.sha256});
const manifest={schemaVersion:1,source:'Original locally installed GOG payload; existing documented Wine Assembly DOSBox config explicitly retained',files};
const manifestPath=path.join(root,candidate,'.wine-assembly-browser.json');const data=JSON.stringify(manifest,null,2)+'\n';if(fs.existsSync(manifestPath)&&fs.readFileSync(manifestPath,'utf8')!==data)throw Error('Existing manifest conflict');if(!fs.existsSync(manifestPath))fs.writeFileSync(manifestPath,data,{flag:'wx'});
console.log('PASS original'+source.files.length+' files/config verified; local manifest ready. No gameplay or installer execution claim.');
