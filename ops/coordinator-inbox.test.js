'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {openInbox, runtimeGate, completion, cli} = require('./coordinator-inbox');
const NOW = Date.parse('2026-10-02T05:00:00Z');
const coordinatorId = 'fixture-coordinator';
const observers = new Map();
const runtime = (overrides = {}) => ({schema:1, provider:'native-goal', coordinatorId,
  coordinatorCount:1, observedAt:new Date(NOW).toISOString(), connected:true, cliPresent:true,
  goal:{id:'fixture-goal', status:'active'}, turn:{state:'idle'}, approvalPending:false, ...overrides});
const task = (id, status = 'ready', extra = '') => `- [ ] Task ${id}\n  id: ${id}\n  status: ${status}\n  Done: observable result\n${extra}\n`;

async function fixture(t, source = task('A')) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coordinator-inbox-test-'));
  await fs.mkdir(path.join(root, 'ops/handoffs'), {recursive:true});
  await fs.writeFile(path.join(root, 'TODOS.md'), source);
  // mkdtemp can return a path beneath macOS's /var symlink. Canonicalize once.
  const real = await fs.realpath(root);
  observers.set(real, new Set());
  t.after(async () => {
    for (const inbox of observers.get(real)) await inbox.close();
    observers.delete(real);
    await fs.rm(real, {recursive:true, force:true});
  });
  return real;
}
const open = async root => {
  const inbox = await openInbox({root, coordinatorId, now:() => NOW});
  observers.get(root).add(inbox); return inbox;
};
const write = (root, relative, value) => fs.writeFile(path.join(root, relative), value);

test('idle notices survive repeated delivery; exact ack persists across restart without task mutation', async t => {
  const root = await fixture(t), original = await fs.readFile(path.join(root, 'TODOS.md'), 'utf8');
  let inbox = await open(root);
  const first = await inbox.poll({runtime:runtime()});
  assert.equal(first.gate.pickupAllowed, true);
  assert.equal(first.notices.length, 1);
  assert.equal(first.notices[0].pickup, 'awaiting');
  const id = first.notices[0].id;
  assert.equal((await inbox.poll({runtime:runtime()})).notices[0].id, id);
  await inbox.close();
  inbox = await open(root);
  assert.equal((await inbox.poll({runtime:runtime()})).notices[0].id, id);
  const acked = await inbox.poll({runtime:runtime(), acknowledge:[id]});
  assert.equal(acked.pendingCount, 0);
  assert.equal(acked.acknowledgedCount, 1);
  await inbox.close(); inbox = await open(root);
  assert.equal((await inbox.poll({runtime:runtime(), acknowledge:[id]})).notices.length, 0);
  await inbox.close();
  assert.equal(await fs.readFile(path.join(root, 'TODOS.md'), 'utf8'), original);
  await assert.rejects(fs.stat(path.join(root, 'messageboard.txt')), {code:'ENOENT'});
});

test('busy is observable but never eligible for pickup; approval queues changes until reconnect', async t => {
  const root = await fixture(t), inbox = await open(root); t.after(() => inbox.close());
  const busy = await inbox.poll({runtime:runtime({turn:{state:'busy'}})});
  assert.equal(busy.notices.length, 1);
  assert.equal(busy.gate.pickupAllowed, false);
  await write(root, 'ops/handoffs/worker.md', '# Worker\nstatus: complete\nEvidence recorded.\n');
  const approval = await inbox.poll({runtime:runtime({approvalPending:true})});
  assert.equal(approval.notices.length, 0); assert.equal(approval.pendingCount, 2);
  await assert.rejects(inbox.poll({runtime:runtime({approvalPending:true}), acknowledge:[busy.notices[0].id]}), /withheld/);
  const disconnected = await inbox.poll({runtime:runtime({connected:false})});
  assert.equal(disconnected.pendingCount, 2); assert.equal(disconnected.gate.pickupAllowed, false);
  const back = await inbox.poll({runtime:runtime()});
  assert.equal(back.notices.length, 2);
  assert.equal(back.notices.find(n => n.kind === 'handoff').completion, 'declared-complete');
});

test('missing, stale, ambiguous, paused, blocked and absent CLI runtime all fail closed', () => {
  const cases = [null, {}, runtime({coordinatorCount:2}), runtime({coordinatorId:'someone-else'}),
    runtime({observedAt:new Date(NOW - 30001).toISOString()}), runtime({observedAt:new Date(NOW + 1).toISOString()}),
    runtime({approvalPending:undefined}), runtime({cliPresent:false}), runtime({turn:{state:'unknown'}}),
    runtime({goal:{id:'g', status:'paused'}}), runtime({goal:{id:'g', status:'blocked'}}),
    runtime({goal:{id:'g', status:'complete'}}), runtime({provider:'terminal-screen'})];
  for (const value of cases) assert.deepEqual(runtimeGate(value, coordinatorId, NOW).deliveryAllowed, false);
});

test('dependencies, pickup and ambiguous task IDs remain review diagnostics', async t => {
  const root = await fixture(t, task('A','backlog') + task('B','ready','  depends-on: A\n') +
    task('C','backlog','  depends-on: A\n') + task('D','active') + task('E') + task('E'));
  const inbox = await open(root); t.after(() => inbox.close());
  let result = await inbox.poll({runtime:runtime()});
  assert.equal(result.notices.find(n => n.id && n.title === 'Task B').actionable, false);
  assert.equal(result.notices.find(n => n.title === 'Task D').reason, 'active-without-pickup');
  assert.equal(result.notices.filter(n => n.title === 'Task E').length, 2);
  assert(result.notices.filter(n => n.title === 'Task E').every(n => !n.actionable));
  await write(root, 'TODOS.md', task('A','done') + task('B','ready','  depends-on: A\n  owner: worker\n') + task('C','backlog','  depends-on: A\n'));
  result = await inbox.poll({runtime:runtime()});
  const b = result.notices.find(n => n.title === 'Task B' && n.current);
  assert.equal(b.actionable, true); assert.equal(b.pickup, 'assigned');
  assert.equal(result.notices.find(n => n.title === 'Task C').reason, 'backlog-dependencies-done');
  assert.equal(result.notices.find(n => n.title === 'Task C').actionable, false);
});

