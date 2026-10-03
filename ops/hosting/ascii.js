#!/usr/bin/env node
'use strict';
// Scoped lifecycle helper. Credentials and capability URLs never reach stdout.
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),scratch=path.join(root,'scratch');
async function main(){
 const [action,id]=process.argv.slice(2);
 if(!['list','inspect','create','prepare','authorize'].includes(action)||['inspect','prepare','authorize'].includes(action)&&!/^bx_[a-z0-9]+$/.test(id||''))throw Error('Usage: node ops/hosting/ascii.js list | inspect bx_ID | create | prepare bx_ID | authorize bx_ID');
 const source=await fs.readFile(path.join(root,'../android-emu/.env'),'utf8');
 const token=source.split('\n').find(line=>line.startsWith('BOX_API_KEY='))?.slice(12).trim().replace(/^['"]|['"]$/g,'');
 if(!token)throw Error('ASCII account key unavailable');
 let body;const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const receipt=path.join(scratch,'ops-new-box-receipt-private.json');
 if(action==='create'){
  try{await fs.access(receipt);throw Error('Creation receipt exists; inspect that box instead.');}catch(e){if(e.code!=='ENOENT')throw e;}
  body=await fs.readFile(path.join(scratch,'ops-new-box-request.json'),'utf8');
  const p=JSON.parse(body);
  if(p.type!=='default'||p.ttlSeconds!==null||p.noEnv!==true||p.snapshots!==true||Object.keys(p).length!==4)throw Error('Unexpected creation payload');
  headers['Idempotency-Key']=(await fs.readFile(path.join(scratch,'ops-new-box-idempotency.txt'),'utf8')).trim();
 }
 if(action==='prepare'){
  const receiptData=JSON.parse(await fs.readFile(receipt,'utf8'));
  if((receiptData.box||receiptData.sandbox)?.id!==id)throw Error('Preparation is restricted to the newly created box');
  const unit=await fs.readFile(path.join(__dirname,'wine-ops.service'),'utf8');
  const program=`const fs=require('node:fs'),os=require('node:os'),cp=require('node:child_process');
const run=(bin,args)=>{try{return cp.execFileSync(bin,args,{encoding:'utf8',timeout:5000}).trim()}catch{return 'unavailable'}};
const base='/home/user/wine-assembly-prep';fs.mkdirSync(base,{recursive:true,mode:0o700});fs.mkdirSync('/home/user/wine-assembly',{recursive:true,mode:0o700});
const write=(name,text)=>{const p=base+'/'+name;try{fs.writeFileSync(p,text,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST'||fs.readFileSync(p,'utf8')!==text)throw e}};
write('wine-ops.service',${JSON.stringify(unit)});write('PREPARATION.txt','Wine Assembly coordinator staging only. Services are not enabled; no public dashboard or agent login configured.\\n');
console.log(JSON.stringify({host:os.hostname(),arch:os.arch(),cpus:os.cpus().length,memoryGiB:Math.round(os.totalmem()/1073741824),node:process.version,user:os.userInfo().username,disk:run('df',['-h','/home/user']),tools:Object.fromEntries(['git','tmux','codex','google-chrome','systemctl'].map(t=>[t,run('which',[t])])),hostKey:run('cat',['/etc/ssh/ssh_host_ed25519_key.pub']),staged:base},null,2));`;
  const quoted="'"+program.replace(/'/g,"'\"'\"'")+"'";
  body=JSON.stringify({command:'node -e '+quoted,timeoutSeconds:30});
 }
 if(action==='authorize'){
  const recorded=JSON.parse(await fs.readFile(receipt,'utf8'));
  if((recorded.box||recorded.sandbox)?.id!==id)throw Error('SSH authorization restricted to new box');
  const key=(await fs.readFile(path.join(scratch,'ops-migration-key.pub'),'utf8')).trim();
  if(!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$/.test(key))throw Error('Expected dedicated Ed25519 public key');
  body=JSON.stringify({key});
 }
 const endpoint=action==='authorize'?'/boxes/'+id+'/sshkey':action==='prepare'?'/boxes/'+id+'/commands':action==='inspect'?'/boxes/'+id:'/boxes';
 let response;try{response=await fetch('https://ascii.dev/api/box/v1'+endpoint,{method:['create','prepare','authorize'].includes(action)?'POST':'GET',headers,...(body?{body}:{}),signal:AbortSignal.timeout(65000)});}catch{throw Error('API unavailable; reconcile existing boxes before retrying creation');}
 if(!response.ok)throw Error('ASCII API HTTP '+response.status);
 const data=await response.json();
 if(action==='authorize'){console.log('Dedicated SSH public key registered for '+id);return;}
 if(action==='prepare'){
  const result=data.result||data;
  if(result.exitCode!==0)throw Error('Preparation did not complete successfully; inspect provider command result');
  const audit=JSON.parse(result.stdout);
  await fs.writeFile(path.join(scratch,'ops-new-box-preparation.json'),JSON.stringify(audit,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(audit,null,2));return;
 }
 if(action==='create')await fs.writeFile(receipt,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});
 const boxes=data.boxes||[data.box||data.sandbox||data];
 const keys=['id','name','state','health','vcpu','memoryGB','archiveAfter','sshEndpoint','ip','subdomain','snapshotAvailable','snapshotVerifiedAt','environment','holdsCreatorLogins'];
 const result={checkedAt:new Date().toISOString(),boxes:boxes.map(box=>Object.fromEntries(keys.filter(k=>k in box).map(k=>[k,box[k]]))),pageInfo:data.pageInfo};
 await fs.writeFile(path.join(scratch,action==='inspect'?'ops-box-'+id+'.json':'ops-boxes-audit.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
