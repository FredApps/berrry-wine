#!/usr/bin/env node
'use strict';

// Private migration snapshot. No credentials, native processes or agent logins.
const fs = require('node:fs/promises');
const {createReadStream, createWriteStream, constants} = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync, spawn} = require('node:child_process');
const {pipeline} = require('node:stream/promises');
const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.argv[2] || '');
const git = args => execFileSync('git', args, {cwd:root, maxBuffer:64*1024*1024, timeout:120000});
const excluded = p => p.split('/').some(n => /^\.env(?:\.|$)/.test(n) || /^(auth\.json|credentials(?:\..*)?|id_rsa|id_ed25519|\.DS_Store|node_modules)$/.test(n)) || /^scratch\/(ops-migration|ops-new-box|ops-box|telegram)/.test(p);
async function hash(file) {
  const h=crypto.createHash('sha256');
  for await(const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
async function walk(dir) {
  const result=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) result.push(...await walk(file)); else result.push(file);
  }
  return result;
}
async function main() {
  if(!process.argv[2] || output===root || output.startsWith(root+path.sep)) throw Error('Choose a new private snapshot directory outside the repository');
  await fs.mkdir(output,{mode:0o700}); // Refuse accidental reuse/overwrite.
  const manifest={createdAt:new Date().toISOString(),sourceRoot:root,head:git(['rev-parse','HEAD']).toString().trim(),files:[],archives:[],excluded:[],missing:[],changedDuringSnapshot:[],warnings:[]};
  async function copy(source,relative) {
    const dest=path.join(output,relative),before=await fs.lstat(source);
    await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    if(before.isSymbolicLink()) {
      const target=await fs.readlink(source);await fs.symlink(target,dest);
      manifest.files.push({path:relative,symlink:target});return;
    }
    if(!before.isFile())return;
    await fs.copyFile(source,dest,constants.COPYFILE_FICLONE);
    await fs.chmod(dest,before.mode&0o777);
    const after=await fs.stat(source);
    if(before.size!==after.size || before.mtimeMs!==after.mtimeMs)manifest.changedDuringSnapshot.push(relative);
    manifest.files.push({path:relative,bytes:before.size,sha256:await hash(dest)});
  }
  const files=new Set(git(['ls-files','-z','--cached','--others','--exclude-standard']).toString().split('\0').filter(Boolean));
  files.add('messageboard.txt');
  for(const relative of [...files].sort()) {
    if(excluded(relative)){manifest.excluded.push(relative);continue;}
    try {await copy(path.join(root,relative),'worktree/'+relative);}catch(e){if(e.code==='ENOENT')manifest.missing.push(relative);else throw e;}
  }
  // The dashboard can show screenshots and run metadata immediately. Large
  // binary fixtures and raw historical logs remain in the private archives.
  for(const folder of ['scratch','build','screenshots']) for(const source of await walk(path.join(root,folder))) {
    const relative=path.relative(root,source);
    if(excluded(relative) || files.has(relative) || !/\.(png|jpe?g|webp|svg|json|md)$/i.test(relative))continue;
    const stat=await fs.lstat(source);
    if(stat.isFile() && stat.size<=16*1024*1024)await copy(source,'worktree/'+relative);
  }
  const memorySources=[
    ['claude',path.join(os.homedir(),'.claude/projects/-Users-vg-Documents-projects-phone-wine-assembly/memory')],
    ['codex',path.join(os.homedir(),'.codex/memories')]
  ];
  for(const [provider,dir] of memorySources)for(const source of await walk(dir)) {
    const relative=path.relative(dir,source);
    if(provider==='codex' && relative!=='wine-assembly-timeout.md')continue;
    if(!excluded(relative))await copy(source,'memory/'+provider+'/'+relative);
  }
  await fs.writeFile(path.join(output,'working-tree.patch'),git(['diff','--binary','HEAD']),{mode:0o600});
  await fs.writeFile(path.join(output,'source-status.txt'),git(['status','--short']),{mode:0o600});
  git(['bundle','create',path.join(output,'repository.bundle'),'--all']);
  console.log('Source, dashboard assets and project memories captured. Compressing bulk data.');
  for(const folder of ['scratch','build','test/binaries','downloads','exports','tmp']) {
    if(!await fs.stat(path.join(root,folder)).catch(()=>null))continue;
    const name=folder.replaceAll('/','-')+'.tar.gz',dest=path.join(output,name);
    const args=['-c','-f','-','--exclude=.DS_Store','--exclude=node_modules','--exclude=.env','--exclude=.env.*','--exclude=auth.json','--exclude=credentials.json','--exclude=scratch/telegram*','--exclude=scratch/ops-migration*','--exclude=scratch/ops-new-box*','--exclude=scratch/ops-box*',folder];
    const tar=spawn('tar',args,{cwd:root,env:{...process.env,COPYFILE_DISABLE:'1'}}),gzip=spawn('gzip',['-1']);
    let warnings='';tar.stderr.on('data',b=>warnings+=b.toString());gzip.stderr.on('data',b=>warnings+=b.toString());
    const done=child=>new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    const tarDone=done(tar),gzipDone=done(gzip);
    await Promise.all([pipeline(tar.stdout,gzip.stdin),pipeline(gzip.stdout,createWriteStream(dest+'.partial',{mode:0o600}))]);
    const [tarCode,gzipCode]=await Promise.all([tarDone,gzipDone]);
    if(gzipCode!==0 || tarCode!==0)throw Error('Archive failed: '+folder+' '+warnings.slice(0,1000));
    await fs.rename(dest+'.partial',dest);
    manifest.archives.push({path:name,bytes:(await fs.stat(dest)).size,sha256:await hash(dest)});
    if(warnings)manifest.warnings.push({folder,text:warnings});
    console.log(name+': '+Math.round(manifest.archives.at(-1).bytes/1048576)+' MiB');
  }
  for(const name of ['repository.bundle','working-tree.patch','source-status.txt'])manifest.files.push({path:name,bytes:(await fs.stat(path.join(output,name))).size,sha256:await hash(path.join(output,name))});
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({head:manifest.head,files:manifest.files.length,archiveBytes:manifest.archives.reduce((n,a)=>n+a.bytes,0),changedDuringSnapshot:manifest.changedDuringSnapshot,output}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
