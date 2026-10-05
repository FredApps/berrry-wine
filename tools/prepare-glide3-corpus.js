#!/usr/bin/env node
'use strict';

// Static assembly only: never execute an installer or download a package.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node tools/prepare-glide3-corpus.js [--check] [--corpus-root=PATH]\n' +
    'Prepare both original, already-extracted English Glide 3 demos. --check writes nothing.\n' +
    'Existing differing outputs are refused; original packages and extraction trees are never changed.');
  process.exit(0);
}
for (const arg of args) {
  if (arg !== '--check' && !arg.startsWith('--corpus-root=')) throw new Error(`Unknown option: ${arg}`);
}
// Resolve the corpus root once: worktrees may deliberately link the entire fixture corpus.
const root = fs.realpathSync(path.resolve(args.find(a => a.startsWith('--corpus-root='))?.slice(14) ||
  path.join(__dirname, '../test/binaries/candidates')));
const check = args.includes('--check');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const plans = [];
// Component ordering matches the original pathlib-based static assembly.
function comparePaths(a, b) {
  const aa = a.split('/'), bb = b.split('/');
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1;
  }
  return aa.length - bb.length;
}

function safe(relative) {
  if (!relative || relative.includes('\\') || relative.includes(':') ||
      relative.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error(`Unsafe corpus path: ${relative}`);
  }
  let absolute = root;
  for (const component of relative.split('/')) {
    absolute = path.join(absolute, component);
    try {
      if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`Refusing symlink: ${absolute}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
function read(relative) {
  const absolute = safe(relative);
  if (!fs.statSync(absolute).isFile()) throw new Error(`Not a regular file: ${relative}`);
  return fs.readFileSync(absolute);
}
function walk(relative) {
  const result = [];
  for (const name of fs.readdirSync(safe(relative)).sort()) {
    const child = `${relative}/${name}`;
    const stat = fs.lstatSync(safe(child));
    if (stat.isDirectory()) result.push(...walk(child));
    else if (stat.isFile()) result.push(child);
    else throw new Error(`Unsupported file type: ${child}`);
  }
  return result.sort(comparePaths);
}
function pin(relative, expected) {
  if (sha(read(relative)) !== expected) throw new Error(`Original hash mismatch: ${relative}`);
}
function candidate(name, exe, count, total) {
  JSON.parse(read(`${name}/provenance.json`)); // Preserve acquisition provenance; require it to exist.
  const outputs = new Map();
  const directories = new Map();
  const manifest = {
    created: '2026-09-29', // Recipe audit date, deliberately independent of invocation time.
    status: 'Statically assembled; not runtime-validated', exe,
    workingDirectory: 'C:\\', args: '', language: 'English'
  };
  const files = [], generated = [];
  function add(destination, bytes) {
    safe(`${name}/launch-game/${destination}`);
    const key = destination.toLowerCase();
    const previous = outputs.get(key);
    if (previous) {
      if (!previous.bytes.equals(bytes)) throw new Error(`Conflicting destination: ${destination}`);
      return false;
    }
    // Win32 installation is case-insensitive. Preserve the first directory spelling
    // on Linux too, rather than splitting Hype's GameData/Gamedata references.
    const parts = destination.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const directoryKey = parts.slice(0, i + 1).join('/').toLowerCase();
      if (!directories.has(directoryKey)) directories.set(directoryKey, parts[i]);
      parts[i] = directories.get(directoryKey);
    }
    outputs.set(key, { destination: parts.join('/'), bytes });
    return true;
  }
  return {
    name, manifest, generated,
    copy(source, destination, reason) {
      const bytes = read(`${name}/${source}`);
      if (add(destination, bytes)) files.push({ source: `${name}/${source}`,
        destination: `${name}/launch-game/${destination}`, bytes: bytes.length, sha256: sha(bytes), reason });
      return bytes.length;
    },
    generate(destination, bytes, evidence) {
      bytes = Buffer.from(bytes);
      if (!add(destination, bytes)) throw new Error(`Generated destination already exists: ${destination}`);
      generated.push({ path: destination, ...evidence, sha256: sha(bytes) });
    },
    finish(extra) {
      if (outputs.size !== count || [...outputs.values()].reduce((n, f) => n + f.bytes.length, 0) !== total) {
        throw new Error(`Unexpected ${name} payload inventory; expected ${count} files / ${total} bytes`);
      }
      const ordered = [...outputs.values()].sort((a, b) => comparePaths(a.destination, b.destination));
      for (const { destination, bytes } of ordered) plans.push({ path: `${name}/launch-game/${destination}`, bytes });
      plans.push({ path: `${name}/launch-manifest.json`, bytes: json({ ...manifest, files, generated, ...extra }) });
      plans.push({ path: `${name}/.wine-assembly-browser.json`, bytes: json({ schemaVersion: 1,
        files: ordered.map(f => ({ url: `launch-game/${f.destination}`, vfsPath: `c:\\${f.destination.replaceAll('/', '\\')}` })) }) });
    }
  };
}

function hitman() {
  const name = 'hitman-codename-47-demo';
  pin(`${name}/Hitman.zip`, '16107fb6a82f6e3aab85faec164b68e64dd78ba813bc8145986dcea9611ecb93');
  pin(`${name}/extracted/Engine_files/Hitman.Exe`, '69707ab810574a85a0dc202aeef78da55a98a8c9ff6a0cf6bda662cb5edd2d70');
  pin(`${name}/extracted/Engine_files/Render3DFX.dll`, 'f4a1041d7ad81f10a00121b6c060a3b14fe1dff4fd270f794be4ce429f491740');
  const c = candidate(name, 'Hitman.Exe', 75, 42270720);
  c.manifest.renderer = 'Render3DFX.dll';
  for (const group of ['Engine_files', 'Game_files', 'Game_Setup_files', 'Manual_files', 'Manual_files_(English)']) {
    const prefix = `${name}/extracted/${group}/`;
    for (const source of walk(prefix.slice(0, -1))) {
      c.copy(source.slice(name.length + 1), source.slice(prefix.length), 'InstallShield component payload');
    }
  }
  c.copy('extracted/Game_Setup_files/Setup/Locale/language-English.zip', 'Setup/Locale.zip',
    'setup.ins English language selection and locale.zip copy destination; Hitman.ini Include');
  c.copy('installer/readme_eng.txt', 'readme.txt', 'English original demo readme');
  const original = read(`${name}/installer/Hitman.ini`).toString('latin1');
  if (!original.includes('//DrawDll Render3DFX.dll\r\n') || !original.includes('\r\nDrawDll RenderD3D.dll\r\n')) {
    throw new Error('Unexpected original Hitman renderer configuration');
  }
  c.generate('Hitman.ini', Buffer.from(original.replace('//DrawDll Render3DFX.dll', 'DrawDll Render3DFX.dll')
    .replace('\r\nDrawDll RenderD3D.dll', '\r\n//DrawDll RenderD3D.dll'), 'latin1'), {
    source: 'installer/Hitman.ini', change: 'Select original Render3DFX.dll instead of RenderD3D.dll'
  });
  c.finish({ registry: 'No required key proven; no speculative registry seed' });
}

function hype() {
  const name = 'hype-time-quest-demo', base = 'extracted/HypeDemo/hype';
  pin(`${name}/hypedemo.exe`, 'e1732ac80b51d916358b2ca4c331b1355c75bf882709fa90f688ce849a470982');
  pin(`${name}/${base}/exe/Glide 3x/MaiDFXvr_bleu.exe`, '635f394121e50001227b97741dbf304f0a88f819c6f2ba2378cf61d9fa2a6344');
  const c = candidate(name, 'MaiDFXvr_bleu.exe', 59, 38067871);
  const lookup = new Map();
  for (const file of walk(`${name}/${base}`)) {
    const relative = file.slice(`${name}/${base}/`.length), key = relative.toLowerCase();
    if (lookup.has(key)) throw new Error(`Case-colliding Hype input: ${relative}`);
    lookup.set(key, relative);
  }
  let section = '', language = '', config = '';
  const stale = [];
  const normalize = value => value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  for (const raw of read(`${name}/${base}/InstData/ubi.ins`).toString('latin1').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) section = line;
    if (line.startsWith('Language,')) language = line.slice(9);
    if (line.startsWith('CONFIG ')) config = line;
    if (line.startsWith('END CONFIG')) config = '';
    const selected = section === '[COMMON FILES]' ||
      (section === '[LANGUAGE FILES]' && language === 'English') ||
      (section === '[SPECIFIC FILES]' && config.startsWith('CONFIG 3DFX'));
    const fields = line.split(',').map(s => s.trim());
    if (!selected || fields.length !== 4) continue;
    const [file, from, to, size] = fields;
    if (!/^\d+$/.test(size)) throw new Error(`Invalid installer size: ${line}`);
    const source = lookup.get(`${normalize(from)}/${file}`.toLowerCase());
    if (!source) throw new Error(`Missing installer source: ${line}`);
    const destination = [normalize(to), file].filter(Boolean).join('/');
    const actualBytes = c.copy(`${base}/${source}`, destination,
      'ubi.ins COMMON + English LANGUAGE + Glide3 SPECIFIC mapping');
    if (actualBytes !== Number(size)) stale.push({ source, scriptBytes: Number(size), actualBytes });
  }
  for (const doc of ['Readme.txt', 'Glide3 installation.txt']) c.copy(`${base}/${doc}`, doc, 'Original demo documentation');
  c.generate('windows/UbiSoft/ubi.ini', '[Hype - The Time Quest DEMO]\r\nComplete=1\r\nChangeMapMusic=0\r\n' +
    'LowGraphicMode=0\r\nLanguage=English\r\nSoundOnHD=1\r\nSoundStream=0\r\n', {
    guestPath: 'C:\\windows\\UbiSoft\\ubi.ini',
    evidence: 'ubi.ins Glide INI SECTIONS Complete1/ChangeMapMusic0/LowGraphicMode0; PE4055b0 GetWindowsDirectory+UbiSoft/Ubi.ini and section Hype - The Time Quest DEMO; English/full-disk audio selection'
  });
  c.finish({ installerStaleSizeFields: stale, notes: [
    'Original installer size fields are stale; copied actual original bytes without truncation.',
    'Do not mount Windows Glide driver DLL; renderer imports implemented glide3x.dll ABI.',
    'No game or installer executed.'
  ] });
}

// Complete both input plans and inspect every existing destination before the first write.
hitman();
hype();
for (const plan of plans) {
  const absolute = safe(plan.path);
  if (!fs.existsSync(absolute)) {
    if (check) throw new Error(`Missing prepared output: ${plan.path}`);
    continue;
  }
  const existing = read(plan.path);
  // JSON property ordering is immaterial; preserve an equivalent original manifest byte-for-byte.
  const equivalent = plan.path.endsWith('.json') &&
    require('util').isDeepStrictEqual(JSON.parse(existing), JSON.parse(plan.bytes));
  if (!existing.equals(plan.bytes) && !equivalent) throw new Error(`Refusing to overwrite differing output: ${plan.path}`);
  plan.exists = true;
}
let created = 0;
if (!check) for (const plan of plans) {
  if (plan.exists) continue;
  const absolute = safe(plan.path);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  // Exclusive creation also refuses a destination appearing after preflight.
  fs.writeFileSync(absolute, plan.bytes, { flag: 'wx' });
  created++;
}
console.log(`${check ? 'Verified' : 'Prepared'} Hitman (75 files) and Hype (59 files); ${created} files created. Original sources unchanged.`);
