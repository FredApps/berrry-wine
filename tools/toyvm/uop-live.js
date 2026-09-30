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
const { SPIN, PSPIN } = require('./emit');
// The handler indices L1 rewrites a collapsed spin loop INTO (compile.js
// `spinBlocks`): every twin in either table, by value rather than by name, so
// a renumbered handler table cannot make this go quietly stale.
const SPIN_TWINS = new Set([...SPIN.values(), ...PSPIN.values()].map((s) => s.twin));
const { rankSamples } = require('./trace-jit');
function envFromKey(key, mask) {
  const d32 = typeof key === 'string' && key.endsWith('d');
  const ip32 = d32 || (typeof key === 'string' && key.endsWith('w'));
  return { codeBase: typeof key === 'number' ? key : parseInt(key, 10), mask, d32, ip32 };
}

class UopLive {
  constructor({ session, vm, sampleAfter = 0, profileFor = 2e6, top = 4, minShare = 0.03,
    maxRebuilds = 16, every = 0, maxHeads = 16, judgeAfter = 256, minPerEntry = 200, bailEvery = 64,
    minBailSteps = 20000, passes = null, resume = true, chain = false, log = () => {} }) {
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
    // chain: every program lives in one E1 arena (uop-wasm.js E1Arena), with
    // its registers resident, and a static exit onto another installed head
    // goes straight on into that program inside the engine.
    this.chain = chain;
    this.arenaE = null;
    this.log = log;
    // Profile windows: the first at sampleAfter, then one every `every`
    // dispatches (0: ten windows' length) while there is room for heads.
    this.every = every || 10 * profileFor;
    this.maxHeads = maxHeads;
    this.judgeAfter = judgeAfter;
    this.minPerEntry = minPerEntry;
    this.bailEvery = bailEvery;
    this.minBailSteps = minBailSteps;
    this.nextAt = sampleAfter;
    this.windowEnd = 0;
    this.samples = null;
    this.ranUop = false;
    this.windows = 0;
    this.phase = 'wait';
    this.heads = new Map();        // `key:ip` -> head record
    this.refused = new Set();      // heads a build declined: not retried
    this.run = null;
    this.stats = { installs: 0, declined: [], entries: 0, steps: 0, rebuilds: 0, gaveUp: 0, bails: 0, demoted: [], windowLog: [], refusedHeads: [], demotedHeads: [] };
    session.uop = this;
  }

