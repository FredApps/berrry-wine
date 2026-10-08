#!/usr/bin/env node
'use strict';
// Rebuild the 199-program DOS corpus (/tmp/demos layout) from the committed
// site bundles, docs/dos-corpus/live/programs/*.js + programs-index.json.
// Pure JS: reads JSON/base64, writes files. Loads no guest, runs no emulator.
//
//   node unpack-corpus.js --out=DIR [--dry-run] [--list=FILE]
//
// --list writes the program list (one absolute path per line, sorted) that the
// corpus plan feeds to the sweep drivers. The EXE named by each index key keeps
// the key's original case; every other file keeps the bundle's name.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const dry = argv.includes('--dry-run');
const ROOT = path.resolve(__dirname, '..', '..');
const LIVE = path.join(ROOT, 'docs/dos-corpus/live');
const out = path.resolve(arg('out', '/tmp/demos'));
const index = JSON.parse(fs.readFileSync(path.join(LIVE, 'programs-index.json'), 'utf8'));

function loadBundle(rel) {
  const text = fs.readFileSync(path.join(LIVE, rel), 'utf8');
  const at = text.indexOf('] = ');
  if (at < 0) throw new Error(`${rel}: no assignment`);
  return JSON.parse(text.slice(at + 4).replace(/;\s*$/, ''));
}

const bundles = new Map();
let files = 0, bytes = 0;
const list = [];
const h = crypto.createHash('sha256');
for (const key of Object.keys(index).sort()) {
  const ent = index[key];
  if (!bundles.has(ent.src)) bundles.set(ent.src, loadBundle(ent.src));
  const b = bundles.get(ent.src);
  const dir = path.basename(path.dirname(key));
  const exeName = path.basename(key);
  if (!Object.keys(b.files).some((n) => n.toLowerCase() === ent.exe.toLowerCase())) {
    throw new Error(`${key}: bundle ${ent.src} lacks ${ent.exe}`);
  }
  list.push(path.join(out, dir, exeName));
}
for (const [src, b] of [...bundles.entries()].sort()) {
  // The directory name the index keys use for this bundle.
  const keys = Object.keys(index).filter((k) => index[k].src === src);
  const dir = path.basename(path.dirname(keys[0]));
  const exeCase = new Map(keys.map((k) => [path.basename(k).toLowerCase(), path.basename(k)]));
  for (const name of Object.keys(b.files).sort()) {
    const buf = Buffer.from(b.files[name], 'base64');
    const leaf = exeCase.get(name.toLowerCase()) || name;
    const p = path.join(out, dir, leaf);
    files++; bytes += buf.length;
    if ((arg('sha', '')).split(',').filter(Boolean).some((s) => s.toLowerCase() === `${dir}/${leaf}`.toLowerCase())) {
      console.log(`sha256 ${dir}/${leaf} ${crypto.createHash('sha256').update(buf).digest('hex')}`);
    }
    h.update(`${dir}/${leaf}\0`); h.update(buf);
    if (!dry) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); }
  }
}
// What findExes() (sweep-dos.js / shot-sweep.js --dir) would pick up: every .exe/.com.
let walkable = 0;
for (const [, b] of bundles) for (const n of Object.keys(b.files)) if (/\.(exe|com)$/i.test(n)) walkable++;
list.sort();
console.log(`${Object.keys(index).length} programs in ${bundles.size} directories; ${files} files, `
  + `${(bytes / 1048576).toFixed(1)} MiB; ${walkable} .exe/.com files a --dir walk would find`);
console.log(`corpus content sha256 ${h.digest('hex')} (path\\0bytes over every file, sorted)`);
if (arg('list')) fs.writeFileSync(arg('list'), list.join('\n') + '\n');
console.log(dry ? 'dry run: nothing written' : `written under ${out}`);
