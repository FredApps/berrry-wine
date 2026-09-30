'use strict';

// The micro-op optimizer.
//
// build() turns a discovered region into ONE program with two halves:
//
//   SLOW  the naive lowering (uop-ir.js lower), untouched: exact L1 semantics
//         in any machine state, one block per x86 instruction, the budget
//         tested at every transfer. Never runs unless the fast half sends it.
//   FAST  a copy of the same CFG that every pass below rewrites. It assumes
//         things -- machine settings, that memory is plain RAM, that the
//         budget covers a whole iteration -- and checks each assumption at a
//         place where failing is cheap: a machine GUARD at entry, a memory
//         GUARD at an access (or hoisted to the loop's preheader), and a
//         budget CHECK at each loop header.
//
// A failed assumption DEOPTS: the fast half writes its state back (registers
// to the register file, flags into L1's record) and branches to the slow
// block for the instruction that was about to run, which then runs it the way
// L1 would have. Every fast→slow edge lands on an instruction boundary, and
// every fast instruction's register and flag writes come after its last
// memory access (the lowering orders them so), so "the state before this
// instruction" is always what the deopt writes back. The slow half re-enters
// the fast half at a loop header, through a FASTENTER block that reloads.
//
// Passes (each switchable; `ablationConfigs` builds the table):
//   promote    guest registers and segment bases live in vregs, not the
//              register file; written back only at exits and deopts
//   mergesink  ...and a register only ever accessed at 16 (or 8) bits stays
//              narrow: its partial-register merges sink to the exit
//   constprop  constant/copy propagation, algebraic simplification, DCE,
//              coalescing of `r = mov t` into the op that made t
//   addrfold   address arithmetic folded into the memory op's own
//              [base + a + (c << sc) + disp] & mask form
//   flagfwd    flag consumers read the producer's operands directly (a
//              cmp/jcc becomes one compare-and-branch); nothing writes the L1
//              lazy-flag record inside the loop
//   flaglive   flag liveness as a fixpoint over the loop, back edges included,
//              with every exit's live-out read off the code it goes to
//   guards     machine settings (SP width, DF, shift mask) specialized under
//              an entry guard; memory guards hoisted to the loop preheader as
//              range checks over the induction variables and the trip count
//   rle        redundant-load elimination and store-to-load forwarding
//   stack      stack coalescing: SP arithmetic cancelled modulo its width, a
//              pop forwarded from its push, and an inlined call's `ret`
//              folded to a branch
//   licm       loop-invariant pure ops hoisted to the preheader
//   fuse       µop superinstructions (see FUSIONS)
//   clock      one budget CHECK per loop header with a lookahead of the
//              longest path to the next header; step charges summed per edge
//              instead of one STEP per instruction

const IR = require('./uop-ir');
const isa = require('./isa');
const { FIRST_TEMP, NREG, SEGV, CC_READS, ALL6, liveFlagsAt, flagEffect } = IR;

const PASSES = ['promote', 'mergesink', 'constprop', 'addrfold', 'flagfwd', 'flaglive',
  'guards', 'rle', 'stack', 'segdisj', 'licm', 'fuse', 'clock'];
// Every guest vreg a FLUSH writes back: the eight registers AND the six
// segment bases. Leaving the bases out once a segment load could write one
// (PUTS) let a pass drop that write as dead, and the deopt stub stored the
// stale base next to the new selector (B-STEEL's `pop es`).
const GUEST = Array.from({ length: FIRST_TEMP }, (_, i) => i);

// The passes a block-local baseline tier could run (docs/uop-baseline-tier-
// design.md): nothing that needs a loop -- no guards hoisted to a preheader,
// no LICM, no memory forwarding, no flag liveness across blocks.
const BASELINE = ['promote', 'mergesink', 'constprop', 'addrfold', 'flagfwd', 'clock'];

function ablationConfigs(which = PASSES) {
  const all = Object.fromEntries(PASSES.map(p => [p, true]));
  const base = Object.fromEntries(PASSES.map(p => [p, BASELINE.includes(p)]));
  // ...R: the same passes with the guest vregs resident in L1's register file
  // (finalize). Not a PASS: it changes where vregs live, not what runs.
  const out = [['naive', null], ['none', Object.fromEntries(PASSES.map(p => [p, false]))], ['all', all],
    ['baseline', base], ['allR', { ...all, resident: true }], ['baselineR', { ...base, resident: true }],
    ['allRF', { ...all, resident: 'full' }], ['baselineRF', { ...base, resident: 'full' }],
    ['allRP', { ...all, resident: 'promote' }], ['baselineRP', { ...base, resident: 'promote' }],
    // baselineBF: the baseline passes with a reload/flush at every block
    // boundary (finalize, blockflush) -- the register traffic of a chained
    // per-block tier without resident registers; baselineRF is the same tier
    // with them. The pair prices what resident removes.
    ['baselineBF', { ...base, blockflush: true }]];
  for (const p of which) out.push([`-${p}`, { ...all, [p]: false }]);
  return out;
}

// ---------------------------------------------------------------------------
// Operand bookkeeping for the fast half.
// ---------------------------------------------------------------------------
// WFLAGS names its six bit operands fc..fo, clear of the ordinary fields.
const FLAG_FIELDS = ['fc', 'fp', 'fa', 'fz', 'fs', 'fo'];
// The fields of an op that READ a vreg.
function useFields(op) {
  switch (op.o) {
    case 'movi': case 'getr': case 'gets': case 'getsel': case 'getm': case 'getf': case 'getfw':
    case 'step': case 'reload': case 'guard': case 'check': case 'flush':
      return [];
    case 'putr': case 'puts': case 'putsel': return ['a'];
    case 'ld': return ['s', 'a', 'c'];
    case 'st': return ['s', 'a', 'c', 'b'];
    case 'rec': case 'wrec': case 'flagof': return ['a', 'b', 's', 'r', 'cin', 'nz', 'fcf'];
    case 'wflags': return FLAG_FIELDS;
    case 'grange': return ['s', 'x', 'n'];
    default: return ['a', 'b', 'c'];
  }
}
function opUses(op) {
  const u = [];
  for (const f of useFields(op)) { const v = op[f]; if (v !== undefined && v !== null && v >= 0) u.push(v); }
  if (op.o === 'flush') u.push(...GUEST);
  return u;
}
function mapUses(op, fn) {
  for (const f of useFields(op)) { const v = op[f]; if (v !== undefined && v !== null && v >= 0) op[f] = fn(v, f); }
}
function mapTermUses(t, fn) {
  if (!t) return;
  if (t.o === 'bcc') { t.a = fn(t.a); if (t.b !== undefined && t.b >= 0) t.b = fn(t.b); }
  if (t.o === 'exit' && t.ipv !== undefined) t.ipv = fn(t.ipv);
}
function opDef(op) {
  if (op.o === 'reload') return -1;   // defines 0..13 (handled specially)
  return (op.d !== undefined && op.d >= 0) ? op.d : -1;
}
function termUses(t) {
  if (!t) return [];
  if (t.o === 'bcc') return [t.a, ...(t.b !== undefined && t.b >= 0 ? [t.b] : [])];
  if (t.o === 'exit' && t.ipv !== undefined) return [t.ipv];
  return [];
}
// Pure ops can be deleted when their result is dead and moved when their
// inputs allow. A guarded load is pure here: its only effect is a deopt, and
// a deopt is invisible (the slow half redoes the instruction exactly).
const PURE = new Set(['movi', 'mov', 'add', 'sub', 'and', 'or', 'xor', 'mul', 'mulhu', 'mulhs', 'imulov', 'eq', 'ne',
  'addi', 'subi', 'andi', 'ori', 'xori', 'shli', 'shri', 'sari', 'sx8', 'sx16', 'merge16',
  'merge8l', 'merge8h', 'ext8h', 'cc', 'getr', 'gets', 'getm', 'getf', 'getfw', 'flagof',
  'addi16', 'addi8', 'shift']);
const isPure = (op) => PURE.has(op.o) || (op.o === 'ld' && op.chk !== 'full');

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------------
// Building the two halves.
// ---------------------------------------------------------------------------
class Build {
  constructor(reg, opts) {
    this.reg = reg;
    this.env = opts.env || reg.env;
    this.passes = opts.passes;
    this.shmask = opts.shmask === undefined ? 0x1F : opts.shmask;
    this.p = IR.lower(reg);
    this.vm = opts.vm || null;
    this.rd = opts.rd || (this.vm ? (lin) => this.vm.mem[lin] : null);
    if (this.vm && opts.shmask === undefined) this.shmask = this.vm.exports.mget_shmask();
    this.machine = opts.machine || (this.vm ? {
      spm: this.vm.exports.mget_spm(),
      df: (this.vm.exports.get_flags() >>> 10) & 1,
      shmask: this.vm.exports.mget_shmask(),
    } : null);
    this.stats = {};
    this.liveMemo = new Map();
  }
  on(name) { return !!this.passes[name]; }
  temp() { return this.p.nv++; }
  block(kind) {
    const b = this.p.block(kind);
    b.preds = []; b.succs = [];
    return b;
  }
  liveAt(ip) {
    if (!this.on('flaglive') || !this.rd) return new Set(ALL6);
    return liveFlagsAt(this.rd, this.env, ip, { shmask: this.shmask, memo: this.liveMemo });
  }
  fastBlocks() { return this.p.blocks.filter(b => b.fast && b.kind !== 'dead'); }

  // Copy the slow CFG into a fast one.
  makeFast() {
    const p = this.p;
    const nodes = this.reg.nodes;
    this.slowOf = p.nodeBlock;                       // node key -> slow block id
    this.fastOf = new Map();
    const tmap = new Map();
    const t = (v) => {
      if (v === undefined || v === null || v < FIRST_TEMP) return v;
      if (!tmap.has(v)) tmap.set(v, this.temp());
      return tmap.get(v);
    };
    for (const [k] of this.slowOf) {
      const f = this.block('body');
      f.fast = true;
      f.nodes = [k];
      f.ip = nodes.get(k).ip;
      this.fastOf.set(k, f.id);
    }
    this.deoptStub = new Map();
    for (const [k, sid] of this.slowOf) {
      const s = p.blocks[sid];
      const f = p.blocks[this.fastOf.get(k)];
      for (const op of s.ops) {
        const c = clone(op);
        const fields = ['getr', 'gets', 'getsel', 'getm', 'movi', 'getcc', 'getf'].includes(c.o) ? ['d']
          : ['putr', 'puts', 'putsel'].includes(c.o) ? ['a'] : ['d', 'a', 'b', 'c', 's', 'r', 'cin', 'nz'];
        for (const fld of fields) if (typeof c[fld] === 'number') c[fld] = t(c[fld]);
        c.node = k;
        if (c.o === 'ld' || c.o === 'st') { c.chk = 'guard'; c.dx = this.deopt(k); }
        // A divide the fast half cannot do leaves the way a memory guard does:
        // the slow block redoes the instruction, and its own DCHK exits to L1.
        if (c.o === 'dchk') c.dx = this.deopt(k);
        if (c.o === 'pout') c.dx = this.deoptAfter(k);
        f.ops.push(c);
      }
      f.term = this.fastTerm(clone(s.term), t);
    }
    // Slow back edges re-enter the fast half at a header, set up later.
  }
  // Fast terminator from a slow one: body targets become fast blocks, GO stubs
  // become fast exit stubs (which write the state back first).
  fastTerm(term, t) {
    const p = this.p;
    const map = (id) => {
      if (id === undefined || id < 0) return id;
      const b = p.blocks[id];
      if (b.kind === 'body' && !b.fast) return this.fastOf.get(b.node);
      if (b.kind === 'exit') return this.exitStub(b.term, t);
      throw new Error(`fastTerm: target ${b.kind}`);
    };
    if (term.o === 'br') { term.t = map(term.t); term.tx = map(term.tx); }
    else if (term.o === 'bcc') {
      term.t = map(term.t); term.f = map(term.f); term.tx = map(term.tx); term.fx = map(term.fx);
      term.a = t(term.a);
      if (term.b !== undefined && term.b >= 0) term.b = t(term.b);
    }
    return term;
  }
  exitStub(slowTerm, t) {
    const b = this.block('fexit');
    b.fast = true;
    b.nodes = [];
    b.ip = slowTerm.ip;
    b.ops.push({ o: 'flush', exitIp: slowTerm.ip, dyn: slowTerm.ipv !== undefined });
    b.term = { ...slowTerm };
    if (slowTerm.ipv !== undefined) b.term.ipv = t(slowTerm.ipv);
    return b.id;
  }
  // The deopt stub of an instruction: write back, then run it slowly.
  deopt(k) {
    if (this.deoptStub.has(k)) return this.deoptStub.get(k);
    const b = this.block('deopt');
    b.fast = true;
    b.nodes = [];
    b.node = k;
    b.ip = this.reg.nodes.get(k).ip;
    b.ops.push({ o: 'flush', exitIp: b.ip, node: k });
    b.term = { o: 'br', t: this.slowOf.get(k), tx: -1, st: 0 };
    // At an L1 block head the fast half only ever stands right after a
    // transfer, and L1 tests the budget and self-modify there. So the stub
    // tests too, after its refund: a header CHECK that fired because the
    // budget is spent (or code was written) must leave AT the head, not run
    // the head's block slowly first (ZOKDTPLN.COM, two steps past it).
    if (this.p.l1Heads && this.p.l1Heads.has(k)) {
      const g = this.block('exit');
      g.ip = b.ip;
      g.term = { o: 'exit', kind: 'go', ip: b.ip, why: 'edge' };
      b.term.tx = g.id;
    }
    this.deoptStub.set(k, b.id);
    return b.id;
  }

