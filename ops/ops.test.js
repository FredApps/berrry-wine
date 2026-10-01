'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { parseTasks, parseSession, createReader, logWindows } = require('./readers');
const { createServer } = require('./server');
const { parseProcesses, parseOpenFiles, associate } = require('./processes');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wine-ops-'));
  async function write(relative, data) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); }
  await write('TODOS.md', '## Current work\n- [~] Fix startup\n  id: T-1\n  candidate: demo\n  owner: codex:one\n  started: 2026-10-01T12:00:00Z\n  progress: 2026-10-01T12:05:00Z\n\n## Legacy investigation\nHistorical prose; no current status.\n');
  await write('test/candidate-corpus/manifest.json', JSON.stringify({ assetRoot: 'test/binaries/candidates', candidates: [{ id: 'demo', name: 'Demo <app>', version: '1', executables: ['game.exe'], notes: 'See docs/re-notes/demo.md' }] }));
  await write('test/binaries/candidates/demo/game.exe', 'fixture');
  await write('docs/re-notes/demo.md', '# Findings');
  await write('messageboard.txt', '2026-10-01 agent CLAIM demo\n2026-10-01 agent PROGRESS found bug\n');
  await write('scratch/runs/R-1/result.json', JSON.stringify({ candidateId: 'demo', startedAt: '2026-10-01T12:00:00Z', outcome: 'passed', route: 'menu', verification: 'reviewed', screenshot: 'screen.png' }));
  await write('scratch/runs/R-1/screen.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64'));
  return { root, write, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('task parser preserves legacy uncertainty, links exact candidates, ignores fenced examples', () => {
  const text = '## Legacy\nStill historical\n\n## Current\n- [!] Startup\n  candidate: demo\n  owner: claude:abc\n- [x] Fixed\n  candidate: demo-extra\n```md\n- [ ] example\n```';
  const tasks = parseTasks(text, [{ id: 'demo' }]);
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].status, 'unknown');
  assert.equal(tasks[1].status, 'blocked');
  assert.equal(tasks[1].owner, 'claude:abc');
  assert.deepEqual(tasks[1].candidateIds, ['demo']);
  assert.deepEqual(tasks[2].candidateIds, []);
});

test('PID association requires exact open log or live Claude registry with matching process start', () => {
  const processes = parseProcesses('101 1 S+ 01:02 Thu Oct 1 12:00:00 2026 /opt/bin/codex\n102 101 S 00:30 Thu Oct 1 12:00:32 2026 /bin/zsh\n103 102 R 00:15 Thu Oct 1 12:00:47 2026 node\n201 1 S 02:00 Thu Oct 1 11:59:02 2026 claude\n301 1 S 02:00 Thu Oct 1 11:59:02 2026 unrelated\n');
  const agents = [
    { id: 'codex:a', provider: 'codex', logFile: '/logs/a.jsonl' },
    { id: 'codex:b', provider: 'codex', logFile: '/logs/b.jsonl' },
    { id: 'codex:c', provider: 'codex', logFile: '/logs/c.jsonl' },
    { id: 'claude:parent', provider: 'claude', logFile: '/logs/parent.jsonl' },
    { id: 'claude:agent-child', provider: 'claude', logFile: '/logs/parent/subagents/agent-child.jsonl' },
  ];
  const files = parseOpenFiles('p101\nn/logs/a.jsonl\np301\nn/logs/c.jsonl\n');
  const registry = [{ pid: 201, sessionId: 'parent', procStart: 'Thu Oct  1 11:59:02 2026', pidDomain: process.platform }];
  const linked = associate(agents, processes, files, registry, '2026-10-01T12:01:02Z');
  assert.deepEqual(linked.get(agents[0]).matches.map(p => p.pid), [101]);
  assert.deepEqual(linked.get(agents[0]).children.map(p => p.pid), [102, 103]);
  assert.equal(linked.get(agents[1]).status, 'unmatched');
  assert.equal(linked.get(agents[2]).status, 'unmatched');
  assert.equal(linked.get(agents[3]).matches[0].pid, 201);
  assert.equal(linked.get(agents[4]).matches[0].shared, true);
  assert.equal(linked.get(agents[3]).matches[0].shared, true);
  registry[0].procStart = 'Wed Sep 30 11:59:02 2026';
  assert.equal(associate(agents, processes, files, registry, null).get(agents[3]).status, 'unmatched');
  assert.equal(associate(agents, [], new Map(), [], null, 'Permission denied').get(agents[0]).status, 'unavailable');
  assert.equal(associate(agents, [], files, registry, null).get(agents[0]).status, 'unmatched');
});

