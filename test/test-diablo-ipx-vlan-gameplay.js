#!/usr/bin/env node
// Diablo (shareware): one player creates an IPX game, a second joins it, and
// both end up in Tristram.
//
//   node test/test-diablo-ipx-vlan-gameplay.js [--keep]
//
//   seat 10.0.0.1: Multi Player -> Warrior "gal" -> Local Area Network (IPX)
//                  -> Create Game -> Normal
//   seat 10.0.0.2: Multi Player -> Warrior "gal" -> Local Area Network (IPX)
//                  -> the host's game in the list -> OK
//
// Storm's standard.snp opens two AF_IPX datagram sockets and broadcasts; the
// virtual LAN carries IPX as UDP between seats (src/09d-winsock.wat).
//
// HEAVY: two emulator processes for several minutes. Run it on a boat sandbox.
//
// The shared menu route is scheduled by batch on each seat's own batch clock:
// at --tick-ms-per-batch=50 and the 12-35 batches/s Diablo runs at, guest time
// moves at roughly real speed, so Storm's own network timeouts are no tighter
// than on real hardware. Only the step that needs the other seat -- the guest
// picking the host's game -- is driven over the control channel, after the
// host is in its game.
//
// Checks: the host's game is announced over the wire and reaches the guest; the
// guest joins it (both seats' frames flow both ways after the join); both seats
// end in Tristram, recognised by the HUD's red life and blue mana orbs.

'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { PNG } = require('pngjs');
const { ProcessHub } = require('../lib/vlan-wire');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'scratch', 'diablo-ipx-vlan');
const EXE = path.join(ROOT, 'test', 'binaries', 'candidates', 'diablo-shareware', 'installed', 'diablo_s.exe');
const KEEP = process.argv.includes('--keep');

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
  return ok;
}

// Multi Player, Warrior, OK, name "gal", OK, Local Area Network (IPX), OK.
// Diablo's Storm buttons act on press-and-release, so every press is a
// mousemove onto the target, a mousedown and a separate mouseup.
const press = (b, x, y) => `${b}:mousemove:${x}:${y},${b + 10}:mousedown:${x}:${y},${b + 50}:mouseup:${x}:${y}`;
const ROUTE = [
  press(1000, 320, 256), press(1300, 420, 298), press(1600, 348, 446),
  '1900:keydown:71,1910:keypress:103,1950:keydown:65,1960:keypress:97,2000:keydown:76,2010:keypress:108',
  press(2200, 348, 446), press(2650, 445, 295), press(2800, 348, 446),
].join(',');
// Host: Create Game (first row) -> OK, then Normal -> OK.
const HOST = [ROUTE, press(3200, 348, 446), press(3600, 348, 446)].join(',');

// Tristram's HUD: the red life orb and the blue mana orb either side of the belt.
function inGame(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let red = 0, blue = 0;
  for (let y = 360; y < 420; y++) {
    for (let x = 110; x < 170; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (r > 35 && r > 3 * g && r > 3 * b) red++;
    }
    for (let x = 470; x < 530; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (b > 30 && b > 3 * r && b > 3 * g) blue++;
    }
  }
  // The orbs are dark (life about (63,12,12), mana about (7,9,52) on average),
  // so this is a hue test, not a brightness one. 3600 pixels per box: a
  // Tristram frame measured 2457 life / 944 mana, every menu screen 0 / 0.
  return { red, blue, ok: red > 500 && blue > 500 };
}

