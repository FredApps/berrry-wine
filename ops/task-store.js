'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {parseTasks, safeFile} = require('./readers');
const revision = text => crypto.createHash('sha256').update(text).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), {status});
const statuses = ['ready','backlog','active','review','blocked','deferred','done'];
const idPattern = /^[\w.-]{1,100}$/;

function single(value, name, limit, required=false) {
  if(typeof value !== 'string' || value.length>limit || /[\x00-\x1f\x7f]/.test(value)) throw fail(400,`Invalid ${name}`);
  value=value.trim();
  if(required && !value)throw fail(400,`${name} is required`);
  return value;
}
function fields(input, tasks, candidates, taskId) {
  if(!input || typeof input!=='object')throw fail(400,'Task fields are required');
  const value={title:single(input.title,'title',250,true),done:single(input.done,'done criteria',2000,true),
    next:single(input.next ?? '','next step',2000),notes:single(input.notes ?? '','notes',4000)};
  if(!Array.isArray(input.candidates) || input.candidates.length>20 || input.candidates.some(id=>!candidates.includes(id)))throw fail(400,'Choose existing candidates');
  value.candidate=[...new Set(input.candidates)].join(', ');
  if(!Array.isArray(input.dependencies) || input.dependencies.length>30 || input.dependencies.some(id=>id===taskId || !idPattern.test(id) || tasks.filter(t=>t.id===id && t.kind==='checkbox').length!==1))throw fail(400,'Dependencies must be other tasks with unique IDs');
  const deps=[...new Set(input.dependencies)];
  function reaches(id,seen=new Set()) {
    if(id===taskId)return true;if(seen.has(id))return false;seen.add(id);
    return (tasks.find(t=>t.id===id)?.dependencies || []).some(next=>reaches(next,seen));
  }
  if(deps.some(id=>reaches(id)))throw fail(400,'Task dependencies cannot form a cycle');
  value['depends-on']=deps.join(', ');return value;
}
function setField(block,key,value) {
  let fenced=false,found=false;const out=[];
  block.split('\n').forEach((line,index)=>{
    if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;out.push(line);return;}
    if(index && !fenced && new RegExp(`^[ \\t]*${key}:[ \\t]*`,'i').test(line)) {
      if(!found && value){out.push(`  ${key}: ${value}`);found=true;}
      return;
    }
    out.push(line);
  });
  if(!found && value){let end=out.length;while(end>0 && !out[end-1].trim())end--;out.splice(end,0,`  ${key}: ${value}`);}
  return out.join('\n');
}
function replaceTask(text,task,block) {
  const lines=text.split('\n');lines.splice(task.line-1,task.endLine-task.line, ...block.split('\n'));return lines.join('\n');
}