  // Where a port write that cut the slice leaves the fast half: the slow
  // half at the NEXT instruction, which runs on to L1's next transfer and
  // stops there. Its own stub every time, because its refund (set in
  // finalize from the write's adj) is not a node's.
  deoptAfter(k) {
    const nodes = this.reg.nodes, n = nodes.get(k);
    const e = n.succ[0];
    const inBody = !!(e && this.slowOf.has(e.k));
    const b = this.block('deopt');
    b.fast = true;
    b.nodes = [];
    b.node = inBody ? e.k : k;
    b.ip = inBody ? nodes.get(e.k).ip : n.d.next;
    b.after = true;
    b.ops.push({ o: 'flush', exitIp: b.ip, node: b.node });
    // Off the end of the region: where the slow half goes from there.
    b.term = { o: 'br', t: inBody ? this.slowOf.get(e.k) : this.p.blocks[this.slowOf.get(k)].term.t, tx: -1, st: 0 };
    if (inBody && this.p.l1Heads && this.p.l1Heads.has(e.k)) {
      const g = this.block('exit');
      g.ip = b.ip;
      g.term = { o: 'exit', kind: 'go', ip: b.ip, why: 'edge' };
      b.term.tx = g.id;
    }
    return b.id;
  }

  // Recompute preds/succs over the whole program.
  cfg() {
    const p = this.p;
    for (const b of p.blocks) { b.preds = []; b.succs = []; }
    for (const b of p.blocks) {
      if (b.kind === 'dead') continue;
      b.succs = [...new Set(IR.succOf(b))];
      for (const s of b.succs) p.blocks[s].preds.push(b.id);
    }
  }

  // Straight-line fast blocks merge into one: B -> C when B's only exit is an
  // unchecked, uncharged br to C and B is C's only predecessor.
  mergeStraight() {
    const p = this.p;
    let changed = true;
    while (changed) {
      changed = false;
      this.cfg();
      for (const b of this.fastBlocks()) {
        if (b.kind !== 'body' || !b.term || b.term.o !== 'br' || b.term.tx >= 0 || b.term.st) continue;
        const c = p.blocks[b.term.t];
        if (!c.fast || c.kind !== 'body' || c === b || c.preds.length !== 1 || c.header) continue;
        if (c.id === this.fastHead) continue;
        b.ops.push(...c.ops);
        b.nodes.push(...c.nodes);
        b.term = c.term;
        c.kind = 'dead'; c.ops = []; c.term = null;
        changed = true;
        break;
      }
    }
    this.cfg();
  }

  // Loop headers of the fast half: DFS back-edge targets from the head.
  findHeaders() {
    const p = this.p;
    for (const b of this.fastBlocks()) b.header = false;
    const state = new Map();
    const order = [];
    const backEdges = [];
    const visit = (id) => {
      state.set(id, 1);
      for (const s of p.blocks[id].succs) {
        const sb = p.blocks[s];
        if (!sb.fast || sb.kind !== 'body') continue;
        if (state.get(s) === 1) { sb.header = true; backEdges.push([id, s]); } else if (!state.has(s)) visit(s);
      }
      state.set(id, 2);
      order.push(id);
    };
    visit(this.fastHead);
    p.blocks[this.fastHead].header = true;
    this.rpo = order.reverse();
    this.backEdges = backEdges;
    this.backSet = new Set(backEdges.map(([a, b]) => `${a}>${b}`));
  }

  // Natural loop body of each header (for LICM, guards): blocks that reach a
  // back edge into h without passing through h.
  loopOf(h) {
    const p = this.p;
    const body = new Set([h]);
    const st = this.backEdges.filter(([, t]) => t === h).map(([s]) => s);
    while (st.length) {
      const x = st.pop();
      if (body.has(x)) continue;
      body.add(x);
      for (const q of p.blocks[x].preds) if (p.blocks[q].fast && p.blocks[q].kind === 'body') st.push(q);
    }
    return body;
  }

  // FASTENTER(h): machine guards, reload, then into the loop at h. The
  // program's own entry is FASTENTER(head); slow back edges into a header go
  // to that header's FASTENTER.
  makeEntries() {
    const p = this.p;
    this.enterOf = new Map();
    for (const b of this.fastBlocks()) {
      if (!b.header) continue;
      const e = this.block('fenter');
      e.fast = true;
      e.nodes = [];
      e.header_of = b.id;
      e.ip = b.ip;
      e.ops.push({ o: 'reload' });
      e.term = { o: 'br', t: b.id, tx: -1, st: 0 };
      this.enterOf.set(b.id, e.id);
    }
    p.entry = this.enterOf.get(this.fastHead);
    // Slow edges into a header's slow block re-enter the fast half there.
    const slowToFast = new Map();
    for (const [k, sid] of this.slowOf) {
      const f = this.fastOf.get(k);
      const fb = p.blocks[f];
      if (fb && fb.header && fb.nodes[0] === k) slowToFast.set(sid, this.enterOf.get(f));
    }
    for (const b of p.blocks) {
      if (b.fast || b.kind !== 'body' || !b.term) continue;
      const t = b.term;
      if (t.o === 'br' && slowToFast.has(t.t)) t.t = slowToFast.get(t.t);
      if (t.o === 'bcc') {
        if (slowToFast.has(t.t)) t.t = slowToFast.get(t.t);
        if (slowToFast.has(t.f)) t.f = slowToFast.get(t.f);
      }
    }
    this.cfg();
  }

  // Every op in the fast half, with its block and position.
  *allOps() {
    for (const b of this.fastBlocks()) for (let i = 0; i < b.ops.length; i++) yield [b, i, b.ops[i]];
  }
}

// ---------------------------------------------------------------------------
// promote (+ mergesink)
// ---------------------------------------------------------------------------
function promote(B) {
  const narrow = new Map();      // reg -> 16 | 8 (low byte) when mergesink holds
  if (B.on('mergesink')) {
    const widths = new Map();
    for (const [, , op] of B.allOps()) {
      if (op.o !== 'getr' && op.o !== 'putr') continue;
      if (!widths.has(op.r)) widths.set(op.r, new Set());
      widths.get(op.r).add(op.w);
    }
    for (const [r, ws] of widths) {
      if (ws.has(32)) continue;
      if (ws.size === 1 && ws.has(8)) narrow.set(r, 8);
      else narrow.set(r, 16);
    }
  }
  B.narrow = narrow;
  let n = 0;
  for (const [, , op] of B.allOps()) {
    if (op.o === 'getr') {
      const nw = narrow.get(op.r);
      const r = op.r;
      delete op.r;
      if (op.w === 32 || (nw && op.w === nw) || (nw === 16 && op.w === 16)) { op.o = 'mov'; op.a = r; }
      else if (op.w === 16) { op.o = 'andi'; op.a = r; op.i = 0xFFFF; }
      else if (op.w === 8) { op.o = 'andi'; op.a = r; op.i = 0xFF; }
      else if (op.w === 9) { op.o = 'ext8h'; op.a = r; }
      op.w = 32;
      n++;
    } else if (op.o === 'putr') {
      const nw = narrow.get(op.r);
      const r = op.r;
      delete op.r;
      op.d = r;
      if (op.w === 32 || (nw && op.w === nw)) { op.o = 'mov'; }
      else if (op.w === 16) { op.o = 'merge16'; op.b = op.a; op.a = r; }
      else if (op.w === 8) { op.o = 'merge8l'; op.b = op.a; op.a = r; }
      else if (op.w === 9) { op.o = 'merge8h'; op.b = op.a; op.a = r; }
      op.w = 32;
      n++;
    } else if (op.o === 'gets') {
      op.o = 'mov'; op.a = SEGV + op.s; delete op.s; n++;
    } else if (op.o === 'puts') {
      // A segment load's new base: a guest vreg like any other, written back
      // by FLUSH (the selector went to memory already, through PUTSEL).
      op.o = 'mov'; op.d = SEGV + op.s; delete op.s; n++;
    }
  }
  B.promoted = true;
  B.stats.promoted = n;
}

// ---------------------------------------------------------------------------
// Liveness of vregs over the fast half (dx edges included).
// ---------------------------------------------------------------------------
function vregLiveness(B) {
  const p = B.p;
  const blocks = B.fastBlocks();
  const liveIn = new Map();
  for (const b of blocks) liveIn.set(b.id, new Set());
  const blockLiveIn = (b, liveOut) => {
    const live = new Set(liveOut);
    for (const u of termUses(b.term)) live.add(u);
    for (let i = b.ops.length - 1; i >= 0; i--) {
      const op = b.ops[i];
      const d = opDef(op);
      if (d >= 0) live.delete(d);
      if (op.o === 'reload') for (let r = 0; r < FIRST_TEMP; r++) live.delete(r);
      for (const u of opUses(op)) live.add(u);
      if (op.dx !== undefined && op.dx >= 0 && liveIn.has(op.dx)) for (const u of liveIn.get(op.dx)) live.add(u);
    }
    return live;
  };
  const liveOutOf = (b) => {
    const out = new Set();
    for (const s of IR.succOf(b)) {
      const sb = p.blocks[s];
      if (!sb.fast) continue;
      if (b.ops.some(o => o.dx === s)) continue;       // dx edges are mid-block
      for (const u of liveIn.get(s) || []) out.add(u);
    }
    return out;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k];
      const li = blockLiveIn(b, liveOutOf(b));
      const old = liveIn.get(b.id);
      if (li.size !== old.size || [...li].some(x => !old.has(x))) { liveIn.set(b.id, li); changed = true; }
    }
  }
  return { liveIn, liveOutOf };
}

// ---------------------------------------------------------------------------
// constprop: forward simplification per block + global DCE, to a fixpoint.
// ---------------------------------------------------------------------------
const U32 = (v) => v >>> 0;
const isMask = (m) => m !== 0 && ((m >>> 0) & ((m >>> 0) + 1)) === 0;    // 2^k - 1
const bitsOfConst = (v) => (v >>> 0 === 0 ? 0 : 32 - Math.clz32(v >>> 0));

