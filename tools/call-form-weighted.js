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
const EXE = flag('exe', null);
const LOG = flag('log', null);
const hex = v => '0x' + (v >>> 0).toString(16);
const pct = (n, d) => d ? (100 * n / d).toFixed(2) : '0.00';

// ---- PE files ----------------------------------------------------------------
const peFiles = new Map();          // lower-case module name -> path
for (const d of flags('pe-dir')) {
  for (const f of fs.readdirSync(d)) if (/\.(dll|exe|drv|ocx|ax|acm|ds|tlb)$/i.test(f)) {
    if (!peFiles.has(f.toLowerCase())) peFiles.set(f.toLowerCase(), path.join(d, f));
  }
}
for (const p of flags('pe')) {
  const i = p.indexOf('=');
  peFiles.set(p.slice(0, i).toLowerCase(), p.slice(i + 1));
}
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
      while (lo > 0 && b.readUInt32LE(lo)) { m.set(slot >>> 0, dll.toLowerCase()); slot += 4; lo += 4; }
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

  const byForm = new Map();
  const add = (k, n) => byForm.set(k, (byForm.get(k) || 0) + n);
  const sites = [];
  const noPe = new Map();
  const callRet = new Map();   // call-ending block -> its return address (runtime)
  for (const [addr, hits] of blocks) {
    const m = modOf(addr);
    const pe = m && peFor(m.name);
    if (!pe) { add('no-pe', hits); const k = m ? m.name : '?'; noPe.set(k, (noPe.get(k) || 0) + hits); continue; }
    const delta = (m.origBase - m.base) | 0;
    const t = terminator(pe, toVa(m, addr), va => entries.has((va - delta) >>> 0));
    let key = t.f;
    if (t.f.startsWith('call') && t.next !== undefined) callRet.set(addr, (t.next - delta) >>> 0);
    if (t.ind && !t.table) {
      // where did it go?
      const ret = t.next !== undefined ? (t.next - delta) >>> 0 : null;
      const s = succ.get(addr);
      let api = 0, guest = 0, targets = [];
      if (s) for (const [to, n] of s) {
        const tm = modOf(to);
        const isApi = (t.f.startsWith('call') && to === ret) || !tm;
        if (isApi) api += n; else guest += n;
        targets.push({ to, n, api: isApi, where: tm ? `${tm.name}+${hex(toVa(tm, to))}` : hex(to) });
      }
      // An IAT slot names its DLL outright: a DLL the guest loaded is guest
      // code, any other is a host API -- even when the edge shows guest code
      // next (DispatchMessage calling back into a wndproc).
      const dll = t.slot !== undefined ? iatMap(pe).get(t.slot) : undefined;
      let kind;
      if (dll) kind = loaded.has(dll) || loaded.has(dll.replace(/\.dll$/, '')) ? 'guest' : 'api';
      else if (api + guest > 0) kind = guest >= api ? 'guest' : 'api';
      else kind = haveEdges ? 'no-edge' : 'guest?';
      key = `${t.f} -> ${kind}`;
      targets.sort((a, b) => b.n - a.n);
      sites.push({ addr, hits, form: t.f, kind, where: `${m.name}+${hex(toVa(m, addr))}`,
        site: `${m.name}+${hex(t.at)}`, text: t.text, disp: t.disp, api, guest,
        distinct: targets.filter(x => !x.api).length, targets });
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
  let cutLoops = null;
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
    const hitsOf = new Map(blocks);
    const reach = (h, next) => {
      const seen = new Set([h]), st = [h];
      while (st.length) {
        const x = st.pop();
        for (const y of next(x)) if (!seen.has(y) && Math.abs(y - h) <= 4096) { seen.add(y); st.push(y); }
      }
      return seen;
    };
    cutLoops = [];
    for (const r of uv.rows) {
      if (r.v !== 'declined:call-indirect') continue;
      const fw = reach(r.eip, x => fwd.get(x) || []);
      const bw = reach(r.eip, x => pred.get(x) || []);
      let w = 0, n = 0;
      for (const x of fw) if (bw.has(x)) { w += hitsOf.get(x) || 0; n++; }
      const m = modOf(r.eip);
      cutLoops.push({ eip: r.eip, where: m ? `${m.name}+${hex(toVa(m, r.eip))}` : hex(r.eip), head: r.hits, body: w, blocks: n });
    }
    cutLoops.sort((a, b) => b.body - a.body);
  }
  return { file, hist, window: hist.window, threaded, listed, uopBlocks, total, byForm, sites, noPe,
    edgeDrops: hist.edgeDrops || 0, haveEdges, uopVerdicts: uv && uv.by, cutLoops };
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
    const H = w.cutLoops.reduce((a, c) => a + c.head, 0), B = w.cutLoops.reduce((a, c) => a + c.body, 0);
    say(`  ${wlabel(w)}: ${w.cutLoops.length} heads, head ${pct(H, w.total)}%  body ${pct(B, w.total)}%   top: ` +
      w.cutLoops.slice(0, 5).map(c => `${c.where} ${pct(c.body, w.total)}% (${c.blocks} blk)`).join(', '));
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
