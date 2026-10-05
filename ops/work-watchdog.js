#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function eligible(tasks,agentId,config={}) {
  const byId=new Map(tasks.map(t=>[t.id,t]));
  return tasks.filter(t=>t.owner===agentId && ['active','ready','review'].includes(t.status) && !t.blocker &&
    !(config.excludedTasks||[]).includes(t.id) &&
    !(t.dependencies||[]).some(id=>byId.get(id)?.status!=='done'))
    .sort((a,b)=>({active:0,review:1,ready:2}[a.status]-{active:0,review:1,ready:2}[b.status])||a.id.localeCompare(b.id));
}
function decide(snapshot,terminal,config,previous={},now=Date.now()) {
  const tasks=eligible(snapshot.tasks||[],terminal.agentId,config);
  const signature=hash(tasks.map(t=>[t.id,t.status,t.next,t.evidence,t.notes]));
  const same=previous.signature===signature && previous.agentId===terminal.agentId;
  const record={...previous,agentId:terminal.agentId,signature,taskIds:tasks.map(t=>t.id),checkedAt:now,
    attempts:same?(previous.attempts||0):0,lastNudgeAt:same?previous.lastNudgeAt:null};
  const skip=reason=>({send:false,record:{...record,reason}});
  if(!config.enabled || config.paused || (config.pausedTerminals||[]).includes(terminal.id)){record.idleSince=null;return skip('paused');}
  if(!tasks.length){record.idleSince=null;return skip('no actionable owned tasks');}
  const agent=snapshot.agents?.find(a=>a.id===terminal.agentId);
  if(snapshot.agents && agent?.state!=='idle'){record.idleSince=null;return skip('session has not reported an idle turn');}
  if(!terminal.idle){record.idleSince=null;return skip('busy, prompt, draft, controller, or unavailable');}
  if(!same || previous.screenHash!==terminal.screenHash || !previous.idleSince)record.idleSince=now;
  record.screenHash=terminal.screenHash;
  if(now-record.idleSince<(config.idleMs??120000))return skip('observing stable idle terminal');
  if(record.attempts>=(config.maxUnchangedNudges??2))return skip('stalled: repeated nudges without task progress; inspect agent');
  if(record.lastNudgeAt && now-record.lastNudgeAt<(config.cooldownMs??900000))return skip('cooldown');
  return {send:true,tasks,record:{...record,reason:'idle with actionable work'}};
}
function message(tasks,config) {
  const names=tasks.slice(0,6).map(t=>`${t.id} (${t.status})`).join(', ');
  return `You are idle with actionable assigned tasks: ${names}. Read current TODOS.md and latest messageboard before acting. Reconcile completed work against origin/main; do not redo already merged fixes or screenshots. Continue the next unblocked task and collect completed worker results. Keep the authorized two-new-games lane progressing toward ordinary input and gameplay screenshots; serialize builds/browser/performance work with current owners. Respect all user pauses, exclusions and ownership changes, especially laptop-owned Heroes II timing/music. Do not deploy publicly or answer approvals. If no work is actually actionable, update task blockers/ownership instead of claiming progress. For an intentional pause set scratch/work-watchdog/control.json paused=true (or add your terminal ID to pausedTerminals) and record why. Keep routine updates on the dashboard; Telegram only for requested replies or meaningful milestones. ${config.note||''}`;
}
async function run({root=path.resolve(__dirname,'..'),base=process.env.OPS_URL||'http://127.0.0.1:8098'}={}) {
  const dir=path.join(root,'scratch/work-watchdog');fs.mkdirSync(dir,{recursive:true});
  const lock=path.join(dir,'lock');
  try{fs.mkdirSync(lock);}catch{
    let pid;try{pid=Number(fs.readFileSync(path.join(lock,'pid'),'utf8'));process.kill(pid,0);}catch(e){
      if(e.code==='ESRCH' && pid>0){fs.rmSync(lock,{recursive:true});return run({root,base});}
    }
    throw Error('Work watchdog lock exists; verify its PID before restarting');
  }
  fs.writeFileSync(path.join(lock,'pid'),String(process.pid));
  let stopping=false;const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const read=(f,fallback)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
  const stateFile=path.join(dir,'state.json');let state=read(stateFile,{targets:{}});
  const save=()=>{fs.writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2)+'\n');fs.renameSync(stateFile+'.tmp',stateFile);};
  const request=async(url,body)=>{const r=await fetch(base+url,{signal:AbortSignal.timeout(15000),...(body?{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(`${url}: ${r.status} ${(await r.text()).slice(0,180)}`);return r.json();};
  try{while(!stopping){
    try{
      const config={...read(path.join(root,'ops/work-watchdog.json'),{enabled:false}),...read(path.join(dir,'control.json'),{})};
      const [snapshot,terminals]=await Promise.all([request('/api/state'),request('/api/work-status')]);
      if(!snapshot.generatedAt || Date.now()-Date.parse(snapshot.generatedAt)>120000)throw Error('Stale dashboard snapshot');
      for(const terminal of terminals.filter(t=>(config.terminals||[]).includes(t.id))){
        const d=decide(snapshot,terminal,config,state.targets[terminal.id]);state.targets[terminal.id]=d.record;
        if(d.send){
          // Persist an attempt before delivery; uncertain sends must never replay immediately.
          d.record.attempts++;d.record.lastNudgeAt=Date.now();save();
          try{await request('/api/work-nudge',{terminalId:terminal.id,screenHash:terminal.screenHash,message:message(d.tasks,config)});d.record.reason='nudge delivered';}
          catch(e){d.record.reason='delivery not confirmed: '+e.message;}
          fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),terminalId:terminal.id,...d.record})+'\n');
        }
      }
      state.error=null;
    }catch(e){state.error=e.message;console.error(e.message);}
    state.checkedAt=new Date().toISOString();state.pid=process.pid;save();
    if(process.argv.includes('--once'))break;
    for(let n=0;n<30&&!stopping;n++)await new Promise(r=>setTimeout(r,1000));
  }}finally{fs.rmSync(lock,{recursive:true,force:true});}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={eligible,decide,message};
