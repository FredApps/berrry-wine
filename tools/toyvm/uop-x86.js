'use strict';

// A structured x86 decoder for the micro-op lowering (tools/toyvm/uop-ir.js).
//
// decode.js turns an instruction into threaded-code WORDS: a handler index and
// packed operands, the shape the interpreter runs. That is the wrong input for
// an optimizer -- a handler name hides which register it reads behind an
// operand word, and a fused or traced twin hides which instructions it stands
// for. The lowering wants the instruction itself: an operation, a width, and
// operands that say "register 6" or "[ss: bp + si + 4]".
//
// So this decodes a deliberately small, common subset into plain objects and
// returns `{ kind: 'unsupported' }` for everything else. An unsupported
// instruction is not an error: the lowering ends the program there with an
// exit to the interpreter, which then runs it. The subset is what hot inner
// loops are made of -- moves, ALU ops, shifts, lea, push/pop, the branches and
// the single (unrepeated) string ops.
//
// Operand objects:
//   { t: 'r', r, w }     general register r (x86 encoding order), width w.
//                        For w = 8, r is the 8-bit encoding (0-3 = AL..BL,
//                        4-7 = AH..BH).
//   { t: 'm', seg, base, index, scale, disp, a32, w }
//                        base/index are register numbers or -1. 16-bit forms
//                        use base/index too (bx+si = base 3, index 6) and are
//                        wrapped to 64K by the lowering, exactly as $ea does.
//   { t: 'i', v, w }     an immediate, already sign-extended to w bits and
//                        masked to them.

const SEG_PREFIX = { 0x26: 0, 0x2E: 1, 0x36: 2, 0x3E: 3, 0x64: 4, 0x65: 5 };
const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
const SHIFTS = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'sal', 'sar'];
// 16-bit ModRM rm -> [base, index] (-1 = none) and default segment.
const EA16 = [[3, 6], [3, 7], [5, 6], [5, 7], [6, -1], [7, -1], [5, -1], [3, -1]];
const EA16_SEG = [3, 3, 2, 2, 3, 3, 2, 3];

const MASK = { 8: 0xFF, 16: 0xFFFF, 32: 0xFFFFFFFF };
const wmask = (v, w) => (w === 32 ? v >>> 0 : v & MASK[w]);

