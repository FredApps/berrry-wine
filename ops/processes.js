'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const exec = promisify(execFile);
// Claude's procStart is a UTC ps-style string; normalize ps to UTC too.
const run = async (command, args) => (await exec(command, args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } })).stdout;

function parseProcesses(text) {
  return text.split('\n').flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(?:(\d+(?:\.\d+)?)\s+(\d+)\s+)?(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+?)\s*$/);
    return m ? [{ pid: +m[1], ppid: +m[2], state: m[3], elapsed: m[4], cpuPercent: m[5] === undefined ? null : +m[5], rssBytes: m[6] === undefined ? null : +m[6] * 1024, started: m[7].replace(/\s+/g, ' '), name: path.basename(m[8]) }] : [];
  });
}
function parseOpenFiles(text) {
  const files = new Map(); let pid;
  for (const line of text.split('\n')) {
    if (/^p\d+$/.test(line)) pid = +line.slice(1);
    else if (line.startsWith('n/') && pid) {
      const file = line.slice(1);
      if (!files.has(file)) files.set(file, new Set());
      files.get(file).add(pid);
    }
  }
  return files;
}
function associate(agents, processes, files, registry, checkedAt, error = null) {
  const live = new Map(processes.map(p => [p.pid, p]));
  const result = new Map();
  for (const a of agents) {
    const matches = new Map();
    for (const pid of files.get(a.logFile) || []) {
      const p = live.get(pid);
      if (p?.name === a.provider) matches.set(pid, { ...p, evidence: 'Open session log' });
    }
    if (a.provider === 'claude') {
      const parent = a.logFile.includes(`${path.sep}subagents${path.sep}`) ? path.basename(path.dirname(path.dirname(a.logFile))) : null;
      for (const r of registry) {
        const p = live.get(r.pid);
        if (p?.name !== 'claude' || !registryMatchesProcess(r, p)) continue;
        if (`claude:${r.sessionId}` === a.id || (parent && r.sessionId === parent)) {
          matches.set(p.pid, { ...p, evidence: parent ? 'Parent session host (shared)' : 'Claude session registry + process start', shared: !!parent });
        }
      }
    }
    const descendants = new Set(matches.keys());
    // Include only descendants of an identified host; no cwd/title matching.
    for (let depth = 0; depth < 16; depth++) {
      let changed = false;
      for (const p of processes) if (!descendants.has(p.pid) && descendants.has(p.ppid)) { descendants.add(p.pid); changed = true; }
      if (!changed) break;
    }
    const children = processes.filter(p => descendants.has(p.pid) && !matches.has(p.pid));
    const sum = key => children.every(p => Number.isFinite(p[key])) ? children.reduce((total, p) => total + p[key], 0) : null;
    result.set(a, { status: matches.size ? 'observed' : error ? 'unavailable' : 'unmatched', checkedAt,
      matches: [...matches.values()], children: children.sort((a,b) => (b.cpuPercent || 0) - (a.cpuPercent || 0) || (b.rssBytes || 0) - (a.rssBytes || 0)).slice(0, 40), childCount: children.length,
      childCpuPercent: sum('cpuPercent'), childRssBytes: sum('rssBytes'), note: error });
  }
  const owners = new Map();
  for (const [a, observation] of result) for (const p of observation.matches) {
    if (!owners.has(p.pid)) owners.set(p.pid, new Set());
    owners.get(p.pid).add(a.id);
  }
  for (const observation of result.values()) for (const p of observation.matches) p.shared ||= owners.get(p.pid).size > 1;
  return result;
}

// New Claude Linux registries use /proc start ticks and a machine/namespace
// domain, rather than the macOS ps date. Validate both, never PID alone.
function registryMatchesProcess(r,p) {
  if(typeof r.procStart!=='string')return false;
  if(r.pidDomain===process.platform)return r.procStart.replace(/\s+/g,' ').trim()===p.started;
  return typeof p.pidDomain==='string' && p.pidDomain.startsWith('linux:') &&
    r.pidDomain===p.pidDomain && /^\d+$/.test(r.procStart) && r.procStart===p.startTicks &&
    // Registration happens after interactive trust/setup, possibly much later
    // than process creation. It must not predate this process or be in future.
    Number.isFinite(r.startedAt) && r.startedAt>=Date.parse(p.started+' UTC')-1000 && r.startedAt<=Date.now()+2000;
}
function linuxStartTicks(stat) {
  // comm may contain spaces or parentheses; field 22 is index 19 after it.
  const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
  return /^\d+$/.test(fields[19]||'')?fields[19]:null;
}

function createProcessObserver(options = {}) {
  let cached, pending;
  const registryRoot = options.claudeRegistryRoot || path.join(os.homedir(), '.claude', 'sessions');
  async function probe() {
    const checkedAt = new Date().toISOString();
    try {
      const processes = parseProcesses(await run('ps', ['-axww', '-o', 'pid=,ppid=,stat=,etime=,%cpu=,rss=,lstart=,comm=']));
      if (!processes.length) throw new Error('empty process table');
      const providers = processes.filter(p => ['codex', 'claude'].includes(p.name)).slice(0, 128);
      if(process.platform==='linux') {
        try {
          const machine=(await fs.readFile('/etc/machine-id','utf8')).trim();
          const namespace=await fs.readlink('/proc/self/ns/pid');
          const domain=`linux:${machine}:${namespace}`;
          await Promise.all(providers.filter(p=>p.name==='claude').map(async p=>{
            try{p.startTicks=linuxStartTicks(await fs.readFile(`/proc/${p.pid}/stat`,'utf8'));p.pidDomain=domain;}catch{}
          }));
        }catch{ /* Missing kernel identity is unknown, never a PID-only match. */ }
      }
      let files = new Map(), note = null;
      const registry = [];
      await Promise.all([
        (async () => {
          if (!providers.length) return;
          try { files = parseOpenFiles(await run('lsof', ['-nP', '-a', '-p', providers.map(p => p.pid).join(','), '-Fpn'])); }
          catch { note = 'Open-file inspection unavailable; unmatched PIDs remain unknown.'; }
        })(),
        ...providers.filter(p => p.name === 'claude').map(async p => {
          try {
            const file = path.join(registryRoot, `${p.pid}.json`);
            if ((await fs.stat(file)).size > 64 * 1024) return;
            const r = JSON.parse(await fs.readFile(file, 'utf8'));
            if (r.pid === p.pid) registry.push({ pid: r.pid, sessionId: r.sessionId, procStart: r.procStart, pidDomain: r.pidDomain, startedAt:r.startedAt });
          } catch { /* Registry is optional and may disappear on exit. */ }
        }),
      ]);
      return { processes, files, registry, checkedAt, error: note };
    } catch { return { processes: [], files: new Map(), registry: [], checkedAt, error: 'Local process inspection unavailable or timed out.' }; }
  }
  return async agents => {
    if (options.processes === false) return new Map(agents.map(a => [a, { status: 'unavailable', matches: [], children: [], childCount: 0, checkedAt: null, note: 'Process observation disabled.' }]));
    if (!cached || Date.now() - Date.parse(cached.checkedAt) >= 10000) {
      if (!pending) pending = (options.processProbe || probe)().then(value => { cached = value; }).finally(() => { pending = null; });
      await pending;
    }
    return associate(agents, cached.processes, cached.files, cached.registry, cached.checkedAt, cached.error);
  };
}

module.exports = { createProcessObserver, parseProcesses, parseOpenFiles, associate, registryMatchesProcess, linuxStartTicks };
