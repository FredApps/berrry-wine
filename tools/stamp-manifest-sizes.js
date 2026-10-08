#!/usr/bin/env node
'use strict';

// Give every entry of every local media manifest an app in lib/apps.js
// references (`localFileManifest`, .wine-assembly-browser.json) its byte size.
//
//   node tools/stamp-manifest-sizes.js [--apps=a,b] [--check] [--data-root=PATH]
//
// The lazy-file default (lib/app-files.js) streams a large data file only when
// the entry says how big it is; an unsized one stays eager (8bcc3055). The
// win98-games-a-d and tree generators write sizes now, but the manifests the
// candidate fetch/install tools wrote earlier (Pirates!, Morrowind, the Unreal
// demos, Arcanum, SimGolf...) have none, so those games still downloaded every
// byte before the first frame. These manifests are gitignored data, so this
// stamps them in place -- run it on every checkout that serves the corpus.
//
// Only a missing size is written: an entry that already has one, or says how
// it loads (loadMode, httpRange), is left alone, so a generator's own output
// is never second-guessed. Entries whose file is absent are skipped. --check
// reports unsized-but-present entries and exits 1 if there are any.
// --data-root=PATH resolves manifests and files under another checkout.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = name => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : ''; };
const CHECK = args.includes('--check');
const DATA_ROOT = arg('data-root') ? path.resolve(arg('data-root')) : ROOT;
const ONLY = arg('apps') ? new Set(arg('apps').split(',')) : null;

const { APPS } = require(path.join(ROOT, 'lib', 'apps.js'));
const manifests = new Map();
for (const [id, app] of Object.entries(APPS)) {
  if (ONLY && !ONLY.has(id)) continue;
  if (!app.localFileManifest) continue;
  const file = path.isAbsolute(app.localFileManifest) ? app.localFileManifest
    : path.join(DATA_ROOT, app.localFileManifest);
  // build/ manifests are build outputs; whatever writes them owns their shape.
  if (path.relative(DATA_ROOT, file).split(path.sep)[0] === 'build') continue;
  if (!manifests.has(file)) manifests.set(file, []);
  manifests.get(file).push(id);
}

let total = 0, stampedFiles = 0, unsized = 0;
for (const [file, ids] of [...manifests].sort()) {
  let json, text;
  try { text = fs.readFileSync(file, 'utf8'); json = JSON.parse(text); } catch (_) { continue; }
  if (!json || !Array.isArray(json.files)) continue;
  const dir = path.dirname(file);
  let added = 0;
  for (const entry of json.files) {
    if (!entry || typeof entry !== 'object' || !entry.url) continue;
    if (Number.isSafeInteger(entry.size) || entry.loadMode !== undefined || entry.httpRange !== undefined) continue;
    let size = null;
    try {
      const st = fs.statSync(path.join(dir, decodeURIComponent(entry.url)));
      if (st.isFile()) size = st.size;
    } catch (_) { size = null; }
    if (size === null) continue;
    unsized++;
    if (!CHECK) { entry.size = size; added++; }
  }
  total += json.files.length;
  if (added) {
    // Keep the file's own formatting conventions: two-space JSON, trailing newline.
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + (text.endsWith('\n') ? '\n' : ''));
    stampedFiles++;
    console.log(`stamped ${String(added).padStart(5)} sizes  ${path.relative(DATA_ROOT, file)}  (${ids.join(', ')})`);
  }
}

if (CHECK) {
  if (unsized) {
    console.error(`${unsized} manifest entr${unsized === 1 ? 'y has' : 'ies have'} no size; run node tools/stamp-manifest-sizes.js`);
    process.exit(1);
  }
  console.log(`manifest sizes: OK (${manifests.size} manifests, ${total} entries)`);
} else {
  console.log(`${stampedFiles} manifest(s) stamped, ${unsized} size(s) added, ${manifests.size} manifests scanned`);
}