// `rd(lin)` reads one byte of guest memory. `base`/`mask` locate CS the way the
// interpreter's decoder does; `ip32` says whether EIP is a full 32-bit offset.
function decodeInsn(rd, base, mask, ip, d32, ip32 = d32) {
  const wip = ip32 ? (v) => v >>> 0 : (v) => v & 0xFFFF;
  let n = 0;
  const at = (k) => rd((base + wip(ip + k)) & mask);
  let seg = null, rep = null;
  let opsize = d32 ? 32 : 16, asize = d32 ? 32 : 16;
  for (;;) {
    const b = at(n);
    if (SEG_PREFIX[b] !== undefined) seg = SEG_PREFIX[b];
    else if (b === 0x66) opsize = d32 ? 16 : 32;
    else if (b === 0x67) asize = d32 ? 16 : 32;
    else if (b === 0xF3) rep = 'rep';
    else if (b === 0xF2) rep = 'repne';
    else if (b === 0xF0) { /* lock */ }
    else break;
    n++;
    if (n > 8) return bad('prefixes');
  }
  const u8 = () => at(n++);
  const s8 = () => { const v = at(n++); return v & 0x80 ? v - 0x100 : v; };
  const u16 = () => { const v = at(n) | (at(n + 1) << 8); n += 2; return v; };
  const i32 = () => { const v = at(n) | (at(n + 1) << 8) | (at(n + 2) << 16) | (at(n + 3) << 24); n += 4; return v | 0; };
  const imm = (w) => (w === 8 ? u8() : w === 16 ? u16() : i32() >>> 0);
  const simm8 = (w) => wmask(s8(), w);

  function bad(why) { return { kind: 'unsupported', why, ip, len: n, next: wip(ip + n) }; }

  function modrm(w) {
    const m = u8();
    const mod = m >> 6, reg = (m >> 3) & 7, rm = m & 7;
    if (mod === 3) return { reg, rm: { t: 'r', r: rm, w } };
    if (asize === 32) {
      let b = rm, index = -1, scale = 0;
      if (rm === 4) {
        const sib = u8();
        scale = sib >> 6; const ix = (sib >> 3) & 7; b = sib & 7;
        index = ix === 4 ? -1 : ix;
      }
      let disp = 0, baseReg = b;
      if (b === 5 && mod === 0) { baseReg = -1; disp = i32(); }
      else if (mod === 1) disp = s8();
      else if (mod === 2) disp = i32();
      const stack = baseReg === 4 || baseReg === 5;
      return { reg, rm: { t: 'm', seg: seg === null ? (stack ? 2 : 3) : seg,
        base: baseReg, index, scale, disp: disp | 0, a32: true, w } };
    }
    let disp = 0, pair = EA16[rm], dseg = EA16_SEG[rm];
    if (mod === 0 && rm === 6) { pair = [-1, -1]; dseg = 3; disp = u16(); }
    else if (mod === 1) disp = s8() & 0xFFFF;
    else if (mod === 2) disp = u16();
    return { reg, rm: { t: 'm', seg: seg === null ? dseg : seg,
      base: pair[0], index: pair[1], scale: 0, disp, a32: false, w } };
  }
  const R = (r, w) => ({ t: 'r', r, w });
  const I = (v, w) => ({ t: 'i', v: wmask(v, w), w });

  const done = (o) => Object.assign(o, { ip, len: n, next: wip(ip + n), opsize, asize, rep });
  const rel = (d) => wip(ip + n + d);

  const op = u8();
  const w0 = (op & 1) ? opsize : 8;

  // ALU block 00-3F, forms 0-5.
  if (op < 0x40 && (op & 7) < 6) {
    const alu = ALU[op >> 3], form = op & 7;
    rep = null;
    if (form < 4) {
      const w = (form & 1) ? opsize : 8;
      const m = modrm(w);
      const r = R(m.reg, w);
      const [dst, src] = (form & 2) ? [r, m.rm] : [m.rm, r];
      return done({ kind: 'alu', alu, w, dst, src });
    }
    const w = form === 4 ? 8 : opsize;
    return done({ kind: 'alu', alu, w, dst: R(0, w), src: I(imm(w), w) });
  }
  if (rep && !(op >= 0xA4 && op <= 0xAF)) {
    rep = null;   // ignored on non-string ops from the 386 on (decode.js)
  }
  if (op >= 0x40 && op <= 0x4F) {
    return done({ kind: 'incdec', dec: op >= 0x48, w: opsize, dst: R(op & 7, opsize) });
  }
  if (op >= 0x50 && op <= 0x57) return done({ kind: 'push', w: opsize, src: R(op & 7, opsize) });
  if (op >= 0x58 && op <= 0x5F) return done({ kind: 'pop', w: opsize, dst: R(op & 7, opsize) });
  if (op === 0x68) return done({ kind: 'push', w: opsize, src: I(imm(opsize), opsize) });
  if (op === 0x6A) return done({ kind: 'push', w: opsize, src: I(s8(), opsize) });
  if (op === 0x69 || op === 0x6B) {
    const m = modrm(opsize);
    const v = op === 0x69 ? imm(opsize) : s8();
    return done({ kind: 'imul3', w: opsize, dst: R(m.reg, opsize), src: m.rm, imm: I(v, opsize) });
  }
  if (op >= 0x70 && op <= 0x7F) {
    const d = s8();
    return done({ kind: 'jcc', cc: op & 15, target: rel(d) });
  }
  if (op >= 0x80 && op <= 0x83) {
    const w = op === 0x81 || op === 0x83 ? opsize : 8;
    const m = modrm(w);
    const v = op === 0x81 ? imm(w) : (op === 0x83 ? simm8(w) : u8());
    return done({ kind: 'alu', alu: ALU[m.reg], w, dst: m.rm, src: I(v, w) });
  }
  if (op === 0x84 || op === 0x85) {
    const m = modrm(w0);
    return done({ kind: 'test', w: w0, dst: m.rm, src: R(m.reg, w0) });
  }
  if (op === 0x86 || op === 0x87) {
    const m = modrm(w0);
    return done({ kind: 'xchg', w: w0, dst: m.rm, src: R(m.reg, w0) });
  }
  if (op >= 0x88 && op <= 0x8B) {
    const m = modrm(w0);
    const r = R(m.reg, w0);
    return done((op & 2) ? { kind: 'mov', w: w0, dst: r, src: m.rm }
      : { kind: 'mov', w: w0, dst: m.rm, src: r });
  }
  if (op === 0x8D) {
    const m = modrm(opsize);
    if (m.rm.t !== 'm') return bad('lea reg');
    return done({ kind: 'lea', w: opsize, dst: R(m.reg, opsize), src: m.rm });
  }
  if (op === 0x90) return done({ kind: 'nop' });
  if (op >= 0x91 && op <= 0x97) {
    return done({ kind: 'xchg', w: opsize, dst: R(0, opsize), src: R(op & 7, opsize) });
  }
  if (op === 0x98) return done({ kind: 'cbw', w: opsize });
  if (op === 0x99) return done({ kind: 'cwd', w: opsize });
  if (op >= 0xA0 && op <= 0xA3) {
    const w = (op & 1) ? opsize : 8;
    const disp = asize === 32 ? i32() : u16();
    const m = { t: 'm', seg: seg === null ? 3 : seg, base: -1, index: -1, scale: 0,
      disp: asize === 32 ? disp | 0 : disp, a32: asize === 32, w };
    return done(op < 0xA2 ? { kind: 'mov', w, dst: R(0, w), src: m }
      : { kind: 'mov', w, dst: m, src: R(0, w) });
  }
  if (op === 0xA8 || op === 0xA9) {
    const w = op === 0xA8 ? 8 : opsize;
    return done({ kind: 'test', w, dst: R(0, w), src: I(imm(w), w) });
  }
  if (op === 0xA4 || op === 0xA5 || op === 0xAA || op === 0xAB || op === 0xAC || op === 0xAD) {
    const w = (op & 1) ? opsize : 8;
    const kind = op < 0xA8 ? 'movs' : (op < 0xAC ? 'stos' : 'lods');
    return done({ kind, w, seg: seg === null ? 3 : seg, a32: asize === 32 });
  }
  if (op >= 0xB0 && op <= 0xB7) return done({ kind: 'mov', w: 8, dst: R(op & 7, 8), src: I(u8(), 8) });
  if (op >= 0xB8 && op <= 0xBF) {
    return done({ kind: 'mov', w: opsize, dst: R(op & 7, opsize), src: I(imm(opsize), opsize) });
  }
  if (op === 0xC0 || op === 0xC1 || (op >= 0xD0 && op <= 0xD3)) {
    const w = (op & 1) ? opsize : 8;
    const m = modrm(w);
    let count;
    if (op === 0xC0 || op === 0xC1) count = I(u8(), 8);
    else if (op === 0xD0 || op === 0xD1) count = I(1, 8);
    else count = R(1, 8);   // CL
    const sh = SHIFTS[m.reg];
    if (sh === 'sal' || sh === 'rcl' || sh === 'rcr') return bad(`shift ${sh}`);
    return done({ kind: 'shift', sh, w, dst: m.rm, count });
  }
  if (op === 0xC6 || op === 0xC7) {
    const m = modrm(w0);
    if (m.reg !== 0) return bad('c6/c7 reg');
    return done({ kind: 'mov', w: w0, dst: m.rm, src: I(imm(w0), w0) });
  }
  if (op === 0xE8) {
    const d = opsize === 32 ? i32() : (u16() << 16) >> 16;
    return done({ kind: 'call', w: opsize, target: rel(d) });
  }
  if (op === 0xC3) return done({ kind: 'ret', w: opsize, pop: 0 });
  if (op === 0xC2) return done({ kind: 'ret', w: opsize, pop: u16() });
  if (op === 0xE2) { const d = s8(); return done({ kind: 'loop', target: rel(d), a32: asize === 32 }); }
  if (op === 0xE3) { const d = s8(); return done({ kind: 'jcxz', target: rel(d), a32: asize === 32 }); }
  if (op === 0xE9) {
    const d = opsize === 32 ? i32() : (u16() << 16) >> 16;
    return done({ kind: 'jmp', target: rel(d) });
  }
  if (op === 0xEB) { const d = s8(); return done({ kind: 'jmp', target: rel(d) }); }
  if (op === 0xF6 || op === 0xF7) {
    const m = modrm(w0);
    if (m.reg === 0 || m.reg === 1) return done({ kind: 'test', w: w0, dst: m.rm, src: I(imm(w0), w0) });
    if (m.reg === 2) return done({ kind: 'not', w: w0, dst: m.rm });
    if (m.reg === 3) return done({ kind: 'neg', w: w0, dst: m.rm });
    // One-operand MUL/IMUL (/4 /5) and DIV/IDIV (/6 /7): the accumulator pair
    // is implicit (AX, DX:AX or EDX:EAX by width).
    if (m.reg === 4 || m.reg === 5) return done({ kind: 'mul1', signed: m.reg === 5, w: w0, src: m.rm });
    return done({ kind: 'div1', signed: m.reg === 7, w: w0, src: m.rm });
  }
  if (op === 0xFE || op === 0xFF) {
    const m = modrm(w0);
    if (m.reg === 0 || m.reg === 1) return done({ kind: 'incdec', dec: m.reg === 1, w: w0, dst: m.rm });
    if (op === 0xFF && m.reg === 6) return done({ kind: 'push', w: opsize, src: m.rm });
    return bad(`fe/ff /${m.reg}`);
  }
  if (op === 0x0F) {
    const op2 = u8();
    if (op2 >= 0x80 && op2 <= 0x8F) {
      const d = opsize === 32 ? i32() : (u16() << 16) >> 16;
      return done({ kind: 'jcc', cc: op2 & 15, target: rel(d) });
    }
    if (op2 >= 0x90 && op2 <= 0x9F) {
      const m = modrm(8);
      return done({ kind: 'setcc', cc: op2 & 15, w: 8, dst: m.rm });
    }
    if (op2 === 0xB6 || op2 === 0xB7 || op2 === 0xBE || op2 === 0xBF) {
      const sw = (op2 & 1) ? 16 : 8;
      const m = modrm(sw);
      return done({ kind: op2 < 0xB8 ? 'movzx' : 'movsx', w: opsize, sw,
        dst: R(m.reg, opsize), src: m.rm });
    }
    if (op2 === 0xAF) {
      const m = modrm(opsize);
      return done({ kind: 'imul2', w: opsize, dst: R(m.reg, opsize), src: m.rm });
    }
    return bad(`0f ${op2.toString(16)}`);
  }
  return bad(`op ${op.toString(16)}`);
}

// Does this instruction end a basic block, and where can it go?
function successors(d) {
  switch (d.kind) {
    case 'jcc': case 'loop': case 'jcxz': return { taken: d.target, fall: d.next };
    case 'jmp': return { taken: d.target, fall: null };
    case 'call': return { taken: d.target, fall: null, call: true };
    case 'ret': return { taken: null, fall: null, ret: true };
    default: return null;
  }
}

module.exports = { decodeInsn, successors, ALU, wmask, MASK };
