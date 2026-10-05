'use strict';

// A module of ONLY the region functions, for the separate-module region JIT.
//
//   node tools/toyvm/run-dos.js DEMO.EXE --region-jit --region-jit-sep
//
// The rebuild install (region-live.js) compiles the whole interpreter again
// with the region appended to its handler table, audits it, and moves the guest
// onto the new instance: ~2s of compile and audit per install, and a fresh
// instance the engine tiers up from nothing while the guest is on it. This
// builds the region on its own instead. The running interpreter is emitted with
// `exportAll` (emit.js), which names its handler table and every global and
// function it has; the region module imports exactly the ones its bodies
// reach, and the install instantiates it against the LIVE instance's exports
// and writes its functions into new table slots. The interpreter's instance is
// never replaced, so nothing has to be carried and nothing re-tiers.
//
// WHAT CROSSING THE BOUNDARY COSTS, which is what this arm measures against the
// rebuild arm: a region's reads of `$steps`/`$smc`/`$gip`/`$halt`/the lazy flag
// record are imported mutable globals (one more indirection each), and its
// calls into helpers (`$rd8b`, `$rec_add`, ...) are calls to an imported
// function in another instance. trace-jit.js deliberately duplicated helpers to
// keep that out of its measurement; here it IS the measurement.

const { LOCALS, lowerRegs } = require('./emit');
const crypto = require('crypto');
const path = require('path');

// Declarations of the interpreter the regions will import from, parsed out of
// the RUNNING module's own text (`vm.wat`) -- emitting it again just to read
// signatures was ~0.7s, against ~2ms to compile the region module itself. Plain
// arrays, because this rides to the worker inside the profile bundle.
function declsFromWat(wat) {
  const globals = new Map(), funcs = new Map();
  for (const m of wat.matchAll(/^\(global \$([\w.]+) (\(mut \w+\)|\w+) /gm)) globals.set(m[1], m[2]);
  const sig = (rest) => [...rest.matchAll(/\((param|result)(?: \$[\w.]+)? (\w+)\)/g)]
    .map(x => `(${x[1]} ${x[2]})`).join(' ');
  // A function header is one line in emit.js's output; the signature is the
  // run of (param ..)/(result ..) forms before the first (local ..) or body.
  for (const m of wat.matchAll(/^\(func \$([\w.]+)((?: \((?:param|result)[^()]*\))*)/gm)) {
    funcs.set(m[1], sig(m[2]));
  }
  for (const m of wat.matchAll(/^\(import "[^"]+" "[^"]+" \(func \$([\w.]+)((?: \((?:param|result)[^()]*\))*)/gm)) {
    funcs.set(m[1], sig(m[2]));
  }
  const mem = wat.match(/^\(import "host" "memory" \(memory [^)]*\)\)/m);
  if (!mem) throw new Error('region-sep: no memory import in the interpreter build');
  const types = [...wat.matchAll(/^\(type \$[\w.]+ \(func[^\n]*\)\)$/gm)].map(m => m[0]);
  return { globals: [...globals], funcs: [...funcs], memory: mem[0], types };
}

// The module text for `regions` (each { name, locals, body }), every one
// ending in the interpreter's own dispatch tail.
function regionModuleWat(decls, regions) {
  const d = { ...decls, globals: new Map(decls.globals), funcs: new Map(decls.funcs) };
  // Registers are register-file slots, not globals, by the time the
  // interpreter is compiled; the same pass lowers the region bodies here.
  regions = regions.map(r => ({ ...r, body: lowerRegs(r.body) }));
  const text = regions.map(r => r.body).join('\n');
  const usedG = new Set(), usedF = new Set(['next']);
  for (const m of text.matchAll(/global\.[gs]et \$([\w.]+)/g)) usedG.add(m[1]);
  for (const m of text.matchAll(/\b(?:return_)?call \$([\w.]+)/g)) usedF.add(m[1]);
  const lines = ['(module', d.memory, '(import "l1" "h" (table $h 0 funcref))'];
  for (const g of usedG) {
    if (!d.globals.has(g)) throw new Error(`region-sep: no global $${g} in the interpreter`);
    lines.push(`(import "l1" "g$${g}" (global $${g} ${d.globals.get(g)}))`);
  }
  for (const f of usedF) {
    if (!d.funcs.has(f)) throw new Error(`region-sep: no function $${f} in the interpreter`);
    lines.push(`(import "l1" "f$${f}" (func $${f} ${d.funcs.get(f)}))`);
  }
  lines.push(...d.types);
  for (const r of regions) {
    lines.push(`(func $${r.name} (export "${r.name}") ${LOCALS} ${r.locals || ''}\n${r.body}\n(return_call $next))`);
  }
  lines.push(')');
  return lines.join('\n');
}

async function buildRegionModule(decls, regions) {
  const { compileWat } = require(path.join(__dirname, '..', '..', 'lib', 'compile-wat.js'));
  const wat = regionModuleWat(decls, regions);
  const key = crypto.createHash('sha256').update(wat).digest('hex').slice(0, 16);
  const file = `toyvm-region-sep-${key}.wat`;
  const bytes = await compileWat(
    (f) => { if (f !== file) throw new Error(`unexpected file ${f}`); return wat; },
    { files: [file], cacheKey: `toyvm:region-sep:${key}` },
  );
  return { wat, bytes };
}

// Install a compiled region module into the running instance: instantiate it
// against that instance's exports, then write each region into the handler
// table at `base + idx`, growing the table to reach it. Returns the slots.
function installRegionModule(vm, bytes, picks) {
  const ex = vm.exports;
  if (!ex.h) throw new Error('region-sep: the running module was not built with exportAll');
  const module = new WebAssembly.Module(bytes);
  const inst = new WebAssembly.Instance(module, { host: { memory: vm.memory }, l1: ex });
  const slots = [];
  for (const p of picks) {
    const slot = vm.regionBase + p.idx;
    if (ex.h.length <= slot) ex.h.grow(slot + 1 - ex.h.length);
    ex.h.set(slot, inst.exports[p.region.name]);
    slots.push(slot);
  }
  return slots;
}

module.exports = { regionModuleWat, buildRegionModule, installRegionModule, declsFromWat };
