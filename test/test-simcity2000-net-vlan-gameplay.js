#!/usr/bin/env node
// SimCity 2000 Network Edition: one server and two clients on the virtual LAN.
//
//   node test/test-simcity2000-net-vlan-gameplay.js [--keep]
//
//   seat 10.0.0.1  2KSERVER.EXE  starts a game (Mayor's server)
//   seat 10.0.0.2  2KCLIENT.EXE  joins 10.0.0.1 as "Mayor"
//   seat 10.0.0.3  2KCLIENT.EXE  joins 10.0.0.1 as "Deputy"
//
// Everything is Winsock TCP (src/09d-winsock.wat) over vln/1 frames. The join
// route is the one in docs/re-notes/simcity-2000-network-edition.md: the
// clients' UI is app-drawn, so the route clicks screen positions and answers
// the join notices and the January budget dialog with dlg-cmd.
//
// HEAVY: three processes for ~7 minutes. Run it on a boat sandbox, not on the
// shared box -- the server overflows its own stack (EIP 0x2e2e) when a client's
// login ack is slow, which is the app's bug surfacing under load.
//
// Checks:
//   1. both clients exchanged TCP data with the server, in both directions;
//   2. the server did not crash (a 0x2e2e crash means "too slow", see re-notes);
//   3. each client draws a city of its own, not the join dialog or a blank MDI.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'scratch', 'simcity2000-net-vlan');
const SERVER_EXE = path.join(ROOT, 'test', 'binaries', 'candidates',
  'simcity-2000-network-edition-demo', 'installed');

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

// `[net] -> ... A -> B ...` and `[net] <- ...` frame lines with a payload.
function netLines(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith('[net]'));
}

function cityStats(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const colours = new Set();
  let lit = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (r + g + b > 60) lit++;
    colours.add((r << 16) | (g << 8) | b);
  }
  return { lit: lit / (png.width * png.height), colours: colours.size, data: png.data };
}

if (!fs.existsSync(SERVER_EXE)) {
  console.log('SKIP  SimCity 2000 Network Edition demo not installed at', SERVER_EXE);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const joinNotices = [];
for (let b = 150000; b <= 420000; b += 3000) joinNotices.push(`${b}:dlg-cmd:1`, `${b + 1500}:dlg-cmd:2`);
const join = (extra) => [
  '50:click:316:276', '7500:click:200:120', '15000:click:315:256',
  '22500:click:265:343', '31000:dlg-set-edit:1014:10.0.0.1', ...extra,
  '31500:click:408:232', ...joinNotices,
].join(',');
// The city is live near client batch 290000. Capture it then, while the
// session is up: a client whose server went away saves-and-exits, and its
// exit frame is an empty canvas.
const LIVE_PNG_BATCH = 300000;
const client = (name, inputs) => [
  '--app=simcity2000_net', '--tick-ms-per-batch=1', '--max-batches=100000000',
  '--no-close', '--stuck-after=100000000', '--quiet-api', '--trace-net',
  '--max-seconds=420',
  `--input=${inputs},${LIVE_PNG_BATCH}:png:${path.join(OUT, `${name}.png`)}`,
];

try {
  execFileSync('node', [
    path.join(ROOT, 'tools', 'vlan-pair.js'), `--log-dir=${OUT}`, '--stagger-ms=12000',
    // Bounded by time only: on a fast machine a batch cap ran out in 72 s and
    // the exiting server cut both clients off ("Connection to the server has
    // been lost") before they were photographed.
    '--', '--app=simcity2000_net_server', '--batch-size=100000', '--max-batches=1000000000',
    '--max-seconds=450', '--no-close', '--stuck-after=100000000', '--quiet-api', '--trace-net',
    '--input=100:post-cmd:57600,1400:click:180:313,2900:click:231:288',
    '--', ...client('mayor', join([])),
    '--', ...client('deputy', join(['31200:dlg-set-edit:1015:Deputy'])),
  ], { cwd: ROOT, encoding: 'utf8', timeout: 540000, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  if (err.code === 'ETIMEDOUT') {
    console.log(`FAIL  the three seats did not finish inside 540s; logs in ${OUT}`);
    process.exit(1);
  }
}

const serverLog = path.join(OUT, 'seat-1.log');
const serverText = fs.existsSync(serverLog) ? fs.readFileSync(serverLog, 'utf8') : '';
check('the server did not crash', !/\*\*\* CRASH/.test(serverText),
  /0x00002e2e|EIP=0x2e2e/i.test(serverText)
    ? 'server overflowed its login-ack stack buffer: the box was too slow (see re-notes)'
    : 'see seat-1.log');

for (const [n, name] of [[2, 'mayor'], [3, 'deputy']]) {
  const lines = netLines(path.join(OUT, `seat-${n}.log`));
  const out = lines.filter(l => l.includes('->') && l.includes('10.0.0.1') && /len=([1-9]\d*)/.test(l));
  const back = lines.filter(l => l.includes('<-') && l.includes('10.0.0.1') && /len=([1-9]\d*)/.test(l));
  check(`${name} talks to the server (${out.length} sent, ${back.length} received with payload)`,
    out.length >= 20 && back.length >= 20);
}

const mayor = path.join(OUT, 'mayor.png');
const deputy = path.join(OUT, 'deputy.png');
if (fs.existsSync(mayor) && fs.existsSync(deputy)) {
  const m = cityStats(mayor);
  const d = cityStats(deputy);
  // A client still at "Could Not Connect" or the join form is a grey dialog on
  // a dark frame; a live city view is a lit, many-coloured terrain map.
  check(`mayor draws a city (${(m.lit * 100).toFixed(0)}% lit, ${m.colours} colours)`,
    m.lit > 0.5 && m.colours > 64);
  check(`deputy draws a city (${(d.lit * 100).toFixed(0)}% lit, ${d.colours} colours)`,
    d.lit > 0.5 && d.colours > 64);
  check('the two clients are separate players (frames differ)',
    m.data.length !== d.data.length || !m.data.equals(d.data));
} else {
  check('both clients wrote a frame', false, `missing ${mayor} or ${deputy}`);
}

if (!process.argv.includes('--keep') && !failures) {
  for (const f of ['seat-1.log', 'seat-2.log', 'seat-3.log']) fs.rmSync(path.join(OUT, f), { force: true });
}
console.log(failures ? `test-simcity2000-net-vlan-gameplay: ${failures} FAILED`
  : 'test-simcity2000-net-vlan-gameplay: all checks passed');
process.exit(failures ? 1 : 0);
