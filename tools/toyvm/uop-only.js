'use strict';

// The µop-only arm (run-dos.js `uopOnly`, CLI `--uop-only`): every instruction
// the guest runs goes through a micro-op program on the E1 engine, and no
// compiled L1 block ever runs more than ONE instruction.
//
// It is an ARM, not a replacement. L1 (threaded x86) stays next to it, as the
// arm it is measured against and as the exactness oracle: the same guest, the
// same dispatch clock, the same frame.
//
//   AT       DosSession.step asks `at()` at every handback. The first time
//            the guest stands at (code key, mask, ip), a program is built
//            there from the guest's current bytes: uop-ir discover (the loop
//            nest through the ip if there is one, else the straight line from
//            it -- `shape: 'straight'` asks for the line always), uop-opt
//            build with resident registers, lowered and encoded into the E1
//            arena (uop-wasm.js E1Arena). Its head is registered, so every
//            other program's static exit to that ip is linked straight into
//            it: after the first time, that edge never leaves the engine.
//   FALLBACK An instruction the µop set has no form for -- a rep string op,
//            `int`, a far call, `in`/`out` -- cannot start a program. L1
//            runs exactly that one instruction (compile.js `oneInsn`, the
//            block TF single-stepping runs) and hands back after it. The
//            block is compiled once per site and copied into the scratch
//            words at the end of L1's arena on each use. Counted by what the
//            µop set is missing, which is the work list for this arm.
//   LAZY     An exit whose target has no program yet hands back to the
//            session; the next `at()` builds the target and links every
//            exit that goes there. A dynamic exit (a `ret`, an indirect jump)
//            always hands back: the session looks the target up.
//   SMC      A program's bytes carry code bits for as long as it lives, so a
//            guest store into them breaks the slice exactly as a store into
//            L1's compiled code does. The session's invalidation drops every
//            program over the written bytes (CodeCache.invalidateRange and
//            flush are wrapped here); each is rebuilt from the new bytes the
//            next time the guest stands at its head.
//
// Nothing here generates wasm: E1's module is instantiated once in init().

const IR = require('./uop-ir');
const OPT = require('./uop-opt');
const W = require('./uop-wasm');
const isa = require('./isa');
const { compileProgram } = require('./compile');
const { EXIT_WHY, ARITY } = require('./emit');
const { H } = require('./decode');
const { STUB_SEG, STUB_BYTE } = require('./dos');
const EXIT_END = EXIT_WHY.end;
// The ways a fallback may end and still be a CLEAN handback (drive): straight
// on, or a near or far transfer the session would only look the target of up.
// Not `int` (a vector to service), `popf` or an `iret` that opens an
// interrupt window (an iret that only missed its lookup is clean: drive), or
// anything stranger.
const FB_ON = new Set([EXIT_WHY.end, EXIT_WHY.edge, EXIT_WHY.indirect, EXIT_WHY.ret]);

