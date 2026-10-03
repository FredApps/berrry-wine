'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createActivityReader, boardEntry, githubBase, mergeActivity } = require('./activity');

test('all branches include checkpoint commits once, cached without fetch', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-activity-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
  git('init', '-q'); git('config', 'user.name', 'Test Author'); git('config', 'user.email', 'private@example.test');
  git('commit', '--allow-empty', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('branch', 'checkpoint'); git('checkout', '-q', 'checkpoint');
  git('commit', '--allow-empty', '-qm', 'checkpoint only');
  const checkpoint = git('rev-parse', 'HEAD');
  git('checkout', '-q', '--detach', base);
  git('remote', 'add', 'origin', 'git@github.com:owner/project.git');
  let now = Date.now(); const read = createActivityReader(root, {now:() => now});
  const first = await read([]);
  assert.equal(first.warning, null);
  assert.deepEqual(new Set(first.activity.map(x => x.hash)), new Set([base, checkpoint]));
  assert.equal(first.activity.length, 2);
  assert.equal(first.activity[0].type, 'commit');
  assert(first.activity.every(x => x.url === `https://github.com/owner/project/commit/${x.hash}`));
  assert(!JSON.stringify(first).includes('private@example'));
  git('commit', '--allow-empty', '-qm', 'newer');
  assert.equal((await read([])).activity.length, 2);
  now += 30001;
  assert.equal((await read([])).activity.length, 3);
});

test('timestamps are strict; unknown board messages keep relative order', () => {
  const lines = ['[2026-10-03T22:01:02.123Z agent] message', '2026-10-03T22:02:02Z agent next', '[2026-02-30T00:00:00Z] bad', '2026-10-03 agent date only'];
  const rows = lines.map(boardEntry);
  assert.equal(rows[0].time, '2026-10-03T22:01:02.123Z');
  assert.equal(rows[2].time, null); assert.equal(rows[3].time, null);
  assert.equal(boardEntry('[2026-10-03T21:23Z root] minute precision').time, '2026-10-03T21:23:00.000Z');
  assert.equal(boardEntry('[2026-02-30T21:23Z root] invalid').time, null);
  assert.deepEqual(mergeActivity(rows, []).map(x => x.text), [lines[1], lines[0], lines[2], lines[3]]);
});

test('only uncredentialed GitHub origin formats produce links', () => {
  assert.equal(githubBase('https://github.com/owner/repo.git\n'), 'https://github.com/owner/repo');
  for (const url of ['https://token@github.com/o/r.git', 'https://github.com.evil/o/r', 'git@evil:owner/repo', 'https://github.com/o/r?token=secret', 'https://github.com/../r', 'https://github.com/o/r#fragment']) assert.equal(githubBase(url), null);
});

test('unavailable git degrades safely and coalesces concurrent refresh', async () => {
  let calls = 0;
  const read = createActivityReader('/missing', {execFile(_file, _args, opts, callback) {
    calls++; assert.equal(opts.timeout, 2500); assert.equal(opts.maxBuffer, 1048576);
    setImmediate(() => callback(Object.assign(new Error('secret remote credentials'), {code:'ENOENT'})));
  }});
  const message = boardEntry('unknown board timestamp');
  const [a,b] = await Promise.all([read([message]), read([message])]);
  assert.equal(calls, 2); assert.deepEqual(a,b); assert.equal(a.activity.length,1);
  assert.equal(a.warning, 'Git activity unavailable (ENOENT).');
  await read([]); assert.equal(calls,2);
});
