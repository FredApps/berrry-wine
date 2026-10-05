'use strict';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let state, view = location.hash.slice(1) || 'overview', filter = 'all', query = '', loading = false;
const num = n => n === null || n === undefined ? 'unknown' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
function age(value) { if (!value) return 'unknown'; const minutes = Math.max(0, (Date.now() - Date.parse(value)) / 60000); return minutes < 1 ? '<1m' : minutes < 60 ? `${Math.floor(minutes)}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${Math.floor(minutes % 60)}m` : `${Math.floor(minutes / 1440)}d`; }
const when = value => value ? new Date(value).toLocaleString() : 'unknown';
const badge = (text, tone = '') => `<span class="badge ${tone}">${escape(text)}</span>`;
const tone = status => ['passed', 'done', 'present', 'reviewed'].includes(status) ? 'good' : ['failed', 'blocked', 'harness-error'].includes(status) ? 'bad' : ['active', 'timeout', 'partial', 'running'].includes(status) ? 'warn' : '';
const matches = value => !query || JSON.stringify(value).toLowerCase().includes(query);
const empty = text => `<div class="empty">${escape(text)}</div>`;
const link = (url, text) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(text)} ↗</a>`;
const taskButton = t => `<button data-task="${escape(t.id)}">${escape(t.title)}</button>`;
const taskStates = [
  ['active', 'Running', 'Work assigned and in progress', '▶'],
  ['ready', 'Up next', 'Queued in source order; see any prerequisites below', '→'],
  ['review', 'Needs review', 'Results awaiting review or integration', '◇'],
  ['blocked', 'Blocked', 'A dependency or decision must be resolved', '!'],
  ['backlog', 'Backlog', 'Not scheduled yet', '○'],
  ['deferred', 'Deferred', 'Intentionally set aside', 'Ⅱ'],
  ['done', 'Done', 'Completed tasks; evidence remains available', '✓'],
  ['unknown', 'Historical notes', 'No current task status recorded', '·'],
];
const expandedTaskGroups = new Map();
let agentHistoryOpen=false;
let activityLimit=25;
let activityFilter='all';
let corpusGroup='all';
let corpusCategory='all';
let corpusRelease='all';
let corpusLaunch='all';
let queueBriefingOpen=false;
const taskState = status => taskStates.find(s => s[0] === status) || taskStates.at(-1);
const sortedTasks = tasks => [...tasks].sort((a,b) => taskStates.indexOf(taskState(a.status)) - taskStates.indexOf(taskState(b.status)) || a.line - b.line);
function taskEvidence(t) {
  const visualRuns = state.runs.filter(r => r.visuals?.length);
  const direct = visualRuns.filter(r => r.taskId === t.id);
  return direct.length ? {runs:direct,label:'Task evidence'} : {runs:visualRuns.filter(r => t.candidateIds?.includes(r.candidateId)),label:'Related app'};
}
function taskPreview(t) {
  const {runs,label} = taskEvidence(t), run = runs[0];
  if (!run) return '';
  const visual = run.visuals.at(-1);
  return `<button class="task-preview" data-run="${escape(run.key)}" aria-label="Open ${escape(label.toLowerCase())} for ${escape(t.title)}"><img src="${escape(visual.url)}" alt="${escape(visual.kind + ': ' + (run.route || visual.name))}" loading="lazy"><span>${escape(label)} · ${age(run.startedAt)} ago</span></button>`;
}
function taskOwner(t, details=false) {
  if(!t.owner)return `<div class="task-owner"><span class="sub">Unassigned</span>${coordinatorButton()}</div>`;
  const agent=state.agents.find(a=>a.id===t.owner);
  const identity=details ? t.owner : t.owner.split(':')[0]+' · '+t.owner.split(':').at(-1).slice(-8);
  const [activity,color]=agent ? health(agent) : ['Session not observed',''];
  const pid=agent?.process?.matches?.[0]?.pid;
  return `<div class="task-owner"><span class="sub">Assigned to</span>${agent ? `<button class="owner-link" data-agent="${escape(agent.id)}" title="${escape(agent.id)}">${escape(identity)} ↗</button>` : `<span class="sub" title="${escape(t.owner)}">${escape(identity)}</span>`}${pid ? `<span class="sub">PID ${pid}</span>` : ''}${badge(activity,color)}${terminalLink({id:t.owner},details)}</div>`;
}
function taskRows(tasks) { return tasks.length ? sortedTasks(tasks).map(t => {
  const [status,label,,symbol] = taskState(t.status);
  const next = status === 'blocked' ? t.blocker || t.next : t.next;
  return `<div class="task task-${status}"><span class="task-symbol" aria-hidden="true">${symbol}</span><div class="task-body">${taskButton(t)}${t.status==='ready' && t.done?`<div class="task-next"><strong>Done when:</strong> ${escape(t.done)}</div>`:''}${next ? `<div class="task-next"><strong>${status === 'blocked' ? 'Blocked by' : status === 'done' ? 'Result' : 'Next'}:</strong> ${escape(next)}</div>` : ''}${dependencySummary(t)}${taskOwner(t)}<div class="sub">${escape(t.id)}${t.progressAt ? ' · Updated ' + age(t.progressAt) + ' ago' : ''}</div><div class="task-controls"><button class="task-details" data-task="${escape(t.id)}">${status==='review'?'Review →':'Details →'}</button>${taskControls(t)}</div></div>${taskPreview(t)}<div class="task-statuses">${badge(label, 'task-label task-label-' + status)}${pickupBadge(t)}</div></div>`;
}).join('') : empty('No matching tasks.'); }
function health(a) {
  if (!a.lastActivityAt) return ['Unknown', ''];
  if (a.state === 'idle') return ['Turn ended', ''];
  if (Date.now() - Date.parse(a.lastActivityAt) > 15 * 60000) return ['Quiet · check session', 'warn'];
  return [a.state === 'tool' ? 'Tool activity' : 'Recent activity', 'good'];
}
function visualCards(runs, limit = 6) {
  const cards = runs.filter(r => r.visuals?.length).slice(0, limit);
  return cards.length ? `<div class="visual-grid">${cards.map(r => {
    const image = r.visuals[r.visuals.length - 1];
    const candidate = state.candidates.find(c => c.id === r.candidateId);
    return `<button class="visual-card" data-run="${escape(r.key)}"><span class="visual-image"><img src="${escape(image.url)}" alt="${escape(image.kind + ': ' + (r.route || image.name))}" loading="lazy">${image.kind === 'diagram' ? '<span class="visual-kind">Diagram</span>' : ''}</span><span class="visual-caption"><strong>${escape(candidate?.name || r.candidateId)}</strong><span>${age(r.startedAt)} ago${r.outcome === 'failed' || r.outcome === 'harness-error' ? ' · ' + escape(r.outcome) : ''} · Open evidence →</span></span></button>`;
  }).join('')}</div>` : empty('No linked visuals yet.');
}
function agentRuns(a) { return state.runs.filter(r => r.agentId === a.id); }
function terminalLink(a, details=false) {
  const entry=state.terminals?.find(t=>t.agentId===a.id);
  if(!entry)return coordinator()?.available && state.tasks.some(t=>t.owner===a.id && ['active','ready','blocked','review'].includes(t.status)) ? coordinatorButton() : details ? '<span class="sub">Terminal unavailable · no registered tmux session</span>' : '';
  return `<button class="details-button" data-terminal="${escape(entry.id)}" ${entry.available?'':'disabled'} title="${escape(entry.available?'Open in view mode':entry.reason)}">${entry.available?'Terminal >_':'Terminal unavailable'}</button>`;
}
const cpuUsage = value => Number.isFinite(value) ? value.toFixed(1) + '%' : '—';
const memoryUsage = value => !Number.isFinite(value) ? '—' : value >= 1024 ** 3 ? (value / 1024 ** 3).toFixed(1) + ' GiB' : Math.round(value / 1024 ** 2) + ' MiB';
function processSummary(p, compact = false) {
  if (!p?.matches.length) return `<div class="process-line sub">PID ${p?.status === 'unavailable' ? 'unavailable' : 'not matched'}</div>`;
  return `<div class="process-line">${p.matches.map(m => `<span class="sub process-host">PID ${m.pid} · ${cpuUsage(m.cpuPercent)} CPU · ${memoryUsage(m.rssBytes)} RSS${m.shared ? ' · shared host' : ''}</span>`).join('')}${p.childCount ? `<span class="sub process-background">Background ${p.childCount} · ${cpuUsage(p.childCpuPercent)} CPU · ${memoryUsage(p.childRssBytes)} RSS</span>` : ''}${compact ? '' : `<span class="sub">Sampled ${age(p.checkedAt)} ago</span>`}</div>`;
}
function processDetails(p) {
  if (!p) return empty('No process observation available.');
  const rows = [...p.matches.map(m => ({ ...m, relation: m.evidence + (m.shared ? ' · shared' : '') })), ...p.children.map(m => ({ ...m, relation: 'Host descendant' }))];
  return section('Associated local processes') + processSummary(p) + `<p class="source-note">${escape(p.note || 'Exact session-log handle or verified Claude registry match. Descendants belong to the host; they may serve other sessions. Missing matches do not prove a session has exited.')} Sampled ${escape(when(p.checkedAt))}.</p>` +
    (rows.length ? `<div class="process-table"><table><thead><tr><th>PID / parent</th><th>Process</th><th>CPU</th><th>Memory RSS</th><th>OS state / age</th><th>Association</th></tr></thead><tbody>${rows.map(m => `<tr><td>${m.pid} / ${m.ppid}</td><td>${escape(m.name)}</td><td>${cpuUsage(m.cpuPercent)}</td><td>${memoryUsage(m.rssBytes)}</td><td>${escape(m.state)} / ${escape(m.elapsed)}</td><td>${escape(m.relation)}</td></tr>`).join('')}</tbody></table></div><p class="source-note">CPU is the OS-reported process percentage, not a model-utilization measure; it can exceed 100%. RSS is resident memory; summed RSS may count shared pages more than once. Background means host descendants, including shells, tools and services; detached/reparented or remote jobs are not attributed. Shared-host values are not per-agent usage. OS state: R runnable, S sleeping, T stopped, Z zombie.${p.childCount > p.children.length ? ` Showing the busiest ${p.children.length} of ${p.childCount} descendants; totals include all observed descendants.` : ''}</p>` : '');
}
function agentSignal(a) {
  const liveApproval=state.approvals?.items.some(p=>!p.sent && state.terminals?.some(t=>t.id===p.terminalId && t.agentId===a.id));
  const active=state.tasks.some(t=>t.owner===a.id && t.status==='active');
  const blocked=!active && state.tasks.some(t=>t.owner===a.id && t.status==='blocked');
  if(liveApproval)return {label:'Awaiting approval',color:'warn',rank:0,reason:'Review the live prompt to continue.'};
  if(blocked)return {label:'Task blocked',color:'warn',rank:1,reason:'Read the blocker and required decision.'};
  if(active && a.state==='idle')return {label:'Assigned · turn ended',color:'warn',rank:2,reason:'Check the handoff or next pickup; the task is still marked running.'};
  const [label,color]=health(a);
  return {label,color,rank:color==='warn'?2:3,reason:color==='warn'?'No recent session activity. Inspect the terminal; this alone does not prove a stall.':''};
}
function agentCard(a) {
  const {label,color,reason,rank}=agentSignal(a);
  const latest = agentRuns(a).find(r => r.visuals?.length);
  const image = latest?.visuals.at(-1);
  const candidate = latest && state.candidates.find(c => c.id === latest.candidateId);
  const name = coordinator()?.agentId===a.id ? 'Coordinator' : a.taskTitle || (a.title && a.title !== a.id ? a.title : candidate?.name || 'Untitled session');
  const contextPercent = a.contextLimit && a.contextEstimate !== null ? Math.round(100 * a.contextEstimate / a.contextLimit) : 0;
  return `<article class="agent panel ${rank<3?'agent-attention':'agent-routine'}"><div class="agent-head"><span class="provider ${escape(a.provider)}">${escape(a.provider.toUpperCase())}</span>${badge(label, color)}</div><div class="agent-content"><div class="agent-copy"><button class="agent-title" data-agent="${escape(a.id)}">${escape(name)}</button>${reason?`<p class="agent-decision">${escape(reason)}</p>`:''}<div class="agent-meta">${a.lastActivityAt ? `<span>Activity ${age(a.lastActivityAt)} ago</span>` : ''}${a.taskStartedAt ? `<span>On task ${age(a.taskStartedAt)}</span>` : ''}${a.progressAt ? `<span>Progress ${age(a.progressAt)} ago</span>` : ''}</div>${contextPercent >= 90 ? badge(`Context estimate ~${contextPercent}%`, 'warn') : ''}</div>${image ? `<button class="agent-preview" data-run="${escape(latest.key)}" aria-label="Open latest evidence for ${escape(candidate?.name || latest.candidateId)}"><img src="${escape(image.url)}" alt="${escape(candidate?.name || latest.candidateId)}" loading="lazy"><span>${age(latest.startedAt)} ago</span></button>` : ''}</div><div class="agent-footer">${processSummary(a.process, true)}${terminalLink(a)}<button class="details-button" data-agent="${escape(a.id)}">Details →</button></div></article>`;
}
function feedRows(rows, truncate = false) { return rows.map(row => {
  const commit=row.type==='commit',text=String(commit?(row.subject || row.text || 'Untitled commit'):(row.text || ''));
  const date=row.time && Number.isFinite(Date.parse(row.time)) ? `<time datetime="${escape(row.time)}">${escape(when(row.time))}</time>` : '<span>Date not recorded</span>';
  const metadata=commit?`<code>${escape(row.shortHash || row.hash?.slice(0,8) || 'unknown')}</code><span>${escape(row.author || 'Unknown author')}</span>`:'';
  const github=commit && typeof row.url==='string' && /^https:\/\/github\.com\//i.test(row.url) && !/[\u0000-\u0020]/.test(row.url)?`<a class="commit-link" href="${escape(row.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape('Open commit '+(row.shortHash || row.hash || '')+' on GitHub')}">GitHub ↗</a>`:'';
  return `<div class="feed-row${commit?' feed-commit':''}"><div class="sub activity-meta"><span>${commit?'COMMIT':'MESSAGEBOARD'}</span>${metadata}${date}${github}</div><div class="feed-text${commit?' commit-subject':''}">${escape(truncate && text.length>360?text.slice(0,360)+'…':text)}</div></div>`;
}).join('') || empty('No messageboard entries.'); }
function title(name, subtitle, action = '') { return `<div class="title-row"><div><div class="eyebrow"><span class="file-dot"></span> WINE-ASSEMBLY // LOCAL OBSERVER</div><h1>${escape(name)}</h1><div class="sub">${escape(subtitle)}</div></div>${action}</div>`; }
function section(name, target) { return `<div class="section-head"><h2>${name}</h2>${target ? `<a href="#${target}">View all →</a>` : ''}</div>`; }
function notice() { return state.warnings.length ? `<div class="notice"><details><summary>${state.warnings.length} source notices</summary><ul>${state.warnings.map(w => `<li>${escape(w)}</li>`).join('')}</ul></details></div>` : ''; }
function statusSummary(compact=false) {
  const status=state.projectStatus || {},lines=(status.body || '').split('\n');
  const headlineIndex=lines.findIndex(line=>/^# /.test(line));
  const headline=headlineIndex>=0?lines.splice(headlineIndex,1)[0].slice(2):lines.find(line=>line.trim()) || 'Agents have not posted a summary yet.';
  const freshness=status.updatedAt?`Updated ${age(status.updatedAt)} ago`:'Update time not recorded';
  const old=status.updatedAt && Date.now()-Date.parse(status.updatedAt)>24*60*60*1000;
  if(compact)return `<div class="briefing-compact"><div><span class="eyebrow">WHAT MATTERS NOW</span><p>${escape(headline)}</p><span class="sub">${escape(freshness)}${old?' · Review freshness':''}</span></div><button data-status-summary="open">Read TLDR →</button></div>`;
  const inline=text=>escape(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
  const groups=[{heading:'',lines:[]}];
  for(const line of lines){const heading=/^#{2,6} (.+)$/.exec(line);if(heading)groups.push({heading:heading[1],lines:[]});else groups.at(-1).lines.push(line);}
  const content=groups.filter(g=>g.heading || g.lines.some(line=>line.trim())).map(group=>{
    let html='',list=false,paragraph=[];
    const flush=()=>{if(paragraph.length){html+=`<p>${inline(paragraph.join(' '))}</p>`;paragraph=[];}if(list){html+='</ul>';list=false;}};
    for(const line of group.lines){const bullet=/^\s*[-*] (.+)$/.exec(line);if(bullet){if(paragraph.length)flush();if(!list){html+='<ul>';list=true;}html+=`<li>${inline(bullet[1])}</li>`;}else{if(!line.trim())flush();else{if(list)flush();paragraph.push(line.trim());}}}flush();
    return `<section>${group.heading?`<h3>${escape(group.heading)}</h3>`:''}${html}</section>`;
  }).join('');
  return `<article class="briefing panel"><div class="briefing-top"><h2>// What matters now</h2>${link('/source?path=ops/STATUS.md','Source')}</div><p class="briefing-headline">${escape(headline)}</p><div class="briefing-meta sub">${escape(freshness)}${status.author?' · '+escape(status.author):''}${old?' · Review freshness':''} · Agent-written summary</div><div class="briefing-copy">${content || '<p class="sub">Agents can publish the current outcome, decisions needed, and next step in ops/STATUS.md.</p>'}</div></article>`;
}
function blockerDependencies(t) {
  return BlockerModel.dependencies(state,t);
}
function blockerKind(t) {
  return BlockerModel.kind(state,t);
}
function blockerOwner(t) {
  return state.terminals?.find(x=>x.agentId===t.owner)?.label || (t.owner?t.owner.split(':')[0]+' agent · '+t.owner.split(':').at(-1).slice(-6):'Unassigned');
}
function blockerRows(tasks) {
  return BlockerModel.order(state,tasks).map(t=>{
    const [kind,color,action]=blockerKind(t),dependencies=blockerDependencies(t);
    const children=state.tasks.filter(x=>blockerDependencies(x).some(d=>d.id===t.id));
    const owner=state.agents.find(a=>a.id===t.owner);
    const ownerName=blockerOwner(t);
    const next=dependencies.length?'Waiting for '+dependencies.map(d=>d.title).join('; '):kind==='Capacity needed'?(t.waitingOn||t.needs):t.needs||t.next||'Owner needs to record a concrete next step.';
    return `<article class="blocker panel"><div class="blocker-heading">${taskButton(t)}${badge(kind,color)}</div><p class="blocker-ask">${escape(next)}</p>${kind==='Review blocked'?'<p class="source-note">Automated review stopped validation. No dashboard override.</p>':''}<div class="blocker-meta sub"><span title="${escape(t.owner)}">${escape(ownerName)}</span><span>${t.progressAt?'Task updated '+age(t.progressAt)+' ago':'Task update time not recorded'}</span>${t.blockedAt?`<span>Blocked ${age(t.blockedAt)}</span>`:''}</div>${t.replies?.length?'<p class="reply-pending">Reply posted · awaiting owner verification</p>':''}${children.length?`<div class="blocker-dependents"><span class="sub">Also holds up</span>${children.map(c=>`<button data-task="${escape(c.id)}">${escape(c.title)} →</button>`).join('')}</div>`:''}<details class="blocker-evidence"><summary>Evidence and background</summary><p>${escape(t.blocker||'Reason not recorded.')}</p>${t.needs?`<p>Needs: ${escape(t.needs)}</p>`:''}${dependencies.map(d=>`<p>Waiting on ${taskButton(d)}</p>`).join('')}</details><div class="blocker-footer">${terminalLink({id:t.owner})}${dependencies.length?`<button data-blocker="${escape(dependencies[0].id)}">View dependency →</button>`:''}<button data-blocker="${escape(t.id)}">${escape(dependencies.length?'Message owner':action)} →</button></div></article>`;
  }).join('') || empty('No matching blockers.');
}
function blockersView() {
  const {blocked,approvals}=BlockerModel.blockerSummary(state);
  const relevant=blocked.filter(t=>matches(t)||blocked.some(c=>matches(c)&&blockerDependencies(c).some(d=>d.id===t.id)));
  const roots=BlockerModel.primaryRoots(state,relevant);
  return title('Blockers',`${approvals.length} live approval${approvals.length===1?'':'s'} · ${roots.length} primary blockers · ${relevant.length-roots.length} dependent task${relevant.length-roots.length===1?'':'s'}`) +
    section('Your action')+(approvals.length?`<div class="blocker-list">${approvals.map(p=>`<article class="blocker panel blocker-action"><div class="blocker-heading"><strong>${escape(p.reason||'Command approval needed')}</strong>${badge('Live approval','warn')}</div><p class="sub">${escape(p.label)} · waiting ${age(p.firstSeenAt)} · checked against the live terminal</p><button data-approval="${escape(p.id)}">Review command →</button></article>`).join('')}</div>`:'<p class="sub">No live command approvals. Other requests and dependencies are below.</p>')+
    section('Waiting / needs follow-up')+`<div class="blocker-list">${blockerRows(roots)}</div>`;
}
function blockerDetail(id) {
  const t = state.tasks.find(t => t.id === id); if (!t) return;
  show('BLOCKER / ' + t.id, `<h1>${escape(t.title)}</h1><p>${escape(t.blocker || 'No blocker reason recorded.')}</p>${t.needs ? `<p><strong>Needs:</strong> ${escape(t.needs)}</p>` : ''}<p class="sub">Owner: ${escape(blockerOwner(t))} · Waiting on: ${escape(t.waitingOn || 'unspecified')}</p>${t.replyAllowed ? `<form id="blocker-reply" data-task-id="${escape(t.id)}"><label for="reply-text">Decision or help for the owner</label><textarea id="reply-text" required maxlength="2000" rows="4" placeholder="What changed, what to try, or which decision to follow…"></textarea><p class="source-note">Posts to the shared messageboard as dashboard-user. The owner must verify and update the task; posting does not unblock it.</p><button type="submit">Post reply to messageboard</button><p id="reply-status" role="status"></p></form>` : '<p class="notice">Add an explicit id: to this task in TODOS.md before posting a reply.</p>'}${section('Recent replies')}<div class="panel">${feedRows(t.replies || [])}</div><details class="blocker-source"><summary>Task source</summary><pre>${escape(t.body)}</pre></details>`);
}
function overview() {
  const tasks = sortedTasks(state.tasks.filter(t => !['done', 'deferred', 'unknown'].includes(t.status) && matches(t)));
  return title('Operations console', 'Track the work. Inspect the evidence. Keep the agents in view.') +
    statusSummary()+
    `<div class="stats">${['active','ready','blocked','review'].map(status=>`<a class="stat" href="#tasks"><div class="sub">${escape(taskState(status)[1])}</div><div class="value task-label-${status}">${state.tasks.filter(t=>t.status===status).length}</div><div class="sub">From the task ledger</div></a>`).join('')}</div>` +
    (state.tasks.some(t => t.status === 'blocked') ? section('Needs attention', 'blockers') + `<div class="blocker-list">${blockerRows(state.tasks.filter(t => t.status === 'blocked' && matches(t)).slice(0, 4))}</div>` : '') +
    section('Current agents', 'agents') + `<div class="agent-list">${currentAgents().filter(matches).slice(0, 4).map(agentCard).join('') || empty('No current project session logs found. Open Agents for history.')}</div>` +
    section('Current work and next steps', 'tasks') + `<div class="panel">${taskRows(tasks.slice(0, 6))}</div>` +
    section('Latest visuals', 'corpus') + visualCards(state.runs.filter(matches).filter((r, i, runs) => r.visuals?.length && !runs.slice(0, i).some(other => other.candidateId === r.candidateId && other.visuals?.length))) + notice();
}
function tasksView() {
  const tasks = state.tasks.filter(t => matches(t) && (filter === 'all' || t.status === filter));
  const counts = taskStates.slice(0,4).map(([s,label]) => `<button class="queue-count task-label-${s}" data-task-filter="${s}" aria-pressed="${filter === s}"><strong>${state.tasks.filter(t => t.status === s && matches(t)).length}</strong><span>${label}</span></button>`).join('');
  const groups = taskStates.map(([s,label,hint,symbol]) => {
    const items = tasks.filter(t => t.status === s);
    if (!items.length) return '';
    const open = filter !== 'all' || query || (expandedTaskGroups.get(s) ?? ['active','ready','review','blocked'].includes(s));
    return `<details class="task-group task-group-${s}" data-task-group="${s}" ${open ? 'open' : ''}><summary><span class="task-label task-label-${s}">${symbol} ${label}</span><span class="group-count">${items.length}</span><span class="group-hint">${hint}</span></summary><div class="panel">${taskRows(items)}</div></details>`;
  }).join('');
  return title('Task queue', 'Running first, then the next assignments. Status comes from the task ledger, not process activity.', '<div class="task-controls"><button id="todo-source">Read source</button><button id="new-task" class="primary-action">+ New task</button></div>') +coordinatorBar()+
    `<div class="queue-counts">${counts}</div><details class="queue-briefing" ${queueBriefingOpen?'open':''}><summary>Project TLDR</summary>${statusSummary(true)}</details><p id="task-queue-status" role="status"></p><div class="toolbar"><select id="filter" aria-label="Task status"><option value="all" ${filter === 'all' ? 'selected' : ''}>All statuses</option>${taskStates.map(([s,label]) => `<option value="${s}" ${s === filter ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="sub">${tasks.length} items · source order; full criteria in Details</span></div>${groups || empty('No tasks match this view.')}`;
}
function candidateWork(c) {
  const order = ['active','review','blocked','ready'];
  return state.tasks.filter(t => c.taskIds.includes(t.id) && order.includes(t.status)).sort((a,b) => order.indexOf(a.status)-order.indexOf(b.status) || a.line-b.line)[0];
}
function candidateCapture(c) {
  const matching=state.runs.filter(r=>r.candidateId===c.id || c.appIds?.includes(r.candidateId));
  const gameplayRun=matching.find(r=>r.gameplayScreenshots?.length);
  const run=gameplayRun || (c.latestRun?.screenshots.length?c.latestRun:matching.find(r=>r.screenshots.length));
  return {run,shot:gameplayRun?run.gameplayScreenshots.at(-1):run?.screenshots.at(-1),gameplay:!!gameplayRun,older:!!run && run.key!==c.latestRun?.key};
}
function corpusAssessment(c,details=false) {
  const a=c.assessment;if(!a)return '';
  const color=a.needsReview?'warn':a.status==='Needs repair'?'bad':['Strong next candidate','Strong local candidate'].includes(a.status)?'good':'';
  return `<div class="corpus-assessment">${badge(a.needsReview?'New evidence · review needed':a.status,color)}${details?`<p>${escape(a.summary)}</p><p class="sub">${escape(a.origin)} · ${escape(a.distribution)}</p><p class="sub">${escape(a.licenseNote)}</p><p><strong>Next:</strong> ${escape(a.next)}</p><p class="sub">Evidence reviewed ${escape(when(a.reviewedAt))}; no fresh run implied.${a.appIds.length?' Registered apps: '+escape(a.appIds.join(', ')):''}</p>${a.registeredExecutablePresent && c.fixtureStatus!=='present'?'<p class="sub">A registered executable exists even though the original candidate fixture is incomplete. Assets and runtime still need verification.</p>':''}`:''}</div>`;
}
function corpusFps(c,details=false) {
  const gameCategory = c.category && !['tools','graphics-demos','unclassified','collections'].includes(c.category.id);
  if(!c.performance && !gameCategory && !/game/i.test(c.kind) && !['Shareware / demos','Retail / archived games','Freeware / community'].includes(c.assessment?.origin))return '';
  const p=c.performance;if(!p)return '<p class="sub corpus-fps">FPS — no linked measurement</p>';
  const flipEvents=p.counterKind==='guest-flip-events',logical=p.metric==='guest-logical-frame-submissions',rateLabel=logical?'logical gameplay frames/s':flipEvents?'guest Flip events/s':'guest presentation events/s',intervalLabel=logical?'p95 submission interval':flipEvents?'p95 Flip interval':'p95 presentation interval';
  return `<div class="corpus-fps"><strong>${p.fps.toFixed(1)} ${rateLabel}</strong> <span class="sub">${p.historical?'Historical · ':''}${escape(p.renderer)} · ${age(p.measuredAt)} ago</span>${details?`<p>${escape(p.scene)} · ${escape(p.host)}</p><p class="sub">${escape(p.notes)} Measured ${escape(when(p.measuredAt))}.</p><div class="process-table"><table><tr><th>Sample</th><th>${rateLabel}</th><th>Duration</th><th>${intervalLabel}</th></tr>${p.samples.map((s,i)=>`<tr><td>${i+1}</td><td>${s.fps.toFixed(1)}</td><td>${(s.durationMs/1000).toFixed(1)}s</td><td>${s.p95FrameMs===null?'—':s.p95FrameMs.toFixed(1)+'ms'}</td></tr>`).join('')}</table></div><button data-run="${escape(p.runKey)}">Measurement source →</button>`:''}</div>`;
}
const releaseStates = [['ready','Ready for release','good'],['review-needed','Release review needed','warn'],['blocked','Release blocked','bad'],['unknown','Release readiness unknown',''],['already-production','Already in production','']];
function releaseState(c) { return releaseStates.find(([id])=>id===c.releaseReadiness?.status) || releaseStates[3]; }
function matchesRelease(c,selection=corpusRelease) {
  if(selection==='all')return true;
  const r=c.releaseReadiness;
  if(r?.scope!=='game')return false;
  if(selection==='gameplay-reviewed')return r.productionMembership==='no' && ['gameplay-reviewed','evidence-complete'].includes(r.prospect);
  return selection==='unreleased' ? r.productionMembership==='no' : releaseState(c)[0]===selection;
}
function corpusReleaseReview(c,details=false) {
  const r=c.releaseReadiness;
  if(r?.scope==='non-game')return details?'<p class="sub">Release review scope: non-game.</p>':'';
  const [,label,color]=releaseState(c),membership=({yes:'In production',no:'Not in production',unknown:'Production membership unknown'})[r?.productionMembership] || 'Production membership unknown';
  const heading=`<div class="release-heading">${badge(label,color)}<span class="sub">${escape(membership)}</span></div>`;
  if(!details)return `<div class="corpus-release">${heading}${r?.summary?`<p class="sub release-summary">${escape(r.summary)}</p>`:''}</div>`;
  const gates=Object.entries(r?.gates||{}),blockers=r?.blockers||[];
  const performanceStatus=({'recorded-review-needs-release-qualification':'Recorded measurement; release qualification still needed','not-measured':'No measurement recorded'})[r?.performance?.status] || 'Review status unknown';
  const performanceMetric=({'guest-logical-frame-submissions':'Logical gameplay frame submissions','guest-flip-events':'Guest Flip events','guest-presentation-events':'Guest presentation events'})[r?.performance?.metric];
  return `<section class="corpus-release release-detail"><h2>Release readiness</h2>${heading}<p>${escape(r?.summary || 'No release review recorded.')}</p>${r?.next?`<p><strong>Next:</strong> ${escape(r.next)}</p>`:''}${blockers.length?`<h3>Release blockers</h3><ul>${blockers.map(b=>`<li>${escape(b.summary)}${b.source?`<div class="sub">${escape(b.source)}</div>`:''}</li>`).join('')}</ul>`:''}${gates.length?`<div class="release-gates">${gates.map(([name,g])=>`<div><strong>${escape(name)}</strong>${badge(String(g.status || 'unknown').replaceAll('-',' '),g.status==='blocked'?'bad':g.status==='passed'?'good':'')}<p>${escape(g.summary)}</p>${g.source?`<p class="sub">${escape(g.source)}</p>`:''}</div>`).join('')}</div>`:''}${r?.reviewedGameplay?.runKey?`<button data-run="${escape(r.reviewedGameplay.runKey)}">Reviewed gameplay evidence →</button>`:''}${r?.performance?`<p class="sub">Performance review: ${escape(performanceStatus)}${performanceMetric?' · '+escape(performanceMetric):''}</p>`:''}<p class="sub">Release review: ${escape(when(r?.reviewedAt))}. Gameplay screenshots and successful runs alone do not establish release readiness.</p></section>`;
}
function corpusReleaseBar() {
  const games=state.candidates.filter(c=>c.releaseReadiness?.scope==='game'),production=state.releaseReadiness?.production;
  const choices=[['ready','Ready for release'],['unreleased','Unreleased games'],['gameplay-reviewed','Unreleased · gameplay reviewed'],['blocked','Blocked']];
  return `<section class="release-bar" aria-label="Game release readiness"><div><strong>Game release readiness</strong><span class="sub">All ${games.length} game entries</span></div><div class="release-counts">${choices.map(([id,label])=>`<button data-release-filter="${id}" aria-pressed="${corpusRelease===id}"><strong>${games.filter(c=>matchesRelease(c,id)).length}</strong> ${label}</button>`).join('')}</div><p class="sub">${production?.status==='verified'?`Production snapshot checked ${escape(when(production.checkedAt))}.`:'Production membership is unverified; unknown entries are not counted as unreleased.'} ${games.filter(c=>c.releaseReadiness.productionMembership==='unknown').length} with unknown production membership.${production?.source?` Source: ${escape(production.source)}.`:''}</p></section>`;
}
function corpusLaunchActions(c,details=false) {
  const launch=c.launch, routes=launch?.routes || [], production=launch?.productionRoutes || [];
  const safeUrl=value=>typeof value==='string' && (/^\/[^/\\]/.test(value) || /^https?:\/\//i.test(value)) && !/[\u0000-\u0020\\]/.test(value);
  const actions=routes.map(route=> {
    const label=routes.length>1 ? 'Launch in emulator · '+(route.label || route.appId) : 'Launch in emulator';
    if(route.available===true && safeUrl(route.url))return `<a class="emulator-launch" href="${escape(route.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(label+' — '+(c.name || c.id))}">${escape(label)} ↗</a>`;
    return `<div class="launch-unavailable"><span>${routes.length>1?escape(route.label || route.appId)+': ':''}Launch unavailable</span><p class="sub">${escape(route.reason || 'No verified local launch route.')}</p>${details && route.missingPaths?.length?`<details><summary>Missing files (${route.missingPaths.length})</summary><pre>${escape(route.missingPaths.join('\n'))}</pre></details>`:''}</div>`;
  }).join('');
  const publicLinks=production.filter(route=>safeUrl(route.url)).map(route=>`<a class="production-launch" href="${escape(route.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape('Open production — '+(route.label || c.name || route.appId))}">Open production${production.length>1?' · '+escape(route.label || route.appId):''} ↗</a>`).join('');
  return `<div class="corpus-launch${details?' launch-detail':''}" aria-label="Launch options">${actions || `<p class="sub">Launch unavailable: ${escape(launch?.reason || 'No verified local launch route.')}</p>`}${publicLinks}${details?'<p class="sub">Opens in a new tab. Launch availability does not establish gameplay compatibility or release readiness.</p>':''}</div>`;
}
function launchableCandidate(c) { return c.launch?.routes?.some(route=>route.available===true) === true; }
function corpusLaunchBar() {
  const count=state.candidates.filter(launchableCandidate).length;
  return `<div class="launch-availability" aria-label="Emulator launch availability"><button data-launch-filter="available" aria-pressed="${corpusLaunch==='available'}"><strong>${count}</strong> Launchable now</button><span class="sub">${state.candidates.length-count} without an available local route. Launch availability is separate from gameplay verification.</span>${corpusLaunch==='available'?'<button data-launch-filter="all">Show all launch states</button>':''}</div>`;
}
function corpusView() {
  const workRank = c => ({active:0,review:1,blocked:2,ready:3})[candidateWork(c)?.status] ?? 4;
  const resultRank = c => ({failed:0,'harness-error':0,timeout:0,running:1,unknown:2,passed:3})[c.latestRun?.outcome] ?? 4;
  const categories = [...new Map(state.candidates.map(c => [c.category?.id || 'unclassified', c.category || {id:'unclassified',label:'Unclassified'}])).values()].sort((a,b) => Number(a.id==='unclassified')-Number(b.id==='unclassified') || a.label.localeCompare(b.label));
  const candidates = state.candidates.filter(c => matches(c) && matchesRelease(c) && (corpusLaunch==='all' || launchableCandidate(c)) && (corpusCategory==='all' || (c.category?.id || 'unclassified')===corpusCategory) && (corpusGroup==='all' || c.sourceGroup===corpusGroup) && (filter === 'all' || filter === 'working' && candidateWork(c)?.status === 'active' || filter === 'no-run' && !c.latestRun || filter === 'with-shot' && candidateCapture(c).shot || filter === 'no-shot' && !candidateCapture(c).shot || c.latestRun?.outcome === filter))
    .sort((a,b) => (corpusRelease==='all'?0:(a.releaseReadiness?.rank??999)-(b.releaseReadiness?.rank??999)) || workRank(a)-workRank(b) || resultRank(a)-resultRank(b) || (a.name || a.id).localeCompare(b.name || b.id));
  return title('EXE corpus', 'Browse by category, release readiness and recorded evidence.') + corpusLaunchBar() + corpusReleaseBar() +
    `<div class="coverage-bar"><strong>${state.candidates.filter(c=>candidateCapture(c).shot).length} / ${state.candidates.length} with linked screenshots</strong><span>Historical images do not establish current compatibility.</span><button data-corpus-filter="with-shot">With screenshots</button><button data-corpus-filter="no-shot">Missing screenshots</button></div>`+
    `<div class="toolbar"><select id="corpus-launch" aria-label="Launch availability"><option value="all" ${corpusLaunch==='all'?'selected':''}>All launch states</option><option value="available" ${corpusLaunch==='available'?'selected':''}>Launchable now</option></select><select id="corpus-release" aria-label="Release readiness">${[['all','All release states'],['unreleased','Unreleased games'],['gameplay-reviewed','Unreleased · gameplay reviewed'],...releaseStates.map(([id,label])=>[id,label])].map(([id,label])=>`<option value="${id}" ${corpusRelease===id?'selected':''}>${escape(label)}</option>`).join('')}</select><select id="corpus-category" aria-label="Category"><option value="all">All categories</option>${categories.map(g=>`<option value="${escape(g.id)}" ${corpusCategory===g.id?'selected':''}>${escape(g.label)} (${state.candidates.filter(c=>(c.category?.id || 'unclassified')===g.id).length})</option>`).join('')}</select><select id="corpus-group" aria-label="Source group"><option value="all">All source groups</option>${[...new Set(state.candidates.map(c=>c.sourceGroup).filter(Boolean))].sort().map(g=>`<option ${corpusGroup===g?'selected':''} value="${escape(g)}">${escape(g)}</option>`).join('')}</select><select id="filter" aria-label="Corpus status">${[['all', 'All candidates'], ['working', 'In progress'], ['with-shot', 'With screenshots'], ['no-run', 'No recorded run'], ['no-shot', 'Missing screenshots'], ['passed', 'Latest run passed'], ['failed', 'Latest run failed'], ['harness-error', 'Harness error']].map(([s, label]) => `<option value="${s}" ${s === filter ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="sub">${candidates.length} candidates · ${state.candidates.filter(c => candidateWork(c)?.status === 'active').length} in progress</span></div><p class="sub">Includes manifest and registered apps. Unclassified entries need category review. Source group does not imply redistribution permission.</p>${categories.map(category => {
      const members = candidates.filter(c => (c.category?.id || 'unclassified') === category.id);
      if (!members.length) return '';
      return `<section class="corpus-category" data-category="${escape(category.id)}"><h2>${escape(category.label)} <span class="sub">(${members.length})</span></h2><div class="corpus-grid">${members.map(c => {
      const {shot,run:captureRun,older,gameplay} = candidateCapture(c);
      const work = candidateWork(c);
      return `<div class="candidate-shell"><button class="candidate ${shot?'':'candidate-no-capture'} ${work?.status === 'active' ? 'candidate-working' : ''}" data-candidate="${escape(c.id)}">${work ? `<div class="candidate-work">${badge(work.status === 'active' ? '▶ In progress' : taskState(work.status)[1], 'task-label task-label-' + work.status)}<span>${escape(work.title)}</span></div>` : ''}<div class="thumbnail">${shot ? `<img src="${escape(shot.url)}" alt="${older?'Earlier':'Latest'} capture for ${escape(c.name)}: ${escape(shot.name)}" loading="lazy">` : 'NO LINKED CAPTURE'}</div><div class="candidate-info">${corpusReleaseReview(c)}${corpusAssessment(c)}<div class="sub">${escape(c.sourceGroup || 'Source unclassified')}${c.localOnly?' · Local only':''}</div><h3>${escape(c.name || c.id)}</h3><div class="sub">${escape(c.version || c.id)}</div>${gameplay?badge('Reviewed gameplay scene','good'):''}${corpusFps(c)}<div class="candidate-bottom">${badge(c.latestRun ? 'Latest run: '+c.latestRun.outcome : 'No recorded run', ['failed','harness-error'].includes(c.latestRun?.outcome)?'bad':'')}<span class="sub">${c.taskIds.length} linked tasks</span></div>${c.latestRun?.route?`<div class="sub candidate-route" title="${escape(c.latestRun.route)}">${escape(c.latestRun.route)}</div>`:''}<div class="sub">Fixture ${escape(c.fixtureStatus)} · ${shot ? (older?'Earlier capture · '+when(captureRun.startedAt):captureRun.verification + ' capture') : 'screenshot missing'}</div></div></button>${corpusLaunchActions(c)}</div>`;
    }).join('')}</div></section>`;
    }).join('') || empty('No matching candidates.')}`;
}
let desktopSelection='all';
function desktopRowHtml(row) {
  const c=state.candidates.find(x=>x.id===row.id),[,label,color]=releaseState(c);
  const gateMark=g=>g.met?'✓':g.status==='blocked'?'✕':'?';
  const unmet=row.gates.filter(g=>!g.met);
  const rate=row.rate.known?`<strong>${escape(row.rate.text)}</strong> <span class="sub">${row.rate.reviewed?'reviewed run':'unreviewed run'}${row.rate.historical?' · historical':''} · ${escape(row.rate.qualification)}${row.rate.measuredAt?' · '+age(row.rate.measuredAt)+' ago':''}${row.rate.scene?' · '+escape(row.rate.scene):''}</span>`:`<strong>${escape(row.rate.text)}</strong>`;
  const shot=row.screenshot?`<button class="desktop-shot" data-run="${escape(row.screenshot.runKey)}" aria-label="Open reviewed gameplay evidence for ${escape(row.name)}"><img src="${escape(row.screenshot.url)}" alt="Reviewed gameplay: ${escape(row.name)} · ${escape(row.screenshot.name)}" loading="lazy"></button>`:'<div class="desktop-shot desktop-shot-missing">No reviewed gameplay screenshot</div>';
  return `<article class="desktop-row panel" data-desktop-row="${escape(row.id)}">${shot}<div class="desktop-body"><div class="desktop-head"><h3>${escape(row.name)}</h3>${badge(label,color)}<span class="desktop-gates" aria-label="Release gates">${row.gates.map(g=>`<span class="gate gate-${g.met?'met':g.status==='blocked'?'blocked':'unknown'}" title="${escape(g.name+': '+g.status+' — '+g.detail)}">${gateMark(g)} ${escape(g.name)}</span>`).join('')}</span></div>`+
    `<p class="desktop-line">${rate}</p><p class="desktop-line sub">${escape(row.input.text)} · ${escape(row.sound.text)}${row.gameplayRun?` · Gameplay run ${escape(row.gameplayRun.build.text)}`:''}</p>`+
    `${row.staleReasons.length?`<p class="desktop-line notice-line">Review not current: ${escape(row.staleReasons.join(' '))}</p>`:''}`+
    `<ul class="desktop-blockers">${row.blockers.map(b=>`<li class="blocker-item"><strong>Blocker:</strong> ${escape(b.summary)}${b.source?` <span class="sub">${escape(b.source)}</span>`:''}</li>`).join('')}${unmet.map(g=>`<li><strong>${escape(g.name)}</strong> ${escape(g.status.replaceAll('-',' '))}: ${escape(g.detail)}${g.source?` <span class="sub">${escape(g.source)}</span>`:''}</li>`).join('')}</ul>`+
    `${row.next?`<p class="desktop-line"><strong>Next:</strong> ${escape(row.next)}</p>`:''}<div class="desktop-actions">${corpusLaunchActions(c)}<button data-candidate="${escape(row.id)}">Details →</button></div></div></article>`;
}
function desktopView() {
  const q=ReleaseModel.desktopQueue(state,desktopSelection),rows=q.rows.filter(r=>matches(state.candidates.find(c=>c.id===r.id)));
  const choices=[['all','All unreleased'],['gameplay','Reviewed gameplay'],['unblocked','No recorded blockers'],['ready','Ready']];
  return title('Ready for desktop',`${q.unreleased} unreleased games · ${q.withGameplay} with reviewed gameplay · ${q.ready} ready. Sorted by fewest blockers and unmet gates.`)+
    `<div class="toolbar"><select id="desktop-selection" aria-label="Desktop readiness filter">${choices.map(([id,l])=>`<option value="${id}" ${desktopSelection===id?'selected':''}>${l}</option>`).join('')}</select><span class="sub">${rows.length} shown · ${q.production.status==='verified'?'production snapshot checked '+escape(when(q.production.checkedAt)):'production membership unverified'} · ${q.unknownMembership} games with unknown membership are not listed</span></div>`+
    `<p class="source-note">From recorded release reviews, runs and launch routes only. Rates use their recorded metric label; nothing is inferred from block or present counts. ✓ passed · ✕ blocked · ? not reviewed. This view does not publish or deploy.</p>`+
    `<div class="desktop-list">${rows.map(desktopRowHtml).join('') || empty('No unreleased games match this filter.')}</div>`;
}
document.addEventListener('change',event=>{if(event.target.id==='desktop-selection'){desktopSelection=event.target.value;render();}});
function currentAgents() {
  const owners=new Set(state.tasks.filter(t=>['active','ready','blocked','review'].includes(t.status)).map(t=>t.owner));
  return state.agents.filter(a=>a.id===coordinator()?.agentId || owners.has(a.id) || a.provider!=='claude' && a.state!=='idle' && Date.now()-Date.parse(a.lastActivityAt)<15*60000).sort((a,b)=>agentSignal(a).rank-agentSignal(b).rank || Number(b.id===coordinator()?.agentId)-Number(a.id===coordinator()?.agentId));
}
function agentsView() {
  const current=currentAgents(),ids=new Set(current.map(a=>a.id)),history=state.agents.filter(a=>!ids.has(a.id) && matches(a));
  return title('Agents', 'Decisions and sessions needing a check first. Recent activity is not proof of task progress.') + `<div class="agent-list">${current.filter(matches).map(agentCard).join('') || empty('No current sessions observed.')}</div><details class="agent-history" ${agentHistoryOpen || query?'open':''}><summary>Other observed sessions (${history.length})</summary><div class="agent-list">${history.map(agentCard).join('')}</div></details>` + notice();
}
function activityView() {
  const rows=matchingActivity();
  return title('Activity', 'Recent Git commits and messageboard entries. Undated messages retain their board order.')+`${state.activityWarning?`<p class="notice" role="status">${escape(state.activityWarning)}</p>`:''}<div class="toolbar"><select id="activity-filter" aria-label="Activity type">${[['all','All activity'],['commit','Commits'],['message','Messages']].map(([id,label])=>`<option value="${id}" ${activityFilter===id?'selected':''}>${label}</option>`).join('')}</select><span class="sub">Showing ${Math.min(activityLimit,rows.length)} of ${rows.length} matching entries</span></div><div class="panel">${rows.length?feedRows(rows.slice(0,activityLimit)):empty(query?'No activity matches this search and filter.':activityFilter==='commit'?'No commits available.':activityFilter==='message'?'No messages available.':'No activity available.')}</div>${rows.length>activityLimit?'<div class="form-actions"><button data-more-activity="25">Show 25 more</button><button data-more-activity="all">Show all matching entries</button></div>':''}`;
}
function matchingActivity() { return (state.activity || []).filter(row=>matches(row) && (activityFilter==='all' || (row.type==='commit'?'commit':'message')===activityFilter)); }
function render() {
  if (!state) return;
  renderApprovals();
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('#task-count').textContent = state.tasks.filter(t=>!['done','deferred','unknown'].includes(t.status)).length; $('#task-count').title='Open tasks; completed, deferred and historical records excluded'; $('#corpus-count').textContent = state.candidates.length;
  $('#blocker-count').textContent = state.tasks.filter(t => t.status === 'blocked').length || '';
  $('#main').innerHTML = ({ overview, tasks: tasksView, blockers: blockersView, corpus: corpusView, release: desktopView, agents: agentsView, activity: activityView }[view] || overview)();
  $('#updated').textContent = `Snapshot ${new Date(state.generatedAt).toLocaleTimeString()} · refresh every 5s`;
}
function show(label, html) { currentTaskId=null;$('#detail-label').textContent = label; $('#detail-body').innerHTML = html; if (!$('#detail').open) $('#detail').showModal(); }
function runRows(runs) { return runs.map(r => `<div class="run"><div class="run-head"><button data-run="${escape(r.key)}">${escape(r.id)} · ${escape(r.route || 'route unspecified')}</button>${badge(r.outcome, tone(r.outcome))}</div><div class="sub">${escape(when(r.startedAt))} · ${escape(r.verification)} · ${escape(r.source)}</div></div>`).join('') || empty('No run folders recorded yet. See ops/README.md.'); }
function candidateDetail(id) {
  const c = state.candidates.find(c => c.id === id); if (!c) return;
  const {shot,run:captureRun,older,gameplay} = candidateCapture(c);
  show('EXE CORPUS / ' + c.id, `<h1>${escape(c.name)}</h1><p class="sub">${escape(c.version)} · Fixture ${escape(c.fixtureStatus)}${c.localOnly ? ' · Local only' : ''}</p>${badge(c.category?.label || 'Unclassified')}<p class="sub">${escape(c.category?.basis)}</p>${corpusLaunchActions(c,true)}${corpusReleaseReview(c,true)}${corpusAssessment(c,true)}${gameplay?badge('Reviewed gameplay scene','good'):''}${corpusFps(c,true)}<div class="detail-grid"><div>${shot ? `<img class="detail-shot" src="${escape(shot.url)}" alt="${older?'Earlier run':'Latest run'} capture"><p class="sub">${older?'Earlier capture; latest attempt: '+escape(c.latestRun?.outcome || 'unknown'):'Latest attempt'} · ${escape(captureRun.verification)} · ${escape(when(captureRun.startedAt))}</p>` : empty('No screenshot for the latest attempt.')}<p class="sub">Last reviewed success: ${c.lastVerifiedRun ? escape(c.lastVerifiedRun.id + ' · ' + c.lastVerifiedRun.route) : 'none recorded'}</p></div><div><h3>Linked TODOs</h3><div class="panel">${taskRows(state.tasks.filter(t => c.taskIds.includes(t.id)))}</div><div class="links">${c.noteLinks.map(n => link(n.url, 'Investigation notes')).join('')}${c.sourcePage ? link(c.sourcePage, 'Source page') : ''}</div></div></div><p>${escape(c.notes)}</p><pre>${escape(c.executables.join('\n'))}</pre>${section('Run history')}<div class="panel">${runRows(state.runs.filter(r => r.candidateId === id || c.appIds?.includes(r.candidateId)))}</div>`);
}
function agentDetail(id) {
  const a = state.agents.find(a => a.id === id); if (!a) return;
  const fields = [['Session', a.id], ['Model', a.model || 'unknown'], ['Worktree', a.cwd], ['Assigned task', a.taskId || 'unknown — no explicit owner match'], ['On task', age(a.taskStartedAt)], ['Current turn started', when(a.turnStartedAt)], ['Latest activity', when(a.lastActivityAt)], ['Last progress', when(a.progressAt)], ['Observed state', a.state], ['Process health', 'unknown — no process attachment'], ['Last operation', a.lastEvent], ['Last-request input', num(a.inputTokens)], ['Last-request output', num(a.outputTokens)], ['Cache read', num(a.cacheReadTokens)], ['Cache write', num(a.cacheWriteTokens)], ['Reported context limit', num(a.contextLimit)], ['Session total tokens', num(a.totalTokens)], ['Usage observed', when(a.usageAt)], ['Compactions observed', a.compactions + (a.partial ? ' in sampled log windows' : '')], ['Log coverage', a.partial ? 'head + tail only; history may be incomplete' : 'complete file']];
  fields.find(f => f[0] === 'Process health')[1] = 'unknown — PID presence does not establish responsiveness';
  fields.push(['Context estimate', num(a.contextEstimate)], ['Cache reuse', a.cachePercent === null ? 'unknown' : Math.round(a.cachePercent) + '%']);
  show('AGENT / ' + a.provider.toUpperCase(), `<h1>${escape(a.taskTitle || a.title)}</h1>${processDetails(a.process)}${visualCards(agentRuns(a))}<dl>${fields.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl><p class="source-note">Input tokens estimate the last request’s context, not current live occupancy. Cache reuse is cache-read / total request input. A quiet session may be waiting, stopped, or running a long tool; it is not automatically stuck.</p>`);
}
let activeRefresh=null;
function refresh() {
  if(activeRefresh)return activeRefresh;
  activeRefresh=fetchState().finally(()=>{activeRefresh=null;});return activeRefresh;
}
async function refreshAfterWrite(){if(activeRefresh)await activeRefresh;await refresh();}
async function fetchState() {
  try {
    const response = await fetch('/api/state'); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state = await response.json(); $('#connection').textContent = '● Connected'; $('#connection').classList.remove('error'); render();refreshTaskDetail();
  } catch (e) {
    $('#connection').textContent = '● Disconnected'; $('#connection').classList.add('error');
    if (!state) $('#main').innerHTML = empty(`Could not read project data: ${e.message}. Start node ops/server.js.`);
  }
}
document.addEventListener('change',event=>{if(event.target.id==='activity-filter'){activityFilter=event.target.value;activityLimit=25;render();}});
document.addEventListener('change',event=>{if(event.target.id==='corpus-group'){corpusGroup=event.target.value;render();}});
document.addEventListener('change',event=>{if(event.target.id==='corpus-launch'){corpusLaunch=event.target.value;render();}});
document.addEventListener('change',event=>{if(event.target.id==='corpus-release'){corpusRelease=event.target.value;render();}});
document.addEventListener('change',event=>{if(event.target.id==='corpus-category'){corpusCategory=event.target.value;render();}});
document.addEventListener('click', event => {
  const el = event.target.closest('button'); if (!el || !state) return;
  if(el.dataset.launchFilter){corpusLaunch=el.dataset.launchFilter;render();}
  if(el.dataset.releaseFilter){corpusRelease=el.dataset.releaseFilter;corpusCategory='all';corpusGroup='all';filter='all';query='';$('#search').value='';render();}
  if(el.dataset.corpusFilter){filter=el.dataset.corpusFilter;render();}
  if(el.dataset.moreActivity){activityLimit=el.dataset.moreActivity==='all'?matchingActivity().length:activityLimit+Number(el.dataset.moreActivity);render();}
  if (el.dataset.terminal) { const entry=state.terminals?.find(t=>t.id===el.dataset.terminal);if(entry?.available)window.OpsTerminal.open(entry); }
  if (el.dataset.statusSummary) show('PROJECT / TLDR',statusSummary());
  if (el.dataset.taskFilter) { filter = filter === el.dataset.taskFilter ? 'all' : el.dataset.taskFilter; render(); }
  if (el.dataset.task) taskDetail(el.dataset.task);
  if (el.dataset.candidate) candidateDetail(el.dataset.candidate);
  if (el.dataset.agent) agentDetail(el.dataset.agent);
  if (el.dataset.blocker) blockerDetail(el.dataset.blocker);
  if (el.dataset.run) { const r = state.runs.find(r => r.key === el.dataset.run); if (r) show('RUN / ' + r.id, `<h1>${escape(r.route || r.id)}</h1><p>${badge(r.outcome, tone(r.outcome))} ${escape(r.summary)}</p><dl><dt>Started</dt><dd>${escape(when(r.startedAt))}</dd><dt>Finished</dt><dd>${escape(when(r.finishedAt))}</dd><dt>Review</dt><dd>${escape(r.verification)}</dd><dt>Build</dt><dd>${escape(r.build)}</dd><dt>Environment</dt><dd>${escape(r.environment)}</dd></dl><pre>${escape(r.command)}</pre><div class="links">${r.artifacts.map(a => link(a.url, a.name)).join('')}</div>${(r.visuals || r.screenshots).map(a => `<figure class="run-visual"><img class="detail-shot" src="${escape(a.url)}" alt="${escape(a.name)}"><figcaption class="sub">${escape(a.kind || 'screenshot')} · ${escape(a.name)}</figcaption></figure>`).join('')}`); }
  if (el.id === 'todo-source') show('TODOS.md', `<pre>${escape(state.todoText)}</pre>`);
});
$('#close-detail').onclick = () => $('#detail').close();
document.addEventListener('toggle', event => {
  if(event.target.matches?.('.agent-history') && event.target.isConnected && !query)agentHistoryOpen=event.target.open;
  if(event.target.matches?.('.queue-briefing') && event.target.isConnected)queueBriefingOpen=event.target.open;
  if (event.target.matches?.('details[data-task-group]') && !query && filter === 'all') expandedTaskGroups.set(event.target.dataset.taskGroup, event.target.open);
}, true);
document.addEventListener('submit', async event => {
  if (event.target.id !== 'blocker-reply') return;
  event.preventDefault();
  const form = event.target, button = form.querySelector('button'), status = form.querySelector('#reply-status');
  if (button.disabled) return;
  button.disabled = true; status.textContent = 'Posting…';
  try {
    const response = await fetch('/api/blocker-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({taskId: form.dataset.taskId, message: form.querySelector('textarea').value}) });
    if (!response.ok) throw new Error(await response.text());
    status.textContent = 'Posted. Awaiting owner verification; task remains blocked.';
    form.querySelector('textarea').disabled = true;
    await refresh();
  } catch (e) { status.textContent = `Could not confirm posting: ${e.message}. Check Activity before retrying.`; button.disabled = false; }
});
$('#refresh').onclick = refresh;
$('#search').addEventListener('input', e => { query = e.target.value.toLowerCase(); activityLimit=25; render(); });
document.addEventListener('change', e => { if (e.target.id === 'filter') { filter = e.target.value; render(); } });
window.addEventListener('hashchange', () => { view = location.hash.slice(1) || 'overview'; filter = 'all'; query = ''; $('#search').value = ''; render(); });
refresh();
setInterval(refresh, 5000);
