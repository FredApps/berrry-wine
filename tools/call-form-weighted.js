#!/usr/bin/env node
'use strict';

// How much of an app's EXECUTION sits at each control-transfer form --
// call-form-census.js weighted by a runtime block histogram instead of
// counted over the file. Answers "is a better vtable inline cache worth
// building": what share of block entries end in a guest-target indirect call,
// how many distinct targets each such site actually hit, and what share the
// uop tier already runs.
//
//   node tools/call-form-weighted.js <hist.json> [<hist.json> ...]
//     --exe=PATH [--pe=NAME=PATH ...] [--pe-dir=DIR ...] [--exe-base=0x400000]
//     [--log=run.log] [--top=N] [--json]
//
// Input: test/run.js --handler-hist --handler-hist-thread=0[,0,0]
//   --hist-json=F --hist-json-blocks=0 --edge-hist   (several windows welcome;
//   the browser page-probe JSON works too, without edges or uop share).
//
// Each hot block's TERMINATOR is found statically: decode from the block
// entry until a control transfer, or until the next instruction is itself a
// listed block entry (the decoder cut there: `fallthrough`), or 64 insns
// (`long`). A threaded block ends at every jcc/jmp/call/ret, so that is the
// block's exit form and the block's entry count is how often that exit ran.
//
// Indirect exits are split by where they WENT, read from --edge-hist edges
// (from block -> next threaded block entry):
//   api    the next block is the call's own return address (the thunk ran as
//          a host API and returned) or lies outside every module
//   guest  the next block is guest code in a module
// A `call/jmp [abs]` through an IAT slot is decided by the slot's import DLL
// instead: guest when the run loaded that DLL (hist.mods), api otherwise, so a
// DispatchMessage that calls back into a wndproc is not counted as guest.
//
// Edge caveat: an edge is "the next threaded block entry", so when the callee
// is a live uop program the successor is wherever that program exited. That
// can only ADD targets; the polymorphism column is an upper bound.
//
// With --log (the same run's --uop-census log) the weighted uop verdicts come
// from tools/uop-census.js --hist, one window at a time.
//
// API census (docs/uop-tier-design.md §15.3): which host APIs are called from
// hot code, and how much of that sits in loops the uop tier declined.
//
//   node tools/call-form-weighted.js <hist.json>... --app=ID [--root=REPO]
//     --log=run.log --apis [--apis-json=OUT.json --label=NAME]
//     [--assume-tier='NAME:T;NAME:T']
//   node tools/call-form-weighted.js --merge A.apis.json B.apis.json ... [--min=0.05]
//
//   --app=ID     take the exe and every DLL directory from lib/apps.js (paths
//                under --root, default the repo) instead of --exe/--pe-dir.
//   --apis       per window: each API's share of all block entries at its call
//                sites, the share inside declined loops split by the innermost
//                loop's decline reason (`>400` = the loop plus its callees is
//                over UC_MAX_LOOP, so no call lowering would admit it), site
//                count and tier (1 inline uops, 2 hostcall, 2crt native CRT
//                override, exit). Then the ceilings: threaded entries of
//                declined loops whose every host call is tier<=k and that make
//                no guest indirect call (strict: declined for call-indirect;
//                loose: also scan-limit/head-unsupported/no-backedge).
//   --merge      the cross-app markdown tables from several --apis-json files.
//   --assume-tier  what-if tiering for a name, including an unnamed form such
//                as 'call [global]' (bounds a ceiling the hist cannot name).
//
// API names: a run with --edge-hist since this change records (calling block
// -> thunk) edges from $win32_dispatch and writes `thunks` {addr: name} into
// the hist JSON, which names GetProcAddress and COM targets. Older hists only
// name calls through an IAT slot; the rest print as `?call [global]` etc.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readPE } = require('../lib/pe');
const { disasmAt } = require('./disasm');
const { readHist, moduleList } = require('./hist-blocks');

const argv = process.argv.slice(2);
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const flags = n => argv.filter(x => x.startsWith(`--${n}=`)).map(x => x.slice(n.length + 3));
const files = argv.filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: call-form-weighted.js <hist.json>... --exe=PATH [--pe=NAME=PATH] [--pe-dir=DIR] [--log=run.log] [--top=N] [--json]');
  process.exit(2);
}
const TOP = parseInt(flag('top', '15'), 10);
let EXE = flag('exe', null);
const LOG = flag('log', null);
const APIS_JSON = flag('apis-json', null);
const APIS = argv.includes('--apis') || !!APIS_JSON;
const hex = v => '0x' + (v >>> 0).toString(16);
const pct = (n, d) => d ? (100 * n / d).toFixed(2) : '0.00';

