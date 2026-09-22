#!/usr/bin/env node
'use strict';

// tl;dr: census of the "translate once, then read/write a whole struct" pattern
// in src/*.wat. A local set from $g2w holds a pointer that is only guaranteed
// good for ONE guest page: two adjacent sparse guest pages need not be adjacent
// in WASM memory, so a plain i32.load/i32.store/memory.fill through that
// pointer at a large offset can land in unrelated memory. This finds every such
// local and ranks it by the furthest byte it touches. Ranked, not judged -- a
// pointer into an emulator-owned arena is always linear and is a false positive
// here -- so the extent is the signal, and $guest_span_in is the fix.
//
// CALLER vs internal is "did the guest address come in as a parameter of this
// function", which is the right question for a $handle_* front door and only a
// hint for a helper: a helper's parameter may carry an address the emulator
// allocated itself, and that one cannot straddle. So read a CALLER row on a
// helper by following who calls it. The rows worth acting on are the large
// ones on $handle_* entry points, where the buffer is the guest's own.
//
//   node tools/check-guest-span.js                 # census, worst first
//   node tools/check-guest-span.js --min=64        # only spans past 64 bytes
//   node tools/check-guest-span.js --file=09a4     # one fragment
//   node tools/check-guest-span.js --json
//   node tools/check-guest-span.js --record        # bank the current count
//   node tools/check-guest-span.js --check         # fail if it grew (build gate)

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const BASELINE = path.join(__dirname, 'guest-span-baseline.json');

const args = process.argv.slice(2);
const flag = name => args.some(a => a === `--${name}`);
const value = (name, dflt) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const MIN = parseInt(value('min', '8'), 10);
const FILE_FILTER = value('file', null);

// Split a fragment into its top-level (func ...) forms, tracking line numbers.
// The fragments have no (module ...) wrapper, so top level is column zero-ish.
function functions(text) {
  const out = [];
  let i = 0;
  while (true) {
    const start = text.indexOf('(func', i);
    if (start === -1) break;
    let depth = 0, j = start;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === ';' && text[j - 1] === ';') { // line comment
        const nl = text.indexOf('\n', j);
        if (nl === -1) { j = text.length; break; }
        j = nl;
        continue;
      }
      if (c === '"') { // string literal
        j++;
        while (j < text.length && !(text[j] === '"' && text[j - 1] !== '\\')) j++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    const body = text.slice(start, j + 1);
    const name = (body.match(/^\(func\s+(\$[\w.\-$]+)/) || [])[1] || '(anonymous)';
    const params = [...body.matchAll(/\(param\s+(\$[\w.\-$]+)\s+i32\)/g)].map(m => m[1]);
    out.push({ name, body, params, line: text.slice(0, start).split('\n').length });
    i = j + 1;
  }
  return out;
}

// The furthest byte a function touches through `local`, or 0 if it only ever
// passes it along to another function (which is that function's business).
function extentOf(body, local) {
  const esc = local.replace('$', '\\$');
  let max = 0;
  const bump = n => { if (n > max) max = n; };

  // (i32.store offset=N (local.get $x) ...) / i32.load8_u offset=N ...
  const memarg = new RegExp(
    `\\((i32|i64|f32|f64)\\.(load|store)(8|16|32)?(_[su])?\\s+offset=(0x[0-9a-fA-F]+|\\d+)[^()]*\\(local\\.get\\s+${esc}\\)`, 'g');
  for (const m of body.matchAll(memarg)) bump(parseInt(m[5]) + 8);

  // (i32.store (i32.add (local.get $x) (i32.const N)) ...) and the load twin
  const addform = new RegExp(
    `\\(i32\\.add\\s+\\(local\\.get\\s+${esc}\\)\\s+\\(i32\\.const\\s+(0x[0-9a-fA-F]+|\\d+)\\)`, 'g');
  for (const m of body.matchAll(addform)) bump(parseInt(m[1]) + 8);

  // (memory.fill (local.get $x) (i32.const 0) (i32.const N))
  const fill = new RegExp(
    `\\(memory\\.(fill|copy)\\s+\\(local\\.get\\s+${esc}\\)[^)]*\\)[^)]*\\(i32\\.const\\s+(0x[0-9a-fA-F]+|\\d+)\\)`, 'g');
  for (const m of body.matchAll(fill)) bump(parseInt(m[2]));

  // (call $zero_memory (local.get $x) (i32.const N))
  const zero = new RegExp(
    `\\(call\\s+\\$zero_memory\\s+\\(local\\.get\\s+${esc}\\)\\s+\\(i32\\.const\\s+(0x[0-9a-fA-F]+|\\d+)\\)`, 'g');
  for (const m of body.matchAll(zero)) bump(parseInt(m[1]));

  // A bare (i32.store (local.get $x) ...) still touches 4 bytes at offset 0.
  const bare = new RegExp(`\\(i32\\.(load|store)\\s+\\(local\\.get\\s+${esc}\\)`, 'g');
  if (bare.test(body)) bump(4);

  return max;
}

const files = fs.readdirSync(SRC)
  .filter(f => f.endsWith('.wat'))
  .filter(f => !FILE_FILTER || f.includes(FILE_FILTER));

const hits = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(SRC, file), 'utf8');
  for (const fn of functions(text)) {
    // Every local this function translates once and keeps, with a note on
    // where the guest address came from: an address derived from one of this
    // function's own PARAMETERS is a caller-supplied buffer and can be
    // anywhere, while one built from an allocation of ours is in an arena we
    // laid out and is linear by construction. Only the first kind can straddle.
    const translated = new Map();
    for (const m of fn.body.matchAll(/\(local\.set\s+(\$[\w.\-$]+)\s+\(call\s+\$g2w\s/g)) {
      const argStart = m.index + m[0].length;
      let depth = 1, j = argStart;
      for (; j < fn.body.length && depth > 0; j++) {
        if (fn.body[j] === '(') depth++;
        else if (fn.body[j] === ')') depth--;
      }
      const arg = fn.body.slice(argStart, j);
      const fromParam = fn.params.some(p =>
        new RegExp(`\\(local\\.get\\s+\\${p}\\)`).test(arg));
      translated.set(m[1], fromParam ? 'caller' : 'internal');
    }
    // ... minus the ones already going through the gather arena.
    for (const m of fn.body.matchAll(/\(local\.set\s+(\$[\w.\-$]+)\s+\(call\s+\$guest_span_in\s/g)) {
      translated.delete(m[1]);
    }
    for (const [local, source] of translated) {
      const extent = extentOf(fn.body, local);
      if (extent >= MIN) hits.push({ file, fn: fn.name, line: fn.line, local, extent, source });
    }
  }
}

// Caller-supplied buffers first: those are the ones that can straddle.
const rank = h => (h.source === 'caller' ? 0 : 1);
hits.sort((a, b) => rank(a) - rank(b) || b.extent - a.extent || a.file.localeCompare(b.file));
const CALLER_ONLY = flag('caller-only');
const shown = CALLER_ONLY ? hits.filter(h => h.source === 'caller') : hits;

if (flag('json')) {
  console.log(JSON.stringify({ min: MIN, count: shown.length, hits: shown }, null, 2));
  process.exit(0);
}

if (flag('record')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ min: MIN, count: hits.length }, null, 2) + '\n');
  console.log(`check-guest-span: banked ${hits.length} site(s) at --min=${MIN}`);
  process.exit(0);
}