function evalPure(op, a, b) {
  const i = op.i | 0;
  switch (op.o) {
    case 'mov': return a;
    case 'add': return (a + b) | 0;
    case 'sub': return (a - b) | 0;
    case 'and': return a & b;
    case 'or': return a | b;
    case 'xor': return a ^ b;
    case 'mul': return Math.imul(a, b);
    case 'mulhu': return Number(BigInt.asIntN(32, (BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n));
    case 'mulhs': return Number(BigInt.asIntN(32, (BigInt(a | 0) * BigInt(b | 0)) >> 32n));
    case 'eq': return a === b ? 1 : 0;
    case 'ne': return a !== b ? 1 : 0;
    case 'addi': return (a + i) | 0;
    case 'subi': return (a - i) | 0;
    case 'andi': return a & i;
    case 'ori': return a | i;
    case 'xori': return a ^ i;
    case 'shli': return a << i;
    case 'shri': return a >>> i;
    case 'sari': return a >> i;
    case 'sx8': return (a << 24) >> 24;
    case 'sx16': return (a << 16) >> 16;
    case 'ext8h': return (a >>> 8) & 0xFF;
    case 'merge16': return (a & ~0xFFFF) | (b & 0xFFFF);
    case 'merge8l': return (a & ~0xFF) | (b & 0xFF);
    case 'merge8h': return (a & ~0xFF00) | ((b & 0xFF) << 8);
    case 'addi16': return (a + i) & 0xFFFF;
    case 'addi8': return (a + i) & 0xFF;
    case 'cc': return require('./uop-ref').cond(op.cc, a, op.b >= 0 ? b : op.i | 0, op.w) ? 1 : 0;
    default: return undefined;
  }
}

function constprop(B) {
  let total = 0;
  for (let round = 0; round < 12; round++) {
    let changed = simplifyBlocks(B);
    changed += dce(B);
    total += changed;
    if (!changed) break;
  }
  B.stats.constprop = (B.stats.constprop || 0) + total;
}

// Global facts about single-def temps.
function tempDefs(B) {
  const defs = new Map();
  const count = new Map();
  for (const [b, i, op] of B.allOps()) {
    const d = opDef(op);
    if (d < FIRST_TEMP) continue;
    count.set(d, (count.get(d) || 0) + 1);
    defs.set(d, { b, i, op });
  }
  for (const [d, n] of count) if (n > 1) defs.delete(d);
  return defs;
}
function useCounts(B) {
  const n = new Map();
  const inc = (v) => n.set(v, (n.get(v) || 0) + 1);
  for (const [, , op] of B.allOps()) for (const u of opUses(op)) inc(u);
  for (const b of B.fastBlocks()) for (const u of termUses(b.term)) inc(u);
  return n;
}

function simplifyBlocks(B) {
  const defs = tempDefs(B);
  const uses = useCounts(B);
  let changed = 0;
  // Constant and bit-width facts for single-def temps, computed lazily.
  const konst = (v) => {
    if (v < FIRST_TEMP) return undefined;
    const d = defs.get(v);
    return d && d.op.o === 'movi' ? d.op.i | 0 : undefined;
  };
  const narrowBits = (r) => (B.narrow && B.narrow.get(r)) || 32;
  const bitsMemo = new Map();
  const bits = (v, depth = 0) => {
    if (v < 0) return 32;
    if (v < NREG) return narrowBits(v);
    if (v < FIRST_TEMP) return 32;
    if (bitsMemo.has(v)) return bitsMemo.get(v);
    const d = defs.get(v);
    let r = 32;
    if (d && depth < 8) {
      const op = d.op;
      switch (op.o) {
        case 'movi': r = bitsOfConst(op.i); break;
        case 'andi': r = Math.min(bitsOfConst(op.i), bits(op.a, depth + 1)); break;
        case 'and': r = Math.min(bits(op.a, depth + 1), bits(op.b, depth + 1)); break;
        case 'ld': r = op.w; break;
        case 'ext8h': r = 8; break;
        case 'mov': r = bits(op.a, depth + 1); break;
        case 'cc': case 'eq': case 'ne': case 'flagof': case 'getf': case 'imulov': case 'parity': r = 1; break;
        case 'shri': r = Math.max(0, bits(op.a, depth + 1) - op.i); break;
        case 'or': case 'xor': r = Math.max(bits(op.a, depth + 1), bits(op.b, depth + 1)); break;
        case 'merge8l': r = Math.max(8, bits(op.a, depth + 1)); break;
        case 'merge8h': r = Math.max(16, bits(op.a, depth + 1)); break;
        case 'merge16': r = Math.max(16, bits(op.a, depth + 1)); break;
        case 'addim': r = bitsOfConst(op.m); break;
        default: r = 32;
      }
    }
    bitsMemo.set(v, r);
    return r;
  };
  const defOp = (v) => (v >= FIRST_TEMP && defs.has(v) ? defs.get(v).op : null);
  // coalesce wants the program's current use counts. Every rewrite below
  // touches only the block being walked, so keep the other blocks' counts in
  // `outside` and add this block's back after it -- recounting the whole
  // program per block was quadratic, and on MORBID's 106-insn loop cost more
  // than the µop program saved.
  const outside = useCounts(B);
  const usesOf = (b) => {
    const us = [];
    for (const op of b.ops) us.push(...opUses(op));
    us.push(...termUses(b.term));
    return us;
  };
  const count = (us, sign) => { for (const v of us) outside.set(v, (outside.get(v) || 0) + sign); };

  for (const b of B.fastBlocks()) {
    count(usesOf(b), -1);
    // Within a block: the current value of each guest vreg, as a temp it is
    // known to equal (so later reads can use the temp, or vice versa).
    const eqTemp = new Map();        // guest vreg -> temp holding its value
    const guestCopy = new Map();     // temp -> guest vreg it is a copy of
    const lastDef = new Map();       // guest vreg -> op index of its latest def
    for (let i = 0; i < b.ops.length; i++) {
      const op = b.ops[i];
      // Replace temp operands that are plain copies of another single-def temp.
      if (!op.pin) {
        mapUses(op, (v) => {
          if (v < FIRST_TEMP) return v;
          const d = defOp(v);
          if (d && d.o === 'mov' && d.a >= FIRST_TEMP && defs.has(d.a)) { changed++; return d.a; }
          return v;
        });
      }
      // A copy of a guest vreg made earlier in this block: read the guest
      // vreg itself, while it still holds that value.
      mapUses(op, (v) => (guestCopy.has(v) ? (changed++, guestCopy.get(v)) : v));
      // Constant folding.
      if (PURE.has(op.o) && op.o !== 'movi' && op.o !== 'getr' && op.o !== 'gets' && op.o !== 'getm'
          && op.o !== 'getf' && op.o !== 'getfw' && op.o !== 'flagof' && op.o !== 'ld') {
        const ka = op.a !== undefined && op.a >= 0 ? konst(op.a) : 0;
        const needB = ['add', 'sub', 'and', 'or', 'xor', 'mul', 'mulhu', 'mulhs', 'eq', 'ne', 'merge16', 'merge8l', 'merge8h'].includes(op.o)
          || (op.o === 'cc' && op.b >= 0);
        const kb = needB ? konst(op.b) : 0;
        if (ka !== undefined && kb !== undefined) {
          const v = evalPure(op, ka, kb);
          if (v !== undefined) { rewrite(op, { o: 'movi', d: op.d, i: v | 0 }); changed++; }
        }
      }
      // Algebra. `fwd(D, regs)`: may this op read D's operands `regs` in
      // place of D's result? Yes when they still hold the values D saw:
      // D earlier in this block with no redefinition since, or every one a
      // temp defined ahead of D in D's own block.
      const fwd = (D, regs) => {
        const e = defs.get(D.d);
        if (!e) return false;
        const j = e.b === b ? b.ops.indexOf(D) : -1;
        if (j >= 0 && j < i) {
          for (let k = j + 1; k < i; k++) {
            const x = b.ops[k];
            if (x.o === 'reload' || regs.includes(opDef(x))) return false;
          }
          return true;
        }
        const jd = e.b.ops.indexOf(D);
        return regs.every((r) => {
          if (r < FIRST_TEMP) return false;
          const f = defs.get(r);
          return f && f.b === e.b && f.b.ops.indexOf(f.op) < jd;
        });
      };
      changed += algebra(op, konst, bits, defOp, fwd, B, b, i);
      const d = opDef(op);
      if (d >= FIRST_TEMP) for (const [r, tv] of eqTemp) if (tv === d) eqTemp.delete(r);
      if (d >= 0) {
        guestCopy.delete(d);
        for (const [tv, r] of guestCopy) if (r === d) guestCopy.delete(tv);
        if (op.o === 'mov' && d >= FIRST_TEMP && op.a < FIRST_TEMP && op.a >= 0) guestCopy.set(d, op.a);
      }
      if (op.o === 'reload') guestCopy.clear();
      if (d >= 0 && d < NREG) {
        eqTemp.delete(d);
        if (op.o === 'mov' && op.a >= FIRST_TEMP && defs.has(op.a)) eqTemp.set(d, op.a);
        lastDef.set(d, i);
      }
      if (op.o === 'reload') { eqTemp.clear(); }
      // A guest-vreg read whose value is a known temp: read the temp instead.
      if (op.o === 'mov' && op.a >= 0 && op.a < NREG && eqTemp.has(op.a) && op.d >= FIRST_TEMP) {
        op.a = eqTemp.get(op.a); changed++;
      }
    }
    if (b.term) mapTermUses(b.term, (v) => (guestCopy.has(v) ? (changed++, guestCopy.get(v)) : v));
    const pre = usesOf(b);
    count(pre, +1);                  // now the whole program's counts
    changed += coalesce(B, b, outside);
    count(pre, -1);
    count(usesOf(b), +1);            // what coalesce left behind
  }
  // Branch folding and cc fusion into the terminator.
  for (const b of B.fastBlocks()) {
    const t = b.term;
    if (!t || t.o !== 'bcc') continue;
    const d = defOp(t.a);
    if (t.cc === 'nz' && d && d.o === 'cc' && (uses.get(t.a) || 0) === 1 && t.w === 32
        && d.w !== undefined) {
      t.cc = d.cc; t.a = d.a; t.b = d.b; t.i = d.i; t.w = d.w;
      changed++;
      continue;
    }
    if ((t.cc === 'nz' || t.cc === 'z') && d && (d.o === 'eq' || d.o === 'ne') && (uses.get(t.a) || 0) === 1) {
      // nz(ne a b) and z(eq a b) are `ne`; the other two are `eq`. (This
      // read inverted until a multiply's OF, a `ne`, first reached a jno.)
      const isNe = (d.o === 'ne') === (t.cc === 'nz');
      t.cc = isNe ? 'ne' : 'eq';
      t.a = d.a; t.b = d.b; t.w = 32;
      changed++;
      continue;
    }
    const hasB = t.b !== undefined && t.b >= 0;
    const kbv = hasB ? konst(t.b) : undefined;
    if (hasB && kbv !== undefined) { t.i = kbv; t.b = -1; changed++; }
    const ka = konst(t.a);
    if (ka !== undefined && !(t.b >= 0)) {
      const taken = require('./uop-ref').cond(t.cc, ka, t.i | 0, t.w || 32);
      b.term = taken ? { o: 'br', t: t.t, tx: t.tx, st: t.sT || 0 } : { o: 'br', t: t.f, tx: t.fx, st: t.sF || 0 };
      changed++;
    }
  }
  if (changed) B.cfg();
  return changed;
}

function rewrite(op, n) {
  for (const k of Object.keys(op)) if (!['ip', 'node'].includes(k)) delete op[k];
  Object.assign(op, n);
}

// Local algebraic rules. Returns 1 when it changed the op. A rule that reads
// through a defining op D to D's operands asks fwd(D, operands) first.
function algebra(op, konst, bits, defOp, fwd, B, b, i) {
  const o = op.o;
  const kb = (op.b !== undefined && op.b >= 0) ? konst(op.b) : undefined;
  const ka = (op.a !== undefined && op.a >= 0) ? konst(op.a) : undefined;
  const imm = { add: 'addi', and: 'andi', or: 'ori', xor: 'xori' };
  if (imm[o] && kb !== undefined) { rewrite(op, { o: imm[o], d: op.d, a: op.a, i: kb, w: 32 }); return 1; }
  if (imm[o] && ka !== undefined && o !== 'sub') { rewrite(op, { o: imm[o], d: op.d, a: op.b, i: ka, w: 32 }); return 1; }
  if ((o === 'xor' || o === 'sub') && op.a === op.b) { rewrite(op, { o: 'movi', d: op.d, i: 0 }); return 1; }
  if ((o === 'and' || o === 'or') && op.a === op.b) { rewrite(op, { o: 'mov', d: op.d, a: op.a }); return 1; }
  if (o === 'sub' && kb !== undefined) { rewrite(op, { o: 'addi', d: op.d, a: op.a, i: -kb | 0, w: 32 }); return 1; }
  if (o === 'subi') { rewrite(op, { o: 'addi', d: op.d, a: op.a, i: -op.i | 0, w: 32 }); return 1; }
  if ((o === 'addi' || o === 'ori' || o === 'xori' || o === 'shli' || o === 'shri' || o === 'sari') && (op.i | 0) === 0) {
    rewrite(op, { o: 'mov', d: op.d, a: op.a }); return 1;
  }
  const D = (o !== 'movi' && op.a >= 0) ? defOp(op.a) : null;
  if (o === 'andi') {
    const m = op.i >>> 0;
    if (m === 0xFFFFFFFF || (isMask(m) && bits(op.a) <= bitsOfConst(m))) { rewrite(op, { o: 'mov', d: op.d, a: op.a }); return 1; }
    if (D && D.o === 'andi' && fwd(D, [D.a])) { rewrite(op, { o: 'andi', d: op.d, a: D.a, i: (D.i & op.i) | 0, w: 32 }); return 1; }
    // Arithmetic mod 2^n: ((y & M) + k) & M == (y + k) & M. The sum is a new
    // op (D itself may have other readers); it lands just ahead of this one.
    if (B && B.on('stack') && isMask(m) && D && D.o === 'addi') {
      const E = defOp(D.a);
      if (E && E.o === 'andi' && (E.i >>> 0) === m && fwd(E, [E.a]) && fwd(D, [D.a])) {
        const t = B.temp();
        b.ops.splice(i, 0, { o: 'addi', d: t, a: E.a, i: D.i, w: 32 });
        op.a = t;
        return 1;
      }
    }
  }
  if (o === 'addi' && D && D.o === 'addi' && fwd(D, [D.a])) {
    rewrite(op, { o: 'addi', d: op.d, a: D.a, i: (D.i + op.i) | 0, w: 32 }); return 1;
  }
  if (o === 'merge16' || o === 'merge8l') {
    const lim = o === 'merge16' ? 16 : 8;
    const M = o === 'merge16' ? 0xFFFF : 0xFF;
    if (bits(op.a) <= lim && bits(op.b) <= lim) { rewrite(op, { o: 'mov', d: op.d, a: op.b }); return 1; }
    if (op.a === op.b) { rewrite(op, { o: 'mov', d: op.d, a: op.a }); return 1; }
    // merge(merge(x, y), z): the inner low half is overwritten.
    if (D && D.o === o && fwd(D, [D.a])) { op.a = D.a; return 1; }
    const Bd = op.b >= 0 ? defOp(op.b) : null;
    if (Bd) {
      // merge(a, a & M) == a
      if (Bd.o === 'andi' && (Bd.i >>> 0) === M && Bd.a === op.a && fwd(Bd, [Bd.a])) {
        rewrite(op, { o: 'mov', d: op.d, a: op.a }); return 1;
      }
      // merge(a, (a & M) ^ k) == a ^ k for k within M; likewise |.
      if ((Bd.o === 'xori' || Bd.o === 'ori') && ((Bd.i >>> 0) & ~M) === 0) {
        const C = defOp(Bd.a);
        if (C && C.o === 'andi' && (C.i >>> 0) === M && C.a === op.a && fwd(C, [C.a]) && fwd(Bd, [Bd.a])) {
          rewrite(op, { o: Bd.o, d: op.d, a: op.a, i: Bd.i, w: 32 }); return 1;
        }
      }
      // merge(a, b & M) == merge(a, b)
      if (Bd.o === 'andi' && ((Bd.i >>> 0) & M) === M && fwd(Bd, [Bd.a])) { op.b = Bd.a; return 1; }
    }
  }
  if (o === 'sx8' && bits(op.a) <= 7) { rewrite(op, { o: 'mov', d: op.d, a: op.a }); return 1; }
  if (o === 'sx16' && bits(op.a) <= 15) { rewrite(op, { o: 'mov', d: op.d, a: op.a }); return 1; }
  if (o === 'getm' && op.k !== undefined) { rewrite(op, { o: 'movi', d: op.d, i: op.k }); return 1; }
  return 0;
}

// `t = f(...); ...; r = mov t` with t used only in this block after the mov,
// and r neither read nor written between: make f write r directly.
function coalesce(B, b, uses) {
  let changed = 0;
  for (let i = 0; i < b.ops.length; i++) {
    const mv = b.ops[i];
    if (mv.o !== 'mov' || mv.d < 0 || mv.a < FIRST_TEMP || mv.d === mv.a) continue;
    const t = mv.a, r = mv.d;
    let j = i - 1;
    while (j >= 0 && opDef(b.ops[j]) !== t) j--;
    if (j < 0) continue;
    const src = b.ops[j];
    if (!isPure(src) && src.o !== 'ld') continue;
    // r untouched and t unused between src and mv.
    let ok = true;
    for (let k = j + 1; k < i && ok; k++) {
      const x = b.ops[k];
      if (opUses(x).includes(r) || opDef(x) === r || opUses(x).includes(t)) ok = false;
      if (x.dx !== undefined) ok = false;         // a deopt between must see the old r
      if (x.o === 'reload' || x.o === 'flush') ok = false;
    }
    if (!ok) continue;
    // Every other use of t: after mv in this block, before any redefinition of r.
    let local = 0, redef = false;
    for (let k = i + 1; k < b.ops.length; k++) {
      const x = b.ops[k];
      if (opUses(x).includes(t)) { if (redef) { ok = false; break; } local++; }
      if (opDef(x) === r) redef = true;
    }
    if (!ok) continue;
    const tu = termUses(b.term).filter(u => u === t).length;
    if (tu && redef) continue;
    if ((uses.get(t) || 0) !== 1 + local + tu) continue;
    src.d = r;
    for (let k = i + 1; k < b.ops.length; k++) mapUses(b.ops[k], (v) => (v === t ? r : v));
    mapTermUses(b.term, (v) => (v === t ? r : v));
    b.ops.splice(i, 1);
    i--;
    changed++;
  }
  return changed;
}

function dce(B) {
  const { liveIn, liveOutOf } = vregLiveness(B);
  let removed = 0;
  for (const b of B.fastBlocks()) {
    const live = liveOutOf(b);
    for (const u of termUses(b.term)) live.add(u);
    for (let i = b.ops.length - 1; i >= 0; i--) {
      const op = b.ops[i];
      const d = opDef(op);
      if (isPure(op) && d >= 0 && !live.has(d)) { b.ops.splice(i, 1); removed++; continue; }
      if (op.o === 'mov' && op.d === op.a) { b.ops.splice(i, 1); removed++; continue; }
      if (d >= 0) live.delete(d);
      if (op.o === 'reload') for (let r = 0; r < FIRST_TEMP; r++) live.delete(r);
      for (const u of opUses(op)) live.add(u);
      if (op.dx !== undefined && op.dx >= 0 && liveIn.has(op.dx)) for (const u of liveIn.get(op.dx)) live.add(u);
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Flags: liveness, and forwarding.
// ---------------------------------------------------------------------------
const REC_DEFS = {
  add: ALL6, sub: ALL6, add32: ALL6, sub32: ALL6, logic: ALL6,
  inc: ['p', 'a', 'z', 's', 'o'], dec: ['p', 'a', 'z', 's', 'o'],
  inc32: ['p', 'a', 'z', 's', 'o'], dec32: ['p', 'a', 'z', 's', 'o'],
  mul: ['c', 'o'],
  dsh: ['c', 'o', 'p', 'z', 's'],
};
// A constant-count shift writes CF and OF, and a shift proper SF/ZF/PF too;
// AF is left alone, and a rotate leaves SF/ZF/PF alone as well.
function recDefs(op) {
  if (op.k === 'shift') return op.sh === 'rol' || op.sh === 'ror' ? ['c', 'o'] : ['c', 'o', 'p', 'z', 's'];
  return REC_DEFS[op.k];
}
// Flags a shift certainly writes (a count that is a nonzero constant).
function callhDefs(op, shmask) {
  const n = op.nconst === null || op.nconst === undefined ? 0 : (op.nconst & shmask);
  if (!n) return [];
  return op.sh === 'rol' || op.sh === 'ror' ? ['c', 'o'] : ['c', 'o', 'p', 'z', 's'];
}

// Which flags each flush point needs, by where it goes.
function flushFlags(B, op) {
  if (op.dyn) return new Set(ALL6);          // a return to an unknown address
  return B.liveAt(op.exitIp);
}

// Backward flag liveness. Returns liveAfter per op (Map op -> Set).
function flagLiveness(B) {
  const p = B.p;
  const blocks = B.fastBlocks();
  const liveIn = new Map(blocks.map(b => [b.id, new Set()]));
  const after = new Map();
  const step = (b, out) => {
    const live = new Set(out);
    for (let i = b.ops.length - 1; i >= 0; i--) {
      const op = b.ops[i];
      if (op.dx !== undefined && op.dx >= 0) for (const f of liveIn.get(op.dx) || []) live.add(f);
      after.set(op, new Set(live));
      if (op.o === 'rec') for (const f of recDefs(op)) live.delete(f);
      else if (op.o === 'getcc') for (const f of CC_READS[op.cc]) live.add(f);
      else if (op.o === 'callh') for (const f of callhDefs(op, B.shmask)) live.delete(f);
      else if (op.o === 'flush') for (const f of flushFlags(B, op)) live.add(f);
      else if (op.o === 'reload') live.clear();
    }
    return live;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k];
      const out = new Set();
      for (const s of IR.succOf(b)) {
        if (!p.blocks[s].fast || b.ops.some(o => o.dx === s)) continue;
        for (const f of liveIn.get(s) || []) out.add(f);
      }
      const li = step(b, out);
      const old = liveIn.get(b.id);
      if (li.size !== old.size || [...li].some(x => !old.has(x))) { liveIn.set(b.id, li); changed = true; }
    }
  }
  return { after, liveIn };
}

// Dead-record elimination on the L1 model (flaglive without flagfwd).
function killDeadRecs(B) {
  const { after } = flagLiveness(B);
  let n = 0;
  for (const b of B.fastBlocks()) {
    b.ops = b.ops.filter(op => {
      if (op.o !== 'rec') return true;
      const live = after.get(op);
      if (recDefs(op).some(f => live.has(f))) return true;
      n++;
      return false;
    });
  }
  B.stats.deadRecs = n;
}

// Forwarding. Each flag's SOURCE at a point is a set of rec ops, or 'L1' (the
// lazy record as it stood at a FASTENTER or after a shift helper -- both leave
// the value in L1's state, where a getter can read it). A consumer whose flag
// has one source reads it straight off that producer's operands; one with
// several reads a merge vreg FV_f that every producer of f keeps up to date.
//
// A producer's operands are vregs, and a vreg can be redefined between the
// producer and a consumer -- a loop whose consumer comes around the back edge
// to its own producer's instruction, or a promoted register the producer read
// and a later instruction wrote. The dataflow tracks, per point, which
// producers are DIRTY that way, and a consumer of a dirty producer goes
// through FV_f as well.
function forwardFlags(B) {
  const p = B.p;
  const blocks = B.fastBlocks();
  const { after: liveAfter } = flagLiveness(B);
  const L1 = 'L1';
  const REC_OPS = ['a', 'b', 's', 'r', 'cin', 'nz'];
  // A shift by a nonzero constant (under the shift-mask guard) is computed
  // inline, with a SHIFT record in place of the helper's direct flag write.
  if (B.on('guards')) {
    for (const b of blocks) {
      for (let i = 0; i < b.ops.length; i++) {
        const op = b.ops[i];
        if (op.o !== 'callh' || op.nconst === null || op.nconst === undefined) continue;
        const n = op.nconst & B.shmask;
        if (!n) continue;
        // The record reads the shift's INPUT and goes in after the rest of the
        // instruction -- after the promoted write-back `mov edx = t` too. So
        // when the shift, or anything between it and the record, writes the
        // register the input came from (rol dx,1 is exactly that), the record
        // would see the rotated value: keep the input in a temp. Dead flags
        // take the rec and the copy out together.
        let j = i + 1;
        while (j < b.ops.length && b.ops[j].node === op.node) j++;
        let src = op.a;
        const clobbered = op.d === op.a || b.ops.slice(i + 1, j).some(x => opDef(x) === op.a);
        if (clobbered) {
          src = B.temp();
          b.ops.splice(i, 0, { o: 'mov', d: src, a: op.a, w: 32, node: op.node, ip: op.ip });
          i++; j++;
        }
        const rec = { o: 'rec', k: 'shift', sh: op.sh, w: op.w, a: src, i: n, r: op.d, node: op.node, ip: op.ip };
        rewrite(op, { o: 'shift', d: op.d, a: op.a, sh: op.sh, w: op.w, i: n });
        b.ops.splice(j, 0, rec);
      }
    }
  }
  // An inc/dec's operand is its result less one: derive it, and the producer
  // keeps only the result alive.
  for (const [, , op] of B.allOps()) {
    if (op.o === 'rec' && ['inc', 'dec', 'inc32', 'dec32'].includes(op.k)) { op.a = -1; op.s = -1; }
  }
  const readsOf = new Map();
  for (const [, , op] of B.allOps()) {
    if (op.o === 'rec') readsOf.set(op, new Set(REC_OPS.map(f => op[f]).filter(x => x !== undefined && x >= 0)));
  }
  const empty = () => ({ ...Object.fromEntries(ALL6.map(f => [f, new Set()])), dirty: new Set() });
  const copy = (s) => ({ ...Object.fromEntries(ALL6.map(f => [f, new Set(s[f])])), dirty: new Set(s.dirty) });
  const join = (into, o) => { for (const f of [...ALL6, 'dirty']) for (const x of o[f]) into[f].add(x); };
  const eq = (x, y) => [...ALL6, 'dirty'].every(f => x[f].size === y[f].size && [...x[f]].every(v => y[f].has(v)));
  const before = new Map();
  const transfer = (op, s) => {
    const d = opDef(op);
    const clobbers = (x) => {
      for (const f of ALL6) for (const src of s[f]) if (src !== L1 && readsOf.get(src).has(x)) s.dirty.add(src);
    };
    if (d >= 0) clobbers(d);
    if (op.o === 'reload') for (let r = 0; r < FIRST_TEMP; r++) clobbers(r);
    if (op.o === 'rec') { for (const f of recDefs(op)) s[f] = new Set([op]); s.dirty.delete(op); }
    else if (op.o === 'callh' || op.o === 'reload') for (const f of ALL6) s[f] = new Set([L1]);
  };
  const run = (b, s) => {
    s = copy(s);
    for (const op of b.ops) { before.set(op, copy(s)); transfer(op, s); }
    return s;
  };
  const srcIn = new Map();
  const outOf = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of blocks) {
      let inS = null;
      const add = (o) => { if (!inS) inS = copy(o); else join(inS, o); };
      if (b.kind === 'fenter') add(empty());
      for (const q of b.preds) {
        const qb = p.blocks[q];
        if (!qb.fast) continue;
        const viaDx = qb.ops.filter(op => op.dx === b.id);
        if (viaDx.length) { for (const op of viaDx) if (before.has(op)) add(before.get(op)); } else if (outOf.has(q)) add(outOf.get(q));
      }
      if (!inS) continue;
      const old = srcIn.get(b.id);
      if (old && eq(old, inS) && outOf.has(b.id)) continue;
      srcIn.set(b.id, inS);
      outOf.set(b.id, run(b, inS));
      changed = true;
    }
  }

  // Consumers, and the flags each one needs.
  const needOf = (op) => {
    if (op.o === 'getcc') return CC_READS[op.cc];
    if (op.o === 'flush') return [...flushFlags(B, op)];
    if (op.o === 'callh') {
      const live = liveAfter.get(op) || new Set(ALL6);
      const defs = callhDefs(op, B.shmask);
      return [...live].filter(f => !defs.includes(f));
    }
    return null;
  };
  // A source set is DIRECT when it is one clean producer, or L1 alone.
  const direct = (pre, f) => {
    const s = pre[f];
    if (s.size !== 1) return false;
    const [src] = s;
    return src === L1 || !pre.dirty.has(src);
  };
  const needFV = new Set();
  for (const b of blocks) {
    for (const op of b.ops) {
      const need = needOf(op);
      if (!need || !before.has(op)) continue;
      for (const f of need) if (!direct(before.get(op), f)) needFV.add(f);
    }
  }
  const FV = {};
  for (const f of needFV) FV[f] = B.temp();
  B.stats.flagMerge = [...needFV].join('') || '-';

  // One flag of a producer, carrying only the operands that flag reads.
  const flagOf = (rec, f, out) => {
    const d = B.temp();
    const op = { o: 'flagof', d, f, k: rec.k, w: rec.w, pin: true };
    for (const x of flagOperands(rec, f)) op[x] = rec[x];
    if (rec.k === 'shift' || rec.k === 'dsh') { op.sh = rec.sh; op.i = rec.i; }
    out.push(op);
    return d;
  };
  const valueOf = (f, pre, out) => {
    if (!direct(pre, f)) return FV[f];
    const [src] = pre[f];
    if (src === L1) { const d = B.temp(); out.push({ o: 'getf', d, f }); return d; }
    return flagOf(src, f, out);
  };
  const reloadFV = (ops) => { for (const f of ALL6) if (FV[f] !== undefined) ops.push({ o: 'getf', d: FV[f], f }); };

  // Write the live flags into L1's record: one record rewrite when a single
  // clean producer defines all of them, else the individual bits.
  const materialize = (need, pre, ops) => {
    const own = need.filter(f => !(direct(pre, f) && pre[f].has(L1)));
    if (!own.length) return;
    const one = own.every(f => direct(pre, f)) ? new Set(own.map(f => [...pre[f]][0])) : null;
    if (one && one.size === 1) {
      const [P] = one;
      const covered = recDefs(P);
      if (P.k !== 'mul' && P.k !== 'shift' && P.k !== 'dsh' && own.every(f => covered.includes(f))) {
        const w = { o: 'wrec', k: P.k, w: P.w, a: P.a, b: P.b, s: P.s, r: P.r, cin: P.cin, fcf: -2, pin: true };
        if (['inc', 'dec', 'inc32', 'dec32'].includes(P.k) && need.includes('c')) w.fcf = valueOf('c', pre, ops);
        ops.push(w);
        return;
      }
    }
    const w = { o: 'wflags' };
    for (const f of FLAG_FIELDS) w[f] = -1;
    for (const f of own) w[`f${f}`] = valueOf(f, pre, ops);
    ops.push(w);
  };

  let fused = 0, composed = 0;
  for (const b of blocks) {
    const ops = [];
    for (const op of b.ops) {
      const pre = before.get(op);
      if (!pre) { if (op.o !== 'rec') ops.push(op); continue; }     // unreachable
      if (op.o === 'rec') {
        const live = liveAfter.get(op) || new Set(ALL6);
        for (const f of recDefs(op)) {
          if (FV[f] !== undefined && live.has(f)) ops.push({ o: 'mov', d: FV[f], a: flagOf(op, f, ops) });
        }
        continue;
      }
      if (op.o === 'getcc') {
        const need = CC_READS[op.cc];
        const srcs = need.map(f => (direct(pre, f) ? [...pre[f]][0] : null));
        if (srcs[0] && srcs[0] !== L1 && srcs.every(x => x === srcs[0])) {
          const fz = fuseCC(srcs[0], op.cc);
          if (fz) { ops.push({ ...fz, d: op.d, ip: op.ip, node: op.node, pin: true }); fused++; continue; }
        }
        const vals = {};
        for (const f of need) vals[f] = valueOf(f, pre, ops);
        composeCC(op.cc, vals, op.d, ops, B);
        composed++;
        continue;
      }
      if (op.o === 'callh') {
        materialize(needOf(op), pre, ops);
        ops.push(op);
        reloadFV(ops);
        continue;
      }
      if (op.o === 'flush') {
        materialize(needOf(op), pre, ops);
        ops.push(op);
        continue;
      }
      ops.push(op);
      if (op.o === 'reload') reloadFV(ops);
    }
    b.ops = ops;
  }
  B.stats.flagFused = fused;
  B.stats.flagComposed = composed;
}

