#!/usr/bin/env node
'use strict';

// How many bytes does each registered app make the browser download before the
// guest starts, under the shipped lazy-file default?
//
//   node tools/app-bytes-census.js [--min=1m] [--top=N] [--apps=a,b] [--part=A|B]
//       [--files=N] [--json]
//
// Per app it sums the exe, every path-form DLL, the inline `files[]` and the
// entries of its `localFileManifest`, all by stat() of the files on disk, and
// runs the files through lib/app-files.js normalizeLazyFiles() exactly as
// test/run.js and the page do: sizes only from the entries themselves (the
// local manifest's, and lib/apps.js's stamp from app-file-sizes.generated.js),
// isWin16 from the exe header, syncAudio from the exe's imports. Disk sizes
// only fill the total/eager columns. --data-root=PATH reads the files under a
// checkout that has the full gitignored corpus. WA_APP_FILE_SIZES_OFF=1 shows
// the registry without the generated sizes (the before arm). `eager` is what loads before the first guest
// instruction: exe + DLLs + every file the policy keeps eager (`preloadRanges`
// bytes of a lazy file count as eager); `?eager-files` loads `total`. The
// policy column is the normalizer's own reason (lazy / small app / Win16 /
// app.lazyFiles false). Being lazy says nothing about whether the app still
// RUNS lazily -- reads inside a nested synchronous message, by _lread, the DLL
// loader or an audio/GDI asset reader cannot park (lib/filesystem.js); check a
// route with `test/run.js --lazy-ranges=5` and tools/io-range-census.js.
//
// `part` is A when tools/gen-win98-games-a-d-manifests.js builds the app's
// manifest and B otherwise (the hand-written entries). --files=N lists each
// app's N largest eager files, which is the work list for an audit.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { APPS } = require(path.join(ROOT, 'lib', 'apps.js'));

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const flag = name => args.includes(`--${name}`);
const parseBytes = text => {
  const m = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i.exec(String(text).trim());
  if (!m) throw new Error(`bad byte count: ${text}`);
  return Math.round(Number(m[1]) * ({ '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 })[m[2].toLowerCase()]);
};

const MIN = parseBytes(getArg('min', '1m'));
const TOP = Number(getArg('top', '0')) || Infinity;
const FILES = Number(getArg('files', '0')) || 0;
const ONLY = getArg('apps', '') ? new Set(getArg('apps', '').split(',')) : null;
const PART = getArg('part', '').toUpperCase();
const { normalizeLazyFiles, importsSyncAudio } = require(path.join(ROOT, 'lib', 'app-files.js'));
const isNe = file => {
  try {
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(0x40);
    fs.readSync(fd, b, 0, 0x40, 0);
    const lfa = b.readUInt32LE(0x3c); const sig = Buffer.alloc(2);
    fs.readSync(fd, sig, 0, 2, lfa); fs.closeSync(fd);
    return b.toString('latin1', 0, 2) === 'MZ' && sig.toString('latin1') === 'NE';
  } catch (_) { return false; }
};

// Part A: the ids tools/gen-win98-games-a-d-manifests.js writes manifests for.
const partA = new Set();
try {
  const gen = fs.readFileSync(path.join(ROOT, 'tools', 'gen-win98-games-a-d-manifests.js'), 'utf8');
  for (const m of gen.matchAll(/\bid:\s*'([^']+)'/g)) partA.add(m[1]);
} catch (_) { /* no generator, everything is B */ }

const dataRootArg = args.find(a => a.startsWith('--data-root='));
const DATA_ROOT = dataRootArg ? path.resolve(dataRootArg.slice('--data-root='.length)) : ROOT;
const resolve = p => (path.isAbsolute(p) ? p : path.join(DATA_ROOT, p));
const sizeOf = file => { try { return fs.statSync(file).size; } catch (_) { return null; } };
const fmt = n => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)}G`
  : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)}M`
    : n >= 1024 ? `${(n / 1024).toFixed(0)}K` : `${n}B`);

function manifestFiles(app) {
  if (!app.localFileManifest) return [];
  const file = resolve(app.localFileManifest);
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
  const dir = path.dirname(file);
  return (json.files || []).map(f => ({ ...f, disk: path.join(dir, decodeURIComponent(f.url)) }));
}

const isLazy = obj => !!obj && typeof obj === 'object' &&
  (obj.loadMode === 'lazy' || obj.loadMode === 'background' ||
   (obj.httpRange === true && obj.loadMode !== 'required'));
