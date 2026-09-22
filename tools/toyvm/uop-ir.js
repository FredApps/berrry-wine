'use strict';

// The micro-op IR: region discovery and the NAIVE lowering.
//
// A program is a CFG of blocks over virtual registers. The naive lowering is
// deliberately a one-for-one transcription of what the interpreter (L1) does
// per x86 instruction, so that every optimization in tools/toyvm/uop-opt.js is
// a separate, switchable transformation of it and its effect can be measured
// on its own:
//
//   * every register read is a GETR from the register file and every write a
//     PUTR back to it (register promotion turns them into vreg moves);
//   * every segment base is a GETS (segment promotion);
//   * every flag producer is a REC that writes L1's lazy-flag globals exactly
//     as $rec_* does, and every consumer a GETCC through L1's getters (flag
//     forwarding replaces both);
//   * every instruction ends in STEP 1 and every x86 transfer tests the budget
//     on the edge it takes (the clock pass sums these per path and keeps one
//     lookahead CHECK per loop header);
//   * every memory access is CHECKED: the same VGA-key / 64K-straddle /
//     code-bitmap tests L1's accessors make, with a DEOPT exit that hands the
//     instruction back to L1 when a store would hit compiled code.
//
// Virtual registers: 0-7 are the guest registers (full 32 bits, x86 encoding
// order), 8-13 the six segment BASES (ES CS SS DS FS GS), and 14 up are
// temporaries. Nothing is SSA; the passes use reaching definitions.

const { decodeInsn, successors, MASK } = require('./uop-x86');

const NREG = 8, SEGV = 8, FIRST_TEMP = 14;
const FLAGS = ['c', 'p', 'a', 'z', 's', 'o'];
const FBIT = { c: 0, p: 2, a: 4, z: 6, s: 7, o: 11 };
// Which flags a condition code reads, in x86 cc order.
const CC_NAMES = ['o', 'no', 'b', 'ae', 'e', 'ne', 'be', 'a', 's', 'ns', 'p', 'np', 'l', 'ge', 'le', 'g'];
const CC_READS = [['o'], ['o'], ['c'], ['c'], ['z'], ['z'], ['c', 'z'], ['c', 'z'], ['s'], ['s'],
  ['p'], ['p'], ['s', 'o'], ['s', 'o'], ['z', 's', 'o'], ['z', 's', 'o']];
// Evaluate a cc from six flag bits.
function ccEval(cc, f) {
  let v;
  switch (cc >> 1) {
    case 0: v = f.o; break;
    case 1: v = f.c; break;
    case 2: v = f.z; break;
    case 3: v = f.c | f.z; break;
    case 4: v = f.s; break;
    case 5: v = f.p; break;
    case 6: v = f.s ^ f.o; break;
    default: v = f.z | (f.s ^ f.o); break;
  }
  return (cc & 1) ? v ^ 1 : v;
}

