#!/usr/bin/env node
'use strict';

// Which apps in the registry reach a 3D API, and which one?
// `node tools/gfx-app-census.js [--apps=a,b] [--desktop] [--family=gl,d3d9]
// [--list] [--json]`
//
// WHY THIS EXISTS. "Get every OpenGL/Direct3D app working" is not a
// measurable goal until the set is named, and the set was being guessed at
// from memory of which apps happened to come up in past sessions. This walks
// lib/apps.js -- the registry both hosts read -- and reports, per app, which
// 3D families its own binaries can reach.
//
// WHAT IT SCANS, AND WHY NOT EVERYTHING. The `exe` and the `dlls` list, which
// are the PE files that belong to the app. Data files are skipped: a .pak or
// a .mpq can contain any bytes at all, including these names, and a hit in one
// says nothing about what the program calls.
//
// HOW A FAMILY IS DETECTED. Two kinds of evidence, and the tool distinguishes
// them because they are not equally strong:
//   - an IMPORT of the family's DLL name, which means the loader will resolve
//     it at load time whatever the app then does with it;
//   - an entry-point NAME literal, which is what GetProcAddress is handed.
// Direct3D is usually the first (a program links d3d9.dll or ddraw.dll), GL is
// usually the second, because every GL engine in this corpus resolves GL
// through GetProcAddress -- see tools/gl-name-census.js, which has the long
// version of that finding. A DLL-name hit is reported as `dll` and a
// name-literal hit as `name`; both are reach, neither is a call.
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
    names: ['IID_IDirect3D7', 'IID_IDirect3D3', 'IID_IDirect3D2'] },
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

function scanApp(id, app) {
  const files = [app.exe, ...(app.dlls || [])].filter(Boolean);
  const hits = new Map();
  let scanned = 0, missing = 0;
  for (const rel of files) {
    let buffer;
    try { buffer = fs.readFileSync(path.join(__dirname, '..', rel)); }
    catch { missing++; continue; }
    if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) continue;
    scanned++;
    const lower = buffer.toString('latin1').toLowerCase();
    for (const family of FAMILIES) {
      const viaDll = family.dlls.some(d => hasDll(buffer, lower, d));
      const viaName = family.names.some(n => hasName(buffer, n));
      if (!viaDll && !viaName) continue;
      const how = hits.get(family.key) || new Set();
      if (viaDll) how.add('dll');
      if (viaName) how.add('name');
      hits.set(family.key, how);
      const where = family.key === 'gl' || hits.size ? path.basename(rel) : null;
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
    rows.push(row);
  }

  if (json) {
    console.log(JSON.stringify(rows.map(r => ({
      id: r.id, scanned: r.scanned, missing: r.missing,
      families: Object.fromEntries([...r.hits].map(([k, v]) => [k, [...v].sort()])),
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
      const families = [...row.hits].map(([k, v]) => `${k}(${[...v].sort().join('+')})`);
      console.log(`  ${row.id.padEnd(28)} ${families.join(' ')}`
        + (row.missing ? `  [${row.missing} file(s) missing]` : ''));
    }
  }
  console.log('[gfx-app-census] static reach, not use -- an app that ships two'
    + ' renderers names both. Confirm with --gl-census or a traced run.');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { scanApp, FAMILIES };
