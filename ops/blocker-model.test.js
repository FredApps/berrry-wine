'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('./blocker-model');
const task = (id, line, extra = {}) => ({id, line, status:'blocked', ...extra});

test('dependency identities are exact, blocked-only, and self excluded', () => {
  const a = task('ROOT', 1), done = task('DONE', 2, {status:'done'});
  const child = task('CHILD', 3, {dependencies:['DONE', 'CHILD'], waitingOn:'Wait ROOT; ROOT-other'});
  const snapshot = {tasks:[a, done, child]};
  assert.deepEqual(model.dependencies(snapshot,child),[a]);
  assert.deepEqual(model.kind(snapshot,child),['Dependency','neutral','View dependency']);
  const summary = model.blockerSummary(snapshot);
  assert.deepEqual(summary.roots,[a]); assert.equal(summary.dependentCount,1);
  assert.deepEqual(summary.blocked,[a,child]);
});

test('review blockers sort last, capacity classification and unsent approval order match web', () => {
  const review = task('REVIEW',1,{blocker:'automated safety review'});
  const plain = task('PLAIN',9);
  const capacity = task('CPU',4,{needs:'CPU host capacity'});
  const snapshot = {tasks:[review,plain,capacity], approvals:{items:[{id:'a',sent:false},{id:'b',sent:true},{id:'c'}]}};
  const summary = model.blockerSummary(snapshot);
  assert.deepEqual(summary.roots.map(t=>t.id),['CPU','PLAIN','REVIEW']);
  assert.deepEqual(summary.blocked,summary.roots);
  assert.deepEqual(summary.approvals.map(p=>p.id),['a','c']);
  assert.equal(model.kind(snapshot,capacity)[0],'Capacity needed');
  assert.deepEqual(snapshot.tasks,[review,plain,capacity]);
});

test('all-cycle fallback and filtered roots preserve dashboard behavior', () => {
  const a = task('A',2,{dependencies:['B']}), b = task('B',1,{dependencies:['A']});
  const snapshot = {tasks:[a,b]};
  assert.deepEqual(model.blockerSummary(snapshot).roots,[b,a]);
  assert.equal(model.blockerSummary(snapshot).dependentCount,0);
  assert.deepEqual(model.primaryRoots(snapshot,[a]),[a]);
  const root = task('INDEPENDENT',3);
  snapshot.tasks.push(root);
  // Existing UI lists primary roots if any; it does not invent a cycle root.
  assert.deepEqual(model.blockerSummary(snapshot).roots,[root]);
  assert.equal(model.blockerSummary(snapshot).dependentCount,2);
});

test('browser and CommonJS expose identical model and HTML loads it first', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('./blocker-model'),'utf8'),ctx);
  const snapshot = {tasks:[task('R',1),task('D',2,{waitingOn:'R'})]};
  assert.equal(JSON.stringify(ctx.BlockerModel.blockerSummary(snapshot)),JSON.stringify(model.blockerSummary(snapshot)));
  assert.deepEqual(model.blockerSummary({}),{blocked:[],roots:[],dependentCount:0,approvals:[],needsUser:[],agentResolvable:[]});
  const html = fs.readFileSync(require.resolve('./index.html'),'utf8');
  assert(html.indexOf('/blocker-model.js') < html.indexOf('/app.js'));
});

test('user vs agent split uses recorded fields only and is shared by web and Telegram', () => {
  const t = {
    user: task('USER', 1, {waitingOn:'user decision on shortcuts', blocker:'Keep installer icons?'}),
    review: task('REVIEW', 2, {waitingOn:'automated review resolution', blocker:'Worker stopped by automated review'}),
    capacity: task('CPU', 3, {needs:'GPU host time'}),
    noUser: task('NOUSER', 4, {waitingOn:'coordinator source/evidence review; no user decision'}),
    root: task('ROOT', 5, {waitingOn:'root'}),
    silent: task('SILENT', 6),
    dep: task('DEP', 7, {dependencies:['USER']}),
  };
  const snapshot = {tasks:Object.values(t)};
  assert.deepEqual(Object.fromEntries(Object.entries(t).map(([k,v])=>[k,model.actor(snapshot,v)[0]])),
    {user:'user',review:'user',capacity:'user',noUser:'agent',root:'agent',silent:'agent',dep:'agent'});
  assert.match(model.actor(snapshot,t.silent)[1],/No waitingOn recorded/);
  assert.match(model.actor(snapshot,t.noUser)[1],/no user decision/);
  const summary = model.blockerSummary(snapshot);
  assert.deepEqual(summary.needsUser.map(x=>x.id),['USER','CPU','REVIEW']);
  assert.deepEqual(summary.agentResolvable.map(x=>x.id),['NOUSER','ROOT','SILENT']);
  assert.equal(summary.roots.length, summary.needsUser.length + summary.agentResolvable.length);
  // Parity: the web Blockers view and Telegram /blockers list the same tasks in the same groups and order.
  const {browserApp} = require('./test-app-vm');
  const ctx = browserApp({...snapshot, agents:[], terminals:[], approvals:{items:[]}, candidates:[], runs:[], warnings:[]});
  const html = vm.runInContext('blockersView()', ctx);
  const [userHtml, agentHtml] = html.split('Agent-resolvable</h2>');
  const ids = part => [...part.matchAll(/<article class="blocker panel"><div class="blocker-heading"><button data-task="([^"]+)"/g)].map(m=>m[1]);
  const text = require('./telegram-blockers').blockersText(snapshot);
  const [userText, agentText] = text.split('AGENT-RESOLVABLE');
  // Untitled fixture tasks render their Telegram title line as " [ID]".
  const tids = part => [...part.matchAll(/^ ?\[([A-Z]+)\]$/gm)].map(m=>m[1]);
  assert.deepEqual(ids(userHtml), ['USER','CPU','REVIEW']);
  assert.deepEqual(ids(agentHtml), ['NOUSER','ROOT','SILENT']);
  assert.deepEqual(tids(userText), ids(userHtml));
  assert.deepEqual(tids(agentText), ids(agentHtml));
  assert.match(text, /3 need your input · 3 agent-resolvable/);
  assert.match(html, /3 need your input · 3 agent-resolvable/);
});
