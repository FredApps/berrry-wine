#!/usr/bin/env node
'use strict';
// Hash/publish explicitly reviewed existing images, or serialize a pinned existing
// capture harness. The latter never automatically labels a screenshot gameplay.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const root=process.cwd(),[mode,planFile,outFile]=process.argv.slice(2);
const inside=p=>{const a=path.resolve(root,p);if(!a.startsWith(root+path.sep))throw Error('outside repository');return a;};
async function main(){
 if(!['review','capture'].includes(mode)||!planFile||!outFile)throw Error('usage: screenshot-easy-batch.js review|capture plan.json output.json [--slot-granted]');
 const plan=JSON.parse(fs.readFileSync(inside(planFile))),out=inside(outFile);
 if(fs.existsSync(out))throw Error('output must be new');
 if(mode==='review'){
  const reviews=plan.entries.map(e=>{
   if(e.sceneClass!=='gameplay'||!e.observation||!e.reviewer||!e.reviewedAt||!e.sourceRun)throw Error('explicit personal review required');
   const bytes=fs.readFileSync(inside(e.path));if(sha(bytes)!==e.sha256)throw Error('reviewed image changed: '+e.path);
   const source=fs.readFileSync(inside(e.sourceRun));if(sha(source)!==e.sourceRunSha256)throw Error('run provenance changed');
   return {...e,candidateId:e.id,taskId:'GAMEPLAY-'+e.id,physicalFps:null,evidenceScope:'historical scene only; no fresh input, correctness or performance qualification'};
  });fs.writeFileSync(out,JSON.stringify({generatedAt:new Date().toISOString(),reviews},null,2)+'\n');return;
 }
 if(!process.argv.includes('--slot-granted'))throw Error('serialized resource grant required');
 if(!Array.isArray(plan.entries)||plan.entries.reduce((n,e)=>n+e.deadlineMs,0)>600000)throw Error('maximum total budget 10 minutes');
 const results=[];
 for(const e of plan.entries){
  if(!Number.isInteger(e.deadlineMs)||e.deadlineMs<1000||e.deadlineMs>90000)throw Error('per-title budget must be 1–90 seconds');
  if(!e.appId||!e.taskId||!e.runId||!e.knownRouteEvidence)throw Error('identified known route required');
  const harness=inside(e.harness);if(sha(fs.readFileSync(harness))!==e.harnessSha256)throw Error('harness changed');
  for(const p of e.requiredPaths||[])if(!fs.existsSync(inside(p)))throw Error('missing fixture '+p);
  const runDir=inside(e.outputDir);if(fs.existsSync(runDir))throw Error('run output must be new');fs.mkdirSync(runDir,{recursive:true});
  const startedAt=new Date().toISOString(),moduleSha256=sha(fs.readFileSync(inside('build/wine-assembly.wasm')));
  if(!Array.isArray(e.commands)||!Array.isArray(e.args)||!e.cleanupPath)throw Error('explicit commands, arguments and cleanup receipt required');
  for(const c of e.commands)if(!['key','click','move','wait','shot','quit'].includes(c.action))throw Error('ordinary input only');
  const child=spawn(process.execPath,[harness,...e.args],{cwd:root,stdio:['pipe','pipe','pipe']});
  const log=fs.createWriteStream(path.join(runDir,'batch-transport.log'));let sent=false,buffer='',timedOut=false;
  child.stdin.on('error',error=>log.write('stdin: '+error.message+'\n'));
  child.stderr.pipe(log,{end:false});child.stdout.on('data',b=>{log.write(b);buffer=(buffer+b).slice(-16384);if(!sent&&buffer.includes(e.readyText||'"ready":true')){sent=true;for(const c of e.commands){if(!['key','click','move','wait','shot','quit'].includes(c.action))throw Error('ordinary input only');child.stdin.write(JSON.stringify(c)+'\n');}child.stdin.write('{"action":"quit"}\n');}});
  let finalGuard;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');finalGuard=setTimeout(()=>child.kill('SIGKILL'),2000);},e.deadlineMs-2000>0?e.deadlineMs-2000:e.deadlineMs);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);clearTimeout(finalGuard);log.end();
  let cleanup=null;try{cleanup=JSON.parse(fs.readFileSync(inside(e.cleanupPath)));}catch{}
  const screenshots=(e.screenshots||[]).map(p=>{const file=inside(path.join(e.outputDir,p));return {path:path.relative(root,file),sha256:fs.existsSync(file)?sha(fs.readFileSync(file)):null};});
  const row={screenshots,taskId:e.taskId,appId:e.appId,runId:e.runId,startedAt,moduleSha256,code,timedOut,cleanup,review:'required',physicalFps:null};results.push(row);
  fs.writeFileSync(out,JSON.stringify({results},null,2)+'\n');
  if(!cleanup?.browserClosed||!cleanup?.serverClosed)throw Error('cleanup unproven; stop batch, release requires owner audit');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
