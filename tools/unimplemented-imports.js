#!/usr/bin/env node
// Which of a PE's imports would kill the run?
//
//   node tools/unimplemented-imports.js <pe> [<pe>...] [--json] [--all]
//
// Every unimplemented Win32 handler calls $crash_unimplemented, which traps --
// that is the project's fail-fast rule, and it is what you want. The cost is
// that an app finds them one at a time, and each one costs a whole run to
// reach: Black & White 2 needs about twenty minutes of software rendering to
// get back to its land load, so a stub found there is twenty minutes per API.
// This answers the same question statically, for every import at once, before
// any of them is reached.
//
// An ordinary function import is reported when its name has no row in
// src/api_table.json at all, or when the row's handler function calls
// $crash_unimplemented. MSVCRT data exports are resolved by the PE loader to
// storage cells rather than callable API thunks and are audited separately.
// Rows that
// share a handler (the D3D8-on-D3D9 aliases, the A/W pairs) are resolved
// through the row's own "handler" field, so an alias of a live handler is not
// reported as missing.
//
// Two things it cannot see, so do not read a clean report as "this app will
// run": an API reached through GetProcAddress appears in no import table, and
// a handler that is present but wrong is not a stub. It also says nothing
// about whether the app calls a given import at all -- an import table lists
// what the linker recorded, not what executes.

'use strict';
const fs = require('fs');
const path = require('path');
const { readPE } = require(path.join(__dirname, '..', 'lib', 'pe.js'));

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const asJson = args.includes('--json');
const showAll = args.includes('--all');
if (!files.length) {
  console.error('Usage: unimplemented-imports.js <pe> [<pe>...] [--json] [--all]');
  process.exit(1);
}

// name -> handler function name, from the API registry.
const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'api_table.json'), 'utf8'));
const handlerOf = new Map(table.map(e => [e.name, e.handler || e.name]));
const msvcrtDataImports = new Set(['_acmdln', '__argc', '__argv']);
const isResolvedDataImport = imp =>
  /^msvcrt(?:\.dll)?$/i.test(imp.dll) && msvcrtDataImports.has(imp.name);

// handler name -> does its body trap? One pass over the WAT sources, splitting
// on the (func $handle_ boundary rather than parsing: a stub is one line and
// the marker is unambiguous.
const stubs = new Set(), defined = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
  if (!f.endsWith('.wat')) continue;
  const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const parts = src.split(/\(func \$handle_/g);
  for (let i = 1; i < parts.length; i++) {
    const name = (parts[i].match(/^[A-Za-z0-9_]+/) || [''])[0];
    if (!name) continue;
    defined.add(name);
    // The body ends where the next handler begins; a trap anywhere in it is
    // what matters, since a handler that can crash on some path still runs.
    if (/\$crash_unimplemented/.test(parts[i])) stubs.add(name);
  }
}

function imports(file) {
  const pe = readPE(file);
  const buf = pe.buf, imageBase = pe.imageBase;
  const importRVA = buf.readUInt32LE(pe.peOff + 24 + 104);
  const rva2off = rva => pe.va2off(imageBase + rva);
  const readStr = off => {
    let s = '';
    for (let i = 0; off + i < buf.length && buf[off + i]; i++) s += String.fromCharCode(buf[off + i]);
    return s;
  };
  const out = [];
  let off = rva2off(importRVA);
  if (off < 0) return out;
  while (off + 20 <= buf.length) {
    const iltRVA = buf.readUInt32LE(off), nameRVA = buf.readUInt32LE(off + 12);
    const iatRVA = buf.readUInt32LE(off + 16);
    if (iltRVA === 0 && nameRVA === 0) break;
    const dll = readStr(rva2off(nameRVA));
    // OriginalFirstThunk is optional; some linkers leave only the IAT.
    const iltOff = rva2off(iltRVA || iatRVA);
    if (iltOff >= 0) {
      for (let j = 0; iltOff + j * 4 + 4 <= buf.length; j++) {
        const entry = buf.readUInt32LE(iltOff + j * 4);
        if (entry === 0) break;
        if (entry & 0x80000000) { out.push({ dll, name: null, ordinal: entry & 0xFFFF }); continue; }
        const hintOff = rva2off(entry);
        if (hintOff < 0) continue;
        out.push({ dll, name: readStr(hintOff + 2) });
      }
    }
    off += 20;
  }
  return out;
}

const report = [];
for (const file of files) {
  let list;
  try { list = imports(file); }
  catch (error) { console.error(`${file}: ${error.message}`); continue; }
  const rows = [];
  // A DLL shipped next to the executable is loaded for real, so its exports are
  // guest code, not emulator handlers, and it has no business in this report.
  // (Its own imports do -- pass the DLL as another argument for those.)
  const dir = path.dirname(path.resolve(file));
  const provided = name => fs.existsSync(path.join(dir, name));
  for (const imp of list) {
    if (!imp.name) continue;                       // ordinal imports carry no name to match
    if (provided(imp.dll)) continue;
    const handler = handlerOf.get(imp.name);
    const status = isResolvedDataImport(imp) ? 'ok (data import)'
      : !handler ? 'no api_table row'
      : !defined.has(handler) ? `no $handle_${handler}`
      : stubs.has(handler) ? 'crash_unimplemented'
      : 'ok';
    if (!status.startsWith('ok') || showAll) rows.push({ ...imp, handler: handler || null, status });
  }
  report.push({ file, total: list.length, rows });
}

if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
let missing = 0;
for (const entry of report) {
  console.log(`\n${entry.file}  (${entry.total} imports)`);
  const byDll = new Map();
  for (const row of entry.rows) {
    if (!byDll.has(row.dll)) byDll.set(row.dll, []);
    byDll.get(row.dll).push(row);
  }
  if (!byDll.size) { console.log('  every named import has a live handler'); continue; }
  for (const [dll, rows] of byDll) {
    console.log(`  ${dll}`);
    for (const row of rows) {
      if (!row.status.startsWith('ok')) missing++;
      console.log(`    ${row.name.padEnd(40)} ${row.status}`);
    }
  }
}
console.log(`\n${missing} import(s) would trap.`);
