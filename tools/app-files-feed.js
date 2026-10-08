#!/usr/bin/env node
'use strict';
// Give a boat sandbox the game files it needs without copying 30 GB.
//
// A boat fork carries the repository but not test/binaries (gitignored, tens
// of GB), so a sweep run there finds `missing-files` for nearly every app.
// This serves the binaries from the box that has them and lets the fork pull
// exactly the files each requested app's registry entry names:
//
//   here:      node tools/app-files-feed.js serve [--port=8711]
//              boat forward <id> --reverse --local 8711
//   on boat:   node tools/app-files-feed.js fetch --base=http://127.0.0.1:8711 \
//                --apps=a,b|--all [--dry-run]
//
// The server binds 127.0.0.1 only and answers GETs for files under
// test/binaries (the `binaries/` alias included) and nothing else -- never
// expose it with `host`. The fetcher writes each file to the same path under
// its own checkout, skips files already there with the right size, and
// prints what it could not get.
//
// What an app needs is what run.js mounts for `--app=<id>`: its exe, its
// path-form dlls, its `files`, its localFileManifest and the files that
// manifest lists, a cdAudio cue and the images the cue names, plus
// test/binaries/dlls (bare-name DLLs resolve there).

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'test', 'binaries');

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = name => argv.includes(`--${name}`);

// Registry paths are repo-relative and spelled either test/binaries/... or
// binaries/... (a symlink to test/binaries in a full checkout).
function canonical(rel) {
  const norm = path.posix.normalize(String(rel).replace(/\\/g, '/'));
  if (norm.startsWith('binaries/')) return 'test/' + norm;
  return norm;
}

function serve() {
  const port = parseInt(opt('port', '8711'), 10);
  const server = http.createServer((req, res) => {
    const rel = canonical(decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')));
    if (req.method !== 'GET' || !rel.startsWith('test/binaries/')) {
      res.writeHead(403); res.end(); return;
    }
    let file;
    try { file = fs.realpathSync(path.join(ROOT, rel)); } catch (_) { res.writeHead(404); res.end(); return; }
    let st;
    try { st = fs.statSync(file); } catch (_) { res.writeHead(404); res.end(); return; }
    if (st.isDirectory()) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Names with their kind, so a caller can skip subdirectories.
      res.end(JSON.stringify(fs.readdirSync(file, { withFileTypes: true })
        .map(d => ({ name: d.name, dir: d.isDirectory() }))));
      return;
    }
    res.writeHead(200, { 'Content-Length': st.size, 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  // --port=0 picks a free port; the line below reports the real one.
  server.listen(port, '127.0.0.1', () =>
    console.log(`app-files-feed: serving test/binaries on 127.0.0.1:${server.address().port}`));
}

// The repo-relative paths an app's registry entry makes run.js read.
async function pathsFor(id, app, get) {
  const out = new Set();
  const add = p => { if (p && typeof p === 'string' && p.includes('/')) out.add(canonical(p)); };
  add(app.exe);
  for (const d of app.dlls || []) add(d);
  for (const f of app.files || []) add(typeof f === 'string' ? f : f && f.url);
  if (app.localFileManifest) {
    const m = canonical(app.localFileManifest);
    out.add(m);
    const text = await get(m);
    if (text) {
      const manifest = JSON.parse(text.toString('utf8'));
      const dir = path.posix.dirname(m);
      for (const f of manifest.files || []) if (f && f.url) out.add(canonical(path.posix.join(dir, f.url)));
    }
  }
  if (app.cdAudio && app.cdAudio.cue) {
    const cue = canonical(app.cdAudio.cue);
    out.add(cue);
    const text = await get(cue);
    if (text) {
      const dir = path.posix.dirname(cue);
      for (const m of text.toString('latin1').matchAll(/^\s*FILE\s+"([^"]+)"/gim)) {
        out.add(canonical(path.posix.join(dir, m[1])));
      }
    }
  }
  return [...out];
}

function httpGet(base, rel) {
  return new Promise(resolve => {
    http.get(`${base}/${rel.split('/').map(encodeURIComponent).join('/')}`, res => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', () => resolve(null));
  });
}

async function fetchMode() {
  const base = opt('base', 'http://127.0.0.1:8711').replace(/\/+$/, '');
  const { APPS } = require(path.join(ROOT, 'lib', 'apps.js'));
  const ids = flag('all') ? Object.keys(APPS) : (opt('apps', '') || '').split(',').filter(Boolean);
  const unknown = ids.filter(id => !APPS[id]);
  if (unknown.length) { console.error(`app-files-feed: unknown app id(s): ${unknown.join(', ')}`); process.exit(2); }
  const dry = flag('dry-run');
  // --dest: write under another root (default: this checkout).
  const DEST = path.resolve(opt('dest', ROOT));
  const local = rel => path.join(DEST, rel);
  // Read from disk when present, else from the feed (a manifest or cue is
  // itself one of the files to fetch).
  const get = async rel => (fs.existsSync(local(rel)) ? fs.readFileSync(local(rel)) : httpGet(base, rel));
  const want = new Set();
  const listing = await httpGet(base, 'test/binaries/dlls');
  if (listing) {
    for (const e of JSON.parse(listing.toString('utf8'))) if (!e.dir) want.add(`test/binaries/dlls/${e.name}`);
  }
  for (const id of ids) for (const p of await pathsFor(id, APPS[id], get)) want.add(p);
  let fetched = 0, have = 0, bytes = 0;
  const missing = [];
  for (const rel of [...want].sort()) {
    if (fs.existsSync(local(rel)) && fs.statSync(local(rel)).isFile()) { have++; continue; }
    if (dry) { console.log(`would fetch ${rel}`); continue; }
    const body = await httpGet(base, rel);
    if (!body) { missing.push(rel); continue; }
    fs.mkdirSync(path.dirname(local(rel)), { recursive: true });
    fs.writeFileSync(local(rel), body);
    fetched++; bytes += body.length;
  }
  console.log(`app-files-feed: ${ids.length} app(s), ${want.size} file(s): fetched ${fetched} ` +
    `(${(bytes / 1048576).toFixed(1)} MB), already present ${have}, missing on the feed ${missing.length}`);
  for (const m of missing.slice(0, 20)) console.log(`  missing: ${m}`);
  if (missing.length > 20) console.log(`  (+${missing.length - 20} more)`);
}

if (mode === 'serve') serve();
else if (mode === 'fetch') fetchMode().catch(e => { console.error(e); process.exit(1); });
else {
  console.error('usage: app-files-feed.js serve [--port=N] | fetch --base=URL --apps=a,b|--all [--dry-run]');
  process.exit(2);
}
