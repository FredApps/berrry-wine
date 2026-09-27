#!/usr/bin/env node
// tools/uop-engine-bench.js — phase 0 of docs/uop-tier-design.md.
//
//   node tools/uop-engine-bench.js [--shapes=lut,ckey,h3shadow] [--bytes=4m] [--reps=9]
//
// WHAT IT ANSWERS: what is the toyvm-style engine ($uop_run, 07d-uop-engine.wat)
// worth on a loop, before any compiler exists? Each shape is one x86 loop plus
// the micro-op program an optimizer is expected to emit for it, written by
// hand here. The arms run the SAME work in one process, alternating every rep
// with the order rotated (bench-loops.js's method):
//
//   threaded     the interpreter with every loop fold and the block executor off
//   folds        the interpreter as it ships (LUT_RUN etc. on)
//   blockexec    the H458 block executor armed, folds off
//   uop          $uop_run over the hand-lowered program
//
// Every rep of every arm is checked against the threaded arm: all eight
// registers, CF/ZF/SF/OF, EIP, and a hash of the destination buffer. A faster
// wrong answer is the failure this exists to refuse.
//
// WHAT IT DOES NOT ANSWER: whether a real lowering reaches these programs (that
// is phase 1), and anything about branch prediction on real code -- these
// loops are periodic. Deopt stubs here only EXIT; the bench asserts no guard
// ever fails, because phase 0 prices the fast path.
'use strict';
const path = require('path');
const BL = require('./bench-loops');

const args = Object.fromEntries(process.argv.slice(2).map(s => {
  const m = s.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [s, true];
}));
const parseBytes = (s) => {
  const m = String(s).match(/^(\d+)([kmKM]?)$/);
  if (!m) throw new Error(`bad --bytes ${s}`);
  return Number(m[1]) * ({ k: 1024, m: 1 << 20 }[m[2].toLowerCase()] || 1);
};
const BYTES = parseBytes(args.bytes || '4m');
const REPS = Number(args.reps || 9);

// ---------------------------------------------------------------------------
// Program assembler. Operand words are ABSOLUTE wasm addresses: a vreg is its
// cell, a window its 16-byte slot, a target the word index resolved to an
// address at link time.
const OP = {
  EXIT: 0, MOVI: 1, MOV: 2, ADD: 3, SUB: 4, AND: 5, OR: 6, XOR: 7, ADDI: 8,
  ANDI: 9, SHLI: 10, SHRI: 11, SARI: 12, LD32: 13, LD8U: 14, LD8UX: 15,
  LD16UX2: 16, ST32: 17, ST8: 18, ST16: 19, MERGE8L: 20, BNEZ: 21, BEQZ: 22,
  BNE: 23, BLTU: 24, JMP: 25, GUARD: 26, CLOCK: 27, REC: 28, LD16U: 29,
  BGEU: 30, SAVECF: 31,
};
const FLAG = { ADD: 1, SUB: 2, LOGIC: 3, INC: 4, DEC: 5 };

function assembler(arena, regBase) {
  const words = []; const labels = {}; const fix = [];
  const R = (i) => regBase + 4 * i;                 // guest register cell
  const T = (i) => arena + 0xC000 + 4 * i;          // temp vreg
  const W = (i) => arena + 0xC400 + 16 * i;         // window slot
  const L = (name) => ({ label: name });
  const emit = (op, ...ops) => {
    words.push(OP[op]);
    for (const o of ops) {
      if (o && typeof o === 'object') { fix.push([words.length, o.label]); words.push(0); }
      else words.push(o | 0);
    }
  };
  const label = (name) => { labels[name] = words.length; };
  const link = (mem) => {
    for (const [at, name] of fix) {
      if (!(name in labels)) throw new Error(`undefined label ${name}`);
      words[at] = arena + 4 * labels[name];
    }
    new Int32Array(mem.buffer, arena, words.length).set(words);
    return arena;                                   // entry = word 0
  };
  return { R, T, W, L, emit, label, link, words };
}
const [EAX, ECX, EDX, EBX, ESP, EBP, ESI, EDI] = [0, 1, 2, 3, 4, 5, 6, 7];

