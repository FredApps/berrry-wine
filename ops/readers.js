'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const MB = 1024 * 1024;
const clip = (value, n = 220) => typeof value === 'string' ? value.replace(/\s+/g, ' ').slice(0, n) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

async function safeFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) return null;
  try {
    const base = await fs.realpath(root);
    const target = await fs.realpath(path.resolve(base, relative));
    return inside(base, target) && (await fs.stat(target)).isFile() ? target : null;
  } catch { return null; }
}

async function readText(file, limit = 2 * MB) {
  const h = await fs.open(file, 'r');
  try {
    const stat = await h.stat();
    if (stat.size > limit) throw new Error(`file exceeds ${limit / MB} MiB read limit`);
    return await h.readFile('utf8');
  } finally { await h.close(); }
}

async function windowText(file, start, length) {
  const h = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await h.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await h.close(); }
}

// Session logs can exceed 100 MiB. Read complete records from bounded windows;
// never copy the transcript or serve tool arguments/reasoning to the browser.
async function logWindows(file, size) {
  const budget = 1280 * 1024;
  let chunks;
  if (size <= budget) chunks = [await windowText(file, 0, size)];
  else {
    const head = await windowText(file, 0, 256 * 1024);
    const tail = await windowText(file, size - MB, MB);
    chunks = [head.slice(0, head.lastIndexOf('\n')), '{"type":"ops_window_boundary"}\n' + tail.slice(tail.indexOf('\n') + 1)];
  }
  const records = [];
  for (const chunk of chunks) for (const line of chunk.split('\n')) {
    try { const record = JSON.parse(line); if (record && typeof record === 'object') records.push(record); } catch { /* partial line or unsupported record */ }
  }
  return { records, partial: size > budget };
}

