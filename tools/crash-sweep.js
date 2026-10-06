#!/usr/bin/env node
// Which registry apps crash on launch, and on what?
//
// One short headless run per lib/apps.js id, strictly one at a time, each
// classified from run.js's own output into a crash *signature*:
//
//   unimpl:<API>      an API handler hit $crash_unimplemented
//   trap:<message>    a WASM trap / JS exception escaped a batch (*** CRASH)
//   error:<message>   run.js died before or outside the batch loop
//   timeout           the run outlived --seconds + grace (a batch never returned)
//   exit:<code>       the guest called ExitProcess before the deadline
//   stuck             run.js's idle detector ended the run (waiting on input)
//   ok                still running at the deadline
//
// The summary ranks signatures by how many apps share them, which is the work
// list: one missing API that stops nine apps is worth more than nine bespoke
// traps. startup-modal-sweep.js answers a different question (what is behind
// the first message box) and runs each app twice; this runs each once.
//
// Results are appended to --jsonl as each run finishes, so an interrupted
// sweep resumes where it stopped (ids already in the file are skipped).
//
// Usage:
//   node tools/crash-sweep.js --all --jsonl=out.jsonl [--seconds=20]
//   node tools/crash-sweep.js --apps=a,b --jsonl=out.jsonl
//   node tools/crash-sweep.js --summary --jsonl=out.jsonl [--md]
//
// Options:
//   --seconds=N      run.js --max-seconds (default 20); the external kill is N+90
//   --rerun          ignore ids already in --jsonl
//   --no-build       reuse build/wine-assembly.wasm (the sweep builds once first otherwise)
//   --md             print the summary as a Markdown table
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'test', 'run.js');

const argv = process.argv.slice(2);
const flag = name => argv.includes('--' + name);
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

const SECONDS = parseFloat(opt('seconds', '20')) || 20;
const JSONL = opt('jsonl', null);
if (!JSONL) {
  console.error('crash-sweep: --jsonl=FILE is required');
  process.exit(2);
}

function readResults() {
  if (!fs.existsSync(JSONL)) return [];
  return fs.readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// Pull the signature out of a run's combined output. Order matters: an
// unimplemented API traps with `unreachable` too, and the API name is the
// useful half of that pair.
function classify(log, status, timedOut) {
  const unimpl = /=== UNIMPLEMENTED API: (.+?) ===/.exec(log);
  if (unimpl) {
    const ord = /ordinal import: (.+)/.exec(log);
    return { sig: `unimpl:${unimpl[1]}${ord ? ' ' + ord[1].trim() : ''}` };
  }
  const crash = /\*\*\* CRASH at batch (\d+): (.+)/.exec(log);
  if (crash) {
    const eip = /EIP before batch: (.+)/.exec(log);
    return {
      sig: `trap:${crash[2].trim().slice(0, 80)}`,
      batch: +crash[1],
      eip: eip ? eip[1].trim().slice(0, 80) : null,
    };
  }
  if (timedOut) return { sig: 'timeout' };
  const stuck = /STUCK at EIP=(0x[0-9a-f]+) after (\d+) batches/.exec(log);
  if (stuck) return { sig: 'stuck', eip: stuck[1] };
  const exit = /\[Exit\] code=(\S+)/.exec(log);
  if (exit) return { sig: `exit:${exit[1]}` };
  if (status !== 0) {
    const err = /^(?:\w*Error|Error)[: ].*$/m.exec(log) || /^.*(?:ENOENT|Cannot find|not found).*$/m.exec(log);
    return { sig: `error:${(err ? err[0] : `status ${status}`).trim().slice(0, 100)}` };
  }
  return { sig: 'ok' };
}

const LOG_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'crash-sweep-'));

function headTail(file, n) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const read = (pos, len) => {
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, pos);
    return b.toString('utf8');
  };
  const out = size <= 2 * n ? read(0, size) : read(0, n) + '\n' + read(size - n, n);
  fs.closeSync(fd);
  return out;
}

function runOne(id) {
  const args = [RUN, `--app=${id}`, '--no-build', '--quiet-api',
    `--max-seconds=${SECONDS}`, '--max-batches=1000000000'];
  // run.js prints a register line per batch, so a healthy 20 s run is ~100 MB:
  // send it to a file and read back only the head and tail, which is where
  // every line classify() looks for lives.
  const logFile = path.join(LOG_DIR, `${id}.log`);
  const fd = fs.openSync(logFile, 'w');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, stdio: ['ignore', fd, fd], timeout: (SECONDS + 90) * 1000, killSignal: 'SIGKILL',
  });
  fs.closeSync(fd);
  const log = headTail(logFile, 256 * 1024);
  fs.unlinkSync(logFile);
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  const out = { id, ...classify(log, r.status, timedOut), secs: +((Date.now() - t0) / 1000).toFixed(1) };
  const batches = [...log.matchAll(/(\d+) batches in /g)].pop();
  if (batches) out.batches = +batches[1];
  const apis = /Stats: (\d+) API calls/.exec(log);
  if (apis) out.apis = +apis[1];
  return out;
}

function summary(results, md) {
  const bySig = new Map();
  for (const r of results) {
    const key = r.sig.startsWith('exit:') ? r.sig : r.sig;
    if (!bySig.has(key)) bySig.set(key, []);
    bySig.get(key).push(r.id);
  }
  const rows = [...bySig].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (md) {
    console.log('| # | signature | apps |');
    console.log('|---:|---|---|');
    for (const [sig, ids] of rows) console.log(`| ${ids.length} | \`${sig.replace(/\|/g, '\\|')}\` | ${ids.join(', ')} |`);
  } else {
    for (const [sig, ids] of rows) console.log(`${String(ids.length).padStart(4)}  ${sig}\n      ${ids.join(' ')}`);
  }
}

if (flag('summary')) {
  summary(readResults(), flag('md'));
  process.exit(0);
}

const { APPS } = require('../lib/apps');
let ids = flag('all') ? Object.keys(APPS)
  : (opt('apps', '') || '').split(',').filter(Boolean);
const unknown = ids.filter(id => !APPS[id]);
if (unknown.length) {
  console.error(`crash-sweep: unknown app id(s): ${unknown.join(', ')}`);
  process.exit(2);
}
if (!flag('rerun')) {
  const done = new Set(readResults().map(r => r.id));
  ids = ids.filter(id => !done.has(id));
}
if (!flag('no-build')) execFileSync('bash', [path.join(ROOT, 'tools', 'build.sh')], { cwd: ROOT, stdio: 'ignore' });

for (const id of ids) {
  const r = runOne(id);
  fs.appendFileSync(JSONL, JSON.stringify(r) + '\n');
  console.log(`${id}  ${r.sig}  ${r.secs}s${r.batches != null ? '  b=' + r.batches : ''}`);
}
fs.rmSync(LOG_DIR, { recursive: true, force: true });
