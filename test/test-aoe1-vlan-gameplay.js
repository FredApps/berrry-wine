#!/usr/bin/env node
// Age of Empires (1997 trial): one player hosts a LAN game, a second joins it,
// and both see each other in the same Multiplayer Game lobby.
//
//   node test/test-aoe1-vlan-gameplay.js [--keep]
//
//   seat 10.0.0.1  "Host":  Multiplayer -> name, TCP/IP -> Create -> "Game"
//   seat 10.0.0.2  "Guest": Multiplayer -> name, TCP/IP -> Show Games -> Join
//
// AoE drives DirectPlay through IDirectPlay3A (DirectPlayCreate + QI):
// Open, CreatePlayer, GetCaps/GetPlayerCaps, GetSessionDesc, GetPlayerName,
// SetPlayerData, EnumSessions and its lobby protocol over Send/Receive, all
// carried by the virtual LAN provider (src/09d4-dplay-net.wat) as dpl/1 frames.
//
// HEAVY: two emulator processes for a few minutes. Run it on a boat sandbox.
//
// Both seats run on the wall clock (--real-ticks) and are driven over their
// control channels: a join waits on the host's answer in guest time, so batch
// clocks in two processes cannot schedule it (see test-aoe2-vlan-gameplay.js).
// On the wall clock the intro videos run their real length, so neither a batch
// count nor a fixed delay says when the title is up: each step waits for its
// screen, recognised from a capture by a few pixels that only that screen has,
// and the guest clicks Join only after a session reply has arrived at it.
//
// AoE acts on its own hover state, so every button press is a mousemove onto
// the button first, then the click.
//
// Checks:
//   1. the host answers the guest's search and the reply arrives;
//   2. the guest asks to join and is admitted: JOIN_REQ out, JOIN_ACK back;
//   3. the two games exchange their own lobby traffic: DATA frames both ways;
//   4. both lobbies show two players: name rows 1 and 2 hold player names (red),
//      not the green "Open" an empty slot shows.

'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { PNG } = require('pngjs');
const { ProcessHub } = require('../lib/vlan-wire');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'scratch', 'aoe1-vlan');
const EXE = path.join(ROOT, 'test', 'binaries', 'shareware', 'aoe', 'aoe_ex', 'Empires.exe');
const KEEP = process.argv.includes('--keep');
const WINDOW_BYTES = 64 * 1024;

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
  return ok;
}

// The lobby's name column, rows 1-4 (640x480 canvas): a player's name is drawn
// red, an empty slot is a green "Open".
const ROWS = [[88, 100], [113, 125], [137, 149], [161, 173]];
function lobbyRows(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return ROWS.map(([y0, y1]) => {
    let green = 0, red = 0;
    for (let y = y0; y < y1; y++) for (let x = 28; x < 110; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (g > 120 && g > r * 1.6 && g > b * 1.6) green++;
      if (r > 120 && r > g * 1.8 && r > b * 1.8) red++;
    }
    return { green, red };
  });
}

// Share (0..1) of pixels in a rect that pass a colour test.
function share(png, [x0, y0, x1, y1], test) {
  let hit = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * png.width + x) * 4;
    if (test(png.data[i], png.data[i + 1], png.data[i + 2])) hit++;
  }
  return hit / ((x1 - x0) * (y1 - y0));
}
const white = (r, g, b) => r > 225 && g > 225 && b > 225;
const yellow = (r, g, b) => r > 190 && g > 170 && b < 110;
const green = (r, g, b) => g > 120 && g > r * 1.6 && g > b * 1.6;
// Measured on captures of each screen (640x480).
const SCREENS = {
  // the highlighted "Single Player" label of the title menu
  title: png => share(png, [260, 190, 380, 206], yellow) > 0.05,
  // Multiplayer Connection: the full-width white name field
  connection: png => share(png, [30, 104, 610, 112], white) > 0.9,
  // Multiplayer Games: the list's hint line, and no white field anywhere
  games: png => share(png, [30, 96, 600, 104], white) > 0.1
    && share(png, [30, 104, 610, 112], white) < 0.1 && share(png, [160, 240, 480, 248], white) < 0.1,
  // the Create Game dialog's white Game Name field
  create: png => share(png, [160, 240, 480, 248], white) > 0.9,
  // Multiplayer Game: the green "Open" in the empty name rows 3 and 4
  lobby: png => share(png, [28, 137, 110, 173], green) > 0.02,
};