class UopOnly {
  constructor({ session, vm, passes = 'allRP', linePasses = null, shape = 'loop', only = null, ref = false, stay = true, io = true, maxLine = 32, tier = null, log = () => {} }) {
    this.session = session;
    this.vm = vm;
    this.cache = session.cache;
    this.passName = passes;
    this.passes = typeof passes === 'string' ? OPT.ablationConfigs().find(([n]) => n === passes)[1] : passes;
    // Resident registers only (any model: 'promote', true, 'full'): a chain
    // carries no vreg state but L1's register file. resident: true once left
    // ACCIDENT.EXE for DOS at 1.2M dispatches -- a narrow register's reads saw
    // its slot's upper bits (uop-opt.js finalize now masks them).
    if (!this.passes || !this.passes.resident) throw new Error(`uop-only: passes ${passes} are not resident`);
    // A straight line is cold by construction -- it runs until it reaches a
    // loop head or leaves -- so it may be built with a cheaper pass set: the
    // optimizer's fixed cost per program is most of this arm's build time.
    this.linePassName = linePasses || passes;
    this.linePasses = !linePasses ? this.passes
      : typeof linePasses === 'string' ? (OPT.ablationConfigs().find(([n]) => n === linePasses) || [])[1] : linePasses;
    if (!this.linePasses || !this.linePasses.resident) throw new Error(`uop-only: passes ${linePasses} are not resident`);
    this.shape = shape;
    // The longest straight line built (see build).
    this.maxLine = maxLine;
    // A bisecting aid: when set, programs start only at these ips and every
    // other site runs on the L1 fallback.
    this.only = only ? new Set(only) : null;
    // ...and another: run every program on the JS reference interpreter
    // (uop-ref.js) instead of E1, which splits "the program is wrong" from
    // "its lowering is".
    this.ref = ref;
    // Keep running across a clean handback (see drive) instead of returning
    // to the session after every program exit and every fallback.
    this.stay = stay;
    // Port reads (`in`) as µops (uop-ir.js PIN), not L1 fallbacks.
    this.io = io;
    // REP MOVS/STOS as a call into L1's run (uop-ir.js REP), where every
    // program is naive and resident (a tier-up of one is refused and it stays
    // cold). TOYVM_UOPREP=0 is the A/B arm: the old L1 fallback.
    this.rep = !!(this.passes.naive && this.linePasses.naive)
      && globalThis.TOYVM_UOPREP !== '0'
      && (typeof process === 'undefined' || !process.env || process.env.TOYVM_UOPREP !== '0');
    this.log = log;
    this.run = null;
    this.A = null;
    // `key|mask:ip` -> the enter function the session runs there. One map for
    // both kinds of site, so the per-handback lookup is one hash.
    this.sites = new Map();
    // ...and the same sites by `key|mask:` then by ip, which is how drive
    // looks the next one up: a number into the current key's map, no string.
    this.byKey = new Map();
    this.preIdx = new Map();   // code base -> [{ mask, fl, m: byKey's map }] (siteOf)
    // Which fallback's words the scratch at the end of L1's arena holds.
    // Only fallbacks write there inside a drive; the session may between
    // them (TF single-stepping compiles there), so drive clears it on entry.
    this.scratch = null;
    // paragraph -> the sites that decoded a byte in it
    this.byPara = new Map();
    // `key|mask:ip` -> how many live loop programs have that ip in their body
    // (not as their head). A handback there -- after a fallback or a dynamic
    // exit in the middle of a loop -- builds the straight line from it, which
    // links into the loop at its head, instead of the whole nest again with a
    // second head: AUTUMN built one 53-instruction nest six times over.
    this.inLoop = new Map();
    // Ips inside a loop too big to build (more vregs than a program may
    // name): built as straight lines from the start. A hint, never cleared --
    // a line is correct whatever the bytes become.
    this.lineCap = new Map();   // site -> line length a rebuild goes straight to
    this.progCache = new Map(); // progKey -> [{ lins, bytes, prog }], newest first
    // Tier-up: { passes, after }. Every program is first built on `passes`
    // (the cold tier) with a counter its loop headers bump; once a site's
    // counter reaches `after`, its region is rebuilt on tier.passes and put at
    // its head in place -- every link into it re-pointed (setHead). Checked
    // at the start of each drive(): sites reached only through links never
    // come back to JS, so their entries are counted in wasm, not here.
    this.tier = tier ? { ...tier, cfg: typeof tier.passes === 'string'
      ? OPT.ablationConfigs().find(([n]) => n === tier.passes)[1] : tier.passes } : null;
    if (this.tier && (!this.tier.cfg || !this.tier.cfg.resident)) throw new Error(`uop-only: tier passes ${tier.passes} are not resident`);
    this.cold = [];             // sites on the cold tier, counting
    this.progCacheSize = 0;
    this.tooBig = new Set();
    this.stats = {
      builds: 0, fbSites: 0, entries: 0, uopSteps: 0, fbEntries: 0, fbSteps: 0,
      invalidated: 0, flushes: 0, arenaResets: 0, buildNs: 0n, tierUps: 0, tierNs: 0n, tierFails: new Map(), stays: 0, modeStays: 0, calls: 0, ioCuts: 0, farStays: 0, builtStays: 0, lineRetries: 0, progHits: 0,
      // why drive handed the slice back to the session
      why: { budget: 0, smc: 0, fbExit: 0, mode: 0, unbuilt: 0, ifen: 0 },
      fbExitWhy: new Map(),    // `fallback why>exitwhy` -> handbacks
      fbWhy: new Map(),        // why -> { sites, entries, steps }
      shapes: { loop: 0, line: 0 },
    };
    session.uop = this;
    // The session's own self-modify handling reaches the µop programs through
    // these two: a narrow drop over the written bytes, and "everything".
    const cache = this.cache, self = this;
    const inv = cache.invalidateRange.bind(cache), flush = cache.flush.bind(cache);
    cache.invalidateRange = function (lo, hi) { inv(lo, hi); self.drop(lo, hi); };
    cache.flush = function () { flush(); self.dropAll(); };
  }

  async init() {
    this.run = await W.e1Runner(this.vm);
    this.A = new W.E1Arena(this.vm, this.run);
    this.A.noteExits = false;
    return this;
  }

  // The live tier's hooks, which this arm has no use for: it does not
  // profile, and no compiled L1 program exists to resume into.
  sample() {}
  resume() { return 0; }

  at(ip, codeBase, mask, d32, ip32) {
    if (this.vm.exports.get_cr0() < 0) return null;
    return this.siteOf(ip, codeBase, mask, d32, ip32).go;
  }

