'use strict';

// The µop tier in a live run (run-dos.js `uop`, CLI `--uop`).
//
//   PROFILE  slice ends inside [sampleAfter, sampleAfter + profileFor) are
//            program-counter samples, exactly as run-dos's `sample` takes
//            them, attributed to blocks with trace-jit.js rankSamples.
//   PICK     the hottest blocks (up to `top`, each at least `minShare` of the
//            samples) become µop program heads: uop-ir discover from the
//            guest's CURRENT bytes, uop-opt build, lowered and encoded for E1.
//   INSTALL  the head goes into CodeCache.uopHeads, which the compiler leaves
//            as a handback (compile.js `handbackAt`), and the compiled
//            code that holds it is made to hand back there (hold). The
//            program keeps a copy of the bytes it was built from.
//   RUN      DosSession.step asks `at()` at every handback; standing at a live
//            head, the program runs the slice with the slice's own budget and
//            hands the machine back wherever it exits. Its bytes carry code
//            bits only for the length of the run (guard/unguard).
//
// No wasm is generated: E1's module depends on the engine's op table alone and
// is instantiated once before the run starts; a program is data written into
// the engine page. A program whose bytes no longer match its copy is rebuilt
// from the new bytes the next time the guest stands at its head --
// up to `maxRebuilds`, after which the head goes back to the compiled path.

const IR = require('./uop-ir');
const OPT = require('./uop-opt');
const W = require('./uop-wasm');
const isa = require('./isa');
const { H } = require('./decode');
const { rankSamples } = require('./trace-jit');
function envFromKey(key, mask) {
  const d32 = typeof key === 'string' && key.endsWith('d');
  const ip32 = d32 || (typeof key === 'string' && key.endsWith('w'));
  return { codeBase: typeof key === 'number' ? key : parseInt(key, 10), mask, d32, ip32 };
}

class UopLive {
  constructor({ session, vm, sampleAfter = 0, profileFor = 2e6, top = 4, minShare = 0.03,
    maxRebuilds = 16, every = 0, maxHeads = 16, judgeAfter = 256, minPerEntry = 200, bailEvery = 64, passes = null, resume = true, log = () => {} }) {
    this.session = session;
    this.vm = vm;
    this.cache = session.cache;
    this.sampleAfter = sampleAfter;
    this.profileFor = profileFor;
    this.top = top;
    this.minShare = minShare;
    this.maxRebuilds = maxRebuilds;
    this.passes = passes;
    this.resumeExits = resume;
    this.log = log;
    // Profile windows: the first at sampleAfter, then one every `every`
    // dispatches (0: ten windows' length) while there is room for heads.
    this.every = every || 10 * profileFor;
    this.maxHeads = maxHeads;
    this.judgeAfter = judgeAfter;
    this.minPerEntry = minPerEntry;
    this.bailEvery = bailEvery;
    this.nextAt = sampleAfter;
    this.windowEnd = 0;
    this.samples = null;
    this.ranUop = false;
    this.windows = 0;
    this.phase = 'wait';
    this.heads = new Map();        // `key:ip` -> head record
    this.refused = new Set();      // heads a build declined: not retried
    this.run = null;
    this.stats = { installs: 0, declined: [], entries: 0, steps: 0, rebuilds: 0, gaveUp: 0, bails: 0, demoted: [] };
    session.uop = this;
  }

  async init() { this.run = await W.e1Runner(this.vm); return this; }

  // Once per slice. A slice a program ran is not a sample: $ip is the arena
  // address the compiled code last stood at, not where the guest is -- and
  // what is left to find is the time the programs do NOT cover yet.
  sample({ left, dispatched }) {
    const uopSlice = this.ranUop;
    this.ranUop = false;
    if (!this.samples) {
      if (dispatched < this.nextAt || this.heads.size >= this.maxHeads) return;
      this.samples = new Map();
      this.windowEnd = dispatched + this.profileFor;
      if (this.phase === 'wait') this.phase = 'profile';
    }
    if (left < 0 && !uopSlice) {
      const at = this.vm.raw('ip');
      this.samples.set(at, (this.samples.get(at) || 0) + 1);
    }
    if (dispatched >= this.windowEnd) {
      this.install();
      this.samples = null;
      this.nextAt = dispatched + this.every;
    }
  }