// ---------------------------------------------------------------------------
// Shapes: x86 bytes, data setup, and the hand-lowered program. `x86Insns` is
// per iteration, so every arm is reported in ns per guest instruction.
const SHAPES = {
  lut: {
    describe: 'dst[i] = lut[src[i]]  (Heroes II ICN blit; LUT_RUN folds it)',
    x86Insns: 7,
    code: BL.loopBack([0x0F, 0xB6, 0x06, 0x8A, 0x04, 0x03, 0x88, 0x07, 0x46, 0x47]),
    data(a) { return { n: Math.floor(a.bufBytes / 2), src: a.buf, dst: a.buf + Math.floor(a.bufBytes / 2), lut: a.lut }; },
    setup(e, mem, g2w, d) {
      for (let i = 0; i < 256; i++) mem[g2w(d.lut) + i] = (i * 7 + 13) & 0xFF;
      for (let i = 0; i < d.n; i++) mem[g2w(d.src) + i] = (i * 31 + (i >> 9)) & 0xFF;
      mem.fill(0, g2w(d.dst), g2w(d.dst) + d.n);
      e.set_esi(d.src); e.set_edi(d.dst); e.set_ebx(d.lut); e.set_ecx(d.n); e.set_eax(0);
    },
    out(d) { return [d.dst, d.n]; },
    lower(A) {
      const { R, T, W, L, emit, label } = A;
      emit('SAVECF');
      emit('MOVI', T(9), 1);
      emit('GUARD', W(0), R(ESI), 0, 1, 0, L('bail'));
      emit('GUARD', W(1), R(EBX), 0, 256, 0, L('bail'));
      emit('GUARD', W(2), R(EDI), 0, 1, 1, L('bail'));
      label('top');
      emit('LD8U', R(EAX), R(ESI), 0, W(0), L('bail'));        // movzx eax,[esi]
      emit('LD8UX', T(0), R(EBX), R(EAX), 0, W(1), L('bail')); // mov al,[ebx+eax]
      emit('MERGE8L', R(EAX), R(EAX), T(0));
      emit('ST8', R(EAX), R(EDI), 0, W(2), L('bail'));         // mov [edi],al
      emit('ADDI', R(ESI), R(ESI), 1);
      emit('ADDI', R(EDI), R(EDI), 1);
      emit('ADDI', R(ECX), R(ECX), -1);
      emit('CLOCK', 1, L('bail'));
      emit('BNEZ', R(ECX), L('top'));
      emit('REC', FLAG.DEC, T(9), T(9), R(ECX), 31);           // dec ecx: 1 -> 0
      emit('ADDI', R(ESP), R(ESP), 4);                        // ret to the 0 sentinel
      emit('EXIT', 0);
      label('bail'); emit('EXIT', 0xBAD);
    },
  },

  ckey: {
    describe: 'if (src[i]) dst[i] = src[i]  (colour-key copy: a DIAMOND the loop matcher cannot see)',
    x86Insns: 7.67,     // 8 on a copied pixel, 7 on a skipped one; 1 in 3 skip
    code: BL.loopBack([0x8A, 0x06, 0x84, 0xC0, 0x74, 0x02, 0x88, 0x07, 0x46, 0x47]),
    data(a) { return { n: Math.floor(a.bufBytes / 2), src: a.buf, dst: a.buf + Math.floor(a.bufBytes / 2) }; },
    setup(e, mem, g2w, d) {
      for (let i = 0; i < d.n; i++) mem[g2w(d.src) + i] = i % 3 === 0 ? 0 : ((i * 13 + 1) & 0x7F) | 1;
      mem.fill(0xEE, g2w(d.dst), g2w(d.dst) + d.n);
      e.set_esi(d.src); e.set_edi(d.dst); e.set_ecx(d.n); e.set_eax(0x12345600);
    },
    out(d) { return [d.dst, d.n]; },
    lower(A) {
      const { R, T, W, L, emit, label } = A;
      emit('SAVECF');
      emit('MOVI', T(9), 1);
      emit('GUARD', W(0), R(ESI), 0, 1, 0, L('bail'));
      emit('GUARD', W(2), R(EDI), 0, 1, 1, L('bail'));
      label('top');
      emit('LD8U', T(0), R(ESI), 0, W(0), L('bail'));          // mov al,[esi]
      emit('MERGE8L', R(EAX), R(EAX), T(0));
      emit('BEQZ', T(0), L('skip'));                           // test al,al / jz
      emit('ST8', R(EAX), R(EDI), 0, W(2), L('bail'));         // mov [edi],al
      label('skip');
      emit('ADDI', R(ESI), R(ESI), 1);
      emit('ADDI', R(EDI), R(EDI), 1);
      emit('ADDI', R(ECX), R(ECX), -1);
      emit('CLOCK', 1, L('bail'));
      emit('BNEZ', R(ECX), L('top'));
      // Exit flags: TEST cleared CF, DEC kept it, DEC wrote the rest.
      emit('REC', FLAG.LOGIC, T(9), T(9), T(9), 31);
      emit('SAVECF');
      emit('REC', FLAG.DEC, T(9), T(9), R(ECX), 31);
      emit('ADDI', R(ESP), R(ESP), 4);
      emit('EXIT', 0);
      label('bail'); emit('EXIT', 0xBAD);
    },
  },

  h3shadow: {
    describe: 'Heroes III 0x471da6: dst16[i] = (dst16[i] >> 1) & [mask]  (16-bit ops, abs load)',
    x86Insns: 8,
    code: null,         // needs the mask address; built in data()
    data(a) {
      const n = Math.floor(a.bufBytes / 2), dst = a.buf, mask = a.lut;
      const m = [mask & 0xFF, (mask >>> 8) & 0xFF, (mask >>> 16) & 0xFF, mask >>> 24];
      const body = [
        0x33, 0xED,                   // xor ebp, ebp
        0x66, 0x8B, 0x2F,             // mov bp, [edi]
        0x66, 0xD1, 0xED,             // shr bp, 1
        0x83, 0xC7, 0x02,             // add edi, 2
        0x23, 0x2D, ...m,             // and ebp, [mask]
        0x48,                         // dec eax
        0x66, 0x89, 0x6F, 0xFE,       // mov [edi-2], bp
      ];
      const code = body.concat([0x75, (-(body.length + 2)) & 0xFF]);   // jnz top
      return { n, dst, mask, code };
    },
    setup(e, mem, g2w, d) {
      new DataView(mem.buffer).setUint32(g2w(d.mask), 0x7BEF, true);
      const dv = new DataView(mem.buffer, g2w(d.dst), d.n * 2);
      for (let i = 0; i < d.n; i++) dv.setUint16(i * 2, (i * 2654435761) >>> 16, true);
      e.set_edi(d.dst); e.set_eax(d.n); e.set_ebp(0xDEAD0000);
    },
    out(d) { return [d.dst, d.n * 2]; },
    lower(A) {
      const { R, T, W, L, emit, label } = A;
      emit('SAVECF');
      emit('MOVI', T(9), 1);
      emit('MOVI', T(8), 0);
      emit('GUARD', W(1), T(8), A.d.mask, 4, 0, L('bail'));
      emit('GUARD', W(2), R(EDI), 0, 2, 1, L('bail'));
      label('top');
      emit('LD16U', R(EBP), R(EDI), 0, W(2), L('bail'));       // xor ebp,ebp + mov bp,[edi]
      emit('SHRI', R(EBP), R(EBP), 1);                         // shr bp,1
      emit('ADDI', R(EDI), R(EDI), 2);                         // add edi,2
      emit('LD32', T(0), T(8), A.d.mask, W(1), L('bail'));     // and ebp,[mask]
      emit('AND', R(EBP), R(EBP), T(0));
      emit('ADDI', R(EAX), R(EAX), -1);                        // dec eax
      emit('ST16', R(EBP), R(EDI), -2, W(2), L('bail'));       // mov [edi-2],bp
      emit('CLOCK', 1, L('bail'));
      emit('BNEZ', R(EAX), L('top'));
      emit('REC', FLAG.LOGIC, T(9), T(9), T(9), 31);           // AND cleared CF
      emit('SAVECF');
      emit('REC', FLAG.DEC, T(9), T(9), R(EAX), 31);
      emit('ADDI', R(ESP), R(ESP), 4);
      emit('EXIT', 0);
      label('bail'); emit('EXIT', 0xBAD);
    },
  },
};

