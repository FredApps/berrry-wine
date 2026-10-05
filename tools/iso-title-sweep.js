#!/usr/bin/env node
'use strict';

// Launch a list of games straight off a mounted shareware CD and report, for
// each one, how far it actually got -- so "get these running" has a work list
// instead of a pile of terminal scrollback.
//
//   node tools/iso-title-sweep.js --titles=ARCADE/PITFALL,STRATEGY/KYODAI
//   node tools/iso-title-sweep.js --list=titles.txt --jobs=4 --md=out.md
//
// One title per line in --list: `CATEGORY/DIR` with an optional `:EXE.EXE`
// override when the directory holds more than one candidate executable.
//
// Per title it stages the directory into a work tree (the CD is read-only and
// every guest here writes settings next to itself), expands the MS-Compress
// `.EX_`/`.DL_` payloads 377 of these games ship instead of a plain binary,
// picks the executable, runs it headless with a PNG capture, and classifies:
//
//   DRAWS     the capture has real content
//   BLANK     it ran without crashing and drew nothing (the desktop composited)
//   NOPIC     no capture, or a fully transparent one: nothing composited at
//             all, which is a harness/timing answer rather than an app one
//   MODAL     it stopped on its own message box (the text is reported)
//   CRASH     an unimplemented API or a trap (the blocker is reported)
//   INSTALLER the directory holds only a setup stub, so there is nothing to run
//   NOEXE     no executable at all
//
// The blocker column is the point: it is what names the next Win16 ordinal or
// Win32 handler to implement, and it comes from the run's own fail-fast log
// rather than from a guess about why a window stayed empty.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { expandSzdd } = require('./szdd');
const { loadPng, histogram } = require('./png-inspect');
const { parse: parseNe } = require('./ne-dump');

const REPO = path.resolve(__dirname, '..');

// `.EX_` is `.EXE` with its last letter dropped; the rest of the mapping is
// the same rule over the extensions this corpus actually uses.
const COMPRESSED_EXT = {
  EX_: 'EXE', DL_: 'DLL', HL_: 'HLP', IN_: 'INI', BM_: 'BMP', VB_: 'VBX',
  FO_: 'FON', TT_: 'TTF', WA_: 'WAV', MI_: 'MID', DA_: 'DAT', TX_: 'TXT',
  DR_: 'DRV', FN_: 'FNT', CU_: 'CUR', IC_: 'ICO', AV_: 'AVI', BI_: 'BIN',
};

// Setup stubs and the catalogue/registration binaries these discs bundle. A
// directory with nothing else in it cannot be launched without running an
// installer, which this sweep deliberately does not do.
const NOT_THE_GAME = /^(setup|install|_mssetup|_mstest|uninst\w*|catalog|games_|order|readme|register)\b/i;

function parseArgs(argv) {
  const flags = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) flags.set(arg.slice(2), true);
    else flags.set(arg.slice(2, eq), arg.slice(eq + 1));
  }
  return flags;
}

function readTitles(flags) {
  const out = [];
  const push = (line) => {
    const text = line.split('#')[0].trim();
    if (!text) return;
    const colon = text.lastIndexOf(':');
    if (colon > 0) out.push({ dir: text.slice(0, colon), exe: text.slice(colon + 1) });
    else out.push({ dir: text, exe: null });
  };
  if (flags.get('list')) {
    for (const line of fs.readFileSync(flags.get('list'), 'utf8').split('\n')) push(line);
  }
  if (typeof flags.get('titles') === 'string') {
    for (const item of flags.get('titles').split(',')) push(item);
  }
  return out;
}

function slugFor(dir) {
  return dir.replace(/[\\/]/g, '-').toLowerCase();
}

function stage(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) { stage(from, to); continue; }
    if (!entry.isFile()) continue;
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o644);
    const ext = path.extname(entry.name).slice(1).toUpperCase();
    const full = COMPRESSED_EXT[ext];
    if (!full) continue;
    try {
      const expanded = expandSzdd(fs.readFileSync(to), entry.name);
      fs.writeFileSync(path.join(dest, path.basename(entry.name, path.extname(entry.name)) + '.' + full), expanded);
    } catch {
      // Not every underscore extension is an SZDD stream; leave those alone.
    }
  }
}