  install() {
    this.phase = 'live';
    this.windows++;
    const rank = rankSamples({ ipSamples: this.samples, ipSampleLog: [], regions: this.cache.regions });
    const total = rank.ranked.reduce((s, b) => s + b.samples, 0) || 1;
    const mask = this.vm.exports.get_linmask() >>> 0;
    for (const b of rank.ranked.slice(0, this.top)) {
      if (this.heads.size >= this.maxHeads) break;
      if (b.samples / total < this.minShare) break;
      const hk = `${b.cs}:${b.bip}`;
      if (this.heads.has(hk) || this.refused.has(hk)) continue;
      const env = envFromKey(b.cs, mask);
      const h = { hk, key: b.cs, ip: b.bip, env, share: b.samples / total, prog: null, enter: null, rebuilds: 0 };
      if (!this.build(h)) { this.refused.add(hk); this.stats.declined.push(`${hk} ${h.why}`); continue; }
      this.heads.set(hk, h);
      this.cache.uopHeads.add(hk);
      // No linked edge may carry the guest past the head: the compiled code
      // that holds it is made to hand back there (hold), and the next
      // compile leaves it a handback on its own.
      this.hold(h);
      this.stats.installs++;
      this.log(`uop: window ${this.windows}: head ${hk} (${(h.share * 100).toFixed(1)}% of samples) installed`);
    }
  }

  // Discover, optimize, lower and encode the program at a head from the bytes
  // there now. False (with h.why) when the region or the engine declines it.
  build(h) {
    try {
      const vm = this.vm;
      const reg = IR.discover((lin) => vm.mem[lin], h.env, h.ip);
      if (!reg.body.size) { h.why = 'empty body'; return false; }
      // A straight line is entered, runs a few instructions and hands back:
      // it costs a host round trip and saves nothing. Loops only.
      if (!reg.cyclic) { h.why = 'not a loop'; return false; }
      const passes = this.passes || OPT.ablationConfigs().find(([n]) => n === 'all')[1];
      const prog = OPT.build(reg, { passes, env: h.env, vm });
      const st = {};
      h.enter = W.e1Enter(vm, prog, this.run, st);
      h.st = st;
      const covered = [];
      for (const k of reg.body) {
        const n = reg.nodes.get(k);
        const lin = (h.env.codeBase + n.ip) & h.env.mask;
        covered.push([lin, lin + n.d.len]);
      }
      h.prog = { covered };
      h.snap = this.snapshot(covered);
      return true;
    } catch (e) {
      h.why = String(e && e.message || e).slice(0, 80);
      return false;
    }
  }

  snapshot(covered) {
    const mem = this.vm.mem, out = [];
    for (const [from, to] of covered) for (let l = from; l < to; l++) out.push(mem[l]);
    return Uint8Array.from(out);
  }

  // The bytes a program was built from are still the bytes there.
  current(h) {
    const mem = this.vm.mem, snap = h.snap;
    let i = 0;
    for (const [from, to] of h.prog.covered) for (let l = from; l < to; l++) if (mem[l] !== snap[i++]) return false;
    return true;
  }

  demote(h, why) {
    this.heads.delete(h.hk);
    this.refused.add(h.hk);
    this.cache.uopHeads.delete(h.hk);
    this.stats.demoted.push(`${h.hk} ${why}`);
    this.release(h);
  }

  // Make every compiled program that holds the head as a block hand back
  // there, WITHOUT dropping it. The head block's first three arena words
  // become `jmp_syn 0, head`: a synthetic jump refunds its own step, and an
  // edge with no arena address asks the jump table and otherwise hands back
  // for free (emit.js HALT_FIRST, GO) -- exactly what an edge into a head
  // that a fresh compile left unresolved does. So the clock sees the same
  // code as before the install, less the one block.
  //
  // Dropping the programs instead is not clock-neutral, whatever it does
  // with the shadow return stack. With the stack reset, every `ret` it turns
  // into a miss takes a different path (cw2.com: -2 over 44M); without it,
  // the recompile still re-forms the blocks around the head, and where the
  // slice's last budget check lands moves with them (ZOKDTPLN.COM: +1, -2
  // or +1 at three budgets, with no µop program ever entered). A program that
  // has the head inside a block, or a block too short to take the jump, is
  // still dropped: there is no other way to stop it running past.
  //
  // The held block is taken out of the block index (entryFor must never
  // resume at it: a slice would hand straight back) and out of the jump
  // table. Everything goes back as it was on release.
  hold(h) {
    const cache = this.cache, arena = new Int32Array(this.vm.mem.buffer);
    const lin = (h.env.codeBase + h.ip) & h.env.mask;
    h.holds = [];
    const drop = new Set();
    for (const prog of (cache.byPara.get(lin >>> 4) || [])) {
      if (!prog.live || !prog.covered.some(([a, b]) => lin >= a && lin < b)) continue;
      // Another key over the same bytes never stands at this head.
      if (prog.key !== h.key) continue;
      const addr = prog.blocks.get(h.ip);
      if (addr === undefined) { drop.add(prog); continue; }
      const q = (addr - prog.arenaBase) >> 2;
      let end = prog.words.length;
      for (const a of prog.blocks.values()) if (a > addr) end = Math.min(end, (a - prog.arenaBase) >> 2);
      if (end - q < 3) { drop.add(prog); continue; }
      const rec = { prog, q, addr, para: lin >>> 4, resets: cache.arenaResets, indexed: false, jslot: -1 };
      const idx = cache.blockIndex.get(prog.key);
      if (idx && idx.get(h.ip) === prog) { idx.delete(h.ip); rec.indexed = true; }
      const slot = isa.jhash(prog.cs, h.ip) * 4;
      if (cache.jtab[slot] === h.ip && cache.jtab[slot + 1] === (prog.cs & 0xFFFF) && cache.jtab[slot + 2] === addr) {
        cache.jtab[slot + 2] = 0;
        rec.jslot = slot;
      }
      this.patch(rec, h.ip, arena);
      h.holds.push(rec);
    }
    if (drop.size) cache.dropProgs(drop);
  }

