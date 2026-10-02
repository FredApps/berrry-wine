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
function agentCard(a) {
  const liveApproval=state.approvals?.items.some(p=>!p.sent && state.terminals?.some(t=>t.id===p.terminalId && t.agentId===a.id));
  const blocked=state.tasks.some(t=>t.owner===a.id && t.status==='blocked');
  const [label, color] = liveApproval?['Awaiting approval','warn']:blocked?['Task blocked','warn']:health(a);
  const latest = agentRuns(a).find(r => r.visuals?.length);
  const image = latest?.visuals.at(-1);
  const candidate = latest && state.candidates.find(c => c.id === latest.candidateId);
  const name = coordinator()?.agentId===a.id ? 'Coordinator' : a.taskTitle || (a.title && a.title !== a.id ? a.title : candidate?.name || 'Untitled session');
  const contextPercent = a.contextLimit && a.contextEstimate !== null ? Math.round(100 * a.contextEstimate / a.contextLimit) : 0;
  return `<article class="agent panel"><div class="agent-head"><span class="provider ${escape(a.provider)}">${escape(a.provider.toUpperCase())}</span>${badge(label, color)}</div><div class="agent-content"><div class="agent-copy"><button class="agent-title" data-agent="${escape(a.id)}">${escape(name)}</button><div class="agent-meta">${a.lastActivityAt ? `<span>Activity ${age(a.lastActivityAt)} ago</span>` : ''}${a.taskStartedAt ? `<span>On task ${age(a.taskStartedAt)}</span>` : ''}${a.progressAt ? `<span>Progress ${age(a.progressAt)} ago</span>` : ''}</div>${contextPercent >= 90 ? badge(`Context estimate ~${contextPercent}%`, 'warn') : ''}</div>${image ? `<button class="agent-preview" data-run="${escape(latest.key)}" aria-label="Open latest evidence for ${escape(candidate?.name || latest.candidateId)}"><img src="${escape(image.url)}" alt="${escape(candidate?.name || latest.candidateId)}" loading="lazy"><span>${age(latest.startedAt)} ago</span></button>` : ''}</div><div class="agent-footer">${processSummary(a.process, true)}${terminalLink(a)}<button class="details-button" data-agent="${escape(a.id)}">Details →</button></div></article>`;
}
function feedRows(rows, truncate = false) { return rows.map(row => `<div class="feed-row"><div class="sub">MESSAGEBOARD</div><div class="feed-text">${escape(truncate && row.text.length > 360 ? row.text.slice(0, 360) + '…' : row.text)}</div></div>`).join('') || empty('No messageboard entries.'); }
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
function blockerRows(tasks) {
  const kind=t=>/automated.*review/i.test(t.waitingOn || '')?'Review blocked':/approval/i.test(t.waitingOn || '')?'Approval reported':'Needs help';
  return tasks.map(t => `<article class="blocker panel"><div class="blocker-heading">${taskButton(t)}${badge(t.replies?.length ? 'Reply posted · still blocked' : kind(t), 'warn')}</div><p>${escape(t.blocker || 'Blocker reason not recorded.')}</p>${t.needs ? `<p class="blocker-ask">Needs: ${escape(t.needs)}</p>` : ''}${kind(t)==='Review blocked'?'<p class="source-note">Automated review stopped execution. There is no web approval for this block.</p>':kind(t)==='Approval reported'?'<p class="source-note">Task report may lag. Review any live prompt above for the actual command.</p>':''}<div class="blocker-footer"><span class="sub">${escape(t.waitingOn || t.owner || 'No owner recorded')}${t.blockedAt ? ' · blocked ' + age(t.blockedAt) : ''}</span>${terminalLink({id:t.owner})}<button data-blocker="${escape(t.id)}">Discuss →</button></div></article>`).join('') || empty('No explicitly blocked tasks recorded.');
}
function blockersView() {
  return title('Blockers', 'Decisions and help needed. Owners verify the fix before resuming.') + `<div class="blocker-list">${blockerRows(state.tasks.filter(t => t.status === 'blocked' && matches(t)))}</div>`;
}
function blockerDetail(id) {
  const t = state.tasks.find(t => t.id === id); if (!t) return;
  show('BLOCKER / ' + t.id, `<h1>${escape(t.title)}</h1><p>${escape(t.blocker || 'No blocker reason recorded.')}</p>${t.needs ? `<p><strong>Needs:</strong> ${escape(t.needs)}</p>` : ''}<p class="sub">Owner: ${escape(t.owner || 'unassigned')} · Waiting on: ${escape(t.waitingOn || 'unspecified')}</p>${t.replyAllowed ? `<form id="blocker-reply" data-task-id="${escape(t.id)}"><label for="reply-text">Decision or help for the owner</label><textarea id="reply-text" required maxlength="2000" rows="4" placeholder="What changed, what to try, or which decision to follow…"></textarea><p class="source-note">Posts to the shared messageboard as dashboard-user. The owner must verify and update the task; posting does not unblock it.</p><button type="submit">Post reply to messageboard</button><p id="reply-status" role="status"></p></form>` : '<p class="notice">Add an explicit id: to this task in TODOS.md before posting a reply.</p>'}${section('Recent replies')}<div class="panel">${feedRows(t.replies || [])}</div><details class="blocker-source"><summary>Task source</summary><pre>${escape(t.body)}</pre></details>`);
}
function overview() {
  const tasks = sortedTasks(state.tasks.filter(t => !['done', 'deferred', 'unknown'].includes(t.status) && matches(t)));
  return title('Operations console', 'Track the work. Inspect the evidence. Keep the agents in view.') +
    statusSummary()+
    `<div class="stats">${['active','ready','blocked','review'].map(status=>`<a class="stat" href="#tasks"><div class="sub">${escape(taskState(status)[1])}</div><div class="value task-label-${status}">${state.tasks.filter(t=>t.status===status).length}</div><div class="sub">From the task ledger</div></a>`).join('')}</div>` +
    (state.tasks.some(t => t.status === 'blocked') ? section('Needs attention', 'blockers') + `<div class="blocker-list">${blockerRows(state.tasks.filter(t => t.status === 'blocked' && matches(t)).slice(0, 4))}</div>` : '') +
    section('Current agents', 'agents') + `<div class="agent-list">${currentAgents().filter(matches).slice(0, 4).map(agentCard).join('') || empty('No current project session logs found. Open Agents for history.')}</div>` +
    section('Latest visuals', 'corpus') + visualCards(state.runs.filter(matches).filter((r, i, runs) => r.visuals?.length && !runs.slice(0, i).some(other => other.candidateId === r.candidateId && other.visuals?.length))) +
    `<div class="columns"><div>${section('Tasks to review', 'tasks')}<div class="panel">${taskRows(tasks.slice(0, 6))}</div></div><div>${section('Latest activity', 'activity')}<div class="panel">${feedRows(state.activity.filter(matches).slice(0, 5), true)}</div></div></div>` + notice();
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
  return title('Task queue', 'Running first, then the next assignments. Status comes from the task ledger, not process activity.', '<div class="task-controls"><button id="todo-source">Read source</button><button id="new-task" class="primary-action">+ New task</button></div>') +statusSummary(true)+coordinatorBar()+
    `<div class="queue-counts">${counts}</div><p id="task-queue-status" role="status"></p><div class="toolbar"><select id="filter" aria-label="Task status"><option value="all" ${filter === 'all' ? 'selected' : ''}>All statuses</option>${taskStates.map(([s,label]) => `<option value="${s}" ${s === filter ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="sub">${tasks.length} items · source order; arrows reorder within a section</span></div>${groups || empty('No tasks match this view.')}`;
}
function candidateWork(c) {
  const order = ['active','review','blocked','ready'];
  return state.tasks.filter(t => c.taskIds.includes(t.id) && order.includes(t.status)).sort((a,b) => order.indexOf(a.status)-order.indexOf(b.status) || a.line-b.line)[0];
}
function corpusView() {
  const workRank = c => ({active:0,review:1,blocked:2,ready:3})[candidateWork(c)?.status] ?? 4;
  const resultRank = c => ({failed:0,'harness-error':0,timeout:0,running:1,unknown:3,passed:4})[c.latestRun?.outcome] ?? 2;
  const candidates = state.candidates.filter(c => matches(c) && (filter === 'all' || filter === 'working' && candidateWork(c)?.status === 'active' || filter === 'no-run' && !c.latestRun || filter === 'no-shot' && !c.latestRun?.screenshots.length || c.latestRun?.outcome === filter))
    .sort((a,b) => workRank(a)-workRank(b) || resultRank(a)-resultRank(b) || (a.name || a.id).localeCompare(b.name || b.id));
  return title('EXE corpus', 'In progress → review → blocked → queued. Then failures, untested, unknown, and passed results.') +
    `<div class="toolbar"><select id="filter" aria-label="Corpus status">${[['all', 'All candidates'], ['working', 'In progress'], ['no-run', 'No recorded run'], ['no-shot', 'Needs screenshot'], ['passed', 'Latest run passed'], ['failed', 'Latest run failed'], ['harness-error', 'Harness error']].map(([s, label]) => `<option value="${s}" ${s === filter ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="sub">${candidates.length} candidates · ${state.candidates.filter(c => candidateWork(c)?.status === 'active').length} in progress</span></div><div class="corpus-grid">${candidates.map(c => {
      const shot = c.latestRun?.screenshots.at(-1);
      const work = candidateWork(c);
      return `<button class="candidate ${work?.status === 'active' ? 'candidate-working' : ''}" data-candidate="${escape(c.id)}">${work ? `<div class="candidate-work">${badge(work.status === 'active' ? '▶ In progress' : taskState(work.status)[1], 'task-label task-label-' + work.status)}<span>${escape(work.title)}</span></div>` : ''}<div class="thumbnail">${shot ? `<img src="${escape(shot.url)}" alt="Latest capture for ${escape(c.name)}: ${escape(shot.name)}" loading="lazy">` : 'NO CAPTURE YET'}</div><div class="candidate-info"><h3>${escape(c.name || c.id)}</h3><div class="sub">${escape(c.version || c.id)}</div><div class="candidate-bottom">${badge(c.latestRun ? 'Latest run: '+c.latestRun.outcome : 'Untested', tone(c.latestRun?.outcome))}<span class="sub">${c.taskIds.length} linked tasks</span></div>${c.latestRun?.route?`<div class="sub candidate-route" title="${escape(c.latestRun.route)}">${escape(c.latestRun.route)}</div>`:''}<div class="sub">Fixture ${escape(c.fixtureStatus)} · ${shot ? c.latestRun.verification + ' capture' : 'screenshot missing'}</div></div></button>`;
    }).join('') || empty('No matching candidates.')}</div>`;
}
function currentAgents() {
  const owners=new Set(state.tasks.filter(t=>['active','ready','blocked','review'].includes(t.status)).map(t=>t.owner));
  return state.agents.filter(a=>a.id===coordinator()?.agentId || owners.has(a.id) || a.provider!=='claude' && a.state!=='idle' && Date.now()-Date.parse(a.lastActivityAt)<15*60000).sort((a,b)=>Number(b.id===coordinator()?.agentId)-Number(a.id===coordinator()?.agentId));
}
function agentsView() {
  const current=currentAgents(),ids=new Set(current.map(a=>a.id)),history=state.agents.filter(a=>!ids.has(a.id) && matches(a));
  return title('Agents', 'Coordinator and current work first. Historical sessions and telemetry stay in details.') + `<div class="agent-list">${current.filter(matches).map(agentCard).join('') || empty('No current sessions observed.')}</div><details class="agent-history" ${agentHistoryOpen || query?'open':''}><summary>Other observed sessions (${history.length})</summary><div class="agent-list">${history.map(agentCard).join('')}</div></details>` + notice();
}
function activityView() { return title('Activity', 'Latest 150 nonempty messageboard entries, newest first.') + `<div class="panel">${feedRows(state.activity.filter(matches))}</div>`; }
function render() {
  if (!state) return;
  renderApprovals();
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('#task-count').textContent = state.tasks.filter(t=>!['done','deferred','unknown'].includes(t.status)).length; $('#task-count').title='Open tasks; completed, deferred and historical records excluded'; $('#corpus-count').textContent = state.candidates.length;
  $('#blocker-count').textContent = state.tasks.filter(t => t.status === 'blocked').length || '';
  $('#main').innerHTML = ({ overview, tasks: tasksView, blockers: blockersView, corpus: corpusView, agents: agentsView, activity: activityView }[view] || overview)();
  $('#updated').textContent = `Snapshot ${new Date(state.generatedAt).toLocaleTimeString()} · refresh every 5s`;
}
function show(label, html) { currentTaskId=null;$('#detail-label').textContent = label; $('#detail-body').innerHTML = html; if (!$('#detail').open) $('#detail').showModal(); }
function runRows(runs) { return runs.map(r => `<div class="run"><div class="run-head"><button data-run="${escape(r.key)}">${escape(r.id)} · ${escape(r.route || 'route unspecified')}</button>${badge(r.outcome, tone(r.outcome))}</div><div class="sub">${escape(when(r.startedAt))} · ${escape(r.verification)} · ${escape(r.source)}</div></div>`).join('') || empty('No run folders recorded yet. See ops/README.md.'); }
function candidateDetail(id) {
  const c = state.candidates.find(c => c.id === id); if (!c) return;
  const shot = c.latestRun?.screenshots.at(-1);
  show('EXE CORPUS / ' + c.id, `<h1>${escape(c.name)}</h1><p class="sub">${escape(c.version)} · Fixture ${escape(c.fixtureStatus)}${c.localOnly ? ' · Local only' : ''}</p><div class="detail-grid"><div>${shot ? `<img class="detail-shot" src="${escape(shot.url)}" alt="Latest run capture"><p class="sub">Latest attempt · ${escape(c.latestRun.verification)} · ${escape(when(c.latestRun.startedAt))}</p>` : empty('No screenshot for the latest attempt.')}<p class="sub">Last reviewed success: ${c.lastVerifiedRun ? escape(c.lastVerifiedRun.id + ' · ' + c.lastVerifiedRun.route) : 'none recorded'}</p></div><div><h3>Linked TODOs</h3><div class="panel">${taskRows(state.tasks.filter(t => c.taskIds.includes(t.id)))}</div><div class="links">${c.noteLinks.map(n => link(n.url, 'Investigation notes')).join('')}${c.sourcePage ? link(c.sourcePage, 'Source page') : ''}</div></div></div><p>${escape(c.notes)}</p><pre>${escape(c.executables.join('\n'))}</pre>${section('Run history')}<div class="panel">${runRows(state.runs.filter(r => r.candidateId === id))}</div>`);
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
document.addEventListener('click', event => {
  const el = event.target.closest('button'); if (!el || !state) return;
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
$('#search').addEventListener('input', e => { query = e.target.value.toLowerCase(); render(); });
document.addEventListener('change', e => { if (e.target.id === 'filter') { filter = e.target.value; render(); } });
window.addEventListener('hashchange', () => { view = location.hash.slice(1) || 'overview'; filter = 'all'; query = ''; $('#search').value = ''; render(); });
refresh();
setInterval(refresh, 5000);
