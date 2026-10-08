#!/usr/bin/env node
'use strict';
// Build the local `myth_tfl` app tree from YOUR OWN Myth: The Fallen Lords
// retail disc image (candidate myth-the-fallen-lords; the ISO comes from
// tools/fetch-candidate-corpus.js --id=myth-the-fallen-lords).
//
//   node tools/prepare-myth-tfl.js [--root=DIR] [--force] [--manifest-only]
//
// Retail media: nothing here may be committed or deployed. lib/apps.js holds
// only the `myth_tfl` entry pointing at this tree, and tools/deploy-berrry.js
// refuses the candidate directory by name. Everything lands under --root
// (default test/binaries/candidates/myth-the-fallen-lords/), which .gitignore
// covers.
//
//   installed/                the "Small" install the disc's own MindVision
//                             VISE Setup.exe writes when it runs in the
//                             emulator from the ISO mounted as D: (myth_tfl.exe,
//                             its DLLs, modules\tcpip.dll, tags\tags.gor and
//                             tags\scrap.gor; art/sound/movies stay on the CD).
//   sources/myth-tfl.cue      one MODE1/2048 track over the ISO, so the page
//                             and --app=myth_tfl mount it lazily as CD-ROM D:
//                             labelled MYTH_TFL (lib/apps.js cdAudio).
//   .wine-assembly-browser.json
//                             the localFileManifest: every installed file except
//                             the exe, at its c:\ path.
//
// --manifest-only rewrites the cue and the manifest from an existing installed/
// (what a second checkout needs once the tree has been copied there).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = name => process.argv.includes(`--${name}`);
const root = path.resolve(ROOT, arg('root', 'test/binaries/candidates/myth-the-fallen-lords'));
const iso = path.join(root, 'sources', 'myth-tfl.iso');
const installed = path.join(root, 'installed');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function runSetup() {
  if (!fs.existsSync(iso)) {
    throw new Error(`${iso} is missing: node tools/fetch-candidate-corpus.js --id=myth-the-fallen-lords`);
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'myth-tfl-setup-'));
  // Welcome -> notes -> destination -> setup type (Small, the default) ->
  // program folder -> ready: six "Next >" clicks at the VISE button's 640x480
  // position. The final "Install DirectX 5.0?" box is answered by --max-seconds
  // ending the run after Setup has written every file.
  const clicks = [6000, 9000, 12000, 15000, 18000, 21000].map(b => `${b}:click:453:393`).join(',');
  const args = [path.join(ROOT, 'test', 'run.js'), `--iso=${iso}`, '--iso-exe=Setup.exe',
    '--quiet-api', '--stuck-after=0', '--batch-size=200000', '--max-seconds=300',
    '--max-batches=100000000', `--input=${clicks}`, `--save-vfs=${out}`,
    '--save-vfs-prefix=c:\\program files'];
  console.log(`[myth] running the disc's Setup.exe in the emulator (about 5 minutes)`);
  const run = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const text = `${run.stdout || ''}${run.stderr || ''}`;
  if (!/Myth has been successfully installed/.test(text)) {
    throw new Error(`Setup did not report success (exit ${run.status}); last output:\n${text.slice(-2000)}`);
  }
  const tree = path.join(out, 'program files', 'myth_tfl');
  if (!fs.existsSync(path.join(tree, 'myth_tfl.exe'))) throw new Error(`no myth_tfl.exe under ${tree}`);
  fs.rmSync(installed, { recursive: true, force: true });
  fs.renameSync(tree, installed);
  fs.rmSync(out, { recursive: true, force: true });
}

function writeCueAndManifest() {
  if (!fs.existsSync(path.join(installed, 'myth_tfl.exe'))) {
    throw new Error(`${installed}/myth_tfl.exe is missing: run without --manifest-only`);
  }
  fs.mkdirSync(path.join(root, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sources', 'myth-tfl.cue'),
    'FILE "myth-tfl.iso" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n');
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (/myth_tfl\.exe$/i.test(rel)) continue;
      files.push({ url: rel, vfsPath: 'c:\\' + path.relative(installed, full).split(path.sep).join('\\') });
    }
  })(installed);
  fs.writeFileSync(path.join(root, '.wine-assembly-browser.json'),
    JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n');
  console.log(`[myth] wrote sources/myth-tfl.cue and .wine-assembly-browser.json (${files.length} files)`);
  for (const rel of ['myth_tfl.exe', 'tags/tags.gor']) {
    const file = path.join(installed, rel);
    if (fs.existsSync(file)) console.log(`[myth] ${rel} sha256 ${sha256(file)}`);
  }
}

try {
  if (!flag('manifest-only') && (flag('force') || !fs.existsSync(path.join(installed, 'myth_tfl.exe')))) runSetup();
  writeCueAndManifest();
} catch (error) {
  console.error(`[myth] ${error.message}`);
  process.exit(1);
}
