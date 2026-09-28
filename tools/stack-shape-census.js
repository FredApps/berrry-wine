#!/usr/bin/env node
'use strict';

// Where do push/pop/call/ret run, what shapes are they in, and how many
// push->pop pairs could a store-eliding tier drop under each alias rule?
//
// Input is one handler-hist window: test/run.js --handler-hist-thread=0
// --hot-block-dump=F.blocks --hist-json=F.json. The dump is every block the
// threaded tier entered in the window with its entry count; a block run by the
// uop tier is not re-entered through the threaded dispatcher, so this is the
// THREADED REMAINDER (plus the one entry per uop-program visit).
//
// Each block is disassembled statically from the PE on disk up to its
// terminator (jcc/jmp/call/ret -- where the threaded decoder ends a block),
// and every instruction is weighted by the block's entry count.
//
//   blocks x PE bytes -> per-shape dynamic counts
//                     -> per push: paired-in-block / arg-before-call / live-out
//                     -> per in-block pair: rescued by which alias rule
//
// The alias rules, cumulative (each includes the ones above it):
//   C0 conservative  any memory access between push and pop blocks
//   R1 known offset  ESP/EBP accesses at a static offset are resolved: disjoint
//                    -> fine, exact same-width hit -> forwarded, partial -> the
//                    store is materialized there (pair not elided)
//   R2 guard         unknown-address accesses get a runtime range guard (count
//                    as rescued statically; a runtime hit materializes)
//   An LEA of a stack address that could escape blocks in every rule.
//
// usage: node tools/stack-shape-census.js <F.json> --blocks=F.blocks
//          --dir=INSTALL_DIR [--pe=name=path ...] [--top=N] [--pairs=N] [--json]

const fs = require('fs');
const path = require('path');
const { makeAttributor } = require('./hist-blocks');
const { readPE } = require('../lib/pe');
const { disasmAt } = require('./disasm');

const argv = process.argv.slice(2);
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const flags = (n) => argv.filter(x => x.startsWith(`--${n}=`)).map(x => x.slice(n.length + 3));
const histFile = argv.find(a => !a.startsWith('--'));
if (!histFile) { console.error('usage: stack-shape-census.js <hist.json> --blocks=F --dir=DIR [--pe=name=path]'); process.exit(2); }
const hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
const blocksFile = flag('blocks', histFile.replace(/\.json$/, '.blocks'));
const dir = flag('dir', null);
const TOP = +flag('top', 25);
const PAIRS = +flag('pairs', 15);

// --- module -> PE --------------------------------------------------------
const exeBase = 0x400000;
const attribute = makeAttributor(hist, exeBase);
const peOverride = {};
for (const s of flags('pe')) { const i = s.indexOf('='); peOverride[s.slice(0, i).toLowerCase()] = s.slice(i + 1); }
const dirFiles = dir ? fs.readdirSync(dir) : [];
const stem = n => n.toLowerCase().replace(/\.[^.]*$/, '');
const exeName = Object.keys(hist.mods || {}).find(n => /\.exe$/i.test(n));
const peCache = new Map();
function peFor(mod) {
  if (peCache.has(mod)) return peCache.get(mod);
  let file = peOverride[mod.toLowerCase()] || peOverride[stem(mod)];
  const want = mod === 'exe' ? stem(exeName || '') : stem(mod);
  if (!file && dir) { const f = dirFiles.find(x => stem(x) === want); if (f) file = path.join(dir, f); }
  let pe = null;
  if (file && fs.existsSync(file)) { try { pe = readPE(file); } catch (_) { pe = null; } }
  peCache.set(mod, pe);
  return pe;
}

// --- instruction model ---------------------------------------------------
const R32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const R16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const R8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const num = s => { s = s.trim(); const neg = s.startsWith('-'); if (neg || s.startsWith('+')) s = s.slice(1); const v = parseInt(s, s.startsWith('0x') ? 16 : 10); return neg ? -v : v; };

// Parse "[base+idx*s+disp]" -> {base, idx, disp}
function parseMem(m) {
  const body = m.slice(1, -1).replace(/\s+/g, '');
  const parts = body.match(/[+-]?[^+-]+/g) || [];
  let base = null, idx = null, disp = 0;
  for (const p of parts) {
    const t = p.replace(/^[+-]/, '');
    if (R32.includes(t)) { if (base === null) base = t; else idx = t; }
    else if (/\*/.test(t)) idx = t.split('*')[0];
    else disp += num(p);
  }
  return { base, idx, disp: disp | 0 };
}