// ---------------------------------------------------------------------------
// Region discovery.
//
// A node is one x86 instruction in one call context (the stack of return ips
// of the calls inlined on the way to it). Explore breadth-first from the head,
// then keep the nodes that lie on a cycle through the head -- the loop nest
// that contains it. Everything else is a program exit. A call is followed into
// its callee with the return address pushed on the context; a ret pops it.
// ---------------------------------------------------------------------------
function discover(rd, env, headIp, opts = {}) {
  const { codeBase, mask, d32, ip32 } = env;
  const maxNodes = opts.maxNodes || 400;
  const maxDepth = opts.maxDepth === undefined ? 2 : opts.maxDepth;
  const nodes = new Map();          // key -> node
  const key = (ip, ctx) => `${ip}|${ctx.join(',')}`;
  const queue = [];
  const add = (ip, ctx) => {
    const k = key(ip, ctx);
    if (nodes.has(k)) return k;
    if (nodes.size >= maxNodes) return null;
    const d = decodeInsn(rd, codeBase, mask, ip, d32, ip32);
    const n = { k, ip, ctx, d, succ: [], pred: [] };
    nodes.set(k, n);
    queue.push(n);
    return k;
  };
  const headKey = add(headIp, []);
  while (queue.length) {
    const n = queue.shift();
    const d = n.d;
    if (!supported(d)) { n.unsupported = d.why || d.kind; continue; }
    const s = successors(d);
    const out = [];
    if (!s) out.push(['fall', d.next, n.ctx]);
    else if (s.call) {
      if (n.ctx.length >= maxDepth) { n.unsupported = 'call depth'; continue; }
      out.push(['call', s.taken, [...n.ctx, d.next]]);
    } else if (s.ret) {
      if (n.ctx.length) out.push(['ret', n.ctx[n.ctx.length - 1], n.ctx.slice(0, -1)]);
    } else {
      if (s.taken !== null) out.push(['taken', s.taken, n.ctx]);
      if (s.fall !== null) out.push(['fall', s.fall, n.ctx]);
    }
    for (const [kind, ip, ctx] of out) {
      const k = add(ip, ctx);
      n.succ.push({ kind, ip, ctx, k });
    }
  }
  // Which nodes can reach the head (backwards over explored edges)?
  for (const n of nodes.values()) for (const e of n.succ) if (e.k) nodes.get(e.k).pred.push(n.k);
  const reach = new Set([headKey]);
  const stack = [headKey];
  while (stack.length) {
    const k = stack.pop();
    for (const p of nodes.get(k).pred) if (!reach.has(p)) { reach.add(p); stack.push(p); }
  }
  const head = nodes.get(headKey);
  const cyclic = head.succ.length > 0 && [...reach].some(k => nodes.get(k).succ.some(e => e.k === headKey));
  let body;
  if (cyclic) body = new Set([...reach].filter(k => !nodes.get(k).unsupported));
  else {
    // No loop through the head: take the straight line from it.
    body = new Set();
    let n = head;
    while (n && !n.unsupported && !body.has(n.k)) {
      body.add(n.k);
      if (n.succ.length !== 1) break;
      n = nodes.get(n.succ[0].k);
    }
  }
  return { nodes, headKey, body, cyclic, env };
}

// What the lowering handles. Everything else ends the program at that
// instruction with an exit to L1.
function supported(d) {
  switch (d.kind) {
    case 'unsupported': return false;
    case 'movs': case 'stos': case 'lods': return !d.rep;
    case 'shift':
      return !(d.count.t === 'r' && (d.sh === 'rol' || d.sh === 'ror') && d.w !== 32);
    default: return true;
  }
}

// ---------------------------------------------------------------------------
// Flag effects of one decoded instruction: which of the six arithmetic flags
// it reads, and which it certainly writes. Used for liveness, both inside a
// program and after its exits.
// ---------------------------------------------------------------------------
const ALL6 = ['c', 'p', 'a', 'z', 's', 'o'];
function flagEffect(d, shmask = 0x1F) {
  const R = [], W = [];
  switch (d.kind) {
    case 'alu':
      if (d.alu === 'adc' || d.alu === 'sbb') R.push('c');
      W.push(...ALL6);
      break;
    case 'test': case 'neg': W.push(...ALL6); break;
    case 'incdec': W.push('p', 'a', 'z', 's', 'o'); break;
    case 'imul2': case 'imul3': W.push('c', 'o'); break;
    case 'shift': {
      // A count of zero writes nothing, so only a nonzero constant count is a
      // certain write.
      const n = d.count.t === 'i' ? (d.count.v & shmask) : 0;
      if (n) W.push('c', 'o', ...(d.sh === 'rol' || d.sh === 'ror' ? [] : ['p', 'z', 's']));
      break;
    }
    case 'jcc': case 'setcc': R.push(...CC_READS[d.cc]); break;
    case 'unsupported': R.push(...ALL6); break;
    default: break;
  }
  return { reads: R, writes: W };
}