if (!fs.existsSync(EXE)) {
  console.log('SKIP  Diablo shareware not installed at', EXE);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

function spawn(name, ip, input) {
  const args = [
    '--app=diablo_shareware', '--vlan-wire', `--vlan-ip=${ip}`, '--trace-net', '--quiet-api',
    '--batch-size=200000', '--tick-ms-per-batch=50', '--max-batches=100000000', '--max-seconds=840',
    '--repaint-every=20', '--stuck-after=100000000', '--control-stdin', '--no-close',
    `--input=${input}`,
  ];
  const child = fork(path.join(ROOT, 'test', 'run.js'), args,
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const fd = fs.openSync(path.join(OUT, `${name}.log`), 'w');
  const state = { name, child, exited: false, batch: 0, rx: 0, tx: 0 };
  child.stdout.on('data', d => {
    fs.writeSync(fd, d);
    const text = d.toString();
    state.rx += (text.match(/\[net\] <- /g) || []).length;
    state.tx += (text.match(/\[net\] -> /g) || []).length;
    for (const m of text.matchAll(/"pong":true,"batch":(\d+)/g)) state.batch = Math.max(state.batch, Number(m[1]));
  });
  child.stderr.on('data', d => fs.writeSync(fd, d));
  child.on('exit', () => { state.exited = true; });
  return state;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const control = (s, cmd) => { if (!s.exited) s.child.stdin.write(JSON.stringify(cmd) + '\n'); };
async function atBatch(s, n, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!s.exited && s.batch < n && Date.now() < deadline) { control(s, { action: 'ping' }); await sleep(1000); }
  return s.batch >= n;
}
async function snap(s, tag) {
  const file = path.join(OUT, `${s.name}-${tag}.png`);
  fs.rmSync(file, { force: true });
  control(s, { action: 'png', path: file });
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await sleep(200);
  await sleep(300);
  return fs.existsSync(file) ? file : null;
}
async function clickAt(s, x, y) {
  control(s, { cmd: `mousemove:${x}:${y}` });
  await sleep(1500);
  control(s, { cmd: `mousedown:${x}:${y}` });
  await sleep(1500);
  control(s, { cmd: `mouseup:${x}:${y}` });
  await sleep(1500);
}

async function main() {
  const hub = new ProcessHub();
  const host = spawn('host', '10.0.0.1', HOST);
  const guest = spawn('guest', '10.0.0.2', ROUTE);
  hub.add(host.child);
  hub.add(guest.child);
  try {
    // The host is in Tristram by about batch 4100; the guest sits on Join IPX
    // Games from about batch 3000, its list refreshed by the host's broadcasts.
    check('the host reaches its game', await atBatch(host, 4300, 480000));
    const hostGame = await snap(host, 'game');
    if (hostGame) {
      const g = inGame(hostGame);
      check(`the host is in Tristram (life ${g.red}, mana ${g.blue})`, g.ok);
    }
    await atBatch(guest, 3400, 120000);
    check('IPX frames from the host reached the guest', guest.rx > 0, `guest received ${guest.rx}`);
    await snap(guest, 'list');
    // The join is the one exchange with a deadline on both sides, and each
    // seat's clock is its own batch count: the guest idling in a menu retires
    // far more batches per second than the host drawing Tristram, so at 50 ms
    // a batch its join timeout ran out while the host was still answering
    // ("Unable to join game"). Slow both clocks to 10 ms a batch for the join,
    // which leaves guest time well below real time on either side.
    for (const s of [host, guest]) control(s, { cmd: 'tick-ms:10' });
    await sleep(2000);
    // The host's game ("GAL", the host hero's name) is the row below Create Game.
    await clickAt(guest, 445, 296);
    await clickAt(guest, 348, 446);
    // Joining then downloads the game state behind a progress bar, which moves
    // on game turns: at 10 ms a batch the host's turns came too slowly and the
    // bar sat at zero for five minutes. Back to the normal clock once the
    // handshake has had its time; watch for the HUD rather than a batch count.
    await sleep(20000);
    for (const s of [host, guest]) control(s, { cmd: 'tick-ms:50' });
    let g = null;
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline && !guest.exited) {
      const file = await snap(guest, 'game');
      if (file) { g = inGame(file); if (g.ok) break; }
      await sleep(15000);
    }
    check(`the guest is in Tristram (life ${g ? g.red : '-'}, mana ${g ? g.blue : '-'})`, !!(g && g.ok));
    check('frames flow both ways', host.rx > 0 && guest.rx > 0 && host.tx > 0 && guest.tx > 0,
      `host rx ${host.rx} tx ${host.tx}, guest rx ${guest.rx} tx ${guest.tx}`);
    await snap(host, 'after-join');
    console.log(`wire frames: host rx ${host.rx} tx ${host.tx}, guest rx ${guest.rx} tx ${guest.tx}`);
  } catch (err) {
    check(String(err && err.message || err), false);
  } finally {
    for (const s of [host, guest]) control(s, { action: 'quit' });
    await sleep(3000);
    for (const s of [host, guest]) if (!s.exited) s.child.kill();
  }
  if (!KEEP && !failures) {
    for (const f of ['host.log', 'guest.log']) fs.rmSync(path.join(OUT, f), { force: true });
  }
  console.log(failures ? `test-diablo-ipx-vlan-gameplay: ${failures} FAILED (logs in ${OUT})`
    : 'test-diablo-ipx-vlan-gameplay: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