if (flag('check')) {
  if (!fs.existsSync(BASELINE)) {
    console.error('check-guest-span: no baseline; run --record first');
    process.exit(1);
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  if (base.min !== MIN) {
    console.error(`check-guest-span: baseline was banked at --min=${base.min}, this run is --min=${MIN}`);
    process.exit(1);
  }
  if (hits.length > base.count) {
    console.error(`check-guest-span: FAIL ${hits.length} site(s), above the ${base.count}-site baseline.`);
    console.error('A local translated once with $g2w and then used as a struct base is only');
    console.error('safe for one guest page. Use $guest_span_in/$guest_span_writeback, or');
    console.error('read the fields with $gl32/$gs32 on the guest address.');
    for (const h of hits.slice(0, 5)) {
      console.error(`  ${h.file}:${h.line} ${h.fn} ${h.local} touches ${h.extent} bytes`);
    }
    process.exit(1);
  }
  const note = hits.length < base.count ? `, ${base.count - hits.length} fewer than the baseline (run --record to bank it)` : '';
  console.log(`check-guest-span OK: ${hits.length} site(s) at --min=${MIN}${note}`);
  process.exit(0);
}

for (const h of shown) {
  console.log(`${h.source === 'caller' ? 'CALLER  ' : 'internal'} ${String(h.extent).padStart(6)}  ${h.file}:${h.line}  ${h.fn}  ${h.local}`);
}
const callers = hits.filter(h => h.source === 'caller').length;
console.log(`\n${hits.length} site(s) touching >= ${MIN} bytes through a single $g2w translation,`);
console.log(`${callers} of them a CALLER-supplied address. Those are the ones that can straddle:`);
console.log('an address this function built from its own allocation lives in an arena we');
console.log('laid out and is linear by construction. Extent is the furthest byte reached,');
console.log('not a verdict -- read the CALLER rows, largest first.');
