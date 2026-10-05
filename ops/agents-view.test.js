'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {browserApp} = require('./test-app-vm');

const now = Date.now(), ago = minutes => new Date(now - minutes * 60000).toISOString();
function snapshot() {
  const agents = [
    {id: 'claude:parent-1863d2b5', provider: 'claude', state: 'working', lastActivityAt: ago(1), title: 'Coordinate lanes', summary: 'Reconciled five handoffs.', lastEvent: 'Bash'},
    {id: 'claude:agent-aaa111', provider: 'claude', state: 'working', lastActivityAt: ago(2), parentAgentId: 'claude:parent-1863d2b5', title: 'You are the worker for task CLAUDE-HEROES2-PERF <b>', summary: 'Assets verified; profiling the adventure map.'},
    {id: 'claude:agent-bbb222', provider: 'claude', state: 'idle', lastActivityAt: ago(300), parentAgentId: 'claude:parent-1863d2b5', title: 'Design progressive loading', summary: null, lastEvent: 'Read'},
    ...[3, 4, 5].map(n => ({id: 'claude:agent-old' + n, provider: 'claude', state: 'idle', lastActivityAt: ago(600 + n), parentAgentId: 'claude:parent-1863d2b5', title: 'Old ' + n, summary: 'done ' + n})),
    {id: 'codex:quiet', provider: 'codex', state: 'working', lastActivityAt: ago(45), title: 'Codex owner'},
    {id: 'codex:child', provider: 'codex', state: 'working', lastActivityAt: ago(1), parentAgentId: 'codex:quiet', title: 'Codex child', summary: 'x'.repeat(240)},
    {id: 'claude:history', provider: 'claude', state: 'idle', lastActivityAt: ago(5000), title: 'Finished work'},
  ];
  const tasks = [
    {id: 'T-1', title: 'Coordinate', status: 'active', owner: 'claude:parent-1863d2b5', next: 'Hand runtime slot to Hype', line: 1},
    {id: 'T-2', title: 'Codex task', status: 'active', owner: 'codex:quiet', next: 'Profile', line: 2},
  ];
  return {agents, tasks, candidates: [], runs: [], terminals: [], approvals: {items: []}, warnings: [], activity: []};
}
const rows = html => [...html.matchAll(/<article class="agent-row[\s\S]*?<\/article>/g)].map(m => m[0]);
const lines = html => (html.match(/class="agent-line[12]/g) || []).length;

test('agents render as one full-width column of two-line rows with subagents nested', () => {
  const ctx = browserApp(snapshot());
  const html = vm.runInContext('agentsView()', ctx);
  const articles = rows(html);
  assert.equal(articles.filter(a => !a.includes('Finished work')).length, 2, 'two top-level current agents; children are not separate rows');
  const parent = articles.find(a => a.includes('parent-1863d2b5'));
  // Agent + 3 visible subagents + 2 collapsed: every one is exactly line1 + line2.
  assert.equal(lines(parent), 2 * 6);
  assert.equal((parent.match(/<li class="subagent-row"/g) || []).length, 5);
  assert.match(parent, /Show 2 more subagents/);
  assert.match(parent, /Next: Hand runtime slot to Hype/);
  assert.match(parent, /CLAUDE-HEROES2-PERF/, 'subagent named by its task id, not the prompt');
  assert.ok(!parent.includes('<b>'), 'titles are escaped');
  assert.match(parent, /Latest: Assets verified; profiling the adventure map\./);
  assert.match(parent, /Last operation: Read · no result or next step recorded/);
  assert.match(parent, /Turn ended/);
  assert.ok(!/agent-preview|process-line|agent-meta/.test(parent), 'process, previews and timestamps stay in details');
  const codex = articles.find(a => a.includes('codex:quiet'));
  assert.match(codex, /Quiet · check session/, 'quiet working session is not shown as progressing');
  assert.match(codex, /No recent session activity/);
  assert.match(codex, /Codex child/);
  assert.match(html, /Other observed sessions \(1\)/, 'only the true history session is in history');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.agent-list \{\s*display:grid;\s*grid-template-columns:minmax\(0,1fr\);/);
});

test('overview shows the same rows, a current subagent pulls its parent in, and search matches children', () => {
  const s = snapshot();
  s.tasks = [];
  const ctx = browserApp(s);
  const html = vm.runInContext('overview()', ctx);
  assert.ok(rows(html).some(a => a.includes('codex:quiet') && a.includes('Codex child')), 'non-claude active child keeps its parent row');
  vm.runInContext("query='heroes2'", ctx);
  const searched = vm.runInContext('agentsView()', ctx);
  assert.ok(rows(searched).some(a => a.includes('parent-1863d2b5')), 'a matching subagent keeps its parent visible');
});

test('activity and task rows show committed/pushed/merged/tested state and never claim a deploy', () => {
  const merged = {type:'commit', hash:'a'.repeat(40), shortHash:'aaaaaaaa', subject:'Merged <x>', time:'2026-10-05T00:00:00Z', url:'https://github.com/o/r/commit/' + 'a'.repeat(40), code:{state:'merged', branches:[]}, runs:[{key:'k', outcome:'passed', verification:'reviewed'}], taskIds:['T-1']};
  const local = {type:'commit', hash:'b'.repeat(40), shortHash:'bbbbbbbb', subject:'Local', time:'2026-10-05T00:01:00Z', code:{state:'local', branches:[]}, runs:[], taskIds:[]};
  const pushed = {...local, hash:'c'.repeat(40), subject:'Pushed', code:{state:'pushed', branches:['origin/feature']}};
  const s = {...snapshot(), activity:[merged, local, pushed], codeState:{available:true, mainRef:'origin/main', fetchedAt:'2026-10-05T00:02:00Z', note:'From local remote-tracking refs as of the last fetch.'}};
  s.tasks[0].commits = [merged, local];
  const ctx = browserApp(s);
  const html = vm.runInContext('activityView()', ctx);
  assert.match(html, /merged · origin\/main/);
  assert.match(html, /local only · not pushed/);
  assert.match(html, /pushed · not on origin\/main · origin\/feature/);
  assert.match(html, /tested · 1 run \(1 passed, 1 reviewed\)/);
  assert.match(html, /tested: no run records this commit/);
  assert.equal((html.match(/deployed: not recorded/g) || []).length, 3);
  assert.match(html, /data-task="T-1"/);
  assert.match(html, /Merged &lt;x&gt;/);
  assert.match(html, /Last fetch/);
  const tasks = vm.runInContext('tasksView()', ctx);
  assert.match(tasks, /Code: 2 commits · 1 merged · 1 local/);
  const section = vm.runInContext("commitSection(state.tasks[1])", ctx);
  assert.match(section, /No commit message names this task ID/);
});
