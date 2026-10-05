#!/usr/bin/env node
'use strict';
// Build the local Morrowind candidate from YOUR OWN retail disc image.
//
//   node tools/prepare-morrowind.js [--iso=downloads/Morrowind.iso] [--force] [--out=DIR]
//                                   [--regsvr32=PATH]
//
// Morrowind is retail, not shareware or a demo: nothing it is made of may be
// committed or deployed. lib/apps.js carries only the `morrowind` entry that
// points at the tree this tool writes, and tools/deploy-berrry.js refuses the
// whole candidate directory by name. Everything below lands in
// test/binaries/candidates/morrowind/, which .gitignore already covers.
//
// What the tree is, measured against a real install (5,911 of its 5,918 files
// are InstallShield output byte for byte; the other 7 are the disc's videos):
//
//   installed/            data1.cab's App_Executables + Data_Files groups
//                         ("Data Files"), plus quartz.dll, devenum.dll and
//                         l3codecx.ax out of the disc's DX81eng.exe -- the
//                         title music is an MP3 played through DirectShow.
//   cd/                   the disc's top-level autorun files and Video\*.bik.
//                         The game's CD check scans GetLogicalDriveStrings for
//                         a DRIVE_CDROM holding AutoRunMorrowind.exe, and the
//                         intro videos are read from d:\Video.
//   cd/Morrowind.cue      one MODE1/2048 track over the image itself, so D: is
//                         a CD-ROM labelled MORROWIND (lib/cdrom.js mountCue).
//                         The track is data, so no host ever fetches it.
//   .wine-assembly-browser.json
//                         the localFileManifest both hosts read, including
//                         the ~430 registry keys DirectShow's own
//                         DllRegisterServer writes (the title music is an MP3
//                         through a filter graph), produced by running
//                         regsvr32 /s on the three DLLs inside the emulator.
//
// Needs `unshield` and `7z` on PATH (brew install unshield p7zip).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const iso9660 = require('../lib/iso9660');

const ROOT = path.join(__dirname, '..');
const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const OUT = path.resolve(ROOT, arg('out', 'test/binaries/candidates/morrowind'));
const ISO = path.resolve(ROOT, arg('iso', 'downloads/Morrowind.iso'));
const FORCE = process.argv.includes('--force');
// The DX 8.1 redist on the disc has no regsvr32; any Win9x copy does the job.
const REGSVR32 = path.resolve(ROOT, arg('regsvr32',
  'test/binaries/win98-games-a-d/DrakanOrderOfTheFlameDemoD3D/DirectX/REGSVR32.EXE'));
const DSHOW = ['quartz.dll', 'devenum.dll', 'l3codecx.ax'];

function die(msg) { console.error(`prepare-morrowind: ${msg}`); process.exit(1); }
function need(tool) {
  try { execFileSync('which', [tool], { stdio: 'ignore' }); }
  catch (_) { die(`\`${tool}\` is not on PATH (brew install unshield p7zip)`); }
}

function fdProvider(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  return {
    fd, size,
    readRange(offset, length) {
      const len = Math.max(0, Math.min(length, size - offset));
      const buf = Buffer.allocUnsafe(len);
      let got = 0;
      while (got < len) {
        const n = fs.readSync(fd, buf, got, len - got, offset + got);
        if (n <= 0) break;
        got += n;
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, got);
    },
  };
}

// Stream one ISO entry to disk; data2.cab alone is 411 MB.
function copyEntry(provider, entry, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.openSync(dest, 'w');
  const chunk = Buffer.allocUnsafe(8 << 20);
  for (let done = 0; done < entry.length;) {
    const want = Math.min(chunk.length, entry.length - done);
    const n = fs.readSync(provider.fd, chunk, 0, want, entry.offset + done);
    if (n <= 0) die(`short read in ${entry.path}`);
    fs.writeSync(out, chunk, 0, n);
    done += n;
  }
  fs.closeSync(out);
}

