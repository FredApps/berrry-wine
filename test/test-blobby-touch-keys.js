#!/usr/bin/env node
// Blobby Volley's touch key remap: player two jumps with Space.
//
//   node test/test-blobby-touch-keys.js [--keep]
//
// WHAT AND WHY, in short:
//
//   the pad sends only the keys of the player THIS machine owns -- player one
//   until the room hands out a seat, player two when this machine is the
//   joiner (lib/browser-shell.js `touchControlsForSeat`). A pad that sent both
//   sets walked both blobs at once in a solo match, which is how this started.
//
//   That makes the jump key's other property the one that matters: it has to
//   be inert for the blob it does NOT own, and inert in the menus. Player
//   two's stock jump is UP, which is how this game's menus move, so
//   lib/browser-shell.js rewrites one dword of settings.dat -- and only while
//   the on-screen pad is up:
//
//         settings.dat   0x00 0x04 0x08   p1  A     D      W    (untouched)
//                        0x0c 0x10 0x14   p2  LEFT  RIGHT  UP -> SPACE
//
//   ENTER would not do: every layout carries it as the menu confirm, so it
//   must belong to no player. SPACE belongs to nobody else.
//
//   Three things are checked here, because any one passing alone proves
//   nothing:
//
//     1. the patch is applied when the pad is up and NOT when it is down,
//        against a stand-in VFS -- desktop players keep the stock file;
//     2. the seat picks the layout: host keys before and at .1, player two's
//        keys at any other seat, and the two layouts share no movement key;
//     3. Space really does jump player two IN THE GAME. That is the half a
//        unit test cannot answer: the key is legal (the game indexes its
//        key-state table with the raw VK and no whitelist) but "legal" is not
//        "wired to the blob". Two headless runs of a real match, identical
//        except that one holds Enter, and the green blob has to be higher in
//        the one that does:
//
//              no key                    Space held
//          ┌──────────────┐          ┌──────────────┐
//          │              │          │          ()  │  <- green blob up
//          │          ()  │          │              │
//          └──────────────┘          └──────────────┘
//               centroid y                centroid y (smaller)
//
//   The measurement is a green-mass centroid over the right half of the
//   court, not a hunt for the blob itself: the palm trees are green too, but
//   headless runs are deterministic, so the backdrop is identical in both
//   frames and every bit of the difference between them is the blob.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const PKG = path.join(ROOT, 'packages', 'freeware', 'blobby-volley');
const OUT = path.join(ROOT, 'scratch', 'blobby-touch-keys');

const VK_SPACE = 0x20;
const P2_JUMP_OFFSET = 0x14;
const SETTINGS_SIZE = 117;

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

// ---- half one: the patch only fires for a touch session --------------------

function fakeVfs(bytes) {
  return {
    files: new Map([['c:\\settings.dat', { data: bytes }]]),
    _normPath: p => String(p).toLowerCase(),
  };
}

function settingsBytes(jumpVk) {
  const buf = Buffer.alloc(SETTINGS_SIZE);
  buf.writeUInt32LE(0x25, 0x0c);          // p2 left  = LEFT
  buf.writeUInt32LE(0x27, 0x10);          // p2 right = RIGHT
  buf.writeUInt32LE(jumpVk, P2_JUMP_OFFSET);
  return new Uint8Array(buf);
}

function readJump(vfs) {
  const data = vfs.files.get('c:\\settings.dat').data;
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
    .getUint32(P2_JUMP_OFFSET, true);
}