// ---- PE files ----------------------------------------------------------------
const peFiles = new Map();          // lower-case module name -> path
// --app=ID: take the exe and every DLL directory from lib/apps.js, resolved
// against --root (the checkout holding the binaries; default this one), and
// the shared test/binaries/dlls last.
const APP = flag('app', null);
const appDirs = [];
let appExe = null;
if (APP) {
  const ROOT = flag('root', path.join(__dirname, '..'));
  const e = require('../lib/apps').APPS[APP];
  if (!e) { console.error(`unknown --app=${APP}`); process.exit(2); }
  const abs = p => path.isAbsolute(p) ? p : path.join(ROOT, p);
  const src = x => typeof x === 'string' ? x : x && (x.url || x.path);
  appExe = abs(src(e.exe));
  for (const d of [appExe, ...(e.dlls || []).map(src), ...(e.files || []).map(src)]) {
    if (d && /\.(dll|exe|drv|ocx)$/i.test(d)) { const dd = path.dirname(abs(d)); if (!appDirs.includes(dd)) appDirs.push(dd); }
  }
  appDirs.push(path.join(ROOT, 'test', 'binaries', 'dlls'));
}
for (const d of [...flags('pe-dir'), ...appDirs]) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (/\.(dll|exe|drv|ocx|ax|acm|ds|tlb)$/i.test(f)) {
    if (!peFiles.has(f.toLowerCase())) peFiles.set(f.toLowerCase(), path.join(d, f));
  }
}
for (const p of flags('pe')) {
  const i = p.indexOf('=');
  peFiles.set(p.slice(0, i).toLowerCase(), p.slice(i + 1));
}
if (!EXE && appExe) EXE = appExe;
let exePe = null;
if (EXE) { exePe = readPE(EXE); }
const EXE_BASE = flag('exe-base', null) ? parseInt(flag('exe-base'), 16) >>> 0 : exePe ? exePe.imageBase : 0x400000;
const peCache = new Map();
function peFor(name) {
  const key = name.toLowerCase();
  if (peCache.has(key)) return peCache.get(key);
  let pe = null;
  if ((key === 'exe' || (EXE && key === path.basename(EXE).toLowerCase())) && exePe) pe = exePe;
  else if (peFiles.has(key)) { try { pe = readPE(peFiles.get(key)); } catch (_) { pe = null; } }
  else if (key.endsWith('.exe') && exePe) pe = exePe;
  peCache.set(key, pe);
  return pe;
}

// Import DLL of every IAT slot, per PE, for the no-edge fallback.
function iatMap(pe) {
  if (pe._iat) return pe._iat;
  const m = new Map();
  pe._iatName = new Map();          // slot -> imported name (or #ordinal)
  try {
    const b = pe.buf, peOff = b.readUInt32LE(0x3c);
    const impRva = b.readUInt32LE(peOff + 0x80);
    let d = impRva ? pe.va2off(pe.imageBase + impRva) : -1;
    while (d > 0 && d + 20 <= b.length) {
      const oft = b.readUInt32LE(d), nameRva = b.readUInt32LE(d + 12), ft = b.readUInt32LE(d + 16);
      if (!nameRva && !ft) break;
      const no = pe.va2off(pe.imageBase + nameRva);
      let dll = '';
      for (let i = no; i > 0 && b[i]; i++) dll += String.fromCharCode(b[i]);
      let slot = pe.imageBase + ft;
      let lo = pe.va2off(pe.imageBase + (oft || ft));
      while (lo > 0 && b.readUInt32LE(lo)) {
        m.set(slot >>> 0, dll.toLowerCase());
        const ent = b.readUInt32LE(lo) >>> 0;
        let nm = '';
        if (ent & 0x80000000) nm = `${dll.toLowerCase()}#${ent & 0xFFFF}`;
        else {
          const ho = pe.va2off(pe.imageBase + ent);
          for (let i = ho + 2; ho > 0 && i < b.length && b[i]; i++) nm += String.fromCharCode(b[i]);
        }
        pe._iatName.set(slot >>> 0, nm);
        slot += 4; lo += 4;
      }
      d += 20;
    }
  } catch (_) { /* malformed: no fallback */ }
  pe._iat = m;
  return m;
}

