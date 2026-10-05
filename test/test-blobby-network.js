#!/usr/bin/env node
// Blobby Volley — the DirectPlay lobby path (TODOS item 3, the async-I/O demo).
//
// Drives NETZWERKSPIEL down both branches and checks the app reaches its end
// state on each:
//
//   host:  MULTIPLAYER-OPTIONEN -> EIN SPIEL HOSTEN... -> SPIEL BEGINNEN!
//          => "WARTE AUF EINEN GAST..."   (session open, waiting)
//   guest: MULTIPLAYER-OPTIONEN -> ALS GAST SPIELEN... -> SPIELE SUCHEN
//          => a search of an empty room: nothing found, nothing joined
//
// Each run is alone on its wire, so the join itself is not here — that takes
// a second process, and test-blobby-vlan.js plays the whole match.
//
// The assertions are on the COM call sequence rather than on pixels, because
// the screens are text on a near-black beach and a text render regression is
// not what this test is for. Method ids are looked up BY NAME out of
// api_table.json and turned into the 0xC0DE0000|id marker the worker-thread
// API trace prints, so inserting an API ahead of them cannot rot this test.
//
// The regression that motivated it: DirectPlayCreate popped 20 bytes for a
// 3-argument function, so every call left the caller 4 bytes short and the
// game thread died (T1 state=exited) a few hundred batches later instead of
// showing a menu. "T1 never exited" is therefore a real check, not a formality.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(ROOT, 'packages', 'freeware', 'blobby-volley', 'volley.exe');

if (!fs.existsSync(EXE)) {
  console.log('SKIP  volley.exe not found at', EXE);
  process.exit(0);
}

// COM methods reach the worker-thread trace as "=> 0xc0deNNNN", where NNNN is
// the api_table id. Resolve by name so the numbers follow the table.
const apiTable = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'api_table.json'), 'utf8'));
function marker(name) {
  const e = apiTable.find(a => a.name === name);
  if (!e) throw new Error(`api_table.json has no entry named ${name}`);
  // >>> 0: the marker's top bit is set, and a bare | yields a negative int.
  return '0x' + ((0xC0DE0000 | e.id) >>> 0).toString(16);
}

// Menus are driven by keyboard. Mouse clicks used to work, but the game's
// click hit-test drifted ~33px above its drawn cursor (a mousedown on
// NETZWERKSPIEL started a local match), and a run stuck in gameplay at
// ~5 batches/s outlasts any sane timeout. Arrow keys + Enter select entries
// by position and are immune to that. The menu is up by batch ~450.
const DOWN = 40, UP = 38, ENTER = 13;
function key(batch, vk) {
  return [`${batch}:keydown:${vk}`, `${batch + 10}:keyup:${vk}`];
}

// Main menu: SPIEL STARTEN / NETZWERKSPIEL / ...  -> Down, Enter.
// MULTIPLAYER-OPTIONEN: EIN SPIEL HOSTEN... / ALS GAST SPIELEN... / ZURUECK.
// HOST-EINSTELLUNGEN and GAST-EINSTELLUNGEN both put their go entry
// (SPIEL BEGINNEN! / SPIELE SUCHEN) third -> Down, Down, Enter at batch 760.
function drive(label, extra, batches) {
  const input = [
    ...key(460, DOWN), ...key(520, ENTER),
    ...extra,
    ...key(700, DOWN), ...key(720, DOWN), ...key(760, ENTER),
  ].join(',');

  const args = [
    RUN,
    `--exe=${EXE}`,
    `--max-batches=${batches}`,
    '--batch-size=200000',
    // run.js stops itself; execFileSync's SIGTERM does not reliably end it.
    '--max-seconds=150',
    '--no-close',
    '--trace-api',
    `--input=${input}`,
  ];
  console.log(`$ node ${args.map(a => a.replace(ROOT, '.')).join(' ')}`);

  let out = '';
  let exitCode = 0;
  try {
    out = execFileSync('node', args, {
      cwd: ROOT, encoding: 'utf8', timeout: 300000,
      maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = (e.stdout || '').toString() + (e.stderr || '').toString();
    exitCode = e.status ?? 1;
  }
  return { label, out, exitCode };
}

const host = drive('host', key(620, ENTER), 1100);
const guest = drive('guest', [
  ...key(600, DOWN), ...key(620, ENTER),
], 1100);

// Only the key sequence differs between the two runs, so a marker that shows
// up before the menu is even reached would prove nothing -- look for the calls
// after the go entry was pressed.
function after(run, batch) {
  const i = run.out.indexOf(`at batch ${batch}`);
  return i === -1 ? '' : run.out.slice(i);
}
const hostTail = after(host, 760);
const guestTail = after(guest, 760);

const checks = [
  { name: 'host run exited cleanly', pass: host.exitCode === 0 },
  { name: 'guest run exited cleanly', pass: guest.exitCode === 0 },
  { name: 'no unimplemented API', pass: !/UNIMPLEMENTED API:/.test(host.out + guest.out) },

  // DPlayX is LoadLibrary'd, not imported -- if this stops firing the app has
  // taken some other path and every check below is vacuous.
  { name: 'app resolved DirectPlayCreate from DPlayX.dll',
    pass: /LoadLibraryA\(name="DPlayX\.dll"\)/.test(host.out)
       && /GetProcAddress.*name="DirectPlayCreate"/.test(host.out) },

  { name: 'host: DirectPlayCreate handed out an object',
    pass: /\[API T1\] DirectPlayCreate/.test(hostTail) },
  { name: 'host: InitializeConnection',
    pass: hostTail.includes(marker('IDirectPlay3_InitializeConnection')) },
  { name: 'host: Open (session created)',
    pass: hostTail.includes(marker('IDirectPlay3_Open')) },
  { name: 'host: CreatePlayer',
    pass: hostTail.includes(marker('IDirectPlay3_CreatePlayer')) },

  { name: 'guest: EnumSessions (discovery ran)',
    pass: guestTail.includes(marker('IDirectPlay3_EnumSessions')) },

  // Sessions come only from the wire now (09d4-dplay-net.wat): a search of
  // an empty room reports none, and the guest must not have joined anything.
  // The old shim invented a "Local Session" here, which the app then joined.
  { name: 'guest: an empty room offers no session to join',
    pass: !guestTail.includes(marker('IDirectPlay3_Open'))
       && !guestTail.includes(marker('IDirectPlay3_CreatePlayer')) },

  // The stack-discipline regression: a short pop kills the game thread a few
  // hundred batches after the call, with no error anywhere.
  { name: 'game thread survived the network path',
    pass: !/T1 .*state=exited/.test(host.out) && !/T1 .*state=exited/.test(guest.out) },
];

console.log('');
let failed = 0;
for (const c of checks) {
  console.log((c.pass ? 'PASS  ' : 'FAIL  ') + c.name);
  if (!c.pass) failed++;
}
console.log('');
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
