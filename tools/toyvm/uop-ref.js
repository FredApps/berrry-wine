'use strict';

// Reference interpreter for micro-op programs (tools/toyvm/uop-ir.js).
//
// It runs a program directly against a live toy VM's memory: guest RAM, the
// register file at isa.REGFILE_BASE, the segment bases beside it and the
// code bitmap are all plain bytes in vm.mem, so a program that says GETR or
// ST touches exactly what the interpreter would have touched. The few pieces
// of state that are wasm GLOBALS rather than memory -- the lazy flag record,
// $steps, $smc -- go through the module's accessors at the edges of a run:
// read on entry, written back on exit.
//
// The lazy flag record is modelled here as L1 keeps it ($fop/$fa/$fb/$fu/
// $fr/$fw/$fcf over a $flags word), transcribed from the recorders and
// getters in emit.js, so a naive program's REC and GETCC do exactly what the
// handlers do. Entry reads the materialized word (get_flags) and starts with
// no record pending; exit publishes the word (set_flags).
//
// This is the correctness oracle for the passes and the census tool for the
// µop counts, not an engine: it also counts every µop it executes.

const isa = require('./isa');
const { FBIT, ccEval } = require('./uop-ir');

const FOP = { NONE: 0, ADD: 1, SUB: 2, LOGIC: 3, ADD32: 4, SUB32: 5, INC: 6, DEC: 7, INC32: 8, DEC32: 9 };
const ARITH = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 11);
const parity = (v) => { let x = v & 0xFF; x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return (x & 1) ^ 1; };

class LazyFlags {
  // `fres` is $f_res, the bits every published word ORs in.
  constructor(word, fres) {
    this.flags = word; this.fres = fres;
    this.fop = 0; this.fa = 0; this.fb = 0; this.fu = 0; this.fr = 0; this.fw = 16; this.fcf = 0;
  }
  zf() { return this.fop === 0 ? (this.flags >> 6) & 1 : (this.fr === 0 ? 1 : 0); }
  sf() { return this.fop === 0 ? (this.flags >> 7) & 1 : (this.fr >>> (this.fw - 1)) & 1; }
  pf() { return this.fop === 0 ? (this.flags >> 2) & 1 : parity(this.fr); }
  cf() {
    const op = this.fop;
    if (op === 0) return this.flags & 1;
    if (op === FOP.SUB || op === FOP.ADD) return (this.fu >>> this.fw) & 1;
    if (op === FOP.LOGIC) return 0;
    if (op === FOP.ADD32) return this.fcf ? ((this.fr >>> 0) <= (this.fa >>> 0) ? 1 : 0) : ((this.fr >>> 0) < (this.fa >>> 0) ? 1 : 0);
    if (op === FOP.SUB32) return this.fcf ? ((this.fa >>> 0) <= (this.fb >>> 0) ? 1 : 0) : ((this.fa >>> 0) < (this.fb >>> 0) ? 1 : 0);
    return this.fcf;
  }
  of() {
    const op = this.fop;
    if (op === 0) return (this.flags >> 11) & 1;
    if (op === FOP.LOGIC) return 0;
    const msb = this.fw - 1;
    if (op === FOP.SUB || op === FOP.SUB32 || op === FOP.DEC || op === FOP.DEC32) {
      return (((this.fa ^ this.fb) & (this.fa ^ this.fr)) >>> msb) & 1;
    }
    return (((this.fa ^ this.fr) & (this.fb ^ this.fr)) >>> msb) & 1;
  }
  af() {
    if (this.fop === 0) return (this.flags >> 4) & 1;
    if (this.fop === FOP.LOGIC) return 0;
    return ((this.fa ^ this.fb ^ this.fr) >>> 4) & 1;
  }
  bits() { return { c: this.cf(), p: this.pf(), a: this.af(), z: this.zf(), s: this.sf(), o: this.of() }; }
  sync() {
    if (this.fop === 0) return;
    let f = this.flags & (~ARITH & 0xFFFF);
    f |= this.cf() | (this.pf() << 2) | (this.af() << 4) | (this.zf() << 6) | (this.sf() << 7) | (this.of() << 11);
    this.fop = 0;
    this.flags = (f | this.fres) >>> 0;
  }
  word() { this.sync(); return this.flags; }
  put(v) { this.flags = v; this.fop = 0; }
  // The recorders, argument for argument.
  add(a, b, s, w) { this.fa = a; this.fb = b; this.fu = s; this.fw = w; this.fr = s & ((1 << w) - 1); this.fop = FOP.ADD; }
  sub(a, b, s, w) { this.fa = a; this.fb = b; this.fu = s; this.fw = w; this.fr = s & ((1 << w) - 1); this.fop = FOP.SUB; }
  logic(r, w) { this.fr = r; this.fw = w; this.fop = FOP.LOGIC; }
  add32(a, b, cin, r) { this.fa = a; this.fb = b; this.fcf = cin; this.fr = r; this.fw = 32; this.fop = FOP.ADD32; }
  sub32(a, b, cin, r) { this.fa = a; this.fb = b; this.fcf = cin; this.fr = r; this.fw = 32; this.fop = FOP.SUB32; }
  inc(a, s, w) { const c = this.cf(); this.add(a, 1, s, w); this.fcf = c; this.fop = FOP.INC; }
  dec(a, s, w) { const c = this.cf(); this.sub(a, 1, s, w); this.fcf = c; this.fop = FOP.DEC; }
  inc32(a, r) { const c = this.cf(); this.add32(a, 1, 0, r); this.fcf = c; this.fop = FOP.INC32; }
  dec32(a, r) { const c = this.cf(); this.sub32(a, 1, 0, r); this.fcf = c; this.fop = FOP.DEC32; }
  mul(nz) {
    this.sync();
    const n = nz ? 1 : 0;
    this.flags = ((this.flags & (~((1 << 0) | (1 << 11)) & 0xFFFF)) | n | (n << 11) | this.fres) >>> 0;
  }
}