if (!fs.existsSync(EXE)) {
  console.log('SKIP  Age of Empires trial not installed at', EXE);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

function spawn(name, ip, watch) {
  const args = [
    '--app=aoe1', '--vlan-wire', `--vlan-ip=${ip}`, '--trace-net', '--quiet-api',
    '--real-ticks', '--batch-size=10000', '--max-batches=100000000', '--max-seconds=300',
    '--repaint-every=10', '--stuck-after=100000000', '--control-stdin', '--no-close',
    ...(process.env.AOE1_VLAN_TRACE ? [`--trace-api=${process.env.AOE1_VLAN_TRACE}`] : []),
  ];
  const child = fork(path.join(ROOT, 'test', 'run.js'), args,
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const fd = fs.openSync(path.join(OUT, `${name}.log`), 'w');
  const state = { name, child, window: '', exited: false, hits: new Set(), data: 0 };
  const collect = d => {
    fs.writeSync(fd, d);
    const text = d.toString();
    state.window = (state.window + text).slice(-WINDOW_BYTES);
    for (const [k, re] of Object.entries(watch)) {
      if (!state.hits.has(k) && re.test(state.window)) state.hits.add(k);
    }
    state.data += (text.match(/\[net\] <- dpl DATA/g) || []).length;
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
const control = (s, cmd) => { if (!s.exited) s.child.stdin.write(JSON.stringify(cmd) + '\n'); };
let probes = 0;
async function capture(s) {
  const file = path.join(OUT, `${s.name}-probe-${probes++}.png`);
  control(s, { action: 'png', path: file });
  for (let i = 0; i < 100 && !s.exited; i++) {
    await sleep(100);
    if (fs.existsSync(file)) {
      await sleep(100);
      try { return PNG.sync.read(fs.readFileSync(file)); } catch (_) { return null; }
      finally { fs.rmSync(file, { force: true }); }
    }
  }
  return null;
}
async function waitScreen(s, screen, timeoutMs, nudge) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !s.exited) {
    const png = await capture(s);
    if (png && SCREENS[screen](png)) return true;
    if (nudge) nudge();
    await sleep(1000);
  }
  return false;
}
function step(s, screen, ok) {
  if (!ok) throw new Error(`${s.name} never reached the ${screen} screen`);
}
async function press(s, x, y) {
  control(s, { cmd: `mousemove:${x}:${y}` });
  await sleep(300);
  control(s, { cmd: `click:${x}:${y}` });
}
async function type(s, text) {
  for (const ch of text) { control(s, { cmd: `keypress:${ch.charCodeAt(0)}` }); await sleep(150); }
}
const shot = (s, tag) => { if (KEEP) control(s, { action: 'png', path: path.join(OUT, `${s.name}-${tag}.png`) }); };

// Escape past the intro, Multiplayer, the connection screen (name + the
// TCP/IP provider + OK), ending on Multiplayer Games.
async function toGamesScreen(s, name) {
  step(s, 'title', await waitScreen(s, 'title', 120000,
    () => { control(s, { cmd: 'keydown:27' }); control(s, { cmd: 'keyup:27' }); }));
  await sleep(1000);
  await press(s, 320, 248);                 // Multiplayer
  step(s, 'connection', await waitScreen(s, 'connection', 60000));
  control(s, { cmd: 'click:320:108' });     // name field
  await type(s, name);
  await press(s, 320, 199);                 // Internet TCP/IP Connection For DirectPlay
  await sleep(1000);
  shot(s, '2-connection');
  await press(s, 190, 455);                 // OK
  step(s, 'games', await waitScreen(s, 'games', 60000));
}

async function main() {
  const hub = new ProcessHub();
  const host = spawn('host', '10.0.0.1', {
    enumReply: /\[net\] -> dpl ENUM_REPLY/,
    joinAck: /\[net\] -> dpl JOIN_ACK/,
    data: /\[net\] <- dpl DATA/,
  });
  hub.add(host.child);
  let guest = null;
  try {
    await toGamesScreen(host, 'Host');
    await press(host, 320, 455);            // Create
    step(host, 'create', await waitScreen(host, 'create', 60000));
    control(host, { cmd: 'click:320:244' }); // Game Name
    await type(host, 'Game');
    await press(host, 240, 304);            // OK
    step(host, 'lobby', await waitScreen(host, 'lobby', 60000));
    shot(host, '4-lobby');

    guest = spawn('guest', '10.0.0.2', {
      replyIn: /\.\. arrived dpl ENUM_REPLY/,
      joinReq: /\[net\] -> dpl JOIN_REQ/,
      joinAckIn: /\[net\] <- dpl JOIN_ACK/,
      data: /\[net\] <- dpl DATA/,
    });
    hub.add(guest.child);
    await toGamesScreen(guest, 'Guest');
    await press(guest, 320, 384);           // Show Games

    check('the host answers the guest\'s search', await waitFor(host, 'enumReply', 60000));
    if (check('the reply reaches the guest', await waitFor(guest, 'replyIn', 60000))) {
      await sleep(3000);                     // the list repaints on the guest's next UI frame
      shot(guest, '4-found');
      await press(guest, 320, 120);         // the host's game, first row of the list
      await sleep(1000);
      await press(guest, 110, 455);         // Join
      check('the guest asks to join', await waitFor(guest, 'joinReq', 60000));
      check('the host admits it',
        await waitFor(host, 'joinAck', 60000) && await waitFor(guest, 'joinAckIn', 60000));
      check('the host receives the guest\'s lobby traffic', await waitFor(host, 'data', 60000));
      check('the guest receives the host\'s lobby traffic', await waitFor(guest, 'data', 60000));

      await sleep(15000);                    // both lobbies settle on the joined player
      for (const s of [host, guest]) control(s, { action: 'png', path: path.join(OUT, `${s.name}-lobby.png`) });
      await sleep(5000);
      for (const s of [host, guest]) {
        const file = path.join(OUT, `${s.name}-lobby.png`);
        if (!fs.existsSync(file)) { check(`${s.name} lobby captured`, false, `missing ${file}`); continue; }
        const rows = lobbyRows(file);
        check(`${s.name} lobby lists both players by name (${rows.map(r => `g${r.green}/r${r.red}`).join(' ')})`,
          rows[0].red > 40 && rows[0].green === 0 && rows[1].red > 40 && rows[1].green === 0);
      }
      console.log(`lobby DATA frames received: host ${host.data}, guest ${guest.data}`);
    }
  } catch (err) {
    check(String(err && err.message || err), false);
  } finally {
    for (const s of [host, guest].filter(Boolean)) control(s, { action: 'quit' });
    await sleep(3000);
    for (const s of [host, guest].filter(Boolean)) if (!s.exited) s.child.kill();
  }
  if (!KEEP && !failures) {
    for (const f of ['host.log', 'guest.log']) fs.rmSync(path.join(OUT, f), { force: true });
  }
  console.log(failures ? `test-aoe1-vlan-gameplay: ${failures} FAILED (logs in ${OUT})`
    : 'test-aoe1-vlan-gameplay: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