  patch(rec, ip, arena) {
    const at = rec.addr >> 2;
    arena[at] = H.jmp_syn;
    arena[at + 1] = 0;
    arena[at + 2] = ip;
  }

  // The held program still stands where it stood, in arena that has not been
  // recycled: dropProgs clears `live`, a flush empties byPara, an arena reset
  // counts itself.
  held(rec) {
    return rec.prog.live && rec.resets === this.cache.arenaResets
      && (this.cache.byPara.get(rec.para) || []).includes(rec.prog);
  }

  // A repair plan patches operand words in place, and the head instruction's
  // may be among the three a hold overwrote. The repair lands in prog.words
  // too, which is what release restores from, so here it is only undone in
  // the arena. Once per slice, before the slice runs.
  keep() {
    let arena = null;
    for (const h of this.heads.values()) {
      if (!h.holds) continue;
      for (const rec of h.holds) {
        if (!this.held(rec)) continue;
        arena = arena || new Int32Array(this.vm.mem.buffer);
        const at = rec.addr >> 2;
        if (arena[at] !== H.jmp_syn || arena[at + 1] !== 0 || arena[at + 2] !== h.ip) this.patch(rec, h.ip, arena);
      }
    }
  }

  // The head goes back to the compiled path: every held block as it was.
  release(h) {
    const cache = this.cache, arena = new Int32Array(this.vm.mem.buffer);
    for (const rec of h.holds || []) {
      if (!this.held(rec)) continue;
      const { prog, q, addr } = rec;
      for (let k = 0; k < 3; k++) arena[(addr >> 2) + k] = prog.words[q + k];
      const idx = cache.blockIndex.get(prog.key);
      if (rec.indexed && idx && !idx.has(h.ip)) idx.set(h.ip, prog);
      if (rec.jslot >= 0 && cache.jtab[rec.jslot] === h.ip && cache.jtab[rec.jslot + 1] === (prog.cs & 0xFFFF)
        && cache.jtab[rec.jslot + 2] === 0) cache.jtab[rec.jslot + 2] = addr;
    }
    h.holds = null;
  }

  // The arena address to resume at, standing at `ip` right after a µop
  // program left there, or 0. The program stands in for the loop of the
  // compiled programs it holds, and where one of those has a block at the
  // exit, its own edge would have gone there: so the guest goes there too,
  // not to a fresh entryFor. The difference is not only the clock. A fresh
  // entry at a volatile ip is an uncached compile, and that compile follows a
  // straight line wherever it goes: ZOKDTPLN.COM's loop at 593 leaves for 5d6,
  // whose line runs through 60d `mov [0x641],bl` into 640 `mov cl,imm` --
  // the immediate that store rewrites -- and ran the old one. The held
  // program was compiled before 5d6 turned volatile and cuts that line at
  // 630, as L1 alone does. Only the step right after the exit, and only at
  // the exit's own ip (an interrupt delivered in between moves it).
  resume(ip, codeBase, d32, ip32) {
    const x = this.exit;
    if (!x || !this.resumeExits) return 0;
    this.exit = null;
    if (x.gip !== (ip >>> 0) || !this.heads.has(x.h.hk) || ip === x.h.ip) return 0;
    const key = d32 ? `${codeBase}d` : (ip32 ? `${codeBase}w` : codeBase);
    if (`${key}` !== `${x.h.key}`) return 0;
    for (const rec of x.h.holds || []) {
      if (!this.held(rec)) continue;
      const addr = rec.prog.blocks.get(ip);
      if (addr !== undefined) { this.stats.resumes = (this.stats.resumes || 0) + 1; return addr; }
    }
    return 0;
  }