// Which of a record's operands one of its flags depends on (the recorders in
// uop-ref.js / emit.js: an 8/16-bit add/sub keeps its unmasked sum, so its
// carry, zero, sign and parity need nothing else).
function flagOperands(rec, f) {
  const k = rec.k;
  const has = (x) => rec[x] !== undefined && rec[x] >= 0;
  const pick = (...xs) => xs.filter(has);
  switch (k) {
    case 'add': case 'sub': return (f === 'a' || f === 'o') ? pick('a', 'b', 's') : pick('s');
    case 'add32': return f === 'c' ? pick('a', 'r', 'cin') : (f === 'a' || f === 'o') ? pick('a', 'b', 'r') : pick('r');
    case 'sub32': return f === 'c' ? pick('a', 'b', 'cin') : (f === 'a' || f === 'o') ? pick('a', 'b', 'r') : pick('r');
    case 'logic': return pick('r');
    case 'inc': case 'dec': case 'inc32': case 'dec32': return pick('a', 's', 'r');
    case 'mul': return pick('nz');
    case 'shift': return pick('a');
    case 'dsh': return f === 'c' ? pick('a') : f === 'o' ? pick('a', 'r') : pick('r');
    default: return pick('a', 'b', 's', 'r', 'cin', 'nz');
  }
}

