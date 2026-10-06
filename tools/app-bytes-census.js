#!/usr/bin/env node
'use strict';

// How many bytes does each registered app make the browser download before the
// guest starts, and how many would a lazy-by-default rule leave behind?
//
//   node tools/app-bytes-census.js [--min=1m] [--top=N] [--apps=a,b] [--part=A|B]
//       [--small=256k] [--app-eager=16m] [--files=N] [--json]
//
// Per app it sums the exe, every path-form DLL, the inline `files[]` and the
// entries of its `localFileManifest`, all by stat() of the files on disk, and
// splits the total into what loads before the first guest instruction (eager)
// and what is already lazy (`loadMode: 'lazy'|'background'`, or the older
// `httpRange: true`, both mounted by host.js as an HTTP range provider;
// `preloadRanges` bytes are counted as eager). `default` is a
// preview of the proposed lazy default (LAZY-LOAD-ALL-GAMES, 2026-10-06): a
// data file is lazy unless it is small (< --small), PE-like (dll drv ocx asi
// m3d flt acm ax vxd), config text (ini cfg inf), matched by persistFiles, or
// explicitly eager (`loadMode: 'required'`, `eager: true`, `httpRange: false`); an app whose whole total is
// under --app-eager, or that says `lazyFiles: false`, stays fully eager. The
// preview says nothing about whether the app still RUNS lazily -- reads made
// inside a nested synchronous message, by _lread, by the DLL loader or by an
// audio/GDI asset reader cannot park (lib/filesystem.js); find those with
// `test/run.js --lazy-ranges=5` and tools/io-range-census.js.
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
const SMALL = parseBytes(getArg('small', '256k'));
const APP_EAGER = parseBytes(getArg('app-eager', '16m'));
const TOP = Number(getArg('top', '0')) || Infinity;
const FILES = Number(getArg('files', '0')) || 0;
const ONLY = getArg('apps', '') ? new Set(getArg('apps', '').split(',')) : null;
const PART = getArg('part', '').toUpperCase();
const PE_EXT = /\.(dll|drv|ocx|asi|m3d|flt|acm|ax|vxd|exe)$/i;
const CONFIG_EXT = /\.(ini|cfg|inf)$/i;

// Part A: the ids tools/gen-win98-games-a-d-manifests.js writes manifests for.
const partA = new Set();
try {
  const gen = fs.readFileSync(path.join(ROOT, 'tools', 'gen-win98-games-a-d-manifests.js'), 'utf8');
  for (const m of gen.matchAll(/\bid:\s*'([^']+)'/g)) partA.add(m[1]);
} catch (_) { /* no generator, everything is B */ }

const resolve = p => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const sizeOf = file => { try { return fs.statSync(file).size; } catch (_) { return null; } };
const fmt = n => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)}G`
  : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)}M`
    : n >= 1024 ? `${(n / 1024).toFixed(0)}K` : `${n}B`);

function globToRegExp(glob) {
  const body = String(glob).toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^\\\\]*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

function manifestFiles(app) {
  if (!app.localFileManifest) return [];
  const file = resolve(app.localFileManifest);
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
  const dir = path.dirname(file);
  return (json.files || []).map(f => ({ ...f, disk: path.join(dir, decodeURIComponent(f.url)) }));
}

function census(id, app) {
  const rows = [];
  const add = (kind, item, disk) => {
    const size = sizeOf(disk);
    const obj = item && typeof item === 'object' ? item : {};
    const vfs = String(obj.vfsPath || path.basename(disk)).toLowerCase();
    let preloaded = 0;
    if (obj.preloadRanges && Array.isArray(obj.preloadRanges.ranges)) {
      for (const r of obj.preloadRanges.ranges) preloaded += Number(r.length || r[1] || 0);
    }
    // host.js loadFiles: loadMode lazy/background mounts a sized range
    // provider; legacy httpRange does too unless loadMode says required.
    const lazy = obj.loadMode === 'lazy' || obj.loadMode === 'background' ||
      (!!obj.httpRange && obj.loadMode !== 'required');
    rows.push({ kind, disk, vfs, size, lazy, preloaded,
      eagerFlag: obj.eager === true || obj.httpRange === false || obj.loadMode === 'required' });
  };
  if (app.exe) add('exe', null, resolve(app.exe));
  for (const spec of app.dlls || []) if (String(spec).includes('/')) add('dll', null, resolve(spec));
  for (const item of app.files || []) {
    const url = typeof item === 'string' ? item : item && item.url;
    if (url && !/^https?:/i.test(url)) add('file', item, resolve(url));
  }
  const listed = manifestFiles(app);
  if (listed === null) return { id, error: `unreadable manifest ${app.localFileManifest}` };
  for (const item of listed) add('manifest', item, item.disk);

  const persist = (app.persistFiles || []).map(globToRegExp);
  const total = rows.reduce((s, r) => s + (r.size || 0), 0);
  const fullyEager = app.lazyFiles === false || total < APP_EAGER;
  let eagerNow = 0, eagerDefault = 0;
  for (const r of rows) {
    const size = r.size || 0;
    eagerNow += r.lazy ? Math.min(size, r.preloaded) : size;
    const keep = fullyEager || r.kind === 'exe' || r.kind === 'dll' || r.eagerFlag ||
      size < SMALL || PE_EXT.test(r.disk) || CONFIG_EXT.test(r.disk) ||
      persist.some(re => re.test(r.vfs));
    r.defaultLazy = !keep;
    eagerDefault += keep ? size : Math.min(size, r.preloaded);
  }
  const missing = rows.filter(r => r.size === null).length;
  return { id, part: partA.has(id) ? 'A' : 'B', files: rows.length, missing, total,
    eagerNow, eagerDefault, fullyEager, rows };
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
results.sort((a, b) => b.eagerNow - a.eagerNow || b.total - a.total);
const shown = results.slice(0, TOP);

if (flag('json')) {
  console.log(JSON.stringify(shown.map(({ rows, ...r }) => ({
    ...r, largestEager: rows.filter(x => !x.lazy).sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, FILES || 10).map(x => ({ vfs: x.vfs, size: x.size, defaultLazy: x.defaultLazy })),
  })), null, 2));
  process.exit(0);
}

console.log(`small=${fmt(SMALL)} app-eager=${fmt(APP_EAGER)}  (eager = bytes loaded before the guest starts)`);
console.log('part  app                                files   total     eager now  eager default');
let sumNow = 0, sumDefault = 0;
for (const r of shown) {
  sumNow += r.eagerNow; sumDefault += r.eagerDefault;
  console.log(`${r.part.padEnd(5)} ${r.id.padEnd(34)} ${String(r.files).padStart(5)}  ${fmt(r.total).padStart(8)}  ` +
    `${fmt(r.eagerNow).padStart(9)}  ${fmt(r.eagerDefault).padStart(9)}` +
    `${r.fullyEager ? '  (fully eager)' : ''}${r.missing ? `  [${r.missing} missing on disk]` : ''}`);
  if (FILES) {
    for (const x of r.rows.filter(x => !x.lazy).sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, FILES)) {
      console.log(`        ${fmt(x.size || 0).padStart(8)}  ${x.defaultLazy ? 'lazy ' : 'eager'}  ${x.kind.padEnd(8)} ${x.vfs}`);
    }
  }
}
console.log(`${shown.length} app(s): eager now ${fmt(sumNow)}, under the default ${fmt(sumDefault)}`);