function widthOf(ins) {
  if (/\bbyte\b/.test(ins)) return 1;
  if (/\bqword\b|\bmm\d|\bxmm/.test(ins)) return 8;
  if (/\bword\b/.test(ins) && !/\bdword\b/.test(ins)) return 2;
  const ops = ins.replace(/^\S+\s*/, '').split(',').map(s => s.trim());
  for (const o of ops) { if (R8.includes(o)) return 1; if (R16.includes(o)) return 2; }
  if (/^(movzx|movsx)/.test(ins)) return /,\s*(byte|[abcd][lh])/.test(ins) ? 1 : 2;
  return 4;
}

function classify(line) {
  const m = line.match(/^([0-9a-f]{8})\s+((?:[0-9a-f]{2} )*[0-9a-f]{2})\s+(.*)$/);
  if (!m) return null;
  const va = parseInt(m[1], 16);
  const len = m[2].split(' ').length;
  let ins = m[3].trim().replace(/^(ds|ss|es|cs) /, '');
  const mn = ins.split(/\s+/)[0];
  const opsStr = ins.slice(mn.length).trim();
  const ops = opsStr ? opsStr.split(',').map(s => s.trim()) : [];
  const memTok = (opsStr.match(/\[[^\]]*\]/) || [null])[0];
  const mem = memTok ? parseMem(memTok) : null;
  const memIsDst = mem && ops.length && ops[0].includes('[');
  const r = { va, len, ins, mn, ops, mem, w: mem ? widthOf(ins) : 4 };
  // role
  if (mn === 'push') r.kind = ops[0].includes('[') ? 'push_m' : (R32.includes(ops[0]) ? 'push_r' : 'push_i');
  else if (mn === 'pop') r.kind = ops[0].includes('[') ? 'pop_m' : 'pop_r';
  else if (mn === 'call') r.kind = /\[|^e[a-z]{2}$/.test(ops[0]) ? 'call_ind' : 'call_rel';
  else if (mn === 'ret') r.kind = ops.length ? 'ret_imm' : 'ret';
  else if (mn === 'leave') r.kind = 'leave';
  else if (/^j/.test(mn) || /^loop/.test(mn)) r.kind = 'branch';
  else r.kind = 'other';
  r.term = r.kind === 'branch' || /^call|^ret/.test(r.kind) || mn === 'int3' || mn === 'hlt';
  const noMem = mn === 'lea' || mn === 'nop';
  const isString = /^(rep|repe|repne|repz|repnz)$/.test(mn) || /^(movs|stos|lods|cmps|scas)/.test(mn);
  r.string = isString;
  const pureStore = memIsDst && (mn === 'mov' || /^set/.test(mn) || mn === 'pop' || /^fst|^fist|^movq$|^movd$/.test(mn));
  r.load = !noMem && !!mem && !pureStore;
  r.store = !noMem && !!mem && memIsDst && !/^(cmp|test|push|bt)$/.test(mn) && !/^f(ld|ild|com|add|sub|mul|div)/.test(mn);
  if (r.kind === 'push_m') { r.load = true; r.store = false; }
  if (r.kind === 'pop_m') { r.load = false; r.store = true; }
  if (isString) { r.load = true; r.store = /stos|movs/.test(ins); r.mem = { base: null, idx: null, disp: 0, unknown: true }; }
  r.lea = mn === 'lea' ? { dst: ops[0], mem } : null;
  r.dst = ops[0] || null;
  return r;
}

// --- per-block walk ------------------------------------------------------
const lines = fs.readFileSync(blocksFile, 'utf8').trim().split('\n');
const blocks = lines.map(l => { const [a, h] = l.trim().split(/\s+/); return { addr: parseInt(a, 16) >>> 0, hits: +h }; });

const C = {}; // dynamic counters
const add = (k, n) => { C[k] = (C[k] || 0) + n; };
const shapes = new Map();   // skeleton -> hits
const pairSites = new Map(); // mod+va -> {hits, rule}
const noPE = new Map();
let totalHits = 0, decodedHits = 0;

for (const b of blocks) {
  totalHits += b.hits;
  const a = attribute(b.addr);
  const pe = peFor(a.name);
  if (!pe) { noPE.set(a.name, (noPE.get(a.name) || 0) + b.hits); continue; }
  const off = pe.va2off(a.va);
  if (off < 0) { noPE.set(a.name + '(nooff)', (noPE.get(a.name + '(nooff)') || 0) + b.hits); continue; }
  const insns = [];
  for (const ln of disasmAt(pe.buf, off, a.va, 64, null, { linear: true })) {
    const r = classify(ln); if (!r) break;
    insns.push(r);
    if (r.term) break;
  }
  decodedHits += b.hits;
  analyzeBlock(a, insns, b.hits);
}