// The $sh_<kind><w> helpers, bit loop and all.
function shiftHelper(fl, kind, w, v, n, shmask) {
  const mask = w === 32 ? 0xFFFFFFFF : (1 << w) - 1;
  const msb = w - 1;
  v >>>= 0;
  const orig = v;
  let cf = fl.cf();
  n &= shmask;
  if (n === 0) return v | 0;
  for (; n > 0; n--) {
    switch (kind) {
      case 'rol': { const t = (v >>> msb) & 1; v = (((v << 1) & mask) | t) >>> 0; cf = t; break; }
      case 'ror': { const t = v & 1; v = ((v >>> 1) | (t << msb)) >>> 0; cf = t; break; }
      case 'shl': cf = (v >>> msb) & 1; v = ((v << 1) & mask) >>> 0; break;
      case 'shr': cf = v & 1; v = v >>> 1; break;
      case 'sar': cf = v & 1; v = (((v << (32 - w)) >> (32 - w)) >> 1) & mask; v >>>= 0; break;
      default: throw new Error(`shift ${kind}`);
    }
  }
  const rotate = kind === 'rol' || kind === 'ror';
  const of = {
    rol: cf ^ ((v >>> msb) & 1),
    ror: ((v >>> msb) & 1) ^ ((v >>> (msb - 1)) & 1),
    shl: cf ^ ((v >>> msb) & 1),
    shr: (orig >>> msb) & 1,
    sar: 0,
  }[kind];
  let f = fl.word() & ~((1 << 0) | (1 << 11) | (rotate ? 0 : ((1 << 7) | (1 << 6) | (1 << 2)))) & 0xFFFF;
  f |= (cf & 1) | ((of & 1) << 11);
  if (!rotate) f |= (((v >>> msb) & 1) << 7) | ((v === 0 ? 1 : 0) << 6) | (parity(v) << 2);
  fl.put((f | fl.fres) >>> 0);
  return v | 0;
}