// Which flags can the code at `ip` read before writing them? A bounded walk
// over the successors, conservative (all six) wherever it cannot see: an
// unsupported instruction, a return, the walk's own limit.
function liveFlagsAt(rd, env, ip, { depth = 24, shmask = 0x1F, memo = new Map() } = {}) {
  const { codeBase, mask, d32, ip32 } = env;
  const walk = (at, budget, seen) => {
    const live = new Set();
    let need = new Set(ALL6);          // flags not yet written on this path
    for (let n = 0; n < budget; n++) {
      if (seen.has(at)) return live;   // a cycle: nothing new along it
      seen.add(at);
      const d = decodeInsn(rd, codeBase, mask, at, d32, ip32);
      const e = flagEffect(d, shmask);
      for (const f of e.reads) if (need.has(f)) live.add(f);
      for (const f of e.writes) need.delete(f);
      if (need.size === 0) return live;
      if (d.kind === 'unsupported' || d.kind === 'ret') { for (const f of need) live.add(f); return live; }
      const s = successors(d);
      if (!s) { at = d.next; continue; }
      const outs = [s.taken, s.fall].filter(x => x !== null && x !== undefined);
      if (outs.length === 1) { at = outs[0]; continue; }
      for (const o of outs) {
        for (const f of walk(o, budget - n - 1, new Set(seen))) if (need.has(f)) live.add(f);
      }
      return live;
    }
    for (const f of need) live.add(f);
    return live;
  };
  const k = `${codeBase}:${ip}`;
  if (memo.has(k)) return memo.get(k);
  const r = walk(ip, depth, new Set());
  memo.set(k, r);
  return r;
}

// ---------------------------------------------------------------------------
// The naive lowering.
// ---------------------------------------------------------------------------
class Prog {
  constructor(env) {
    this.env = env;
    this.blocks = [];
    this.nv = FIRST_TEMP;
    this.entry = null;
  }
  temp() { return this.nv++; }
  block(kind = 'body') {
    const b = { id: this.blocks.length, kind, ops: [], term: null, ip: null, n: 0 };
    this.blocks.push(b);
    return b;
  }
}

// The NAIVE program: an exact, guard-free transcription of what L1 does.
//
// It is also the SLOW TWIN every optimized program carries (uop-opt.js): the
// fast path deopts into it at an instruction boundary whenever an assumption
// fails, and falls back into it at a loop header when the budget is too close
// to run a whole iteration unchecked. So it must be valid in ANY machine
// state -- it reads $spm and DF at run time instead of assuming them, calls
// the full memory accessors (VGA, 64K straddles, self-modify marking) instead
// of guarding them, and tests the budget at every transfer exactly where L1
// does. One block per x86 instruction, so every instruction boundary is a
// block a deopt can land on (p.nodeBlock).
//
// Exits: { o: 'exit', kind: 'go', ip } is L1's GO with no arena address --
// set $gip, continue through the jump table if the boundary allows it, hand
// back otherwise. { ipv } is the same through a vreg (a return that went
// somewhere other than where its call came from).
function lower(region, opts = {}) {
  const { nodes, headKey, body, env } = region;
  const p = new Prog(env);
  const goStub = (ip, why = 'edge') => {
    const b = p.block('exit');
    b.ip = ip;
    b.term = { o: 'exit', kind: 'go', ip, why };
    return b.id;
  };
  const nb = new Map();
  const order = [...body];
  for (const k of order) {
    const b = p.block('body');
    b.ip = nodes.get(k).ip;
    b.node = k;
    b.n = 1;
    nb.set(k, b);
  }
  const entry = p.block('entry');
  entry.ip = nodes.get(headKey).ip;
  p.entry = entry.id;
  p.headIp = entry.ip;
  p.headKey = headKey;
  entry.term = { o: 'br', t: nb.get(headKey).id, tx: -1 };

  // An edge into the body tests the budget, since L1 tests it at every
  // transfer; an edge out of it goes to a GO stub, which tests it itself.
  const edgeTo = (k, ip, why) => {
    if (k && body.has(k)) {
      const b = nb.get(k);
      return { t: b.id, chk: goStub(b.ip, why) };
    }
    return { t: goStub(ip, why), chk: -1 };
  };

  for (const k of order) {
    const n = nodes.get(k);
    const b = nb.get(k);
    const L = new Lowerer(p, b, n);
    L.insn();
    const d = n.d;
    const s = successors(d);
    if (!s) {
      // Straight line: no transfer, so no budget test.
      const e = n.succ[0];
      b.term = e && body.has(e.k)
        ? { o: 'br', t: nb.get(e.k).id, tx: -1 }
        : { o: 'br', t: goStub(d.next, 'edge'), tx: -1 };
      continue;
    }
    if (s.call || d.kind === 'jmp') {
      const e = n.succ[0];
      const to = edgeTo(e && e.k, s.taken, 'edge');
      b.term = { o: 'br', t: to.t, tx: to.chk };
      continue;
    }
    if (s.ret) {
      // Inside an inlined call the popped address is compared against the
      // return point the call pushed; anything else leaves through the vreg.
      const miss = p.block('exit');
      miss.term = { o: 'exit', kind: 'go', ipv: L.retv, why: 'ret' };
      if (n.succ.length) {
        const e = n.succ[0];
        const to = edgeTo(e.k, e.ip, 'ret');
        b.term = { o: 'bcc', cc: 'eq', w: 32, a: L.retv, b: -1, i: e.ip | 0, t: to.t, tx: to.chk,
          f: miss.id, fx: -1 };
      } else b.term = { o: 'br', t: miss.id, tx: -1 };
      continue;
    }
    const et = n.succ.find(e => e.kind === 'taken');
    const ef = n.succ.find(e => e.kind === 'fall');
    const to = edgeTo(et && et.k, s.taken, 'edge');
    const fo = edgeTo(ef && ef.k, s.fall, 'edge');
    b.term = { b: -1, ...L.cond, o: 'bcc', t: to.t, tx: to.chk, f: fo.t, fx: fo.chk };
  }
  p.nodeBlock = new Map([...nb].map(([k, b]) => [k, b.id]));
  finish(p);
  return p;
}