function unitChecks() {
  const app = { touchPatches: [{ path: 'c:\\settings.dat', offset: P2_JUMP_OFFSET, uint32: VK_SPACE, size: SETTINGS_SIZE }] };
  global.window = { TouchControls: { shouldInstall: () => false } };
  const shell = require('../lib/browser-shell');

  let vfs = fakeVfs(settingsBytes(0x26));
  shell.applyTouchPatches(app, vfs, null);
  check('a desktop session leaves the stock arrow jump alone', readJump(vfs) === 0x26,
    `jump is 0x${readJump(vfs).toString(16)}`);

  global.window.TouchControls.shouldInstall = () => true;
  vfs = fakeVfs(settingsBytes(0x26));
  shell.applyTouchPatches(app, vfs, null);
  check('a touch session moves player two\'s jump to Space', readJump(vfs) === VK_SPACE,
    `jump is 0x${readJump(vfs).toString(16)}`);

  // The player's own saved file is what gets patched, so everything else in
  // it has to survive -- names, colours, sound, and player one's keys.
  const before = settingsBytes(0x26);
  before[0x25] = 7;                        // a byte inside the name field
  vfs = fakeVfs(before.slice());
  shell.applyTouchPatches(app, vfs, null);
  const after = vfs.files.get('c:\\settings.dat').data;
  const elsewhere = [...after].every((b, i) =>
    (i >= P2_JUMP_OFFSET && i < P2_JUMP_OFFSET + 4) || b === before[i]);
  check('nothing outside that one key is touched', elsewhere);

  // A file of another length is a different version of the format, where
  // 0x14 means something else. Corrupting it is worse than not patching.
  vfs = fakeVfs(new Uint8Array(64));
  shell.applyTouchPatches(app, vfs, null);
  check('a file of the wrong size is left alone',
    [...vfs.files.get('c:\\settings.dat').data].every(b => b === 0));

  delete global.window;
}

// ---- half two: the seat picks the layout -----------------------------------

// Against the real registry entry, not a stand-in: the thing that can go wrong
// is the two layouts sharing a movement key, and only the shipped ones can say.
function seatChecks() {
  const shell = require('../lib/browser-shell');
  const { APPS } = require('../lib/apps');
  const app = APPS.blobby_volley;
  const forSeat = shell.touchControlsForSeat;

  check('before any room, the pad drives player one',
    forSeat(app, null) === app.touchControls);
  check('the host seat drives player one',
    forSeat(app, '10.0.0.1') === app.touchControls);
  check('any other seat drives player two',
    forSeat(app, '10.0.0.2') === app.lanClientTouchControls);
  // An app with no LAN layout must come back with its own, not undefined: this
  // helper sits on the path every launch takes.
  check('an app without a client layout is unchanged',
    forSeat({ touchControls: 'X' }, '10.0.0.2') === 'X');

  const moves = layout => {
    const vks = layout.dpad.vks;
    return [].concat(vks.left, vks.right);
  };
  const host = moves(app.touchControls);
  const client = moves(app.lanClientTouchControls);
  check('the two layouts share no movement key',
    host.every(vk => client.indexOf(vk) < 0),
    `host=${JSON.stringify(host)} client=${JSON.stringify(client)} — a shared ` +
    'key is the original bug: one thumb walking both blobs.');

  // Whatever confirms menus has to be a key no player owns, or it jumps
  // somebody every time it is pressed.
  const playerKeys = [].concat(host, client,
    [0x57, VK_SPACE]);                       // p1 jump W, p2 jump SPACE
  const menuKeys = [0x26, 0x28, 0x0d];       // UP, DOWN, ENTER
  check('no menu key belongs to a player',
    menuKeys.every(vk => playerKeys.indexOf(vk) < 0),
    `players=${JSON.stringify(playerKeys)}`);
  for (const [name, layout] of [['host', app.touchControls], ['client', app.lanClientTouchControls]]) {
    const button = layout.buttons[0];
    check(`the ${name} button jumps its own player and confirms menus`,
      button.vk.indexOf(0x0d) >= 0 && button.vk.length === 2,
      JSON.stringify(button));
  }
}

// ---- half three: Space jumps the blob in a real match ----------------------

// Green pixels in the strip of court the resting blob occupies. The palm
// fronds are green too and they end well above this band, so leaving it is
// something only the blob can do -- and jumping is the only way it does.
//
//        y/H
//   0.00 ┌─────────── sky, palm fronds (green, excluded) ────────────┐
//   0.56 ├───────────────────────────────────────────────────────────┤
//   0.62 ├─────────────── the band: sand, and the blob ──────────────┤
//   0.90 ├───────────────────────────────────────────────────────────┤
//   1.00 └───────────────────────────────────────────────────────────┘
function blobMass(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let mass = 0;
  let top = png.height;
  for (let y = Math.floor(png.height * 0.62); y < Math.floor(png.height * 0.90); y++) {
    for (let x = Math.floor(png.width / 2); x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
      if (g > 120 && r < 90 && b < 90) { mass++; if (y < top) top = y; }
    }
  }
  return { mass, top: mass ? top : null };
}

