#!/usr/bin/env node
'use strict';

// Which apps in the registry reach a 3D API, and which one?
// `node tools/gfx-app-census.js [--apps=a,b] [--desktop] [--family=gl,d3d9]
// [--iid=1|2|3|7] [--list] [--json]`
//
// `--iid=N` keeps the apps whose modules carry IID_IDirect3D<N>, and --list
// prints which ones each carries (`d3dim(iid:3/7)`). A Device7 can only be
// created from IDirect3D7, so --iid=7 is the whole set a Device7-only code
// path can reach: 13 of the 60 d3dim apps on 2026-10-06, when it scoped the
// check of the Device7 lighting change (9d35dc49).
//
// WHY THIS EXISTS. "Get every OpenGL/Direct3D app working" is not a
// measurable goal until the set is named, and the set was being guessed at
// from memory of which apps happened to come up in past sessions. This walks
// lib/apps.js -- the registry both hosts read -- and reports, per app, which
// 3D families its own binaries can reach.
//
// WHAT IT SCANS, AND WHY NOT EVERYTHING. The `exe`, the `dlls` list, and every
// other file the app mounts (`files`, `localFileManifest`) that is itself a
// PE/MZ module -- a game LoadLibrary's its renderer from its own directory
// under any extension (Blood II's d3d.ren, Myth's .dll set), and those were
// invisible when only exe+dlls were read. Data files are still skipped: a
// .pak or a .mpq can contain any bytes at all, including these names, and a
// hit in one says nothing about what the program calls.
//
// HOW A FAMILY IS DETECTED. Two kinds of evidence, and the tool distinguishes
// them because they are not equally strong:
//   - an IMPORT of the family's DLL name, which means the loader will resolve
//     it at load time whatever the app then does with it;
//   - an entry-point NAME literal, which is what GetProcAddress is handed;
//   - an interface IID's 16 bytes, which is how Direct3D 1-7 is reached: the
//     program asks IDirectDraw::QueryInterface for IDirect3D[237], so a
//     stripped binary carries the GUID and no symbol name at all.
// Direct3D is usually the first (a program links d3d9.dll or ddraw.dll), GL is
// usually the second, because every GL engine in this corpus resolves GL
// through GetProcAddress -- see tools/gl-name-census.js, which has the long
// version of that finding. A DLL-name hit is reported as `dll` and a
// name-literal hit as `name`; both are reach, neither is a call.
//
// IID EVIDENCE IS THE WEAKEST OF THE THREE. Linking dxguid.lib for any
// DirectDraw interface drags in its whole GUID table, so a 2D DirectDraw game
// (Jazz Jackrabbit 2, Moorhuhn, Pocket Tanks, Heroes III) carries
// IID_IDirect3D* without ever touching Direct3D. But it is also the only
// static trace a real IDirect3D user can leave: MechWarrior 3, Tomb Raider II
// and the GTA2 D3D renderer show up as d3dim(iid) and nothing else. So an
// `iid`-only row is a candidate to confirm at runtime, never a finding.
//
// STATIC REACH IS NOT USE. An app that names Direct3DCreate9 may take the
// DirectDraw path at runtime, and several here ship more than one renderer and
// pick between them -- Quake II carries ref_soft.dll and ref_gl.dll side by
// side, Half-Life carries three. So this produces the CANDIDATE set to work
// through, and `test/run.js --gl-census` (GL) or a run with --trace-api (D3D)
// is what says which renderer a route actually took.

const fs = require('fs');
const path = require('path');

const { APPS, DESKTOP_APPS } = require('../lib/apps.js');

