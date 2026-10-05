'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const rates=require('./analytics-rates.json');
const DAY=86400000, VERSION=2;
const zero=()=>({input:0,read:0,write:0,writeHour:0,output:0,reasoning:0});
const n=x=>Number.isFinite(x)&&x>=0?x:0;
function row(s,day){return s.days[day]??=( {day,agentId:s.id,provider:s.provider,tokens:zero(),requests:0,models:{},ms:{model:0,tools:0,tests:0,idle:0,unknown:0},commitClaims:[],warnings:[]} );}
function interval(s,start,end,phase){
  if(!Number.isFinite(start)||end<=start)return;
  // Long silent gaps are not evidence of uninterrupted model/tool activity.
  const cap=phase==='idle'?Infinity:phase==='model'?5*60000:30*60000;
  const boundary=Math.min(end,start+cap);
  for(let t=start;t<end;){const next=Math.min(end,(Math.floor(t/DAY)+1)*DAY,t<boundary?boundary:Infinity);row(s,new Date(t).toISOString().slice(0,10)).ms[t<boundary?phase:'unknown']+=next-t;t=next;}
}
function cost(tokens,model,context,tier){
  const key=Object.keys(rates.models).find(k=>model===k||model.startsWith(k+'-20'));const r=rates.models[key];if(!r)return null;
  const long=r.longContextAbove&&context>r.longContextAbove;
  const factor=['priority','fast'].includes(tier)?2:['batch','flex'].includes(tier)?0.5:1;
  return factor*((tokens.input*r.input+tokens.read*r.read+tokens.write*r.write+tokens.writeHour*(r.writeHour||r.write))*(long?r.longInputMultiplier:1)+tokens.output*r.output*(long?r.longOutputMultiplier:1))/1e6;
}
function createAccumulator(agent){return {version:VERSION,id:agent.id,provider:agent.provider,startedAt:Date.parse(agent.startedAt)||0,model:'unknown',tier:null,days:{},usage:{},calls:{},total:null,last:null,phase:'unknown',offset:0,invalid:0};}
function addUsage(s,time,model,u,key,context){
  const old=s.usage[key]||zero(),delta=zero();let changed=false;
  for(const k of Object.keys(delta)){delta[k]=Math.max(0,n(u[k])-n(old[k]));if(delta[k])changed=true;}
  if(!changed)return;s.usage[key]=u;
  const r=row(s,new Date(time).toISOString().slice(0,10));const m=r.models[model]??={tokens:zero(),requests:0,estimatedUsd:0,unpricedTokens:0};
  if(!Object.hasOwn(old,'seen')){r.requests++;m.requests++;}s.usage[key].seen=true;
  for(const k of Object.keys(delta)){r.tokens[k]+=delta[k];m.tokens[k]+=delta[k];}
  const value=cost(delta,model,context,s.tier);if(value===null)m.unpricedTokens+=delta.input+delta.read+delta.write+delta.writeHour+delta.output;else m.estimatedUsd+=value;
}
function tool(s,id,name,args){const text=typeof args==='string'?args:JSON.stringify(args||{});s.calls[id]={kind:/\b(?:test[/-]|test-\w|npm (?:run )?test|node --test|pytest|cargo test|benchmark|bench[/-])/i.test(name+' '+text)?'tests':'tools',commit:/\bgit\s+commit\b/.test(text)};}
function result(s,id,content,time){
  // Async exec results may arrive through wait/write_stdin with a different call id.
  // Unwrap JSON transport envelopes, then recognize Git's own line-oriented receipt.
  const texts=[];
  function unwrap(value){
    if(typeof value==='string'){texts.push(value);try{const parsed=JSON.parse(value);if(parsed!==value)unwrap(parsed);}catch{} }
    else if(Array.isArray(value))value.forEach(unwrap);
    else if(value&&typeof value==='object')for(const k of ['output','text','content'])if(value[k]!==undefined)unwrap(value[k]);
  }
  unwrap(content);
  for(const text of texts)for(const m of text.matchAll(/^\[[^\]\n]*\b([a-f0-9]{7,40})\] +[^\n]+/gm)){
    const r=row(s,new Date(time).toISOString().slice(0,10));if(!r.commitClaims.includes(m[1]))r.commitClaims.push(m[1]);
  }
  delete s.calls[id];
}
function ingest(s,e){
  const p=e.payload||{},time=Date.parse(e.timestamp);if(!Number.isFinite(time))return;
  if(e.type==='turn_context'){s.model=p.model||s.model;s.tier=p.service_tier||null;}
  if(time<s.startedAt){if(s.provider==='codex' && p.type==='token_count' && p.info?.total_token_usage)s.total=p.info.total_token_usage;return;}
  if(s.last!==null && time>=s.last)interval(s,s.last,time,s.phase);
  if(s.last===null||time>=s.last)s.last=time;
  let idle=false,active=false;
  if(s.provider==='codex'){
    if(e.type==='event_msg'){
      if(['task_complete','turn_aborted'].includes(p.type))idle=true;
      if(['task_started','user_message'].includes(p.type))active=true;
      if(p.type==='token_count'&&p.info){
        const total=p.info.total_token_usage,last=p.info.last_token_usage;
        if(total){const reset=s.total&&n(total.input_tokens)<n(s.total.input_tokens);const prev=reset?{}:s.total||{};
          const diff=k=>Math.max(0,n(total[k])-n(prev[k]));const read=diff('cached_input_tokens'),write=diff('cache_write_input_tokens');
          const u={input:Math.max(0,diff('input_tokens')-read-write),read,write,writeHour:0,output:diff('output_tokens'),reasoning:diff('reasoning_output_tokens')};
          addUsage(s,time,s.model,u,'codex:'+time+':'+JSON.stringify(total),n(last?.input_tokens));s.total=total;
        }else if(last){const read=n(last.cached_input_tokens),write=n(last.cache_write_input_tokens);addUsage(s,time,s.model,{input:Math.max(0,n(last.input_tokens)-read-write),read,write,writeHour:0,output:n(last.output_tokens),reasoning:n(last.reasoning_output_tokens)},'event:'+(e.id||time),n(last.input_tokens));}
      }
    }
    if(e.type==='response_item'){
      if(['function_call','custom_tool_call'].includes(p.type))tool(s,p.call_id,p.name||'',p.arguments||p.input);
      if(['function_call_output','custom_tool_call_output'].includes(p.type))result(s,p.call_id,p.output,time);
      if(['reasoning','message'].includes(p.type))active=true;
    }
  }else{
    const m=e.message||{},content=Array.isArray(m.content)?m.content:[];
    if(e.type==='assistant'){
      s.model=m.model||s.model;const u=m.usage;
      if(u){const writeHour=n(u.cache_creation?.ephemeral_1h_input_tokens);addUsage(s,time,s.model,{input:n(u.input_tokens),read:n(u.cache_read_input_tokens),write:Math.max(0,n(u.cache_creation_input_tokens)-writeHour),writeHour,output:n(u.output_tokens),reasoning:0},m.id||e.uuid||String(time),n(u.input_tokens)+n(u.cache_read_input_tokens)+n(u.cache_creation_input_tokens));}
      for(const c of content)if(c.type==='tool_use')tool(s,c.id,c.name,c.input);
      idle=m.stop_reason==='end_turn';active=!idle;
    }
    if(e.type==='user'){active=true;for(const c of content)if(c.type==='tool_result')result(s,c.tool_use_id,c.content,time);}
    if(e.type==='system'&&e.subtype==='turn_duration')idle=true;
  }
  if(idle){s.phase='idle';s.calls={};}else if(Object.keys(s.calls).length)s.phase=Object.values(s.calls).some(c=>c.kind==='tests')?'tests':'tools';else if(active||s.phase==='tools'||s.phase==='tests')s.phase='model';
}
async function updateFile(file,s){
  const st=await fsp.stat(file);if(s.inode&&s.inode!==st.ino||st.size<s.offset)return null;
  s.inode=st.ino;if(st.size===s.offset)return s;
  let buf=Buffer.alloc(0),position=s.offset;
  const stream=fs.createReadStream(file,{start:s.offset,end:st.size-1,highWaterMark:256*1024});
  for await(const chunk of stream){buf=Buffer.concat([buf,chunk]);let at;while((at=buf.indexOf(10))>=0){const line=buf.subarray(0,at);position+=at+1;try{ingest(s,JSON.parse(line.toString('utf8')));}catch{s.invalid++;}buf=buf.subarray(at+1);}if(buf.length>32*1024*1024)throw Error('Oversized log record');}
  s.offset=position;return s;
}
function createAnalytics(root){let cached=null,pending=null;const dir=path.join(root,'scratch/analytics');
  async function build(snapshot){
    await fsp.mkdir(dir,{recursive:true});const now=Date.now(),cutoff=new Date(now-13*DAY).toISOString().slice(0,10),rows=[],warnings=[],seen=new Set();let scanned=0;
    for(const agent of snapshot.agents||[]){if(!agent.logFile||seen.has(agent.id))continue;seen.add(agent.id);
      const cacheFile=path.join(dir,crypto.createHash('sha256').update(agent.logFile).digest('hex')+'.json');
      try{let s;try{s=JSON.parse(await fsp.readFile(cacheFile,'utf8'));}catch{}if(!s||s.version!==VERSION||s.id!==agent.id)s=createAccumulator(agent);
        s=await updateFile(agent.logFile,s)||await updateFile(agent.logFile,createAccumulator(agent));
        for(const day of Object.keys(s.days))if(day<cutoff)delete s.days[day];
        await fsp.writeFile(cacheFile+'.tmp',JSON.stringify(s));await fsp.rename(cacheFile+'.tmp',cacheFile);scanned++;
        if(s.invalid)warnings.push(agent.id+': '+s.invalid+' unreadable records');
        // Do not extrapolate after the final event: an exited session is not forever idle.
        for(const r of Object.values(s.days))rows.push({...r,title:agent.title||agent.id,parentAgentId:agent.parentAgentId||null});
      }catch(e){warnings.push(agent.id+': '+e.message);}
    }
    let commits=[];try{const{stdout}=await promisify(execFile)('git',['log','--all','--since='+cutoff,'--format=%H%x09%cI','--max-count=10000'],{cwd:root,maxBuffer:2*1024*1024});commits=stdout.trim().split('\n').filter(Boolean).map(l=>{const[hash,time]=l.split('\t');return{hash,day:new Date(time).toISOString().slice(0,10)}});}catch{warnings.push('Git commit census unavailable');}
    const owners=new Map();for(const r of rows)for(const short of r.commitClaims){const matches=commits.filter(c=>c.hash.startsWith(short));if(matches.length===1){const id=matches[0].hash;let set=owners.get(id)||new Set();set.add(r.agentId);owners.set(id,set);}}
    for(const r of rows){r.commits=commits.filter(c=>c.day===r.day&&owners.get(c.hash)?.size===1&&owners.get(c.hash).has(r.agentId)).map(c=>c.hash);r.estimatedUsd=Object.values(r.models).reduce((n,m)=>n+m.estimatedUsd,0);r.unpricedTokens=Object.values(r.models).reduce((n,m)=>n+m.unpricedTokens,0);delete r.commitClaims;}
    const days=[...new Set(rows.map(r=>r.day))].sort().reverse().map(day=>({day,commits:commits.filter(c=>c.day===day).length,unattributedCommits:commits.filter(c=>c.day===day&&owners.get(c.hash)?.size!==1).length}));
    const out={generatedAt:new Date().toISOString(),timezone:'UTC',days,rows,scannedSessions:scanned,warnings:[...warnings,...(snapshot.warnings||[]).filter(w=>/session|100 most|log/i.test(w))],rates,notes:['Own usage per session; child usage is not rolled into its parent.','API-equivalent estimates at configured rates, not invoiced or subscription spend. Unknown models remain unpriced; absent tier/cache-write metadata limits accuracy.','Thinking / response time is inferred between events, not measured model compute. Tool/test time includes waiting; classification uses tool commands.','Intervals stop at the last log event. Model gaps beyond 5m and tool gaps beyond 30m become unknown. Idle means observed between turns; concurrent agents overlap.','Commits require Git receipt lines in tool output and a matching local Git hash; ambiguous or unobserved commits stay unattributed.','Coverage is the dashboard-discovered project sessions (up to 100 recent logs per provider), with full log accounting for those sessions. Last 14 UTC days.']};
    await fsp.writeFile(path.join(dir,'daily.json.tmp'),JSON.stringify(out,null,2));await fsp.rename(path.join(dir,'daily.json.tmp'),path.join(dir,'daily.json'));return out;
  }
  return async snapshot=>{if(cached&&Date.now()-Date.parse(cached.generatedAt)<60000)return cached;if(!pending)pending=build(snapshot).then(v=>cached=v).finally(()=>pending=null);return pending;};
}
module.exports={createAnalytics,createAccumulator,ingest,interval,cost,updateFile};