function parseTasks(text, candidates = []) {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let section = 'TODOs', fenced = false;
  const metadata = (body, key) => body.match(new RegExp(`(?:^|[\\s|])${key}:\\s*([^\\s|]+)`, 'im'))?.[1] || null;
  function add(title, body, line, status, kind) {
    const explicit = metadata(body, 'status');
    const candidateIds = candidates.filter(c => new RegExp(`(^|[^a-zA-Z0-9_-])${c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-zA-Z0-9_-])`).test(body)).map(c => c.id);
    tasks.push({ id: metadata(body, 'id') || `todo-${line}`, title: clip(title, 250), body: body.slice(0, 24000), line,
      section, kind, status: ['backlog', 'ready', 'active', 'blocked', 'review', 'done'].includes(explicit) ? explicit : status,
      owner: metadata(body, 'owner'), startedAt: date(metadata(body, 'started')), progressAt: date(metadata(body, 'progress')),
      candidateIds, source: 'TODOS.md' });
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^## /.test(line)) {
      section = line.slice(3).trim();
      let end = i + 1;
      while (end < lines.length && !/^## /.test(lines[end])) end++;
      const body = lines.slice(i, end).join('\n');
      // Legacy prose remains visible without guessing its current status.
      if (!/^\s*[-*] \[[ xX~!]\]/m.test(body)) add(section, body, i + 1, 'unknown', 'legacy section');
    }
    const match = line.match(/^\s*[-*] \[([ xX~!])\]\s+(.+)/);
    if (match) {
      let end = i + 1;
      while (end < lines.length && !/^\s*(?:[-*] \[|#{1,6} )/.test(lines[end])) end++;
      const body = lines.slice(i, end).join('\n');
      add(match[2], body, i + 1, ({ x: 'done', '~': 'active', '!': 'blocked', ' ': 'ready' })[match[1].toLowerCase()], 'checkbox');
    }
  }
  return tasks;
}

function parseSession(provider, records, file, partial, root) {
  const session = { id: `${provider}:${path.basename(file, '.jsonl')}`, provider, title: '', model: null,
    cwd: null, startedAt: null, turnStartedAt: null, lastActivityAt: null, lastEvent: 'Unknown', state: 'unknown',
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, contextLimit: null,
    totalTokens: null, usageAt: null, compactions: 0, partial, progressAt: null, taskId: null };
  let projectMatch = false;
  let usageAtCompaction = false;
  for (const e of records) {
    if (e.type === 'ops_window_boundary') {
      session.turnStartedAt = null;
      session.state = 'unknown';
      session.lastActivityAt = null;
      session.lastEvent = 'Unknown';
      continue;
    }
    const p = e.payload || {};
    const time = date(e.timestamp);
    const cwd = e.cwd || p.cwd;
    if (typeof cwd === 'string' && inside(root, path.resolve(cwd))) { projectMatch = true; session.cwd = cwd; }
    if (!session.startedAt && time) session.startedAt = time;
    if (provider === 'codex') {
      if (e.type === 'session_meta') {
        session.id = `codex:${p.id || p.session_id || path.basename(file, '.jsonl')}`;
        session.startedAt = date(p.timestamp) || time;
        session.contextLimit = number(p.context_window);
      }
      if (e.type === 'turn_context') session.model = clip(p.model) || session.model;
      if (e.type === 'event_msg') {
        if (p.type === 'task_started') { session.turnStartedAt = date(p.started_at) || time; session.state = 'working'; session.lastEvent = 'Turn started'; }
        if (p.type === 'task_complete') { session.state = 'idle'; session.lastEvent = 'Turn completed'; }
        if (p.type === 'turn_aborted') { session.state = 'idle'; session.lastEvent = 'Turn interrupted'; }
        if (p.type === 'user_message') session.title = clip(p.message, 160) || session.title;
        if (p.type === 'token_count' && p.info) {
          const u = p.info.last_token_usage || {};
          session.inputTokens = number(u.input_tokens); session.outputTokens = number(u.output_tokens);
          session.cacheReadTokens = number(u.cached_input_tokens); session.cacheWriteTokens = number(u.cache_write_input_tokens);
          session.contextLimit = number(p.info.model_context_window) ?? session.contextLimit;
          session.totalTokens = number(p.info.total_token_usage?.total_tokens); session.usageAt = time; usageAtCompaction = false;
        }
      }
      if (e.type === 'response_item') {
        if (p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
          const message = p.content.filter(c => ['input_text', 'text'].includes(c.type)).map(c => c.text || '').join('\n').trim();
          if (message && !/^(?:<|# AGENTS\.md|# .*instructions)/i.test(message)) session.title = clip(message, 160);
        }
        if (['function_call', 'custom_tool_call'].includes(p.type)) { session.lastEvent = `Tool: ${clip(p.name, 70)}`; session.state = 'tool'; }
        if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) { session.lastEvent = 'Tool returned'; session.state = 'working'; }
        if (p.type === 'message' && p.role === 'assistant') session.lastEvent = 'Assistant message';
      }
      if (e.type === 'compacted') { session.compactions++; usageAtCompaction = true; session.lastEvent = 'Context compacted'; }
      if (time && ['event_msg', 'response_item', 'compacted'].includes(e.type)) session.lastActivityAt = time;
    } else {
      // Child log filenames distinguish agents which share the parent sessionId.
      if (e.sessionId && !file.includes(`${path.sep}subagents${path.sep}`)) session.id = `claude:${e.sessionId}`;
      if (e.type === 'ai-title') session.title = clip(e.aiTitle, 160);
      if (e.type === 'system' && e.subtype === 'compact_boundary') { session.compactions++; usageAtCompaction = true; }
      if (e.type === 'user') {
        const content = e.message?.content;
        const isTool = Array.isArray(content) && content.some(c => c.type === 'tool_result');
        session.lastEvent = isTool ? 'Tool returned' : 'User message'; session.state = 'working';
        if (!isTool) { session.turnStartedAt = time; if (!session.title) session.title = clip(typeof content === 'string' ? content : content?.find(c => c.type === 'text')?.text, 160); }
      }
      if (e.type === 'assistant') {
        const m = e.message || {}, u = m.usage;
        session.model = clip(m.model) || session.model;
        const tool = Array.isArray(m.content) && m.content.find(c => c.type === 'tool_use');
        session.lastEvent = tool ? `Tool: ${clip(tool.name, 70)}` : 'Assistant message';
        session.state = tool ? 'tool' : m.stop_reason === 'end_turn' ? 'idle' : 'working';
        if (u) {
          // Claude's input_tokens excludes cache read/creation; Codex includes them.
          const pieces = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens].map(number);
          session.inputTokens = pieces.every(n => n !== null) ? pieces.reduce((a, b) => a + b, 0) : null;
          session.cacheReadTokens = number(u.cache_read_input_tokens); session.cacheWriteTokens = number(u.cache_creation_input_tokens);
          session.outputTokens = number(u.output_tokens); session.usageAt = time; usageAtCompaction = false;
        }
      }
      if (time && ['user', 'assistant', 'progress', 'system'].includes(e.type)) session.lastActivityAt = time;
    }
  }
  if (!projectMatch) return null;
  session.title ||= session.id;
  session.contextEstimate = usageAtCompaction ? null : session.inputTokens;
  session.cachePercent = session.inputTokens > 0 && session.cacheReadTokens !== null && session.cacheReadTokens <= session.inputTokens
    ? 100 * session.cacheReadTokens / session.inputTokens : null;
  return session;
}

async function walkLogs(root, warnings, maxFiles = 10000) {
  const files = [];
  async function walk(dir, depth) {
    if (depth > 5 || files.length >= maxFiles) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (e.code !== 'ENOENT') warnings.push(`Session directory unavailable: ${e.code}`); return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try { const stat = await fs.stat(file); files.push({ file, size: stat.size, mtimeMs: stat.mtimeMs }); } catch { /* rotated */ }
      }
    }
  }
  await walk(root, 0);
  if (files.length >= maxFiles) warnings.push('Session discovery reached the 10,000-file limit.');
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function createReader(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const codexRoot = options.codexRoot === false ? null : options.codexRoot || path.join(os.homedir(), '.codex', 'sessions');
  const claudeRoot = options.claudeRoot === false ? null : options.claudeRoot || path.join(os.homedir(), '.claude', 'projects', root.replace(/[^a-zA-Z0-9-]/g, '-'));
  const sessionCache = new Map();
  const assets = new Map();
  let discovery = null, discoveredAt = 0, discoveryWarnings = [];
  async function sessions(warnings) {
    if (!discovery || Date.now() - discoveredAt > 30000) {
      discovery = [];
      discoveryWarnings = [];
      for (const [provider, dir] of [['codex', codexRoot], ['claude', claudeRoot]]) {
        if (!dir) continue;
        const found = await walkLogs(dir, discoveryWarnings);
        if (!found.length) discoveryWarnings.push(`${provider}: no local session logs found.`);
        discovery.push(...found.slice(0, 100).map(f => ({ ...f, provider })));
        if (found.length > 100) discoveryWarnings.push(`${provider}: observing the 100 most recently modified log files.`);
      }
      discoveredAt = Date.now();
      const keep = new Set(discovery.map(d => d.file));
      for (const file of sessionCache.keys()) if (!keep.has(file)) sessionCache.delete(file);
    }
    warnings.push(...discoveryWarnings);
    const result = [];
    for (const entry of discovery) {
      try {
        const stat = await fs.stat(entry.file);
        const key = `${stat.size}:${stat.mtimeMs}`;
        let cached = sessionCache.get(entry.file);
        if (!cached || cached.key !== key) {
          const { records, partial } = await logWindows(entry.file, stat.size);
          cached = { key, session: parseSession(entry.provider, records, entry.file, partial, root) };
          sessionCache.set(entry.file, cached);
        }
        if (cached.session) result.push({ ...cached.session });
      } catch (e) { warnings.push(`${entry.provider}: could not read a session log (${e.code || e.message}).`); }
    }
    return result.sort((a, b) => (b.lastActivityAt || '').localeCompare(a.lastActivityAt || '')).slice(0, 40);
  }
  async function runs(warnings) {
    const result = [];
    for (const directory of ['scratch/runs', 'ops/runs']) {
      let entries;
      try { entries = await fs.readdir(path.join(root, directory), { withFileTypes: true }); }
      catch (e) { if (e.code !== 'ENOENT') warnings.push(`${directory}: ${e.code}`); continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const relative = `${directory}/${entry.name}`;
        try {
          const file = await safeFile(root, `${relative}/result.json`);
          if (!file) continue;
          const r = JSON.parse(await readText(file, MB));
          if (!r || typeof r !== 'object' || typeof r.candidateId !== 'string' || !date(r.startedAt)) throw new Error('candidateId and ISO startedAt are required');
          const allowed = ['passed', 'failed', 'timeout', 'harness-error', 'running', 'unknown'];
          if (!allowed.includes(r.outcome)) throw new Error('invalid outcome');
          const run = { id: entry.name, key: relative, source: directory, candidateId: r.candidateId, taskId: clip(r.taskId),
            startedAt: date(r.startedAt), finishedAt: date(r.finishedAt), outcome: r.outcome, route: clip(r.route),
            command: clip(r.command, 4000), build: clip(typeof r.build === 'string' ? r.build : JSON.stringify(r.build || {}), 2000),
            environment: clip(typeof r.environment === 'string' ? r.environment : JSON.stringify(r.environment || {}), 1000),
            summary: clip(r.summary, 2000), verification: r.verification === 'reviewed' ? 'reviewed' : 'unreviewed',
            screenshots: [], artifacts: [] };
          const names = new Set(['result.json', 'output.log']);
          for (const value of [r.screenshot, ...(Array.isArray(r.screenshots) ? r.screenshots : []), ...(Array.isArray(r.artifacts) ? r.artifacts : [])]) {
            if (typeof value === 'string') names.add(value);
          }
          for (const name of names) {
            if (!/\.(png|jpe?g|webp|json|txt|log)$/i.test(name)) continue;
            const file = await safeFile(path.join(root, relative), name);
            if (!file || !inside(await fs.realpath(root), file)) { if (name !== 'output.log') warnings.push(`${relative}: missing or unsafe artifact ${clip(name)}`); continue; }
            const key = `${relative}/${name}`;
            assets.set(key, { root: path.join(root, relative), name });
            const artifact = { name, url: `/artifact?key=${encodeURIComponent(key)}` };
            run.artifacts.push(artifact);
            if (/\.(png|jpe?g|webp)$/i.test(name)) run.screenshots.push(artifact);
          }
          result.push(run);
        } catch (e) { warnings.push(`${relative}/result.json: ${e.message}`); }
      }
    }
    return result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async function snapshot() {
    assets.clear();
    const warnings = [], sources = [];
    let candidates = [], todo = '', activity = [];
    try {
      const manifest = JSON.parse(await readText(path.join(root, 'test/candidate-corpus/manifest.json')));
      if (!Array.isArray(manifest.candidates)) throw new Error('candidates must be an array');
      candidates = manifest.candidates.filter(c => c && typeof c.id === 'string').map(c => ({
        id: c.id, name: clip(c.name), version: clip(c.version), kind: clip(c.kind), notes: clip(c.notes, 4000),
        executables: Array.isArray(c.executables) ? c.executables.filter(v => typeof v === 'string') : [], localOnly: !!c.localOnly,
        sourcePage: typeof c.sourcePage === 'string' && /^https?:\/\//.test(c.sourcePage) ? c.sourcePage : null,
        fixture: c.fixture || c.id, fixtureStatus: 'unknown', noteLinks: [] }));
      const assetRoot = typeof manifest.assetRoot === 'string' ? manifest.assetRoot : 'test/binaries/candidates';
      for (const c of candidates) {
        const existing = await Promise.all(c.executables.map(e => safeFile(root, `${assetRoot}/${c.fixture}/${e}`)));
        c.fixtureStatus = !existing.length ? 'unknown' : existing.every(Boolean) ? 'present' : existing.some(Boolean) ? 'partial' : 'missing';
        const notes = new Set([`docs/re-notes/${c.id}.md`, ...(c.notes.match(/docs\/re-notes\/[a-zA-Z0-9._-]+\.md/g) || [])]);
        for (const note of notes) if (await safeFile(root, note)) c.noteLinks.push({ name: note, url: `/source?path=${encodeURIComponent(note)}` });
      }
      sources.push('test/candidate-corpus/manifest.json');
    } catch (e) { warnings.push(`Candidate manifest: ${e.message}`); }
    try { todo = await readText(path.join(root, 'TODOS.md')); sources.push('TODOS.md'); }
    catch (e) { warnings.push(`TODOS.md: ${e.code || e.message}`); }
    try {
      const file = path.join(root, 'messageboard.txt'), stat = await fs.stat(file);
      const start = Math.max(0, stat.size - 256 * 1024);
      let tail = await windowText(file, start, Math.min(stat.size, 256 * 1024));
      if (start) tail = tail.slice(tail.indexOf('\n') + 1);
      activity = tail.split(/\r?\n/).filter(l => l.trim()).slice(-150).reverse().map(text => ({ text: text.slice(0, 12000), source: 'messageboard.txt' }));
      sources.push('messageboard.txt (latest 150 entries)');
    } catch (e) { warnings.push(`messageboard.txt: ${e.code || e.message}`); }
    const tasks = parseTasks(todo, candidates);
    const [runList, agents] = await Promise.all([runs(warnings), sessions(warnings)]);
    for (const run of runList) if (!candidates.some(c => c.id === run.candidateId)) warnings.push(`${run.key}: candidate ${run.candidateId} is not in the manifest.`);
    for (const a of agents) {
      const task = tasks.find(t => t.owner === a.id && t.status === 'active');
      if (task) { a.taskId = task.id; a.taskTitle = task.title; a.taskStartedAt = task.startedAt; a.progressAt = task.progressAt; }
    }
    for (const c of candidates) {
      c.taskIds = tasks.filter(t => t.candidateIds.includes(c.id)).map(t => t.id);
      const matching = runList.filter(r => r.candidateId === c.id);
      c.latestRun = matching[0] || null;
      c.lastVerifiedRun = matching.find(r => r.outcome === 'passed' && r.verification === 'reviewed') || null;
    }
    return { generatedAt: new Date().toISOString(), root, tasks, candidates, runs: runList, agents, activity,
      sources, warnings: [...new Set(warnings)], todoText: todo,
      telemetryNote: 'Local log observations; process health and progress are unknown unless explicitly recorded. Last-request input is a context estimate, not live occupancy. Session tails may be partial.' };
  }
  async function artifact(key) {
    const value = assets.get(key);
    const file = value ? await safeFile(value.root, value.name) : null;
    return file && inside(await fs.realpath(root), file) ? file : null;
  }
  return { root, snapshot, artifact };
}

module.exports = { createReader, parseTasks, parseSession, safeFile, logWindows };