// ---- terminator classification ----------------------------------------------
const REG = '(?:e[abcd]x|e[sd]i|ebp|esp)';
function form(text) {
  let m;
  if ((m = /^call (.*)$/.exec(text))) {
    const op = m[1].replace(/^dword (?:ptr )?/, '');
    if (/^0x[0-9a-f]+$/.test(op)) return { f: 'call rel32', target: parseInt(op, 16) >>> 0 };
    if (new RegExp(`^${REG}$`).test(op)) return { f: 'call r', ind: true };
    if (/^\[0x[0-9a-f]+\]$/.test(op)) return { f: 'call [abs]', ind: true, slot: parseInt(op.slice(1, -1), 16) >>> 0 };
    if (/\*/.test(op) || new RegExp(`${REG}\\s*\\+\\s*${REG}`).test(op)) return { f: 'call [sib]', ind: true };
    if (new RegExp(`^\\[${REG}\\]$`).test(op)) return { f: 'call [r]', ind: true, disp: 0 };
    const d = new RegExp(`^\\[${REG}\\s*([+-])\\s*(0x[0-9a-f]+|\\d+)\\]$`).exec(op);
    if (d) return { f: 'call [r+d]', ind: true, disp: d[1] === '-' ? -1 : parseInt(d[2]) };
    return { f: 'call other', ind: true };
  }
  if ((m = /^jmp (.*)$/.exec(text))) {
    const op = m[1].replace(/^dword (?:ptr )?/, '');
    if (/^(?:short )?0x[0-9a-f]+$/.test(op)) return { f: 'jmp rel' };
    if (/\*4/.test(op) && /\[/.test(op)) return { f: 'jmp [tbl+r*4]', ind: true, table: true };
    if (new RegExp(`^${REG}$`).test(op)) return { f: 'jmp r', ind: true };
    if (/^\[0x[0-9a-f]+\]$/.test(op)) return { f: 'jmp [abs]', ind: true, slot: parseInt(op.slice(1, -1), 16) >>> 0 };
    if (op.startsWith('[')) return { f: 'jmp [..]', ind: true };
    return { f: 'jmp other', ind: true };
  }
  if (/^j[a-z]+ /.test(text) || /^(?:loop[a-z]*|jecxz|jcxz) /.test(text)) return { f: 'jcc' };
  if (/^ret(?:n)?$/.test(text)) return { f: 'ret' };
  if (/^ret(?:n)? (0x[0-9a-f]+|\d+)$/.test(text)) return { f: 'ret imm' };
  if (/^(?:iret|int |int3|into|hlt|ud2|sysenter|syscall)/.test(text)) return { f: 'trap/other' };
  return null;
}

// Decode from `va` in `pe`; stop at a control transfer or a known block entry.
function terminator(pe, va, isEntry) {
  let off = pe.va2off(va);
  if (off < 0) return { f: 'no-bytes' };
  for (let n = 0; n < 64; n++) {
    let line;
    try { line = disasmAt(pe.buf, off, va, 1)[0]; } catch (_) { line = null; }
    const m = line && /^\s*[0-9a-f]+\s+((?:[0-9a-f]{2} )+)\s*(.*)$/.exec(line);
    if (!m) return { f: 'undecodable', at: va };
    const len = m[1].trim().split(/\s+/).length;
    const text = m[2].trim().toLowerCase();
    const c = form(text);
    if (c) return { ...c, at: va, next: (va + len) >>> 0, text, insns: n + 1 };
    va = (va + len) >>> 0; off += len;
    if (isEntry(va)) return { f: 'fallthrough', at: va, insns: n + 1 };
  }
  return { f: 'long', at: va, insns: 64 };
}

// ---- one window ----------------------------------------------------------------
function analyse(file) {
  const hist = readHist(file);
  const mods = moduleList(hist, EXE_BASE).map(m => ({ ...m, size: 0 }));
  // Module extents, from each PE's SizeOfImage when we have the file.
  for (const m of mods) {
    const pe = peFor(m.name);
    if (pe) m.size = pe.buf.readUInt32LE(pe.buf.readUInt32LE(0x3c) + 0x50);
  }
  const modOf = addr => {
    let hit = null;
    for (const m of mods) if (addr >= m.base && (!m.size || addr < m.base + m.size)) hit = m;
    return hit;
  };
  const toVa = (m, addr) => (addr - m.base + m.origBase) >>> 0;
  const loaded = new Set(Object.keys(hist.mods || {}).map(k => k.toLowerCase()));
  const blocks = (hist.blocks || []).map(([hx, n]) => [parseInt(hx, 16) >>> 0, n]);
  const entries = new Set(blocks.map(b => b[0]));
  const threaded = hist.blockHits || blocks.reduce((a, b) => a + b[1], 0);
  const listed = blocks.reduce((a, b) => a + b[1], 0);
  const uopBlocks = hist.uop ? hist.uop.blocks >>> 0 : 0;
  const total = threaded + uopBlocks;

  // edges: from -> Map(to -> count)
  const succ = new Map();
  for (const [f, t, n] of hist.edges || []) {
    const a = parseInt(f, 16) >>> 0, b = parseInt(t, 16) >>> 0;
    if (!succ.has(a)) succ.set(a, new Map());
    succ.get(a).set(b, (succ.get(a).get(b) || 0) + n);
  }
  const haveEdges = !!(hist.edges && hist.edges.length);
  const thunkAt = new Map(Object.entries(hist.thunks || {}).map(([k, v]) => [parseInt(k, 16) >>> 0, v]));

  const byForm = new Map();
  const add = (k, n) => byForm.set(k, (byForm.get(k) || 0) + n);
  const sites = [];
  const noPe = new Map();
  const callRet = new Map();   // call-ending block -> its return address (runtime)
  const termOf = new Map();    // block -> its decoded terminator
  for (const [addr, hits] of blocks) {
    const m = modOf(addr);
    const pe = m && peFor(m.name);
    if (!pe) { add('no-pe', hits); const k = m ? m.name : 'anon (no module: runtime-generated code)'; noPe.set(k, (noPe.get(k) || 0) + hits); continue; }
    const delta = (m.origBase - m.base) | 0;
    const t = terminator(pe, toVa(m, addr), va => entries.has((va - delta) >>> 0));
    termOf.set(addr, t);
    let key = t.f;
    if (t.f.startsWith('call') && t.next !== undefined) callRet.set(addr, (t.next - delta) >>> 0);
    if (t.ind && !t.table) {
      // where did it go?
      const ret = t.next !== undefined ? (t.next - delta) >>> 0 : null;
      const s = succ.get(addr);
      let api = 0, guest = 0, targets = [];
      if (s) for (const [to, n] of s) {
        // A thunk edge ($win32_dispatch, newer runs) is a host API by
        // definition, whatever module extent it happens to fall inside.
        if (thunkAt.has(to)) {
          api += n;
          targets.push({ to, n, api: true, where: `api:${thunkAt.get(to)}` });
          continue;
        }
        const tm = modOf(to);
        // Outside every module is a host API only when nothing ran there: an
        // address that is itself an executed block is guest code the guest
        // generated at runtime (VB6's per-object heap thunks behind
        // msvbvm60's `jmp [eax+edx]` delegator), labelled `anon:`.
        const isApi = (t.f.startsWith('call') && to === ret) || (!tm && !entries.has(to));
        if (isApi) api += n; else guest += n;
        targets.push({ to, n, api: isApi, where: tm ? `${tm.name}+${hex(toVa(tm, to))}` : (isApi ? hex(to) : `anon:${hex(to)}`) });
      }
      // An IAT slot names its DLL outright: a DLL the guest loaded is guest
      // code, any other is a host API -- even when the edge shows guest code
      // next (DispatchMessage calling back into a wndproc).
      const dll = t.slot !== undefined ? iatMap(pe).get(t.slot) : undefined;
      // `jmp/call [abs]` is two different things: an IAT slot (import stub,
      // fixed per process) or a code pointer in a writable global (Unreal's
      // `engine+0x1037a430 jmp [0x1037f4ec]`, 47 targets) where polymorphism
      // is the point. Keep them apart.
      if (t.slot !== undefined && !dll) t.f = t.f.replace('[abs]', '[global]');
      let kind;
      // A loaded DLL can still have exports the emulator overrides natively
      // (msvcrt `_ftol`, `_stricmp` in Morrowind): with edges, the slot is
      // guest only if control actually entered that DLL.
      const dllName = dll && dll.replace(/\.dll$/, '');
      const inDll = targets.some(x => { if (thunkAt.has(x.to)) return false; const tm = modOf(x.to); return tm && tm.name.toLowerCase().replace(/\.dll$/, '') === dllName; });
      if (dll && (loaded.has(dll) || loaded.has(dllName))) kind = s && s.size && !inDll ? 'api' : 'guest';
      else if (dll) kind = 'api';
      else if (api + guest > 0) kind = guest >= api ? 'guest' : 'api';
      else kind = haveEdges ? 'no-edge' : 'guest?';
      key = `${t.f} -> ${kind}`;
      targets.sort((a, b) => b.n - a.n);
      sites.push({ addr, hits, form: t.f, kind, where: `${m.name}+${hex(toVa(m, addr))}`,
        site: `${m.name}+${hex(t.at)}`, text: t.text, disp: t.disp, api, guest,
        distinct: targets.filter(x => !x.api).length, targets,
        importName: dll ? pe._iatName.get(t.slot) : undefined });
    } else if (t.table) {
      const s = succ.get(addr);
      const targets = s ? [...s].map(([to, n]) => ({ to, n })) : [];
      sites.push({ addr, hits, form: t.f, kind: 'table', where: `${m.name}+${hex(toVa(m, addr))}`,
        site: `${m.name}+${hex(t.at)}`, text: t.text, distinct: targets.length,
        targets: targets.sort((a, b) => b.n - a.n).map(x => {
          const tm = modOf(x.to);
          return { ...x, where: tm ? `${tm.name}+${hex(toVa(tm, x.to))}` : hex(x.to) };
        }) });
    }
    add(key, hits);
  }
  sites.sort((a, b) => b.hits - a.hits);
  const uv = LOG ? uopVerdicts(file) : null;
  // A head declined for `call-indirect` loses its whole loop, not just the
  // head block: the loop body is the head's strongly connected component in
  // the edge graph, kept to +-4KB of the head so a callee's blocks (which a
  // call-out would still run threaded) are not counted as the loop.
  let cutLoops = null, declinedLoops = null;
  const hitsOf = new Map(blocks);
  if (uv && haveEdges) {
    // A call's callee usually lies outside the window, which would cut the
    // loop at every call; the call -> return-address pseudo-edge rejoins it.
    const fwd = new Map();
    for (const [a, m] of succ) fwd.set(a, new Set(m.keys()));
    for (const [a, r] of callRet) { if (!fwd.has(a)) fwd.set(a, new Set()); fwd.get(a).add(r); }
    const pred = new Map();
    for (const [a, m] of fwd) for (const b of m) {
      if (!pred.has(b)) pred.set(b, new Set());
      pred.get(b).add(a);
    }
    const reach = (h, next) => {
      const seen = new Set([h]), st = [h];
      while (st.length) {
        const x = st.pop();
        for (const y of next(x)) if (!seen.has(y) && Math.abs(y - h) <= 4096) { seen.add(y); st.push(y); }
      }
      return seen;
    };
    const sccOf = h => {
      const fw = reach(h, x => fwd.get(x) || []);
      const bw = reach(h, x => pred.get(x) || []);
      // A one-block SCC with no self edge is not a loop (Blobby's VCL
      // `TCanvas.GetHandle` entry is a declined head and nothing else).
      const scc = [...fw].filter(x => bw.has(x));
      if (scc.length === 1 && !(fwd.get(h) || new Set()).has(h)) scc.length = 0;
      return scc;
    };
    // Every declined head's loop, for --apis: which loop (and decline
    // reason) an API call site sits in.
    // The tier's scan follows `call rel32` into callees, so a loop that calls
    // a helper which calls an API (every CRT function through `_getptd`:
    // GetLastError/TlsGetValue/SetLastError) is declined for the helper's
    // call. The +-4KB SCC cannot see that, so each call in the loop adds its
    // callee's extent: blocks reachable from the call's targets through
    // forward edges, not leaving through a `ret`, at most 4096 blocks.
    const extentMemo = new Map();
    const extentOf = callBlock => {
      if (extentMemo.has(callBlock)) return extentMemo.get(callBlock);
      const out = new Set();
      extentMemo.set(callBlock, out);
      const ret = callRet.get(callBlock);
      const st = [];
      for (const to of (succ.get(callBlock) || new Map()).keys()) if (to !== ret && !thunkAt.has(to) && hitsOf.has(to)) st.push(to);
      while (st.length && out.size < 4096) {
        const x = st.pop();
        if (out.has(x)) continue;
        out.add(x);
        const t = termOf.get(x);
        if (t && (t.f === 'ret' || t.f === 'ret imm')) continue;
        for (const y of fwd.get(x) || []) if (!out.has(y) && hitsOf.has(y)) st.push(y);
      }
      return out;
    };
    declinedLoops = [];
    for (const r of uv.rows) {
      if (!r.v.startsWith('declined:')) continue;
      const scc = sccOf(r.eip);
      if (!scc.length) continue;
      const all = new Set(scc);
      for (const b of scc) if (callRet.has(b)) for (const x of extentOf(b)) all.add(x);
      // Static size: a loop past the compiler's UC_MAX_LOOP (400 kept
      // instructions, 07e) could never become a program whatever it calls.
      const insns = [...all].reduce((a, x) => a + ((termOf.get(x) || {}).insns || 8), 0);
      declinedLoops.push({ eip: r.eip, why: r.v.slice(9) + (insns > 400 ? '>400' : ''), insns, blocks: all,
        body: [...all].reduce((a, x) => a + (hitsOf.get(x) || 0), 0) });
    }
    cutLoops = [];
    // Nested/adjacent heads share body blocks; the total is over the union,
    // so it can never pass 100% (per-head `body` still counts its own SCC).
    const union = new Set();
    cutLoops.union = 0;
    for (const r of uv.rows) {
      if (r.v !== 'declined:call-indirect') continue;
      let w = 0, n = 0;
      const scc = sccOf(r.eip);
      for (const x of scc) {
        w += hitsOf.get(x) || 0; n++;
        if (!union.has(x)) { union.add(x); cutLoops.union += hitsOf.get(x) || 0; }
      }
      const m = modOf(r.eip);
      cutLoops.push({ eip: r.eip, where: m ? `${m.name}+${hex(toVa(m, r.eip))}` : hex(r.eip), head: r.hits, body: w, blocks: n });
    }
    cutLoops.sort((a, b) => b.body - a.body);
  }
  const apis = APIS ? apiCensus({ blocks, succ, sites, termOf, modOf, toVa, declinedLoops, hitsOf,
    thunks: hist.thunks }) : null;
  return { file, hist, window: hist.window, threaded, listed, uopBlocks, total, byForm, sites, noPe,
    edgeDrops: hist.edgeDrops || 0, haveEdges, uopVerdicts: uv && uv.by, cutLoops, apis };
}

// Weighted uop verdicts for this window, from uop-census.js.
function uopVerdicts(histFile) {
  const a = ['--hist=' + histFile, '--exe-base=' + hex(EXE_BASE), '--json'];
  const out = execFileSync(process.execPath, [path.join(__dirname, 'uop-census.js'), LOG, ...a],
    { maxBuffer: 1 << 28, encoding: 'utf8' });
  const j = JSON.parse(out);
  const by = {};
  for (const r of j.rows) by[r.v] = (by[r.v] || 0) + r.hits;
  return { by, rows: j.rows };
}

// ---- --apis: which API each host call site called ------------------------------
// The uop-tier "call an API without exiting" proposal, as a table. Tier 1:
// inline as micro-ops (a load/store of per-thread or process state). Tier 2:
// call the WAT handler from inside the program (it must neither run guest code
// nor yield; the clock reads carry the spin-detector caveat, 09a-handlers).
// Everything else must exit the program.
const TIER1 = new Set(['GetLastError', 'SetLastError', 'TlsGetValue', 'TlsSetValue', 'GetCurrentThreadId',
  'GetCurrentProcessId', 'GetCurrentThread', 'GetCurrentProcess', 'GetProcessHeap', 'InterlockedIncrement',
  'InterlockedDecrement', 'InterlockedExchange', 'InterlockedCompareExchange', 'InterlockedExchangeAdd',
  'EnterCriticalSection', 'LeaveCriticalSection']);
const TIER2 = new Set(['HeapAlloc', 'HeapFree', 'HeapReAlloc', 'HeapSize', 'GetTickCount', 'timeGetTime',
  'QueryPerformanceCounter', 'QueryPerformanceFrequency']);
// Native CRT overrides that run guest code (a comparator, an atexit list, a
// handler) or unwind: never a hostcall.
const CRT_EXIT = new Set(['qsort', 'bsearch', '_lfind', '_lsearch', '_initterm', 'atexit', '_onexit', '__dllonexit',
  'signal', 'raise', 'exit', '_exit', '_cexit', 'abort', 'longjmp', '_setjmp', '_setjmp3', '_CxxThrowException',
  '__CxxFrameHandler', '_except_handler3', '_global_unwind2', '_local_unwind2', '_beginthread', '_beginthreadex',
  '_endthread', '_endthreadex', '_purecall', '_amsg_exit', '_XcptFilter']);
let apiTableByName = null;
// --assume-tier='NAME:T;NAME:T' answers "what if": e.g. 'call [global]:2'
// treats every unnamed call-through-a-global (Half-Life's qgl* slots, which a
// hist without thunk edges cannot name) as a hostcall, bounding that ceiling.
const ASSUME_TIER = new Map((flag('assume-tier', '') || '').split(';').filter(Boolean)
  .map(s => { const i = s.lastIndexOf(':'); return [s.slice(0, i).replace(/^\?/, ''), s.slice(i + 1)]; }));
function tierOf(name) {
  if (ASSUME_TIER.has(name)) return ASSUME_TIER.get(name);
  if (TIER1.has(name)) return '1';
  if (TIER2.has(name) || /^gl[A-Z]/.test(name)) return '2';
  if (!apiTableByName) {
    apiTableByName = new Map();
    try {
      for (const e of JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'api_table.json'), 'utf8'))) apiTableByName.set(e.name, e);
    } catch (_) { /* no table: no CRT class */ }
  }
  const e = apiTableByName.get(name);
  if (e && e.convention === 'cdecl' && /^[_a-z?]/.test(name) && !CRT_EXIT.has(name)) return '2crt';
  return 'exit';
}
const tierRank = t => t === '1' ? 1 : t.startsWith('2') ? 2 : 3;
// A declined loop an API call could have been the reason for. Strict: the
// scan met an unlowered FF /2 (call-indirect). Loose adds the verdicts an
// import stub (`call rel32` -> `jmp [IAT]`) or a call the scan stopped on
// leave: head-unsupported, scan-limit, no-backedge.
const LOOSE = new Set(['call-indirect', 'head-unsupported', 'scan-limit', 'no-backedge']);