// ---------------------------------------------------------------------------
const REGS = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
function snapshot(e, mem, g2w, d, shape) {
  const [at, len] = shape.out(d);
  const bytes = mem.subarray(g2w(at), g2w(at) + len);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  return { regs: REGS.map(r => e['get_' + r]() >>> 0), flags: e.uop_flags(), eip: e.get_eip() >>> 0, hash: h >>> 0 };
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

const ARMS = ['threaded', 'folds', 'blockexec', 'uop'];
function arm(e, name) {
  const lut = name === 'folds' ? 1 : 0;
  if (e.set_loop_lut_emit) e.set_loop_lut_emit(lut);
  if (e.set_block_exec) e.set_block_exec(name === 'blockexec' ? 1 : 0);
}

async function main() {
  BL.ensureBuilt();
  const inst = await BL.newInstance();
  const { e, mem, g2w, imageBase } = inst;
  const want = (args.shapes ? String(args.shapes).split(',') : Object.keys(SHAPES));
  // One counter across shapes: JS writes code bytes without invalidating, so
  // a second shape at an address the first one decoded would run the first
  // shape's cached block.
  let codeRep = 0;
  console.log(`uop-engine-bench: ${BYTES} bytes, ${REPS} reps, arms ${ARMS.join('/')}`);
  for (const name of want) {
    const shape = SHAPES[name];
    if (!shape) throw new Error(`unknown shape ${name}; have ${Object.keys(SHAPES).join(',')}`);
    const a = BL.layout(imageBase, BYTES);
    const d = shape.data(a);
    const code = (shape.code || d.code).concat([0xC3]);
    const times = Object.fromEntries(ARMS.map(k => [k, []]));
    let ref = null;
    for (let rep = 0; rep < REPS; rep++) {
      const order = ARMS.map((_, i) => ARMS[(i + rep) % ARMS.length]);
      for (const which of order) {
        shape.setup(e, mem, g2w, d);
        e.set_esp(a.stackTop);
        new DataView(mem.buffer).setUint32(g2w(a.stackTop), 0, true);
        let ns;
        if (which === 'uop') {
          const A = assembler(e.uop_arena(), e.uop_reg_base());
          A.d = d;
          shape.lower(A);
          const entry = A.link(mem);
          const t0 = process.hrtime.bigint();
          e.uop_run(entry, 0x7FFFFFFF);
          ns = Number(process.hrtime.bigint() - t0);
          if ((e.get_eip() >>> 0) === 0xBAD) throw new Error(`${name}: uop program took a bail exit`);
        } else {
          arm(e, which);
          const at = a.code + (codeRep++) * 0x1000;       // fresh decode every run
          mem.set(code, g2w(at));
          const t0 = process.hrtime.bigint();
          if (!BL.runToCompletion(e, at, a.stackTop)) throw new Error(`${name}/${which}: did not return`);
          ns = Number(process.hrtime.bigint() - t0);
        }
        const snap = snapshot(e, mem, g2w, d, shape);
        if (!ref) ref = snap;
        else if (!same(ref, snap)) {
          throw new Error(`${name}/${which} rep ${rep}: state differs\n  ref ${JSON.stringify(ref)}\n  got ${JSON.stringify(snap)}`);
        }
        if (rep > 0) times[which].push(ns);               // rep 0 warms the JIT
      }
    }
    arm(e, 'folds');
    const med = (xs) => { const s = [...xs].sort((p, q) => p - q); return s[s.length >> 1]; };
    const iters = d.n;
    console.log(`\n${name}: ${shape.describe}`);
    console.log(`  ${iters} iterations x ${shape.x86Insns} x86 insns; state identical across all arms, every rep`);
    const base = med(times.threaded);
    for (const k of ARMS) {
      const m = med(times[k]);
      const perInsn = m / (iters * shape.x86Insns);
      const spread = (Math.max(...times[k]) - Math.min(...times[k])) / m * 100;
      console.log(`  ${k.padEnd(10)} ${(m / 1e6).toFixed(2).padStart(8)} ms  ${perInsn.toFixed(3)} ns/insn` +
        `  x${(base / m).toFixed(2)} vs threaded  (spread ${spread.toFixed(0)}%)`);
    }
    console.log(`  uop re-guards ${e.uop_stats(1)}  guard fails ${e.uop_stats(0)}`);
  }
}
main().catch(err => { console.error(err.stack || String(err)); process.exit(1); });
