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
function taskRows(tasks) { return tasks.length ? tasks.map(t => `<div class="task"><span class="task-symbol">${t.status === 'done' ? '☑' : t.status === 'active' ? '◐' : '☐'}</span><div class="task-body">${taskButton(t)}<div class="sub">${escape(t.owner || 'Unassigned')} · TODOS.md:${t.line} · ${escape(t.kind)}</div></div>${badge(t.status, tone(t.status))}</div>`).join('') : empty('No matching tasks. Add checkboxes to TODOS.md.'); }
function health(a) {
  if (!a.lastActivityAt) return ['Unknown', ''];
  if (a.state === 'idle') return ['Turn ended', ''];
  if (Date.now() - Date.parse(a.lastActivityAt) > 15 * 60000) return ['Quiet · check session', 'warn'];
  return [a.state === 'tool' ? 'Tool activity' : 'Recent activity', 'good'];
}
function agentCard(a) {
  const [label, color] = health(a);
  const context = a.contextEstimate === null ? 'unknown' : `${num(a.contextEstimate)}${a.contextLimit ? ' / ' + num(a.contextLimit) : ' / unknown'}`;
  return `<article class="agent panel"><div class="agent-head"><span class="provider ${escape(a.provider)}">${escape(a.provider.toUpperCase())}</span><span class="sub">${escape(a.model || 'model unknown')}</span>${badge(label, color)}</div><button class="agent-title" data-agent="${escape(a.id)}">${escape(a.taskTitle || a.title)}</button><div class="agent-meta"><span>On task <b>${age(a.taskStartedAt)}</b></span><span>Activity <b>${age(a.lastActivityAt)} ago</b></span><span>Progress <b>${a.progressAt ? age(a.progressAt) + ' ago' : 'unknown'}</b></span></div><div class="metrics"><div>Context estimate <strong>${context}</strong><div class="meter"><progress aria-label="Estimated context usage" max="100" value="${a.contextLimit && a.contextEstimate !== null ? Math.min(100, 100 * a.contextEstimate / a.contextLimit) : 0}"></progress></div></div><div>Cache reuse <strong>${a.cachePercent === null ? 'unknown' : Math.round(a.cachePercent) + '%'}</strong><div class="sub">${escape(a.lastEvent)}</div></div></div></article>`;
}
function feedRows(rows, truncate = false) { return rows.map(row => `<div class="feed-row"><div class="sub">MESSAGEBOARD</div><div class="feed-text">${escape(truncate && row.text.length > 360 ? row.text.slice(0, 360) + '…' : row.text)}</div></div>`).join('') || empty('No messageboard entries.'); }
function title(name, subtitle, action = '') { return `<div class="title-row"><div><div class="eyebrow"><span class="file-dot"></span> WINE-ASSEMBLY // LOCAL OBSERVER</div><h1>${escape(name)}</h1><div class="sub">${escape(subtitle)}</div></div>${action}</div>`; }
function section(name, target) { return `<div class="section-head"><h2>${name}</h2>${target ? `<a href="#${target}">View all →</a>` : ''}</div>`; }
function notice() { return state.warnings.length ? `<div class="notice"><details><summary>${state.warnings.length} source notices</summary><ul>${state.warnings.map(w => `<li>${escape(w)}</li>`).join('')}</ul></details></div>` : ''; }
function overview() {
  const active = state.agents.filter(a => a.state !== 'idle' && a.lastActivityAt && Date.now() - Date.parse(a.lastActivityAt) < 15 * 60000);
  const tasks = state.tasks.filter(t => t.status !== 'done' && matches(t));
  return title('Operations console', 'Track the work. Inspect the evidence. Keep the agents in view.') +
    `<div class="stats"><div class="stat"><div class="sub">OPEN TASKS</div><div class="value">${state.tasks.filter(t => !['done', 'unknown'].includes(t.status)).length}</div><div class="sub">${state.tasks.filter(t => t.status === 'unknown').length} legacy sections need review</div></div><div class="stat"><div class="sub">EXE CANDIDATES</div><div class="value">${state.candidates.length}</div><div class="sub">${state.candidates.filter(c => c.latestRun).length} with recorded runs</div></div><div class="stat"><div class="sub">RECENT AGENT ACTIVITY</div><div class="value">${active.length}</div><div class="sub">Observed within 15 minutes</div></div><div class="stat"><div class="sub">RECORDED RUNS</div><div class="value">${state.runs.length}</div><div class="sub">${state.runs.filter(r => r.verification === 'reviewed').length} reviewed results</div></div></div>` +
    section('Agent activity', 'agents') + `<div class="agent-list">${state.agents.filter(matches).slice(0, 4).map(agentCard).join('') || empty('No project session logs found.')}</div>` +
    `<div class="columns"><div>${section('Tasks to review', 'tasks')}<div class="panel">${taskRows(tasks.slice(0, 6))}</div></div><div>${section('Latest activity', 'activity')}<div class="panel">${feedRows(state.activity.filter(matches).slice(0, 5), true)}</div></div></div>` + notice();
}
function tasksView() {
  const tasks = state.tasks.filter(t => matches(t) && (filter === 'all' || t.status === filter));
  return title('Tasks', 'Read from TODOS.md. Ownership is advisory.', '<button id="todo-source">Read source</button>') +
    `<div class="toolbar"><select id="filter" aria-label="Task status">${['all', 'ready', 'active', 'blocked', 'review', 'done', 'unknown'].map(s => `<option value="${s}" ${s === filter ? 'selected' : ''}>${s === 'all' ? 'All statuses' : s}</option>`).join('')}</select><span class="sub">${tasks.length} items · legacy prose is not treated as current status</span></div><div class="panel">${taskRows(tasks)}</div>`;
}
function corpusView() {
  const candidates = state.candidates.filter(c => matches(c) && (filter === 'all' || filter === 'no-run' && !c.latestRun || filter === 'no-shot' && !c.latestRun?.screenshots.length || c.latestRun?.outcome === filter));
  return title('EXE corpus', 'Each result belongs to a specific build, route, and environment.') +
    `<div class="toolbar"><select id="filter" aria-label="Corpus status">${[['all', 'All candidates'], ['no-run', 'No recorded run'], ['no-shot', 'Needs screenshot'], ['passed', 'Latest run passed'], ['failed', 'Latest run failed'], ['harness-error', 'Harness error']].map(([s, label]) => `<option value="${s}" ${s === filter ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="sub">${candidates.length} candidates</span></div><div class="corpus-grid">${candidates.map(c => {
      const shot = c.latestRun?.screenshots[0];
      return `<button class="candidate" data-candidate="${escape(c.id)}"><div class="thumbnail">${shot ? `<img src="${escape(shot.url)}" alt="Latest capture for ${escape(c.name)}" loading="lazy">` : 'NO CAPTURE YET'}</div><div class="candidate-info"><h3>${escape(c.name || c.id)}</h3><div class="sub">${escape(c.version || c.id)}</div><div class="candidate-bottom">${badge(c.latestRun ? c.latestRun.outcome : 'Untested', tone(c.latestRun?.outcome))}<span class="sub">${c.taskIds.length} linked tasks</span></div><div class="sub">Fixture ${escape(c.fixtureStatus)} · ${shot ? c.latestRun.verification + ' capture' : 'screenshot missing'}</div></div></button>`;
    }).join('') || empty('No matching candidates.')}</div>`;
}
function agentsView() { return title('Agents', 'Claude and Codex · local session observations') + `<p class="source-note">${escape(state.telemetryNote)}</p><div class="agent-list">${state.agents.filter(matches).map(agentCard).join('') || empty('No matching project sessions. See README for log directory options.')}</div>` + notice(); }
function activityView() { return title('Activity', 'Latest 150 nonempty messageboard entries, newest first.') + `<div class="panel">${feedRows(state.activity.filter(matches))}</div>`; }
function render() {
  if (!state) return;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('#task-count').textContent = state.tasks.length; $('#corpus-count').textContent = state.candidates.length;
  $('#main').innerHTML = ({ overview, tasks: tasksView, corpus: corpusView, agents: agentsView, activity: activityView }[view] || overview)();
  $('#updated').textContent = `Snapshot ${new Date(state.generatedAt).toLocaleTimeString()} · refresh every 5s`;
}
function show(label, html) { $('#detail-label').textContent = label; $('#detail-body').innerHTML = html; if (!$('#detail').open) $('#detail').showModal(); }
function runRows(runs) { return runs.map(r => `<div class="run"><div class="run-head"><button data-run="${escape(r.key)}">${escape(r.id)} · ${escape(r.route || 'route unspecified')}</button>${badge(r.outcome, tone(r.outcome))}</div><div class="sub">${escape(when(r.startedAt))} · ${escape(r.verification)} · ${escape(r.source)}</div></div>`).join('') || empty('No run folders recorded yet. See ops/README.md.'); }
function candidateDetail(id) {
  const c = state.candidates.find(c => c.id === id); if (!c) return;
  const shot = c.latestRun?.screenshots[0];
  show('EXE CORPUS / ' + c.id, `<h1>${escape(c.name)}</h1><p class="sub">${escape(c.version)} · Fixture ${escape(c.fixtureStatus)}${c.localOnly ? ' · Local only' : ''}</p><div class="detail-grid"><div>${shot ? `<img class="detail-shot" src="${escape(shot.url)}" alt="Latest run capture"><p class="sub">Latest attempt · ${escape(c.latestRun.verification)} · ${escape(when(c.latestRun.startedAt))}</p>` : empty('No screenshot for the latest attempt.')}<p class="sub">Last reviewed success: ${c.lastVerifiedRun ? escape(c.lastVerifiedRun.id + ' · ' + c.lastVerifiedRun.route) : 'none recorded'}</p></div><div><h3>Linked TODOs</h3><div class="panel">${taskRows(state.tasks.filter(t => c.taskIds.includes(t.id)))}</div><div class="links">${c.noteLinks.map(n => link(n.url, 'Investigation notes')).join('')}${c.sourcePage ? link(c.sourcePage, 'Source page') : ''}</div></div></div><p>${escape(c.notes)}</p><pre>${escape(c.executables.join('\n'))}</pre>${section('Run history')}<div class="panel">${runRows(state.runs.filter(r => r.candidateId === id))}</div>`);
}
function agentDetail(id) {
  const a = state.agents.find(a => a.id === id); if (!a) return;
  const fields = [['Session', a.id], ['Model', a.model || 'unknown'], ['Worktree', a.cwd], ['Assigned task', a.taskId || 'unknown — no explicit owner match'], ['On task', age(a.taskStartedAt)], ['Current turn started', when(a.turnStartedAt)], ['Latest activity', when(a.lastActivityAt)], ['Last progress', when(a.progressAt)], ['Observed state', a.state], ['Process health', 'unknown — no process attachment'], ['Last operation', a.lastEvent], ['Last-request input', num(a.inputTokens)], ['Last-request output', num(a.outputTokens)], ['Cache read', num(a.cacheReadTokens)], ['Cache write', num(a.cacheWriteTokens)], ['Reported context limit', num(a.contextLimit)], ['Session total tokens', num(a.totalTokens)], ['Usage observed', when(a.usageAt)], ['Compactions observed', a.compactions + (a.partial ? ' in sampled log windows' : '')], ['Log coverage', a.partial ? 'head + tail only; history may be incomplete' : 'complete file']];
  show('AGENT / ' + a.provider.toUpperCase(), `<h1>${escape(a.taskTitle || a.title)}</h1><dl>${fields.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl><p class="source-note">Input tokens estimate the last request’s context, not current live occupancy. Cache reuse is cache-read / total request input. A quiet session may be waiting, stopped, or running a long tool; it is not automatically stuck.</p>`);
}
async function refresh() {
  if (loading) return; loading = true;
  try {
    const response = await fetch('/api/state'); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state = await response.json(); $('#connection').textContent = '● Connected'; $('#connection').classList.remove('error'); render();
  } catch (e) {
    $('#connection').textContent = '● Disconnected'; $('#connection').classList.add('error');
    if (!state) $('#main').innerHTML = empty(`Could not read project data: ${e.message}. Start node ops/server.js.`);
  } finally { loading = false; }
}
document.addEventListener('click', event => {
  const el = event.target.closest('button'); if (!el || !state) return;
  if (el.dataset.task) { const t = state.tasks.find(t => t.id === el.dataset.task); if (t) show(`TODOS.md:${t.line}`, `<h1>${escape(t.title)}</h1><p>${badge(t.status, tone(t.status))}</p><pre>${escape(t.body)}</pre>${link('/source?path=TODOS.md', 'Read full source')}`); }
  if (el.dataset.candidate) candidateDetail(el.dataset.candidate);
  if (el.dataset.agent) agentDetail(el.dataset.agent);
  if (el.dataset.run) { const r = state.runs.find(r => r.key === el.dataset.run); if (r) show('RUN / ' + r.id, `<h1>${escape(r.route || r.id)}</h1><p>${badge(r.outcome, tone(r.outcome))} ${escape(r.summary)}</p><dl><dt>Started</dt><dd>${escape(when(r.startedAt))}</dd><dt>Finished</dt><dd>${escape(when(r.finishedAt))}</dd><dt>Review</dt><dd>${escape(r.verification)}</dd><dt>Build</dt><dd>${escape(r.build)}</dd><dt>Environment</dt><dd>${escape(r.environment)}</dd></dl><pre>${escape(r.command)}</pre><div class="links">${r.artifacts.map(a => link(a.url, a.name)).join('')}</div>${r.screenshots.map(a => `<img class="detail-shot" src="${escape(a.url)}" alt="${escape(a.name)}">`).join('')}`); }
  if (el.id === 'todo-source') show('TODOS.md', `<pre>${escape(state.todoText)}</pre>`);
});
$('#close-detail').onclick = () => $('#detail').close();
$('#refresh').onclick = refresh;
$('#search').addEventListener('input', e => { query = e.target.value.toLowerCase(); render(); });
document.addEventListener('change', e => { if (e.target.id === 'filter') { filter = e.target.value; render(); } });
window.addEventListener('hashchange', () => { view = location.hash.slice(1) || 'overview'; filter = 'all'; query = ''; $('#search').value = ''; render(); });
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
