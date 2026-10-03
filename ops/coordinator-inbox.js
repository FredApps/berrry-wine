'use strict';

// Passive durable inbox. No terminal/model/process control, task mutation, or
// inference of liveness from a handoff, transcript, PID, or terminal screen.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {parseTasks} = require('./readers');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const schema = 1;
const MAX = 4 * 1024 * 1024;
const fail = message => { throw new Error(message); };

async function localDirectory(base, relative, create = false) {
  const target = path.join(base, relative);
  if (create) await fs.mkdir(target, {recursive:true});
  if (await fs.realpath(target) !== target || !(await fs.stat(target)).isDirectory())
    fail('Directory must be local: ' + relative);
  return target;
}

async function readFile(base, relative, optional = false) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) fail('Path outside root');
  let stat;
  try { stat = await fs.lstat(target); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || await fs.realpath(target) !== target || stat.size > MAX)
    fail('Unsafe or oversized file: ' + relative);
  const handle = await fs.open(target, 'r');
  try {
    const before = await handle.stat();
    const text = await handle.readFile('utf8');
    const after = await handle.stat();
    if (Buffer.byteLength(text) > MAX || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        stat.ino !== before.ino || (await fs.lstat(target)).ino !== before.ino)
      fail('Source changed during read: ' + relative);
    return text;
  } finally { await handle.close(); }
}

function runtimeGate(runtime, coordinatorId, now = Date.now(), maxAgeMs = 30000) {
  const blocked = reason => ({deliveryAllowed:false, pickupAllowed:false, reason});
  if (!runtime || runtime.schema !== schema || runtime.provider !== 'native-goal') return blocked('missing-or-untrusted-runtime');
  if (runtime.coordinatorId !== coordinatorId || runtime.coordinatorCount !== 1) return blocked('ambiguous-coordinator');
  const observed = Date.parse(runtime.observedAt);
  if (!Number.isFinite(observed) || observed > now || now - observed > maxAgeMs) return blocked('stale-runtime');
  if (runtime.connected !== true || runtime.cliPresent !== true) return blocked('runtime-disconnected');
  if (typeof runtime.goal?.id !== 'string' || !runtime.goal.id || runtime.goal.status !== 'active') return blocked('goal-not-active');
  if (runtime.approvalPending !== false) return blocked('approval-or-unknown');
  if (!['idle','busy'].includes(runtime.turn?.state)) return blocked('ambiguous-turn');
  // Busy coordinator can read/ack its inbox at a boundary; this is never a
  // signal to interrupt it. Even idle pickup requires a fresh ownership review.
  return {deliveryAllowed:true, pickupAllowed:runtime.turn.state === 'idle',
    reason:runtime.turn.state === 'idle' ? 'idle-review' : 'busy-review-only'};
}

function taskObservations(source) {
  const tasks = parseTasks(source).filter(t => t.kind === 'checkbox');
  const byId = new Map();
  for (const task of tasks) { const list = byId.get(task.id) || []; list.push(task); byId.set(task.id, list); }
  return tasks.map(task => {
    const dependencyStates = task.dependencies.map(id => {
      const list = byId.get(id) || [];
      return {id, status:list.length === 1 && list[0].editable ? list[0].status : 'missing-or-ambiguous'};
    });
    const dependenciesDone = dependencyStates.every(d => d.status === 'done');
    const pickup = task.acceptedAt && task.acceptedBy ? 'accepted' : task.owner ? 'assigned' : 'awaiting';
    const fields = {taskId:task.id, title:task.title, status:task.status, owner:task.owner,
      acceptedAt:task.acceptedAt, acceptedBy:task.acceptedBy, next:task.next, done:task.done,
      notes:task.notes, evidence:task.evidence, blocker:task.blocker, needs:task.needs,
      waitingOn:task.waitingOn, dependencyStates, pickup};
    const actionable = task.editable && task.status === 'ready' && dependenciesDone;
    let reason = null;
    if (!task.editable) reason = 'task-id-missing-or-ambiguous';
    else if (task.status === 'ready') reason = dependenciesDone ? 'ready-for-review' : 'ready-dependencies-unresolved';
    else if (task.status === 'backlog' && task.dependencies.length && dependenciesDone) reason = 'backlog-dependencies-done';
    else if (task.status === 'active' && pickup === 'awaiting') reason = 'active-without-pickup';
    // Ignore line-number changes for stable explicit IDs. Ambiguous entries are
    // diagnostic only; include their source position to avoid colliding keys.
    return {key:'task:' + task.id + (task.editable ? '' : ':' + task.line),
      contentHash:digest(fields), notice:reason ? {kind:'task', reason, actionable,
        source:'TODOS.md', line:task.line, ...fields} : null};
  });
}