// Each family: the DLL names whose import proves load-time reach, and the
// entry-point literals that prove GetProcAddress-style reach. Ordered roughly
// oldest to newest so a row reads as a history of how the app draws.
const FAMILIES = [
  { key: 'ddraw', dlls: ['ddraw.dll'],
    names: ['DirectDrawCreateEx', 'DirectDrawCreate'] },
  { key: 'd3drm', dlls: ['d3drm.dll'], names: ['Direct3DRMCreate'] },
  { key: 'd3dim', dlls: ['d3dim.dll', 'd3dim700.dll'],
    names: ['IID_IDirect3D7', 'IID_IDirect3D3', 'IID_IDirect3D2'],
    // IID_IDirect3D, 2, 3, 7 as four little-endian dwords -- the same words
    // $ddraw_iid_kind_wa in src/09a8-handlers-directx.wat matches.
    guids: [
      [0x3BBA0080, 0x11CF2421, 0xAA001AA3, 0x5633B900],
      [0x6AAE1EC1, 0x11D0662A, 0xAA009D88, 0x6AB7BB00],
      [0xBB223240, 0x11D0E72B, 0xAA00B4A9, 0x3E99C000],
      [0xF5049E77, 0x11D24861, 0xA00007A4, 0xA82906C9],
    ],
    // Which IDirect3D interface each GUID is. A Device7 can only come from
    // IDirect3D7, so --iid=7 is the set a Device7-only code path can reach.
    guidLabels: ['1', '2', '3', '7'] },
  { key: 'd3d8', dlls: ['d3d8.dll'], names: ['Direct3DCreate8'] },
  { key: 'd3d9', dlls: ['d3d9.dll'], names: ['Direct3DCreate9'] },
  { key: 'gl', dlls: ['opengl32.dll'],
    names: ['wglCreateContext', 'wglMakeCurrent', 'glBegin', 'glViewport'] },
];

// Substring search per name, native, for the reason tools/gl-name-census.js
// documents: the corpus is gigabytes and a printable-run scan in JavaScript
// does not finish. Case-insensitive for DLL names only, because an import
// table spells them however the linker felt -- D3D9.DLL and d3d9.dll both
// occur -- while an entry point is an exact exported symbol.
function hasName(buffer, name) {
  return buffer.indexOf(name, 0, 'latin1') >= 0;
}
function hasDll(buffer, lower, name) {
  return lower.indexOf(name) >= 0;
}

function hasGuid(buffer, words) {
  const bytes = Buffer.alloc(16);
  words.forEach((word, i) => bytes.writeUInt32LE(word >>> 0, i * 4));
  return buffer.indexOf(bytes) >= 0;
}

// The registry writes two path conventions: repo-rooted
// ('test/binaries/candidates/...', 'packages/...') and 'binaries/...',
// which resolves only through an untracked top-level `binaries ->
// test/binaries` symlink. A fresh worktree or bench-box copy has no such
// link, and there every 'binaries/' app silently dropped out of the
// census as "no 3D" (46 apps found instead of 86).
function resolveRel(rel) {
  return rel.startsWith('binaries/')
    ? path.join(__dirname, '..', 'test', rel) : path.join(__dirname, '..', rel);
}

// Mounted companion files, as absolute paths: `files` entries (a path or
// {url}) and a localFileManifest's {url} entries, which are relative to the
// manifest's own directory. Only MZ-headed ones are kept by the caller.
function companionFiles(app) {
  const out = [];
  for (const file of app.files || []) {
    const rel = typeof file === 'string' ? file : file && file.url;
    if (rel) out.push(resolveRel(rel));
  }
  if (app.localFileManifest) {
    const manifest = resolveRel(app.localFileManifest);
    try {
      const { files = [] } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      for (const file of files) {
        if (file && file.url) out.push(path.join(path.dirname(manifest), file.url));
      }
    } catch { /* no manifest on this box: the exe and dlls still count */ }
  }
  return out;
}