  // The program to run standing at (codeBase, ip), or null.
  at(ip, codeBase, mask, d32, ip32) {
    if (!this.heads.size) return null;
    this.keep();
    const key = d32 ? `${codeBase}d` : (ip32 ? `${codeBase}w` : codeBase);
    const h = this.heads.get(`${key}:${ip}`);
    if (!h) return null;
    if (h.env.mask !== (mask >>> 0)) return null;
    if (!this.current(h)) {
      // The guest wrote into the program's bytes since it was built. Rebuild
      // from the new bytes, or give the head back to the compiler.
      if (++h.rebuilds > this.maxRebuilds || !this.build(h)) {
        this.heads.delete(h.hk);
        // Refused, not merely dropped: code rewritten this often is not a
        // loop to hold. Reinstalled, BARTI.COM's 0xb5b gave up a second
        // time and the run went wrong soon after (not yet understood).
        this.refused.add(h.hk);
        this.cache.uopHeads.delete(h.hk);
        this.release(h);
        this.stats.gaveUp++;
        return null;
      }
      this.stats.rebuilds++;
    }
    const self = this;
    return (vm, left) => {
      self.stats.entries++;
      h.entries = (h.entries || 0) + 1;
      self.ranUop = true;
      const b0 = h.st.bails;
      const added = self.guard(h);
      const out = h.enter(vm, left);
      if (added.length) self.unguard(added);
      self.exit = { h, gip: vm.get('gip') >>> 0 };
      self.stats.steps += left - out;
      self.stats.bails += h.st.bails - b0;
      h.steps = (h.steps || 0) + left - out;
      h.bails = (h.bails || 0) + h.st.bails - b0;
      // Judged every judgeAfter entries. A loop that leaves after a few
      // iterations every time buys less than the round trip each entry costs,
      // and one that keeps bailing to the reference interpreter (a VGA
      // window, a straddle, an op the engine lacks) runs slower than L1: give
      // the head back to the compiler.
      if (h.entries % self.judgeAfter === 0) {
        if (h.steps < self.minPerEntry * h.entries) self.demote(h, 'short entries');
        else if (h.bails * self.bailEvery > h.steps) self.demote(h, `bails ${h.bails} in ${h.steps}`);
      }
      return out;
    };
  }

  // A program's bytes carry code bits only while it runs, so a store into
  // them ends the run (the guest may be rewriting the loop it is in) -- and
  // outside a run the bitmap is exactly what the compiled path alone would
  // have made it. Bits the program shares with compiled code stay theirs.
  //
  // This is for the clock. The cache's own self-modify handling -- repair
  // plans, the volatility count, the drop plus the shadow-return-stack reset
  // -- does not come out clock-identical along its different paths, so a
  // break that only the µop tier's bits caused, or a bit that outlived the
  // compiled code it would have shadowed, moved L1's dispatch count with no
  // program even entered (cw2.com: -1 over 44M).
  guard(h) {
    const bits = this.cache.codeBits, added = [];
    for (const [from, to] of h.prog.covered) {
      for (let l = from; l < to; l++) {
        const m = 1 << (l & 7);
        if (!(bits[l >>> 3] & m)) { bits[l >>> 3] |= m; added.push(l); }
      }
    }
    return added;
  }

  // Take the run's own bits down again, and leave a break only as the compiled
  // path would have seen it: none at all when every byte it hit was the
  // program's alone, otherwise narrowed to the compiled code's bytes. The
  // program itself is rebuilt at its next entry if its bytes changed.
  unguard(added) {
    const bits = this.cache.codeBits, ex = this.vm.exports;
    for (const l of added) bits[l >>> 3] &= ~(1 << (l & 7));
    if (!ex.get_smc()) return;
    const lo = ex.get_smclo() >>> 0, hi = ex.get_smchi() >>> 0;
    if (hi - lo > 4096) return;
    let a = -1, b = -1;
    for (let l = lo; l <= hi; l++) if ((bits[l >>> 3] >> (l & 7)) & 1) { if (a < 0) a = l; b = l; }
    if (a < 0) ex.set_smc(0);
    else { ex.set_smclo(a); ex.set_smchi(b); }
  }

  report() {
    return { phase: this.phase, windows: this.windows, heads: [...this.heads.values()].map((h) => ({ head: h.hk, share: h.share, rebuilds: h.rebuilds, entries: h.entries || 0, steps: h.steps || 0, bails: h.bails || 0,
      bailAt: [...h.st.bailAt].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([bid, n]) => `${n}x B${bid} ${h.st.prog.blocks[bid].kind} ${h.st.low.blocks.get(bid).why || 'native'}`) })),
      ...this.stats };
  }
}

module.exports = { UopLive };
