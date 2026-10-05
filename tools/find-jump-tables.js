#!/usr/bin/env node
// Census of switch JUMP TABLES in a PE: which shapes occur, how large their
// tables are, and how many of them the two jump-table lowerings can take.
//
//   node tools/find-jump-tables.js <pe> [<pe>...] [--list=FILE] [--detail] [--json]
//
// The shapes, as MSVC and Watcom write them:
//
//   DIRECT   cmp idx, N-1 / ja default / ... / jmp [tbl + idx*4]
//   MOVZX2   cmp r, K / ja default / movzx idx, byte [r + btab] / jmp [dtab + idx*4]
//   XORMOV2  cmp r, K / ja default / xor idx, idx / mov idx8, byte [r + btab] / jmp [...]
//   NOBOUND  jmp [tbl + idx*4] with no cmp/ja in front (the index is bounded
//            some other way, or the table is a computed dispatch)
//
// What each lowering takes:
//   * the threaded op (handler 498, src/07-decoder.wat) takes EVERY
//     `jmp [disp32 + r*4]`, whatever precedes it -- it reads the entry at run
//     time, so it needs no bound;
//   * the uop tier ($uc_jt_targets, src/07e-uop-compiler.wat) takes DIRECT,
//     MOVZX2 and XORMOV2 with at most 16 table entries -- it must know every target at
//     compile time to form a region. The `uop` column counts those.
//
// Method: scan code sections for FF 24 SIB (mod 00, rm 100, base 101, scale
// 4), then decode backwards by trying start offsets up to 48 bytes before the
// jump and keeping the longest decode that lands exactly on it. A start that
// desyncs is dropped, so this under-reports rather than inventing shapes. It
// says nothing about how HOT a table is; pair it with --handler-hist (handler
// 498's count) or a hot-block dump.

'use strict';
const path = require('path');
const { readPE } = require(path.join(__dirname, '..', 'lib', 'pe.js'));
const { disasmAt } = require(path.join(__dirname, 'disasm.js'));

const args = process.argv.slice(2);
const listArg = args.find(a => a.startsWith('--list='));
// --list=FILE: one path per line; identical files (by content) count once.
const files = args.filter(a => !a.startsWith('--')).concat(
  listArg ? require('fs').readFileSync(listArg.slice(7), 'utf8').split('\n').filter(Boolean) : []);
const seenHash = new Set();
const DETAIL = args.includes('--detail');
const JSON_OUT = args.includes('--json');
const REG32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const R8 = { al: 'eax', cl: 'ecx', dl: 'edx', bl: 'ebx' };
const UOP_MAX = 16;

if (!files.length) {
  console.error('usage: find-jump-tables.js <pe> [<pe>...] [--detail] [--json]');
  process.exit(2);
}

function decodeBefore(pe, off, va) {
  let best = null;
  for (let k = 96; k >= 2; k--) {
    if (off - k < 0) continue;
    let lines;
    try {
      lines = disasmAt(pe.buf, off - k, va - k, k + 7, null, { linear: true });
    } catch (e) { continue; }
    const insns = [];
    let landed = false;
    for (const line of lines) {
      const v = parseInt(line.slice(0, 8), 16);
      if (v === va) { landed = true; break; }
      if (v > va) break;
      insns.push({ va: v, text: line.slice(38).trim() });
    }
    // the widest start that lands: x86 resynchronizes within a few
    // instructions, so a long run into the jump is the likely true decode
    if (landed) { best = insns; break; }
  }
  return best || [];
}

const writes = (text, reg) => {
  const m = text.match(/^(\w+) (?:dword |byte |word )?([a-z]+)\b/);
  if (!m || ['cmp', 'test', 'push', 'jmp'].includes(m[1]) || m[1][0] === 'j') return false;
  const r = m[2];
  return r === reg || R8[r] === reg || (r.length === 2 && 'e' + r === reg);
};