// Apply a flag record (a REC, or a WREC with `fcf` the carry an inc/dec
// keeps) to a LazyFlags, reading its operands from the vreg file.
function record(fl, op, v, fcf) {
  const has = (f) => op[f] !== undefined && op[f] >= 0;
  const g = (f) => {
    if (has(f)) return v[op[f]];
    // An inc/dec that kept only its masked result r derives a and s from it.
    const m = op.w === 32 ? -1 : (1 << op.w) - 1;
    const inc = op.k === 'inc' || op.k === 'inc32';
    if ((f === 'a' || f === 's') && ['inc', 'dec', 'inc32', 'dec32'].includes(op.k)) {
      const a = has('s') ? (inc ? v[op.s] - 1 : v[op.s] + 1) : (op.w === 32 ? (inc ? v[op.r] - 1 : v[op.r] + 1) | 0
        : (inc ? v[op.r] - 1 : v[op.r] + 1) & m);
      return f === 'a' ? a : (inc ? a + 1 : a - 1);
    }
    return 0;
  };
  switch (op.k) {
    case 'add': fl.add(g('a'), g('b'), g('s'), op.w); break;
    case 'sub': fl.sub(g('a'), g('b'), g('s'), op.w); break;
    case 'logic': fl.logic(g('r'), op.w); break;
    case 'add32': fl.add32(g('a'), g('b'), g('cin'), g('r')); break;
    case 'sub32': fl.sub32(g('a'), g('b'), g('cin'), g('r')); break;
    case 'inc': fl.inc(g('a'), g('s'), op.w); break;
    case 'dec': fl.dec(g('a'), g('s'), op.w); break;
    case 'inc32': fl.inc32(g('a'), g('r')); break;
    case 'dec32': fl.dec32(g('a'), g('r')); break;
    case 'mul': fl.mul(g('nz')); break;
    // A constant-count shift: the helper's own flag write, count premasked.
    case 'shift': shiftHelper(fl, op.sh, op.w, g('a'), op.i, 0xFFFFFFFF); break;
    default: throw new Error(`rec ${op.k}`);
  }
  if (fcf !== null && ['inc', 'dec', 'inc32', 'dec32'].includes(op.k)) fl.fcf = fcf;
}

// Evaluate a branch condition on (a, b) at width w.
function cond(cc, a, b, w) {
  const m = w === 32 ? 0xFFFFFFFF : (1 << w) - 1;
  const ua = (a & m) >>> 0, ub = (b & m) >>> 0;
  const sh = 32 - w;
  const sa = (a << sh) >> sh, sb = (b << sh) >> sh;
  switch (cc) {
    case 'nz': return ua !== 0;
    case 'z': return ua === 0;
    case 'eq': return ua === ub;
    case 'ne': return ua !== ub;
    case 'ltu': return ua < ub;
    case 'leu': return ua <= ub;
    case 'gtu': return ua > ub;
    case 'geu': return ua >= ub;
    case 'lt': return sa < sb;
    case 'le': return sa <= sb;
    case 'gt': return sa > sb;
    case 'ge': return sa >= sb;
    case 's': return ((ua >>> (w - 1)) & 1) === 1;
    case 'ns': return ((ua >>> (w - 1)) & 1) === 0;
    case 'p': return parity(ua) === 1;
    case 'np': return parity(ua) === 0;
    default: throw new Error(`cond ${cc}`);
  }
}

class UopDeoptVga extends Error {}