function createTaskStore(root) {
  let queue=Promise.resolve();
  const serialize=work=>{const pending=queue.then(work);queue=pending.catch(()=>{});return pending;};
  async function appendBoard(line) {
    const board=await safeFile(root,'messageboard.txt');
    if(!board)throw fail(409,'Messageboard unavailable');
    const handle=await fs.open(board,'r');let prefix='';
    try{const {size}=await handle.stat();if(size){const byte=Buffer.alloc(1);await handle.read(byte,0,1,size-1);if(byte[0]!==10)prefix='\n';}}
    finally{await handle.close();}
    await fs.appendFile(board,prefix+line+'\n','utf8');
  }
  async function mutate(input) {
    if(!input || !['create','edit','move','status'].includes(input.action) || !/^[a-f0-9-]{36}$/.test(input.requestId || '') || !/^[a-f0-9]{64}$/.test(input.revision || ''))throw fail(400,'Valid action, request ID and source revision required');
    return serialize(async()=>{
      const scratch=path.join(root,'scratch');await fs.mkdir(scratch,{recursive:true});
      if(await fs.realpath(scratch)!==path.join(await fs.realpath(root),'scratch'))throw fail(409,'Scratch must be a local directory');
      const lock=path.join(scratch,'ops-task-write.lock');
      try{await fs.mkdir(lock);}catch(e){if(e.code==='EEXIST')throw fail(409,'Task file is being edited. Retry after the writer finishes.');throw e;}
      let temp;
      try {
        const file=await safeFile(root,'TODOS.md');if(!file)throw fail(409,'TODOS.md unavailable');
        if(file!==path.join(await fs.realpath(root),'TODOS.md'))throw fail(409,'TODOS.md must be a regular repository file');
        const source=await fs.readFile(file,'utf8');if(Buffer.byteLength(source)>2*1024*1024)throw fail(413,'Task file too large');
        const newline=source.includes('\r\n')?'\r\n':'\n',text=source.replace(/\r\n/g,'\n');
        const tasks=parseTasks(text),id=input.action==='create'?'T-'+input.requestId:input.taskId;
        if(!idPattern.test(id || ''))throw fail(400,'Stable task ID required');
        const matches=tasks.filter(t=>t.id===id);
        if(matches.length>1)throw fail(409,'Duplicate task ID; fix the source before editing');
        const task=matches[0];
        if(task?.lastRequest===input.requestId)return {taskId:id,saved:true,replayed:true};
        if(revision(source)!==input.revision)throw fail(409,'TODOS.md changed. Your draft is kept; reload the latest task before saving.');
        if(input.action!=='create' && (!task || !task.editable))throw fail(409,'Task has no unique explicit ID or cannot be edited');
        let updated;
        if(input.action==='create' || input.action==='edit') {
          if(input.action==='create' && task)throw fail(409,'Task ID already exists');
          if(input.action==='create' && text.split('\n').filter(line=>/^\s*(```|~~~)/.test(line)).length%2)throw fail(409,'Close the unfinished Markdown code fence before adding tasks');
          const manifest=JSON.parse(await fs.readFile(path.join(root,'test/candidate-corpus/manifest.json'),'utf8').catch(e=>e.code==='ENOENT'?'{}':Promise.reject(e)));
          const data=fields(input.fields,tasks,(manifest.candidates || []).map(c=>c.id),id);
          let block=task?text.split('\n').slice(task.line-1,task.endLine-1).join('\n'):`- [ ] ${data.title}\n  id: ${id}\n  created: ${new Date().toISOString()}\n  created-by: dashboard-user\n`;
          block=block.replace(/^(\s*[-*] \[[ xX~!]\])\s+[^\n]*/,(_,prefix)=>`${prefix} ${data.title}`);
          for(const [key,value] of Object.entries(data))if(key!=='title')block=setField(block,key,value);
          if(!task){
            if(!['ready','backlog'].includes(input.fields.status))throw fail(400,'New tasks start Up next or Backlog');
            block=setField(block,'status',input.fields.status);
          }
          block=setField(block,'last-request',input.requestId);
          if(task)updated=replaceTask(text,task,block);
          else {
            const heading='## Dashboard requests';
            const start=text.indexOf('\n'+heading+'\n');
            const at=text.startsWith(heading+'\n')?0:start<0?-1:start+1;
            const end=at<0?-1:text.indexOf('\n## ',at+heading.length);
            const gap=value=>value.endsWith('\n\n')?'':value.endsWith('\n')?'\n':'\n\n';
            if(at<0)updated=text+gap(text)+heading+'\n\n'+block.trimEnd()+'\n';
            else {const position=end<0?text.length:end,prefix=text.slice(0,position);updated=prefix+gap(prefix)+block.trimEnd()+'\n'+text.slice(position);}
          }
        } else if(input.action==='status') {
          if(!statuses.includes(input.status))throw fail(400,'Unknown task status');
          let block=text.split('\n').slice(task.line-1,task.endLine-1).join('\n');
          block=setField(block,'status',input.status);block=setField(block,'last-request',input.requestId);
          block=block.replace(/^(\s*[-*] )\[[ xX~!]\]/,`$1[${({active:'~',blocked:'!',done:'x'})[input.status] || ' '}]`);
          updated=replaceTask(text,task,block);
        } else {
          if(!['up','down'].includes(input.direction))throw fail(400,'Invalid move direction');
          const peers=tasks.filter(t=>t.status===task.status && t.section===task.section && t.editable);
          const neighbor=peers[peers.findIndex(t=>t.id===id)+(input.direction==='up'?-1:1)];
          if(!neighbor)throw fail(409,'Already at the end of this section queue');
          const lines=text.split('\n');
          const own=lines.slice(task.line-1,task.endLine-1).join('\n');
          const other=lines.slice(neighbor.line-1,neighbor.endLine-1).join('\n');
          const replacements=[{task,block:other},{task:neighbor,block:setField(own,'last-request',input.requestId)}].sort((a,b)=>b.task.line-a.task.line);
          updated=text;for(const replacement of replacements)updated=replaceTask(updated,replacement.task,replacement.block);
        }
        const result=updated.replace(/\n/g,newline);
        temp=path.join(path.dirname(file),`.ops-tasks-${crypto.randomUUID()}.tmp`);
        await fs.writeFile(temp,result,{flag:'wx',mode:(await fs.stat(file)).mode & 0o777});
        // Lock coordinates dashboard/agent writers; revision check also catches ordinary editor changes.
        if(await fs.readFile(file,'utf8')!==source)throw fail(409,'TODOS.md changed during the save. Draft kept; reload before retrying.');
        await fs.rename(temp,file);temp=null;
        let warning;
        try{await appendBoard(`${new Date().toISOString()} dashboard-user [OPS-TASK ${id}] ${input.action}${input.status?' '+input.status:''}; see TODOS.md. request:${input.requestId}`);}
        catch{warning='Task saved, but the messageboard notification failed. Open the coordinator terminal to request pickup.';}
        return {taskId:id,saved:true,warning};
      } finally {if(temp)await fs.unlink(temp).catch(()=>{});await fs.rmdir(lock);}
    });
  }
  function note(input) {
    if(!input || !idPattern.test(input.taskId || '') || !/^[a-f0-9-]{36}$/.test(input.requestId || ''))throw fail(400,'Task and request IDs required');
    const message=single(input.message,'message',2000,true);
    return serialize(async()=>{
      const tasks=parseTasks(await fs.readFile(path.join(root,'TODOS.md'),'utf8'));
      if(tasks.filter(t=>t.id===input.taskId && t.editable).length!==1)throw fail(409,'Task missing or ID is ambiguous');
      const board=await safeFile(root,'messageboard.txt');if(!board)throw fail(409,'Messageboard unavailable');
      const marker=`[OPS-NOTE ${input.taskId}] request:${input.requestId} `;
      if(!(await fs.readFile(board,'utf8')).split('\n').some(line=>line.includes(marker)))await appendBoard(`${new Date().toISOString()} dashboard-user ${marker}${message}`);
      return {posted:true};
    });
  }
  return {mutate,note};
}
module.exports={createTaskStore,revision};
