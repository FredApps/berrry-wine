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

function parseCommits(output, base) {
  const fields = output.split('\0'), seen = new Set(), entries = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [hash, author, stamp, subject] = fields.slice(i, i + 4);
    const time = timestamp(stamp);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash) || !time || seen.has(hash)) continue;
    seen.add(hash);
    entries.push({ type: 'commit', id: hash, hash, shortHash: hash.slice(0, 8),
      author: author.slice(0, 200), subject: subject.slice(0, 2000), time,
      text: `${hash.slice(0, 8)} ${subject.slice(0, 2000)}`, source: 'git',
      ...(base ? { url: `${base}/commit/${hash}` } : {}) });
  }
  return entries;
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
            git(['log', '--all', '--max-count=150', '--date-order', '-z', '--format=%H%x00%an%x00%cI%x00%s']),
            git(['config', '--get', 'remote.origin.url']).catch(() => ''),
          ]);
          cached = { commits: parseCommits(log, githubBase(remote)), warning: null };
        } catch (error) {
          cached = { commits: [], warning: `Git activity unavailable (${typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'git failed'}).` };
        }
        expires = now() + 30000;
      })().finally(() => { pending = null; });
      await pending;
    }
    return { activity: mergeActivity(messages, cached.commits), warning: cached.warning };
  };
}

module.exports = { createActivityReader, boardEntry, githubBase, timestamp, parseCommits, mergeActivity };
