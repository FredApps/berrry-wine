#!/usr/bin/env node
// Blobby Volley over the virtual LAN: two real volley.exe processes, one
// hosting and one joining, with DirectPlay carried by the dpl/1 frames of
// src/09d4-dplay-net.wat across one ProcessHub segment.
//
// test-blobby-network.js drives each branch of the lobby alone. This is the
// match itself: the host opens a session and waits, the guest finds it by
// broadcast, joins, and both sides start exchanging game records.
//
// The evidence is on the wire (--trace-net) and in the host's reaction to it:
//   host  T1 parked at 0x44b5de        it is in its "waiting for a guest" loop
//                                      (the return from its Sleep(100))
//   host  -> ENUM_REPLY, JOIN_ACK      it answered the search and the join
//   host  -> DATA                      its wait loop saw DPSYS_CREATEPLAYER for
//                                      the guest and started the match: game
//                                      records are only sent from the game loop
//   both  <- DATA                      game records arrived in each direction
//
// Deliberately NOT --trace-api for everything: in a match the game paces its
// frames with a GetTickCount spin, and tracing every call of it turns one
// batch into minutes of formatting, which reads exactly like a hung peer.
//
// Menus are keyboard-driven for the reason test-blobby-network.js gives.

'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { ProcessHub } = require('../lib/vlan-wire');
const { colorBox } = require('../tools/png-color-box');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'packages', 'freeware', 'blobby-volley', 'volley.exe');
const OUT = path.join(ROOT, 'build', 'blobby-vlan');