// Recompute preds/succs and drop unreachable blocks (keeps ids stable: an
// unreachable block becomes kind 'dead' with no ops).
function succOf(b) {
  const t = b.term;
  if (!t) return [];
  const out = [];
  if (t.o === 'br') { out.push(t.t); if (t.tx >= 0) out.push(t.tx); }
  else if (t.o === 'bcc') {
    out.push(t.t, t.f);
    if (t.tx >= 0) out.push(t.tx);
    if (t.fx >= 0) out.push(t.fx);
  }
  for (const op of b.ops) if (op.dx !== undefined && op.dx >= 0) out.push(op.dx);
  return out;
}
function finish(p) {
  for (const b of p.blocks) { b.preds = []; b.succs = []; }
  const seen = new Set([p.entry]);
  const st = [p.entry];
  while (st.length) {
    const id = st.pop();
    for (const s of succOf(p.blocks[id])) if (!seen.has(s)) { seen.add(s); st.push(s); }
  }
  for (const b of p.blocks) {
    if (!seen.has(b.id)) { b.kind = 'dead'; b.ops = []; b.term = null; continue; }
    b.succs = succOf(b);
    for (const s of b.succs) p.blocks[s].preds.push(b.id);
  }
  return p;
}

// Lowers one x86 instruction into the current block.
class Lowerer {
  constructor(p, b, n) {
    this.p = p; this.b = b; this.n = n; this.d = n.d;
    this.ip = n.ip;
  }
  t() { return this.p.temp(); }
  op(o) { o.ip = this.ip; this.b.ops.push(o); return o; }
  movi(v) { const d = this.t(); this.op({ o: 'movi', d, i: v | 0 }); return d; }
  bin(o, a, b, w = 32) { const d = this.t(); this.op({ o, d, a, b, w }); return d; }
  imm(o, a, i, w = 32) { const d = this.t(); this.op({ o, d, a, i: i | 0, w }); return d; }
  un(o, a) { const d = this.t(); this.op({ o, d, a }); return d; }

  getm(g) { const d = this.t(); this.op({ o: 'getm', d, g }); return d; }

  // --- register file --------------------------------------------------------
  getReg(r, w) {
    const d = this.t();
    if (w === 8) this.op({ o: 'getr', d, r: r & 3, w: r < 4 ? 8 : 9 });   // 9 = high byte
    else this.op({ o: 'getr', d, r, w });
    return d;
  }
  putReg(r, w, v) {
    if (w === 8) this.op({ o: 'putr', r: r & 3, w: r < 4 ? 8 : 9, a: v });
    else this.op({ o: 'putr', r, w, a: v });
  }
  seg(s) { const d = this.t(); this.op({ o: 'gets', d, s }); return d; }

