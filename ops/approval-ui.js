'use strict';
let reviewedApproval=null,approvalSending=false;
function renderApprovals() {
  const monitor=state.approvals || {items:[],warnings:[]},items=monitor.items || [];
  const host=$('#urgent-approvals');
  host.hidden=!items.length && !monitor.warnings?.length;
  host.innerHTML=items.map(p=>`<div class="approval-banner"><div><strong>${p.sent?'Decision sent · awaiting terminal update':'! Approval needed now'}</strong><p>${escape(p.reason || 'A command is waiting in the terminal.')}</p><span class="sub">${escape(p.label)} · first observed ${age(p.firstSeenAt)} ago · no deadline reported</span></div><button class="primary-action" data-approval="${escape(p.id)}">${p.sent?'Inspect':'Review command →'}</button></div>`).join('')+(monitor.warnings || []).map(w=>`<p class="notice">${escape(w)}</p>`).join('');
  document.title=items.some(p=>!p.sent)?`[${items.filter(p=>!p.sent).length} approval] Wine / Ops`:'Wine / Ops';
  if(reviewedApproval && $('#approval-review').open && !approvalSending) {
    const current=items.find(p=>p.id===reviewedApproval.id);
    if(!current || current.sent) {
      $('#approval-review-status').textContent=current?.sent?'Decision sent. Inspect the terminal for the outcome.':'This prompt changed or disappeared. Close and review the current request.';
      document.querySelectorAll('[data-approval-decision]').forEach(b=>b.disabled=true);
    }
  }
}
function reviewApproval(id) {
  const p=state.approvals?.items.find(p=>p.id===id);if(!p)return;
  reviewedApproval=p;
  $('#approval-body').innerHTML=`<p><strong>${escape(p.reason || 'Review the command before deciding.')}</strong></p><p class="sub">${escape(p.label)} · ${escape(p.thread || 'Thread not reported')} · ${escape(p.environment || 'Environment not reported')}</p><pre class="approval-command">${escape(p.command)}</pre><p class="source-note">Approve this command once. No lasting permission rule.</p><details><summary>Observed prompt and source details</summary><p class="source-note">Read from the registered tmux screen, not a structured Codex approval event. Terminal output can imitate a prompt; inspect the terminal if unexpected. Approve once sends the native “y” shortcut. A messageboard reply does not approve this request.</p><pre>${escape(p.prompt)}</pre></details><p id="approval-review-status" role="status">${p.sent?'Decision already sent. Inspect the terminal.':'Check the command, paths, destination and scope.'}</p><div class="form-actions"><button data-terminal="${escape(p.terminalId)}">Inspect terminal >_</button><button data-approval-decision="decline" ${p.sent?'disabled':''}>Decline</button><button class="primary-action" data-approval-decision="accept" ${p.sent?'disabled':''}>Approve once</button></div>`;
  $('#approval-review').showModal();
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='approval-close')$('#approval-review').close();
  if(button.dataset.approval)reviewApproval(button.dataset.approval);
  if(!button.dataset.approvalDecision || !reviewedApproval || approvalSending || button.disabled)return;
  approvalSending=true;
  document.querySelectorAll('[data-approval-decision]').forEach(b=>b.disabled=true);
  $('#approval-review-status').textContent='Checking that the same prompt is still waiting…';
  try {
    const response=await fetch('/api/approval-decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:reviewedApproval.id,decision:button.dataset.approvalDecision})});
    if(!response.ok)throw Error(await response.text());
    $('#approval-review-status').textContent='Decision sent. This does not confirm the command ran; inspect the terminal for its outcome.';
  }catch(e){$('#approval-review-status').textContent=e.message+' Close this review and refresh before deciding again.';}
  finally{approvalSending=false;await refresh();}
});
