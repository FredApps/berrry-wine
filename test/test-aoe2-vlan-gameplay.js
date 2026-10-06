#!/usr/bin/env node
// Age of Empires II: one player hosts a LAN game, a second joins it, and both
// see each other in the same multiplayer lobby.
//
//   node test/test-aoe2-vlan-gameplay.js [--keep]
//
//   seat 10.0.0.1  "Host":  Multiplayer -> Local (LAN) TCP/IP -> Create
//   seat 10.0.0.2  "Guest": Multiplayer -> Local (LAN) TCP/IP -> pick the game -> Join
//
// AoE II drives DirectPlay only through the Unicode IDirectPlay4W interface:
// EnumSessions(DPENUMSESSIONS_ASYNC) polled from its UI loop, Open, CreatePlayer,
// GetCaps/GetPlayerCaps, GetSessionDesc (size probe first), then its lobby
// protocol over Send/GetMessageCount/Receive. All of it rides the virtual LAN
// provider (src/09d4-dplay-net.wat) as dpl/1 frames.
//
// HEAVY: two emulator processes for a few minutes. Run it on a boat sandbox.
//
// Both seats run on the wall clock (--real-ticks) and are driven over their
// control channels, never by batch number. Two processes retire batches at
// their own rates, and a join waits 10 s of GUEST time for the host's answer:
// on a batch clock the guest burned that in a fraction of a wall second while
// the JOIN_ACK was still crossing the hub (project_vlan_tests_need_real_ticks;
// test-blobby-vlan.js is the pattern this follows). The guest clicks Join only
// after a session reply has arrived at the guest itself.
//
// Checks:
//   1. the host answers the guest's search and the reply arrives;
//   2. the guest asks to join and is admitted: JOIN_REQ out, JOIN_ACK back;
//   3. the two games exchange their own lobby traffic: DATA frames both ways;
//   4. both lobbies show two players: name rows 1 and 2 hold player names (red),
//      not the green "Open" an empty slot shows, and the remote one is the
//      name that player typed, not "?". AoE II stores 1252 bytes in its W name
//      fields, so a name survives only if the wire carries the W units as given.

'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { PNG } = require('pngjs');
const { ProcessHub } = require('../lib/vlan-wire');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'scratch', 'aoe2-vlan');
const EXE = path.join(ROOT, 'test', 'binaries', 'shareware', 'aoe2', 'aoe2_ex', 'EMPIRES2.EXE');
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
const ROWS = [[70, 82], [89, 101], [108, 120], [127, 139]];
function lobbyRows(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return ROWS.map(([y0, y1]) => {
    let green = 0, red = 0;
    for (let y = y0; y < y1; y++) for (let x = 44; x < 140; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (g > 120 && g > r * 1.6 && g > b * 1.6) green++;
      if (r > 120 && r > g * 1.8 && r > b * 1.8) red++;
    }
    return { green, red };
  });
}

if (!fs.existsSync(EXE)) {
  console.log('SKIP  Age of Empires II trial not installed at', EXE);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

function spawn(name, ip, watch) {
  const args = [
    '--app=aoe2', '--vlan-wire', `--vlan-ip=${ip}`, '--trace-net', '--quiet-api',
    '--real-ticks', '--batch-size=50000', '--max-batches=100000000', '--max-seconds=300',
    '--repaint-every=100', '--stuck-after=100000000', '--control-stdin', '--no-close',
    ...(process.env.AOE2_VLAN_TRACE ? [`--trace-api=${process.env.AOE2_VLAN_TRACE}`] : []),
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
const click = (s, x, y) => control(s, { cmd: `click:${x}:${y}` });
const shot = (s, tag) => { if (KEEP) control(s, { action: 'png', path: path.join(OUT, `${s.name}-${tag}.png`) }); };

// EULA Accept, Multiplayer, the New Player name dialog, Local (LAN) TCP/IP.
// Local UI with no wire dependency, paced on the wall clock the seat runs on.
async function toConnectionScreen(s, name) {
  await sleep(20000);
  shot(s, '1-eula');
  click(s, 161, 433);                       // EULA Accept
  await sleep(10000);
  shot(s, '2-menu');
  click(s, 248, 185);                       // Multiplayer
  await sleep(4000);
  shot(s, '3-name');
  click(s, 335, 240);                       // name field
  await sleep(500);
  for (const ch of name) { control(s, { cmd: `keypress:${ch.charCodeAt(0)}` }); await sleep(200); }
  await sleep(500);
  click(s, 259, 284);                       // OK
  await sleep(4000);
  shot(s, '4-connection');
  click(s, 430, 102);                       // Local (LAN) TCP/IP Connection
  await sleep(4000);
  shot(s, '5-browser');
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
    await toConnectionScreen(host, 'Host');
    click(host, 480, 365);                  // Create
    await sleep(8000);
    shot(host, '6-lobby');

    guest = spawn('guest', '10.0.0.2', {
      replyIn: /\.\. arrived dpl ENUM_REPLY/,
      joinReq: /\[net\] -> dpl JOIN_REQ/,
      joinAckIn: /\[net\] <- dpl JOIN_ACK/,
      data: /\[net\] <- dpl DATA/,
    });
    hub.add(guest.child);
    await toConnectionScreen(guest, 'Guest');

    check('the host answers the guest\'s search', await waitFor(host, 'enumReply', 60000));
    if (check('the reply reaches the guest', await waitFor(guest, 'replyIn', 60000))) {
      await sleep(3000);                     // the list repaints on the guest's next UI frame
      shot(guest, '6-found');
      click(guest, 480, 195);               // the host's game in the list
      await sleep(1500);
      click(guest, 480, 318);               // Join
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
        // "Host" and "Guest" are 70-80 red pixels; the "?" a name lost in a
        // 1252 narrowing renders as about 15, so a real name must clear 40.
        check(`${s.name} lobby lists both players by name (${rows.map(r => `g${r.green}/r${r.red}`).join(' ')})`,
          rows[0].red > 40 && rows[0].green === 0 && rows[1].red > 40 && rows[1].green === 0);
      }
      console.log(`lobby DATA frames received: host ${host.data}, guest ${guest.data}`);
    }
  } finally {
    for (const s of [host, guest].filter(Boolean)) control(s, { action: 'quit' });
    await sleep(3000);
    for (const s of [host, guest].filter(Boolean)) if (!s.exited) s.child.kill();
  }
  if (!KEEP && !failures) {
    for (const f of ['host.log', 'guest.log']) fs.rmSync(path.join(OUT, f), { force: true });
  }
  console.log(failures ? `test-aoe2-vlan-gameplay: ${failures} FAILED (logs in ${OUT})`
    : 'test-aoe2-vlan-gameplay: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
