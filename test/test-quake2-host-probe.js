#!/usr/bin/env node
// Does the host probe tell a real Quake II server from a real client?
//
//   node test/test-quake2-host-probe.js
//
// The shell only offers a room on the Join card while the owner's game is
// SERVING, and the wire cannot say so on its own: a Quake II client binds the
// server port 27910 exactly as a server does. lib/vlan-star.js's HostProbe asks
// the way a player's server browser would -- the `hostProbe` query from
// lib/apps.js, from a seat nobody holds -- and this runs it against the real
// game, one emulator process per case, with this test standing in for the rest
// of the room:
//
//   server  +set deathmatch 1 +set maxclients 4 +map demo1   must answer, with
//                                                             its status line
//   client  +connect 10.0.0.1  (nobody there)                 must stay silent --
//           its 27910 socket is bound and never read, so the question is also
//           a check that an unread socket does not freeze its wire (the client
//           keeps sending its own getchallenge the whole time)

'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Wire } = require('../lib/vlan-wire');
const { HostProbe } = require('../lib/vlan-star');
const { APPS } = require('../lib/apps');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'scratch', 'quake2-host-probe');
const EXE = path.join(ROOT, 'test', 'binaries', 'candidates', 'quake-2-demo-installer',
  'installed-extracted', 'Install', 'Data', 'quake2.exe');
const BUDGET_S = 150;

if (!fs.existsSync(EXE)) {
  console.log('SKIP  Quake II demo not installed at', EXE);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

// The emulator's side of the room is its ProcessWire: frames arrive here as
// IPC messages. This Wire is that process's guest as the probe sees it --
// deliver() hands a frame to the guest, and whatever the guest sends comes back
// through intercept(), which the probe owns.
class ChildGuest extends Wire {
  constructor(child, address) {
    super();
    this.child = child;
    this.address = address;
    this.intercept = null;
    this.fromGuest = 0;
    child.on('message', msg => {
      if (!msg || msg.t !== 'vln') return;
      this.fromGuest++;
      const bytes = Uint8Array.from(Buffer.from(msg.d, 'base64'));
      if (this.intercept) this.intercept(bytes);
    });
  }
  deliver(bytes) {
    if (this.child.connected) this.child.send({ t: 'vln', d: Buffer.from(bytes).toString('base64') });
  }
}

function runCase(name, args) {
  const log = fs.createWriteStream(path.join(OUT, `${name}.log`));
  const child = fork(path.join(ROOT, 'test', 'run.js'), [
    '--app=quake2_demo', `--args=+set vid_ref soft ${args}`,
    '--quiet-api', '--quiet-blocks', '--trace-net',
    '--vlan-wire', '--vlan-ip=10.0.0.1',
    '--batch-size=20000', '--max-batches=100000000', `--max-seconds=${BUDGET_S}`,
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const guest = new ChildGuest(child, '10.0.0.1');
  const result = { name, hosting: null, asked: 0, guest };
  const probe = new HostProbe(guest, APPS.quake2_demo.lan.hostProbe, h => {
    if (h) result.hosting = h;
  });
  const ask = setInterval(() => { result.asked++; probe.ask(); }, 2000);
  return new Promise(resolve => {
    const finish = () => {
      clearInterval(ask);
      probe.stop();
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve(result);
    };
    const poll = setInterval(() => {
      if (result.hosting) { clearInterval(poll); finish(); }
    }, 250);
    child.on('exit', () => { clearInterval(poll); finish(); });
  });
}

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

(async () => {
  const [server, client] = await Promise.all([
    runCase('server', '+set deathmatch 1 +set maxclients 4 +map demo1'),
    runCase('client', '+connect 10.0.0.1'),
  ]);
  check(`a serving Quake II answers the probe (${server.hosting ? `"${server.hosting.label}"` : 'no answer'}, ${server.asked} questions)`,
    !!server.hosting && /demo1/.test(server.hosting.label),
    `see ${path.join(OUT, 'server.log')}`);
  check(`a Quake II client never answers it (${client.asked} questions)`, !client.hosting && client.asked > 10,
    client.hosting ? `answered "${client.hosting.label}"` : 'the run ended before the probe could ask');
  // getchallenge (17 bytes) repeats while nobody answers. If an unread 27910
  // datagram froze the client's wire it would not matter here -- sends do not
  // queue behind receives -- so what this shows is the guest kept running.
  check(`the client kept talking while being probed (${client.guest.fromGuest} frames)`,
    client.guest.fromGuest > 10);
  console.log(failures ? `test-quake2-host-probe: ${failures} FAILED` : 'test-quake2-host-probe: all checks passed');
  process.exit(failures ? 1 : 0);
})();