  // Effective address of a memory operand: { s: segment base vreg, off: vreg }.
  ea(m) {
    const s = this.seg(m.seg);
    let off = null;
    const addTerm = (v) => { off = off === null ? v : this.bin('add', off, v); };
    if (m.base >= 0) addTerm(this.getReg(m.base, m.a32 ? 32 : 16));
    if (m.index >= 0) {
      let x = this.getReg(m.index, m.a32 ? 32 : 16);
      if (m.scale) x = this.imm('shli', x, m.scale);
      addTerm(x);
    }
    if (off === null) off = this.movi(m.a32 ? m.disp : m.disp & 0xFFFF);
    else if (m.disp) off = this.imm('addi', off, m.disp);
    if (!m.a32) off = this.imm('andi', off, 0xFFFF);
    return { s, off };
  }
  load(w, e) {
    const d = this.t();
    this.op({ o: 'ld', d, s: e.s, a: e.off, c: -1, i: 0, sc: 0, am: 0, w, chk: 'full' });
    return d;
  }
  store(w, e, v) {
    this.op({ o: 'st', b: v, s: e.s, a: e.off, c: -1, i: 0, sc: 0, am: 0, w, chk: 'full' });
  }
  // Read an operand (register, memory, immediate) at width w, zero-extended.
  read(x, eaCache) {
    if (x.t === 'i') return this.movi(x.v);
    if (x.t === 'r') return this.getReg(x.r, x.w);
    const e = eaCache || this.ea(x);
    return this.load(x.w, e);
  }
  write(x, v, eaCache) {
    if (x.t === 'r') return this.putReg(x.r, x.w, v);
    const e = eaCache || this.ea(x);
    return this.store(x.w, e, v);
  }
  // Flag producers and consumers, in L1's record format.
  // Flag records are held back until the instruction's stores and register
  // writes are out: a store may DEOPT (hand the instruction back to L1 to run
  // again), and by then the flags must still be the ones it started from --
  // an ADC re-run against its own record would add a different carry.
  rec(k, w, f) { (this.pend || (this.pend = [])).push({ o: 'rec', k, w, ...f, ip: this.ip }); }
  flushRec() {
    if (this.pend) for (const r of this.pend) this.b.ops.push(r);
    this.pend = null;
  }
  getcc(cc) { const d = this.t(); this.op({ o: 'getcc', d, cc }); return d; }
  getcf() { const d = this.t(); this.op({ o: 'getcc', d, cc: 2 }); return d; }
  step() { this.op({ o: 'step', i: 1 }); }

  // Stack, as $push16/$pop16: the WHOLE of ESP becomes (ESP -/+ n) & $spm.
  // Pushes write SP back after the store, so a deopt at the store sees the
  // instruction's own starting state.
  push(v, w) {
    const sp = this.getReg(4, 32);
    const s = this.seg(2);
    const msp = this.bin('and', this.imm('subi', sp, w / 8), this.getm('spm'));
    this.store(w, { s, off: msp }, v);
    this.putReg(4, 32, msp);
  }
  pop(w) {
    const sp = this.getReg(4, 32);
    const s = this.seg(2);
    const v = this.load(w, { s, off: sp });
    this.putReg(4, 32, this.bin('and', this.imm('addi', sp, w / 8), this.getm('spm')));
    return v;
  }

  // Arithmetic in the L1 record shape. Returns the masked result.
  arith(alu, w, a, b) {
    const m = MASK[w];
    if (alu === 'and' || alu === 'or' || alu === 'xor') {
      const r = this.bin(alu, a, b);
      this.rec('logic', w, { r });
      return r;
    }
    const isAdd = alu === 'add' || alu === 'adc';
    const cin = (alu === 'adc' || alu === 'sbb') ? this.getcf() : -1;
    let s = this.bin(isAdd ? 'add' : 'sub', a, b);
    if (cin >= 0) s = this.bin(isAdd ? 'add' : 'sub', s, cin);
    if (w === 32) {
      this.rec(isAdd ? 'add32' : 'sub32', 32, { a, b, r: s, cin });
      return s;
    }
    const r = this.imm('andi', s, m);
    // `adc`: s carries a borrow/carry-in, so s is not a +/- b and a flag
    // cannot be re-derived from the operands (uop-opt.js fuseCC).
    this.rec(isAdd ? 'add' : 'sub', w, cin >= 0 ? { a, b, s, r, adc: true } : { a, b, s, r });
    return r;
  }