function apiCensus({ blocks, succ, sites, termOf, modOf, toVa, declinedLoops, hitsOf, thunks }) {
  const where = a => { const m = modOf(a); return m ? `${m.name}+${hex(toVa(m, a))}` : hex(a); };
  // Call records {from, name, n}: from --edge-hist thunk edges when the run
  // recorded them (every form, GetProcAddress pointers and COM included),
  // else from the IAT import name of each api-kind site (others unnamed).
  const calls = [];
  if (thunks) {
    const tn = new Map();
    for (const [k, v] of Object.entries(thunks)) if (!v.startsWith('cont:')) tn.set(parseInt(k, 16) >>> 0, v);
    for (const [from, m] of succ) for (const [to, n] of m) { const nm = tn.get(to); if (nm) calls.push({ from, name: nm, n }); }
  } else {
    for (const s of sites) if (s.kind === 'api') calls.push({ from: s.addr, name: s.importName || `?${s.form}`, n: s.hits });
  }
  const predW = new Map();
  for (const [a, m] of succ) for (const [b, n] of m) {
    if (!predW.has(b)) predW.set(b, new Map());
    predW.get(b).set(a, n);
  }
  // Where a call happens, for loop membership: an import stub (`jmp [IAT]`
  // reached by `call rel32`) is charged to its callers, by edge weight.
  const locs = c => {
    const t = termOf.get(c.from);
    const p = predW.get(c.from);
    if (t && t.f.startsWith('jmp') && p && p.size) {
      const tot = [...p.values()].reduce((a, x) => a + x, 0);
      return [...p].map(([b, n]) => [b, c.n * n / tot]);
    }
    return [[c.from, c.n]];
  };
  // Innermost declined loop per block.
  const inner = new Map();
  for (const L of declinedLoops || []) for (const b of L.blocks) {
    const cur = inner.get(b);
    if (!cur || cur.blocks.size > L.blocks.size) inner.set(b, L);
  }
  const rows = new Map();
  for (const c of calls) {
    if (!rows.has(c.name)) rows.set(c.name, { name: c.name, tier: tierOf(c.name.replace(/^\?/, '')), n: 0, sites: new Set(), why: {}, top: new Map() });
    const r = rows.get(c.name);
    r.n += c.n; r.sites.add(c.from);
    r.top.set(c.from, (r.top.get(c.from) || 0) + c.n);
    for (const [b, n] of locs(c)) {
      const L = inner.get(b);
      if (L) r.why[L.why] = (r.why[L.why] || 0) + n;
    }
  }
  // Ceilings: the threaded entries of declined loops whose only host calls
  // are tier <= k and which make no guest indirect call -- the most a tier-k
  // hostcall could bring into programs (upper bound: the loop may still
  // decline for something else once the call lowers).
  const guestIcall = new Set(sites.filter(s => (s.kind === 'guest' || s.kind === 'guest?') && s.form.startsWith('call')).map(s => s.addr));
  const callsAt = new Map();          // location block -> [tier rank]
  for (const c of calls) for (const [b] of locs(c)) {
    if (!callsAt.has(b)) callsAt.set(b, []);
    callsAt.get(b).push(tierRank(tierOf(c.name.replace(/^\?/, ''))));
  }
  const ceil = {};
  for (const k of [1, 2]) for (const mode of ['strict', 'loose']) {
    const u = new Set();
    const heads = [];
    for (const L of declinedLoops || []) {
      if (mode === 'strict' ? L.why !== 'call-indirect' : !LOOSE.has(L.why)) continue;
      let any = false, max = 0, gi = false;
      for (const b of L.blocks) {
        const ts = callsAt.get(b);
        if (ts) { any = true; for (const t of ts) max = Math.max(max, t); }
        if (guestIcall.has(b)) gi = true;
      }
      if (!any || gi || max > k) continue;
      heads.push(L);
      for (const b of L.blocks) u.add(b);
    }
    let w = 0;
    for (const b of u) w += hitsOf.get(b) || 0;
    ceil[`t${k}${mode}`] = { entries: w, heads: heads.sort((a, b) => b.body - a.body).slice(0, 5).map(L => ({ at: where(L.eip), why: L.why, body: L.body, insns: L.insns })) };
  }
  const out = [...rows.values()].sort((a, b) => b.n - a.n).map(r => ({
    name: r.name, tier: r.tier, n: r.n, sites: r.sites.size, why: r.why,
    top: [...r.top].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, n]) => [where(a), n]),
  }));
  return { named: !!thunks, rows: out, calls: calls.reduce((a, c) => a + c.n, 0), ceil };
}

