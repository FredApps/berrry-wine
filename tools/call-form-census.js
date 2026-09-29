#!/usr/bin/env node
'use strict';

// Census of control-transfer FORMS in a PE: which kinds of call, jmp and ret
// the code is built from. Answers "how much of this binary's calling is
// vtable dispatch vs direct calls vs IAT imports vs switch tables" before any
// uop-tier work on calls is ranked. Static only: a count here is reach, not
// hotness -- pair with a runtime histogram before building anything.
//
//   node tools/call-form-census.js <pe> [<pe>...] [--slots] [--json]
//
// Linear sweep of every code section (lib/pe.js isCode, so Borland CodeSeg
// counts), one instruction at a time through tools/disasm.js. Data inside
// .text misdecodes and adds noise; the large buckets are robust to it.
//
// Buckets:
//   call rel32        direct call                       (07e follows these)
//   call [abs]        through an absolute slot: IAT import or a global fn ptr
//   call [r+d]        through a register + displacement: C++/COM vtable slot
//   call [r]          vtable slot 0 (or a fn ptr held in a struct's first field)
//   call r            through a register: fn ptr loaded earlier (often a vtable)
//   call [sib]        indexed: fn-pointer table
//   jmp [tbl+r*4]     switch jump table
//   jmp r / jmp [..]  other indirect jumps (tail calls, thunks)
//   ret / ret imm     cdecl-style / stdcall-thiscall-style return

const fs = require('fs');
const { readPE } = require('../lib/pe');
const { disasmAt } = require('./disasm');

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const JSON_OUT = args.includes('--json');
const SLOTS = args.includes('--slots');
if (!files.length) {
  console.error('usage: node tools/call-form-census.js <pe> [<pe>...] [--slots] [--json]');
  process.exit(2);
}

const REG = '(?:e[abcd]x|e[sd]i|ebp|esp)';
function classify(text) {
  let m;
  if ((m = /^call (.*)$/.exec(text))) {
    const op = m[1].replace(/^dword (?:ptr )?/, '');
    if (/^0x[0-9a-f]+$/.test(op)) return ['call rel32'];
    if (new RegExp(`^${REG}$`).test(op)) return ['call r'];
    if (!op.startsWith('[')) return ['call other'];
    if (/^\[0x[0-9a-f]+\]$/.test(op) || /^\[[A-Za-z0-9_.!@?$]+\]$/.test(op) && !new RegExp(`^\\[${REG}\\]$`).test(op)) return ['call [abs]'];
    if (/\*/.test(op) || new RegExp(`${REG}\\s*\\+\\s*${REG}`).test(op)) return ['call [sib]'];
    if (new RegExp(`^\\[${REG}\\]$`).test(op)) return ['call [r]', 0];
    const d = new RegExp(`^\\[${REG}\\s*([+-])\\s*(0x[0-9a-f]+|\\d+)\\]$`).exec(op);
    if (d) return ['call [r+d]', d[1] === '-' ? -1 : parseInt(d[2])];
    return ['call other'];
  }
  if ((m = /^jmp (.*)$/.exec(text))) {
    const op = m[1].replace(/^dword (?:ptr )?/, '');
    if (/^(?:short )?0x[0-9a-f]+$/.test(op)) return null;
    if (/\*4/.test(op) && /\[/.test(op)) return ['jmp [tbl+r*4]'];
    if (new RegExp(`^${REG}$`).test(op)) return ['jmp r'];
    if (op.startsWith('[')) return ['jmp [..]'];
    return null;
  }
  if (/^ret(?:n)?$/.test(text)) return ['ret'];
  if (/^ret(?:n)? (0x[0-9a-f]+|\d+)$/.test(text)) return ['ret imm'];
  return null;
}

function census(file) {
  const pe = readPE(file);
  const counts = {}, slots = new Map();
  let insns = 0;
  for (const s of pe.sections) {
    if (!s.isCode) continue;
    const end = s.rawOff + Math.min(s.rawSize, s.vsize || s.rawSize);
    let off = s.rawOff;
    while (off < end) {
      const va = pe.imageBase + s.rva + (off - s.rawOff);
      let line;
      try { line = disasmAt(pe.buf, off, va, 1)[0]; } catch (_) { line = null; }
      // "VA  b0 b1 ...   mnemonic operands"
      const m = line && /^\s*[0-9a-f]+\s+((?:[0-9a-f]{2} )+)\s*(.*)$/.exec(line);
      if (!m) { off++; continue; }
      const len = m[1].trim().split(/\s+/).length;
      insns++;
      const c = classify(m[2].trim().toLowerCase());
      if (c) {
        counts[c[0]] = (counts[c[0]] || 0) + 1;
        if (c.length > 1 && c[1] >= 0) slots.set(c[1], (slots.get(c[1]) || 0) + 1);
      }
      off += len;
    }
  }
  return { file, insns, counts, slots };
}

const ORDER = ['call rel32', 'call [abs]', 'call [r+d]', 'call [r]', 'call r', 'call [sib]', 'call other',
  'jmp [tbl+r*4]', 'jmp r', 'jmp [..]', 'ret', 'ret imm'];
const rows = files.map(census);
if (JSON_OUT) {
  console.log(JSON.stringify(rows.map(r => ({ ...r, slots: Object.fromEntries(r.slots) })), null, 1));
} else {
  for (const r of rows) {
    const calls = ORDER.filter(k => k.startsWith('call')).reduce((a, k) => a + (r.counts[k] || 0), 0);
    const rets = (r.counts.ret || 0) + (r.counts['ret imm'] || 0);
    console.log(`\n${r.file}  (${r.insns} insns decoded, ${calls} calls, ${rets} rets)`);
    for (const k of ORDER) {
      const n = r.counts[k] || 0;
      if (!n) continue;
      const base = k.startsWith('call') ? calls : k.startsWith('ret') ? rets : 0;
      console.log(`  ${k.padEnd(14)} ${String(n).padStart(7)}${base ? `  ${(100 * n / base).toFixed(1).padStart(5)}%` : ''}`);
    }
    if (SLOTS && r.slots.size) {
      const top = [...r.slots].sort((a, b) => b[1] - a[1]).slice(0, 12);
      console.log('  vtable disp:   ' + top.map(([d, n]) => `+0x${d.toString(16)}=${n}`).join(' '));
    }
  }
}