// A condition code from one producer's operands, as a single `cc` op, or null.
function fuseCC(P, cc) {
  const w = P.w;
  const name = IR.CC_NAMES[cc];
  const cmp = (c, a, b, i) => ({ o: 'cc', cc: c, a, b: b === undefined ? -1 : b, i: i || 0, w });
  const onR = (c) => ({ o: 'cc', cc: c, a: P.r, b: -1, i: 0, w });
  const noCarryIn = (P.cin === undefined || P.cin < 0) && !P.adc;
  switch (P.k) {
    case 'sub': case 'sub32': {
      if (!noCarryIn) break;
      const m = { b: 'ltu', ae: 'geu', e: 'eq', ne: 'ne', be: 'leu', a: 'gtu', l: 'lt', ge: 'ge', le: 'le', g: 'gt' }[name];
      if (m) return cmp(m, P.a, P.b);
      if (name === 's') return onR('s');
      if (name === 'ns') return onR('ns');
      if (name === 'p') return onR('p');
      if (name === 'np') return onR('np');
      break;
    }
    case 'add': case 'add32':
      if (!noCarryIn) break;
      // fallthrough
    case 'inc': case 'dec': case 'inc32': case 'dec32': {
      const m = { e: 'z', ne: 'nz', s: 's', ns: 'ns', p: 'p', np: 'np' }[name];
      if (m) return onR(m);
      break;
    }
    case 'logic': {
      const m = { e: 'z', ne: 'nz', s: 's', ns: 'ns', be: 'z', a: 'nz', l: 's', ge: 'ns', p: 'p', np: 'np' }[name];
      if (m) return onR(m);
      if (name === 'le') return cmp('le', P.r, -1, 0);
      if (name === 'g') return cmp('gt', P.r, -1, 0);
      if (name === 'b' || name === 'o') return { o: 'movi', i: 0 };
      if (name === 'ae' || name === 'no') return { o: 'movi', i: 1 };
      break;
    }
    case 'dsh': {
      const m = { e: 'z', ne: 'nz', s: 's', ns: 'ns', p: 'p', np: 'np' }[name];
      if (m) return onR(m);
      break;
    }
    case 'shift': {
      if (P.sh === 'rol' || P.sh === 'ror') break;
      const m = { e: 'z', ne: 'nz', s: 's', ns: 'ns', p: 'p', np: 'np' }[name];
      if (m) return onR(m);
      break;
    }
    case 'mul': {
      if (name === 'o' || name === 'b') return { o: 'cc', cc: 'nz', a: P.nz, b: -1, i: 0, w: 32 };
      if (name === 'no' || name === 'ae') return { o: 'cc', cc: 'z', a: P.nz, b: -1, i: 0, w: 32 };
      break;
    }
    default: break;
  }
  return null;
}

// A condition code from individual flag bits (0/1 vregs).
function composeCC(cc, v, d, ops, B) {
  const t = () => B.temp();
  let r;
  switch (cc >> 1) {
    case 0: r = v.o; break;
    case 1: r = v.c; break;
    case 2: r = v.z; break;
    case 3: { r = t(); ops.push({ o: 'or', d: r, a: v.c, b: v.z }); break; }
    case 4: r = v.s; break;
    case 5: r = v.p; break;
    case 6: { r = t(); ops.push({ o: 'xor', d: r, a: v.s, b: v.o }); break; }
    default: {
      const x = t(); ops.push({ o: 'xor', d: x, a: v.s, b: v.o });
      r = t(); ops.push({ o: 'or', d: r, a: v.z, b: x });
    }
  }
  if (cc & 1) ops.push({ o: 'xori', d, a: r, i: 1, w: 32 });
  else ops.push({ o: 'mov', d, a: r });
}

// ---------------------------------------------------------------------------
// The clock.
// ---------------------------------------------------------------------------
// Without the pass: the fast half keeps the slow half's clock -- STEP 1 after
// every instruction and the budget test on every transfer -- and a deopt owes
// no refund. With it: charges move onto edges, one CHECK per header.
function stripClock(B) {
  for (const b of B.fastBlocks().filter(x => x.kind === 'body' || x.kind === 'pre')) {
    b.ops = b.ops.filter(o => o.o !== 'step');
    const t = b.term;
    if (t.o === 'br') t.tx = -1;
    if (t.o === 'bcc') { t.tx = -1; t.fx = -1; }
  }
}
function clock(B) {
  const p = B.p;
  const blocks = B.fastBlocks().filter(b => b.kind === 'body' || b.kind === 'pre');
  const n = (b) => b.nodes.length;
  stripClock(B);
  B.cfg();
  // Charge every edge into a counted block with that block's count.
  const isCounted = (id) => { const x = p.blocks[id]; return x.fast && (x.kind === 'body' || x.kind === 'pre'); };
  const prepaid = new Map();
  for (const b of blocks) prepaid.set(b.id, n(b));
  const charge = (from, to) => (isCounted(to) ? n(p.blocks[to]) : 0);
  for (const b of B.fastBlocks()) {
    const t = b.term;
    if (!t) continue;
    if (t.o === 'br') t.st = (t.st || 0) + charge(b.id, t.t);
    else if (t.o === 'bcc') { t.sT = (t.sT || 0) + charge(b.id, t.t); t.sF = (t.sF || 0) + charge(b.id, t.f); }
  }
  // Hoist: a non-header counted block with one plain exit pays its
  // successor's charge on its own in-edges instead.
  const edgeCharge = (b) => (b.term.o === 'br' ? b.term.st || 0 : 0);
  let moved = true;
  while (moved) {
    moved = false;
    for (const b of blocks) {
      if (b.header || b.term.o !== 'br' || !edgeCharge(b)) continue;
      if (b.ops.some(o => o.o === 'check')) continue;
      const x = b.term.st;
      const preds = b.preds.filter(q => p.blocks[q].fast);
      if (preds.length !== b.preds.length) continue;
      // Every in-edge must be a terminator edge that can carry it.
      let ok = preds.length > 0;
      for (const q of preds) {
        const qb = p.blocks[q];
        if (qb.ops.some(o => o.dx === b.id)) ok = false;
        if (qb.kind === 'fenter') ok = false;
      }
      if (!ok) continue;
      for (const q of preds) {
        const t = p.blocks[q].term;
        if (t.o === 'br' && t.t === b.id) t.st += x;
        if (t.o === 'bcc') { if (t.t === b.id) t.sT += x; if (t.f === b.id) t.sF += x; }
      }
      b.term.st = 0;
      prepaid.set(b.id, prepaid.get(b.id) + x);
      moved = true;
    }
  }
  // Longest path, in instructions, from each header to the next header or
  // out of the fast half.
  const memo = new Map();
  const longest = (id, first) => {
    const b = p.blocks[id];
    if (!isCounted(id)) return 0;
    if (!first && b.header) return 0;
    if (memo.has(id)) return memo.get(id);
    memo.set(id, 0);
    let best = 0;
    const t = b.term;
    const outs = t.o === 'br' ? [t.t] : t.o === 'bcc' ? [t.t, t.f] : [];
    for (const s of outs) best = Math.max(best, longest(s, false));
    const v = n(b) + best;
    memo.set(id, v);
    return v;
  };
  for (const b of blocks) {
    if (!b.header) continue;
    memo.clear();
    const M = longest(b.id, true);
    const c = b.ops.find(o => o.o === 'check');
    if (c) { c.m = M - prepaid.get(b.id); c.M = M; continue; }
    b.ops.unshift({ o: 'check', m: M - prepaid.get(b.id), M, node: b.nodes[0], dx: B.deopt(b.nodes[0]) });
  }
  B.prepaid = prepaid;
  B.clocked = true;
  B.cfg();
}