  insn() {
    const d = this.d;
    const L = this;
    switch (d.kind) {
      case 'nop': break;
      case 'mov': {
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        L.write(d.dst, L.read(d.src), e);
        break;
      }
      case 'alu': case 'test': {
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        const a = L.read(d.dst, e);
        const b = L.read(d.src);
        const alu = d.kind === 'test' ? 'and' : d.alu;
        const r = L.arith(alu === 'cmp' ? 'sub' : alu, d.w, a, b);
        if (d.kind === 'alu' && d.alu !== 'cmp') L.write(d.dst, r, e);
        break;
      }
      case 'incdec': {
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        const a = L.read(d.dst, e);
        const s = L.imm(d.dec ? 'subi' : 'addi', a, 1);
        const r = d.w === 32 ? s : L.imm('andi', s, MASK[d.w]);
        L.write(d.dst, r, e);
        if (d.w === 32) L.rec(d.dec ? 'dec32' : 'inc32', 32, { a, r });
        else L.rec(d.dec ? 'dec' : 'inc', d.w, { a, s, r });
        break;
      }
      case 'not': {
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        const a = L.read(d.dst, e);
        L.write(d.dst, L.imm('xori', a, MASK[d.w]), e);
        break;
      }
      case 'neg': {
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        const a = L.read(d.dst, e);
        const z = L.movi(0);
        const s = L.bin('sub', z, a);
        const r = d.w === 32 ? s : L.imm('andi', s, MASK[d.w]);
        L.write(d.dst, r, e);
        if (d.w === 32) L.rec('sub32', 32, { a: z, b: a, r: s, cin: -1 });
        else L.rec('sub', d.w, { a: z, b: a, s, r });
        break;
      }
      case 'lea': {
        const e = L.ea(d.src);
        L.putReg(d.dst.r, d.w, d.w === 16 ? L.imm('andi', e.off, 0xFFFF) : e.off);
        break;
      }
      case 'xchg': {
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        const a = L.read(d.dst, e);
        const b = L.read(d.src);
        L.write(d.dst, b, e);
        L.write(d.src, a);
        break;
      }
      case 'push': L.push(L.read(d.src), d.w); break;
      case 'pop': {
        const v = L.pop(d.w);
        L.write(d.dst, v);
        break;
      }
      case 'cbw':
        if (d.w === 16) L.putReg(0, 16, L.imm('andi', L.un('sx8', L.getReg(0, 8)), 0xFFFF));
        else L.putReg(0, 32, L.un('sx16', L.getReg(0, 16)));
        break;
      case 'cwd':
        if (d.w === 16) {
          L.putReg(2, 16, L.imm('andi', L.imm('sari', L.un('sx16', L.getReg(0, 16)), 15), 0xFFFF));
        } else L.putReg(2, 32, L.imm('sari', L.getReg(0, 32), 31));
        break;
      case 'movzx': case 'movsx': {
        let v = L.read(d.src);
        if (d.kind === 'movsx') v = L.un(d.sw === 8 ? 'sx8' : 'sx16', v);
        if (d.w === 16) v = L.imm('andi', v, 0xFFFF);
        L.putReg(d.dst.r, d.w, v);
        break;
      }
      case 'imul2': case 'imul3': {
        const a = L.read(d.kind === 'imul2' ? d.dst : d.src);
        const b = d.kind === 'imul2' ? L.read(d.src) : L.movi(d.imm.v);
        const w = d.w;
        const sa = w === 16 ? L.un('sx16', a) : a;
        const sb = w === 16 ? L.un('sx16', b) : b;
        const prod = L.bin('mul', sa, sb);
        const r = w === 16 ? L.imm('andi', prod, 0xFFFF) : prod;
        // CF = OF = the product does not fit: computed only if somebody asks.
        const nz = w === 16 ? L.bin('ne', L.un('sx16', prod), prod) : L.bin('imulov', sa, sb);
        L.putReg(d.dst.r, w, r);
        L.rec('mul', w, { nz });
        break;
      }
      case 'setcc': {
        const v = L.getcc(d.cc);
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        L.write(d.dst, v, e);
        break;
      }
      case 'shift': {
        const e = d.dst.t === 'm' ? L.ea(d.dst) : null;
        const a = L.read(d.dst, e);
        const n = d.count.t === 'i' ? L.movi(d.count.v) : L.getReg(1, 8);
        const r = L.t();
        L.op({ o: 'callh', d: r, a, b: n, fn: `sh_${d.sh}${d.w}`, sh: d.sh, w: d.w,
          nconst: d.count.t === 'i' ? d.count.v : null });
        L.write(d.dst, r, e);
        break;
      }
      case 'movs': case 'stos': case 'lods': {
        const w = d.w, n = w / 8;
        const ar = d.a32 ? 32 : 16;
        const si = (d.kind !== 'stos') ? L.getReg(6, ar) : -1;
        const di = (d.kind !== 'lods') ? L.getReg(7, ar) : -1;
        let v;
        if (d.kind === 'stos') v = L.getReg(0, w);
        else v = L.load(w, { s: L.seg(d.seg), off: si });
        if (d.kind === 'lods') L.putReg(0, w, v);
        else L.store(w, { s: L.seg(0), off: di }, v);
        // DF read at run time: delta = n - 2n * DF.
        const delta = L.bin('sub', L.movi(n), L.imm('shli', L.getm('df'), Math.log2(n) + 1));
        const adv = (r, reg) => {
          const x = L.bin('add', r, delta);
          L.putReg(reg, ar, ar === 16 ? L.imm('andi', x, 0xFFFF) : x);
        };
        if (si >= 0) adv(si, 6);
        if (di >= 0) adv(di, 7);
        break;
      }
      case 'jcc': {
        const t = L.getcc(d.cc);
        L.step();
        L.cond = { cc: 'nz', a: t, w: 32 };
        return;
      }
      case 'loop': case 'jcxz': {
        const w = d.a32 ? 32 : 16;
        const c = L.getReg(1, w);
        if (d.kind === 'loop') {
          const x = L.imm('subi', c, 1);
          const r = w === 32 ? x : L.imm('andi', x, 0xFFFF);
          L.putReg(1, w, r);
          L.step();
          L.cond = { cc: 'nz', a: r, w: 32 };
        } else {
          L.step();
          L.cond = { cc: 'z', a: c, w: 32 };
        }
        return;
      }
      case 'jmp': L.step(); return;
      case 'call': {
        L.push(L.movi(d.next), d.w);
        L.step();
        return;
      }
      case 'ret': {
        L.retv = L.pop(d.w);
        if (d.pop) {
          const sp = L.getReg(4, 32);
          L.putReg(4, 32, L.bin('and', L.imm('addi', sp, d.pop), L.getm('spm')));
        }
        L.step();
        return;
      }
      default:
        throw new Error(`lower: unhandled ${d.kind}`);
    }
    L.flushRec();
    L.step();
  }
}

