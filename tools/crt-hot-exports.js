#!/usr/bin/env node
'use strict';

// Which C runtime EXPORTS does an app spend its block entries in -- and would
// answering them natively ($native_override_export_api_id, 08b-dll-loader.wat)
// take that work away?
//
//   node tools/crt-hot-exports.js <hist.json> [<hist.json> ...]
//     [--pe=msvcrt.dll=PATH ...] [--pe-dir=DIR ...] [--crt=REGEX]
//     [--exe-base=0x400000] [--top=N] [--json]
//
// Input: test/run.js --handler-hist --handler-hist-thread=0[,0,0]
//   --hist-json=F --hist-json-blocks=0 --edge-hist   (the same windows
//   tools/call-form-weighted.js reads). Edges are what make this work; without
//   them every block goes to the nearest preceding export and internal helpers
//   are charged to whichever export happens to sit below them in the file.
//
// How a block is charged:
//   1. Function entries in each CRT module = every named export, plus every
//      address inside the module that a runtime CALL edge landed on (a block
//      whose terminator decodes as `call`, with the edge target != its return
//      address). That picks up internal helpers like msvcr70's `_getptd`,
//      `_output`, `_flsbuf` that are not exported.
//   2. A block belongs to the nearest function entry at or below it (MSVC lays
//      each function out contiguously). That is its SELF weight.
//   3. INCLUSIVE weight is gprof's: a callee's inclusive weight is split over
//      its callers in proportion to the call edges each one made, and only
//      edges inside CRT modules propagate -- a qsort comparator in the exe is
//      not qsort's, and a strlen called by the exe is the exe's own call.
//      Cycles (recursive helpers) are cut at the back edge.
//   4. "calls" is how many times control ENTERED the export from outside its
//      own body: the invocation count, from any module.
//
// Every share is of ALL block entries (threaded + inside uop programs). Blocks
// that ran inside a uop program are not in the per-block list, so a CRT loop the
// tier compiled is UNDER-counted here -- the `uop` column says how much of the
// window was out of sight. Pass --no-uop runs for a complete attribution.
//
// Overridden exports are read from $native_override_export_api_id in
// src/08b-dll-loader.wat and $crt_override_api_id in src/09a6-handlers-crt.wat,
// so the `ovr` column cannot drift from the source. A census of a build WITH
// those overrides sees the overridden exports vanish (a thunk is not a CRT
// block), so run it on the build you are deciding about.

const fs = require('fs');
const path = require('path');
const { readPE } = require('../lib/pe');
const { disasmAt } = require('./disasm');
const { readHist, moduleList } = require('./hist-blocks');

const argv = process.argv.slice(2);
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const flags = n => argv.filter(x => x.startsWith(`--${n}=`)).map(x => x.slice(n.length + 3));
const files = argv.filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: crt-hot-exports.js <hist.json>... [--pe=NAME=PATH] [--pe-dir=DIR] [--crt=REGEX] [--top=N] [--json]');
  process.exit(2);
}
const TOP = parseInt(flag('top', '25'), 10);
const CRT_RE = new RegExp(flag('crt', '^msvc(?:rt|r\\d+|p\\d+)d?\\.dll$'), 'i');
const EXE_BASE = parseInt(flag('exe-base', '0x400000'), 16) >>> 0;
const hex = v => '0x' + (v >>> 0).toString(16);
const pct = (n, d) => d ? (100 * n / d).toFixed(2) : '0.00';

// ---- the override list, straight from the source -------------------------------
// The names each override function compares against: string literals and
// trailing `;; name` comments inside its body.
function namesInFunc(file, func) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  const s = src.indexOf(`(func ${func}`);
  if (s < 0) return [];
  const e = src.indexOf('\n  (func ', s + 10);
  const body = src.slice(s, e < 0 ? undefined : e);
  const names = [];
  for (const m of body.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) names.push(m[1]);
  for (const m of body.matchAll(/;;\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)) names.push(m[1]);
  return names;
}
function overriddenNames() {
  return new Set([
    // Any DLL's export, bound to a thunk with no way back (08b-dll-loader.wat).
    ...namesInFunc('08b-dll-loader.wat', '$native_override_export_api_id'),
    // MSVCRT/MSVCR7x only, with the authentic export behind the thunk as a
    // fallback (09a6-handlers-crt.wat, docs/crt-native-overrides.md).
    ...namesInFunc('09a6-handlers-crt.wat', '$crt_override_api_id'),
  ]);
}
const OVERRIDDEN = overriddenNames();

