#!/usr/bin/env node
// Two Quake II demo processes play one deathmatch over the virtual LAN.
//
//   node test/test-quake2-vlan-gameplay.js [--keep]
//
//   seat 10.0.0.1  +set deathmatch 1 +set maxclients 4 +map demo1   (server)
//   seat 10.0.0.2  +connect 10.0.0.1                                (client)
//        │                                                  │
//        │  <- getchallenge (17)      challenge ->          │  repeats while the
//        │  <- connect + userinfo (92)                      │  server loads its map
//        │  <- signon stages          configstrings ->      │
//        │  <- usercmds, every frame  snapshots, every frame│  <- "in the game"
//
// Everything is UDP: socket/bind/setsockopt(SO_BROADCAST)/ioctlsocket(FIONBIO)
// /sendto/recvfrom, served by src/09d-winsock.wat. The checks read --trace-net
// and the client's last frame, because the one thing a headless run cannot
// show is Quake's own console:
//
//   1. the handshake completes: the client sent `connect`, and after it a
//      sustained stream in BOTH directions -- a client that never got its
//      challenge answered would still be sending getchallenge;
//   2. the client renders a world of its own: its frame is a lit scene, not a
//      console or a loading plaque, and it is not the server's frame.
//
// Measured 2026-09-20: 1,343 in-game usercmds from the client in a 200s run,
// after ~120 getchallenge/connect retries during the server's map load.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'scratch', 'quake2-vlan');
const EXE = path.join(ROOT, 'test', 'binaries', 'candidates', 'quake-2-demo-installer',
  'installed-extracted', 'Install', 'Data', 'quake2.exe');

const CONNECT_LEN = 92;      // "connect" + protocol + qport + challenge + userinfo

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

// Sends as `[net] -> ... len=N`, in order.
function sends(log) {
  return fs.readFileSync(log, 'utf8').split('\n')
    .filter(l => l.startsWith('[net] ->'))
    .map(l => Number((/len=(\d+)/.exec(l) || [])[1]));
}

function sceneStats(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const colours = new Set();
  let lit = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    if (r + g + b > 60) lit++;
    colours.add((r << 16) | (g << 8) | b);
  }
  return { lit: lit / (png.width * png.height), colours: colours.size, data: png.data };
}

if (!fs.existsSync(EXE)) {
  console.log('SKIP  Quake II demo not installed at', EXE);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const seat = (args, png) => [
  '--app=quake2_demo', `--args=${args}`,
  '--quiet-api', '--quiet-blocks', '--trace-net',
  '--batch-size=20000', '--max-batches=100000000', '--max-seconds=150',
  '--no-close', `--png=${path.join(OUT, png)}`,
];
try {
  execFileSync('node', [
    path.join(ROOT, 'tools', 'vlan-pair.js'), `--log-dir=${OUT}`,
    '--', ...seat('+set vid_ref soft +set deathmatch 1 +set maxclients 4 +map demo1', 'server.png'),
    '--', ...seat('+set vid_ref soft +connect 10.0.0.1', 'client.png'),
  ], { cwd: ROOT, encoding: 'utf8', timeout: 280000, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  // A seat's own exit code is reported below by what it left behind; only a
  // pair that never finished is fatal here.
  if (err.code === 'ETIMEDOUT') {
    console.log(`FAIL  the pair did not finish inside 280s; logs in ${OUT}`);
    process.exit(1);
  }
}

const client = sends(path.join(OUT, 'seat-2.log'));
const server = sends(path.join(OUT, 'seat-1.log'));
const connectAt = client.lastIndexOf(CONNECT_LEN);
check('the client asked to connect', connectAt >= 0,
  `client sizes: ${[...new Set(client)].join(',')}`);
const after = client.slice(connectAt + 1);
check(`the client kept talking after connecting (${after.length} packets)`,
  after.length >= 100 && !after.includes(17),
  'a client still sending getchallenge (17 bytes) never had its connect accepted');
check(`the server answered all along (${server.length} packets)`, server.length >= 100);

const clientPng = path.join(OUT, 'client.png');
const serverPng = path.join(OUT, 'server.png');
if (fs.existsSync(clientPng) && fs.existsSync(serverPng)) {
  const c = sceneStats(clientPng);
  const s = sceneStats(serverPng);
  // Measured: a client that lost its signon to a full ring drew 16% lit in 43
  // colours; healthy clients drew 50-93% in 146-166, the low end being a
  // darker spawn room that either build lands in, so 50% is not a margin.
  check(`the client renders a lit world (${(c.lit * 100).toFixed(0)}% lit, ${c.colours} colours)`,
    c.lit > 0.3 && c.colours > 100);
  const differ = c.data.length !== s.data.length || !c.data.equals(s.data);
  check('the client is its own player, not a copy of the server\'s view', differ);
} else {
  check('both seats wrote a frame', false, `missing ${clientPng} or ${serverPng}`);
}

if (!process.argv.includes('--keep') && !failures) {
  for (const f of ['seat-1.log', 'seat-2.log']) fs.rmSync(path.join(OUT, f), { force: true });
}
console.log(failures ? `test-quake2-vlan-gameplay: ${failures} FAILED`
  : 'test-quake2-vlan-gameplay: all checks passed');
process.exit(failures ? 1 : 0);