// ---------------------------------------------------------------------------
// Finishing: expand FLUSH / RELOAD, set deopt refunds.
// ---------------------------------------------------------------------------
function finalize(B) {
  const p = B.p;
  // Registers the fast half writes, and the ones it reads at all.
  const written = new Set(), used = new Set();
  for (const [, , op] of B.allOps()) {
    if (op.o === 'flush' || op.o === 'reload') continue;
    const d = opDef(op);
    if (d >= 0 && d < FIRST_TEMP) written.add(d);
    for (const u of opUses(op)) if (u < FIRST_TEMP) used.add(u);
  }
  for (const b of B.fastBlocks()) for (const u of termUses(b.term)) if (u < FIRST_TEMP) used.add(u);
  for (const r of written) used.add(r);
  const width = (r) => (B.narrow && B.narrow.get(r)) || 32;
  // Resident: guest vreg r IS register r's slot in memory (isa.js REGFILE_*,
  // uop-wasm.js VFILE), so a RELOAD and a FLUSH are copies of a location onto
  // itself and vanish. What does not vanish is narrowness: a register
  // mergesink keeps at 16 (or 8) bits holds garbage above them in the
  // promoted model, and here its upper bits are the architectural ones -- so
  // every write to it stores only its low bits (DW).
  const resident = B.promoted && B.on('resident');
  // resident: 'promote' -- the register file stays the home of every register,
  // but one the region writes narrow is renamed to a temp for the region's
  // lifetime: copied in at FASTENTER, merged back at exits and deopts. Its
  // writes inside the loop are then full-width writes to a temp (no merge, no
  // narrow store), and the one narrow store happens where the region leaves.
  const hold = new Map();        // reg -> temp
  if (resident && B.passes.resident === 'promote') {
    // ...and one it only READS narrow as well, zero-extended on the way in:
    // the promoted model's consumers of a narrow register read it clean (its
    // own reload is a getr at that width), and its resident slot holds the
    // architectural upper bits. `shld [si],dx,7` shifted edx's upper half
    // into the result from a straight line that never wrote dx
    // (test-toyvm-uop-only DSHIFT). Only the written ones merge back.
    for (const r of [...used].sort((x, y) => x - y)) if (r < NREG && width(r) !== 32) hold.set(r, B.temp());
    const ren = (v) => (hold.has(v) ? hold.get(v) : v);
    for (const [, , op] of B.allOps()) {
      if (op.o === 'flush' || op.o === 'reload') continue;
      mapUses(op, ren);
      if (hold.has(opDef(op))) op.d = hold.get(op.d);
    }
    for (const b of B.fastBlocks()) mapTermUses(b.term, ren);
    B.stats.held = hold.size;
  }
  if (resident) {
    for (const [, , op] of B.allOps()) {
      const d = opDef(op);
      if (d >= 0 && d < NREG && width(d) !== 32) op.dw = width(d);
    }
    B.p.resident = B.passes.resident === true ? true : 'full';
  }
  // blockflush (the baselineBF proxy): what a chained per-block tier pays when
  // registers are NOT resident -- every body block reloads the guest vregs it
  // touches on entry and writes back the ones it wrote before its terminator,
  // as if each block were its own program. Correct anywhere (the values are
  // current at every boundary); only its cost is the point.
  if (B.promoted && !resident && B.on('blockflush')) {
    for (const b of B.fastBlocks()) {
      if (b.kind !== 'body') continue;
      const bu = new Set(), bw = new Set();
      for (const op of b.ops) {
        const d = opDef(op);
        if (d >= 0 && d < FIRST_TEMP) bw.add(d);
        for (const u of opUses(op)) if (u < FIRST_TEMP) bu.add(u);
      }
      for (const u of termUses(b.term)) if (u < FIRST_TEMP) bu.add(u);
      const load = [...bu].sort((x, y) => x - y).map((r) => (r < NREG ? { o: 'getr', d: r, r, w: width(r) } : { o: 'gets', d: r, s: r - SEGV }));
      const store = [...bw].sort((x, y) => x - y).map((r) => (r < NREG ? { o: 'putr', r, w: width(r), a: r } : { o: 'puts', s: r - SEGV, a: r }));
      b.ops.unshift(...load);
      b.ops.push(...store);
    }
    B.stats.blockflush = true;
  }
  const MERGE = { 16: 'merge16', 8: 'merge8l' };
  for (const [b, , op] of [...B.allOps()]) {
    if (resident && op.o === 'reload') {
      // Zero-extended to the width it is kept at, as the promoted model's own
      // reload (getr at that width) does: its consumers read it as a clean
      // 16/8-bit value. A full copy carried eax's upper half into `add di,ax`'s
      // CF (a straight line entered at `setz ah`, test-toyvm-uop-only DSHIFT).
      const ops = [...hold].map(([r, t]) => ({ o: 'andi', d: t, a: r, i: width(r) === 8 ? 0xFF : 0xFFFF, w: 32 }));
      b.ops.splice(b.ops.indexOf(op), 1, ...ops);
    } else if (resident && op.o === 'flush') {
      const ops = [...hold].filter(([r]) => written.has(r)).map(([r, t]) => ({ o: MERGE[width(r)], d: r, a: r, b: t }));
      b.ops.splice(b.ops.indexOf(op), 1, ...ops);
    } else if (op.o === 'reload') {
      const ops = [];
      if (B.promoted) {
        for (const r of [...used].sort((x, y) => x - y)) {
          if (r < NREG) ops.push({ o: 'getr', d: r, r, w: width(r) });
          else ops.push({ o: 'gets', d: r, s: r - SEGV });
        }
      }
      b.ops.splice(b.ops.indexOf(op), 1, ...ops);
    } else if (op.o === 'flush') {
      const ops = [];
      if (B.promoted) {
        for (const r of [...written].sort((x, y) => x - y)) {
          ops.push(r < NREG ? { o: 'putr', r, w: width(r), a: r } : { o: 'puts', s: r - SEGV, a: r });
        }
      }
      b.ops.splice(b.ops.indexOf(op), 1, ...ops);
    }
  }
  // Deopt refunds: the steps charged ahead for instructions not yet run.
  // Per deopt SITE: the holder block's prepaid steps less the instructions
  // of it already run. Sites that disagree get their own copy of the stub.
  if (B.clocked) {
    const refundOf = new Map();
    for (const b of B.fastBlocks()) {
      if (b.kind !== 'body') continue;
      for (const op of b.ops) {
        if (op.dx === undefined || op.dx < 0 || p.blocks[op.dx].kind !== 'deopt') continue;
        if (op.o === 'pout') continue;              // below
        const j = b.nodes.indexOf(op.node);
        if (j < 0) throw new Error(`finalize: deopt site for ${op.node} outside its block`);
        const refund = (B.prepaid.get(b.id) || 0) - j;
        let sid = op.dx;
        if (refundOf.has(sid) && refundOf.get(sid) !== refund) {
          const c = B.block('deopt');
          const orig = p.blocks[sid];
          Object.assign(c, { fast: true, nodes: [], node: orig.node, ip: orig.ip, ops: clone(orig.ops), term: clone(orig.term), after: orig.after });
          sid = c.id;
          op.dx = sid;
        }
        refundOf.set(sid, refund);
        p.blocks[sid].term.st = -refund;
      }
    }
    // A port read hands L1 its clock: the steps charged ahead less those of
    // the instructions not yet run, the read's own included (L1 charges an
    // op before its handler runs).
    for (const b of B.fastBlocks()) {
      if (b.kind !== 'body') continue;
      for (const op of b.ops) {
        if (op.o !== 'pin' && op.o !== 'pout') continue;
        const j = b.nodes.indexOf(op.node);
        if (j < 0) throw new Error(`finalize: port access at ${op.node} outside its block`);
        op.adj = (B.prepaid.get(b.id) || 0) - j - 1;
      }
    }
  }
  // A cut port write sets $steps to what it handed back less adj, so its
  // stub adds adj back: the slow half starts at L1's own count. Unclocked,
  // adj is -1 and the stub charges the write's STEP the deopt skipped.
  for (const b of B.fastBlocks()) {
    if (b.kind !== 'body') continue;
    for (const op of b.ops) {
      if (op.o !== 'pout' || op.dx === undefined || op.dx < 0) continue;
      const d = p.blocks[op.dx];
      if (!d.after) throw new Error('finalize: port write deopt is not its own stub');
      d.term.st = -op.adj;
    }
  }
  // Machine guards at every FASTENTER: fail straight into the slow block.
  for (const b of B.fastBlocks()) {
    if (b.kind !== 'fenter') continue;
    const h = p.blocks[b.header_of];
    const slow = B.slowOf.get(h.nodes[0]);
    const g = (B.machineGuards || []).map(x => ({ o: 'guard', g: x.g, v: x.v, dx: slow }));
    b.ops.unshift(...g);
  }
  // Temps defined in slow blocks were numbered before the fast ones: fine.
  p.fastHead = B.fastHead;
  B.cfg();
}

// ---------------------------------------------------------------------------
// Cold sinking: a pure op whose result only the off-trace stubs (deopts and
// exits) read -- typically an operand kept alive for a flag the exit has to
// materialize -- moves into those stubs, when every path from it to them
// leaves its operands alone.
// ---------------------------------------------------------------------------
const isCold = (b) => b.kind === 'deopt' || b.kind === 'fexit';
function availableAlong(B, b0, i0, X) {
  const p = B.p;
  const operands = new Set(opUses(X));
  // A read of the register file names its register by NUMBER, not as a vreg
  // operand, so a write to that register is a kill the operand set misses.
  const kills = X.o === 'getr' ? (op) => op.o === 'putr' && op.r === X.r
    : X.o === 'gets' ? (op) => op.o === 'puts' && op.s === X.s
      : X.o === 'getsel' ? (op) => op.o === 'putsel' && op.s === X.s : () => false;
  const inV = new Map();
  const work = [];
  const flow = (bid, val) => {
    if (!p.blocks[bid].fast) return;
    const old = inV.get(bid);
    const nv = old === undefined ? val : (old && val);
    if (old !== nv) { inV.set(bid, nv); work.push(bid); }
  };
  const walk = (b, from, val) => {
    for (let k = from; k < b.ops.length; k++) {
      const op = b.ops[k];
      if (op.dx !== undefined && op.dx >= 0) flow(op.dx, val);
      if (b === b0 && k === i0) { val = true; continue; }
      if (op.o === 'reload' || operands.has(opDef(op)) || kills(op)) val = false;
    }
    const t = b.term;
    if (t && t.o === 'br') flow(t.t, val);
    if (t && t.o === 'bcc') { flow(t.t, val); flow(t.f, val); }
  };
  walk(b0, i0 + 1, true);
  while (work.length) { const id = work.pop(); walk(p.blocks[id], 0, inV.get(id)); }
  return inV;
}
function sinkCold(B) {
  const p = B.p;
  let moved = 0;
  for (let round = 0; round < 64; round++) {
    const where = new Map();
    const note = (t, id) => { if (t >= FIRST_TEMP) { if (!where.has(t)) where.set(t, new Set()); where.get(t).add(id); } };
    for (const b of B.fastBlocks()) {
      for (const op of b.ops) for (const u of opUses(op)) note(u, b.id);
      for (const u of termUses(b.term)) note(u, b.id);
    }
    const defs = tempDefs(B);
    let done = false;
    for (const [t, { b, op }] of defs) {
      if (!isPure(op) || op.o === 'ld' || isCold(b) || b.kind !== 'body') continue;
      const ub = where.get(t);
      if (!ub || [...ub].some(id => !isCold(p.blocks[id]))) continue;
      const i = b.ops.indexOf(op);
      const inV = availableAlong(B, b, i, op);
      if ([...ub].some(id => inV.get(id) !== true)) continue;
      b.ops.splice(i, 1);
      for (const id of ub) p.blocks[id].ops.unshift(clone(op));
      moved++;
      done = true;
      break;
    }
    if (!done) break;
  }
  B.stats.sunk = moved;
}

