#!/usr/bin/env node
// Two Atomic Bomberman June-1997 demo processes play one IPX match over the
// virtual LAN.
//
//   node test/test-atomic-bomberman-vlan-gameplay.js [--keep]
//
//   seat 10.0.0.1 "Start Network Game"          seat 10.0.0.2 "Join Network Game"
//        │  server announce (59) -> broadcast        │  lists the server
//        │  <- join request (61), every pass         │
//        │  join reply (20) ->                       │  "waiting for server"
//        │  Enter x3: into the arena                 │
//        │  <- player input (22)   state (30/50) ->  │  Right moves the guest
//
// AF_IPX SOCK_DGRAM is a room UDP socket (src/09d-winsock.wat). What this
// guards, each a bug that broke the join once (docs/re-notes/atomic-bomberman-demo.md):
//   - both sides seed rand() from time(), and the node ID is rand(): equal
//     clocks make each side drop the other's packets as its own. The joiner
//     gets a different --wall-clock-ms.
//   - the game polls with FIONREAD, so FIONREAD must move the wire;
//   - its receive loop takes up to 64 datagrams into a 64-slot ring and laps
//     it, so a socket must queue a bounded number of datagrams, not all of them;
//   - the join waits 1000ms of timeGetTime for the reply: 5 batches at the
//     default clock, so the pair steps in lockstep one batch at a time.
//
// Local-only: the demo's licence forbids redistribution. SKIP when absent.

'use strict';

const fs = require('fs');
const path = require('path');
const { startControlSession } = require('./control-session');
const { ProcessHub } = require('../lib/vlan-wire');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'scratch', 'atomic-bomberman-vlan');
const EXE = path.join(ROOT, 'test', 'binaries', 'win98-games-a-d',
  'Atomic Bomberman Demo-archive', 'installed', 'BM95DEMO.EXE');
const HOST_IP = '10.0.0.1';
const GUEST_IP = '10.0.0.2';

// Menu routes, one op per lockstep batch unless it says wait:N.
// key:VK is a one-batch press. hold:VK-N keeps VK down for N batches.
const HOST_SCRIPT = 'wait:900 key:13 wait:100 key:13 wait:100 key:40 wait:30 key:13 ' +
  'wait:1500 key:13 wait:300 key:13 wait:300 key:13 wait:400 png:arena';
const GUEST_SCRIPT = 'wait:900 key:13 wait:100 key:13 wait:100 key:40 wait:20 key:40 ' +
  'wait:30 key:13 wait:400 key:13 wait:2103 hold:39-100 wait:200 png:arena';

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

// `[net] .. arrived DGRAM a.b.c.d:port -> ... len=N` → counts by "srcip len".
function arrivals(log) {
  const counts = new Map();
  for (const m of log.matchAll(/^\[net\] \.\. arrived DGRAM ([\d.]+):\d+ -> \S+ len=(\d+)/gm)) {
    const k = `${m[1]} ${m[2]}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

if (!fs.existsSync(EXE)) {
  console.log('SKIP  Atomic Bomberman June demo not installed at', EXE,
    '(tools/install-atomic-bomberman-demo.js)');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });

function seat(name, ip, extra) {
  return startControlSession([path.join(ROOT, 'test', 'run.js'),
    '--app=atomic_bomberman_june_demo', '--quiet-api', '--no-close',
    '--control-stdin', '--frozen', '--max-seconds=280', '--batch-size=100000',
    '--vlan-wire', `--vlan-ip=${ip}`, '--trace-net', ...extra],
  { cwd: ROOT, idPrefix: name + '-', spawnOptions: { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] } });
}

(async () => {
  const hub = new ProcessHub();
  const sides = {
    host: seat('host', HOST_IP, []),
    // A different calendar day: a different srand(time()) and node ID.
    guest: seat('guest', GUEST_IP, ['--no-build', '--wall-clock-ms=867758407000']),
  };
  hub.add(sides.host.child);
  hub.add(sides.guest.child);
  const queues = { host: HOST_SCRIPT.split(/\s+/), guest: GUEST_SCRIPT.split(/\s+/) };
  const idle = { host: 0, guest: 0 };
  const key = (s, vk, down) =>
    s.send({ action: 'eval', code: `renderer.handleKey${down ? 'Down' : 'Up'}(${vk})` });
  let error = null;
  try {
    while (queues.host.length || queues.guest.length) {
      for (const n of ['host', 'guest']) {
        const s = sides[n];
        while (!idle[n] && queues[n].length) {
          const [op, arg] = queues[n].shift().split(':');
          if (op === 'wait') { idle[n] = Number(arg); break; }
          if (op === 'hold') {
            const [vk, n2] = arg.split('-');
            await key(s, vk, true);
            queues[n].unshift(`up:${vk}`);
            idle[n] = Number(n2);
            break;
          }
          if (op === 'up') await key(s, arg, false);
          else if (op === 'key') {
            await key(s, arg, true);
            await s.step(1);
            await key(s, arg, false);
          } else if (op === 'png') {
            await s.send({ action: 'png', path: path.join(OUT, `${n}-${arg}.png`) });
          }
        }
        if (idle[n]) idle[n]--;
      }
      await Promise.all([sides.host.step(1), sides.guest.step(1)]);
    }
  } catch (e) { error = e; }
  const logs = {};
  for (const n of ['host', 'guest']) {
    await sides[n].quit({ ignoreReplyError: true });
    logs[n] = sides[n].output();
    fs.writeFileSync(path.join(OUT, `${n}.log`), logs[n]);
  }

  check('both seats ran the whole route', !error, error && error.message);
  const toGuest = arrivals(logs.guest);
  const toHost = arrivals(logs.host);
  check('the guest hears the server announce', (toGuest.get(`${HOST_IP} 59`) || 0) > 0);
  check('the host hears the join request', (toHost.get(`${GUEST_IP} 61`) || 0) > 0);
  check('the guest gets a join reply', (toGuest.get(`${HOST_IP} 20`) || 0) > 0,
    'no 20-byte reply: "Unable to obtain base offset"');
  check('in-match input reaches the host', (toHost.get(`${GUEST_IP} 22`) || 0) >= 50,
    `${toHost.get(`${GUEST_IP} 22`) || 0} guest frames`);
  check('in-match state reaches the guest', (toGuest.get(`${HOST_IP} 50`) || 0) >= 50,
    `${toGuest.get(`${HOST_IP} 50`) || 0} host frames`);
  for (const n of ['host', 'guest']) {
    check(`${n} did not overflow its wire inbox`, !/inbox overflow/.test(logs[n]));
    check(`${n} captured the arena`, fs.existsSync(path.join(OUT, `${n}-arena.png`)));
  }
  if (!process.argv.includes('--keep') && !failures) fs.rmSync(OUT, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed; logs in ${OUT}` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