  async init() {
    this.run = await W.e1Runner(this.vm);
    if (this.chain) this.arenaE = new W.E1Arena(this.vm, this.run);
    return this;
  }

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
    const sampled = rank.ranked.reduce((s, b) => s + b.samples, 0);
    const total = sampled || 1;
    // What this window saw, whether or not it installs anything: a program
    // that never installs a head has to say which gate stopped it, and every
    // gate before build() leaves nothing in `declined` (see outcome()).
    this.stats.windowLog.push({ samples: sampled, best: rank.ranked.length ? rank.ranked[0].samples / total : 0,
      over: rank.ranked.slice(0, this.top).filter((b) => b.samples / total >= this.minShare).length });
    const mask = this.vm.exports.get_linmask() >>> 0;
    for (const b of rank.ranked.slice(0, this.top)) {
      if (this.heads.size >= this.maxHeads) break;
      if (b.samples / total < this.minShare) break;
      const hk = `${b.cs}:${b.bip}`;
      if (this.heads.has(hk) || this.refused.has(hk)) continue;
      const env = envFromKey(b.cs, mask);
      const h = { hk, key: b.cs, ip: b.bip, env, share: b.samples / total, prog: null, enter: null, rebuilds: 0 };
      if (this.spinCollapsed(h)) { h.why = 'L1 collapses this spin loop'; }
      else if (!this.build(h)) { /* h.why set by build */ }
      if (h.why) {
        this.refused.add(hk);
        this.stats.declined.push(`${hk} ${h.why}`);
        // With its share of the window's samples, so a census can weigh a
        // refusal by the time it leaves on the table (uop-coverage.js).
        this.stats.refusedHeads.push({ head: hk, share: h.share, window: this.windows, why: h.why });
        continue;
      }
      this.heads.set(hk, h);
      this.cache.uopHeads.add(hk);
      // No linked edge may carry the guest past the head: the compiled code
      // that holds it is made to hand back there (hold), and the next
      // compile leaves it a handback on its own.
      this.hold(h);
      this.stats.installs++;
      this.log(`uop: window ${this.windows}: head ${hk} (${(h.share * 100).toFixed(1)}% of samples) installed`
        + ` [${h.shape.insns} insns, ${h.shape.per.toFixed(2)} uop/insn, ${h.shape.bail} bail block(s)]`);
    }
  }

  // L1 ALREADY RUNS THIS LOOP IN ONE DISPATCH, so a micro-op program at the
  // same head can only lose it, however fast the engine is. compile.js
  // rewrites a block that is one branch back to its own head into a `_spin`
  // twin, and that twin spends the WHOLE remaining budget in a single
  // dispatch (emit.js jccSpinArm) instead of going round the loop. A program
  // installed over it goes round the loop for real.
  //
  // This is DEMO5.EXE, the corpus's worst regression at x1.38 (v8) / x1.54
  // (sm): its hot head at 4352:a5c is `jmp short $`, a one-instruction spin
  // waiting for an interrupt, and 78.6% of its dispatches were being spent
  // inside a micro-op program running it. The program was not bailing, was
  // entered only 934 times for 21,279 steps each, and was still 1.47x slower
  // than L1 on the stretch it covered -- because L1's stretch is one handler
  // call and the program's is 19.8M iterations of a two-micro-op loop.
  //
  // Asked of the COMPILED CODE rather than of the region, because the rule is
  // L1's and reading its answer cannot drift from it: the twin is in the
  // arena word, put there by the same pass that decides a block is eligible.
  spinCollapsed(h) {
    const lin = (h.env.codeBase + h.ip) & h.env.mask;
    for (const prog of (this.cache.byPara.get(lin >>> 4) || [])) {
      if (!prog.live || `${prog.key}` !== `${h.key}`) continue;
      const addr = prog.blocks.get(h.ip);
      if (addr === undefined) continue;
      if (SPIN_TWINS.has(prog.words[(addr - prog.arenaBase) >> 2])) return true;
    }
    return false;
  }

  // Why discovery found no cycle through the head: everything that ended an
  // explored path. Exploration stops at an instruction outside uop-x86.js's
  // subset (`unsupported`), at a ret with no inlined caller to return to
  // (`ret`: the head is in a function and the loop runs through its caller),
  // at the inlining depth (`call depth`) and at the node cap (`node cap`).
  // With none of those, every path left the explored code (`exits`): the
  // head really is not on a loop. Kinds only, most frequent first, so the
  // corpus census (uop-coverage.js) can group heads by what to build next.
  cutOf(reg) {
    const cut = new Map();
    const bump = (k) => cut.set(k, (cut.get(k) || 0) + 1);
    for (const n of reg.nodes.values()) {
      if (n.unsupported === 'call depth') bump('call depth');
      else if (n.unsupported) bump(`unsupported ${n.unsupported}`);
      else if (n.d.kind === 'ret' && !n.ctx.length) bump('ret');
    }
    if (reg.nodes.size >= 400) bump('node cap');
    if (!cut.size) return 'exits';
    return [...cut].sort((a, b) => b[1] - a[1]).map(([k]) => k).join(', ');
  }

  // Discover, optimize, lower and encode the program at a head from the bytes
  // there now. False (with h.why) when the region or the engine declines it.
  build(h) {
    try {
      const vm = this.vm;
      const reg = IR.discover((lin) => vm.mem[lin], h.env, h.ip, { benign: this.cache.benign });
      if (!reg.body.size) { h.why = `head unsupported: ${reg.nodes.get(reg.headKey).unsupported}`; return false; }
      // A straight line is entered, runs a few instructions and hands back:
      // it costs a host round trip and saves nothing. Loops only.
      if (!reg.cyclic) { h.why = `not a loop: ${this.cutOf(reg)}`; return false; }
      const passes = this.passes || OPT.ablationConfigs().find(([n]) => n === (this.chain ? 'allRP' : 'all'))[1];
      const prog = OPT.build(reg, { passes, env: h.env, vm });
      const st = {};
      if (this.chain) {
        if (h.rec) this.arenaE.dropHead(h.rec, h.ip);
        h.rec = null;
        const rec = this.arenaE.add(prog, `${h.key}|${h.env.mask}`, st);
        rec.h = h;
        h.rec = rec;
        h.enter = (vm2, left) => this.arenaE.enter(rec, left);
      } else h.enter = W.e1Enter(vm, prog, this.run, st);
      h.st = st;
      const covered = [];
      for (const k of reg.body) {
        const n = reg.nodes.get(k);
        const lin = (h.env.codeBase + n.ip) & h.env.mask;
        covered.push([lin, lin + n.d.len]);
      }
      h.prog = { covered };
      // A loop that patches ITSELF through a fixed address. In the program the
      // store lands on bytes only the program's guard marks, so the run goes
      // on to the next header; pure L1 has those bytes compiled, takes the
      // self-modify break at its next transfer, and the two hand back at
      // different instructions from then on (ZOKDTPLN.COM's `mov dword
      // [0x551]` into the immediate of an `add` further down its own body).
      // Left to L1, which is exact. Seen at build with the segment bases of
      // the moment: a fixed-address store names one byte range per base.
      const selfStore = this.patchesItself(reg, covered);
      if (selfStore) { h.why = `patches its own code at ${selfStore}`; return this.unbuilt(h); }
      h.snap = this.snapshot(covered);
      h.shape = this.shapeOf(reg, h.st);
      // A BLOCK IN THE LOOP'S BODY THE ENGINE CANNOT RUN is a hand-off to the
      // JS reference interpreter on EVERY iteration -- the engine's setup and
      // write-back paid in full, and then the slow path. Measured: do.exe's
      // three heads each carry two of them (an `op 8e`, `mov sreg,r/m`, that
      // the lowering does not have) and bail 47 times per 1000 steps against
      // a winner's 0.05, for x1.35 (v8) / x1.81 (sm) over the whole program.
      // A bail somewhere off the loop -- a deopt arm, an exit -- is fine and
      // is not counted here; this is the body alone.
      if (h.shape.bail) { h.why = `bail block(s) in the loop body (${h.shape.bail})`; return this.unbuilt(h); }
      if (h.rec) this.arenaE.setHead(h.rec, h.ip);
      return true;
    } catch (e) {
      h.why = String(e && e.message || e).slice(0, 80);
      return this.unbuilt(h);
    }
  }

  // A build that did not end installed leaves nothing in the arena to link to.
  unbuilt(h) {
    if (h.rec) { this.arenaE.dropHead(h.rec, h.ip); h.rec = null; }
    return false;
  }

  // WHAT A HEAD IS, BEFORE IT HAS RUN ONCE. Three numbers, all of them free
  // (the lowering has already computed everything they read), and all three
  // measured to separate the corpus's winners from its losers:
  //
  //   insns  x86 instructions in the region's body. A body of one or two is a
  //          spin loop, and the engine cannot win one: L1 dispatches one
  //          handler per instruction and the engine runs `per` micro-ops.
  //   per    micro-ops in the FAST body per x86 instruction of it. ANARCHY
  //          (x0.40) is 1.20; DEMO5 (x1.38) is 2.00 over a one-instruction
  //          body; do.exe (x1.35) is 2.03.
  //   bail   fast body blocks the engine cannot run natively. One of these in
  //          the body is a hand-off to the JS reference interpreter EVERY
  //          iteration, which is the shape do.exe and acme-sns lose on -- 47
  //          and 23 bails per 1000 steps against a winner's 0.05.
  shapeOf(reg, st) {
    let uops = 0, bail = 0, body = 0;
    for (const [id, b] of st.low.blocks) {
      const pb = st.prog.blocks[id];
      if (!pb || !pb.fast || pb.kind !== 'body') continue;
      body++;
      if (b.native) uops += b.ops.length; else bail++;
    }
    return { insns: reg.body.size, blocks: body, uops, bail,
      per: uops / Math.max(1, reg.body.size) };
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
    if (h.rec) { this.arenaE.dropHead(h.rec, h.ip); h.rec = null; }
    this.heads.delete(h.hk);
    this.refused.add(h.hk);
    this.cache.uopHeads.delete(h.hk);
    this.stats.demoted.push(`${h.hk} ${why}`);
    this.stats.demotedHeads.push({ head: h.hk, share: h.share, why });
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
    const cache = this.cache, arena = this.arena;
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
  // The arena as words. ONE view, not one per call: `keep()` below runs at
  // every slice for as long as any head is installed, and a
  // `new Int32Array(buffer)` there is an allocation on the per-slice path of
  // every program that ever installs anything -- including the ones whose
  // heads the guest hardly ever stands at. The toy VM's memory is created with
  // initial === maximum and never grows, so the view cannot go stale.
  get arena() {
    if (!this._arena || this._arena.buffer !== this.vm.mem.buffer) this._arena = new Int32Array(this.vm.mem.buffer);
    return this._arena;
  }

  keep() {
    let arena = null;
    for (const h of this.heads.values()) {
      if (!h.holds) continue;
      for (const rec of h.holds) {
        if (!this.held(rec)) continue;
        arena = arena || this.arena;
        const at = rec.addr >> 2;
        if (arena[at] !== H.jmp_syn || arena[at + 1] !== 0 || arena[at + 2] !== h.ip) this.patch(rec, h.ip, arena);
      }
    }
  }

  // The head goes back to the compiled path: every held block as it was.
  release(h) {
    const cache = this.cache, arena = this.arena;
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
        if (h.rec) { this.arenaE.dropHead(h.rec, h.ip); h.rec = null; }
        this.heads.delete(h.hk);
        // Refused, not merely dropped: code rewritten this often is not a
        // loop to hold. Reinstalled, BARTI.COM's 0xb5b gave up a second
        // time and the run went wrong soon after (not yet understood).
        this.refused.add(h.hk);
        this.cache.uopHeads.delete(h.hk);
        this.release(h);
        this.stats.gaveUp++;
        this.stats.demotedHeads.push({ head: h.hk, share: h.share, why: `gave up: ${h.why || 'rebuilds'}` });
        return null;
      }
      this.stats.rebuilds++;
    }
    // Every program a chain from here can reach runs on bytes it was built
    // from, or is unlinked: it rebuilds when the guest next stands at its own
    // head, and its links come back with it. A program whose bytes came back
    // is linked again here.
    let reach = null;
    if (h.rec) {
      const A = this.arenaE;
      if (A.heads.get(`${h.rec.key}:${h.ip}`) !== h.rec) A.setHead(h.rec, h.ip);
      for (const r of A.closure(h.rec)) if (r !== h.rec && r.h && !this.current(r.h)) A.dropHead(r, r.h.ip, false);
      reach = A.closure(h.rec).map((r) => r.h);
    }
    const self = this;
    return (vm, left) => {
      self.stats.entries++;
      h.entries = (h.entries || 0) + 1;
      self.ranUop = true;
      const b0 = h.st.bails;
      const added = reach ? self.guardAll(reach) : self.guard(h);
      const out = h.enter(vm, left);
      if (added.length) self.unguard(added);
      self.exit = { h: reach && self.arenaE.last && self.arenaE.last.h ? self.arenaE.last.h : h, gip: vm.get('gip') >>> 0 };
      self.stats.steps += left - out;
      self.stats.bails += h.st.bails - b0;
      h.steps = (h.steps || 0) + left - out;
      h.bails = (h.bails || 0) + h.st.bails - b0;
      // Judged every judgeAfter entries. A loop that leaves after a few
      // iterations every time buys less than the round trip each entry costs,
      // and one that keeps bailing to the reference interpreter (a VGA
      // window, a straddle, an op the engine lacks) runs slower than L1: give
      // the head back to the compiler.
      //
      // THE BAIL RATE IS READ AS SOON AS IT MEANS ANYTHING, not at the 256th
      // entry. It is a ratio, and it is stable from the start: acme-sns.exe's
      // two heads sit at 22 bails per 1000 steps from their first entries and
      // the worst WINNER in the corpus (CLASH.EXE) is 1.17, so `minBailSteps`
      // of them is already a decided question. Waiting for `judgeAfter`
      // entries bought acme-sns 3.9M and 4.0M steps of running slowly before
      // either head was given back -- 17.9% of its dispatches, and its whole
      // x1.28. The short-entry test still waits, because that one is a
      // statement about how the GUEST uses the loop and a handful of entries
      // says nothing about it.
      if (h.steps >= self.minBailSteps && h.bails * self.bailEvery > h.steps) {
        self.demote(h, `bails ${h.bails} in ${h.steps}`);
      } else if (h.entries % self.judgeAfter === 0 && h.steps < self.minPerEntry * h.entries) {
        self.demote(h, 'short entries');
      }
      return out;
    };
  }

  // The first memory-destination instruction of the region whose address is a
  // constant and lands in its own bytes, as "ip->lin", or null.
  patchesItself(reg, covered) {
    const dv = new DataView(this.vm.mem.buffer);
    for (const k of reg.body) {
      const d = reg.nodes.get(k).d;
      const m = d.dst;
      if (!m || m.t !== 'm' || m.base >= 0 || (m.index !== undefined && m.index >= 0)) continue;
      const lin = (dv.getUint32(isa.REGFILE_SEGB + 4 * m.seg, true) + m.disp) >>> 0;
      const w = (m.w || d.w || 32) >> 3;
      for (const [from, to] of covered) {
        if (lin < to && lin + w > from) return `${d.ip.toString(16)}->${lin.toString(16)}`;
      }
    }
    return null;
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
  guard(h) { return this.guardAll([h]); }

  // A chained run's bytes are every program it can reach.
  guardAll(hs) {
    const bits = this.cache.codeBits, added = [];
    for (const h of hs) for (const [from, to] of h.prog.covered) {
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

  // Why this run did or did not end with a µop program, as the FIRST gate in
  // the install chain that stopped it. `declined` alone cannot answer this:
  // only heads that reached spinCollapsed/build are recorded there, so a run
  // that never finished a profile window, or never saw a block at minShare,
  // leaves it empty and looks identical to one that was never asked.
  //
  //   no-window    the run ended before the first window opened (sampleAfter)
  //   window-open  the run ended inside the first window
  //   no-samples   every window closed with zero samples: no slice ran out of
  //                budget in guest code (the time went to halts, host calls,
  //                or slices a program already covered)
  //   no-hot-head  samples, but no block reached minShare in any window
  //   declined     candidates reached the install chain and every one was
  //                refused (the reasons are in `declined`)
  //   dropped      heads installed, and all were later demoted or given up
  //   installed    at least one head still live at the end
  outcome() {
    if (this.heads.size) return 'installed';
    if (this.stats.installs) return 'dropped';
    if (this.stats.declined.length) return 'declined';
    if (this.phase === 'wait') return 'no-window';
    if (!this.windows) return 'window-open';
    if (this.stats.windowLog.every((w) => !w.samples)) return 'no-samples';
    return 'no-hot-head';
  }

  // Where chained runs left the arena, most frequent first, and what stands
  // at each exit: an installed head (the link was not taken: budget or SMC),
  // an instruction the µop tier has no form for (L1's, by design), or code a
  // program could be built at -- which is what linking cannot reach yet.
  exitCensus(top = 8) {
    const A = this.arenaE, mask = this.vm.exports.get_linmask() >>> 0;
    let total = 0;
    for (const n of A.exits.values()) total += n;
    const head = `early ${total} of ${total + A.dueExits}`;
    return [head, ...[...A.exits].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, n]) => {
      const [id, gip] = k.split(':').map(Number);
      const rec = A.progs[id], h = rec.h;
      let what;
      if (!h) what = 'orphan';
      else if (A.heads.has(`${rec.key}:${gip}`)) what = 'head';
      else {
        try {
          const reg = IR.discover((lin) => this.vm.mem[lin], envFromKey(h.key, mask), gip, { benign: this.cache.benign });
          what = !reg.body.size ? `unsupported ${reg.nodes.get(reg.headKey).unsupported}` : reg.cyclic ? 'loop' : `line ${reg.body.size}i`;
        } catch (e) { what = `? ${String(e.message).slice(0, 30)}`; }
      }
      return `${(100 * n / total).toFixed(1)}% ${h ? h.hk : id}->${gip} ${what}`;
    })];
  }

  report() {
    const log = this.stats.windowLog;
    return { phase: this.phase, outcome: this.outcome(), windows: this.windows,
      bestShare: log.reduce((m, w) => Math.max(m, w.best), 0), samples: log.reduce((s, w) => s + w.samples, 0),
      heads: [...this.heads.values()].map((h) => ({ head: h.hk, share: h.share, rebuilds: h.rebuilds, entries: h.entries || 0, steps: h.steps || 0, bails: h.bails || 0, shape: h.shape,
      bailAt: [...h.st.bailAt].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([bid, n]) => `${n}x B${bid} ${h.st.prog.blocks[bid].kind} ${h.st.low.blocks.get(bid).why || 'native'}`) })),
      chains: this.arenaE ? this.arenaE.chains : 0, exitsAt: this.arenaE ? this.exitCensus() : [], arenaBytes: this.arenaE ? this.arenaE.at - this.arenaE.progs[0]?.codeFrom || 0 : 0,
      ...this.stats };
  }
}

module.exports = { UopLive };