// Unreachable fast blocks (exit stubs for edges the passes removed).
function prune(B) {
  const p = B.p;
  const seen = new Set([p.entry]);
  const st = [p.entry];
  // finalize gives every FASTENTER machine guards that fail into the slow
  // block of its header, so those blocks stay even with no edge in yet.
  for (const b of p.blocks) {
    if (b.kind !== 'fenter' || !b.fast) continue;
    const s = B.slowOf.get(p.blocks[b.header_of].nodes[0]);
    if (s !== undefined && !seen.has(s)) { seen.add(s); st.push(s); }
  }
  while (st.length) {
    const id = st.pop();
    for (const s of IR.succOf(p.blocks[id])) if (!seen.has(s)) { seen.add(s); st.push(s); }
  }
  for (const b of p.blocks) if (!seen.has(b.id) && b.kind !== 'dead') { b.kind = 'dead'; b.ops = []; b.term = null; }
  B.cfg();
}

// ---------------------------------------------------------------------------
// addrfold: a memory op's address is [a + (c << sc) + i] & am (am 0 = none).
// Fold the ops that computed it, innermost last, within the block.
// ---------------------------------------------------------------------------
function addrfold(B) {
  let n = 0;
  for (const b of B.fastBlocks()) {
    for (let m = 0; m < b.ops.length; m++) {
      const M = b.ops[m];
      if (M.o !== 'ld' && M.o !== 'st') continue;
      const localDef = (x) => {
        if (x < FIRST_TEMP) return null;
        for (let j = m - 1; j >= 0; j--) if (opDef(b.ops[j]) === x) return j;
        return null;
      };
      const clean = (j, regs) => {
        for (let k = j + 1; k < m; k++) if (regs.includes(opDef(b.ops[k])) || b.ops[k].o === 'reload') return false;
        return true;
      };
      for (let guard = 0; guard < 8; guard++) {
        let did = false;
        const j = M.a >= 0 ? localDef(M.a) : null;
        if (j !== null) {
          const D = b.ops[j];
          if (D.o === 'andi' && !M.am && !M.i && M.c < 0 && isMask(D.i) && clean(j, [D.a])) { M.a = D.a; M.am = D.i; did = true; }
          else if (D.o === 'addi' && clean(j, [D.a])) { M.a = D.a; M.i = (M.i + D.i) | 0; did = true; }
          else if (D.o === 'mov' && clean(j, [D.a])) { M.a = D.a; did = true; }
          else if (D.o === 'movi' && M.c < 0) { M.a = -1; M.i = (M.i + D.i) | 0; did = true; }
          else if (D.o === 'add' && M.c < 0 && clean(j, [D.a, D.b])) { M.a = D.a; M.c = D.b; M.sc = 0; did = true; }
        }
        const jc = M.c >= 0 ? localDef(M.c) : null;
        if (!did && jc !== null) {
          const D = b.ops[jc];
          if (D.o === 'shli' && !M.sc && D.i <= 3 && clean(jc, [D.a])) { M.c = D.a; M.sc = D.i; did = true; }
          else if (D.o === 'mov' && clean(jc, [D.a])) { M.c = D.a; did = true; }
        }
        if (!did) break;
        n++;
      }
    }
  }
  B.stats.addrfold = n;
  if (n) dce(B);
}

// ---------------------------------------------------------------------------
// fuse: µop superinstructions, picked from the pair census (uop-bench.js
// pairs): `andi (addi x k) 0xFFFF` -> addi16, the same at 0xFF -> addi8.
// ---------------------------------------------------------------------------
function fuse(B) {
  const uses = useCounts(B);
  let n = 0;
  for (const b of B.fastBlocks()) {
    for (let i = 0; i < b.ops.length; i++) {
      const op = b.ops[i];
      if (op.o !== 'andi' || (op.i !== 0xFFFF && op.i !== 0xFF) || op.a < FIRST_TEMP) continue;
      let j = i - 1;
      while (j >= 0 && opDef(b.ops[j]) !== op.a) j--;
      if (j < 0) continue;
      const D = b.ops[j];
      if (D.o !== 'addi' || (uses.get(op.a) || 0) !== 1) continue;
      let ok = true;
      for (let k = j + 1; k < i; k++) if (opDef(b.ops[k]) === D.a || b.ops[k].o === 'reload') ok = false;
      if (!ok) continue;
      rewrite(op, { o: op.i === 0xFFFF ? 'addi16' : 'addi8', d: op.d, a: D.a, i: D.i });
      b.ops.splice(j, 1);
      i--;
      n++;
    }
  }
  B.stats.fused = n;
}

// ---------------------------------------------------------------------------
// rle / stack: redundant-load elimination and store-to-load forwarding over
// each block. `stack` covers accesses through SS (a pop meeting its push, a
// ret meeting its call's return address, a [bp+k] local read twice) and
// `rle` everything else.
//
// Addresses compare by VALUE, not by vreg: every instruction computes its own
// address temp, so two `[bp+4]` are two different temps holding one value.
// A value number is { b, k, h, f }: base b plus constant k. h marks a value
// equal to b+k in its LOW 16 BITS only (a 16-bit register write, merge16);
// it matches under a 0xFFFF address mask and, elsewhere, only by its full
// identity f. An `andi 0xFFFF`/`addi16` result is zero-extended, so its full
// identity is fixed by (b, k) too -- the form a 16-bit `[bp+k]` takes before
// addrfold, where it is an `andi (add bp k) 0xFFFF` fed to an unmasked load.
//
// A remembered value lives in a holder vreg. When the holder is redefined
// before the matching load, the value is first copied to a fresh temp right
// after the access that produced it.
//
// `segdisj`: a store through one segment kills everything it cannot be
// proved apart from, and a pixel store through ES would otherwise kill every
// remembered SS local and DS global. When both offsets are bounded (a 16-bit
// address) and the two segment windows are disjoint in the machine this is
// built from, the store keeps them under an `sdisj` guard in front of it,
// which deopts to the store's own instruction if the windows ever meet. Not
// guarded when they meet at build time: in a .COM program CS=DS=ES=SS, and
// the guard would deopt on every iteration.
// ---------------------------------------------------------------------------
function forwardMemory(B) {
  const want = (op) => (op.s === SEGV + 2 ? B.on('stack') : B.on('rle'));
  const segdisj = B.on('segdisj') && B.vm;
  const lm = segdisj ? B.vm.exports.mget_linmask() >>> 0 : 0;
  const segBase = segdisj ? (() => {
    const dv = new DataView(B.vm.mem.buffer);
    return (s) => dv.getInt32(isa.REGFILE_SEGB + 4 * s, true) >>> 0;
  })() : null;
  let n = 0, guards = 0, fresh = 0;
  const newId = () => 'n' + (fresh++);
  const opIds = new WeakMap();
  const opId = (op) => { if (!opIds.has(op)) opIds.set(op, fresh++); return opIds.get(op); };
  // One walk over a block. `plan` changes nothing and returns the guards a
  // forwarded load depended on; the real walk places only those, so a guard
  // is never paid for a remembered access nobody reads again.
  const pass = (b, plan, allowed) => {
    const used = new Set();
    const val = new Map(), ver = new Map(), putsver = new Map();
    let epoch = 0;
    const get = (v) => {
      if (!val.has(v)) {
        const b = `in${v}e${epoch}`;
        // A guest register the program keeps narrow (B.narrow) holds its
        // zero-extended 16-bit value: bounded, which is why constprop drops
        // the 0xFFFF mask from a [bp] that uses it bare.
        val.set(v, v < NREG && B.narrow && B.narrow.get(v) === 16 ? { b, k: 0, h: true, f: `z:${b}:0` }
          : { b, k: 0, h: false, f: null, s: v >= SEGV && v < FIRST_TEMP ? v - SEGV : -1 });
      }
      return val.get(v);
    };
    const def = (op) => {
      const d = opDef(op);
      if (d < 0) return;
      let r = null;
      const z = (x, k) => ({ b: x.b, k, h: true, f: `z:${x.b}:${k & 0xFFFF}` });
      switch (op.o) {
        case 'movi': r = { b: 'K', k: op.i | 0, h: false, f: null }; break;
        case 'mov': r = get(op.a); break;
        case 'addi': case 'subi': {
          const x = get(op.a), k = (x.k + (op.o === 'addi' ? op.i : -op.i)) | 0;
          r = x.h ? { b: x.b, k, h: true, f: `${x.f}+${k - x.k}` } : { b: x.b, k, h: false, f: null };
          break;
        }
        case 'add': {
          const x = get(op.a), y = get(op.b);
          const [c, o] = y.b === 'K' ? [y, x] : x.b === 'K' ? [x, y] : [null, null];
          if (c) r = o.h ? { b: o.b, k: (o.k + c.k) | 0, h: true, f: `${o.f}+${c.k}` } : { b: o.b, k: (o.k + c.k) | 0, h: false, f: null };
          break;
        }
        case 'addi16': { const x = get(op.a); r = z(x, (x.k + op.i) | 0); break; }
        case 'andi': if ((op.i >>> 0) === 0xFFFF) { const x = get(op.a); r = z(x, x.k); } break;
        case 'merge16': { const x = get(op.b); r = { b: x.b, k: x.k, h: true, f: newId() }; break; }
        case 'gets': r = { b: `S${op.s}@${epoch}.${putsver.get(op.s) || 0}`, k: 0, h: false, f: null, s: op.s }; break;
        default: break;
      }
      if (!r) {
        // Nothing known but its width: a result of at most 16 bits is still
        // a bounded offset (a DI from `shl di,1`, a word loaded from a table).
        const id = newId();
        const w = op.o === 'ld' || op.o === 'getr' || op.o === 'shift' ? op.w
          : op.o === 'andi' && (op.i >>> 0) <= 0xFFFF ? 16
            : ['addi8', 'ext8h', 'cc', 'eq', 'ne', 'getf', 'flagof'].includes(op.o) ? 8 : 32;
        r = w <= 16 ? { b: id, k: 0, h: true, f: `z:${id}:0` } : { b: id, k: 0, h: false, f: null };
      }
      // A segment base written in the loop (`pop es`: the selector << 4) is
      // still that segment's base; the build-time distance check reads the
      // machine's current one, and the guard checks the one the loop made.
      if (d >= SEGV && d < FIRST_TEMP) r = { ...r, s: d - SEGV };
      val.set(d, r);
      ver.set(d, (ver.get(d) || 0) + 1);
    };
    // One address operand as a key term and a constant; `lo..hi` bounds its
    // contribution to the offset, or null when nothing bounds it.
    const term = (x, sc, m16) => {
      if (x.b === 'K') return { t: null, k: x.k << sc, lo: x.k << sc, hi: x.k << sc };
      // Exactly a zero-extended 16-bit value; `z:...+k` is past that range.
      const zx = x.h && x.f && x.f.startsWith('z:') && !x.f.includes('+');
      const rng = zx ? { lo: 0, hi: 0xFFFF << sc } : null;
      if (x.h && !m16) return { t: `${x.f}*${sc}`, k: 0, ...(rng || { lo: null }) };
      return { t: `${x.b}*${sc}`, k: x.k << sc, ...(rng || { lo: null }) };
    };
    const addr = (op) => {
      const m16 = (op.am >>> 0) === 0xFFFF;
      if (op.am && !m16) return null;
      const ts = [];
      let k = op.i | 0, lo = op.i | 0, hi = op.i | 0, bounded = true;
      for (const [f, sc] of [['a', 0], ['c', op.sc | 0]]) {
        if (op[f] === undefined || op[f] < 0) continue;
        const r = term(get(op[f]), sc, m16);
        if (r.t) ts.push(r.t);
        k = (k + r.k) | 0;
        if (r.lo === null) bounded = false; else { lo += r.lo; hi += r.hi; }
      }
      const sv = get(op.s);
      const seg = sv.b === 'K' ? `K${sv.k}` : (sv.h ? sv.f : `${sv.b}+${sv.k}`);
      // A 16-bit access ends by 0x10000: its own guard deopts a wrap, and it
      // runs after the sdisj in front of it. So segments exactly 64K apart
      // (ES = DS + 1000h) are apart.
      // The same holds for an unmasked offset proved inside [0, 0xFFFF].
      const win = m16 ? [0, 0x10000] : !bounded ? null
        : lo >= 0 && hi <= 0xFFFF ? [lo, Math.min(hi + op.w / 8, 0x10000)] : [lo, hi + op.w / 8];
      return { seg, key: ts.sort().join('+') + (m16 ? '/16' : '/32'), k, span: m16 ? 0x10000 : 2 ** 32,
        win, sreg: !sv.h && sv.k === 0 && sv.s >= 0 ? sv.s : -1 };
    };
    const disjoint = (e, A, w) => {
      if (!e.A || !A || e.A.seg !== A.seg || e.A.key !== A.key) return false;
      const span = A.span;
      const d = (((A.k - e.A.k) % span) + span) % span;
      return d >= e.w / 8 && span - d >= w / 8;
    };
    const same = (e, A) => e.A && A && e.A.seg === A.seg && e.A.key === A.key &&
      ((((e.A.k - A.k) % A.span) + A.span) % A.span) === 0;
    // Store window [lo1,hi1) through segment vreg a vs access window [lo2,hi2)
    // through b: the sdisj operands, and whether they hold right now.
    const apart = (a, b, s1, w1, s2, w2) => {
      const i = w1[0] - w2[0], n1 = w1[1] - w1[0], n2 = w2[1] - w2[0];
      const d = ((segBase(s1) - segBase(s2) + i) & lm) >>> 0;
      return { g: { o: 'sdisj', a, b, i, n1, n2 }, ok: n1 <= 0x20000 && n2 <= 0x20000 && d >= n2 && lm + 1 - d >= n1 };
    };
    // Guards in force in this block: segment vregs a, b at versions av, bv,
    // and the windows they proved apart, relative to the access window's start.
    const done = [];
    const covers = (x, y) => x[0] <= y[0] && y[1] <= x[1];
    const rel = (w1, w2) => ({ r1: [w1[0] - w2[0], w1[1] - w2[0]], r2: [0, w2[1] - w2[0]] });
    let avail = [];
    for (let i = 0; i < b.ops.length; i++) {
      const op = b.ops[i];
      const A = (op.o === 'ld' || op.o === 'st') ? addr(op) : null;
      if (op.o === 'ld' && want(op) && A) {
        const hit = avail.find(e => e.w === op.w && same(e, A));
        if (hit) {
          for (const k of hit.gk || []) used.add(k);
          if (plan) {
            // What the rewrite below would leave: the load now names the
            // remembered value, and a refreshed holder is never redefined.
            if ((ver.get(hit.v) || 0) !== hit.vv) { hit.v = -2 - i; hit.vv = 0; }
            val.set(op.d, hit.val);
            ver.set(op.d, (ver.get(op.d) || 0) + 1);
            continue;
          }
          if ((ver.get(hit.v) || 0) !== hit.vv) {
            const t = B.temp(), pos = hit.idx + 1;
            b.ops.splice(pos, 0, { o: 'mov', d: t, a: hit.v });
            for (const e of avail) if (e.idx >= pos) e.idx++;
            i++;
            hit.v = t; hit.vv = 0;
            val.set(t, hit.val);
          }
          const d = op.d;
          rewrite(op, op.w === 32 || hit.fromLoad ? { o: 'mov', d, a: hit.v } : { o: 'andi', d, a: hit.v, i: op.w === 8 ? 0xFF : 0xFFFF, w: 32 });
          n++;
        }
      }
      // A guard an earlier walk placed (addrfold's rerun meets the first
      // run's): still in force for later stores while neither base changes.
      if (op.o === 'sdisj') {
        done.push({ a: op.a, av: ver.get(op.a) || 0, b: op.b, bv: ver.get(op.b) || 0,
          r1: [op.i, op.i + op.n1], r2: [0, op.n2], key: null });
        continue;
      }
      if (op.o === 'st') {
        const keep = [], other = new Map();
        for (const e of avail) {
          if (disjoint(e, A, op.w)) keep.push(e);
          else if (segdisj && op.dx !== undefined && op.dx >= 0 && A && A.win && A.sreg >= 0 && e.A && e.A.win
            && e.A.sreg >= 0 && e.A.seg !== A.seg && e.sreg !== op.s && (ver.get(e.sreg) || 0) === e.sver) {
            const g = other.get(e.sreg) || { es: e.A.sreg, sv: e.sver, w2: [...e.A.win], list: [] };
            g.w2 = [Math.min(g.w2[0], e.A.win[0]), Math.max(g.w2[1], e.A.win[1])];
            g.list.push(e);
            other.set(e.sreg, g);
          }
        }
        for (const [sreg, g] of other) {
          const av = ver.get(op.s) || 0, R = rel(A.win, g.w2);
          const have = done.find(x => x.a === op.s && x.av === av && x.b === sreg && x.bv === g.sv
            && covers(x.r1, R.r1) && covers(x.r2, R.r2));
          const key = have ? have.key : `${opId(op)}:${sreg}`;
          if (!have) {
            const { g: gop, ok } = apart(op.s, sreg, A.sreg, A.win, g.es, g.w2);
            if (!ok || (!plan && !allowed.has(key))) continue;
            if (!plan) {
              b.ops.splice(i, 0, { ...gop, dx: op.dx, node: op.node, ip: op.ip });
              for (const e of avail) if (e.idx >= i) e.idx++;
              i++;
              guards++;
            }
            done.push({ a: op.s, av, b: sreg, bv: g.sv, ...R, key });
          }
          for (const e of g.list) if (key !== null) e.gk = [...(e.gk || []), key];
          keep.push(...g.list);
        }
        avail = keep;
      }
      if (op.o === 'reload') { avail = []; val.clear(); epoch++; }
      if (op.o === 'puts') putsver.set(op.s, (putsver.get(op.s) || 0) + 1);
      const rec = (v) => ({ A, w: op.w, v, vv: ver.get(v) || 0, val: get(v), idx: i, sreg: op.s, sver: ver.get(op.s) || 0 });
      if (op.o === 'st') avail.push({ ...rec(op.b), fromLoad: false });
      def(op);
      if (op.o === 'ld' && A) avail.push({ ...rec(op.d), fromLoad: true });
    }
    return used;
  };
  for (const b of B.fastBlocks()) pass(b, false, segdisj ? pass(b, true, null) : new Set());
  B.stats.memfwd = (B.stats.memfwd || 0) + n;
  B.stats.segdisj = (B.stats.segdisj || 0) + guards;
  return n;
}