// ---- --merge: the cross-app table from several --apis-json files ---------------
if (argv.includes('--merge')) {
  const apps = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const by = new Map();
  for (const app of apps) for (const w of app.windows) for (const r of w.rows) {
    if (!by.has(r.name)) by.set(r.name, { name: r.name, tier: r.tier, max: 0, maxAt: '', inLoopMax: 0, apps: new Map() });
    const e = by.get(r.name);
    const s = 100 * r.n / w.total;
    // declined loops small enough to compile (<= 400 insns with callees)
    const il = 100 * Object.entries(r.why).filter(([k]) => !k.endsWith('>400')).reduce((a, [, x]) => a + x, 0) / w.total;
    if (s > e.max) { e.max = s; e.maxAt = `${app.label} ${w.window}`; }
    e.inLoopMax = Math.max(e.inLoopMax, il);
    e.apps.set(app.label, Math.max(e.apps.get(app.label) || 0, s));
  }
  const rows = [...by.values()].sort((a, b) => b.max - a.max);
  const MIN = parseFloat(flag('min', '0.05'));
  console.log('| API | tier | max share of all block entries | window | max share inside declined loops of <=400 insns | apps at >=0.1% (max share) |');
  console.log('|---|---|---|---|---|---|');
  for (const e of rows.filter(e => e.max >= MIN).slice(0, TOP)) {
    const ap = [...e.apps].filter(([, s]) => s >= 0.1).sort((a, b) => b[1] - a[1]).map(([a, s]) => `${a} ${s.toFixed(2)}`).join(', ');
    console.log(`| ${e.name} | ${e.tier} | ${e.max.toFixed(2)}% | ${e.maxAt} | ${e.inLoopMax.toFixed(2)}% | ${ap} |`);
  }
  console.log('\n| app | windows | API calls, % of entries | tier-1 calls | tier-2 calls (incl. CRT) | tier-1 ceiling strict / loose | tier-1+2 ceiling strict / loose |');
  console.log('|---|---|---|---|---|---|---|');
  const rng = xs => { const a = Math.min(...xs), b = Math.max(...xs); return a.toFixed(2) === b.toFixed(2) ? `${a.toFixed(2)}%` : `${a.toFixed(2)}-${b.toFixed(2)}%`; };
  for (const app of apps) {
    const W = app.windows;
    const t = (w, f) => 100 * w.rows.filter(r => f(tierRank(r.tier))).reduce((a, r) => a + r.n, 0) / w.total;
    console.log(`| ${app.label} | ${W.map(w => w.window).join(', ')} | ${rng(W.map(w => 100 * w.calls / w.total))} | ` +
      `${rng(W.map(w => t(w, k => k === 1)))} | ${rng(W.map(w => t(w, k => k === 2)))} | ` +
      `${rng(W.map(w => 100 * w.ceil.t1strict.entries / w.total))} / ${rng(W.map(w => 100 * w.ceil.t1loose.entries / w.total))} | ` +
      `${rng(W.map(w => 100 * w.ceil.t2strict.entries / w.total))} / ${rng(W.map(w => 100 * w.ceil.t2loose.entries / w.total))} |`);
  }
  process.exit(0);
}