// Shared 16-bit runtimes (CTL3D, CTL3DV2, BWCC) shipped with an installer
// rather than beside the game, so a directory copied straight off the disc is
// missing them and the loader stops on a module it cannot find. A runtime pool
// fills that in: every DLL in it that the picked executable actually imports
// is mounted, and nothing else is, so a title is never handed a runtime it did
// not ask for.
//
// They are mounted into the guest's system directory, not copied beside the
// exe, because that is where their installer puts them and CTL3D checks:
// LibMain compares its own directory against GetSystemDirectory and refuses to
// initialize anywhere else. The returned paths are passed as --win16-lib,
// which both lets the NE loader find them and mounts them under
// c:\windows\system.
function runtimeMounts(exe, pools) {
  if (!pools.length) return [];
  let refs;
  try { refs = new Set(parseNe(exe).h.modules.map(name => name.toUpperCase())); }
  catch { return []; }   // not an NE image, so it imports no Win16 runtime
  const mounts = [];
  const seen = new Set();
  for (const pool of pools) {
    if (!fs.existsSync(pool)) continue;
    for (const entry of fs.readdirSync(pool)) {
      if (!/\.dll$/i.test(entry)) continue;
      const module = path.basename(entry, path.extname(entry)).toUpperCase();
      if (!refs.has(module) || seen.has(module)) continue;
      seen.add(module);
      mounts.push(path.join(pool, entry));
    }
  }
  return mounts;
}

function pickExe(dir, override) {
  const names = fs.readdirSync(dir).filter(name => /\.exe$/i.test(name));
  if (override) {
    const hit = names.find(name => name.toLowerCase() === override.toLowerCase());
    return hit ? { exe: path.join(dir, hit) } : { error: `${override} is not in the staged directory` };
  }
  if (!names.length) return { error: 'no executable' };
  const playable = names.filter(name => !NOT_THE_GAME.test(name));
  if (!playable.length) return { installer: names.join(' ') };
  // The largest binary is the game in every multi-exe directory on this disc;
  // the small ones are level editors, high-score viewers and launchers.
  playable.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size);
  return { exe: path.join(dir, playable[0]), others: playable.slice(1) };
}

function run(cmd, args, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => { clearTimeout(timer); resolve({ out, code, killed }); });
  });
}

function pngVerdict(file) {
  if (!fs.existsSync(file)) return { drew: false, blank: false, note: 'no capture' };
  const { counts, total, transparent } = histogram(loadPng(file));
  const colors = [...counts.values()].sort((a, b) => b - a);
  const top = total ? colors[0] / total : 1;
  // A fully transparent capture and a flat desktop-teal one are different
  // failures and must not both read as "drew nothing": transparent means
  // nothing was composited at all (a capture taken before the first paint, or
  // on a box loaded enough that the run never got there), while teal means the
  // desktop composited and the app put no window on it. The byte count does
  // not separate them -- both are a couple of KB of PNG.
  if (total && transparent / total >= 0.99) {
    return { drew: false, blank: false, note: 'fully transparent — nothing composited' };
  }
  // A window frame alone already carries the Win98 greys, the caption blue and
  // its text, so "more than a flat fill" is the honest bar here; the report
  // prints the numbers so a borderline tile can be looked at.
  return {
    drew: colors.length >= 4 && top < 0.995,
    blank: true,
    note: `${colors.length} colors, top ${(top * 100).toFixed(1)}%`,
  };
}

function firstBlocker(log) {
  const lines = log.split('\n');
  const api = lines.find(line => line.includes('UNIMPLEMENTED API:'));
  if (api) return { kind: 'CRASH', detail: api.replace(/^.*UNIMPLEMENTED API:\s*/, '').replace(/=+$/, '').trim() };
  const win16 = [...lines].reverse().find(line => /^\[win16\] \S+ /.test(line) || /^\[win16\] \S+$/.test(line));
  if (/RuntimeError|unreachable|wasm trap/i.test(log)) {
    return { kind: 'CRASH', detail: win16 ? win16.replace('[win16] ', 'win16 ').slice(0, 120) : 'trap' };
  }
  return null;
}

function messageBoxes(log) {
  return log.split('\n').filter(line => line.startsWith('[MessageBox] ')).map(line => line.slice(13).trim());
}