if (!fs.existsSync(EXE)) {
  console.log('SKIP  volley.exe not found at', EXE);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

const DOWN = 40, UP = 38, ENTER = 13, LEFT = 37, RIGHT = 39;
// The guest's own player, from settings.dat. These happen to be the same
// arrows the menu above is driven with, and that is now deliberate rather
// than a coincidence: the shipped file puts BOTH players on the arrow keys
// (tools/blobby-settings.js) so one on-screen pad works the menu and the
// match, on whichever side of the wire it lands. Named separately because
// they are a different fact -- a remap of the player keys must change these
// and leave the menu constants alone.
const P2_LEFT = LEFT, P2_RIGHT = RIGHT;
const key = (batch, vk) => [`${batch}:keydown:${vk}`, `${batch + 10}:keyup:${vk}`];

// Finding the host's player in a screenshot. Player one is a flat saturated
// red that nothing else on the beach comes near -- the one other red in the
// picture is the score, which is why the band starts below it rather than at
// the top of the window. It is deliberately not tied to the court's own
// coordinates: the CLI renders 640x480 and the browser 800x600, and a band
// measured off one is nowhere near the players in the other.
// The guest is player two, the right-hand green blob, and in a NETWORK game
// it is driven by the KEYS, not the mouse: Instructions.txt 3.2.2 says the
// client "always gets the keys you specified for player two", so the mouse
// that moves player two in a local game does nothing here -- measured, the
// commands arrive and the blob ignores them. Holding player two's right key
// walks green tens of pixels up-court and leaves red where it was; the exact
// distance depends on how long the hold lands, so the checks below compare
// directions against MOVED_PX rather than pinning a coordinate.
// Green is also the colour of every palm tree, so the band is the strip the
// players stand in rather than the whole picture; the CLI renders 640x480 and
// the blob sits at y 329..399 at rest.
const GREEN = [30, 210, 30];
const COURT = [0, 322, 4096, 140];
// The blob crosses its own width in a second of held key, so a real move is
// far larger than this; the two screens should agree to within a blob's edge.
const MOVED_PX = 25;
const AGREE_PX = 12;
const fmt = v => (v === null ? 'gone' : v.toFixed(1));

// Main menu -> NETZWERKSPIEL -> MULTIPLAYER-OPTIONEN, then the host or guest
// entry, then the third entry of its settings screen (SPIEL BEGINNEN! /
// SPIELE SUCHEN). The guest then takes the first session found.
const HOST_KEYS = [
  ...key(460, DOWN), ...key(520, ENTER),
  ...key(620, ENTER),
  ...key(700, DOWN), ...key(720, DOWN), ...key(760, ENTER),
];
// The guest stops at its own settings screen. Picking a session out of the
// list is NOT scheduled here, because the list is filled by a frame from the
// host and that frame arrives in wall-clock time: a batch is not a unit of
// time, and how many batches this process retires per second is a property of
// the machine's load. Measured 2026-09-20 at load 41, the guest ran 176
// batches/s, so a key at batch 1040 landed about six seconds in -- long before
// the host had answered -- and it pressed ENTER on an empty list and never
// joined, taking five lobby checks red with a completely healthy host. The
// keys for it are sent from the arrival of the reply instead, below.
const GUEST_KEYS = [
  ...key(460, DOWN), ...key(520, ENTER),
  ...key(600, DOWN), ...key(620, ENTER),
  ...key(700, DOWN), ...key(720, DOWN), ...key(760, ENTER),
];

const WINDOW_BYTES = 64 * 1024;

// Extra run.js flags for one side, for probing without editing the file.
const extra = v => (v ? v.split(' ').filter(Boolean) : []);
const SIDE_ARGS = {
  host: extra(process.env.BLOBBY_HOST_ARGS),
  guest: extra(process.env.BLOBBY_GUEST_ARGS),
};

// Neither side has a batch count that means anything to the other: a host
// waiting in Sleep(100) retires batches far faster than a guest booting, and
// ran out of them before the guest ever searched. So both run on the wall
// clock and are stopped over the control channel once the checks are in.
function spawn(name, ip, input, watch) {
  const args = [
    `--exe=${EXE}`,
    '--vlan-wire',
    `--vlan-ip=${ip}`,
    '--trace-net',
    // The one line that names the guest thread's EIP without tracing its calls.
    '--trace-sched=20',
    '--quiet-api',
    // Two emulator processes in one room cannot share a batch-driven clock
    // (test/run.js, where --real-ticks is defined): a batch is not a unit of
    // time and each process retires them at its own rate, so each side
    // decides everything time-based against a clock the other does not have.
    // Measured 2026-09-20, this one flag is the difference between a flaky
    // gate and a green one -- see docs/re-notes/blobby-volley.md for the
    // numbers. It is not optional here, whatever the machine's load.
    '--real-ticks',
    '--batch-size=200000',
    '--max-batches=100000000',
    '--max-seconds=300',
    '--control-stdin',
    '--no-close',
    `--input=${input.join(',')}`,
    ...SIDE_ARGS[name],
  ];
  console.log(`$ node test/run.js ${args.map(a => a.replace(ROOT, '.')).join(' ')}`);
  const child = fork(path.join(ROOT, 'test', 'run.js'), args,
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const fd = fs.openSync(path.join(OUT, `${name}.log`), 'w');
  const state = {
    name, child, window: '', exited: false, hits: new Set(), watch,
    tail: () => state.window.split('\n').slice(-25).join('\n'),
  };
  const collect = d => {
    fs.writeSync(fd, d);
    state.window = (state.window + d.toString()).slice(-WINDOW_BYTES);
    for (const [k, re] of Object.entries(watch)) {
      if (!state.hits.has(k) && re.test(state.window)) state.hits.add(k);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('exit', () => { state.exited = true; });
  return state;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(state, k, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.hits.has(k)) return true;
    if (state.exited) return false;
    await sleep(100);
  }
  return false;
}
const waitExit = s => new Promise(r => (s.exited ? r() : s.child.on('exit', r)));
const control = (s, cmd) => { if (!s.exited) s.child.stdin.write(JSON.stringify(cmd) + '\n'); };

let failures = 0;
function check(what, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
}

async function main() {
  const hub = new ProcessHub();
  const host = spawn('host', '10.0.0.1', HOST_KEYS, {
    waiting: /\[sched\].*T1:\w+@0x44b5de/,
    enumReply: /\[net\] -> dpl ENUM_REPLY/,
    joinAck: /\[net\] -> dpl JOIN_ACK/,
    sent: /\[net\] -> dpl DATA/,
    data: /\[net\] <- dpl DATA/,
    exited: /T1 .*state=exited/,
  });
  hub.add(host.child);

  let guest = null;
  try {
    const opened = await waitFor(host, 'waiting', 180000);
    check('host opened a session and waits for a guest', opened);
    if (!opened) throw new Error(`host never opened\n${host.tail()}`);

    guest = spawn('guest', '10.0.0.2', GUEST_KEYS, {
      enumReq: /\[net\] -> dpl ENUM_REQ/,
      // The reply as the GUEST sees it, which is the event the session list
      // depends on -- the host's own "I answered" line says nothing about
      // whether the list on the other side has been filled in yet.
      replyIn: /\.\. arrived dpl ENUM_REPLY/,
      joinReq: /\[net\] -> dpl JOIN_REQ/,
      playerAdd: /\[net\] <- dpl PLAYER_ADD/,
      data: /\[net\] <- dpl DATA/,
      exited: /T1 .*state=exited/,
    });
    hub.add(guest.child);

    check('guest broadcast a session search', await waitFor(guest, 'enumReq', 180000));
    check('host answered the search', await waitFor(host, 'enumReply', 60000));

    // Cause, then effect: the session list exists only once that reply has
    // arrived HERE, so the keys that take the first session are sent now,
    // over the control channel, rather than at a batch number picked in
    // advance (see the note on GUEST_KEYS).
    check('the reply reached the guest', await waitFor(guest, 'replyIn', 60000));
    await sleep(3000);
    for (const vk of [UP, ENTER]) {
      control(guest, { cmd: `keydown:${vk}` });
      await sleep(500);
      control(guest, { cmd: `keyup:${vk}` });
      await sleep(2000);
    }

    check('guest asked to join the session', await waitFor(guest, 'joinReq', 120000));
    check('host admitted the guest', await waitFor(host, 'joinAck', 60000));
    check('guest learned the host player', await waitFor(guest, 'playerAdd', 60000));
    check('host saw the guest arrive and started the match',
      await waitFor(host, 'sent', 120000));
    check('guest receives game data from the host', await waitFor(guest, 'data', 120000));
    check('host receives game data from the guest', await waitFor(host, 'data', 120000));

    // ---- the match itself ------------------------------------------------
    //
    // Everything above is the wire: frames crossed, in both directions. That
    // is not yet a game. Player two is the guest's own blob and nothing else
    // moves it, so hold a key on the guest and photograph BOTH machines: the
    // host never saw that key, and can only know where the blob went from the
    // records the guest sent it. A green blob that ends up in the same new
    // place on the host's screen is one match being played across the wire,
    // rather than two programs each running their own.
    //
    // The captures are taken with the key still held, once the blob has run
    // out of court: released, it drifts back towards its serve position and
    // the two machines are then photographed mid-drift, milliseconds apart,
    // which is a disagreement about time rather than about the game. Held
    // against a wall, both screens are showing the same settled position.
    await sleep(15000);
    const shoot = async (tag) => {
      for (const s of [host, guest]) {
        control(s, { action: 'png', path: path.join(OUT, `${s.name}-${tag}.png`) });
      }
      await sleep(4000);
      const read = s => colorBox(path.join(OUT, `${s.name}-${tag}.png`),
        { color: GREEN, tol: 70, rect: COURT });
      return { host: read(host), guest: read(guest) };
    };

    // Two moves, because one is not evidence: a blob that happens to drift
    // the right way once proves nothing, and the second move is back.
    const holdOn = async (side, vk, tag) => {
      control(side, { cmd: `keydown:${vk}` });
      await sleep(4000);
      const shot = await shoot(tag);
      control(side, { cmd: `keyup:${vk}` });
      await sleep(2000);
      return shot;
    };
    const hold = (vk, tag) => holdOn(guest, vk, tag);
    const moved = (a, b) => (a.cx === null || b.cx === null) ? null : b.cx - a.cx;

    // A hold only means something if the blob was standing still first, and
    // in a network match it sometimes is not. Measured 2026-09-20 on a failing
    // run: the guest's own player slid right at a constant 0.17px per batch
    // (~7px/s, a seventh of a walk) through both holds, frozen in one squashed
    // sprite frame -- 56x60 and the same 2391 matching pixels in two captures
    // 375 batches apart, against 50x71 at rest -- and then snapped back to its
    // serve spot. A frozen frame sliding at a fixed rate is dead reckoning,
    // not a blob being simulated, and a key pressed into that state moves
    // nothing: run.js logged every keydown and keyup applied (39 at 1799,
    // released 2083, 37 at 2159, released 2466), the wire was symmetric and
    // unbacklogged (2151 frames out, 2138 in on the far side) and both screens
    // agreed on every position. So the sample is void rather than wrong, and
    // the only way to tell is to look before pressing anything: two captures
    // one hold apart, no key down.
    let before = null;
    for (let attempt = 1; attempt <= 3 && before === null; attempt++) {
      const a = await shoot(`settle-${attempt}a`);
      await sleep(6000);
      const b = await shoot(`settle-${attempt}b`);
      const drift = moved(a.guest, b.guest);
      const still = drift !== null && Math.abs(drift) < AGREE_PX;
      console.log(`  settle ${attempt}: green ${fmt(a.guest.cx)} -> ${fmt(b.guest.cx)}`
        + ` (${drift === null ? 'gone' : fmt(drift)}px, sprite ${a.guest.w}x${a.guest.h}`
        + ` -> ${b.guest.w}x${b.guest.h})`
        + (still ? '  standing still' : '  still sliding, waiting'));
      if (still) before = b;
      else await sleep(8000);
    }
    check('the guest\'s player stands still with no key held', before !== null);
    if (before === null) before = await shoot('before');
    const right = await hold(P2_RIGHT, 'right');
    const after = await hold(P2_LEFT, 'left');

    const dHost = moved(before.host, right.host);
    const dGuest = moved(before.guest, right.guest);
    console.log(`  green blob x: host ${fmt(before.host.cx)} -> ${fmt(right.host.cx)}`
      + ` -> ${fmt(after.host.cx)}   guest ${fmt(before.guest.cx)} -> `
      + `${fmt(right.guest.cx)} -> ${fmt(after.guest.cx)}`);
    check('the guest moved its own player', dGuest !== null && dGuest > MOVED_PX);
    check('the host saw the guest\'s player move the same way',
      dHost !== null && dHost > MOVED_PX);
    check('and saw it come back',
      moved(right.host, after.host) !== null && moved(right.host, after.host) < -MOVED_PX);
    check('both screens agree where that player ended up',
      after.host.cx !== null && after.guest.cx !== null
        && Math.abs(after.host.cx - after.guest.cx) < AGREE_PX);

    // The other half of "whose keys are whose": the HOST holding player two's
    // key must not move player two, because on this machine that player is
    // remote and its position comes off the wire. This is what lets one phone
    // pad send both players' keys at once -- the machine keeps the set it
    // owns and drops the rest -- so if this check ever fails, a dual-key pad
    // would be fighting the remote records instead of being ignored by them.
    // An idle control of the same length first, because a released blob
    // drifts back towards its serve position on its own (see the note above
    // the captures). Without it this check reads that drift as input: the
    // first version of it held RIGHT, measured -125px, and "failed" on a blob
    // that was simply walking home in the opposite direction.
    await sleep(4000);
    const idle = await shoot('host-idle');
    const hostHeld = await holdOn(host, P2_RIGHT, 'host-holds-p2');
    const dDrift = moved(after.host, idle.host);
    const dStray = moved(idle.host, hostHeld.host);
    console.log(`  player two while the host presses its key: idle drift `
      + `${dDrift === null ? 'n/a' : fmt(dDrift)}, then ${dStray === null ? 'n/a' : fmt(dStray)}`
      + ` with the host holding RIGHT (a hold that drove it would be > +${MOVED_PX})`);
    // Only rightward motion would mean the key landed; drifting further left
    // is the blob still going home.
    check('the host cannot drive the remote player with its own keyboard',
      dStray !== null && dStray < MOVED_PX);

    for (const s of [host, guest]) {
      control(s, { action: 'png', path: path.join(OUT, `${s.name}.png`) });
      control(s, { action: 'quit' });
    }
    await Promise.race([Promise.all([waitExit(host), waitExit(guest)]), sleep(60000)]);
    check('no unimplemented API', !/UNIMPLEMENTED API:/.test(host.window + guest.window));
    check('game threads survived', !host.hits.has('exited') && !guest.hits.has('exited'));
  } catch (e) {
    console.log(String(e && e.stack || e));
    failures++;
  } finally {
    for (const s of [host, guest]) if (s && !s.exited) s.child.kill('SIGKILL');
  }
  console.log(`\nlogs and captures in ${path.relative(ROOT, OUT)}/`);
  console.log(failures ? `test-blobby-vlan: ${failures} FAILED` : 'test-blobby-vlan: all checks passed');
  process.exit(failures ? 1 : 0);
}

main();