function completion(text) {
  // Only explicit header metadata is machine-readable completion. Free-form
  // historical handoffs are still reported, without inventing a completion.
  let fenced = false;
  const header = text.split(/\r?\n/).slice(0, 20).filter(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return false; }
    return !fenced;
  }).join('\n');
  const values = [...header.matchAll(/^(?:status|handoff-status):\s*(complete|completed|done|incomplete|blocked|ready|active)\s*$/gim)]
    .map(m => m[1].toLowerCase());
  if (!values.length) return 'unclassified';
  const states = new Set(values.map(v => ['complete','completed','done'].includes(v) ? 'declared-complete' : 'not-complete'));
  return states.size === 1 ? [...states][0] : 'ambiguous';
}

async function scan(root) {
  const source = await readFile(root, 'TODOS.md');
  const observations = taskObservations(source);
  const directory = await localDirectory(root, 'ops/handoffs');
  const names = (await fs.readdir(directory)).filter(n => n.endsWith('.md')).sort();
  if (names.length > 2000) fail('Handoff count exceeds limit');
  for (const name of names) {
    const relative = 'ops/handoffs/' + name, text = await readFile(root, relative);
    observations.push({key:'handoff:' + name, contentHash:hash(text), notice:{kind:'handoff',
      source:relative, title:text.split(/\r?\n/).find(line => line.startsWith('# '))?.slice(2, 252) || name,
      completion:completion(text), actionable:false, reason:'handoff-review'}});
  }
  if (source !== await readFile(root, 'TODOS.md')) fail('Task source changed during scan');
  return observations;
}

function reconcile(state, observations, now) {
  const next = structuredClone(state), present = new Set();
  for (const observation of observations) {
    const {key, contentHash, notice} = observation;
    if (present.has(key)) fail('Duplicate observation key');
    present.add(key);
    const previous = next.current[key];
    if (previous?.contentHash === contentHash && !previous.absent) continue;
    if (previous?.noticeId && next.pending[previous.noticeId]) Object.assign(next.pending[previous.noticeId], {current:false, actionable:false});
    const occurrence = (previous?.occurrence || 0) + 1;
    const id = digest({key, contentHash, occurrence});
    next.current[key] = {contentHash, occurrence, noticeId:notice ? id : null, absent:false};
    if (notice) next.pending[id] = {id, contentHash, occurrence, current:true, observedAt:new Date(now).toISOString(), ...notice};
  }
  for (const [key, previous] of Object.entries(next.current)) if (!present.has(key) && !previous.absent) {
    if (previous.noticeId && next.pending[previous.noticeId]) Object.assign(next.pending[previous.noticeId], {current:false, actionable:false});
    previous.absent = true;
  }
  return next;
}