  siteOf(ip, codeBase, mask, d32, ip32) {
    // Building the two string keys and hashing them cost CONTAGIO 6.7% of its
    // whole run (--cpu-prof, 30M: 108K lookups under 39 prefixes), so a
    // lookup finds its prefix's map by number -- code base, then a scan of
    // the few mask/mode pairs seen under it -- and strings are only built for
    // a site that is not there. byKey's per-prefix maps are never replaced.
    const mk = mask >>> 0, fl = (d32 ? 2 : 0) | (ip32 ? 1 : 0);
    const list = this.preIdx.get(codeBase);
    if (list !== undefined) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.mask === mk && c.fl === fl) {
          const s = c.m.get(ip);
          if (s !== undefined) return s;
          break;
        }
      }
    }
    const s = this.siteOfSlow(ip, codeBase, mask, d32, ip32);
    if (!list || !list.some((c) => c.mask === mk && c.fl === fl)) {
      const l = list || [];
      l.push({ mask: mk, fl, m: this.byKey.get(s.pre) });
      if (!list) this.preIdx.set(codeBase, l);
    }
    return s;
  }

  siteOfSlow(ip, codeBase, mask, d32, ip32) {
    const key = d32 ? `${codeBase}d` : (ip32 ? `${codeBase}w` : codeBase);
    const lk = `${key}|${mask >>> 0}:${ip}`;
    let s = this.sites.get(lk);
    if (s === undefined) {
      const t0 = process.hrtime.bigint();
      s = this.build(lk, key, ip, { codeBase, mask: mask >>> 0, d32, ip32 });
      this.stats.buildNs += process.hrtime.bigint() - t0;
      this.sites.set(lk, s);
      const pre = `${key}|${mask >>> 0}:`;
      let m = this.byKey.get(pre);
      if (!m) this.byKey.set(pre, m = new Map());
      m.set(ip, s);
      s.pre = pre;
      s.go = (vm, left) => this.drive(s, m, left);
    }
    return s;
  }

  // The slice, from site s, for as long as it stays CLEAN: a handback the
  // session would do nothing with but look the next site up. That is a
  // program's exit or a straight-line fallback's `end`, with budget left, no
  // store into code, and the same code segment, mode and linear mask -- so the
  // next site's key is this one's. Anything else (an `int` stub, a far
  // transfer, a slice cut by a port write, self-modifying code, TF, a target
  // not built yet) returns, exactly as before.
  //
  // It is the same guest work either way: the session cuts every slice to its
  // next date, and a handback short of the date only books the steps and runs
  // on to the same date again. The one clock that is not continuous across
  // runs is 3DAh's: $vga_status reads $vga_phase0 + $slice_budget - $steps,
  // and every L1 `run` restarts $slice_budget at the budget it is handed, so
  // a fallback run later in the slice is given the phase it starts at.
  drive(s, m, budget) {
    const vm = this.vm, ex = vm.exports, st = this.stats;
    const per = ex.get_vga_period ? ex.get_vga_period() : 0;
    const ph0 = per ? ex.get_vga_phase0() : 0;
    let cs = vm.get('cs'), csb = ex.get_csb();
    let cr0 = ex.get_cr0(), v86 = ex.get_vm86(), d32 = ex.get_d32();
    let lm = ex.get_linmask();
    const TF = 1 << 8, IF = 1 << 9;
    st.calls++;
    this.scratch = null;
    // A program's port read (PIN) reads 3DAh through L1's own $vga_status at
    // $vga_phase0 + $slice_budget - $steps; the session never ran L1 for this
    // slice, so its budget is set here. Every fallback run below restarts it
    // at what is left and moves the phase by what is spent: the sum stays.
    ex.set_slice_budget(budget);
    if (this.cold.length) this.tierCheck();
    const machine = this.session.machine;
    let left = budget;
    for (;;) {
      if (!s.rec && per && left !== budget) ex.set_vga_phase0((ph0 + (budget - left)) % per);
      left = s.enter(vm, left);
      // THE IF-ENABLE BOUNDARY (emit.js CONT, jmp_ifen). A fallback that ran an
      // arming STI handed back at the boundary after the STI's follower --
      // through jmp_ifen (`ifen`) or through the follower's own transfer, whose
      // exit (`edge`, `ret`) looks clean to FB_ON below. Either way it is the
      // session's: it may deliver the pending IRQ there, exactly where L1 hands
      // back. A µop program never runs STI (uop-x86.js does not decode it), so
      // only a fallback can leave $ifarm up.
      if (!s.rec && vm.raw('ifarm')) { st.why.ifen++; return left; }
      // A port read that cut the slice (Machine.endSlice) went on running to
      // the program's next budget test, where L1 stops at its next transfer.
      // No read is known to cut; this says so if one ever does.
      if (s.rec && machine && machine.sliceCut >= 0) st.ioCuts++;
      // L1 tests its budget only at a transfer, running on to its block's
      // end: a oneInsn fallback that fell off its one instruction (`end`)
      // is the middle of an L1 block, so an exhausted budget goes on to the
      // next site the way L1 would, and the session's IRQ lands where L1's
      // does. Handing back here moved BRW.EXE's IRQs and its frame.
      // A program that stopped only because its straight line ran out (the
      // next instruction is a fallback: `exitl`/`linkl`) is the same middle of
      // an L1 block. Handing back there rendered the SB a block early: BRW's
      // `pushad; xor; xor; cli; in al,2` read the DMA position one render
      // later than L1 at 24.26M, and 2M dispatches on the frame differed.
      // An STI fallback (compile.js IFEN) ends in jmp_ifen rather than `end`.
      // When nothing was armed it passed, and its lookup of the boundary
      // missed (`edge` AT the boundary): that too is the middle of an L1
      // block, since jmp_ifen tests no budget in L1 -- so the same rule.
      const mid = s.rec ? this.A.lineExit : (!s.refused && (vm.raw('exitwhy') === EXIT_END
        || (s.ifenTo !== undefined && vm.raw('exitwhy') === EXIT_WHY.edge
          && (ex.get_gip() >>> 0) === s.ifenTo)));
      if (left <= 0 && !(this.stay && mid && !ex.get_smc() && !(machine && machine.sliceCut >= 0))) {
        st.why.budget++; return left;
      }
      if (!this.stay) { st.why.budget++; return left; }
      // An IRET hands back for one of two reasons (emit.js iret/iret32): an
      // interrupt window it owes the host (TF, or an IRQ held for IF), or a
      // return address its cache lookup missed -- which is every one here,
      // since this arm compiles nothing L1 can find. L1 finds the handler's
      // caller compiled and stays in wasm, so only the owed kind is a
      // handback. Taking the other re-cut BRW.EXE's slice inside its SB
      // handler at 7.44M, rendered the DMA transfer 42 dispatches early, and
      // its `in al,2` read the position 3 bytes off at 24.26M.
      const why = ex.get_exitwhy();
      // "Owed" now includes a timer IRQ held pending for IF ($irqpend), which
      // the IRET handler hands back for exactly as it does for $irqwant.
      const iretMiss = !s.rec && why === EXIT_WHY.iret
        && !((vm.raw('irqwant') || vm.raw('irqpend')) && (ex.get_flags() & IF));
      if (s.rec ? ex.get_smc() : (s.refused || ex.get_smc() || !(FB_ON.has(why) || iretMiss))) {
        st.why[s.rec ? 'smc' : 'fbExit']++;
        if (!s.rec) { const k = `${s.why}>${vm.raw('exitwhy')}`; st.fbExitWhy.set(k, (st.fbExitWhy.get(k) || 0) + 1); }
        return left;
      }
      // A µop program changes no segment, mode or flag TF: only a fallback can.
      if (!s.rec && (ex.get_flags() & TF)) { st.why.mode++; return left; }
      if (ex.get_cr0() < 0) { st.why.mode++; return left; }
      // A mode switch (`mov cr0` setting or clearing PE, A20, a V86 entry)
      // goes on at the next instruction under the new mode's key, read the
      // way the session's step() reads it. Handing back instead was not only
      // slower: between the `mov cr0` that sets PE and the far jump that
      // reloads CS, CS still holds its real-mode paragraph, and step()'s
      // bad-selector guard stops the run there. L1 never hands back between
      // the two; CMA_SHRT.EXE's extender stopped at 110:db3 on it.
      if (!s.rec && (ex.get_cr0() !== cr0 || ex.get_vm86() !== v86 || ex.get_d32() !== d32 || ex.get_linmask() !== lm)) {
        const ncs = vm.get('cs');
        if (ncs === STUB_SEG) { st.why.mode++; return left; }
        const cr = ex.get_cr0(), nv = ex.get_vm86(), nd = ex.get_d32(), nlm = ex.get_linmask(), nb = ex.get_csb();
        const ip = ex.get_gip() >>> 0;
        if (vm.mem[(nb + ip) & nlm] === STUB_BYTE) { st.why.mode++; return left; }
        const ip32 = nd !== 0 || ((cr & 1) !== 0 && !nv);
        cs = ncs; csb = nb;
        cr0 = cr; v86 = nv; d32 = nd; lm = nlm;
        ex.set_steps(left);
        st.modeStays++;
        s = this.siteOf(ip, nb, nlm, nd !== 0, ip32);
        m = this.byKey.get(s.pre);
        continue;
      }
      // A far call or return a fallback just ran. The session would only look
      // the new site up under the new CS base -- in real and V86 mode, where a
      // selector is a paragraph and there is no descriptor for it to check
      // (dos-loop.js step's bad-selector guard) -- so do that here. The stub
      // segment is an interrupt to service, not code.
      // A µop program's far call or return is the same thing, and a chain of
      // links may have crossed several segments before this exit.
      const ncs = vm.get('cs');
      if (ncs !== cs) {
        if (ncs === STUB_SEG || d32 || (cr0 & 1 && !v86)) { st.why.mode++; return left; }
        cs = ncs; csb = ex.get_csb();
        m = this.byKey.get(`${csb}|${lm >>> 0}:`);
        st.farStays++;
      }
      // A site not built yet is built here, not handed back for: a handback
      // with budget left is not free. The session re-cuts the slice at every
      // one, and the Sound Blaster's block-end cut is floored at 200
      // dispatches, so a handback L1 never takes moves the SB interrupt and
      // with it every later boundary. BRW.EXE drew two pixels differently at
      // 26.7M from exactly that: one handback per instruction through code it
      // had not seen, and the first SB IRQ 40 dispatches late.
      const gip = ex.get_gip() >>> 0;
      let n = m ? m.get(gip) : undefined;
      if (n === undefined) {
        n = this.siteOf(gip, csb, lm, d32 !== 0, d32 !== 0 || ((cr0 & 1) !== 0 && !v86));
        m = this.byKey.get(n.pre);
        st.builtStays++;
      }
      // The session reads $steps; a fallback's refund lives only in `left`.
      ex.set_steps(left);
      // ...and $exitwhy, which names the exit that ENDED the drive: a clean
      // handback this loop ran on past must not be read as that exit by the
      // session (dos-loop.js ifenExit reads `iret`, `edge`, `ret`).
      vm.set('exitwhy', 0);
      st.stays++;
      s = n;
    }
  }

  build(lk, key, ip, env) {
    const vm = this.vm, rd = (lin) => vm.mem[lin];
    let reg = null, why = null;
    // An INT ends its L1 block and names no target in it, so a program headed
    // by one is that one block and never a spin. CONTAGIO.EXE builds 8632
    // such sites in 30M (it patches its INT numbers), each paying the compile.
    // uop-x86 decodes no INT, so discover would only refuse it, as `op cd`.
    const isInt = vm.mem[(env.codeBase + ip) & env.mask] === 0xCD;
    const spin = isInt ? null : this.spinBlock(key, ip, env);
    if (spin) return this.fallback(lk, key, ip, env, 'spin', spin);
    if (this.only && !this.only.has(ip)) return this.fallback(lk, key, ip, env, 'excluded');
    if (isInt) return this.fallback(lk, key, ip, env, 'op cd');
    // A site that has already failed at full size is rebuilt at the line
    // length that worked, not tried whole again. BRW.EXE rewrites its code
    // every frame, so the same sites are invalidated and rebuilt thousands of
    // times, and each rebuild of one used to pay a ~1s failed build of the
    // 400-instruction region first (bb7c, reached inside a call, is not one
    // of the loop's own ips that tooBig marks).
    const cap = this.lineCap.get(lk);
    if (cap !== undefined) {
      try {
        const line = IR.discover(rd, env, ip, { benign: this.cache.benign, straight: true, io: this.io, rep: this.rep, maxNodes: cap });
        if (line.body.size) return this.program(lk, key, ip, env, line);
      } catch (e) { /* the full path below says why */ }
    }
    try {
      const straight = this.shape === 'straight' || this.inLoop.has(lk) || this.tooBig.has(lk);
      reg = IR.discover(rd, env, ip, { benign: this.cache.benign, straight, io: this.io, rep: this.rep });
      // The optimizer's cost grows faster than a region does (a 100-insn
      // line built in ~200ms, a 10-insn one in ~1ms), and a line gains
      // nothing from being long: it links straight on into the next.
      if (!reg.cyclic && reg.body.size > this.maxLine) {
        reg = IR.discover(rd, env, ip, { benign: this.cache.benign, straight: true, io: this.io, rep: this.rep, maxNodes: this.maxLine });
      }
      if (!reg.body.size) why = reg.nodes.get(reg.headKey).unsupported || 'empty';
    } catch (e) { why = `discover: ${String(e && e.message || e).slice(0, 60)}`; }
    if (!why) {
      try { return this.program(lk, key, ip, env, reg); } catch (e) { why = `build: ${String(e && e.message || e).slice(0, 60)}`; }
      // A region too big for the engine (more vregs than a program may name,
      // at discovery's 400 instructions) is too big from every one of its
      // ips, and each of them used to pay a whole failed build of it before
      // its one-instruction fallback -- AUTUMN.EXE's unrolled port-write
      // runs, 11.8M fallbacks and 198s of builds in 100M dispatches. So the
      // straight line from here, shorter each time: it links on to the next.
      if (/vregs >/.test(why)) {
        // ...and so is it from the loop's every other ip: without this each
        // of them paid the whole failed build first. BRW.EXE rewrites a big
        // generated loop per frame, and 2348 of them cost 300s in 40M.
        if (reg.cyclic) {
          const pre = lk.slice(0, lk.lastIndexOf(':') + 1);
          for (const k of reg.body) { const n = reg.nodes.get(k); if (!n.ctx.length) this.tooBig.add(pre + n.ip); }
        }
        for (const maxNodes of [this.maxLine, 8]) {
          this.stats.lineRetries++;
          try {
            const line = IR.discover(rd, env, ip, { benign: this.cache.benign, straight: true, io: this.io, rep: this.rep, maxNodes });
            if (line.body.size) {
              const r = this.program(lk, key, ip, env, line);
              this.lineCap.set(lk, maxNodes);
              return r;
            }
          } catch (e) { /* the first reason stands */ }
        }
      }
    }
    return this.fallback(lk, key, ip, env, why);
  }

  // A program built earlier from the same bytes, or null. BRW.EXE patches the
  // same code back and forth every frame, so most of its "rebuilds" are of
  // bytes a program already exists for -- 788 optimizer runs, ~24s, in 15M
  // dispatches. The key is everything a build reads that is not code: the
  // site, the discovered shape, the machine snapshot the build specializes
  // on, and the segment bases segdisj proves disjointness with. The code is
  // checked byte by byte: every byte discover or the optimizer read (flag
  // liveness looks past the body, so the covered bytes alone are not enough).
  progKey(lk, reg, env) {
    const ex = this.vm.exports, dv = new DataView(this.vm.mem.buffer);
    const segs = [];
    for (let s = 0; s < 6; s++) segs.push(dv.getInt32(isa.REGFILE_SEGB + 4 * s, true) >>> 0);
    return [lk, env.mask, env.codeBase, env.d32, env.ip32, reg.cyclic ? 1 : 0, ex.mget_spm(),
      (ex.get_flags() >>> 10) & 1, ex.mget_shmask(), ex.mget_linmask() >>> 0, segs.join('.'),
      [...reg.body].join(',')].join('|');
  }

  program(lk, key, ip, env, reg) {
    const count = !!this.tier;
    const prog = this.compile(lk, reg, env, reg.cyclic ? this.passes : this.linePasses, '');
    const rec = this.install(prog, key, env, ip, count);
    const covered = [];
    for (const k of reg.body) {
      const n = reg.nodes.get(k);
      const lin = (env.codeBase + n.ip) & env.mask;
      covered.push([lin, lin + n.d.len]);
    }
    this.stats.builds++;
    this.stats.shapes[reg.cyclic ? 'loop' : 'line']++;
    const A = this.A, st = this.stats;
    // The loop's other ips, for build() to start lines at.
    const inner = [];
    if (reg.cyclic) {
      const pre = lk.slice(0, lk.lastIndexOf(':') + 1);
      for (const k of reg.body) {
        const n = reg.nodes.get(k);
        if (n.ip === ip || n.ctx.length) continue;
        const ik = pre + n.ip;
        inner.push(ik);
        this.inLoop.set(ik, (this.inLoop.get(ik) || 0) + 1);
      }
    }
    const s = { lk, ip, rec, covered, enter: null, inner };
    s.enter = (vm2, left) => {
      st.entries++;
      const out = A.enter(s.rec, left);
      st.uopSteps += left - out;
      return out;
    };
    if (count) { s.tierOf = { key, env, reg }; this.cold.push(s); }
    this.index(s);
    return s;
  }

  // Cold sites whose counter reached tier.after, rebuilt hot.
  tierCheck() {
    const after = this.tier.after;
    let j = 0;
    for (let i = 0; i < this.cold.length; i++) {
      const s = this.cold[i];
      if (s.dead || !s.rec || !s.rec.live) continue;
      if (this.A.w[s.rec.cnt >> 2] >= after) { this.tierUp(s); continue; }
      this.cold[j++] = s;
    }
    this.cold.length = j;
  }

  tierUp(s) {
    const t0 = process.hrtime.bigint();
    const { key, env, reg } = s.tierOf;
    const old = s.rec, A = this.A;
    let rec;
    try {
      const prog = this.compile(s.lk, reg, env, this.tier.cfg, '|hot');
      rec = this.install(prog, key, env, s.ip, false);
    } catch (e) {
      // Too big hot (more vregs), or anything else: the cold program stays,
      // exact as it was, and the reason is counted.
      const why = String(e && e.message || e).slice(0, 60);
      this.stats.tierFails.set(why, (this.stats.tierFails.get(why) || 0) + 1);
      s.tierOf = null;
      return;
    }
    // An arena reset inside install forgot every site, s with them.
    if (this.A !== A || s.dead) return;
    s.rec = rec;
    s.tierOf = null;
    A.dropHead(old, s.ip, true);
    this.stats.tierUps++;
    this.stats.tierNs += process.hrtime.bigint() - t0;
  }

  // The program for reg on these passes: cached by bytes, else built.
  compile(lk, reg, env, passes, tag) {
    const pk = this.progKey(lk, reg, env) + tag;
    const mem = this.vm.mem;
    let prog = null;
    for (const c of this.progCache.get(pk) || []) {
      let ok = true;
      for (let i = 0; i < c.lins.length; i++) if (mem[c.lins[i]] !== c.bytes[i]) { ok = false; break; }
      if (ok) { prog = c.prog; this.stats.progHits++; break; }
    }
    if (!prog) {
      const read = new Set();
      for (const k of reg.body) {
        const n = reg.nodes.get(k);
        const lin = (env.codeBase + n.ip) & env.mask;
        for (let l = lin; l < lin + n.d.len; l++) read.add(l);
      }
      prog = OPT.build(reg, { passes, env, vm: this.vm,
        rd: (lin) => { read.add(lin); return mem[lin]; } });
      const lins = Int32Array.from(read);
      const c = { lins, bytes: Uint8Array.from(lins, (l) => mem[l]), prog };
      if (this.progCacheSize >= 4096) { this.progCache.clear(); this.progCacheSize = 0; }
      const list = this.progCache.get(pk);
      if (list) { list.unshift(c); if (list.length > 8) list.pop(); else this.progCacheSize++; }
      else { this.progCache.set(pk, [c]); this.progCacheSize++; }
    }
    return prog;
  }

  // prog into the arena at ip, at the head of its link key.
  install(prog, key, env, ip, count) {
    const akey = `${key}|${env.mask}`;
    let rec;
    try { rec = this.A.add(prog, akey, {}, { count }); } catch (e) {
      if (!/arena full/.test(e.message)) throw e;
      this.resetArena();
      rec = this.A.add(prog, akey, {}, { count });
    }
    if (this.ref) { rec.native = new Set(); rec.entry = 0; }
    this.A.setHead(rec, ip);
    return rec;
  }

  // One instruction on L1, compiled where TF single-stepping compiles it.
  // Where L1 would turn a self-loop block into one spin op (compile.js: a
  // lone branch to its own head, an `in`/`cmp`/`jcc` poll, the general port
  // poll), the site is that one L1 block and nothing else: its every other
  // head is a handback. The spin op charges the rest of the slice in whole
  // iterations and hands back, where a loop run instruction by instruction
  // leaves it after however many iterations the port took to change -- a
  // different dispatch, so a different IRQ boundary from there on. BRW.EXE's
  // Sound Blaster poll (`in al,dx / test al,80h / loopnz`) left 3 dispatches
  // early and moved the SB interrupt. Null when this ip does not spin in L1.
  spinBlock(key, ip, env) {
    const vm = this.vm, cs = vm.get('cs'), rd = (lin) => vm.mem[lin];
    // Decoded as L1's cache decodes: through the wasm decoder where the vm has
    // one (byte-identical output, decode-diff.js), and with the session's
    // benign store sites. The JS decoder here was 239ms of CONTAGIO's 2.4s.
    const opts = { arenaBase: this.cache.arenaEnd, maxWords: 256,
      codeBase: env.codeBase, mask: env.mask, d32: env.d32, ip32: env.ip32,
      benign: this.cache.benign, wasmDecoder: this.cache.wasmDecoder };
    let prog;
    try { prog = compileProgram(rd, cs, ip, opts); } catch (e) { return null; }
    if (!prog.spinBlocks) return null;
    const others = new Set();
    for (const b of prog.blocks.keys()) if (b !== ip) others.add(`${key}:${b}`);
    try { prog = compileProgram(rd, cs, ip, { ...opts, handbackAt: others }); } catch (e) { return null; }
    this.cache.compiles += 2;
    return prog.spinBlocks && !prog.refusedAtEntry ? prog : null;
  }

  fallback(lk, key, ip, env, why, spun = null) {
    const vm = this.vm, cache = this.cache;
    const cs = vm.get('cs');
    const base = cache.arenaEnd;
    // `ifenShadow`: an STI's fallback runs the STI, its follower and the
    // boundary transfer after it (compile.js IFEN), as L1's block does -- one
    // instruction alone would hand back INSIDE the shadow, and the follower
    // would then run as a µop program with no boundary test behind it.
    const prog = spun || compileProgram((lin) => vm.mem[lin], cs, ip, {
      arenaBase: base, maxWords: 1000,
      codeBase: env.codeBase, mask: env.mask, d32: env.d32, ip32: env.ip32, oneInsn: true,
      ifenShadow: true,
    });
    cache.compiles++;
    const words = Int32Array.from(prog.words);
    const view = new Int32Array(vm.mem.buffer, base, words.length);
    const entry = prog.entryAddr;
    let w = this.stats.fbWhy.get(why);
    if (!w) this.stats.fbWhy.set(why, w = { sites: 0, entries: 0, steps: 0 });
    w.sites++;
    this.stats.fbSites++;
    const st = this.stats, ex = vm.exports;
    // The instruction's own bytes, so a store into it breaks the slice and
    // drops this site like a program's.
    const lin = (env.codeBase + ip) & env.mask;
    const covered = prog.covered && prog.covered.length ? prog.covered.map(([a, b]) => [a, b]) : [[lin, lin + 1]];
    // Nothing to run: the opcode is one L1 has no handler for either, and the
    // block is a bare `end` the session answers (and bills) itself.
    const refused = !!prog.refusedAtEntry;
    const s = { lk, ip, rec: null, covered, enter: null, refused, why };
    // The boundary ip of a trailing jmp_ifen (an STI fallback), for drive's
    // `mid` test. Found by walking the words by arity, so an operand word that
    // happens to equal the handler index is never mistaken for it.
    if (!spun) {
      let at = -1;
      for (let i = 0; i < words.length; i += 1 + ARITY[words[i]]) at = i;
      if (at >= 0 && words[at] === H.jmp_ifen) s.ifenTo = words[at + 2] >>> 0;
    }
    s.enter = (vm2, left) => {
      if (this.scratch !== s) { view.set(words); this.scratch = s; }
      // A oneInsn `call` may leave the shadow return stack pointing into these
      // scratch words, which the next fallback overwrites.
      vm.set('rtop', 0);
      vm.set('exitwhy', 0);
      ex.run(entry, left);
      // The straight-line case ends in `end`, and $next charged it a step: an
      // op L1 never runs in the middle of its block, so the clock (3DAh, the
      // IRQ dates) would run one dispatch fast per fallback. Refund it.
      const out = vm.raw('steps') + (!refused && vm.raw('exitwhy') === EXIT_END ? 1 : 0);
      st.fbEntries++; w.entries++;
      st.fbSteps += left - out; w.steps += left - out;
      return out;
    };
    this.index(s);
    return s;
  }

  index(s) {
    const bits = this.cache.codeBits;
    for (const [from, to] of s.covered) {
      for (let p = from >>> 4; p <= (to - 1) >>> 4; p++) {
        let set = this.byPara.get(p);
        if (!set) this.byPara.set(p, set = new Set());
        set.add(s);
      }
      for (let l = from; l < to; l++) bits[l >>> 3] |= 1 << (l & 7);
    }
  }

  forget(s) {
    s.dead = true;
    this.sites.delete(s.lk);
    const m = this.byKey.get(s.pre);
    if (m && m.get(s.ip) === s) m.delete(s.ip);
    if (this.scratch === s) this.scratch = null;
    if (s.rec) this.A.dropHead(s.rec, s.ip, true);
    for (const ik of s.inner || []) {
      const c = this.inLoop.get(ik) - 1;
      if (c) this.inLoop.set(ik, c); else this.inLoop.delete(ik);
    }
    s.inner = null;
    for (const [from, to] of s.covered) {
      for (let p = from >>> 4; p <= (to - 1) >>> 4; p++) {
        const set = this.byPara.get(p);
        if (set) { set.delete(s); if (!set.size) this.byPara.delete(p); }
      }
    }
    this.stats.invalidated++;
  }

  // The guest wrote [lo, hi]: every site over those bytes goes, and the code
  // bits of the paragraphs are rebuilt from the sites that remain.
  drop(lo, hi) {
    const from = lo >>> 4, to = hi >>> 4;
    const doomed = new Set();
    if (to - from > this.byPara.size) {
      for (const [p, set] of this.byPara) if (p >= from && p <= to) for (const s of set) doomed.add(s);
    } else {
      for (let p = from; p <= to; p++) for (const s of (this.byPara.get(p) || [])) doomed.add(s);
    }
    const hit = [...doomed].filter((s) => s.covered.some(([a, b]) => a <= hi && b > lo));
    if (!hit.length) return;
    const paras = new Set();
    for (const s of hit) {
      for (const [a, b] of s.covered) for (let p = a >>> 4; p <= (b - 1) >>> 4; p++) paras.add(p);
      this.forget(s);
    }
    const bits = this.cache.codeBits;
    for (const p of paras) {
      bits.fill(0, (p << 4) >>> 3, ((p + 1) << 4) >>> 3);
      for (const s of (this.byPara.get(p) || [])) {
        for (const [a, b] of s.covered) {
          for (let l = Math.max(a, p << 4); l < Math.min(b, (p + 1) << 4); l++) bits[l >>> 3] |= 1 << (l & 7);
        }
      }
    }
    this.cache.armWatch();
  }

  dropAll() {
    this.stats.flushes++;
    for (const s of [...this.sites.values()]) this.forget(s);
    this.byPara.clear();
  }

  // The arena is bump-allocated and never compacted: when it is full,
  // everything in it goes and is rebuilt on demand.
  resetArena() {
    this.stats.arenaResets++;
    for (const s of [...this.sites.values()]) if (s.rec) this.forget(s);
    this.A = new W.E1Arena(this.vm, this.run);
    this.A.noteExits = false;
    this.cache.codeBits.fill(0);
    for (const set of this.byPara.values()) for (const s of set) {
      for (const [a, b] of s.covered) for (let l = a; l < b; l++) this.cache.codeBits[l >>> 3] |= 1 << (l & 7);
    }
    this.cache.armWatch();
  }

  report() {
    const st = this.stats;
    // A spin site's steps are a wait the guest spends in bulk (spinBlock), not
    // work: they count toward neither side of the share, and are shown apart.
    const spinSteps = (st.fbWhy.get('spin') || { steps: 0 }).steps;
    const total = st.uopSteps + st.fbSteps - spinSteps || 1;
    return {
      passes: this.passName, linePasses: this.linePassName, shape: this.shape,
      builds: st.builds, shapes: st.shapes, fbSites: st.fbSites,
      entries: st.entries, fbEntries: st.fbEntries, uopSteps: st.uopSteps, fbSteps: st.fbSteps, spinSteps,
      uopShare: st.uopSteps / total,
      chains: this.A ? this.A.chains : 0,
      invalidated: st.invalidated, flushes: st.flushes, arenaResets: st.arenaResets,
      calls: st.calls, stays: st.stays, farStays: st.farStays, builtStays: st.builtStays, modeStays: st.modeStays, lineRetries: st.lineRetries, progHits: st.progHits, ioCuts: st.ioCuts, why: st.why, fbExitWhy: [...st.fbExitWhy].sort((a, b) => b[1] - a[1]).slice(0, 12),
      buildSecs: Number(st.buildNs) / 1e9,
      tierUps: st.tierUps, tierFails: [...st.tierFails], tierSecs: Number(st.tierNs) / 1e9, cold: this.cold.length,
      sitesList: [...this.sites.values()].filter((s) => s.rec).map((s) => s.ip),
      arenaBytes: this.A ? this.A.at - (this.A.progs[0] ? this.A.progs[0].codeFrom : this.A.at) : 0,
      fallbacks: [...st.fbWhy].sort((a, b) => b[1].entries - a[1].entries)
        .map(([why, w]) => ({ why, ...w })),
    };
  }
}

module.exports = { UopOnly };
