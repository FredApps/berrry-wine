#!/usr/bin/env node
// Census of COLOUR-KEYED lookup-table blit loops in a PE.
//
//   node tools/find-ck-lut-nests.js <pe> [<pe>...] [--max-span=160] [--detail]
//                                   [--class=CK_LUT16_SRC,...] [--json]
//
// The shape, as SimGolf's jgl.dll writes it at 0x10016ea8:
//
//   head:  cmp byte [esi], 0xff / jnb advance      <- the transparent key
//          cmp byte [esi], 0xf8 / jnz palette      <- a second token
//          mov bx,[edi] / mov bx,[ebp+ebx*2] / mov [edi],bx / jmp advance
// palette: mov al,[esi] / mov bx,[ecx+eax*2] / mov [edi],bx
// advance: inc esi / add edi,2 / dec edx / jnz head
//
// i.e. `dst16 = table16[src8]` (or `= table16[dst16]` for a shadow pass) with
// one or two sentinel bytes that skip the store. The arithmetic is exactly
// what H418's `wide16` path already executes; what stops it being folded is
// the key test, which splits each pixel into four or five basic blocks.
//
// WHY NOT match-loops.js: that applies the Design-A matcher, and
// `$loop_match_block` returns immediately unless the block branches to ITSELF
// (src/07b-loop-match.wat:4296). A keyed body is a diamond that rejoins at a
// shared advance block, so no recognizer is ever attempted on it -- these are
// the `multi-branch` declines. This tool answers the question that decides
// whether a keyed LUT fold is worth building: does the shape occur outside the
// one binary that motivated it?
//
// Method: find every short backward conditional jump, decode linearly from its
// target, and require that the decode land exactly on the jump it started
// from. A head that is mid-instruction fails that check and is dropped, so
// this under-reports (data-in-code, unusual encodings) rather than inventing
// matches. It says nothing about how HOT any of them are; pair it with a
// handler histogram.

const fs = require('fs');
const path = require('path');
const { readPE } = require(path.join(__dirname, '..', 'lib', 'pe.js'));
const { disasmAt } = require(path.join(__dirname, 'disasm.js'));

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const flag = (n, d) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : d;
};
const MAX_SPAN = parseInt(flag('max-span', '160'), 10);
const DETAIL = args.includes('--detail');
const JSON_OUT = args.includes('--json');
const ONLY = (flag('class', '') || '').split(',').filter(Boolean);

if (!files.length) {
  console.error('usage: find-ck-lut-nests.js <pe> [<pe>...] [--max-span=N] [--detail] [--json]');
  process.exit(2);
}

