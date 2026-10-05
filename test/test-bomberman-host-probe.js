#!/usr/bin/env node
// Does the host probe tell an Atomic Bomberman server from a joiner?
//
//   node test/test-bomberman-host-probe.js
//
// The shell offers a room to people opening the game only while the owner's
// game is hosting, and nothing on the wire says so on its own. Bomberman's IPX
// server says it unasked: it broadcasts an announce on socket 0x6446 for the
// joiners' "Available net games" list (docs/re-notes/atomic-bomberman-demo.md),
// so its probe (lib/vlan-star.js, `protocol: 'announce'`) only watches for
// that. One emulator process per case, this test standing in for the room:
//
//   server  Start Network Game -> the client-slot list
//           must be seen hosting
//   joiner  Join Network Game -> "Available net games", nobody serving
//           must not: it is on the same socket, listening for a server

'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Wire } = require('../lib/vlan-wire');
const { HostProbe } = require('../lib/vlan-star');
const { APPS } = require('../lib/apps');

const ROOT = path.join(__dirname, '..');
const APP = APPS.atomic_bomberman_june_demo;
const EXE = path.join(ROOT, APP.exe);
const OUT = path.join(ROOT, 'scratch', 'bomberman-host-probe');
const BUDGET_S = 150;
const LAST_BATCH = 1700;

if (!fs.existsSync(EXE)) {
  console.log('SKIP  Atomic Bomberman June demo not installed at', EXE,
    '(tools/install-atomic-bomberman-demo.js)');
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

// The menu walks test-atomic-bomberman-vlan-gameplay.js uses, each key held
// for exactly one batch (three would trip the game's key repeat).
const DOWN = 40, ENTER = 13;
const key = (batch, vk) => [`${batch}:keydown:${vk}`, `${batch + 1}:keyup:${vk}`];
const TO_MENU = [...key(900, ENTER), ...key(1000, ENTER)];
const SERVER_KEYS = [...TO_MENU, ...key(1100, DOWN), ...key(1130, ENTER)];
const JOINER_KEYS = [...TO_MENU, ...key(1100, DOWN), ...key(1120, DOWN), ...key(1150, ENTER)];

// The emulator's side of the room is its ProcessWire: whatever the guest
// sends arrives here as an IPC message and goes through intercept(), which
// the probe owns.
class ChildGuest extends Wire {
  constructor(child, address) {
    super();
    this.child = child;
    this.address = address;
    this.intercept = null;
    this.fromGuest = 0;
    this.firstBroadcast = null;
    child.on('message', msg => {
      if (!msg || msg.t !== 'vln') return;
      this.fromGuest++;
      const bytes = Uint8Array.from(Buffer.from(msg.d, 'base64'));
      if (!this.firstBroadcast && bytes.length > 28
        && new DataView(bytes.buffer).getUint32(16, true) === 0xFFFFFFFF) {
        this.firstBroadcast = Buffer.from(bytes.subarray(28)).toString('hex');
      }
      if (this.intercept) this.intercept(bytes);
    });
  }
  deliver(bytes) {
    if (this.child.connected) this.child.send({ t: 'vln', d: Buffer.from(bytes).toString('base64') });
  }
}

function runCase(name, keys, extra) {
  const log = fs.createWriteStream(path.join(OUT, `${name}.log`));
  const child = fork(path.join(ROOT, 'test', 'run.js'), [
    '--app=atomic_bomberman_june_demo', '--vlan-wire', '--vlan-ip=10.0.0.1', '--trace-net',
    '--quiet-api', '--batch-size=100000', `--max-batches=${LAST_BATCH}`,
    `--max-seconds=${BUDGET_S}`, '--no-close', `--input=${keys.join(',')}`, ...extra,
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const guest = new ChildGuest(child, '10.0.0.1');
  const result = { name, hosting: null, guest };
  const probe = new HostProbe(guest, APP.lan.hostProbe, h => { if (h) result.hosting = h; });
  return new Promise(resolve => {
    child.on('exit', () => { probe.stop(); resolve(result); });
  });
}

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

(async () => {
  const [server, joiner] = await Promise.all([
    runCase('server', SERVER_KEYS, []),
    // A different calendar day: a different srand(time()), as in the room.
    runCase('joiner', JOINER_KEYS, ['--no-build', '--wall-clock-ms=867758407000']),
  ]);
  check(`a Bomberman server is seen hosting (${server.hosting ? `"${server.hosting.label}"` : 'not seen'})`,
    !!server.hosting && server.hosting.label === 'Bombs Ahoy', `see ${path.join(OUT, 'server.log')}`);
  if (server.guest.firstBroadcast) console.log(`      its announce: ${server.guest.firstBroadcast}`);
  check(`a joiner looking for a server is not (${joiner.guest.fromGuest} frames from it)`,
    !joiner.hosting,
    `seen hosting "${joiner.hosting && joiner.hosting.label}"; first broadcast ${joiner.guest.firstBroadcast}`);
  console.log(failures ? `test-bomberman-host-probe: ${failures} FAILED` : 'test-bomberman-host-probe: all checks passed');
  process.exit(failures ? 1 : 0);
})();