test('source changes and deletion retain unacknowledged notices; reopen has a new occurrence', async t => {
  const root = await fixture(t), inbox = await open(root); t.after(() => inbox.close());
  const first = (await inbox.poll({runtime:runtime()})).notices[0];
  await write(root, 'TODOS.md', task('A','deferred'));
  let result = await inbox.poll({runtime:runtime()});
  assert.equal(result.pendingCount, 1); assert.equal(result.notices[0].current, false);
  await inbox.poll({runtime:runtime(), acknowledge:[first.id]});
  await write(root, 'TODOS.md', task('A'));
  const reopened = (await inbox.poll({runtime:runtime()})).notices[0];
  assert.notEqual(reopened.id, first.id); assert.equal(reopened.contentHash, first.contentHash);
  await write(root, 'ops/handoffs/a.md', '# Result\nstatus: complete\none\n');
  const h1 = (await inbox.poll({runtime:runtime()})).notices.find(n => n.kind === 'handoff');
  await write(root, 'ops/handoffs/a.md', '# Result\nstatus: complete\ntwo\n');
  result = await inbox.poll({runtime:runtime()});
  assert.equal(result.notices.filter(n => n.kind === 'handoff').length, 2);
  assert.equal(result.notices.find(n => n.id === h1.id).current, false);
  await fs.unlink(path.join(root, 'ops/handoffs/a.md'));
  result = await inbox.poll({runtime:runtime()});
  assert(result.notices.filter(n => n.kind === 'handoff').every(n => n.current === false));
});

test('exclusive observer, corrupt cursor and stale lock fail without stealing ownership', async t => {
  const root = await fixture(t), inbox = await open(root);
  await assert.rejects(open(root), {code:'EEXIST'});
  await inbox.poll({runtime:runtime()}); await inbox.close();
  await write(root, 'scratch/ops-coordinator-inbox.json', '{broken');
  const next = await open(root);
  await assert.rejects(next.poll({runtime:runtime()}), SyntaxError); await next.close();
  await fs.mkdir(path.join(root, 'scratch/ops-coordinator-inbox.lock'));
  await assert.rejects(open(root), {code:'EEXIST'});
  assert((await fs.stat(path.join(root, 'scratch/ops-coordinator-inbox.lock'))).isDirectory());
});

test('ack requires an emitted exact ID and does not consume hidden notices', async t => {
  const root = await fixture(t), inbox = await open(root); t.after(() => inbox.close());
  const hidden = await inbox.poll(); assert.equal(hidden.pendingCount, 1); assert.equal(hidden.notices.length, 0);
  const state = JSON.parse(await fs.readFile(path.join(root, 'scratch/ops-coordinator-inbox.json'), 'utf8'));
  const id = Object.keys(state.pending)[0];
  await assert.rejects(inbox.poll({runtime:runtime(), acknowledge:[id]}), /not delivered/);
  await assert.rejects(inbox.poll({runtime:runtime(), acknowledge:['a'.repeat(64)]}), /not delivered/);
  assert.equal((await inbox.poll({runtime:runtime()})).pendingCount, 1);
});

test('handoff classification never guesses completion from PASS prose or conflicting metadata', () => {
  assert.equal(completion('# Handoff\nAll checks PASS. Complete!'), 'unclassified');
  assert.equal(completion('# Handoff\nstatus: incomplete'), 'not-complete');
  assert.equal(completion('status: done\nhandoff-status: blocked'), 'ambiguous');
  assert.equal(completion('# Example\n```text\nstatus: complete\n```'), 'unclassified');
});

test('CLI missing/malformed runtime safely queues; no invented runtime from handoff or source', async t => {
  const root = await fixture(t);
  let result = await cli(['--root=' + root, '--coordinator=' + coordinatorId]);
  assert.equal(result.pendingCount, 1); assert.equal(result.gate.deliveryAllowed, false);
  await write(root, 'runtime.json', '{broken');
  result = await cli(['--root=' + root, '--coordinator=' + coordinatorId, '--runtime=runtime.json']);
  assert.equal(result.pendingCount, 1); assert.equal(result.notices.length, 0);
  await assert.rejects(cli(['--root=' + root, '--coordinator=' + coordinatorId, '--wake=yes']), /Use --root/);
});

test('symlinked inputs/cursors and changed coordinator cannot silently redirect or reset state', async t => {
  const root = await fixture(t), inbox = await open(root);
  await inbox.poll({runtime:runtime()}); await inbox.close();
  const other = await openInbox({root, coordinatorId:'other', now:() => NOW});
  await assert.rejects(other.poll({runtime:runtime()}), /coordinator changed/); await other.close();
  await fs.symlink(path.join(root, 'TODOS.md'), path.join(root, 'ops/handoffs/alias.md'));
  const next = await open(root);
  await assert.rejects(next.poll({runtime:runtime()}), /Unsafe/); await next.close();
  await fs.unlink(path.join(root, 'ops/handoffs/alias.md'));
  await fs.unlink(path.join(root, 'scratch/ops-coordinator-inbox.json'));
  await fs.symlink(path.join(root, 'TODOS.md'), path.join(root, 'scratch/ops-coordinator-inbox.json'));
  const last = await open(root);
  await assert.rejects(last.poll({runtime:runtime()}), /Unsafe/); await last.close();
});