function analyzeBlock(a, insns, hits) {
  const tag = `${a.name}+0x${a.va.toString(16)}`;
  for (const r of insns) if (r.kind !== 'other') add('op:' + r.kind, hits);
  add('op:all', hits * insns.length);
  // shapes
  for (let i = 0; i < insns.length; i++) {
    const r = insns[i], n1 = insns[i + 1], n2 = insns[i + 2];
    if (r.ins === 'push ebp' && n1 && n1.ins === 'mov ebp, esp') {
      add('shape:prologue push ebp;mov ebp,esp', hits);
      if (n2 && /^sub esp,/.test(n2.ins)) add('shape:  +sub esp,N', hits);
      let k = i + 2; while (insns[k] && /^sub esp|^and esp/.test(insns[k].ins)) k++;
      let saves = 0; while (insns[k] && insns[k].kind === 'push_r') { saves++; k++; }
      add(`shape:  +${saves} callee-save push`, hits);
    }
    if (r.kind === 'leave' && n1 && /^ret/.test(n1.kind)) add('shape:leave;ret', hits);
    if (r.ins === 'mov esp, ebp' && n1 && n1.ins === 'pop ebp') add('shape:mov esp,ebp;pop ebp', hits);
    if (r.kind === 'pop_r' && n1 && /^ret/.test(n1.kind)) add('shape:pop r;ret', hits);
  }
  // runs
  for (let i = 0; i < insns.length;) {
    const k = insns[i].kind;
    if (k === 'push_r' || k === 'push_i' || k === 'pop_r') {
      const fam = k === 'pop_r' ? 'pop' : 'push';
      let j = i, mixed = false;
      while (j < insns.length && (fam === 'pop' ? insns[j].kind === 'pop_r' : (insns[j].kind === 'push_r' || insns[j].kind === 'push_i'))) { if (insns[j].kind !== k) mixed = true; j++; }
      const n = j - i;
      add(`run:${fam} x${Math.min(n, 5)}${n >= 5 ? '+' : ''}`, hits);
      add(`runops:${fam} in run>=2`, n >= 2 ? hits * n : 0);
      add(`runops:${fam} total`, hits * n);
      if (fam === 'push' && insns[j] && /^call/.test(insns[j].kind)) add('shape:push-run then call', hits);
      i = j;
    } else i++;
  }
  // push fate + pair analysis (ESP model relative to block entry)
  let esp = 0, espKnown = true, ebpOff = null;
  const live = []; // pushed slots: {off, i, elided, rules: {C0,R1,R2} still ok, forwardedW}
  const escaped = new Set(); // regs holding a stack address
  const pairs = [];
  for (let i = 0; i < insns.length; i++) {
    const r = insns[i];
    // memory access against live slots (not the push/pop themselves)
    const isSelf = r.kind === 'push_r' || r.kind === 'push_i' || r.kind === 'pop_r';
    if (!isSelf && (r.load || r.store) && live.length) {
      let range = null;
      const m = r.mem;
      if (m && !m.unknown && !m.idx) {
        if (m.base === 'esp' && espKnown) range = [esp + m.disp, esp + m.disp + r.w];
        else if (m.base === 'ebp' && ebpOff !== null) range = [ebpOff + m.disp, ebpOff + m.disp + r.w];
        else if (m.base === null) range = 'abs';
      }
      const viaEscaped = m && (escaped.has(m.base) || escaped.has(m.idx));
      for (const s of live) {
        s.C0 = false;
        if (range === 'abs') continue; // absolute address: not stack
        if (range && !viaEscaped) {
          const lo = s.off, hi = s.off + 4;
          if (range[1] <= lo || range[0] >= hi) { /* disjoint */ }
          else if (range[0] === lo && r.w === 4) { s.hit = true; }
          else { s.R1 = false; s.R2 = false; }
        } else {
          s.R1 = false; // unknown address
          s.guarded = true;
        }
      }
    }
    if (r.lea && r.lea.mem && (r.lea.mem.base === 'esp' || r.lea.mem.base === 'ebp')) {
      escaped.add(r.lea.dst);
      for (const s of live) s.leaEsc = true;
    } else if (r.dst && escaped.has(r.dst) && !r.dst.includes('[')) escaped.delete(r.dst);
    // ESP/EBP effects
    switch (r.kind) {
      case 'push_r': case 'push_i': case 'push_m':
        esp -= 4; live.push({ off: esp, i, C0: true, R1: true, R2: true, kind: r.kind }); add('fate:push', 1 * 0); break;
      case 'pop_r': case 'pop_m': {
        const s = live.length && espKnown && live[live.length - 1].off === esp ? live.pop() : null;
        if (s) pairs.push({ s, j: i, popReg: r.dst, pushIns: insns[s.i].ins });
        esp += 4; break;
      }
      case 'call_rel': case 'call_ind': break; // terminator
      case 'leave':
        if (ebpOff !== null) { esp = ebpOff + 4; ebpOff = null; } else espKnown = false;
        live.length = 0; break;
      default:
        if (r.dst === 'esp' || r.ins.startsWith('xchg esp') ) {
          const mm = r.ins.match(/^(sub|add) esp, (\S+)$/);
          if (mm && /^0x|^\d/.test(mm[2])) esp += (mm[1] === 'sub' ? -1 : 1) * num(mm[2]);
          else if (r.ins === 'mov esp, ebp' && ebpOff !== null) esp = ebpOff;
          else if (/^lea esp, \[esp[+-]/.test(r.ins)) esp += r.mem.disp;
          else espKnown = false;
          // slots above the new esp are dead
          while (live.length && live[live.length - 1].off < esp) live.pop();
          if (!espKnown) live.length = 0;
        }
        if (r.ins === 'mov ebp, esp' && espKnown) ebpOff = esp;
        else if (r.dst === 'ebp' || r.dst === 'bp') ebpOff = null;
    }
  }
  // fates
  for (const r of insns) if (r.kind === 'push_r' || r.kind === 'push_i') add('fate:push total', hits);
  const pairedIdx = new Set(pairs.map(p => p.s.i));
  const termCall = insns.length && /^call/.test(insns[insns.length - 1].kind);
  for (const s of live) {
    if (s.kind === 'push_m') continue;
    if (termCall) add('fate:push live-out into call (args/ret)', hits);
    else add('fate:push live-out other (saves/locals)', hits);
  }
  for (const p of pairs) {
    if (p.s.kind === 'push_m') continue;
    add('fate:push paired in block', hits);
    const same = p.pushIns === 'push ' + p.popReg;
    add(same ? 'pair:push r..pop same r (save/restore)' : (p.s.kind === 'push_i' ? 'pair:push imm..pop r (const move)' : 'pair:push r..pop other r (move)'), hits);
    const esc = p.s.leaEsc;
    const c0 = p.s.C0 && !esc, r1 = p.s.R1 && !esc, r2 = p.s.R2 && !esc;
    add('rule:C0 conservative', c0 ? hits : 0);
    add('rule:R1 known-offset', r1 ? hits : 0);
    add('rule:R2 +runtime guard', r2 ? hits : 0);
    add('rule:blocked (partial overlap or LEA escape)', r2 ? 0 : hits);
    if (r1 && p.s.hit) add('rule:  R1 via exact-hit forwarding', hits);
    const key = `${tag} ${p.pushIns}..pop ${p.popReg}`;
    const e = pairSites.get(key) || { hits: 0, rule: r2 && !r1 ? 'R2' : r1 && !c0 ? 'R1' : c0 ? 'C0' : 'blocked', n: insns.length };
    e.hits += hits; pairSites.set(key, e);
  }
  if (!pairs.length) return;
  void pairedIdx;
}

// --- report --------------------------------------------------------------
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '-';
const out = { window: hist.window, blockEntries: totalHits, decodedEntries: decodedHits, counts: C, noPE: Object.fromEntries(noPE) };
if (argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log(`window ${JSON.stringify(hist.window)} handler ops ${hist.ops}  block entries ${totalHits}  decoded ${pct(decodedHits, totalHits)}`);
if (noPE.size) console.log('no PE for: ' + [...noPE].map(([k, v]) => `${k}=${v}`).join(' '));
const all = C['op:all'] || 0;
console.log(`\nstatic x86 insns executed in threaded blocks: ${all}`);
const stackOps = ['push_r', 'push_i', 'push_m', 'pop_r', 'pop_m', 'call_rel', 'call_ind', 'ret', 'ret_imm', 'leave'];
let st = 0; for (const k of stackOps) st += C['op:' + k] || 0;
console.log(`stack/call/ret insns: ${st} (${pct(st, all)} of executed x86 insns)`);
for (const k of stackOps) if (C['op:' + k]) console.log(`  ${k.padEnd(10)} ${String(C['op:' + k]).padStart(11)}  ${pct(C['op:' + k], all)}`);
const section = (pfx, title) => {
  console.log(`\n${title}`);
  for (const [k, v] of Object.entries(C).filter(([k]) => k.startsWith(pfx)).sort((x, y) => y[1] - x[1])) console.log(`  ${k.slice(pfx.length).padEnd(46)} ${String(v).padStart(11)}`);
};
section('shape:', 'shapes (block-entry weighted):');
section('run:', 'push/pop run lengths (runs, weighted):');
section('runops:', 'ops in runs:');
section('fate:', 'fate of each push r/imm:');
section('pair:', 'in-block push->pop pairs:');
section('rule:', 'pairs elidable per alias rule (cumulative):');
console.log(`\ntop pair sites:`);
for (const [k, v] of [...pairSites].sort((x, y) => y[1].hits - x[1].hits).slice(0, PAIRS)) console.log(`  ${String(v.hits).padStart(10)}  ${v.rule.padEnd(7)} ${k}`);
void TOP;
