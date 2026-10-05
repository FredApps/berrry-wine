'use strict';

const { execFile } = require('node:child_process');

function timestamp(value) {
  if (typeof value !== 'string') return null;
  value = value.replace(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, '$1:00$2');
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (+month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate() || +hour > 23 || +minute > 59 || +second > 59) return null;
  const time = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function boardEntry(text) {
  const match = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))(?=\s|\])/.exec(text);
  return { type: 'message', text: text.slice(0, 12000), source: 'messageboard.txt', time: timestamp(match?.[1]) };
}

function githubBase(remote) {
  // Reject credentials, query strings, ports and lookalike hosts; never return raw remote text.
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote.trim());
  if (!match || [match[1], match[2]].some(part => part === '.' || part === '..')) return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

const ID_PATTERN = /\b[A-Z][A-Z0-9_]*(?:[-.][A-Z0-9_]+)+\b/g;
function parseCommits(output, base, withBody = false) {
  const width = withBody ? 5 : 4, fields = output.split('\0'), seen = new Set(), entries = [];
  for (let i = 0; i + width - 1 < fields.length; i += width) {
    const [hash, author, stamp, subject, body = ''] = fields.slice(i, i + width);
    const time = timestamp(stamp);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash) || !time || seen.has(hash)) continue;
    seen.add(hash);
    entries.push({ type: 'commit', id: hash, hash, shortHash: hash.slice(0, 8),
      author: author.slice(0, 200), subject: subject.slice(0, 2000), time,
      text: `${hash.slice(0, 8)} ${subject.slice(0, 2000)}`, source: 'git',
      // Uppercase task-like IDs named in the message; readers keeps only real task IDs.
      ids: [...new Set(`${subject}\n${body.slice(0, 8000)}`.match(ID_PATTERN) || [])].slice(0, 20),
      ...(base ? { url: `${base}/commit/${hash}` } : {}) });
  }
  return entries;
}

// Where each listed commit is, from local refs only (no fetch, no network):
// on the remote default branch (merged), on another remote branch (pushed), or
// local only. Remote refs are as fresh as the last fetch, which is reported.
async function codeState(git, commits, stat) {
  const head = (await git(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']).catch(() => '')).trim().replace(/^refs\/remotes\//, '');
  const mainRef = head || 'origin/main';
  const hasMain = await git(['rev-parse', '--verify', '-q', mainRef + '^{commit}']).then(() => true, () => false);
  const CAP = 20000;
  const list = async args => (await git(['rev-list', `--max-count=${CAP}`, ...args]).catch(() => '')).split('\n').filter(Boolean);
  const [mainList, remoteList] = await Promise.all([hasMain ? list([mainRef]) : [], list(['--remotes'])]);
  const mainSet = new Set(mainList), remoteSet = new Set(remoteList);
  const ancestor = (hash, ref) => git(['merge-base', '--is-ancestor', hash, ref]).then(() => true, () => false);
  let fetchedAt = null;
  try { fetchedAt = (await stat((await git(['rev-parse', '--git-path', 'FETCH_HEAD'])).trim())).mtime.toISOString(); } catch {}
  let branchLookups = 0;
  for (const commit of commits) {
    // A capped rev-list is not proof of absence; fall back to the exact ancestry check.
    const onMain = hasMain && (mainSet.has(commit.hash) || (mainList.length >= CAP && await ancestor(commit.hash, mainRef)));
    let pushed = onMain || remoteSet.has(commit.hash);
    let branches = [];
    if (!onMain && (pushed || remoteList.length >= CAP) && branchLookups++ < 40) {
      branches = (await git(['branch', '-r', '--contains', commit.hash, '--format=%(refname:short)']).catch(() => ''))
        .split('\n').map(x => x.trim()).filter(x => x && !/\/HEAD$/.test(x)).slice(0, 5);
      pushed = pushed || branches.length > 0;
    }
    commit.code = { onMain, pushed, branches, state: onMain ? 'merged' : pushed ? 'pushed' : 'local' };
  }
  return { available: true, mainRef: hasMain ? mainRef : null, fetchedAt,
    note: 'From local remote-tracking refs as of the last fetch; the dashboard never fetches or calls GitHub.' };
}

// Tie commits to tasks (an exact task ID in the commit message) and to runs
// (a run's recorded build.commit is this commit). Nothing else is inferred.
function linkCommits(commits, tasks, runs) {
  const taskIds = new Set(tasks.map(t => t.id).filter(Boolean));
  const runCommit = run => { try { const c = JSON.parse(run.build || '{}')?.commit; return typeof c === 'string' && /^[0-9a-f]{7,40}$/.test(c) ? c : null; } catch { return null; } };
  const recorded = runs.map(run => [runCommit(run), run]).filter(([c]) => c);
  for (const commit of commits) {
    commit.taskIds = (commit.ids || []).filter(id => taskIds.has(id));
    commit.runs = recorded.filter(([c]) => commit.hash.startsWith(c)).slice(0, 10)
      .map(([, run]) => ({ key: run.key, outcome: run.outcome, verification: run.verification, route: run.route }));
  }
  for (const task of tasks) task.commits = commits.filter(c => c.taskIds.includes(task.id)).slice(0, 10)
    .map(c => ({ hash: c.hash, shortHash: c.shortHash, subject: c.subject, time: c.time, url: c.url, code: c.code, runs: c.runs }));
}

function mergeActivity(messages, commits) {
  return [...messages, ...commits].map((entry, index) => ({ entry, index }))
    .sort((a, b) => (Date.parse(b.entry.time) || 0) - (Date.parse(a.entry.time) || 0) || a.index - b.index)
    .slice(0, 300).map(item => item.entry);
}

function createActivityReader(root, options = {}) {
  const run = options.execFile || execFile;
  const now = options.now || Date.now;
  let cached = null, expires = 0, pending = null;
  function git(args) {
    return new Promise((resolve, reject) => {
      run(options.git || 'git', ['-C', root, ...args], {
        encoding: 'utf8', timeout: 2500, maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
  }
  return async function readActivity(messages) {
    if (!cached || now() >= expires) {
      if (!pending) pending = (async () => {
        try {
          const [log, remote] = await Promise.all([
            git(['log', '--all', '--max-count=150', '--date-order', '-z', '--format=%H%x00%an%x00%cI%x00%s%x00%b']),
            git(['config', '--get', 'remote.origin.url']).catch(() => ''),
          ]);
          const commits = parseCommits(log, githubBase(remote), true);
          let code;
          try { code = await codeState(git, commits, options.stat || (file => require('node:fs/promises').stat(require('node:path').resolve(root, file)))); }
          catch { code = { available: false, mainRef: null, fetchedAt: null, note: 'Commit location unavailable.' }; }
          cached = { commits, code, warning: null };
        } catch (error) {
          cached = { commits: [], code: { available: false, mainRef: null, fetchedAt: null, note: 'Git unavailable.' }, warning: `Git activity unavailable (${typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'git failed'}).` };
        }
        expires = now() + 30000;
      })().finally(() => { pending = null; });
      await pending;
    }
    return { activity: mergeActivity(messages, cached.commits), commits: cached.commits, code: cached.code, warning: cached.warning };
  };
}

module.exports = { createActivityReader, boardEntry, githubBase, timestamp, parseCommits, mergeActivity, codeState, linkCommits };