// ---------------------------------------------------------------------------
// Utilities shared by the passes, the interpreters and the backends.
// ---------------------------------------------------------------------------

// Operand fields that READ a vreg, and the one that writes.
const READS = ['a', 'b', 'c', 's'];
function uses(op) {
  const u = [];
  for (const f of READS) if (op[f] !== undefined && op[f] >= 0 && isVregField(op, f)) u.push(op[f]);
  if (op.o === 'rec') for (const f of ['r', 'cin', 'nz']) if (op[f] !== undefined && op[f] >= 0) u.push(op[f]);
  if (op.o === 'exit' && op.ipv !== undefined) u.push(op.ipv);
  if (op.o === 'wrec') for (const f of ['r', 'cin', 'fcf', 'nz']) if (op[f] !== undefined && op[f] >= 0) u.push(op[f]);
  if (op.o === 'wflags') for (const f of FLAGS) if (op[`f${f}`] >= 0) u.push(op[`f${f}`]);
  return u;
}
// `s` is a segment-base vreg on memory ops and an unmasked sum elsewhere; `r`
// is a register NUMBER on getr/putr. Say which fields are vregs per opcode.
function isVregField(op, f) {
  if (op.o === 'getr' || op.o === 'gets' || op.o === 'guard' || op.o === 'getf') return false;
  if (op.o === 'putr') return f === 'a';
  return true;
}
function def(op) {
  return (op.d !== undefined && op.d >= 0) ? op.d : -1;
}
// Ops with an effect beyond their destination.
const SIDE = new Set(['st', 'putr', 'rec', 'guard', 'step', 'callh', 'wrec', 'wflags', 'ld',
  'getcc', 'getf', 'fvset', 'check']);
