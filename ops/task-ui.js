'use strict';

let currentTaskId=null, taskDetailRevision=null, taskActionPending=false;
const coordinator = () => state?.terminals?.find(t=>t.id==='orchestrator');
function coordinatorButton() {
  const entry=coordinator();
  return entry?.available ? `<button class="details-button" data-terminal="${escape(entry.id)}">Coordinator &gt;_</button>` : '<span class="sub">Coordinator terminal unavailable</span>';
}
function coordinatorBar() {
  const entry=coordinator(),agent=state.agents.find(a=>a.id===entry?.agentId);
  const status=agent ? health(agent)[0] : 'Session not observed';
  return `<div class="coordinator-bar"><span>Coordinator · ${escape(status)}</span>${coordinatorButton()}<span class="sub">New tasks wait for pickup. Open the terminal to prompt an idle coordinator.</span></div>`;
}
function pickupBadge(t) {
  if(!['ready','backlog'].includes(t.status))return '';
  return badge(t.pickup==='accepted'?'Accepted':t.pickup==='assigned'?'Assigned':'Awaiting pickup',t.pickup==='awaiting'?'pickup-wait':'good');
}
function dependencySummary(t) {
  const waiting=(t.dependencies || []).filter(id=>state.tasks.find(other=>other.id===id)?.status!=='done');
  return waiting.length ? `<div class="task-next">Waiting for ${waiting.map(id=>`<button data-task="${escape(id)}">${escape(id)}</button>`).join(', ')}</div>` : '';
}
function taskControls(t) {
  if(!t.editable)return '';
  const peers=state.tasks.filter(other=>other.editable && other.status===t.status && other.section===t.section);
  const index=peers.findIndex(other=>other.id===t.id);
  return `<div class="task-controls"><button data-edit-task="${escape(t.id)}">Edit</button>${['ready','backlog'].includes(t.status)?`<button data-move-task="${escape(t.id)}" data-direction="up" title="Move up within this section" aria-label="Move ${escape(t.title)} up" ${index===0?'disabled':''}>↑</button><button data-move-task="${escape(t.id)}" data-direction="down" title="Move down within this section" aria-label="Move ${escape(t.title)} down" ${index===peers.length-1?'disabled':''}>↓</button>`:''}</div>`;
}
function discussionRows(t) {
  return (t.discussion || []).map(row=>`<div class="discussion-entry"><div class="sub">${escape(when(row.at))} · ${escape(row.actor)}${row.kind==='TASK'?' · Task update':row.kind==='ACK'?' · Acknowledgment':''}</div><p>${escape(row.message)}</p></div>`).join('') || '<p class="sub">No discussion yet.</p>';
}
function taskDetail(id,noticeText='') {
  const t=state.tasks.find(t=>t.id===id);if(!t)return;
  const evidence=taskEvidence(t);
  show(`TASK / ${t.id}`,`<h1>${escape(t.title)}</h1><div id="task-live-status">${badge(taskState(t.status)[1],'task-label task-label-'+t.status)} ${pickupBadge(t)}</div><div id="task-live-owner">${taskOwner(t,true)}</div><p id="task-source-changed" class="sub"></p>${noticeText?`<p class="notice" role="status">${escape(noticeText)}</p>`:''}
    <dl><dt>Done when</dt><dd>${escape(t.done || 'Not recorded')}</dd><dt>Next</dt><dd>${escape(t.next || 'Not recorded')}</dd>${t.blocker?`<dt>Blocker</dt><dd>${escape(t.blocker)}</dd>`:''}${t.needs?`<dt>Needs</dt><dd>${escape(t.needs)}</dd>`:''}${t.notes?`<dt>Notes</dt><dd>${escape(t.notes)}</dd>`:''}</dl>${dependencySummary(t)}
    ${t.status==='blocked'?`<button data-blocker="${escape(t.id)}">Answer blocker →</button>`:''}
    ${evidence.runs.length?section(evidence.label)+(evidence.label==='Related app'?'<p class="source-note">These images belong to the app; they are not explicitly linked to this task.</p>':'')+visualCards(evidence.runs,4):''}
    ${section('Discussion')}<div id="task-discussion">${discussionRows(t)}</div>
    ${t.editable?`<form id="task-note" data-task-id="${escape(t.id)}" data-request-id="${crypto.randomUUID()}"><label for="task-note-text">Add a note or instruction</label><textarea id="task-note-text" maxlength="2000" required rows="3"></textarea><div class="form-actions"><span class="sub">Posts to the messageboard; does not change task status or wake an idle agent.</span><button type="submit">Send</button></div><p id="task-note-status" role="status"></p></form>`:''}
    <div class="task-actions">${t.editable?`<button data-edit-task="${escape(t.id)}">Edit</button>${t.status!=='backlog'?`<button data-status-task="${escape(t.id)}" data-status="backlog">Move to backlog</button>`:''}${t.status!=='deferred'?`<button data-status-task="${escape(t.id)}" data-status="deferred">Defer</button>`:''}${['done','deferred','backlog'].includes(t.status)?`<button data-status-task="${escape(t.id)}" data-status="ready">${t.status==='done'?'Reopen':'Queue task'}</button>`:''}${t.status==='review'?`<button data-status-task="${escape(t.id)}" data-status="done">Mark reviewed / done</button><button data-status-task="${escape(t.id)}" data-status="ready">Request another pass</button>`:''}`:'<span class="sub">Add a unique explicit id: in TODOS.md to edit this task.</span>'}</div><p id="task-action-status" role="status"></p>
    <details class="task-source"><summary>Source, timestamps and evidence references</summary><dl><dt>Started</dt><dd>${escape(when(t.startedAt))}</dd><dt>Last progress</dt><dd>${escape(when(t.progressAt))}</dd><dt>Accepted</dt><dd>${escape(when(t.acceptedAt))} ${escape(t.acceptedBy || '')}</dd><dt>Evidence / handoff</dt><dd>${escape(t.evidence || 'Not recorded')}</dd></dl><pre>${escape(t.body)}</pre>${link('/source?path=TODOS.md','Read full source')}</details>`);
  currentTaskId=id;taskDetailRevision=state.todoRevision;
  $('#detail').scrollTop=0;
}
function refreshTaskDetail() {
  if(!currentTaskId || !$('#detail').open)return;
  const t=state.tasks.find(t=>t.id===currentTaskId);
  if(!t){$('#task-source-changed').textContent='This task no longer exists. Close this view and refresh.';return;}
  $('#task-discussion').innerHTML=discussionRows(t);
  $('#task-live-status').innerHTML=badge(taskState(t.status)[1],'task-label task-label-'+t.status)+' '+pickupBadge(t);
  $('#task-live-owner').innerHTML=taskOwner(t,true);
  $('#task-source-changed').innerHTML=state.todoRevision!==taskDetailRevision?`Task source changed. <button data-task="${escape(t.id)}">Reload details</button>`:'';
}
function openTaskEditor(id=null,keepDraft=false) {
  const t=id?state.tasks.find(t=>t.id===id):null;
  if(id && !t?.editable)return;
  const form=$('#task-editor-form'),draft=keepDraft?Object.fromEntries(new FormData(form)):null;
  const selected=keepDraft?Array.from(form.elements.candidates.selectedOptions,o=>o.value):t?.explicitCandidates || [];
  $('#task-editor-title').textContent=t?'Edit task':'New task';
  form.querySelector('[type="submit"]').textContent=t?'Save changes':'Create task';
  form.dataset.taskId=id || '';form.dataset.revision=state.todoRevision;form.dataset.requestId=crypto.randomUUID();
  form.elements.title.value=draft?.title ?? t?.title ?? '';
  form.elements.done.value=draft?.done ?? t?.done ?? '';
  form.elements.next.value=draft?.next ?? t?.next ?? '';
  form.elements.notes.value=draft?.notes ?? t?.notes ?? '';
  form.elements.dependencies.value=draft?.dependencies ?? (t?.dependencies || []).join(', ');
  form.elements.candidates.multiple=selected.length>1;
  form.elements.candidates.innerHTML='<option value="">No candidate</option>'+state.candidates.map(c=>`<option value="${escape(c.id)}" ${selected.includes(c.id)?'selected':''}>${escape(c.name || c.id)}</option>`).join('');
  form.elements.queue.value=draft?.queue || 'ready';$('#task-queue-field').hidden=!!t;
  $('#task-editor-help').textContent=t?'Edits preserve assignment, status and existing evidence.':'Saved to TODOS.md. The coordinator acknowledges and assigns the worker.';
  $('#task-editor-status').textContent=keepDraft?'Latest revision loaded. Your draft is kept; compare it with the latest task below before saving.':'';
  $('#task-editor-latest').hidden=!keepDraft;
  $('#task-editor-latest').textContent=keepDraft?(t?.body || 'New task; latest queue revision loaded.'):'';
  $('#task-editor-conflict').hidden=true;
  if(!$('#task-editor').open)$('#task-editor').showModal();
  form.elements.title.focus();
}
async function postTask(url,body) {
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw Object.assign(Error(await response.text()),{status:response.status});
  return response.json();
}
async function taskAction(button,action) {
  if(taskActionPending)return;
  taskActionPending=true;button.disabled=true;
  const id=button.dataset.moveTask || button.dataset.statusTask;
  const message=$('#task-action-status') || $('#task-queue-status');
  if(message)message.textContent='Saving…';
  try {
    button.dataset.requestId ||= crypto.randomUUID();
    const result=await postTask('/api/tasks',{action,taskId:id,requestId:button.dataset.requestId,revision:currentTaskId===id?taskDetailRevision:state.todoRevision,direction:button.dataset.direction,status:button.dataset.status});
    await refreshAfterWrite();
    if(currentTaskId===id)taskDetail(id,result.warning || 'Saved. Changing queue status does not stop a running agent; coordinate through its terminal.');
    else if($('#task-queue-status'))$('#task-queue-status').textContent=result.warning || 'Queue updated.';
  }catch(e){if(message)message.textContent=e.message;}
  finally{taskActionPending=false;button.disabled=false;}
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button || !state)return;
  if(button.id==='new-task')openTaskEditor();
  if(button.dataset.editTask)openTaskEditor(button.dataset.editTask);
  if(button.dataset.moveTask)taskAction(button,'move');
  if(button.dataset.statusTask)taskAction(button,'status');
  if(['task-editor-close','task-editor-cancel'].includes(button.id))$('#task-editor').close();
  if(button.id==='task-editor-reload')refresh().then(()=>openTaskEditor($('#task-editor-form').dataset.taskId || null,true));
});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['task-editor-form','task-note'].includes(form.id))return;
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
  const editing=form.id==='task-editor-form',status=$(editing?'#task-editor-status':'#task-note-status');status.textContent=editing?'Saving…':'Posting…';
  try {
    if(editing){
      const values=new FormData(form),line=name=>String(values.get(name) || '').replace(/\s+/g,' ').trim();
      const result=await postTask('/api/tasks',{action:form.dataset.taskId?'edit':'create',taskId:form.dataset.taskId || undefined,requestId:form.dataset.requestId,revision:form.dataset.revision,fields:{title:line('title'),done:line('done'),next:line('next'),notes:line('notes'),candidates:values.getAll('candidates').filter(Boolean),dependencies:line('dependencies').split(/[,\s]+/).filter(Boolean),status:values.get('queue')}});
      $('#task-editor').close();await refreshAfterWrite();taskDetail(result.taskId,result.warning || (form.dataset.taskId?'Changes saved.':'Task created. Awaiting coordinator pickup.'));
    }else{
      await postTask('/api/task-note',{taskId:form.dataset.taskId,requestId:form.dataset.requestId,message:form.querySelector('textarea').value.replace(/\s+/g,' ').trim()});
      form.querySelector('textarea').value='';form.dataset.requestId=crypto.randomUUID();status.textContent='Posted. Awaiting acknowledgment.';await refreshAfterWrite();
    }
  }catch(e){status.textContent=e.message;if(editing && e.status===409)$('#task-editor-conflict').hidden=false;}
  finally{button.disabled=false;}
});
document.getElementById('detail').addEventListener('close',()=>{currentTaskId=null;});
