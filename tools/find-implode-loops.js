#!/usr/bin/env node
'use strict';

// Census of the two PKWARE-DCL implode match-extension loops that handler 466
// (H466, --implode-cmp-run) folds:
//
//   node tools/find-implode-loops.js <pe> [<pe>...] [--detail] [--json]
//   node tools/find-implode-loops.js --dir=test/binaries [--ext=.exe,.dll]
//
// This is the STATIC twin of $try_emit_implode_cmp_run in src/07-decoder.wat,
// and it exists because the runtime answer is nearly unobtainable: the fold
// only fires while a guest is COMPRESSING (saving a game), so a launch sweep
// over the whole registry reports "blocks 0" for every app and proves nothing.
// Grepping the corpus answers "which binaries even contain this shape" for the
// cost of reading the files.
//
// It is a grammar over the loop SHAPE, not a byte signature, exactly as the
// WAT matcher is -- every register is read out of its ModRM field into a role,
// the window bound is read out of the compare's immediate rather than pinned
// to 0x204, and the frame slots are read as disp8s. A build that allocated
// different registers, or a copy of the coder with a different window size,
// still matches. Matching bytes instead is what made the CK-LUT fold reject
// every occurrence it was written for (cba5cb90).
//
// The two forms, as one build happened to emit them:
//   form 0, 29 bytes: 46 81fe04020000 7d14 8b6c242c ff442414 8b542414
//                     8a1a 385c3500 74e3
//   form 1, 18 bytes: 8a5101 46 41 3816 7509 43 81fb04020000 7cee
//
// Linear sweep from every byte offset, so data-in-code can misdecode; the role
// checks make a false positive unlikely but not impossible. A hit in one file
// is a lead, the same shape across several binaries is signal.

const fs = require('fs');
const path = require('path');
const { readPE } = require('../lib/pe');

const REG = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const ESP = 4;

const sx8 = v => (v << 24) >> 24;

// ModRM that must be `[esp+disp8]`: mod=01, rm=100 (a SIB follows, and only
// 0x24 -- base ESP, no index -- is the frame form this grammar means).
const frameModrm = m => (m >> 6) === 1 && (m & 7) === 4;

// `[reg]` with no displacement, reg field = want, and a base that is really a
// register (rm=4 is a SIB escape, rm=5 at mod=0 is a disp32 absolute).
function mem0(m, want) {
  if ((m >> 6) !== 0) return false;
  const rm = m & 7;
  if (rm === 4 || rm === 5) return false;
  return ((m >> 3) & 7) === want;
}
function mem0Reg(m) {
  if ((m >> 6) !== 0) return -1;
  const rm = m & 7;
  if (rm === 4 || rm === 5) return -1;
  return (m >> 3) & 7;
}

// Four distinct registers, none of them ESP: the handler writes all four back
// at the end, so an alias would make write order load-bearing.
function regsOk(regs) {
  const seen = new Set();
  for (const r of regs) {
    if (r === ESP) return false;
    if (seen.has(r)) return false;
    seen.add(r);
  }
  return seen.size === regs.length;
}