// ---- PE files ------------------------------------------------------------------
const peFiles = new Map();
for (const d of flags('pe-dir')) {
  for (const f of fs.readdirSync(d)) if (/\.(dll|exe)$/i.test(f)) {
    if (!peFiles.has(f.toLowerCase())) peFiles.set(f.toLowerCase(), path.join(d, f));
  }
}
for (const p of flags('pe')) {
  const i = p.indexOf('=');
  peFiles.set(p.slice(0, i).toLowerCase(), p.slice(i + 1));
}
const peCache = new Map();
function peFor(name) {
  const key = name.toLowerCase();
  if (!peCache.has(key)) {
    let pe = null;
    if (peFiles.has(key)) { try { pe = readPE(peFiles.get(key)); pe.path = peFiles.get(key); } catch (_) { pe = null; } }
    peCache.set(key, pe);
  }
  return peCache.get(key);
}

// Named exports as [{ name, va }] sorted by address; forwarders dropped.
function exportsOf(pe) {
  if (pe._exports) return pe._exports;
  const b = pe.buf, peOff = b.readUInt32LE(0x3c);
  const optOff = peOff + 24;
  const dirOff = optOff + (b.readUInt16LE(optOff) === 0x20b ? 112 : 96);
  const expRva = b.readUInt32LE(dirOff), expSize = b.readUInt32LE(dirOff + 4);
  const out = [];
  if (expRva) {
    const d = pe.va2off(pe.imageBase + expRva);
    const nFuncs = b.readUInt32LE(d + 20), nNames = b.readUInt32LE(d + 24);
    const aof = pe.va2off(pe.imageBase + b.readUInt32LE(d + 28));
    const aon = pe.va2off(pe.imageBase + b.readUInt32LE(d + 32));
    const ano = pe.va2off(pe.imageBase + b.readUInt32LE(d + 36));
    for (let i = 0; i < nNames; i++) {
      const no = pe.va2off(pe.imageBase + b.readUInt32LE(aon + i * 4));
      let name = '';
      for (let j = no; b[j]; j++) name += String.fromCharCode(b[j]);
      const idx = b.readUInt16LE(ano + i * 2);
      if (idx >= nFuncs) continue;
      const rva = b.readUInt32LE(aof + idx * 4);
      if (rva >= expRva && rva < expRva + expSize) continue; // forwarder
      out.push({ name, va: (pe.imageBase + rva) >>> 0 });
    }
  }
  out.sort((x, y) => x.va - y.va || x.name.localeCompare(y.name));
  pe._exports = out;
  return out;
}

// How does the block at `va` end? { kind: 'call', ret } | { kind: 'jmp' } | null
// (jmp covers jcc; null = ret, fallthrough into the next block, undecodable).
function blockExit(pe, va, isEntry) {
  let off = pe.va2off(va);
  if (off < 0) return null;
  for (let n = 0; n < 64; n++) {
    let line;
    try { line = disasmAt(pe.buf, off, va, 1)[0]; } catch (_) { return null; }
    const m = line && /^\s*[0-9a-f]+\s+((?:[0-9a-f]{2} )+)\s*(.*)$/.exec(line);
    if (!m) return null;
    const len = m[1].trim().split(/\s+/).length;
    const text = m[2].trim().toLowerCase();
    if (/^call /.test(text)) return { kind: 'call', ret: (va + len) >>> 0 };
    if (/^jmp /.test(text)) return { kind: 'jmp' };
    // msvcr70 `floor` is `cmp [sse2 flag],0 / jz <body 180KB away>`: a
    // conditional tail jump, so a far jcc is a function boundary too.
    if (/^j[a-z]+ /.test(text)) return { kind: 'jmp' };
    if (/^(?:j[a-z]+|ret[n]?|loop[a-z]*|iret|int3?|hlt|ud2)\b/.test(text)) return null;
    va = (va + len) >>> 0; off += len;
    if (isEntry(va)) return null;
  }
  return null;
}
// A jmp further than this is a tail call / a jump into a function body laid
// out elsewhere (msvcr70's `floor` is a stub that jumps 180KB up to its real
// body), so its target is a function entry too. A jmp inside one function is
// a short hop that never gets near this.
const FAR_JMP = 0x400;