async function openInbox({root, coordinatorId, now = () => Date.now()}) {
  if (typeof coordinatorId !== 'string' || !/^[\w:.-]{1,160}$/.test(coordinatorId)) fail('Explicit coordinator identity required');
  root = await fs.realpath(root);
  const scratch = await localDirectory(root, 'scratch', true);
  const lock = path.join(scratch, 'ops-coordinator-inbox.lock');
  // A crash leaves the lock. Never guess that a quiet owner is dead or steal it.
  await fs.mkdir(lock);
  const token = crypto.randomUUID();
  let closed = false, queue = Promise.resolve();
  const cursor = 'scratch/ops-coordinator-inbox.json';
  const lockOwner = {token, coordinatorId, root, openedAt:new Date(now()).toISOString()};
  try { await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(lockOwner), {flag:'wx', mode:0o600}); }
  catch (error) { await fs.rmdir(lock).catch(() => {}); throw error; }
  const serial = work => { const run = queue.then(work); queue = run.catch(() => {}); return run; };
  async function save(value) {
    const target = path.join(root, cursor), temp = path.join(scratch, '.inbox-' + token + '.tmp');
    const bytes = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > MAX) fail('Inbox capacity exceeded; explicit archival required');
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    try {
      await fs.rename(temp, target);
      const directory = await fs.open(scratch, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return {
    poll({runtime = null, acknowledge = []} = {}) { return serial(async () => {
      if (closed) fail('Observer closed');
      if (!Array.isArray(acknowledge) || acknowledge.some(id => !/^[a-f0-9]{64}$/.test(id))) fail('Exact notice IDs required');
      const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
      if (owner.token !== token) fail('Observer lock ownership changed');
      const old = await readFile(root, cursor, true);
      let state = old === null ? {schema, root, coordinatorId, current:{}, pending:{}, acknowledged:{}, delivered:{}} : JSON.parse(old);
      if (state.schema !== schema || state.root !== root || state.coordinatorId !== coordinatorId ||
          !state.current || !state.pending || !state.acknowledged || !state.delivered) fail('Invalid cursor or coordinator changed; review migration');
      state = reconcile(state, await scan(root), now());
      const gate = runtimeGate(runtime, coordinatorId, now());
      if (acknowledge.length && !gate.deliveryAllowed) fail('Acknowledgement withheld: ' + gate.reason);
      for (const id of acknowledge) {
        if (state.acknowledged[id]) continue;
        if (!state.pending[id] || !state.delivered[id]) fail('Notice not delivered: ' + id);
        state.acknowledged[id] = new Date(now()).toISOString();
        delete state.pending[id]; delete state.delivered[id];
      }
      // Superseded/withdrawn observations remain reviewable until explicit ack.
      for (const id of Object.keys(state.delivered)) if (!state.pending[id]) delete state.delivered[id];
      const notices = gate.deliveryAllowed ? Object.values(state.pending).sort((a,b) => a.id.localeCompare(b.id)) : [];
      for (const notice of notices) state.delivered[notice.id] = true;
      await save(state);
      return {schema, coordinatorId, gate, pendingCount:Object.keys(state.pending).length,
        notices, acknowledgedCount:Object.keys(state.acknowledged).length,
        warning:'Read-only review notices; acknowledgement is not task acceptance or completion. No wake or process control.'};
    }); },
    close() { return serial(async () => {
      if (closed) return;
      const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
      if (owner.token !== token) fail('Observer lock ownership changed');
      await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock); closed = true;
    }); }
  };
}

async function cli(args) {
  const values = Object.create(null);
  for (const arg of args) {
    const match = /^--(root|coordinator|runtime|ack)=(.+)$/.exec(arg);
    if (!match || values[match[1]] !== undefined) fail('Use --root=PATH --coordinator=ID [--runtime=RELATIVE_JSON] [--ack=ID,ID]');
    values[match[1]] = match[2];
  }
  if (!values.root || !values.coordinator) fail('Explicit --root and --coordinator required');
  const root = await fs.realpath(values.root);
  let runtime = null;
  if (values.runtime) {
    try { runtime = JSON.parse(await readFile(root, values.runtime)); }
    catch { /* unavailable/malformed runtime fails closed, but preserves observations */ }
  }
  const inbox = await openInbox({root, coordinatorId:values.coordinator});
  try { return await inbox.poll({runtime, acknowledge:values.ack ? values.ack.split(',') : []}); }
  finally { await inbox.close(); }
}
if (require.main === module) cli(process.argv.slice(2)).then(result => {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}, error => { process.stderr.write('Coordinator inbox: ' + error.message + '\n'); process.exitCode = 1; });
module.exports = {openInbox, runtimeGate, taskObservations, completion, reconcile, cli};
