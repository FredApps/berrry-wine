#!/usr/bin/env node
'use strict';
// Original GOG Windows DOSBox payload. No extraction, download or guest mutation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=require('../lib/daggerfall-gog-source.json');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function buildManifest(candidateRoot,repoRoot){
 const installed=path.join(candidateRoot,'installed'),files=[];
 function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const full=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())visit(full);else if(e.isFile()){const rel=path.relative(installed,full).split(path.sep).join('/');files.push({url:'installed/'+rel,vfsPath:'c:\\'+rel.replaceAll('/','\\'),size:fs.statSync(full).size,...(/\.sav$/i.test(rel)?{loadMode:'required'}:{})});}}}
 // DOSBox opens original save files for synchronous writes/truncation. Keep
 // these mutable bytes resident; read-only game archives still use lazy ranges.
 visit(installed);
 for(const rel of ['DOSBOX/DOSBox.exe','DOSBOX/SDL.dll','DOSBOX/SDL_net.dll','FALL.EXE','Z.CFG','__support/app/dosbox_daggerfall.conf'])if(!files.some(f=>f.url==='installed/'+rel))throw Error('Missing required original file: '+rel);
 // The CLI driver mounts GOG base configuration at root, then two existing overrides.
 files.push({url:'installed/__support/app/dosbox_daggerfall.conf',vfsPath:'c:\\dosbox_daggerfall.conf',size:fs.statSync(path.join(installed,'__support/app/dosbox_daggerfall.conf')).size});
 for(const [source,name] of [['daggerfall-wine-assembly.conf','dosbox-wa.conf'],['daggerfall-launch.conf','dosbox-launch.conf']]){const bytes=fs.readFileSync(path.join(repoRoot,'test/configs',source));files.push({url:name,vfsPath:'c:\\'+name,size:bytes.length});}
 const keys=files.map(f=>f.vfsPath.toLowerCase());if(new Set(keys).size!==keys.length)throw Error('Case-insensitive guest path collision');
 return{schemaVersion:1,source:'Original installed GOG DOSBox payload and existing tools/run-daggerfall-gameplay.js three-config mount contract; symlinks excluded',files};
}
function generate(repoRoot,candidateRoot=path.join(repoRoot,'test/binaries/candidates/gog-free-elder-scrolls-daggerfall')){for(const f of [...source.criticalFiles,...source.configs]){const p=path.join(repoRoot,f.path);if((f.bytes!==undefined&&fs.statSync(p).size!==f.bytes)||sha(p)!==f.sha256)throw Error('Pinned original source mismatch: '+f.path);}const manifest=buildManifest(candidateRoot,repoRoot);for(const [source,name]of[['daggerfall-wine-assembly.conf','dosbox-wa.conf'],['daggerfall-launch.conf','dosbox-launch.conf']]){const src=path.join(repoRoot,'test/configs',source),dst=path.join(candidateRoot,name);if(fs.existsSync(dst)){if(sha(src)!==sha(dst))throw Error('Existing config conflict: '+dst);}else fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);}const dst=path.join(candidateRoot,'.wine-assembly-browser.json'),data=JSON.stringify(manifest,null,2)+'\n';if(fs.existsSync(dst)){if(fs.readFileSync(dst,'utf8')!==data)throw Error('Existing manifest conflict');}else fs.writeFileSync(dst,data,{flag:'wx'});return manifest;}
if(require.main===module){const root=path.resolve(__dirname,'..');console.log(JSON.stringify({files:generate(root).files.length}));}
module.exports={buildManifest,generate};