// Run program `p` from its entry against `vm`. Returns
//   { exit: 'go', ip, steps, n: µops executed, blocks, why }.
// `opts.maxOps` bounds a runaway program.
function runRef(vm, p, opts = {}) {
  const mem = vm.mem;
  const dv = new DataView(vm.memory.buffer);
  const ex = vm.exports;
  const linmask = ex.mget_linmask();
  const shmask = ex.mget_shmask();
  const spm = ex.mget_spm();
  const vgaKey = dv.getInt32(isa.VGA_CTL_KEY, true);
  const RF = isa.REGFILE_BASE, SB = isa.REGFILE_SEGB;
  // A wasm engine hands a run over mid-program (opts.start, with its vreg
  // file, budget and materialized flags word) and takes it back at the first
  // block opts.stopAt accepts.
  const fl = new LazyFlags(opts.flags !== undefined ? opts.flags >>> 0 : ex.get_flags() >>> 0, ex.mget_f_res());
  let steps = opts.steps !== undefined ? opts.steps | 0 : ex.get_steps() | 0;
  let smc = ex.get_smc() | 0, smclo = ex.get_smclo() >>> 0, smchi = ex.get_smchi() >>> 0;
  const v = opts.v || new Int32Array(Math.max(p.nv, 64));
  const stopAt = opts.stopAt || null;
  const counts = opts.counts || null;       // per-op-kind census
  let nops = 0;
  const maxOps = opts.maxOps || 1e9;

  const isVga = (lin) => (((lin & 0xFFF0000) | 1) === vgaKey);
  const codeBit = (lin) => (mem[isa.CODE_BITMAP + (lin >>> 3)] >> (lin & 7)) & 1;
  const offAdd = (off, n) => ((((off & 0xFFFF) + n) & 0xFFFF) | (off & 0x7FFF0000));
  const rd8 = (base, off) => {
    const l = ((base + off) & linmask) >>> 0;
    if (isVga(l)) { if (!ex.uop_vga_rd8) throw new UopDeoptVga('vga read'); return ex.uop_vga_rd8(l); }
    return mem[l];
  };
  const wr8 = (base, off, x) => {
    const l = ((base + off) & linmask) >>> 0;
    if (isVga(l)) { if (!ex.uop_vga_wr8) throw new UopDeoptVga('vga write'); ex.uop_vga_wr8(l, x & 0xFF); return; }
    if (codeBit(l)) {
      if (smc === 2) { if (l < smclo) smclo = l; if (l > smchi) smchi = l; } else { smclo = l; smchi = l; }
      smc = 2;
    }
    mem[l] = x & 0xFF;
  };
  // Full L1 semantics, including the byte-wise composition.
  const rdW = (w, base, off) => {
    if (w === 8) return rd8(base, off);
    const n = w >> 3;
    const l = ((base + off) & linmask) >>> 0;
    if ((off & 0xFFFF) <= 0x10000 - n && (l & 0xFFFF) <= 0x10000 - n && !isVga(l)) {
      return w === 16 ? dv.getUint16(l, true) : dv.getInt32(l, true);
    }
    const h = w >> 1;
    return (rdW(h, base, off) | (rdW(h, base, offAdd(off, n / 2)) << h)) | 0;
  };
  const wrW = (w, base, off, x) => {
    if (w === 8) return wr8(base, off, x);
    const n = w >> 3;
    const l = ((base + off) & linmask) >>> 0;
    if ((off & 0xFFFF) <= 0x10000 - n && (l & 0xFFFF) <= 0x10000 - n && !isVga(l)) {
      const bits = (mem[isa.CODE_BITMAP + (l >>> 3)] | (mem[isa.CODE_BITMAP + (l >>> 3) + 1] << 8))
        & (((1 << n) - 1) << (l & 7));
      if (!bits) {
        if (w === 16) dv.setUint16(l, x & 0xFFFF, true); else dv.setInt32(l, x, true);
        return;
      }
    }
    const h = w >> 1;
    wrW(h, base, off, x);
    wrW(h, base, offAdd(off, n / 2), x >>> h);
  };
  // The fast path a guarded access may take, or not.
  const plain = (w, l, off, store) => {
    const n = w >> 3;
    if (isVga(l)) return false;
    if (n > 1 && ((off & 0xFFFF) > 0x10000 - n || (l & 0xFFFF) > 0x10000 - n)) return false;
    if (store) {
      const bits = (mem[isa.CODE_BITMAP + (l >>> 3)] | (mem[isa.CODE_BITMAP + (l >>> 3) + 1] << 8))
        & (((1 << n) - 1) << (l & 7));
      if (bits) return false;
    }
    return true;
  };
  const ldRaw = (w, l) => (w === 8 ? mem[l] : w === 16 ? dv.getUint16(l, true) : dv.getInt32(l, true));
  const stRaw = (w, l, x) => {
    if (w === 8) mem[l] = x; else if (w === 16) dv.setUint16(l, x & 0xFFFF, true); else dv.setInt32(l, x, true);
  };

  const getr = (r, w) => {
    switch (w) {
      case 32: return dv.getInt32(RF + 4 * r, true);
      case 16: return dv.getUint16(RF + 4 * r, true);
      case 8: return mem[RF + 4 * r];
      case 9: return mem[RF + 4 * r + 1];
      default: throw new Error(`getr w${w}`);
    }
  };
  const putr = (r, w, x) => {
    switch (w) {
      case 32: dv.setInt32(RF + 4 * r, x, true); break;
      case 16: dv.setUint16(RF + 4 * r, x & 0xFFFF, true); break;
      case 8: mem[RF + 4 * r] = x; break;
      case 9: mem[RF + 4 * r + 1] = x; break;
      default: throw new Error(`putr w${w}`);
    }
  };
  const flagBit = (f) => ({ c: fl.cf(), p: fl.pf(), a: fl.af(), z: fl.zf(), s: fl.sf(), o: fl.of() })[f];
  const ea = (op) => {
    let off = (op.a >= 0 ? v[op.a] : 0) + (op.c >= 0 ? v[op.c] << op.sc : 0) + op.i;
    if (op.am) off &= op.am;
    return off | 0;
  };

  let bid = opts.start !== undefined ? opts.start : p.entry;
  const first = bid;
  let blocks = 0, heads = 0;
  const headBlocks = p.headBlocks || new Set([p.nodeBlock.get(p.headKey)]);
  const finish = (ip, why) => {
    ex.set_steps(steps);
    ex.set_smc(smc); ex.set_smclo(smclo); ex.set_smchi(smchi);
    ex.set_flags(fl.word());
    if (ex.set_gip) ex.set_gip(ip >>> 0);
    return { exit: 'go', ip: ip >>> 0, steps, n: nops, blocks, heads, why };
  };

  for (;;) {
    if (stopAt && bid !== first && stopAt.has(bid)) {
      if (smc !== (ex.get_smc() | 0)) { ex.set_smc(smc); ex.set_smclo(smclo); ex.set_smchi(smchi); }
      return { exit: 'bail', bid, steps, flags: fl.word(), n: nops, blocks, heads };
    }
    const b = p.blocks[bid];
    blocks++;
    if (headBlocks.has(bid)) heads++;
    let next = -1;
    const ops = b.ops;
    for (let k = 0; k < ops.length && next < 0; k++) {
      const op = ops[k];
      nops++;
      if (counts) counts[op.o] = (counts[op.o] || 0) + 1;
      switch (op.o) {
        case 'movi': v[op.d] = op.i; break;
        case 'mov': v[op.d] = v[op.a]; break;
        case 'add': v[op.d] = (v[op.a] + v[op.b]) | 0; break;
        case 'sub': v[op.d] = (v[op.a] - v[op.b]) | 0; break;
        case 'and': v[op.d] = v[op.a] & v[op.b]; break;
        case 'or': v[op.d] = v[op.a] | v[op.b]; break;
        case 'xor': v[op.d] = v[op.a] ^ v[op.b]; break;
        case 'mul': v[op.d] = Math.imul(v[op.a], v[op.b]); break;
        case 'imulov': {
          const r = BigInt(v[op.a]) * BigInt(v[op.b]);
          v[op.d] = BigInt.asIntN(32, r) === r ? 0 : 1;
          break;
        }
        case 'eq': v[op.d] = v[op.a] === v[op.b] ? 1 : 0; break;
        case 'ne': v[op.d] = v[op.a] !== v[op.b] ? 1 : 0; break;
        case 'addi': v[op.d] = (v[op.a] + op.i) | 0; break;
        case 'subi': v[op.d] = (v[op.a] - op.i) | 0; break;
        case 'andi': v[op.d] = v[op.a] & op.i; break;
        case 'ori': v[op.d] = v[op.a] | op.i; break;
        case 'xori': v[op.d] = v[op.a] ^ op.i; break;
        case 'shli': v[op.d] = v[op.a] << op.i; break;
        case 'shri': v[op.d] = v[op.a] >>> op.i; break;
        case 'sari': v[op.d] = v[op.a] >> op.i; break;
        case 'addi16': v[op.d] = (v[op.a] + op.i) & 0xFFFF; break;
        case 'addi8': v[op.d] = (v[op.a] + op.i) & 0xFF; break;
        case 'sx8': v[op.d] = (v[op.a] << 24) >> 24; break;
        case 'sx16': v[op.d] = (v[op.a] << 16) >> 16; break;
        case 'merge16': v[op.d] = (v[op.a] & ~0xFFFF) | (v[op.b] & 0xFFFF); break;
        case 'merge8l': v[op.d] = (v[op.a] & ~0xFF) | (v[op.b] & 0xFF); break;
        case 'merge8h': v[op.d] = (v[op.a] & ~0xFF00) | ((v[op.b] & 0xFF) << 8); break;
        case 'ext8h': v[op.d] = (v[op.a] >>> 8) & 0xFF; break;
        case 'cc': v[op.d] = cond(op.cc, v[op.a], op.b >= 0 ? v[op.b] : op.i, op.w) ? 1 : 0; break;
        case 'getr': v[op.d] = getr(op.r, op.w); break;
        case 'putr': putr(op.r, op.w, v[op.a]); break;
        case 'gets': v[op.d] = dv.getInt32(SB + 4 * op.s, true); break;
        case 'getm':
          v[op.d] = op.g === 'spm' ? spm : op.g === 'df' ? (fl.flags >>> 10) & 1 : op.g === 'shmask' ? shmask : 0;
          break;
        case 'ld': case 'st': {
          const base = v[op.s];
          const off = ea(op);
          if (op.chk === 'full') {
            if (op.o === 'ld') v[op.d] = rdW(op.w, base, off);
            else wrW(op.w, base, off, v[op.b]);
            break;
          }
          const l = ((base + off) & linmask) >>> 0;
          if (op.chk === 'guard' && !plain(op.w, l, off, op.o === 'st')) { next = op.dx; break; }
          if (op.o === 'ld') v[op.d] = ldRaw(op.w, l);
          else stRaw(op.w, l, v[op.b]);
          break;
        }
        case 'rec': record(fl, op, v, null); break;
        // Rewrite L1's record from a forwarded producer's operands; an
        // inc/dec takes the carry it keeps from a vreg (-2: dead, anything).
        case 'wrec': {
          const fcf = op.fcf >= 0 ? v[op.fcf] & 1 : 0;
          record(fl, op, v, fcf);
          break;
        }
        // One flag of a producer, from its operands alone.
        case 'flagof': {
          if (op.k === 'mul') { v[op.d] = v[op.nz] ? 1 : 0; break; }
          const t = new LazyFlags(0, 0);
          record(t, op, v, 0);
          v[op.d] = t.bits()[op.f];
          break;
        }
        case 'getcc': v[op.d] = ccEval(op.cc, fl.bits()); break;
        case 'getf': v[op.d] = flagBit(op.f); break;
        case 'getfw': v[op.d] = fl.word() | 0; break;
        // Publish forwarded flags: the whole arithmetic set from six bit vregs.
        case 'wflags': {
          let f = fl.word();
          for (const k of ['c', 'p', 'a', 'z', 's', 'o']) {
            if (op[`f${k}`] >= 0) f = (f & ~(1 << FBIT[k])) | ((v[op[`f${k}`]] & 1) << FBIT[k]);
          }
          fl.put(f >>> 0);
          break;
        }
        case 'shift': v[op.d] = shiftHelper(new LazyFlags(0, 0), op.sh, op.w, v[op.a], op.i, 0xFFFFFFFF); break;
        case 'callh': {
          if (!op.sh) throw new Error(`callh ${op.fn}`);
          v[op.d] = shiftHelper(fl, op.sh, op.w, v[op.a], v[op.b], shmask);
          break;
        }
        case 'step': steps = (steps - op.i) | 0; break;
        case 'guard': {
          const val = op.g === 'spm' ? spm : op.g === 'shmask' ? shmask : op.g === 'df' ? (fl.flags >>> 10) & 1
            : op.g === 'smc' ? smc : 0;
          if (val !== op.v) next = op.dx;
          break;
        }
        // The lookahead budget test at a loop header: fewer than M steps left
        // and the fast path could cross a transfer with the budget spent.
        case 'check':
          if (steps < op.m || smc) next = op.dx;
          break;
        default: throw new Error(`ref: op ${op.o}`);
      }
    }
    if (nops > maxOps) throw new Error('ref: op limit');
    if (next >= 0) { bid = next; continue; }
    const t = b.term;
    nops++;
    if (counts) counts[t.o] = (counts[t.o] || 0) + 1;
    const due = () => smc !== 0 || steps < 0;
    if (t.o === 'br') {
      if (t.st) steps = (steps - t.st) | 0;
      bid = (t.tx >= 0 && due()) ? t.tx : t.t;
    } else if (t.o === 'bcc') {
      const taken = cond(t.cc, v[t.a], t.b !== undefined && t.b >= 0 ? v[t.b] : (t.i | 0), t.w || 32);
      if (taken) {
        if (t.sT) steps = (steps - t.sT) | 0;
        bid = (t.tx >= 0 && due()) ? t.tx : t.t;
      } else {
        if (t.sF) steps = (steps - t.sF) | 0;
        bid = (t.fx >= 0 && due()) ? t.fx : t.f;
      }
    } else if (t.o === 'exit') {
      if (t.adj) steps = (steps + t.adj) | 0;
      return finish(t.ipv !== undefined ? v[t.ipv] : t.ip, t.why);
    } else throw new Error(`ref: term ${t.o}`);
  }
}

module.exports = { runRef, LazyFlags, shiftHelper, cond, UopDeoptVga, parity };
