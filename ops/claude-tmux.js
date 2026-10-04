#!/usr/bin/env node
'use strict';
// Persistent interactive Claude: preserve its transcript, and register the
// actual tmux pane identity only after it exists. Never resume over a live run.
const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process');
const exec=require('node:util').promisify(execFile);
const root=path.resolve(__dirname,'..');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function options(args){
  const get=k=>{const n=args.indexOf(k);return n<0?null:args[n+1];};
  const sessionId=get('--session-id'),id=get('--id'),session=get('--tmux');
  if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||! /^[a-z0-9-]{1,60}$/.test(id||'')||! /^[a-zA-Z0-9_-]{1,80}$/.test(session||''))throw Error('Required: --session-id UUID --id terminal-id --tmux session');
  return {sessionId,id,session,label:get('--label')||'Claude',bypass:args.includes('--dangerously-skip-permissions'),wait:args.includes('--wait')};
}
async function liveSession(id){
  if(process.platform!=='linux')throw Error('This launcher currently verifies Linux process identity only');
  const pids=[];
  for(const pid of await fs.readdir('/proc')){
    if(!/^\d+$/.test(pid))continue;
    try{if((await fs.readFile(`/proc/${pid}/comm`,'utf8')).trim()!=='claude')continue;
      const args=(await fs.readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0');
      if(args.includes(id))pids.push(+pid);
    }catch{}
  }
  return pids;
}
async function main(){
  const o=options(process.argv.slice(2));const end=Date.now()+30*60*1000;
  for(;;){const pids=await liveSession(o.sessionId);if(!pids.length)break;
    if(!o.wait||Date.now()>end)throw Error('Session still running: '+pids.join(','));
    console.log('Waiting for existing Claude run to finish:',pids.join(','));await new Promise(r=>setTimeout(r,15000));
  }
  try{await exec('tmux',['has-session','-t','='+o.session]);throw Error('tmux session already exists; inspect before replacing');}catch(e){if(!e.code)throw e;}
  const lock=path.join(root,'scratch/ops-terminal-write.lock');await fs.mkdir(lock);
  try{
    const file=path.join(root,'ops/terminals.json'),source=await fs.readFile(file,'utf8'),config=JSON.parse(source);
    const args=['claude','--resume',o.sessionId,...(o.bypass?['--dangerously-skip-permissions']:[])];
    await exec('tmux',['new-session','-d','-s',o.session,'-x','160','-y','45','-c',root,'exec '+args.map(quote).join(' ')]);
    await exec('tmux',['set-window-option','-t',o.session+':0','remain-on-exit','on']);
    const {stdout}=await exec('tmux',['list-panes','-t','='+o.session,'-F','#{pane_id} #{pane_pid}']);
    const [pane,panePid]=stdout.trim().split(' ');
    const entry={id:o.id,agentId:'claude:'+o.sessionId,label:o.label,session:o.session,pane,panePid:+panePid,permissionMode:o.bypass?'bypass':'default'};
    config.terminals=config.terminals.filter(t=>t.id!==o.id);config.terminals.push(entry);
    if(await fs.readFile(file,'utf8')!==source)throw Error('Registration changed during launch; reconcile current pane before retrying');
    await fs.writeFile(file+'.claude.tmp',JSON.stringify(config,null,2)+'\n');await fs.rename(file+'.claude.tmp',file);
    console.log(JSON.stringify(entry));
  }finally{await fs.rmdir(lock);}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={options};