// Try both forms at `off`. Returns a match descriptor or null.
function matchAt(buf, off, end) {
  const g8 = i => (i >= 0 && i < end ? buf[i] : -1);
  const g32 = i => (i >= 0 && i + 4 <= end ? buf.readUInt32LE(i) : -1);

  const head = off;
  let pc = off;
  let I, W, C, V, N, limit, alt, exitEip, form;
  let b = g8(pc);

  if ((b & 0xF8) === 0x40) {
    // ---------------- form 0: the [esp]-cursor loop ----------------
    I = b & 7;
    pc += 1;
    b = g8(pc);
    if (b !== 0x81 && b !== 0x83) return null;
    if (g8(pc + 1) !== (0xF8 | I)) return null;
    if (b === 0x81) { limit = g32(pc + 2); pc += 6; }
    else { limit = sx8(g8(pc + 2)); pc += 3; }

    if (g8(pc) !== 0x7D) return null;                    // jge exit
    alt = pc + 2 + sx8(g8(pc + 1));
    pc += 2;

    if (g8(pc) !== 0x8B) return null;                    // mov W,[esp+d1]
    let m = g8(pc + 1);
    if (!frameModrm(m) || g8(pc + 2) !== 0x24) return null;
    W = (m >> 3) & 7;
    pc += 4;

    if (g8(pc) !== 0xFF) return null;                    // inc dword [esp+d2]
    m = g8(pc + 1);
    if (!frameModrm(m) || ((m >> 3) & 7) !== 0) return null;
    if (g8(pc + 2) !== 0x24) return null;
    const d2 = sx8(g8(pc + 3));
    pc += 4;

    if (g8(pc) !== 0x8B) return null;                    // mov C,[esp+d2]
    m = g8(pc + 1);
    if (!frameModrm(m) || g8(pc + 2) !== 0x24) return null;
    if (sx8(g8(pc + 3)) !== d2) return null;             // the SAME frame slot
    C = (m >> 3) & 7;
    pc += 4;

    if (g8(pc) !== 0x8A) return null;                    // mov V8,[C]
    m = g8(pc + 1);
    V = mem0Reg(m);
    if (V < 0 || (m & 7) !== C) return null;
    pc += 2;

    if (g8(pc) !== 0x38) return null;                    // cmp [W+I*1+d3],V8
    m = g8(pc + 1);
    const mod = m >> 6;
    if (mod > 1 || (m & 7) !== 4) return null;
    if (((m >> 3) & 7) !== V) return null;
    const sib = g8(pc + 2);
    if (sib >> 6) return null;                           // scale must be 1
    if (((sib >> 3) & 7) !== I) return null;
    if ((sib & 7) !== W) return null;
    if (mod === 1) pc += 4;
    else {
      if (W === 5) return null;   // mod=00 base=EBP is disp32, not [ebp+index]
      pc += 3;
    }

    if (g8(pc) !== 0x74) return null;                    // jz head
    exitEip = pc + 2;
    if (exitEip + sx8(g8(pc + 1)) !== head) return null;
    form = 0;
  } else if (b === 0x8A) {
    // ---------------- form 1: the register loop ----------------
    let m = g8(pc + 1);                                  // mov V8,[C+d1]
    const mod = m >> 6;
    const rm = m & 7;
    V = (m >> 3) & 7;
    if (rm === 4 || rm === 5) return null;
    C = rm;
    if (mod === 1) pc += 3;
    else if (mod === 0) pc += 2;
    else return null;

    b = g8(pc);                                          // inc I
    if ((b & 0xF8) !== 0x40) return null;
    I = b & 7;
    pc += 1;
    if (g8(pc) !== (0x40 | C)) return null;              // inc C
    pc += 1;

    if (g8(pc) !== 0x38) return null;                    // cmp [I],V8
    m = g8(pc + 1);
    if (!mem0(m, V) || (m & 7) !== I) return null;
    pc += 2;

    if (g8(pc) !== 0x75) return null;                    // jnz exit
    alt = pc + 2 + sx8(g8(pc + 1));
    pc += 2;

    b = g8(pc);                                          // inc N
    if ((b & 0xF8) !== 0x40) return null;
    N = b & 7;
    pc += 1;
    b = g8(pc);                                          // cmp N, LIMIT
    if (b !== 0x81 && b !== 0x83) return null;
    if (g8(pc + 1) !== (0xF8 | N)) return null;
    if (b === 0x81) { limit = g32(pc + 2); pc += 6; }
    else { limit = sx8(g8(pc + 2)); pc += 3; }

    if (g8(pc) !== 0x7C) return null;                    // jl head
    exitEip = pc + 2;
    if (exitEip + sx8(g8(pc + 1)) !== head) return null;

    W = C;
    C = N;
    form = 1;
  } else {
    return null;
  }

  // Both exits must be the instruction after the back edge: a loop whose early
  // exit goes elsewhere is a different loop, and the fold has exactly one EIP
  // to leave at.
  if (alt !== exitEip) return null;
  // V is written as a byte, so it must be one of the four low-byte regs;
  // 4..7 would name AH..BH and mean something else.
  if (V > 3) return null;
  if (!regsOk([I, W, C, V])) return null;

  return { form, head, bytes: exitEip - head, limit, I, W, C, V };
}

function scanPe(file) {
  const pe = readPE(file);
  const hits = [];
  for (const s of pe.sections) {
    if (!s.isCode) continue;
    const start = s.rawOff;
    const end = Math.min(start + s.rawSize, pe.buf.length);
    for (let off = start; off < end; off++) {
      const m = matchAt(pe.buf, off, end);
      if (m) {
        hits.push({ ...m, va: pe.off2va(m.head), section: s.name });
        off += m.bytes - 1;
      }
    }
  }
  return hits;
}

// ---- cli -------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
const has = n => argv.includes(`--${n}`);

let files = argv.filter(a => !a.startsWith('--'));
const dir = opt('dir', null);
if (dir) {
  const exts = opt('ext', '.exe,.dll').split(',');
  const walk = d => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (exts.some(e => ent.name.toLowerCase().endsWith(e))) files.push(p);
    }
  };
  walk(dir);
}
if (!files.length) {
  console.error('usage: find-implode-loops.js <pe> [<pe>...] | --dir=DIR [--ext=.exe,.dll]');
  console.error('       [--detail] [--json]');
  process.exit(2);
}

const rows = [];
let scanned = 0, rejected = 0;
for (const f of files) {
  let hits;
  try { hits = scanPe(f); } catch (e) { rejected++; continue; }
  scanned++;
  if (hits.length) rows.push({ file: f, hits });
}

if (has('json')) {
  console.log(JSON.stringify({ scanned, rejected, rows }, null, 2));
} else {
  for (const r of rows) {
    const f0 = r.hits.filter(h => h.form === 0).length;
    const f1 = r.hits.filter(h => h.form === 1).length;
    console.log(`${r.file}  ${r.hits.length} match${r.hits.length === 1 ? '' : 'es'} (form0 ${f0}, form1 ${f1})`);
    if (has('detail')) {
      for (const h of r.hits) {
        console.log(`    0x${h.va.toString(16).padStart(8, '0')}  form ${h.form}  ${h.bytes}b  ` +
          `limit 0x${(h.limit >>> 0).toString(16)}  ` +
          `I=${REG[h.I]} W=${REG[h.W]} C=${REG[h.C]} V=${REG[h.V]}l  [${h.section}]`);
      }
    }
  }
  const total = rows.reduce((n, r) => n + r.hits.length, 0);
  console.log(`\n${total} matches in ${rows.length} of ${scanned} PEs scanned` +
    (rejected ? ` (${rejected} not readable as a 32-bit PE)` : ''));
}