function isMz(abs) {
  let fd;
  try {
    fd = fs.openSync(abs, 'r');
    const head = Buffer.alloc(2);
    return fs.readSync(fd, head, 0, 2, 0) === 2 && head.readUInt16LE(0) === 0x5a4d;
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function scanApp(id, app) {
  const own = [app.exe, ...(app.dlls || [])].filter(Boolean).map(resolveRel);
  const seen = new Set(own);
  const files = [...own,
    ...companionFiles(app).filter(abs => !seen.has(abs) && (seen.add(abs), isMz(abs)))];
  const hits = new Map();
  let scanned = 0, missing = 0;
  for (const abs of files) {
    let buffer;
    try { buffer = fs.readFileSync(abs); }
    catch { missing++; continue; }
    if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) continue;
    scanned++;
    const lower = buffer.toString('latin1').toLowerCase();
    for (const family of FAMILIES) {
      const viaDll = family.dlls.some(d => hasDll(buffer, lower, d));
      const viaName = family.names.some(n => hasName(buffer, n));
      const guidHits = (family.guids || []).map(g => hasGuid(buffer, g));
      const viaGuid = guidHits.some(Boolean);
      if (!viaDll && !viaName && !viaGuid) continue;
      const how = hits.get(family.key) || new Set();
      if (viaDll) how.add('dll');
      if (viaName) how.add('name');
      if (viaGuid) how.add('iid');
      guidHits.forEach((hit, i) => {
        if (hit) (how.iids = how.iids || new Set()).add(family.guidLabels[i]);
      });
      hits.set(family.key, how);
      const where = family.key === 'gl' || hits.size ? path.basename(abs) : null;
      if (where) (how.files = how.files || new Set()).add(where);
    }
  }
  return { id, scanned, missing, hits };
}

function main(argv) {
  const flags = argv.filter(a => a.startsWith('--'));
  const flag = name => flags.find(f => f.startsWith(`--${name}=`))?.split('=')[1];
  const only = flag('apps')?.split(',');
  const wantFamilies = flag('family')?.split(',');
  const desktopOnly = flags.includes('--desktop');
  const wantIid = flag('iid');
  const list = flags.includes('--list');
  const json = flags.includes('--json');

  let ids = Object.keys(APPS);
  if (desktopOnly) ids = ids.filter(id => DESKTOP_APPS.includes(id));
  if (only) ids = ids.filter(id => only.includes(id));

  const rows = [];
  for (const id of ids) {
    const row = scanApp(id, APPS[id]);
    if (!row.hits.size) continue;
    if (wantFamilies && !wantFamilies.some(f => row.hits.has(f))) continue;
    if (wantIid && ![...row.hits.values()].some(how => how.iids && how.iids.has(wantIid))) continue;
    rows.push(row);
  }

  if (json) {
    console.log(JSON.stringify(rows.map(r => ({
      id: r.id, scanned: r.scanned, missing: r.missing,
      families: Object.fromEntries([...r.hits].map(([k, v]) => [k, [...v].sort()])),
      iids: Object.fromEntries([...r.hits].filter(([, v]) => v.iids)
        .map(([k, v]) => [k, [...v.iids].sort()])),
    })), null, 2));
    return 0;
  }

  const counts = {};
  for (const family of FAMILIES) {
    counts[family.key] = rows.filter(r => r.hits.has(family.key)).length;
  }
  console.log(`[gfx-app-census] ${rows.length} of ${ids.length} registry apps`
    + ' reach a 3D API');
  for (const family of FAMILIES) {
    console.log(`  ${String(counts[family.key]).padStart(4)}  ${family.key}`);
  }
  if (list) {
    console.log('');
    for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
      const families = [...row.hits].map(([k, v]) => `${k}(${[...v].sort().join('+')}`
        + `${v.iids ? ':' + [...v.iids].sort().join('/') : ''})`);
      console.log(`  ${row.id.padEnd(28)} ${families.join(' ')}`
        + (row.missing ? `  [${row.missing} file(s) missing]` : ''));
    }
  }
  console.log('[gfx-app-census] static reach, not use -- an app that ships two'
    + ' renderers names both. Confirm with --gl-census or a traced run.');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
// Every PE module an app mounts: its exe and path-form dlls, then the MZ-headed
// companions from `files` and its localFileManifest. Shared with
// tools/mouse-model-census.js so both censuses see the same set.
function appModules(app) {
  const own = [app.exe, ...(app.dlls || [])].filter(Boolean).map(resolveRel);
  const seen = new Set(own);
  return [...own, ...companionFiles(app).filter(abs => !seen.has(abs) && (seen.add(abs), isMz(abs)))];
}

module.exports = { scanApp, FAMILIES, appModules, hasGuid };