// ---- one window ----------------------------------------------------------------
function analyse(file) {
  const hist = readHist(file);
  const mods = moduleList(hist, EXE_BASE).map(m => {
    const pe = peFor(m.name);
    const size = pe ? pe.buf.readUInt32LE(pe.buf.readUInt32LE(0x3c) + 0x50) : 0;
    return { ...m, pe, size };
  });
  const modOf = addr => {
    let hit = null;
    for (const m of mods) if (addr >= m.base && (!m.size || addr < m.base + m.size)) hit = m;
    return hit;
  };
  const blocks = (hist.blocks || []).map(([hx, n]) => [parseInt(hx, 16) >>> 0, n]);
  const hitsOf = new Map(blocks);
  const entries = new Set(blocks.map(b => b[0]));
  const threaded = hist.blockHits || blocks.reduce((a, b) => a + b[1], 0);
  const uop = hist.uop ? hist.uop.blocks >>> 0 : 0;
  const total = threaded + uop;
  const edges = (hist.edges || []).map(([f, t, n]) => [parseInt(f, 16) >>> 0, parseInt(t, 16) >>> 0, n]);

  const crt = mods.filter(m => CRT_RE.test(m.name));
  const missing = crt.filter(m => !m.pe).map(m => m.name);
  const perMod = [];
  for (const m of crt) {
    if (!m.pe) continue;
    const delta = (m.origBase - m.base) | 0;       // runtime -> file VA
    const toVa = a => (a + delta) >>> 0;
    const inMod = a => a >= m.base && a < m.base + m.size;
    // 1. function entries: exports + runtime call targets
    const fn = new Map();                          // file VA -> { name, exported }
    for (const x of exportsOf(m.pe)) {
      const f = fn.get(x.va);
      if (f) f.name += '=' + x.name; else fn.set(x.va, { name: x.name, exported: true, alias: [x.name] });
      if (f) f.alias.push(x.name);
    }
    const exitOf = new Map();
    const callEdges = [];                          // [fromRuntime, toRuntime, n]
    for (const [f, t, n] of edges) {
      const fm = modOf(f);
      if (!fm || !fm.pe) continue;
      if (!inMod(t)) continue;
      if (!exitOf.has(f)) {
        const d = (fm.origBase - fm.base) | 0;
        const x = blockExit(fm.pe, (f + d) >>> 0, va => entries.has((va - d) >>> 0));
        exitOf.set(f, x && x.kind === 'call' ? { kind: 'call', ret: (x.ret - d) >>> 0 } : x);
      }
      const x = exitOf.get(f);
      if (!x) continue;
      if (x.kind === 'call' && t === x.ret) continue;
      if (x.kind === 'jmp' && inMod(f) && Math.abs(t - f) < FAR_JMP) continue;
      callEdges.push([f, t, n]);
      const tv = toVa(t);
      if (!fn.has(tv)) fn.set(tv, { name: `sub_${tv.toString(16)}`, exported: false, alias: [] });
    }
    const starts = [...fn.keys()].sort((a, b) => a - b);
    const owner = va => {                          // nearest entry at or below
      let lo = 0, hi = starts.length - 1, r = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= va) { r = mid; lo = mid + 1; } else hi = mid - 1; }
      return r < 0 ? null : starts[r];
    };
    // 2. self weight
    const self = new Map();
    const topBlocks = new Map();                   // fn -> [[file VA, hits]]
    let modTotal = 0;
    for (const [a, n] of blocks) {
      if (!inMod(a)) continue;
      modTotal += n;
      const o = owner(toVa(a));
      if (o === null) continue;
      self.set(o, (self.get(o) || 0) + n);
      if (!topBlocks.has(o)) topBlocks.set(o, []);
      topBlocks.get(o).push([toVa(a), n]);
    }
    // 3. call graph among functions (inside this module), and 4. invocations
    const calls = new Map();                       // callee -> total call count (any caller)
    const inner = new Map();                       // caller -> Map(callee -> n), both in this module
    const callers = new Map();                     // callee -> Map(caller label -> n)
    const entered = new Map();                     // fn -> times entered from outside its own body
    for (const [f, t, n] of edges) {
      if (!inMod(t)) continue;
      const tv = toVa(t);
      const callee = owner(tv);
      if (callee === null || callee !== tv) continue;   // only edges onto an entry
      const fromIn = inMod(f);
      const caller = fromIn ? owner(toVa(f)) : null;
      if (fromIn && caller === callee) continue;         // own loop back to entry
      entered.set(callee, (entered.get(callee) || 0) + n);
      const fm = modOf(f);
      const label = fromIn ? (fn.get(caller) || {}).name : fm ? `${fm.name}+${hex((f - fm.base + fm.origBase) >>> 0)}` : hex(f);
      if (!callers.has(callee)) callers.set(callee, new Map());
      callers.get(callee).set(label, (callers.get(callee).get(label) || 0) + n);
    }
    for (const [f, t, n] of callEdges) {
      const callee = owner(toVa(t));
      calls.set(callee, (calls.get(callee) || 0) + n);
      if (!inMod(f)) continue;
      const caller = owner(toVa(f));
      if (caller === null || caller === callee) continue;
      if (!inner.has(caller)) inner.set(caller, new Map());
      inner.get(caller).set(callee, (inner.get(caller).get(callee) || 0) + n);
    }
    // gprof inclusive: incl(F) = self(F) + sum_C share(F->C) * incl(C)
    const incl = new Map();
    const onStack = new Set();
    const inclOf = F => {
      if (incl.has(F)) return incl.get(F);
      if (onStack.has(F)) return 0;                // cut the cycle here
      onStack.add(F);
      let v = self.get(F) || 0;
      for (const [C, n] of inner.get(F) || []) {
        const tot = calls.get(C) || n;
        v += inclOf(C) * (n / tot);
      }
      onStack.delete(F);
      incl.set(F, v);
      return v;
    };
    const rows = [];
    for (const va of starts) {
      const s = self.get(va) || 0;
      const i = inclOf(va);
      if (!s && !i) continue;
      const f = fn.get(va);
      const helpers = [...(inner.get(va) || [])].map(([C, n]) => ({ name: fn.get(C).name,
        share: inclOf(C) * (n / (calls.get(C) || n)) })).sort((a, b) => b.share - a.share);
      const cl = [...(callers.get(va) || [])].sort((a, b) => b[1] - a[1]);
      rows.push({ va, name: f.name, exported: f.exported,
        overridden: f.alias.some(n => OVERRIDDEN.has(n)), self: s, incl: i,
        entered: entered.get(va) || 0, helpers: helpers.slice(0, 4), callers: cl.slice(0, 4),
        blocks: (topBlocks.get(va) || []).sort((x, y) => y[1] - x[1]).slice(0, 4) });
    }
    rows.sort((a, b) => b.incl - a.incl);
    perMod.push({ name: m.name, path: m.pe.path, entryRva: m.pe.entryRva, base: m.base, origBase: m.origBase, modTotal, rows });
  }
  return { file, window: hist.window, threaded, uop, total, perMod, missing, haveEdges: edges.length > 0 };
}