const R16 = new Set(['ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'sp']);
const R8 = new Set(['al', 'bl', 'cl', 'dl', 'ah', 'bh', 'ch', 'dh']);
const R32 = new Set(['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp']);
const parentOf = (r) =>
  R32.has(r) ? r : R16.has(r) ? 'e' + r : R8.has(r) ? 'e' + r[0] + 'x' : null;

// One decoded line: "0040f71c  8a 06   mov al, [esi]"
function parseLine(line) {
  const va = parseInt(line.slice(0, 8), 16);
  const text = line.slice(38).trim();
  return { va, text };
}

// Backward conditional jumps, which is where a loop body ends. Both rel8 and
// rel32 encodings; `jnz` is the counted form and `jb`/`jbe` the cursor one.
function backEdges(buf, sec, va2off) {
  const out = [];
  const start = sec.rawOff, end = sec.rawOff + sec.rawSize;
  for (let p = start; p < end; p++) {
    const b = buf[p];
    let rel = null, len = 0, mnem = null;
    if ((b === 0x75 || b === 0x72 || b === 0x76 || b === 0x73) && p + 1 < end) {
      rel = (buf[p + 1] << 24) >> 24; len = 2;
      mnem = b === 0x75 ? 'jnz' : b === 0x72 ? 'jb' : b === 0x76 ? 'jbe' : 'jnb';
    } else if (b === 0x0f && p + 5 < end &&
               (buf[p + 1] === 0x85 || buf[p + 1] === 0x82)) {
      rel = buf.readInt32LE(p + 2); len = 6;
      mnem = buf[p + 1] === 0x85 ? 'jnz' : 'jb';
    }
    if (rel === null || rel >= 0 || rel < -MAX_SPAN) continue;
    const tailVa = sec.va + (p - sec.rawOff);
    out.push({ tailVa, headVa: tailVa + len + rel, mnem, len });
  }
  return out;
}

function classify(insns) {
  // insns: [{va, text}] from head to the back edge inclusive.
  const tail = insns[insns.length - 1];
  const body = insns.slice(0, -1);
  const lo = insns[0].va, hi = tail.va;

  let intraBranch = 0, keyTests = 0, counter = null, lutSize = 0;
  let lutIndexReg = null, lutTableReg = null, lutDstReg = null;
  let storeBase = null, storeReg = null, srcBase = null;
  const advanced = new Set();
  const luts = [];
  // Which register each byte/word load came out of, so a table index can be
  // traced back to the source stream or to the destination pixel.
  const loadedFrom = new Map();

  for (const { text } of body) {
    let m;
    if ((m = text.match(/^j\w+ (?:short )?0x([0-9a-f]+)$/))) {
      const t = parseInt(m[1], 16);
      if (t > lo && t <= hi) intraBranch++;
      continue;
    }
    // `cmp byte [esi], 0xff` -- the key test in its memory-immediate form.
    if ((m = text.match(/^cmp (?:byte|word) \[([a-z]{3})[^\]]*\], 0x[0-9a-f]+$/))) {
      keyTests++; continue;
    }
    // `mov al,[esi]` / `cmp al, 0xff` -- the same test in two instructions.
    if ((m = text.match(/^cmp ([a-z]{2}), 0x[0-9a-f]+$/)) && R8.has(m[1])) {
      if (loadedFrom.has(m[1])) keyTests++;
      continue;
    }
    // `or al,al` / `test al,al` -- the key test against ZERO, which is how a
    // blitter whose transparent index is 0 writes it. No immediate appears in
    // the encoding at all, so the two `cmp ..., imm` patterns above cannot see
    // it, and a loop keyed on 0 read as unkeyed. StarCraft's dominant sprite
    // blitter is this shape.
    if ((m = text.match(/^(?:or|test) ([a-z]{2}), ([a-z]{2})$/))
        && m[1] === m[2] && (R8.has(m[1]) || R16.has(m[1]))) {
      if (loadedFrom.has(m[1])) keyTests++;
      continue;
    }
    if ((m = text.match(/^dec (e[a-z]{2})$/))) { counter = m[1]; continue; }
    if ((m = text.match(/^sub (e[a-z]{2}), 0x1$/))) { counter = m[1]; continue; }
    // A scaled table load: `mov bx, [ecx+eax*2]` or `mov al, [eax+ecx]`.
    if ((m = text.match(/^mov ([a-z]{2}), \[([a-z]{3})\+([a-z]{3})(?:\*([124]))?(?:[+-]0x[0-9a-f]+)?\]$/))) {
      const [, dst, a, b2, scale] = m;
      const size = R16.has(dst) ? 16 : R8.has(dst) ? 8 : 0;
      const want = size === 16 ? '2' : undefined;
      if (size && (scale === want || (size === 8 && !scale))) {
        // With a scale the encoding names the index directly. Without one
        // (`[eax+ecx]`), the index is whichever operand a byte was loaded into.
        const idx = scale ? b2
          : [a, b2].find(r => [...loadedFrom.keys()].some(k => parentOf(k) === r));
        if (idx) {
          lutSize = size;
          lutIndexReg = idx;
          lutDstReg = dst;
          lutTableReg = idx === a ? b2 : a;
          let from = null;
          for (const [reg, base] of loadedFrom) if (parentOf(reg) === idx) from = base;
          luts.push({ size, index: idx, table: lutTableReg, dst, from });
        }
      }
      continue;
    }
    // A plain load out of a stream: `mov al,[esi]`, `mov bx,[edi]`.
    if ((m = text.match(/^mov ([a-z]{2}), \[([a-z]{3})[^\]]*\]$/))) {
      if (R8.has(m[1]) || R16.has(m[1])) {
        loadedFrom.set(m[1], m[2]);
        if (!srcBase) srcBase = m[2];
      }
      continue;
    }
    // The store: `mov [edi], bx`.
    if ((m = text.match(/^mov \[([a-z]{3})[^\]]*\], ([a-z]{2})$/))) {
      if (R8.has(m[2]) || R16.has(m[2])) { storeBase = m[1]; storeReg = m[2]; }
      continue;
    }
    // Stream advance: `inc esi`, `add edi, 0x2`.
    if ((m = text.match(/^(?:inc|add|sub) (?:dword |word |byte )?(e[a-z]{2})(?:, 0x[0-9a-f]+)?$/))) {
      advanced.add(m[1]); continue;
    }
  }

  // The stored value must be the value the table produced, and the destination
  // stream must actually move -- without both, a loop that merely contains a
  // scaled load and an unrelated store reads as a blit.
  if (!storeBase || !counter) return null;
  if (!advanced.has(storeBase)) return null;

  // A keyed blit does not have to go through a table. The plainest form loads
  // a byte, tests it against the key, and stores THAT SAME BYTE -- a masked
  // copy rather than a remap. Requiring a table made this whole family
  // invisible, and it is not a rare one: it is the single hottest loop in
  // StarCraft (0x004c7a68, 24.6M block entries, 10.8% of the route's), and
  // src/07b-loop-match.wat already carries a hand-written fold for its
  // dest-keyed mirror (Alpha Centauri, $try_emit_colorkey8_run). The self-loop
  // matcher cannot see either, because the conditional store splits the body
  // into two blocks and Design A only ever matches a block that branches to
  // itself.
  if (!lutSize) {
    if (!keyTests) return null;                       // an unkeyed copy is not this
    // The key test must branch BACK INTO the loop, i.e. skip the store and
    // keep going. Without this the family swallows strncpy/strcpy, which is
    // the same load-test-store-advance shape and differs only in that its
    // test EXITS: msvcrt.dll scored 14 "keyed blits" before this line, and
    // every one was a string routine.
    if (!intraBranch) return null;
    if (!storeReg || !loadedFrom.has(storeReg)) return null;
    const from = loadedFrom.get(storeReg);            // where the stored byte came from
    if (!advanced.has(from)) return null;             // the source must stream too
    const size = R16.has(storeReg) ? 16 : 8;
    const dst = from === storeBase;
    return {
      cls: `CK_COPY${size}_${dst ? 'DST' : 'SRC'}`,
      keyTests, intraBranch, lutSize: 0, dest: dst, dstArm: false, arms: 0,
      table: '-', index: '-', store: storeBase, counter,
      insns: body.length + 1,
    };
  }

  if (storeReg !== lutDstReg) return null;
  if (tail.text.startsWith('jnz') && !counter) return null;

  // Dest-indexed when the index register's byte/word came out of the same base
  // the store writes to -- `dst = shadow_tbl[dst]`.
  let indexSrc = null;
  for (const [reg, base] of loadedFrom) {
    if (parentOf(reg) === lutIndexReg) indexSrc = base;
  }
  // A loop can carry both arms -- SimGolf's shadow blitter looks up the
  // destination pixel for one token and the source byte for another -- so
  // report the dest-indexed arm separately from the class.
  const dest = !!(indexSrc && indexSrc === storeBase);
  const dstArm = luts.some(l => l.from && l.from === storeBase);
  const cls = `CK_LUT${lutSize}_${dest || dstArm ? 'DST' : 'SRC'}`;
  return {
    cls: keyTests ? cls : `LUT${lutSize}_NOKEY`,
    keyTests, intraBranch, lutSize, dest, dstArm, arms: luts.length,
    table: lutTableReg, index: lutIndexReg, store: storeBase, counter,
    insns: body.length + 1,
  };
}