function pure(op) { return !SIDE.has(op.o); }

function dump(p, log = console.log) {
  const hx = (v) => (v >>> 0).toString(16);
  const vr = (v) => (v < NREG ? ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'][v]
    : v < FIRST_TEMP ? ['esb', 'csb', 'ssb', 'dsb', 'fsb', 'gsb'][v - SEGV] : `v${v}`);
  const fmt = (op) => {
    const parts = [op.o];
    if (op.w !== undefined && op.o !== 'getr' && op.o !== 'putr') parts.push(`.${op.w}`);
    const fields = [];
    if (op.d !== undefined && op.d >= 0) fields.push(`${vr(op.d)} =`);
    for (const f of ['s', 'a', 'b', 'c']) {
      if (op[f] !== undefined && op[f] >= 0 && isVregField(op, f)) fields.push(`${f}:${vr(op[f])}`);
    }
    if (op.r !== undefined && (op.o === 'getr' || op.o === 'putr')) fields.push(`r${op.r}.${op.w}`);
    if (op.i !== undefined) fields.push(`#${op.i}`);
    if (op.k) fields.push(op.k);
    if (op.cc !== undefined) fields.push(`cc=${op.cc}`);
    if (op.dx !== undefined) fields.push(`dx=B${op.dx}`);
    if (op.fn) fields.push(op.fn);
    if (op.g) fields.push(`${op.g}=${hx(op.v)}`);
    return `${parts.join('')} ${fields.join(' ')}`;
  };
  for (const b of p.blocks) {
    if (b.kind === 'dead') continue;
    log(`B${b.id} [${b.kind}${b.ip !== null ? ` ip=${hx(b.ip)}` : ''}${b.header ? ' HEADER' : ''}] preds=${(b.preds || []).join(',')}`);
    for (const op of b.ops) log(`    ${fmt(op)}`);
    const t = b.term;
    if (!t) continue;
    if (t.o === 'br') log(`    br B${t.t}${t.tx >= 0 ? ` chk->B${t.tx}` : ''}${t.st ? ` +${t.st}` : ''}`);
    else if (t.o === 'bcc') {
      log(`    bcc ${t.cc}.${t.w} ${vr(t.a)} ${t.b !== undefined && t.b >= 0 ? vr(t.b) : `#${t.i !== undefined ? hx(t.i) : ''}`}`
        + ` ? B${t.t}${t.tx >= 0 ? `(chk B${t.tx})` : ''}${t.sT ? `+${t.sT}` : ''}`
        + ` : B${t.f}${t.fx >= 0 ? `(chk B${t.fx})` : ''}${t.sF ? `+${t.sF}` : ''}`
        + (t.check ? ` CHECK(${t.check.m})->B${t.check.x}` : ''));
    } else if (t.o === 'exit') {
      log(`    exit ${t.kind} ${t.ipv !== undefined ? vr(t.ipv) : hx(t.ip)} ${t.why || ''}${t.adj ? ` adj=${t.adj}` : ''}`);
    }
  }
}

module.exports = {
  discover, lower, finish, succOf, supported, Prog, uses, def, pure, dump,
  flagEffect, liveFlagsAt, ALL6,
  NREG, SEGV, FIRST_TEMP, FLAGS, FBIT, CC_NAMES, CC_READS, ccEval, SIDE,
};