test('provider usage distinguishes cached input, totals and context limits', () => {
  const root = '/project';
  const time = '2026-10-01T12:00:00Z';
  const codex = parseSession('codex', [
    { type: 'session_meta', timestamp: time, payload: { cwd: root, id: 'one' } },
    { type: 'response_item', timestamp: time, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the startup fault' }] } },
    { type: 'response_item', timestamp: time, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>not the task</environment_context>' }] } },
    { type: 'event_msg', timestamp: time, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 }, total_token_usage: { total_tokens: 9000 }, model_context_window: 200 } } },
    { type: 'event_msg', timestamp: time, payload: { type: 'task_complete' } },
  ], '/logs/one.jsonl', false, root);
  assert.equal(codex.cachePercent, 80); assert.equal(codex.totalTokens, 9000); assert.equal(codex.contextEstimate, 100); assert.equal(codex.state, 'idle');
  assert.equal(codex.title, 'Fix the startup fault');
  const claudeRecords = [{ type: 'assistant', cwd: root, sessionId: 'two', timestamp: time, message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash' }], usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 15 } } }];
  const claude = parseSession('claude', claudeRecords, '/logs/two.jsonl', true, root);
  assert.equal(claude.cachePercent, 80); assert.equal(claude.inputTokens, 100); assert.equal(claude.totalTokens, null); assert.equal(claude.contextLimit, null);
  const compacted = parseSession('claude', [...claudeRecords, { type: 'system', subtype: 'compact_boundary', timestamp: time }], '/logs/two.jsonl', true, root);
  assert.equal(compacted.contextEstimate, null);
  assert.equal(parseSession('claude', claudeRecords, '/logs/two.jsonl', false, '/project-other'), null);
  const incomplete = parseSession('claude', [{ ...claudeRecords[0], message: { usage: { input_tokens: 10 } } }], '/logs/two.jsonl', false, root);
  assert.equal(incomplete.cachePercent, null); assert.equal(incomplete.inputTokens, null);
});

test('bounded logs ignore incomplete records and do not carry an old turn across a gap', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const head = JSON.stringify({ type: 'session_meta', timestamp: '2026-10-01T12:00:00Z', payload: { cwd: f.root } }) + '\n' + JSON.stringify({ type: 'event_msg', timestamp: '2026-10-01T12:00:00Z', payload: { type: 'task_started' } }) + '\n';
  await f.write('large.jsonl', head + (JSON.stringify({ type: 'ignored', padding: 'x'.repeat(1000) }) + '\n').repeat(1500) + JSON.stringify({ type: 'response_item', timestamp: '2026-10-01T13:00:00Z', payload: { type: 'function_call', name: 'shell' } }) + '\n{"type":');
  const file = path.join(f.root, 'large.jsonl');
  const data = await logWindows(file, (await fs.stat(file)).size);
  assert.equal(data.partial, true);
  const s = parseSession('codex', data.records, file, data.partial, f.root);
  assert.equal(s.turnStartedAt, null); assert.equal(s.state, 'tool');
  assert.equal(s.lastActivityAt, '2026-10-01T13:00:00.000Z');
});

test('file ingestion updates tasks, tolerates malformed runs and preserves last verified result', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const reader = createReader({ root: f.root, codexRoot: false, claudeRoot: false });
  await f.write('scratch/runs/R-2/result.json', JSON.stringify({ candidateId: 'demo', startedAt: '2026-10-01T13:00:00Z', outcome: 'failed', screenshot: 'missing.png' }));
  await f.write('scratch/runs/bad/result.json', '{');
  const s = await reader.snapshot();
  assert.equal(s.tasks.length, 2); assert.equal(s.activity[0].text.includes('PROGRESS'), true);
  assert.equal(s.candidates[0].latestRun.id, 'R-2'); assert.equal(s.candidates[0].lastVerifiedRun.id, 'R-1');
  assert.equal(s.candidates[0].fixtureStatus, 'present'); assert.equal(s.candidates[0].noteLinks.length, 1);
  assert.ok(s.warnings.some(w => w.includes('missing.png'))); assert.ok(s.warnings.some(w => w.includes('bad/result.json')));
  await f.write('TODOS.md', '## Current\n- [x] Done\n');
  assert.equal((await reader.snapshot()).tasks[0].status, 'done');
});

