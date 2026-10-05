#!/usr/bin/env node
// Does the host probe tell a Blobby Volley session host from a searcher?
//
//   node test/test-blobby-host-probe.js
//
// The shell lists a room as serving only while the owner's game is hosting,
// which nothing on the wire says on its own. For a DirectPlay game the probe
// (lib/vlan-star.js, `protocol: 'dplay'`) asks the way the guest's own
// EnumSessions does -- a dpl/1 ENUM_REQ, from a seat nobody holds -- and only
// a hosting session answers it (src/09d4-dplay-net.wat). This runs it against
// the real game, one emulator process per case, with this test standing in
// for the rest of the room:
//
//   host      NETZWERKSPIEL -> EIN SPIEL HOSTEN -> SPIEL BEGINNEN!
//             must answer, labelled with its session's player count
//   searcher  NETZWERKSPIEL -> ALS GAST SPIELEN -> SPIELE SUCHEN
//             must stay silent: it is using DirectPlay too, broadcasting its
//             own ENUM_REQ the whole time, and hosts nothing

'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Wire } = require('../lib/vlan-wire');
const { HostProbe } = require('../lib/vlan-star');
const { APPS } = require('../lib/apps');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'packages', 'freeware', 'blobby-volley', 'volley.exe');
const OUT = path.join(ROOT, 'scratch', 'blobby-host-probe');
const BUDGET_S = 120;

if (!fs.existsSync(EXE)) {
  console.log('SKIP  volley.exe not found at', EXE);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

// The menu walks test-blobby-vlan.js uses.
const DOWN = 40, ENTER = 13;
const key = (batch, vk) => [`${batch}:keydown:${vk}`, `${batch + 10}:keyup:${vk}`];
const HOST_KEYS = [
  ...key(460, DOWN), ...key(520, ENTER),
  ...key(620, ENTER),
  ...key(700, DOWN), ...key(720, DOWN), ...key(760, ENTER),
];
const SEARCH_KEYS = [
  ...key(460, DOWN), ...key(520, ENTER),
  ...key(600, DOWN), ...key(620, ENTER),
  ...key(700, DOWN), ...key(720, DOWN), ...key(760, ENTER),
];

// The emulator's side of the room is its ProcessWire: frames arrive here as
// IPC messages. deliver() hands a frame to the guest; whatever the guest sends
// comes back through intercept(), which the probe owns.
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

function runCase(name, keys, settleMs) {
  const log = fs.createWriteStream(path.join(OUT, `${name}.log`));
  const child = fork(path.join(ROOT, 'test', 'run.js'), [
    `--exe=${EXE}`, '--vlan-wire', '--vlan-ip=10.0.0.1', '--trace-net',
    '--quiet-api', '--real-ticks',
    '--batch-size=200000', '--max-batches=100000000', `--max-seconds=${BUDGET_S}`,
    '--no-close', `--input=${keys.join(',')}`,
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const guest = new ChildGuest(child, '10.0.0.1');
  const result = { name, hosting: null, asked: 0, guest };
  const probe = new HostProbe(guest, APPS.blobby_volley.lan.hostProbe, h => {
    if (h) result.hosting = h;
  });
  const ask = setInterval(() => { result.asked++; probe.ask(); }, 2000);
  return new Promise(resolve => {
    let stopAt = null;
    const finish = () => {
      clearInterval(ask);
      clearInterval(poll);
      probe.stop();
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve(result);
    };
    // The host stops as soon as it has answered. The searcher is given a
    // fixed stretch of questions after it starts talking on the wire, since
    // "never answered" needs the questions to have reached a searching game.
    const poll = setInterval(() => {
      if (result.hosting) finish();
      else if (settleMs && guest.fromGuest > 0 && stopAt === null) stopAt = Date.now() + settleMs;
      else if (stopAt !== null && Date.now() > stopAt) finish();
    }, 250);
    child.on('exit', finish);
  });
}

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

(async () => {
  const [host, searcher] = await Promise.all([
    runCase('host', HOST_KEYS, 0),
    runCase('searcher', SEARCH_KEYS, 30000),
  ]);
  check(`a hosting Blobby answers the probe (${host.hosting ? `"${host.hosting.label}"` : 'no answer'}, ${host.asked} questions)`,
    !!host.hosting && /\b1\/\d+$/.test(host.hosting.label),
    `see ${path.join(OUT, 'host.log')}`);
  check(`a searching Blobby never answers it (${searcher.asked} questions)`,
    !searcher.hosting && searcher.guest.fromGuest > 0,
    searcher.hosting ? `answered "${searcher.hosting.label}"`
      : `it never reached the wire; see ${path.join(OUT, 'searcher.log')}`);
  console.log(failures ? `test-blobby-host-probe: ${failures} FAILED` : 'test-blobby-host-probe: all checks passed');
  process.exit(failures ? 1 : 0);
})();