async function sweepOne(title, opts) {
  const slug = slugFor(title.dir);
  const src = path.join(opts.mount, title.dir);
  const work = path.join(opts.work, slug);
  const shot = path.join(opts.work, slug + '.png');
  const row = { title: title.dir, slug, exe: null, verdict: 'NOEXE', blocker: '', note: '', png: shot };
  if (!fs.existsSync(src)) { row.blocker = 'not on the mount'; return row; }
  fs.rmSync(work, { recursive: true, force: true });
  stage(src, work);
  const picked = pickExe(work, title.exe);
  if (picked.installer) { row.verdict = 'INSTALLER'; row.blocker = picked.installer; return row; }
  if (picked.error) { row.blocker = picked.error; return row; }
  row.exe = path.basename(picked.exe);
  const mounts = runtimeMounts(picked.exe, opts.runtimeDirs);
  if (mounts.length) row.runtimes = mounts.map(m => path.basename(m));

  const args = [
    'test/run.js', '--no-build', `--exe=${picked.exe}`, '--vfs-include=**/*', '--quiet-api',
    `--max-batches=${opts.batches}`, `--max-seconds=${opts.seconds}`,
    `--input=${Math.max(1, opts.batches - 1000)}:png:${shot}`, '--no-close',
  ];
  for (const lib of mounts) args.push(`--win16-lib=${lib}`);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  const { out, killed } = await run(process.execPath, args, (opts.seconds + 25) * 1000);
  fs.writeFileSync(path.join(opts.work, slug + '.log'), out);

  const boxes = messageBoxes(out);
  const blocker = firstBlocker(out);
  const png = pngVerdict(shot);
  row.note = png.note;
  if (blocker) { row.verdict = blocker.kind; row.blocker = blocker.detail; }
  else if (killed) { row.verdict = 'TIMEOUT'; row.blocker = `no exit within ${opts.seconds + 25}s`; }
  else if (png.drew) row.verdict = 'DRAWS';
  else if (!png.blank) { row.verdict = 'NOPIC'; row.blocker = row.blocker || png.note; }
  else row.verdict = boxes.length ? 'MODAL' : 'BLANK';
  if (boxes.length) row.blocker = row.blocker || boxes[0].slice(0, 120);
  if (boxes.length) row.boxes = boxes;
  return row;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const titles = readTitles(flags);
  if (!titles.length) {
    console.error('usage: iso-title-sweep.js --titles=CAT/DIR[:EXE][,...] | --list=FILE');
    console.error('       [--mount=/Volumes/1000GAMES] [--work=DIR] [--jobs=N]');
    console.error('       [--batches=N] [--seconds=N] [--md=FILE] [--json=FILE] [--run-arg=...]');
    console.error('       [--runtime-dir=DIR[,DIR]]  pool of shared 16-bit runtime DLLs');
    process.exit(2);
  }
  const opts = {
    mount: flags.get('mount') || '/Volumes/1000GAMES',
    work: flags.get('work') || path.join(process.env.TMPDIR || '/tmp', 'iso-title-sweep'),
    batches: parseInt(flags.get('batches') || '40000', 10),
    seconds: parseInt(flags.get('seconds') || '30', 10),
    runtimeDirs: (typeof flags.get('runtime-dir') === 'string'
      ? flags.get('runtime-dir').split(',') : []).map(d => path.resolve(d)),
    extraArgs: [].concat(...process.argv.slice(2)
      .filter(a => a.startsWith('--run-arg=')).map(a => [a.slice(10)])),
  };
  fs.mkdirSync(opts.work, { recursive: true });
  const jobs = Math.max(1, parseInt(flags.get('jobs') || '3', 10));

  const rows = [];
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < titles.length) {
      const index = next++;
      const row = await sweepOne(titles[index], opts);
      rows[index] = row;
      console.log(`${row.verdict.padEnd(9)} ${row.title.padEnd(22)} ${(row.exe || '-').padEnd(14)} ${row.blocker}`);
    }
  }));

  const md = ['| title | exe | verdict | blocker / note |', '|---|---|---|---|'];
  for (const row of rows) {
    md.push(`| ${row.title} | ${row.exe || '-'} | ${row.verdict} | ${(row.blocker || row.note).replace(/\|/g, '\\|')} |`);
  }
  if (flags.get('md')) fs.writeFileSync(flags.get('md'), md.join('\n') + '\n');
  if (flags.get('json')) fs.writeFileSync(flags.get('json'), JSON.stringify(rows, null, 2));
  const tally = {};
  for (const row of rows) tally[row.verdict] = (tally[row.verdict] || 0) + 1;
  console.log('\n' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('  '));
  console.log(`captures and logs in ${opts.work}`);
}

// The capture classifier is the part with a wrong answer worth regressing
// against, so it is importable rather than only reachable through a CD mount.
module.exports = { pngVerdict };

if (require.main === module) {
  main().catch(error => { console.error(error && error.stack || error); process.exit(1); });
}
