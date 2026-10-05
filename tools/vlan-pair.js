#!/usr/bin/env node
// Run two (or more) emulator processes on one virtual LAN segment.
//
//   node tools/vlan-pair.js [--log-dir=DIR] [--grep=REGEX] [--stagger-ms=N]
//        -- <test/run.js args for seat 10.0.0.1>
//        -- <test/run.js args for seat 10.0.0.2>  [-- ...]
//
//   fork run.js #1 --vlan-wire --vlan-ip=10.0.0.1 ─┐
//                                                  ├─ ProcessHub relays vln/1 frames
//   fork run.js #2 --vlan-wire --vlan-ip=10.0.0.2 ─┘
//
// Every seat's whole output goes to DIR/seat-N.log (default: a fresh directory
// under $TMPDIR). Only lines matching --grep are echoed, tagged `[.N]`, so a
// run with --trace-net on both sides stays readable. Exits when every seat
// has exited, with the worst exit code; Ctrl-C stops them all.
//
// The seats are ordinary run.js command lines, so each one keeps its own
// --max-seconds guard and its own --input schedule. The host is always the
// first `--` group: the room gives seat .1 to the host, and so should a test.
//
// This is the generic form of the spawn/ProcessHub pair every two-process
// vlan test used to write for itself (test-ut2003-vlan-candidate.js,
// test-vlan-tetrinet.js). Reach for it to try a new multiplayer game by hand
// before writing its test.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { ProcessHub } = require('../lib/vlan-wire');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'test', 'run.js');

function parse(argv) {
  const opts = { logDir: null, grep: null, staggerMs: 0 };
  const groups = [];
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const a = argv[i];
    let m;
    if ((m = /^--log-dir=(.+)$/.exec(a))) opts.logDir = m[1];
    else if ((m = /^--grep=(.+)$/.exec(a))) opts.grep = new RegExp(m[1]);
    else if ((m = /^--stagger-ms=(\d+)$/.exec(a))) opts.staggerMs = Number(m[1]);
    else throw new Error(`unknown option ${a} (seat arguments go after --)`);
  }
  for (; i < argv.length; i++) {
    if (argv[i] === '--') { groups.push([]); continue; }
    groups[groups.length - 1].push(argv[i]);
  }
  if (groups.length < 2) throw new Error('need at least two `--` seat groups');
  return { opts, groups };
}

async function main() {
  const { opts, groups } = parse(process.argv.slice(2));
  const logDir = opts.logDir ||
    fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vlan-pair-'));
  fs.mkdirSync(logDir, { recursive: true });
  console.log(`vlan-pair: ${groups.length} seats, logs in ${logDir}`);

  const hub = new ProcessHub();
  const seats = [];
  for (let n = 0; n < groups.length; n++) {
    if (n && opts.staggerMs) await new Promise(r => setTimeout(r, opts.staggerMs));
    const ip = `10.0.0.${n + 1}`;
    const args = [...groups[n], '--vlan-wire', `--vlan-ip=${ip}`];
    const child = fork(RUN, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const logPath = path.join(logDir, `seat-${n + 1}.log`);
    const fd = fs.openSync(logPath, 'w');
    fs.writeSync(fd, `# node test/run.js ${args.join(' ')}\n`);
    const seat = { n: n + 1, child, fd, logPath, code: null, done: null, partial: '' };
    const onData = chunk => {
      fs.writeSync(fd, chunk);
      if (!opts.grep) return;
      const text = seat.partial + chunk.toString();
      const lines = text.split('\n');
      seat.partial = lines.pop();
      for (const line of lines) if (opts.grep.test(line)) console.log(`[.${seat.n}] ${line}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    seat.done = new Promise(resolve => child.on('exit', (code, signal) => {
      seat.code = code == null ? 128 : code;
      fs.closeSync(fd);
      console.log(`[.${seat.n}] exited code=${code} signal=${signal || 'none'} (${logPath})`);
      resolve();
    }));
    hub.add(child);
    seats.push(seat);
  }

  const stopAll = () => { for (const s of seats) if (s.code == null) s.child.kill('SIGTERM'); };
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  await Promise.all(seats.map(s => s.done));
  process.exit(Math.max(...seats.map(s => s.code)));
}

main().catch(err => { console.error(`vlan-pair: ${err.message}`); process.exit(2); });