test('session collection scopes to project, updates changed logs, and attaches explicit task ownership', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const file = 'codex/one.jsonl';
  const records = [{ type: 'session_meta', timestamp: '2026-10-01T12:00:00Z', payload: { id: 'one', cwd: f.root } }, { type: 'event_msg', timestamp: '2026-10-01T12:01:00Z', payload: { type: 'task_started' } }];
  await f.write(file, records.map(JSON.stringify).join('\n') + '\n');
  await f.write('codex/duplicate.jsonl', records.map(JSON.stringify).join('\n') + '\n');
  await f.write('codex/other.jsonl', JSON.stringify({ type: 'session_meta', payload: { cwd: '/unrelated', id: 'private' } }) + '\n');
  const reader = createReader({ root: f.root, codexRoot: path.join(f.root, 'codex'), claudeRoot: false, processes: false });
  const first = await reader.snapshot();
  assert.equal(first.agents.length, 1); assert.equal(first.agents[0].taskId, 'T-1'); assert.equal(first.agents[0].progressAt, '2026-10-01T12:05:00.000Z');
  await fs.appendFile(path.join(f.root, file), JSON.stringify({ type: 'event_msg', timestamp: '2026-10-01T12:02:00Z', payload: { type: 'task_complete' } }) + '\n');
  assert.equal((await reader.snapshot()).agents[0].state, 'idle');
});

test('visuals preserve explicit session attribution and keep diagrams out of candidate screenshots', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const png = await fs.readFile(path.join(f.root, 'scratch/runs/R-1/screen.png'));
  await f.write('scratch/runs/R-1/flow.png', png);
  await f.write('scratch/runs/R-1/result.json', JSON.stringify({ candidateId: 'demo', agentId: 'claude:agent-child', startedAt: '2026-10-01T12:00:00Z', outcome: 'unknown', screenshot: 'screen.png', diagrams: ['flow.png', '../../../secret.png', 'missing.png'] }));
  await f.write('secret.png', png);
  const reader = createReader({ root: f.root, codexRoot: false, claudeRoot: false });
  const s = await reader.snapshot();
  const r = s.runs[0];
  assert.equal(r.agentId, 'claude:agent-child');
  assert.deepEqual(r.visuals.map(v => [v.name, v.kind]), [['screen.png', 'screenshot'], ['flow.png', 'diagram']]);
  assert.deepEqual(r.screenshots.map(v => v.name), ['screen.png']);
  assert.equal(s.candidates[0].latestRun.screenshots[0].name, 'screen.png');
  assert.ok(s.warnings.some(w => w.includes('secret.png')));
  assert.ok(s.warnings.some(w => w.includes('missing.png')));
  assert.ok(await reader.artifact('scratch/runs/R-1/flow.png'));
  assert.equal(await reader.artifact('scratch/runs/R-1/../../../secret.png'), null);
});

test('HTTP is read-only, origin-checked, and serves only allowlisted files and contained artifacts', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.write('secret.txt', 'not a served source');
  await fs.symlink(path.join(f.root, 'secret.txt'), path.join(f.root, 'scratch/runs/R-1/leak.log'));
  await f.write('scratch/runs/R-2/result.json', JSON.stringify({ candidateId: 'demo', startedAt: '2026-10-01T13:00:00Z', outcome: 'failed', artifacts: ['../../../secret.txt', '../R-1/leak.log'] }));
  const server = createServer({ root: f.root, codexRoot: false, claudeRoot: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (route, options) => fetch(base + route, options);
  assert.equal((await get('/')).status, 200);
  const state = await (await get('/api/state')).json();
  assert.equal(state.runs.find(r => r.id === 'R-2').artifacts.length, 1);
  const shot = state.runs.find(r => r.id === 'R-1').screenshots[0];
  assert.equal((await get(shot.url)).headers.get('content-type'), 'image/png');
  assert.equal((await get('/api/state', { method: 'POST' })).status, 405);
  assert.equal((await get('/api/state', { headers: { Origin: 'http://evil.invalid' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/state', { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  for (const route of ['/source?path=secret.txt', '/source?path=../../secret.txt', '/artifact?key=secret.txt', '/readers.js']) assert.equal((await get(route)).status, 404);
  assert.equal((await get('/source?path=TODOS.md')).headers.get('content-type'), 'text/plain; charset=utf-8');
});

module.exports = { fixture };