const preloadedOf = obj => {
  let n = 0;
  if (obj && obj.preloadRanges && Array.isArray(obj.preloadRanges.ranges)) {
    for (const r of obj.preloadRanges.ranges) n += Number(r.length || r[1] || 0);
  }
  return n;
};

function census(id, app) {
  const rows = [];
  const fixed = [];
  for (const [kind, p] of [['exe', app.exe], ...(app.dlls || []).map(d => ['dll', d])]) {
    if (p && String(p).includes('/')) fixed.push({ kind, disk: resolve(p), vfs: path.basename(p).toLowerCase() });
  }
  // The normalizer's input: every companion file, url replaced by its disk path.
  const items = [];
  for (const item of app.files || []) {
    const url = typeof item === 'string' ? item : item && item.url;
    if (url && !/^https?:/i.test(url)) {
      items.push({ kind: 'file', file: typeof item === 'string' ? { url: resolve(url) } : { ...item, url: resolve(url) } });
    }
  }
  const listed = manifestFiles(app);
  if (listed === null) return { id, error: `unreadable manifest ${app.localFileManifest}` };
  for (const item of listed) {
    const { disk, ...rest } = item;
    items.push({ kind: 'manifest', file: { ...rest, url: disk } });
  }
  const exePath = app.exe ? resolve(app.exe) : null;
  let syncAudio = true;
  try { if (exePath) syncAudio = importsSyncAudio(fs.readFileSync(exePath)); } catch (_) {}
  const policy = normalizeLazyFiles(app, items.map(x => x.file), {
    isWin16: !!exePath && isNe(exePath),
    syncAudio,
  });
  for (const r of fixed) rows.push({ ...r, size: sizeOf(r.disk), lazy: false, preloaded: 0 });
  policy.files.forEach((out, i) => {
    const disk = typeof out === 'string' ? out : out.url;
    rows.push({ kind: items[i].kind, disk, vfs: String(out.vfsPath || path.basename(disk)).toLowerCase(),
      size: sizeOf(disk), lazy: isLazy(out), preloaded: preloadedOf(out) });
  });
  const total = rows.reduce((sum, r) => sum + (r.size || 0), 0);
  const eager = rows.reduce((sum, r) => sum + (r.lazy ? Math.min(r.size || 0, r.preloaded) : (r.size || 0)), 0);
  const missing = rows.filter(r => r.size === null).length;
  return { id, part: partA.has(id) ? 'A' : 'B', files: rows.length, missing, total, eager,
    policy: policy.summary.policy, rows };
}

const results = [];
for (const id of Object.keys(APPS).sort()) {
  if (ONLY && !ONLY.has(id)) continue;
  const r = census(id, APPS[id]);
  if (r.error) { console.error(`warn ${id}: ${r.error}`); continue; }
  if (PART && r.part !== PART) continue;
  if (r.total < MIN) continue;
  results.push(r);
}
results.sort((a, b) => b.eager - a.eager || b.total - a.total);
const shown = results.slice(0, TOP);

if (flag('json')) {
  console.log(JSON.stringify(shown.map(({ rows, ...r }) => ({
    ...r, largestEager: rows.filter(x => !x.lazy).sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, FILES || 10).map(x => ({ vfs: x.vfs, kind: x.kind, size: x.size })),
  })), null, 2));
  process.exit(0);
}

console.log('eager = bytes loaded before the guest starts under the shipped default (lib/app-files.js); total = ?eager-files');
console.log('part  app                                files   total      eager  policy');
let sumTotal = 0, sumEager = 0;
for (const r of shown) {
  sumTotal += r.total; sumEager += r.eager;
  console.log(`${r.part.padEnd(5)} ${r.id.padEnd(34)} ${String(r.files).padStart(5)}  ${fmt(r.total).padStart(8)}  ` +
    `${fmt(r.eager).padStart(9)}  ${r.policy}${r.missing ? `  [${r.missing} missing on disk]` : ''}`);
  if (FILES) {
    for (const x of r.rows.filter(x => !x.lazy).sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, FILES)) {
      console.log(`        ${fmt(x.size || 0).padStart(8)}  eager  ${x.kind.padEnd(8)} ${x.vfs}`);
    }
  }
}
console.log(`${shown.length} app(s): ${fmt(sumTotal)} in total, ${fmt(sumEager)} eager under the default`);