// ---- report --------------------------------------------------------------------
const wins = files.map(analyse);
if (argv.includes('--json')) {
  console.log(JSON.stringify(wins.map(w => ({ file: w.file, window: w.window, threaded: w.threaded, listed: w.listed,
    uopBlocks: w.uopBlocks, total: w.total, forms: Object.fromEntries(w.byForm), edgeDrops: w.edgeDrops,
    uopVerdicts: w.uopVerdicts, sites: w.sites.slice(0, 200).map(s => ({ ...s, targets: s.targets.slice(0, 8) })) }))));
  process.exit(0);
}
const say = s => console.log(s);
const wlabel = w => w.window ? `${w.window.start}..${w.window.stop}` : path.basename(w.file);
say(`windows: ${wins.map(w => `${wlabel(w)} (${w.threaded} threaded + ${w.uopBlocks} uop block entries, ` +
  `listed ${pct(w.listed, w.threaded)}% of threaded${w.haveEdges ? `, edge drops ${w.edgeDrops}` : ', no edges'})`).join('\n         ')}`);

say('\nuop tier share of all block entries (uop blocks / (threaded + uop)):');
say('  ' + wins.map(w => `${wlabel(w)}: ${pct(w.uopBlocks, w.total)}%`).join('   '));

const ORDER = ['fallthrough', 'jcc', 'jmp rel', 'call rel32', 'ret', 'ret imm'];
const keys = new Set();
for (const w of wins) for (const k of w.byForm.keys()) keys.add(k);
const sorted = [...ORDER.filter(k => keys.has(k)), ...[...keys].filter(k => !ORDER.includes(k)).sort()];
say('\nterminator form, % of ALL block entries (threaded + uop) per window:');
say('  ' + 'form'.padEnd(28) + wins.map(w => wlabel(w).padStart(14)).join('') + '      min     max');
for (const k of sorted) {
  const v = wins.map(w => 100 * (w.byForm.get(k) || 0) / w.total);
  say('  ' + k.padEnd(28) + v.map(x => x.toFixed(2).padStart(14)).join('') +
    Math.min(...v).toFixed(2).padStart(9) + Math.max(...v).toFixed(2).padStart(8));
}
{
  const v = wins.map(w => 100 * (w.threaded - w.listed) / w.total);
  say('  ' + '(unlisted threaded)'.padEnd(28) + v.map(x => x.toFixed(2).padStart(14)).join(''));
  const u = wins.map(w => 100 * w.uopBlocks / w.total);
  say('  ' + '(inside uop programs)'.padEnd(28) + u.map(x => x.toFixed(2).padStart(14)).join(''));
}
// Summary: guest-target indirect calls/jumps (what a vtable IC would serve).
say('\nguest-target indirect transfers, % of all block entries:');
for (const w of wins) {
  const g = w.sites.filter(s => s.kind === 'guest' || s.kind === 'guest?');
  const calls = g.filter(s => s.form.startsWith('call'));
  const vt = calls.filter(s => s.form === 'call [r+d]' || s.form === 'call [r]' || s.form === 'call r');
  const mono = g.filter(s => s.distinct <= 1).reduce((a, s) => a + s.hits, 0);
  const le4 = g.filter(s => s.distinct <= 4).reduce((a, s) => a + s.hits, 0);
  const sumh = xs => xs.reduce((a, s) => a + s.hits, 0);
  say(`  ${wlabel(w)}: all ${pct(sumh(g), w.total)}%  calls ${pct(sumh(calls), w.total)}%  ` +
    `vtable/reg calls ${pct(sumh(vt), w.total)}%  sites ${g.length}  ` +
    `monomorphic ${pct(mono, w.total)}%  <=4 targets ${pct(le4, w.total)}%`);
}
if (wins.some(w => w.uopVerdicts)) {
  say('\nthreaded entries by the uop verdict on that block as a head, % of all block entries:');
  const vk = new Set();
  for (const w of wins) if (w.uopVerdicts) for (const k of Object.keys(w.uopVerdicts)) vk.add(k);
  const vs = [...vk].sort((a, b) => wins.reduce((s, w) => s + ((w.uopVerdicts || {})[b] || 0) / w.total, 0) -
    wins.reduce((s, w) => s + ((w.uopVerdicts || {})[a] || 0) / w.total, 0));
  for (const k of vs) {
    say('  ' + k.padEnd(34) + wins.map(w => pct((w.uopVerdicts || {})[k] || 0, w.total).padStart(10)).join(''));
  }
}
if (wins.some(w => w.cutLoops)) {
  say('\nloops the tier declined for call-indirect: head entries / whole loop body (SCC within +-4KB), % of all block entries:');
  for (const w of wins) {
    if (!w.cutLoops) continue;
    const H = w.cutLoops.reduce((a, c) => a + c.head, 0), B = w.cutLoops.union;
    say(`  ${wlabel(w)}: ${w.cutLoops.length} heads, head ${pct(H, w.total)}%  body ${pct(B, w.total)}%   top: ` +
      w.cutLoops.slice(0, 5).map(c => `${c.where} ${pct(c.body, w.total)}% (${c.blocks} blk)`).join(', '));
  }
}
if (APIS) {
  const whyStr = (why, total) => Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${k} ${pct(n, total)}`).join(', ');
  for (const w of wins) {
    const A = w.apis;
    say(`\n${wlabel(w)}: host API calls ${pct(A.calls, w.total)}% of all block entries` +
      ` (${A.named ? 'named from --edge-hist thunk edges' : 'named from IAT slots only; ?form = unnamed'}):`);
    say('  ' + 'share'.padStart(7) + '  ' + 'API'.padEnd(34) + 'tier'.padEnd(6) + 'sites'.padStart(6) +
      '  in declined loops (innermost head reason)             top site');
    for (const r of A.rows.slice(0, TOP)) {
      say('  ' + (pct(r.n, w.total) + '%').padStart(7) + '  ' + r.name.slice(0, 33).padEnd(34) + r.tier.padEnd(6) +
        String(r.sites).padStart(6) + '  ' + whyStr(r.why, w.total).padEnd(52) + ' ' + (r.top[0] ? r.top[0][0] : ''));
    }
    const byTier = {};
    for (const r of A.rows) byTier[r.tier] = (byTier[r.tier] || 0) + r.n;
    say('  by tier: ' + Object.entries(byTier).map(([t, n]) => `${t} ${pct(n, w.total)}%`).join('  '));
    const c = A.ceil;
    say(`  ceilings (threaded entries of declined loops whose host calls are all tier<=k, no guest icall):`);
    for (const k of ['t1strict', 't1loose', 't2strict', 't2loose']) {
      say(`    ${k.padEnd(9)} ${pct(c[k].entries, w.total)}%  ` +
        c[k].heads.map(h => `${h.at} ${h.why} ${pct(h.body, w.total)}%`).join(', '));
    }
  }
  if (APIS_JSON) {
    fs.writeFileSync(APIS_JSON, JSON.stringify({ label: flag('label', path.basename(files[0])),
      windows: wins.map(w => ({ window: wlabel(w), total: w.total, uop: w.uopBlocks, ...w.apis })) }, null, 1));
    say(`wrote ${APIS_JSON}`);
  }
}
for (const w of wins) {
  if (w.noPe.size) say(`\n${wlabel(w)}: blocks with no PE to decode: ` +
    [...w.noPe].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n, w.total)}%`).join('  '));
  say(`\n${wlabel(w)}: top indirect sites (share of all entries, distinct guest targets, top targets):`);
  for (const s of w.sites.slice(0, TOP)) {
    const tg = s.targets.slice(0, 4).map(t => `${t.where}${t.api ? '(api)' : ''} ${pct(t.n, s.hits)}%`).join(', ');
    say(`  ${pct(s.hits, w.total).padStart(6)}%  ${s.site.padEnd(28)} ${s.kind.padEnd(6)} ` +
      `${String(s.distinct).padStart(3)} tg  ${String(s.text || s.form).padEnd(30)} ${tg}`);
  }
}