// ---- report --------------------------------------------------------------------
const wins = files.map(analyse);
if (argv.includes('--json')) {
  console.log(JSON.stringify(wins.map(w => ({ ...w, perMod: w.perMod.map(p => ({ ...p, rows: p.rows.slice(0, 200) })) }))));
  process.exit(0);
}
const say = s => console.log(s);
const wl = w => w.window ? `${w.window.start}..${w.window.stop}` : path.basename(w.file);
for (const w of wins) {
  say(`\n=== ${w.file}  window ${wl(w)}: ${w.threaded} threaded + ${w.uop} uop block entries ` +
    `(uop ${pct(w.uop, w.total)}% not attributable per block)${w.haveEdges ? '' : '  NO EDGES: helpers charged by address only'}`);
  if (w.missing.length) say(`  no PE for: ${w.missing.join(', ')} (pass --pe=NAME=PATH)`);
  for (const p of w.perMod) {
    // DllMain = base + entryRva: check it against the run log's `DLL: ... DllMain=`
    // line, since one name (msvcrt.dll) covers several different builds.
    say(`  ${p.name} (${p.path}, DllMain would be ${hex(p.base + p.entryRva)}) base ${hex(p.base)}: ` +
      `${pct(p.modTotal, w.total)}% of all entries`);
    say('    ' + 'incl%'.padStart(6) + 'self%'.padStart(7) + '   calls'.padStart(10) + '  ovr  function; top internal callees (incl%); top callers');
    for (const r of p.rows.filter(r => r.exported || r.incl > 0).slice(0, TOP)) {
      if (!r.exported && !argv.includes('--internal')) {
        // internal helpers are shown folded into their exporters; list only the big ones
        if (r.incl / w.total < 0.005) continue;
      }
      const h = r.helpers.map(x => `${x.name} ${pct(x.share, w.total)}`).join(', ');
      const c = r.callers.map(([l, n]) => `${l} x${n}`).join(', ');
      say('    ' + pct(r.incl, w.total).padStart(6) + pct(r.self, w.total).padStart(7) +
        String(r.entered).padStart(10) + (r.overridden ? '  OVR ' : '      ') +
        `${r.exported ? '' : '(int) '}${r.name}${h ? '; ' + h : ''}${c ? '  <- ' + c : ''}`);
      // --blocks: the hottest blocks charged to this function, so a function
      // whose self weight is really a neighbour reached only by jmp (no call
      // edge made it an entry) is visible instead of silently mis-named.
      if (argv.includes('--blocks') && r.blocks.length) {
        say('            blocks: ' + r.blocks.map(([v, n]) => `${hex(v)} ${pct(n, w.total)}`).join(', '));
      }
    }
  }
}