function classify(pe, insns, idx) {
  // nearest ja before the jump, then the cmp feeding it
  let j = insns.length - 1;
  while (j >= 0 && !/^ja /.test(insns[j].text)) {
    if (/^(j|call|ret)/.test(insns[j].text)) return { shape: 'NOBOUND' };
    j--;
  }
  if (j < 0) return { shape: 'NOBOUND' };
  // the cmp feeding it, over instructions that leave EFLAGS alone
  let c = j - 1;
  while (c >= 0 && !/^cmp /.test(insns[c].text)) {
    if (!/^(mov|lea|push|pop|nop|xchg|f)/.test(insns[c].text)) return { shape: 'NOBOUND' };
    if (j - c > 16) return { shape: 'NOBOUND' };
    c--;
  }
  if (c < 0) return { shape: 'NOBOUND' };
  const cm = insns[c].text.match(/^cmp (?:dword )?([a-z]{3}), 0x([0-9a-f]+)$/);
  if (!cm) return { shape: 'OTHER', why: insns[c].text };
  const creg = cm[1], k = parseInt(cm[2], 16);
  const between = insns.slice(j + 1);
  const mz = between.find(x => /^movzx /.test(x.text) && x.text.startsWith(`movzx ${idx},`));
  const mv = between.find(x => new RegExp(`^mov ${Object.keys(R8).find(b => R8[b] === idx) || 'zz'}, (?:byte )?\\[`).test(x.text));
  const btabOf = (t) => { const m = t.match(/\[(?:[a-z]{3}\+)?0x([0-9a-f]+)(?:\+[a-z]{3})?\]/); return m ? parseInt(m[1], 16) : null; };
  const nFromBytes = (btab) => {
    let mx = -1;
    for (let q = 0; q <= k; q++) {
      const o = pe.va2off(btab + q);
      if (o < 0) return null;
      mx = Math.max(mx, pe.buf[o]);
    }
    return mx + 1;
  };
  const steps = insns.length - c;  // $uc_jt_targets walks at most 8
  if (mz) {
    const btab = btabOf(mz.text);
    return { shape: 'MOVZX2', steps, cases: k + 1, n: btab == null ? null : nFromBytes(btab), btab };
  }
  if (mv) {
    const btab = btabOf(mv.text);
    return { shape: 'XORMOV2', steps, cases: k + 1, n: btab == null ? null : nFromBytes(btab), btab };
  }
  if (creg !== idx) return { shape: 'OTHER', why: `cmp ${creg} vs index ${idx}` };
  if (between.some(x => writes(x.text, idx))) return { shape: 'OTHER', why: 'index rewritten after ja' };
  return { shape: 'DIRECT', steps, cases: k + 1, n: k + 1 };
}

const results = [];
for (const file of files) {
  let pe;
  try { pe = readPE(file); } catch (e) { continue; }
  const h = require('crypto').createHash('sha1').update(pe.buf).digest('hex');
  if (seenHash.has(h)) continue;
  seenHash.add(h);
  const rows = [];
  for (const sec of pe.sections) {
    if (!sec.isCode) continue;
    const end = sec.rawOff + Math.min(sec.rawSize, Math.max(sec.vsize, sec.rawSize));
    for (let p = sec.rawOff; p + 7 <= end && p + 7 <= pe.buf.length; p++) {
      if (pe.buf[p] !== 0xFF || pe.buf[p + 1] !== 0x24) continue;
      const sib = pe.buf[p + 2];
      if ((sib & 0xC7) !== 0x85) continue;
      const ix = (sib >> 3) & 7;
      if (ix === 4) continue;
      const va = sec.va + (p - sec.rawOff);
      const tbl = pe.buf.readUInt32LE(p + 3);
      if (!pe.isCodeVa(tbl) && !pe.sectionForVa(tbl)) continue; // not a table in this image
      const idx = REG32[ix];
      const insns = decodeBefore(pe, p, va);
      const cls = classify(pe, insns, idx);
      const uop = ['DIRECT', 'MOVZX2', 'XORMOV2'].includes(cls.shape) && cls.n != null && cls.n >= 1 && cls.n <= UOP_MAX && cls.steps <= 8;
      rows.push({ va, tbl, idx, ...cls, uop });
    }
  }
  results.push({ file, rows });
}

if (JSON_OUT) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }

const tot = { sites: 0, DIRECT: 0, MOVZX2: 0, XORMOV2: 0, NOBOUND: 0, OTHER: 0, uop: 0, pes: 0 };
const nHist = { '<=8': 0, '<=16': 0, '<=64': 0, '>64': 0 };
for (const { file, rows } of results) {
  if (!rows.length) continue;
  tot.pes++;
  const c = { DIRECT: 0, MOVZX2: 0, XORMOV2: 0, NOBOUND: 0, OTHER: 0, uop: 0 };
  for (const r of rows) {
    c[r.shape]++; tot[r.shape]++; tot.sites++;
    if (r.uop) { c.uop++; tot.uop++; }
    if (r.n != null) nHist[r.n <= 8 ? '<=8' : r.n <= 16 ? '<=16' : r.n <= 64 ? '<=64' : '>64']++;
  }
  console.log(`${String(rows.length).padStart(5)} sites  direct ${c.DIRECT}  movzx2 ${c.MOVZX2}  xormov2 ${c.XORMOV2}  nobound ${c.NOBOUND}  other ${c.OTHER}  uop ${c.uop}  ${path.relative(process.cwd(), file)}`);
  if (DETAIL) {
    for (const r of rows) {
      console.log(`    0x${r.va.toString(16)}  jmp [0x${r.tbl.toString(16)}+${r.idx}*4]  ${r.shape}` +
        (r.n != null ? `  n=${r.n}` : '') + (r.cases != null && r.cases !== r.n ? ` cases=${r.cases}` : '') +
        (r.why ? `  (${r.why})` : '') + (r.uop ? '  uop' : ''));
    }
  }
}
console.log(`\n${tot.sites} table jumps in ${tot.pes} PEs: DIRECT ${tot.DIRECT}, MOVZX2 ${tot.MOVZX2}, XORMOV2 ${tot.XORMOV2}, NOBOUND ${tot.NOBOUND}, OTHER ${tot.OTHER}`);
console.log(`table entries (bounded shapes): ${Object.entries(nHist).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`threaded op takes all ${tot.sites}; uop tier (bounded shapes, <=${UOP_MAX} entries) takes ${tot.uop} (${tot.sites ? (100 * tot.uop / tot.sites).toFixed(1) : 0}%)`);