const summary = [];
for (const file of files) {
  let pe;
  try { pe = readPE(file); } catch (e) { continue; }   // 16-bit NE and friends
  const found = [];
  const seen = new Set();
  for (const sec of pe.sections) {
    if (!sec.isCode || !sec.rawSize) continue;
    for (const edge of backEdges(pe.buf, sec, pe.va2off)) {
      if (seen.has(edge.headVa)) continue;
      const off = pe.va2off(edge.headVa);
      if (off < 0) continue;
      const span = edge.tailVa - edge.headVa + edge.len;
      const lines = disasmAt(pe.buf, off, edge.headVa, span, null, { linear: true })
        .map(parseLine);
      const cut = [];
      let landed = false;
      for (const insn of lines) {
        if (insn.va > edge.tailVa) break;
        cut.push(insn);
        if (insn.va === edge.tailVa) { landed = true; break; }
      }
      // A head that is mid-instruction decodes past its own back edge.
      if (!landed || cut.length < 4) continue;
      if (!cut[cut.length - 1].text.startsWith(edge.mnem)) continue;
      const hit = classify(cut);
      if (!hit) continue;
      if (ONLY.length && !ONLY.includes(hit.cls)) continue;
      seen.add(edge.headVa);
      // One loop, one back edge: an enclosing row loop re-matches the same
      // body from an earlier head, so keep the innermost head per tail.
      const prior = found.findIndex(f => f.tail === edge.tailVa);
      const row = { va: edge.headVa, tail: edge.tailVa, term: edge.mnem, ...hit };
      if (prior >= 0) { if (edge.headVa > found[prior].va) found[prior] = row; }
      else found.push(row);
    }
  }
  const byClass = {};
  for (const f of found) byClass[f.cls] = (byClass[f.cls] || 0) + 1;
  summary.push({ file: path.basename(file), total: found.length, byClass, found });
}

