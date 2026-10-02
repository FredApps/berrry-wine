#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { createServer } = require('./server');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wine-ops-browser-'));
  const shots = path.join(__dirname, '..', 'scratch', 'ops-preview');
  let browser, server;
  const write = async (name, value) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
  try {
    const now = new Date().toISOString();
    await write('TODOS.md', '## Current work\n- [~] Fix startup\n  id: T-1\n  candidate: demo\n  owner: codex:one\n  started: ' + now + '\n  progress: ' + now + '\n- [ ] Verify gameplay\n  candidate: demo\n');
    await write('test/candidate-corpus/manifest.json', JSON.stringify({ candidates: [
      { id: 'demo', name: 'Demo <app>', version: '1.0', notes: '<script>window.injected=true</script>' },
      { id: 'other', name: 'Another candidate', version: '2.0' },
    ] }));
    await write('messageboard.txt', '2026-10-01 codex PROGRESS startup fault reproduced\n<script>window.injected=true</script>\n');
    await write('scratch/runs/R-1/result.json', JSON.stringify({ candidateId: 'demo', taskId: 'T-1', agentId: 'codex:one', startedAt: now, outcome: 'failed', route: 'startup', screenshot: 'screen.png', diagrams: ['flow.png'], command: 'node test/run.js --app=demo', summary: 'Fault before menu' }));
    await write('scratch/runs/R-1/screen.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64'));
    await write('scratch/runs/R-1/flow.png', await fs.readFile(path.join(root, 'scratch/runs/R-1/screen.png')));
    await write('codex/one.jsonl', [
      { type: 'session_meta', timestamp: now, payload: { id: 'one', cwd: root } },
      { type: 'turn_context', timestamp: now, payload: { model: 'codex-fixture' } },
      { type: 'event_msg', timestamp: now, payload: { type: 'task_started' } },
      { type: 'event_msg', timestamp: now, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 }, model_context_window: 200 } } },
    ].map(JSON.stringify).join('\n') + '\n');
    await write('claude/two.jsonl', JSON.stringify({ type: 'assistant', cwd: root, sessionId: 'two', timestamp: now, message: { model: 'claude-fixture', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash' }], usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 5 } } }) + '\n');
    server = createServer({ root, codexRoot: path.join(root, 'codex'), claudeRoot: path.join(root, 'claude'), processProbe: async () => ({
      checkedAt: new Date().toISOString(), error: null, registry: [],
      processes: [{pid: 12345, ppid: 1, name: 'codex', state: 'S', elapsed: '01:02', started: 'Thu Oct 1 12:00:00 2026', cpuPercent:2.5,rssBytes:128*1024**2}, {pid:12346, ppid:12345, name:'node', state:'R', elapsed:'00:20', started:'Thu Oct 1 12:00:42 2026',cpuPercent:120,rssBytes:1024**3}],
      files: new Map([[path.join(root, 'codex/one.jsonl'), new Set([12345])]]),
    }) });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.agent');
    assert.equal(await page.$$eval('.agent', els => els.length), 2);
    assert.match(await page.$eval('.agent:has([data-agent="codex:one"]) .process-line', el => el.textContent), /PID 12345/);
    assert.match(await page.$eval('.agent:has([data-agent="codex:one"]) .process-line', el => el.textContent), /2\.5% CPU · 128 MiB RSS/);
    assert.match(await page.$eval('.agent:has([data-agent="codex:one"]) .process-background', el => el.textContent), /Background 1 · 120\.0% CPU · 1\.0 GiB RSS/);
    assert.match(await page.$eval('.agent:has([data-agent="claude:two"]) .process-line', el => el.textContent), /PID not matched/);
    await page.click('[data-agent="codex:one"]');
    assert.match(await page.$eval('.process-table', el => el.textContent), /12346/);
    await page.click('#close-detail');
    assert.equal(await page.$$eval('#main > .visual-grid .visual-card', els => els.length), 1);
    assert.equal(await page.$eval('.visual-kind', el => el.textContent), 'Diagram');
    assert.equal(await page.$$eval('.agent:has([data-agent="codex:one"]) .agent-preview', els => els.length), 1);
    assert.equal(await page.$$eval('.agent:has([data-agent="claude:two"]) .agent-preview', els => els.length), 0);
    assert.equal(await page.$$eval('.agent .metrics, .agent .visual-caption', els => els.length), 0);
    assert.ok(!await page.$eval('.agent', el => el.textContent.includes('unknown')));
    await page.click('#main > .visual-grid .visual-card');
    await page.waitForFunction(() => [...document.querySelectorAll('.detail-shot')].length === 2 && [...document.querySelectorAll('.detail-shot')].every(img => img.naturalWidth > 0));
    await page.click('#close-detail');
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await fs.mkdir(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'overview.png'), fullPage: true });
    await page.click('a[data-view="tasks"]'); await page.waitForSelector('#filter');
    assert.deepEqual(await page.$$eval('[data-task-group]', els => els.map(e => e.dataset.taskGroup)), ['active','ready']);
    assert.match(await page.$eval('.task-label-active', el => el.textContent), /Running/);
    assert.match(await page.$eval('.task-active .task-preview', el => el.textContent), /Task evidence/);
    assert.match(await page.$eval('.task-ready .task-preview', el => el.textContent), /Related app/);
    assert.match(await page.$eval('.task-active .task-owner', el => el.textContent), /Assigned to.*codex.*one/);
    assert.match(await page.$eval('.task-ready .task-owner', el => el.textContent), /Unassigned/);
    await page.click('.task-active [data-agent="codex:one"]');
    assert.match(await page.$eval('#detail-body', el => el.textContent), /codex:one/);
    await page.click('#close-detail');
    await page.click('.task-active .task-preview');
    assert.match(await page.$eval('#detail-body', el => el.textContent), /Fault before menu/);
    await page.click('#close-detail');
    await page.select('#filter', 'active');
    assert.equal(await page.$$eval('.task', els => els.length), 1);
    await page.click('[data-task="T-1"]'); await page.waitForSelector('dialog[open]');
    assert.ok(await page.$eval('#detail-body', el => el.textContent.includes('Fix startup')));
    assert.match(await page.$eval('#detail-body .task-owner', el => el.textContent), /codex:one/);
    assert.match(await page.$eval('#detail-body .task-owner', el => el.textContent), /Terminal unavailable/);
    assert.equal(await page.$$eval('#detail-body .visual-card', els => els.length), 1);
    await page.click('#close-detail');
    await write('TODOS.md', '## Queue\n- [x] Finished first in file\n- [ ] Later\n  status: backlog\n- [!] Claude paused\n  status: deferred\n  Next: Leave untouched\n- [!] Need fixture\n  blocker: Installer missing\n- [ ] Review result\n  status: review\n- [ ] Verify gameplay\n  Next: Run input probe\n- [~] Fix startup\n  id: T-1\n  Next: Compare <before> and after\n\n## Old notes\nHistorical prose\n');
    await page.select('#filter', 'all');
    await page.waitForSelector('[data-task-group="deferred"]', {timeout:15000});
    assert.deepEqual(await page.$$eval('[data-task-group]', els => els.map(e => e.dataset.taskGroup)), ['active','ready','review','blocked','backlog','deferred','done','unknown']);
    assert.equal(await page.$eval('[data-task-group="done"]', el => el.open), false);
    assert.equal(await page.$eval('[data-task-group="deferred"]', el => el.open), false);
    assert.match(await page.$eval('.task-active .task-next', el => el.textContent), /Compare <before> and after/);
    assert.equal(await page.$$eval('.task-ready .task-preview', els => els.length), 0);
    await page.click('[data-task-group="done"] summary');
    await page.click('#refresh');
    await page.waitForFunction(() => document.querySelector('[data-task-group="done"]')?.open);
    await page.screenshot({path:path.join(shots,'tasks.png'),fullPage:true});
    await page.click('[data-task-filter="ready"]');
    assert.equal(await page.$$eval('[data-task-group]', els => els.length), 1);
    await page.click('[data-task-filter="ready"]');
    await page.setViewport({width:390,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({path:path.join(shots,'tasks-mobile.png'),fullPage:true});
    await page.setViewport({width:1440,height:1000});
    await page.click('a[data-view="corpus"]'); await page.waitForSelector('.candidate');
    await page.type('#search', 'Demo');
    assert.equal(await page.$$eval('.candidate', els => els.length), 1);
    await page.click('[data-candidate="demo"]');
    await page.waitForSelector('.detail-shot');
    await page.waitForFunction(() => document.querySelector('.detail-shot').naturalWidth > 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.screenshot({ path: path.join(shots, 'candidate.png'), fullPage: true });
    await page.click('[data-run="scratch/runs/R-1"]');
    assert.ok(await page.$eval('#detail-body', el => el.textContent.includes('Fault before menu')));
    await page.click('#close-detail');
    await page.click('a[data-view="agents"]'); await page.waitForSelector('[data-agent="claude:two"]');
    await page.click('.agent:has([data-agent="codex:one"]) .agent-preview');
    assert.ok(await page.$eval('#detail-body', el => el.textContent.includes('flow.png')));
    await page.click('#close-detail');
    await page.click('[data-agent="claude:two"]');
    assert.ok(await page.$eval('#detail-body', el => el.textContent.includes('Cache write')));
    await page.click('#close-detail');
    await page.setViewport({ width: 390, height: 844 });
    await page.click('a[data-view="overview"]');
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Operations console');
    await page.screenshot({ path: path.join(shots, 'mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    // A real filesystem change must arrive through polling without navigation.
    await write('messageboard.txt', 'fresh-poll-marker\n');
    await page.click('a[data-view="activity"]');
    await page.waitForFunction(() => document.querySelector('#main').textContent.includes('fresh-poll-marker'), { timeout: 15000 });
    assert.deepEqual(errors, []);
    await write('TODOS.md', '- [!] Obtain installer\n  id: B-1\n  blocker: Missing fixture\n  needs: Choose the test version\n  owner: codex:one\n');
    await page.setViewport({width:1440,height:1000});
    await page.click('a[data-view="blockers"]');
    await page.waitForSelector('[data-blocker="B-1"]', {timeout:15000});
    await page.click('[data-blocker="B-1"]');
    await page.type('#reply-text','Use version 1.0; verify startup before resuming.');
    await page.click('#blocker-reply button');
    await page.waitForFunction(() => document.querySelector('#reply-status')?.textContent.includes('Posted.'));
    assert.match(await fs.readFile(path.join(root,'messageboard.txt'),'utf8'),/\[OPS-REPLY B-1\] Use version 1.0/);
    assert.match(await fs.readFile(path.join(root,'TODOS.md'),'utf8'),/\[!\]/);
    await page.click('#close-detail');
    await page.waitForFunction(() => document.querySelector('.blocker')?.textContent.includes('Reply posted'));
    await page.screenshot({path:path.join(shots,'blockers.png'),fullPage:true});
    await write('TODOS.md', '- [~] Work on Demo\n  id: T-1\n  candidate: demo\n- [ ] Queue another\n  candidate: other\n');
    await write('test/candidate-corpus/manifest.json', JSON.stringify({candidates:[
      {id:'passed',name:'A Passed'}, {id:'unknown',name:'B Unknown'},
      {id:'untested',name:'C Untested'}, {id:'failed',name:'D Failed'},
      {id:'other',name:'E Queued'}, {id:'demo',name:'Z Working'},
    ]}));
    for(const outcome of ['passed','unknown','failed']) await write(`scratch/runs/${outcome}/result.json`,JSON.stringify({candidateId:outcome,startedAt:now,outcome}));
    await page.click('a[data-view="corpus"]');
    await page.waitForFunction(() => document.querySelectorAll('.candidate').length === 6,{timeout:15000});
    assert.deepEqual(await page.$$eval('.candidate',els=>els.map(e=>e.dataset.candidate)),['demo','other','failed','untested','unknown','passed']);
    assert.match(await page.$eval('.candidate-working',el=>el.textContent),/In progress.*Work on Demo/s);
    await page.select('#filter','working');
    assert.equal(await page.$$eval('.candidate',els=>els.length),1);
    await page.select('#filter','all');
    await page.screenshot({path:path.join(shots,'corpus-ranked.png'),fullPage:true});
    await page.setViewport({width:390,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    console.log(`PASS dashboard navigation, task filters, search, provider details, PNGs, escaping, mobile layout and live file refresh\nScreenshots: ${shots}`);
  } finally {
    if (browser) await browser.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
