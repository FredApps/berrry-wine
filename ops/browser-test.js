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
    await write('scratch/runs/R-1/result.json', JSON.stringify({ candidateId: 'demo', startedAt: now, outcome: 'failed', route: 'startup', screenshot: 'screen.png', command: 'node test/run.js --app=demo', summary: 'Fault before menu' }));
    await write('scratch/runs/R-1/screen.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64'));
    await write('codex/one.jsonl', [
      { type: 'session_meta', timestamp: now, payload: { id: 'one', cwd: root } },
      { type: 'turn_context', timestamp: now, payload: { model: 'codex-fixture' } },
      { type: 'event_msg', timestamp: now, payload: { type: 'task_started' } },
      { type: 'event_msg', timestamp: now, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 }, model_context_window: 200 } } },
    ].map(JSON.stringify).join('\n') + '\n');
    await write('claude/two.jsonl', JSON.stringify({ type: 'assistant', cwd: root, sessionId: 'two', timestamp: now, message: { model: 'claude-fixture', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash' }], usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 5 } } }) + '\n');
    server = createServer({ root, codexRoot: path.join(root, 'codex'), claudeRoot: path.join(root, 'claude') });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.agent');
    assert.equal(await page.$$eval('.agent', els => els.length), 2);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await fs.mkdir(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'overview.png'), fullPage: true });
    await page.click('a[data-view="tasks"]'); await page.waitForSelector('#filter');
    await page.select('#filter', 'active');
    assert.equal(await page.$$eval('.task', els => els.length), 1);
    await page.click('[data-task="T-1"]'); await page.waitForSelector('dialog[open]');
    assert.ok(await page.$eval('#detail-body', el => el.textContent.includes('Fix startup')));
    await page.click('#close-detail');
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
    console.log(`PASS dashboard navigation, task filters, search, provider details, PNGs, escaping, mobile layout and live file refresh\nScreenshots: ${shots}`);
  } finally {
    if (browser) await browser.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