if (JSON_OUT) {
  console.log(JSON.stringify(summary.map(s => DETAIL ? s : { ...s, found: undefined }), null, 2));
} else {
  const classes = [...new Set(summary.flatMap(s => Object.keys(s.byClass)))].sort();
  const hits = summary.filter(s => s.total);
  console.log(`${files.length} file(s) read, ${hits.length} with at least one keyed/LUT loop`);
  console.log('');
  console.log('binary'.padEnd(34) + classes.map(c => c.padStart(16)).join(''));
  console.log('-'.repeat(34 + classes.length * 16));
  for (const s of hits.sort((a, b) => b.total - a.total)) {
    console.log(s.file.padEnd(34) +
      classes.map(c => String(s.byClass[c] || 0).padStart(16)).join(''));
  }
  const totals = {};
  for (const s of summary) for (const [c, n] of Object.entries(s.byClass)) totals[c] = (totals[c] || 0) + n;
  console.log('-'.repeat(34 + classes.length * 16));
  console.log('total'.padEnd(34) + classes.map(c => String(totals[c] || 0).padStart(16)).join(''));
  if (DETAIL) {
    for (const s of hits) {
      console.log('');
      console.log(`${s.file}:`);
      for (const f of s.found) {
        console.log(`  0x${f.va.toString(16)}  ${f.cls.padEnd(14)} ${f.insns} insns, ` +
          `${f.keyTests} key test(s), ${f.intraBranch} intra-branch(es), ` +
          `table=${f.table} index=${f.index} store=[${f.store}] ctr=${f.counter} term=${f.term}`);
      }
    }
  }
}