function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function registerDirectShow(installed) {
  const storage = require('../lib/storage');
  storage.clearStore();
  const fresh = storage.exportStore();
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mw-reg-'));
  try {
    if (!fs.existsSync(REGSVR32)) {
      die(`no regsvr32.exe at ${REGSVR32}; pass --regsvr32=PATH to any Win9x copy`);
    }
    fs.mkdirSync(path.join(work, 'dx'));
    const exe = path.join(work, 'dx', 'regsvr32.exe');
    fs.copyFileSync(REGSVR32, exe);
    for (const name of DSHOW) fs.copyFileSync(path.join(installed, name), path.join(work, 'dx', name));
    let prev = null;
    for (const name of ['devenum.dll', 'quartz.dll', 'l3codecx.ax']) {
      const out = path.join(work, `reg-${name}.json`);
      execFileSync(process.execPath, [path.join(ROOT, 'test/run.js'), `--exe=${exe}`, `--args=/s ${name}`,
        `--vfs-include=${DSHOW.join(',')}`, '--quiet-api', '--max-batches=20000',
        '--max-seconds=60', ...(prev ? [`--reg-import=${prev}`] : []), `--reg-export=${out}`],
      { cwd: ROOT, stdio: 'ignore' });
      prev = out;
    }
    const registered = JSON.parse(fs.readFileSync(prev, 'utf8'));
    const added = {};
    for (const key of Object.keys(registered).sort()) {
      if (fresh[key] !== registered[key]) added[key] = registered[key];
    }
    if (!Object.keys(added).some(k => /\{e436ebb3-524f-11ce-9f53-0020af0ba770\}/i.test(k))) {
      die('regsvr32 did not register the DirectShow filter graph (CLSID_FilterGraph)');
    }
    return added;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  if (!fs.existsSync(ISO)) die(`no disc image at ${ISO} (pass --iso=PATH to your own copy)`);
  const provider = fdProvider(ISO);
  const iso = iso9660.parseIso(provider);
  if (iso.volumeLabel !== 'MORROWIND') die(`${ISO} is labelled "${iso.volumeLabel}", not MORROWIND`);
  const entry = p => iso9660.findEntry(iso, p) || die(`${p} is not on the disc`);

  // cd/: what the game reads from D: directly.
  const cd = path.join(OUT, 'cd');
  const cdFiles = iso.files.filter(f => !f.isDirectory &&
    (/^video\\/i.test(f.path) || /^(autorunmorrowind\.exe|autorun\.inf)$/i.test(f.path)));
  for (const f of cdFiles) {
    const dest = path.join(cd, ...f.path.split('\\'));
    if (FORCE || !fs.existsSync(dest) || fs.statSync(dest).size !== f.length) copyEntry(provider, f, dest);
  }
  const isoLink = path.join(cd, 'Morrowind.iso');
  fs.rmSync(isoLink, { force: true });
  fs.symlinkSync(ISO, isoLink);
  fs.writeFileSync(path.join(cd, 'Morrowind.cue'),
    'FILE "Morrowind.iso" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n');

  // installed/: what Setup.exe would have put on C:.
  const installed = path.join(OUT, 'installed');
  if (FORCE || !fs.existsSync(path.join(installed, 'Morrowind.exe'))) {
    need('unshield'); need('7z');
    const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mw-prep-'));
    try {
      for (const name of ['data1.cab', 'data1.hdr', 'data2.cab', 'DX81eng.exe']) {
        copyEntry(provider, entry(name), path.join(work, 'disc', name));
      }
      execFileSync('unshield', ['-d', path.join(work, 'cab'), 'x', path.join(work, 'disc', 'data1.cab')],
        { stdio: 'ignore' });
      execFileSync('7z', ['x', '-y', `-o${path.join(work, 'dx')}`, path.join(work, 'disc', 'DX81eng.exe')],
        { stdio: 'ignore' });
      fs.rmSync(installed, { recursive: true, force: true });
      fs.cpSync(path.join(work, 'cab', 'App_Executables'), installed, { recursive: true });
      fs.cpSync(path.join(work, 'cab', 'Data_Files'), path.join(installed, 'Data Files'), { recursive: true });
      for (const name of DSHOW) {
        const src = path.join(work, 'dx', name);
        if (!fs.existsSync(src)) die(`${name} is not inside DX81eng.exe`);
        fs.copyFileSync(src, path.join(installed, name));
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  for (const name of ['Morrowind.exe', 'binkw32.dll', 'Data Files/Morrowind.esm', ...DSHOW]) {
    if (!fs.existsSync(path.join(installed, name))) die(`installed/${name} is missing; rerun with --force`);
  }

  // The DirectShow registration the title music needs. regsvr32 registers
  // the three DLLs inside the emulator -- devenum
  // first, because quartz registers its filters through devenum's filter
  // mapper -- and only the keys that adds over a fresh store go in the
  // manifest, which both hosts import at launch.
  const manifestPath = path.join(OUT, '.wine-assembly-browser.json');
  let registry = null;
  try { registry = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).registry || null; } catch (_) {}
  if (FORCE || !registry) registry = registerDirectShow(installed);

  // The manifest. Videos are served from cd/ under both names the game uses
  // and skipped under installed/, so a browser fetches each 60 MB file once.
  const files = [];
  for (const rel of walk(installed)) {
    if (/^data files\/video\//i.test(rel)) continue;
    files.push({ url: `installed/${rel}`, vfsPath: 'c:\\' + rel.replace(/\//g, '\\') });
  }
  for (const f of cdFiles) {
    const url = `cd/${f.path.replace(/\\/g, '/')}`;
    const vfsPaths = ['d:\\' + f.path];
    if (/^video\\/i.test(f.path)) vfsPaths.push('c:\\Data Files\\' + f.path);
    files.push({ url, vfsPaths });
  }
  const manifest = { schemaVersion: 1, files, trackSizes: { 'Morrowind.iso': provider.size }, registry };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
  fs.closeSync(provider.fd);
  console.log(`prepare-morrowind: ${files.length} files and ${Object.keys(registry).length} ` +
    `registry keys in the manifest, D: from ${ISO}`);
}

main();
