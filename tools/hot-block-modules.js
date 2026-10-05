#!/usr/bin/env node
//
// Which MODULE is a gameplay window actually spending its block entries in?
//
// `test/run.js --hot-block-dump=FILE` writes the whole executed-block working
// set as "0xADDR COUNT" lines. The printed "top blocks" list in the log is only
// the top 20, and neither form says which DLL an address is in -- so a census
// gets eyeballed from a handful of leading hex digits, which is how a loop in a
// decompressor gets attributed to the game engine.
//
// tools/browser-handler-hist.js already does module attribution, but only for
// the page-probe JSON that tools/page-probes/read-handler-hist.js produces; it
// rejects a --hot-block-dump outright. This is the missing half: the same
// question asked of a headless run.
//
// Module bases come from run.js's own log lines, so they are the bases the run
// actually used rather than anything hardcoded:
//
//   DLL: storm.dll at 0x79c000, DllMain=0x7bfaa0, thunks=2017, origBase=0x15000000
//   [LoadLibrary] local.dll loaded at 0x9f0000, dllMain=0x9f1100
//
// Usage:
//   node tools/hot-block-modules.js <dump> --log=<run.log> [--top=N] [--exe-base=0x400000]
//
// The original-VA column matters for cross-referencing a disassembly: a module
// is loaded at a runtime base that has nothing to do with its link-time
// origBase, and every static tool (disasm_fn, xrefs, find_fn) speaks origBase.

'use strict';

const fs = require('fs');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const positional = args.filter(a => !a.startsWith('--'));
const dumpPath = positional[0];
const logPath = flag('log', null);
const top = parseInt(flag('top', '25'), 10);
// The PE's own preferred image base. Everything below it that is not a known
// DLL is reported as such rather than silently folded into the EXE.
const exeBase = parseInt(flag('exe-base', '0x400000'), 16);

if (!dumpPath || !fs.existsSync(dumpPath)) {
  console.error('usage: node tools/hot-block-modules.js <hot-block-dump> --log=<run.log> [--top=N]');
  process.exit(2);
}

// --- module table -----------------------------------------------------------
// Each entry is a runtime base; the span of a module is "up to the next base",
// which is an approximation but a safe one here: the loader packs modules in
// ascending order and a gap only ever over-attributes to the lower module,
// never across an unrelated one.
const modules = [{ name: 'exe', base: exeBase, origBase: exeBase }];
if (logPath && fs.existsSync(logPath)) {
  const log = fs.readFileSync(logPath, 'utf8');
  const dllRe = /^DLL: (\S+) at (0x[0-9a-f]+).*?origBase=(0x[0-9a-f]+)/gmi;
  const loadRe = /^\[LoadLibrary\] (\S+) loaded at (0x[0-9a-f]+)/gmi;
  let m;
  while ((m = dllRe.exec(log))) {
    modules.push({ name: m[1], base: parseInt(m[2], 16), origBase: parseInt(m[3], 16) });
  }
  while ((m = loadRe.exec(log))) {
    const base = parseInt(m[2], 16);
    if (!modules.some(mod => mod.base === base)) {
      modules.push({ name: m[1], base, origBase: null });
    }
  }
}
modules.sort((a, b) => a.base - b.base);

const moduleFor = (addr) => {
  let best = null;
  for (const mod of modules) {
    if (mod.base <= addr && (!best || mod.base > best.base)) best = mod;
  }
  return best;
};

// --- the dump ---------------------------------------------------------------
const rows = [];
let total = 0;
for (const line of fs.readFileSync(dumpPath, 'utf8').split('\n')) {
  const m = /^(0x[0-9a-f]+)\s+(\d+)/i.exec(line.trim());
  if (!m) continue;
  const addr = parseInt(m[1], 16);
  const count = Number(m[2]);
  rows.push({ addr, count });
  total += count;
}
if (!total) { console.error('no "0xADDR COUNT" rows found in ' + dumpPath); process.exit(2); }

// --- per-module rollup ------------------------------------------------------
const byModule = new Map();
for (const row of rows) {
  const mod = moduleFor(row.addr);
  const key = mod ? mod.name : 'below-exe';
  const entry = byModule.get(key) || { name: key, count: 0, blocks: 0, mod };
  entry.count += row.count;
  entry.blocks++;
  byModule.set(key, entry);
}

console.log(`blocks: ${rows.length} distinct, ${total} entries total`);
console.log(`modules known: ${modules.map(m => `${m.name}@0x${m.base.toString(16)}`).join(' ')}`);
console.log('');
console.log('per module:');
for (const e of [...byModule.values()].sort((a, b) => b.count - a.count)) {
  const pct = (e.count / total * 100).toFixed(2).padStart(6);
  console.log(`  ${pct}%  ${String(e.count).padStart(12)}  ${String(e.blocks).padStart(5)} blocks  ${e.name}`);
}

console.log('');
console.log(`top ${top} blocks:`);
for (const row of rows.sort((a, b) => b.count - a.count).slice(0, top)) {
  const mod = moduleFor(row.addr);
  const off = mod ? row.addr - mod.base : 0;
  const orig = mod && mod.origBase !== null ? `  orig 0x${(mod.origBase + off).toString(16)}` : '';
  const pct = (row.count / total * 100).toFixed(2).padStart(5);
  console.log(`  ${pct}%  0x${row.addr.toString(16).padStart(8, '0')}  ` +
    `${mod ? mod.name : '?'}+0x${off.toString(16)}${orig}`);
}