// ---------------------------------------------------------------------------
// mergesink, part two: a guest-register write that the same block overwrites
// before anything reads it is dead on the trace -- only a DEOPT between the
// two can see it, because the deopt writes the architectural state back. Move
// the write into those deopt stubs (each site gets its own copy of the stub).
// The partial-register merges of a register only ever touched in part are
// the common case, and a push's SP update that the pop undoes another.
// ---------------------------------------------------------------------------
function sinkDeoptDefs(B) {
  const p = B.p;
  let n = 0;
  for (const b of B.fastBlocks()) {
    if (b.kind !== 'body') continue;
    for (let i = 0; i < b.ops.length; i++) {
      const G = b.ops[i];
      const r = opDef(G);
      if (r < 0 || r >= NREG || !isPure(G) || G.o === 'ld') continue;
      let k = i + 1;
      while (k < b.ops.length && opDef(b.ops[k]) !== r && b.ops[k].o !== 'reload') k++;
      if (k >= b.ops.length || b.ops[k].o === 'reload') continue;
      const operands = opUses(G);
      if (operands.includes(r)) continue;
      let ok = true;
      const sites = [];
      for (let j = i + 1; j <= k && ok; j++) {
        const x = b.ops[j];
        if (opUses(x).includes(r)) ok = false;
        if (x.dx !== undefined && x.dx >= 0) {
          // The site sees G's value; G's operands must still be what G read.
          for (let q = i + 1; q < j; q++) if (operands.includes(opDef(b.ops[q]))) ok = false;
          sites.push(x);
        }
      }
      if (!ok) continue;
      b.ops.splice(i, 1);
      for (const x of sites) {
        const orig = p.blocks[x.dx];
        const c = B.block(orig.kind);
        Object.assign(c, { fast: true, nodes: [], node: orig.node, ip: orig.ip, ops: [clone(G), ...clone(orig.ops)], term: clone(orig.term), after: orig.after });
        x.dx = c.id;
      }
      i--;
      n++;
    }
  }
  B.stats.deoptSunk = n;
  if (n) B.cfg();
}

// ---------------------------------------------------------------------------
function build(reg, opts = {}) {
  const passes = opts.passes;
  if (!passes) return IR.lower(reg);
  const B = new Build(reg, { ...opts, passes });
  // opts.timing (a Map) collects ms per pass: where a slow build goes.
  const T = opts.timing;
  let t0 = T ? performance.now() : 0;
  const tick = T ? name => { const t = performance.now(); T.set(name, (T.get(name) || 0) + t - t0); t0 = t; } : () => {};
  B.makeFast();
  tick('makeFast');
  B.fastHead = B.fastOf.get(reg.headKey);
  // With the clock pass the fast half tests the budget only at headers, so
  // straight-line runs across transfers (calls, returns, jumps) can merge.
  if (B.on('clock')) stripClock(B);
  tick('stripClock');
  B.cfg();
  tick('cfg');
  B.mergeStraight();
  tick('mergeStraight');
  B.findHeaders();
  tick('findHeaders');
  B.makeEntries();
  tick('makeEntries');
  // The clock pass's budget CHECK at each header deopts to the header's
  // first instruction. Its edge has to exist from here on, not only from the
  // clock pass: flag forwarding materializes forwarded flags on every deopt
  // edge it can see, and a stub first created after it -- a header whose
  // first instruction has no memory access, so no stub yet -- would hand the
  // slow half L1's stale record (a setz at a header read the ZF of an older
  // instruction). clock() fills in the counts.
  if (B.on('clock')) {
    for (const b of B.fastBlocks()) {
      if (b.header && b.kind === 'body') b.ops.unshift({ o: 'check', m: 0, M: 0, node: b.nodes[0], dx: B.deopt(b.nodes[0]) });
    }
    B.cfg();
  }
  if (B.on('guards')) machineGuards(B);
  tick('machineGuards');
  if (B.on('promote')) promote(B);
  tick('promote');
  if (B.on('constprop')) constprop(B);
  tick('constprop');
  if ((B.on('rle') || B.on('stack')) && forwardMemory(B) && B.on('constprop')) constprop(B);
  tick('forwardMemory');
  if (B.on('flagfwd')) forwardFlags(B);
  else if (B.on('flaglive')) killDeadRecs(B);
  tick('forwardFlags');
  if (B.on('constprop')) constprop(B);
  tick('constprop');
  prune(B);
  tick('prune');
  if (B.on('mergesink')) { sinkDeoptDefs(B); if (B.on('constprop')) constprop(B); }
  tick('sinkDeoptDefs');
  if (B.on('addrfold')) addrfold(B);
  tick('addrfold');
  // Again once addrfold has folded [bp+k] into (bp, k): forms the first run
  // could not match by value still match by operand here.
  if (B.on('addrfold') && (B.on('rle') || B.on('stack')) && forwardMemory(B) && B.on('constprop')) constprop(B);
  tick('forwardMemory');
  if (B.on('fuse')) fuse(B);
  tick('fuse');
  if (B.on('clock')) clock(B);
  tick('clock');
  prune(B);
  tick('prune');
  if (B.on('constprop')) { sinkCold(B); dce(B); }
  tick('sinkCold');
  finalize(B);
  tick('finalize');
  B.p.stats = B.stats;
  B.p.build = B;
  B.p.headBlocks = new Set([B.fastHead, B.slowOf.get(reg.headKey)]);
  return B.p;
}

// Machine settings the loop reads: specialize them under an entry guard.
function machineGuards(B) {
  const want = new Map();
  if (B.machine && [...B.allOps()].some(([, , op]) => op.o === 'callh')) want.set('shmask', B.machine.shmask);
  for (const [, , op] of B.allOps()) {
    if (op.o === 'getm' && B.machine && B.machine[op.g] !== undefined) {
      want.set(op.g, B.machine[op.g]);
      op.k = B.machine[op.g];
    }
  }
  B.machineGuards = [...want].map(([g, v]) => ({ g, v }));
}

module.exports = { build, ablationConfigs, PASSES, BASELINE, fuseCC, composeCC };
