#!/usr/bin/env node
// Write tools/avi-player/catalog.json: every .avi in the corpus, with what
// the player needs to list it before fetching it.
//
//   node tools/avi-player/gen-catalog.js [--root=test/binaries] [--check]
//
// One entry per file: its repo-relative path, the game it belongs to (the
// registry app whose exe lives under the same corpus directory, else that
// directory's name), video codec, size, frame count, rate, audio format, and
// whether this page's decoders can play it — the same rule the page itself
// applies (codecs-wasm.js decoderKind), so the list never promises a movie the
// player then refuses. Only the header lists are read: an AVI's 'hdrl' sits
// at the front, so the first 512 KB is enough and a 30 MB movie costs nothing.
//
// Movies that only exist inside a CD image (War Wind) are not files here;
// the page takes those by drag and drop.
//
// --check exits 1 when catalog.json is stale, for a test to call.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseAvi } = require('./avi-demux');
const { decoderKind } = require('./codecs-wasm');

const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'catalog.json');
const args = process.argv.slice(2);
const rootArg = args.find(a => a.startsWith('--root='));
const ROOT = rootArg ? rootArg.slice(7) : 'test/binaries';
const HEAD_BYTES = 512 * 1024;

// The corpus links directories in from elsewhere, and test/binaries/binaries
// links back to itself, so directories are visited once by real path.
const seenDirs = new Set();
function walk(dir, out) {
  let real;
  try { real = fs.realpathSync(path.join(REPO, dir)); } catch (_) { return out; }
  if (seenDirs.has(real)) return out;
  seenDirs.add(real);
  let ents;
  try { ents = fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    const rel = dir + '/' + e.name;
    let isDir = e.isDirectory(), isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try { const st = fs.statSync(path.join(REPO, rel)); isDir = st.isDirectory(); isFile = st.isFile(); } catch (_) { continue; }
    }
    if (isDir) walk(rel, out);
    else if (isFile && /\.avi$/i.test(e.name)) out.push(rel);
  }
  return out;
}

// test/binaries/<group>/<game>/... -> test/binaries/<group>/<game>/
function gameDir(rel) {
  const parts = rel.split('/');
  return parts.slice(0, 4).join('/') + '/';
}

// Registry titles by the corpus directory their exe lives in.
function registryTitles() {
  const reg = require(path.join(REPO, 'lib', 'apps.js'));
  const names = {};
  for (const list of [reg.DESKTOP_APPS, reg.LOCAL_CANDIDATE_APPS, reg.DEBUG_ONLY_APPS]) {
    for (const row of list || []) if (Array.isArray(row)) names[row[0]] = row[1];
  }
  const byDir = {};
  for (const [id, app] of Object.entries(reg.APPS || {})) {
    const exe = app && reg.appFileUrl(app.exe);
    if (!exe || !exe.startsWith(ROOT + '/')) continue;
    const dir = gameDir(exe);
    if (!byDir[dir]) byDir[dir] = { id, title: names[id] || id };
  }
  return byDir;
}

function describe(rel) {
  const fd = fs.openSync(path.join(REPO, rel), 'r');
  const size = fs.fstatSync(fd).size;
  const head = Buffer.alloc(Math.min(size, HEAD_BYTES));
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const entry = { path: rel, bytes: size };
  let avi;
  try { avi = parseAvi(new Uint8Array(head.buffer, head.byteOffset, head.length)); }
  catch (e) { entry.error = e.message; return entry; }
  const vs = avi.streams.find(s => s.header && s.header.type === 'vids' && s.format);
  const as = avi.streams.find(s => s.header && s.header.type === 'auds' && s.format);
  if (!vs) { entry.error = 'no video stream in the header'; return entry; }
  const bi = vs.format;
  const d = decoderKind(bi);
  entry.codec = d.name;
  entry.width = bi.width;
  entry.height = Math.abs(bi.height);
  entry.bpp = bi.bitCount;
  entry.frames = vs.header.length;
  entry.fps = vs.header.scale ? +(vs.header.rate / vs.header.scale).toFixed(3) : 0;
  if (as) {
    const a = as.format;
    entry.audio = a.formatTag === 1
      ? `PCM ${a.rate} Hz ${a.bits}-bit ${a.channels === 1 ? 'mono' : a.channels + 'ch'}`
      : `wFormatTag 0x${a.formatTag.toString(16)}`;
  }
  entry.playable = !!d.kind;
  if (!d.kind) entry.reason = d.reason;
  return entry;
}

function build() {
  const titles = registryTitles();
  const files = walk(ROOT, []).sort();
  const games = new Map();
  for (const rel of files) {
    const dir = gameDir(rel);
    const t = titles[dir];
    const key = t ? t.title : dir.split('/')[3];
    if (!games.has(key)) games.set(key, { game: key, app: t ? t.id : null, movies: [] });
    games.get(key).movies.push(describe(rel));
  }
  return JSON.stringify({ root: ROOT, games: [...games.values()] }, null, 1) + '\n';
}

const text = build();
if (args.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== text) { console.error('tools/avi-player/catalog.json is stale: run node tools/avi-player/gen-catalog.js'); process.exit(1); }
  console.log('catalog.json is current');
} else {
  fs.writeFileSync(OUT, text);
  const g = JSON.parse(text).games;
  const n = g.reduce((s, x) => s + x.movies.length, 0);
  const ok = g.reduce((s, x) => s + x.movies.filter(m => m.playable).length, 0);
  console.log(`wrote ${path.relative(REPO, OUT)}: ${n} movies in ${g.length} games, ${ok} playable`);
  for (const x of g) {
    const codecs = {};
    for (const m of x.movies) codecs[m.codec || m.error] = (codecs[m.codec || m.error] || 0) + 1;
    console.log(`  ${x.game}${x.app ? ` [${x.app}]` : ''}: ` + Object.entries(codecs).map(([k, v]) => `${v} ${k}`).join(', '));
  }
}