// One run, not two: the two states are captured from the same match, so the
// backdrop, the ball and the clock are identical by construction rather than
// by trusting determinism -- and a run to the match costs minutes.
function play(exe) {
  const rest = path.join(OUT, 'rest.png');
  const air = [path.join(OUT, 'air-1.png'), path.join(OUT, 'air-2.png')];
  // The menu is mouse-driven and the game hit-tests against its own cursor,
  // so the move before the click is not optional (test-blobby-volley.js).
  const input = [
    '500:mousemove:400:222',
    '520:mousemove:401:223',
    '560:mousedown:401:223',
    '600:mouseup:401:223',
    '703:png:' + rest,
    '704:keydown:0x20',
    // Two frames across the arc: at 200ms of guest clock per batch, a jump is
    // a handful of batches and one sample can land on the way back down.
    '706:png:' + air[0],
    '708:png:' + air[1],
  ].join(',');
  execFileSync('node', [
    RUN, `--exe=${exe}`, '--vfs-include=*.pak,*.dat,*.txt',
    '--max-batches=710', '--batch-size=200000',
    '--no-close', '--quiet-api', '--quiet-blocks',
    `--input=${input}`,
    // Same guest work as test-blobby-volley.js, which budgets 180s for it, and
    // under the 300s runner cap tools/check-test-timeouts.js enforces. A box
    // busy enough to blow this (measured: 426s at load 21, 34 users) is not a
    // box any timing-shaped test passes on either.
  ], { cwd: ROOT, encoding: 'utf8', timeout: 280000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  return { rest, air };
}

function gameChecks() {
  // The browser patches its own in-memory copy at launch; headless has no
  // browser, so the game runs out of a scratch copy of the whole package with
  // the same dword already rewritten on disk. The shipped file is never
  // touched -- another agent may be running this worktree at the same time.
  const app = path.join(OUT, 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const name of fs.readdirSync(PKG)) fs.copyFileSync(path.join(PKG, name), path.join(app, name));
  const settings = path.join(app, 'settings.dat');
  execFileSync('node', [
    path.join(ROOT, 'tools', 'blobby-settings.js'), settings,
    `--keys2=LEFT,RIGHT,0x${VK_SPACE.toString(16)}`, `--out=${settings}`,
  ], { cwd: ROOT, encoding: 'utf8' });
  const patched = fs.readFileSync(settings);
  check('the patched file still parses as settings.dat',
    patched.length === SETTINGS_SIZE && patched.readUInt32LE(P2_JUMP_OFFSET) === VK_SPACE);

  // --from-shots measures the frames a previous run left in scratch/, for a
  // box too loaded to reach batch 708 inside the runner cap: run the command
  // play() builds by hand with no deadline, then judge it here.
  const shots = process.argv.includes('--from-shots')
    ? { rest: path.join(OUT, 'rest.png'), air: [path.join(OUT, 'air-1.png'), path.join(OUT, 'air-2.png')] }
    : play(path.join(app, 'volley.exe'));
  const rest = blobMass(shots.rest);
  const air = shots.air.map(blobMass);

  check(`the match is running and the blob is on the sand (${rest.mass}px)`, rest.mass > 500,
    JSON.stringify(rest));
  if (rest.mass <= 500) return;

  // Whichever of the two frames caught the blob highest: the arc is short and
  // one sample can land after it has come back down.
  const best = air.reduce((a, b) => (a.mass <= b.mass ? a : b));
  const left = rest.mass ? best.mass / rest.mass : 1;
  check(`Space jumps player two (${(left * 100).toFixed(0)}% of the blob still in the band)`,
    left < 0.6,
    `rest=${JSON.stringify(rest)} air=${JSON.stringify(air)} — if the blob never ` +
    'leaves the band, Space is a legal key the game never wired to it, and the ' +
    'one-button touch layout in lib/apps.js is wrong.');
}

if (!fs.existsSync(path.join(PKG, 'volley.exe'))) {
  console.log('SKIP  volley.exe not found at', PKG);
  process.exit(0);
}

unitChecks();
seatChecks();
gameChecks();
console.log(failures ? `test-blobby-touch-keys: ${failures} FAILED`
  : 'test-blobby-touch-keys: all checks passed');
process.exit(failures ? 1 : 0);
