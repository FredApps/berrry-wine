'use strict';

// The decode-time expression-tree fold.
//
//   node tools/toyvm/run-dos.js DEMO.EXE --tree-fold
//
// WHAT IT IS. A basic block's straight-line interior is a dataflow expression:
// a run of full-width `mov`/`lea`/ALU/shift/widening ops that read and write
// registers and memory and nothing else. The interpreter pays one dispatch per
// op of it and moves every intermediate through the guest register file. This
// takes such a run, generates ONE wasm handler that is the whole run inlined --
// operands folded to constants, `$ea` folded to arithmetic, the register file
// folded to global accesses and then promoted into wasm locals -- and installs
// its index over the run's first arena word.
//
// It is the third fold in the VM and the first that is a TREE. The other two
// are fixed shapes: [superinstructions](../../docs/toyvm-superinstructions.md)
// joins exactly two ops, [spin loops](../../docs/toyvm-spin-loops.md) collapse a
// block that does nothing. This one collapses n ops of real arithmetic into one
// dispatch for any n, and what n is worth is measured in
// [docs/toyvm-tree-fold.md](../../docs/toyvm-tree-fold.md).
//
// NOTHING HERE IS A SECOND POLICY. Three things it would have been easy to
// write twice and does not:
//
//   * WHAT IS FOLDABLE is `expr-fold-census.js`'s `classify()`, imported. The
//     census measured the population this fold exists for, and a fold whose
//     eligibility rule had drifted from the census's would be answering a
//     different question from the one that justified it.
//   * WHAT AN OP TOUCHES is `handler-effects.js`, which resolves a register
//     index back through the arena word that produced it. A fold that guessed
//     a register is not a slow fold, it is a wrong one.
//   * HOW A RUN IS LOWERED is `trace-jit.js`'s `emitTier3` -- the region JIT's
//     own code generator. `foldOperands` -> `foldEa` -> `foldSeg` ->
//     `foldRegisterFile` -> `promoteRegs` is five passes that were each bought
//     with a bisect, and a second copy of them would be a second set of bugs.
//
// THE ARENA DOES NOT CHANGE SIZE, AND THAT IS THE WHOLE CORRECTNESS ARGUMENT.
// A fused pair splices a word out; this one does not. The run's first word is
// overwritten with the tree's handler index and every following word of the run
// is left where it is, counted as an operand the tree steps over. So a folded
// run and an unfolded one lay the arena out identically, byte for byte, and the
// arena-recycle boundary -- which is what moved CONTAGIO, AQUAPHOB, COUNTDWN and
// ZOKDTPLN under fusion -- cannot move. Combined with charging the removed
// dispatches' steps inline, a `--tree-fold` run and a plain one are required to
// be bit-identical, and the corpus sweep is the check.
//
// THE TERMINATOR IS NOT IN THE FOLD. The block's branch, and the `cmp`/`dec`
// that feeds it, stay exactly the ops they were. That is deliberate and it is
// what keeps the clock: a block transfer is where `$slice_exit` tests the
// budget, where a handback is taken, where an IRQ is injected and where the
// Sound Blaster's DMA is fetched. A fold that ran the loop in place would
// ABSORB those transfers, and region-live.js's DREAM row is what that costs --
// an identical picture and a different wav from the install on. Looping in
// place is the region JIT's job and it already has it.
//
// SELF-MODIFYING CODE needs nothing new here for the same reason. The block was
// decoded normally, so `covered` already names its bytes and the code bitmap
// already covers them; a store into any of them raises `$smc`, dos-loop.js
// drops the whole compiled program, and the fold goes with it. What DOES change
// is the fast operand repair: `repairProg` walks `prog.wordIp` per instruction
// and cannot recognise a tree word, so it declines and the store falls back to
// a drop and a recompile. That is a cost, not a hazard, and it is reported.

const isa = require('./isa');
const { HANDLERS, ARITY, prepareTables } = require('./emit');
const { table: effectsTable } = require('./handler-effects');
const { classify, decompTable, stemOf } = require('./expr-fold-census');
const { emitTier3, foldOperands } = require('./trace-jit');
const { makeVm } = require('./vm');
const { carryState } = require('./region-live');

// The op count a run has to reach before it is worth a handler. Four is the
// census's own threshold -- `in >=4-fold blocks` is the column that varies 50x
// across the corpus and decides which programs this can pay on.
const MIN_OPS = 4;

// The census's relaxations, as the fold implements them. `classify()` already
// tags every op it declines with the relaxation that would take it
// (`c.relax`), so turning one on here is "accept the class", not "reclassify".
//
//   partial  an 8-bit (or, in a 32-bit block, a 16-bit) read/write is an
//            EXTRACT out of / an INSERT into the full-width value. Nothing new
//            has to be written for that: emit.js's `$rget8`/`$rset8`/`$rset16`
//            already spell it exactly that way, `foldRegisterFile` and
//            `foldRegisterFileWide` already collapse them to a mask-and-or on
//            the register's own global once the index is a constant, and
//            `promoteRegs` then rewrites that global into the run's local. So
//            AL and AH really are bits 0-7 and 8-15 of the promoted AX local,
//            by construction rather than by a second model of the register
//            file. 8/16-bit LOADS and STORES keep their `$rd8`/`$wr8` calls in
//            source order like every other memory op, so they carry the same
//            fault and segment semantics as the per-op handlers.
//   flags    a flag CONSUMER inside the run -- `adc`/`sbb`, `setcc`, and a
//            `cmp`/`test` that is not already fused into the terminator. This
//            is what the LAZY flag scheme buys: a producer does not compute
//            flags, it records its inputs through `$rec_*`, and a consumer
//            materializes the one field it wants through `$get_cf`/`$cond*`.
//            Both are kept verbatim, in source order, inside the generated
//            handler -- so a consumer reads the record the op in front of it
//            just wrote, out of the same globals, in the same order the
//            interpreter would have. The flag globals are deliberately NOT
//            promoted into locals (`promoteRegs` is given the register and
//            segment-base lists and nothing else), which is what leaves the
//            per-FIELD last-writer state at the run's end exactly as an
//            unfolded compile would: for the terminator, which is not in the
//            fold, and for any successor block that reads a field this run did
//            not write.
//
// NOT relaxed, and for the census's own reason rather than for want of effort:
// `lahf`/`sahf`/`pushf`/`popf` and the BCD group want the architectural FLAGS
// word including AF, which the lazy record does not carry as a value. They stay
// barriers, and the decline histogram still names them. (`rcl`/`rcr` and a
// shift by CL used to be listed here as the same problem. They are not, and the
// `shifts` relaxation below says why.)
//
//   string   a non-rep `movs`/`stos`/`lods`/`scas`/`cmps`. The doc's decline
//            histogram put this group at the top in every program, and it turns
//            out to need no new machinery at all: emit.js writes each of them
//            with LITERAL register indices (si=6, di=7, acc=0), so the same
//            `foldRegisterFile` pass that handles `mov ax,bx` collapses the
//            SI/DI update to arithmetic on the register globals and
//            `promoteRegs` lifts those into the run's locals. The +-1/2/4 step
//            is `(select -sz sz DF)` read live off the flags global, which is
//            not promoted, so a `cld`/`std` anywhere -- inside the run or
//            before it -- reaches the fold unchanged. The load and the store
//            keep their `$rd`/`$wr` calls in source order, through the same
//            `$lin(seg, off)` the operand word names, so the segment override
//            and the fault semantics are the per-op handler's. `scas`/`cmps`
//            record their compare into the lazy-flag globals like any other
//            producer, which the `flags` relaxation already consumes as values.
//            `ins`/`outs` are NOT in this: they are port I/O wearing a string
//            op's name, and the clock quantization of a port is a separate
//            question. The `rep_`/`repne_` forms are not in it either -- they
//            write `$steps` themselves, so they are their own relaxation.
//
//   rep      a `rep movs`/`rep stos` or a `repne scas`/`rep cmps`. These are
//            already super-ops -- one dispatch runs the whole count, widened to
//            `memory.copy`/`memory.fill` under hoisted guards when the span
//            allows it -- and folding one changes NOTHING about what it does:
//            the same guards, the same `br $slow` fallbacks to the byte loop,
//            the same CX/SI/DI/ZF state on every exit, because the handler body
//            is taken verbatim like every other op in a run. What it buys is the
//            dispatch on either side of it, which is the whole point: a DOS
//            inner loop is usually a couple of pointer updates, a `rep movsw`
//            and a branch, and before this the `rep` split it into two runs too
//            short to fold.
//
//            The one thing that had to be said out loud is the CLOCK. A rep
//            handler writes `$steps` -- once per element in the byte loop, once
//            for the whole run in the widened path -- and `CLOCK_READERS` below
//            refuses any handler that mentions `$steps` at all. That refusal is
//            about a handler whose BEHAVIOUR depends on the clock's value, which
//            a fold shifts; a charge of a known amount is not that. See
//            `STEP_CHARGE`.
//
//   shifts   the rest of the shift group: a shift or rotate whose count comes
//            from CL, and `rol`/`ror`/`rcl`/`rcr` at any count. The census
//            declines these because IT cannot say what the flags come out as --
//            the count is dynamic, a masked count of zero writes no flags at
//            all, and `rcl` reads a carry the lazy record owes. A TREE does not
//            have to say: the handler is `(call $sh_<kind><w> value count)` and
//            `$sh_*` goes into the run verbatim, so the count is masked with
//            the live `(global.get $shmask)` -- the 8086-vs-186 setting, which
//            programs probe deliberately -- the zero-count early return is the
//            same early return, and the incoming CF still comes through
//            `$get_cf`. Nothing is re-derived, which is why the decline was
//            about the census's reasoning and not about the fold's.
//
//            One thing this does NOT turn on: `killDeadFlags` in trace-jit.js
//            treats any `$sh_*` as a flag writer, which is wrong for a masked
//            count of zero. `buildTree` runs with `deadflags: false` (see
//            below) so no fold depends on it; the pass is left alone rather
//            than quietly changing what the measurement tiers report.
//
//   muldiv   `mul`/`imul`/`div`/`idiv`, the one-operand forms writing the
//            implicit AX/DX pair. `mul`/`imul` need nothing: they are readable
//            ordinary ops the census simply never put in the set. `div`/`idiv`
//            carry the one escape this fold takes rather than refuses -- the
//            divide-error trap, `(call $fault0 <ip>) (return)`, once for a zero
//            divisor and once for a quotient that will not fit.
//
//            A FAULT IN THE MIDDLE OF A TREE has to leave the guest in the
//            state the interpreter would have left it in, and two things are
//            wrong at that instant. The promoted registers are in wasm locals
//            and the globals behind them are stale -- and `$fault` pushes
//            FLAGS/CS/IP to the guest stack and halts, after which everything
//            downstream reads globals. And the tree has already charged the
//            whole run's steps up front, while the interpreter would have
//            charged only one per op up to and including the one that faulted.
//            So `buildTree` splices two things in front of each fault call, in
//            this order: the step refund, then the promotion epilogue. Both
//            must precede the call, because `$fault` copies `$steps` into
//            `$left` and reaches the stack through SP. `$ip` is deliberately
//            NOT advanced: an unfolded `div` leaves it parked mid-operand too,
//            and control re-enters through `$gip`.
//
//            `div`/`idiv` are therefore straight-line only. A `(return)` inside
//            a LOOP tree would skip region-jit's own epilogue, so the loop path
//            passes `allowFault: false` and the histogram says so.
//
// The census's third relaxation, `alias`, is not here: it is a disjointness
// PROOF over two operands rather than a class to accept, and it is the one
// extension that needs code of its own.
// `stack` is the sixth, and the one the census said was worth the most: a
// plain push/pop lowered as a micro-op (see the note in expr-fold-census.js's
// classifier and `inlineStack` in trace-jit.js). It admits the op AND it is
// what lets SP be promoted, since the stack helpers are inlined for the same
// run rather than called.
//
// The last four are THE UNSUPPORTED-OP TAIL, and they exist because
// docs/hot-loop-vocabulary-2026-09.md section 9 finally priced it. That study
// read 583 hot loops across 199 DOS demos and found exactly two arithmetic
// trees spread across the corpus rather than concentrated in one program:
// `ADDR_SCALE` (`imul(y,W) + x` feeding an 8/16-bit store, 36 demos) and
// `FIXPT_MUL` (`imul_r32` immediately followed by `shrd #N`, 21 demos),
// together 13.8% of DOS dynamic ALU ops. Running the fold over the fifteen
// demos that carry them hardest put the blocker in the histogram by name --
// `unsupported: nop`, `unsupported: shrd`, `unsupported: xchg`,
// `unsupported: cbw`/`cwd`/`cwde`/`cdq` -- which is the census the note in
// *What is next* said these should wait for.
//
//   nop      the empty handler body. It ends a run today only because nothing
//            ever named it, and it is the single largest named barrier in the
//            demos measured (MAMAN 1618 declines, QUARTZ 765, BARTI 438).
//   extend   `cbw`/`cwd`/`cwde`/`cdq`. Readable already; each is one register
//            access the register-file fold collapses.
//   xchg     `xchg` reg,reg and mem,reg. Readable already, both indices in the
//            one operand word.
//   dshift   `shld`/`shrd`. This is the FIXPT_MUL op: `imul_r32` + `shrd #N`
//            is the corpus's fixed-point multiply, and the `shrd` is what split
//            BBUUMI's and DEFECT!'s whole-program iterators into runs. The
//            handler was unreadable for one reason -- `$shld<w>`/`$shrd<w>` was
//            not in handler-effects' helper table -- and it belongs there
//            beside `$sh_*`, because it is the same shape: values in, a value
//            out, the flag word its only global. See the note there.
const RELAXATIONS = ['partial', 'flags', 'string', 'rep', 'shifts', 'muldiv', 'stack',
  'nop', 'extend', 'xchg', 'dshift'];
const RELAX_ALL = new Set(RELAXATIONS);

// A handler that reads the dispatch clock cannot be folded: the interpreter
// would have charged one step per op before it, and a fold charges the whole
// run at once, so the value it reads differs. The foldable set contains none of
// these today; the check is here so that stays true rather than being believed.
// Same list region-jit.js flushes its pending step charge for.
const CLOCK_READERS = /\$steps|\$slice_budget|\$vga_status|\$port_in|\$port_out/;
// ...with one shape excepted, and only this shape: `$steps -= <a constant or a
// local>`. That is a CHARGE, not an observation. A charge commutes with the
// tree's own up-front `$steps -= n-1`, so the total at the run's end is the
// interpreter's total whichever order the two happen in, and nothing between
// them branches on the value -- the budget is tested in `$next`, which a folded
// run does not reach until it is over. The REP handlers are the only ops that
// carry one (per element in the byte loop, once for the whole run in the
// widened path), and without this exception `rep` could not fold at all while
// pretending to be refused for a reason about correctness.
const STEP_CHARGE =
  /\(global\.set \$steps \(i32\.sub \(global\.get \$steps\) \((?:i32\.const \d+|local\.get \$[a-zA-Z0-9_]+)\)\)\)/g;
const readsClock = (body) => CLOCK_READERS.test(body.replace(STEP_CHARGE, ''));
// ...and one that leaves the handler early would leave `$ip` parked in the
// middle of the run's operand words. Same refusal genFusedBranches makes of a
// fused first half, for the same reason.
const ESCAPES = /\$halt|\$slice_exit|\$fault|\$jlook|\(return\)|global\.(get|set) \$ip\b/;
// ...with one shape excepted here too, and for the same kind of reason: a
// divide-error trap is an escape with a KNOWN shape and a known repair, not an
// unknown one. `div`/`idiv` are the only handlers in the VM that contain it,
// twice each, and always written exactly like this. `buildTree` splices the
// step refund and the promotion epilogue in front of each one; this is what
// lets the op past the two escape checks in the first place, and it is applied
// only where the caller allows a fault (never inside a loop tree).
const FAULT_EXIT = /\(call \$fault0 \([^()]*\)\)\s*\(return\)/g;
const escapes = (body, allowFault) =>
  ESCAPES.test(allowFault ? body.replace(FAULT_EXIT, '') : body);

// --- eligibility -------------------------------------------------------------

// One arena op, as the classifier and the lowering both want it.
function opAt(words, p) {
  const fn = words[p];
  const h = HANDLERS[fn];
  if (!h) return null;
  const args = [];
  for (let i = 0; i < h.args; i++) args.push(words[p + 1 + i]);
  return { fn, name: h.name, args, at: p };
}

// A block's operand width, exactly as the census reads it: the arena carries it
// in the op names, and the widest op present is the block's. Taking the widest
// rather than a per-program flag keeps a 16-bit block inside a 32-bit program
// classified as what it is.
function blockWidth(ops, D = decompTable()) {
  for (const o of ops) {
    for (const b of D[o.fn]) if (stemOf(HANDLERS[b].name).width === 32) return 32;
  }
  return 16;
}

// Why one op is not in the fold set, bucketed the way the decline histogram in
// docs/toyvm-tree-fold.md reports it. The census's class names are finer than
// the five buckets the histogram wants, so this is the only mapping and it is
// one-way.
function bucketOf(c, stem) {
  const cls = c.cls;
  if (cls === 'partial-reg') return 'partial-reg';
  // The flag barriers are three different things once the `flags` relaxation
  // exists, and lumping them under one name would make the work list unreadable
  // in exactly the place it is now pointing. An op tagged `relax: 'flags'` is
  // one this fold CAN take and is only declining because the relaxation is off;
  // a shift by CL and the architectural-FLAGS group are barriers the relaxation
  // deliberately does not cover, and each names itself so the next census can
  // price it on its own.
  if (cls === 'shift-cl') return 'shift by CL';
  if (cls === 'shift-carry') return 'rcl/rcr';
  if (cls === 'shift-rot') return 'rol/ror';
  // A `div` that declined for the fault-in-a-loop reason is a different entry
  // from one this fold has no relaxation for, and telling them apart is the
  // whole value of the histogram to whoever reads it next.
  if (cls === 'muldiv') return c.noFault ? 'div (loop tree)' : `muldiv: ${stem}`;
  if (cls === 'flags' && !c.relax) return `flags word: ${stem}`;
  if (cls === 'cmp-test' || cls === 'flags' || cls === 'adc-sbb') return 'flag consumer';
  if (cls === 'branch' || cls === 'terminator') return 'terminator';
  // The string group splits three ways for the same reason the flag group does:
  // one part this fold takes when its relaxation is on, one part that is a
  // different relaxation, and one part (the port forms) that is not on offer.
  if (cls === 'string') {
    return c.stringKind === 'rep' ? `string (rep): ${stem}`
      : c.stringKind === 'port' ? `string port: ${stem}`
        : `string: ${stem}`;
  }
  // Everything else is named by its census class, and `other` -- the catch-all
  // -- carries the opcode stem with it. The histogram is a WORK LIST: "6225
  // unsupported ops" says nothing about what to implement next, and
  // "unsupported: xchg 2100, unsupported: cbw 900" says exactly what. The stem
  // set is bounded by the instruction set, so this cannot grow without limit.
  return cls === 'other' ? `unsupported: ${stem}` : cls;
}

// Split one block's ops into maximal foldable runs.
//
// The rules are the census's, and the two that are not simply "is this op in
// the set" are:
//
//   MEMORY KEEPS ITS SOURCE ORDER. Every load and store stays a `$rd*`/`$wr*`
//   call in the emitted order, so a run may contain as many as it likes.
//   * ...but A STORE FOLLOWED BY A LOAD ENDS THE RUN. This proves nothing about
//     addresses, so every load after a store is assumed to alias. It is the
//     most expensive rule here -- ACCIDENT's hottest block has sixteen
//     consecutive foldable ops and yields a run of twelve because of it -- and
//     relaxing it is the first of the three extensions in the doc.
// `allowFault` is false for a LOOP tree, where a `(return)` out of the middle
// would skip region-jit's epilogue. It is the only option here that is about
// the CALLER's lowering rather than about the ops.
function eligibleRuns(ops, width,
  { minOps = MIN_OPS, why = null, relax = RELAX_ALL, allowFault = true } = {}) {
  const D = decompTable();
  const T = effectsTable();
  const runs = [];
  let cur = [];
  let sawStore = false;
  const note = (b) => { if (why) why.set(b, (why.get(b) || 0) + 1); };
  const close = () => {
    if (cur.length >= minOps) runs.push(cur);
    else if (cur.length) note('too short');
    cur = [];
    sawStore = false;
  };
  for (const o of ops) {
    const dec = D[o.fn];
    // A fused, traced or spin-collapsed word is more than one guest op and its
    // second half is a branch. Never foldable, and never a decline worth
    // reporting either -- it is the block's terminator.
    if (!dec || dec.length !== 1) { close(); note(dec && dec.length > 1 ? 'terminator' : 'unsupported op'); continue; }
    const base = dec[0];
    const eff = T[base];
    const c = classify(HANDLERS[base].name, width, o.args, eff);
    // `c.fold` is the exact set; `c.relax` names the relaxation that would take
    // this op, and a relaxation that is ON accepts it with no reclassification.
    // Everything downstream of here -- the two body questions, the alias rule,
    // the lowering -- is the same for a relaxed op as for an exact one, which
    // is the point: the relaxations widen the POPULATION, they do not add a
    // second way of lowering it.
    if (!c.fold && !(c.relax && relax.has(c.relax))) {
      close(); note(bucketOf(c, stemOf(HANDLERS[base].name).stem)); continue;
    }
    // A divide is admitted by the relaxation and then refused by the lowering
    // the caller asked for. Refused HERE rather than in `buildTree`, so the run
    // splits around it and the ops either side still fold.
    if (c.faults && !allowFault) {
      close(); note(bucketOf({ ...c, noFault: true }, stemOf(HANDLERS[base].name).stem));
      continue;
    }
    // The census stops here. The fold has two more questions, both about the
    // BODY rather than the opcode, and both of which can only be asked of the
    // handler that is actually in the arena (which may be the flagless twin).
    // Fold the operands FIRST and ask the two body questions of the RESULT.
    // Every handler reads `$ip` -- that is how it gets its operands -- so
    // testing the raw body for an `$ip` reference declines all of them, which
    // is exactly what it did: 2521 "escapes" against 0 folds on ACCIDENT. What
    // the check is really for is an `$ip` write that is NOT the operand
    // advance (a branch), and after folding, the advance is gone and any `$ip`
    // left is that.
    const folded = foldOperands(HANDLERS[o.fn].body, o.args);
    if (folded === null) { close(); note('operand shape'); continue; }
    if (readsClock(folded)) { close(); note('clock reader'); continue; }
    if (escapes(folded, allowFault && !!c.faults)) { close(); note('escapes'); continue; }
    // A stack access is deliberately NOT counted here, and the reason is worth
    // writing down because the opposite reading is the obvious one.
    //
    // Nothing in this lowering moves memory. Every pass in emitTier2/emitTier3
    // rewrites ONE op's body in place -- operands, addressing mode, segment,
    // register file, constants -- and the bodies are then concatenated in
    // source order, so every `$rd*` and `$wr*` executes exactly where and when
    // the interpreter would run it. The alias rule is a conservatism on top of
    // that (item 1 of *What is next*: most of those pairs are provably
    // disjoint and it wants relaxing, not widening), and a `push` followed by
    // its matching `pop` is a store followed by a load at the SAME address --
    // the single most common shape there is. Counting the stack as memory here
    // would split every matched pair back apart and give the `stack`
    // relaxation nothing to do.
    const memRead = eff.memRead.length > 0;
    const memWrite = eff.memWrite.length > 0;
    if (sawStore && memRead) { close(); note('alias'); cur = [o]; sawStore = memWrite; continue; }
    cur.push(o);
    if (memWrite) sawStore = true;
  }
  close();
  return runs;
}

// --- lowering ----------------------------------------------------------------

// Two runs of the same ops with the same operands are the same handler. The
// arena recycles, and a demo that recompiles its hot loop eighty thousand times
// would otherwise generate eighty thousand identical handlers.
function treeKey(run) {
  return run.map(o => `${o.fn}:${o.args.join(',')}`).join('|');
}

// One run -> one `{ name, locals, body }`, the shape emit.js's `extraHandlers`
// takes. Returns `{ declined }` instead when the lowering will not stand up.
//
// THE BODY'S FOUR PARTS, and why each is where it is:
//
//   the step charge   `$next` charged ONE step to dispatch into this handler
//                     and the run it replaces retired n. So n-1 more are
//                     charged here, inline, and a folded run and an unfolded
//                     one leave `$steps` identical at every block boundary --
//                     which is what makes the corpus a regression test for the
//                     transformation rather than a retiming of it. Charged up
//                     front rather than at the end because nothing inside reads
//                     the clock (`CLOCK_READERS` above is what enforces that),
//                     so the two are the same and this way the read is next to
//                     the count it explains.
//   `pro`             the promoted registers, loaded out of their globals once.
//   the bodies        the run, straight-line, intermediates in wasm locals.
//   `epi`             the promoted registers, stored back once.
//   the `$ip` advance the run's remaining words are the tree's operands and
//                     nothing reads them, but `$ip` still has to step over
//                     them: the next op in the block is behind them.
function buildTree(run, name) {
  const ops = run.map(o => ({ fn: o.fn, name: HANDLERS[o.fn].name, args: o.args, at: o.at }));
  let t3;
  try {
    // `deadflags` OFF, on purpose and not as a default. `killDeadFlags` in
    // trace-jit.js is written for the EAGER flag scheme (it looks for
    // `(call $flags_*)`) and the shipped build is lazy, so it would find
    // nothing -- but more to the point the compiler's own dead-flag pass
    // (compile.js `walkBlock`) has ALREADY run over these words, across block
    // edges, with a real liveness fixpoint. Whatever flag write is still here
    // is one some successor may read.
    t3 = emitTier3(ops, {
      constprop: true, regfold: true, deadflags: false,
      ea: true, seg: true, inline: true, promote: true,
      // The stack helpers, inlined, so SP is a local across the run instead of
      // a register the pass is banned from touching. Only this call site asks:
      // a region built by region-jit lowers through the same function and is
      // unchanged by this.
      stack: true,
      // ...and the one pass option that is a PROMISE rather than a switch: this
      // function will splice the promotion epilogue in front of every
      // divide-error trap below, so promoting across one is safe here. Only
      // this call site passes it -- region-jit lowers through the same pass and
      // makes no such promise, so a region containing a `div` still declines
      // promotion outright, which is what keeps it correct.
      allowFault: true,
    });
  } catch (e) {
    return { declined: `lowering threw: ${e && e.message ? e.message : String(e)}` };
  }
  const n = run.length;
  // THE FAULT REPAIR. Every `(call $fault0 <ip>) (return)` in op i's lowered
  // body gets two statements spliced in front of it, and the order is the whole
  // of the correctness argument:
  //
  //   the step refund   the tree charged the run's n steps up front; unfolded,
  //                     the interpreter would have charged one per dispatch up
  //                     to and including the op that faulted, which is i+1. So
  //                     n-1-i go back. `$fault` copies `$steps` straight into
  //                     `$left`, which is why this cannot happen after it.
  //   `epi`             the promoted registers, out of their locals and back
  //                     into their globals. `$fault` pushes FLAGS/CS/IP through
  //                     SP and then halts, and everything downstream of a halt
  //                     reads globals. Emitting `epi` here as well as at the
  //                     run's end is free: it is pure local -> global writeback
  //                     and running it twice writes the same values.
  //
  // `$ip` is NOT advanced. An unfolded `div` leaves it parked in the middle of
  // its own operand words too -- control comes back through `$gip` and
  // `$jlook`, and the arena words behind it are simply never read.
  const bodies = t3.bodies3.map((b, i) => {
    if (!FAULT_EXIT.test(b)) return b;
    FAULT_EXIT.lastIndex = 0;
    const refund = n - 1 - i;
    const before = [
      refund > 0 ? `(global.set $steps (i32.add (global.get $steps) (i32.const ${refund})))` : '',
      t3.epi,
    ].filter(Boolean).join('\n');
    return b.replace(FAULT_EXIT, (m) => `${before}\n${m}`);
  });
  // The clock question is asked of the ops' OWN bodies, before the repair: the
  // refund is an `$steps +=` this function just wrote and knows the value of,
  // and `STEP_CHARGE` deliberately excepts only the `-=` shape the handlers
  // write. Asking it of the repaired text instead declined every `div` as a
  // clock reader on the strength of the fix for its step accounting.
  const joined = bodies.join('\n');
  if (readsClock(t3.bodies3.join('\n'))) return { declined: 'the lowered body reads the clock' };
  if (escapes(joined, true)) return { declined: 'the lowered body can leave the handler' };
  // Balance, checked here rather than at module build: a fold that unbalanced a
  // body would take the whole module down with a parse error a long way from
  // the run that produced it.
  //
  // `;;` comments come out first, and that is not cosmetic. emit.js writes
  // prose above the tricky parts of a handler, and REP widening's happens to
  // contain `copy a[0..n) to a[1..n]` -- one bare `)`. Counted raw, that lone
  // paren declined every `rep movs` fold as an unbalanced body, which reads
  // exactly like a code-generation bug and is not one.
  let depth = 0;
  for (const ch of joined.replace(/;;[^\n]*/g, '')) {
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < 0) return { declined: 'unbalanced body' }; }
  }
  if (depth !== 0) return { declined: 'unbalanced body' };

  const last = run[run.length - 1];
  const first = run[0].at;
  const endW = last.at + 1 + ARITY[last.fn];
  const arity = endW - first - 1;
  const body = [
    `;; tree fold: ${n} ops, ${arity} operand words`
      + `${t3.promoted ? `, ${t3.promoted.length} regs in locals` : `, no promotion (${t3.declined})`}`,
    n > 1 ? `(global.set $steps (i32.sub (global.get $steps) (i32.const ${n - 1})))` : '',
    t3.pro,
    joined,
    t3.epi,
    arity ? `(global.set $ip (i32.add (global.get $ip) (i32.const ${arity * 4})))` : '',
  ].filter(Boolean).join('\n');
  return {
    tree: { name, locals: t3.locals || '', body },
    arity,
    ops: n,
    promoted: t3.promoted ? t3.promoted.length : 0,
    promoteDeclined: t3.declined || null,
    bytes: body.length,
  };
}

// A SELF-LOOP BLOCK, FOLDED WHOLE -- terminator included, so the loop turns
// INSIDE the handler and costs one dispatch per LOOP rather than one per
// iteration. `buildTree` above stops in front of the terminator, which is why a
// four-op loop body still pays a `$next` trip for its `jnz` and another to come
// back round; this does not.
//
// NOTHING HERE IS A SECOND PROTOCOL. The step budget, the slice boundary, the
// self-modify break and the way the handler publishes where the guest goes next
// are all region-jit.js's `buildRegion`, called rather than reimplemented, on a
// one-block closed region built exactly the way `chainFrom` builds one:
//
//   * `nexts[i]` is the guest ip control must be at after op i, from the
//     exported `fallThroughIp` (null for a non-transfer), and the last entry is
//     the head, which is what tells `buildRegion` the block closes on itself.
//   * every lowered edge takes the interpreter's own boundary test -- publish
//     `$gip`, then `$smc || $halt || $steps < 0` and leave through `$out` --
//     so the slice ends at the same guest instruction it would have ended at
//     unfolded. That test is the whole of the answer to "does absorbing a block
//     transfer move the slice boundary": it is the reason it does not.
//   * `$steps` is charged per iteration, op by op, with the entry refund for
//     the one `$next` already charged to dispatch in.
//   * on the way out `$ip` is re-resolved from `$gip` through `$jlook`, so the
//     arena words behind the tree's own -- the rest of the block, which the
//     fold leaves exactly where they were -- are simply never read. The arena
//     still does not change shape.
//
// A transfer `buildRegion` could not lower leaves the interpreter's protocol
// inside the loop, which is the CARRIE.EXE class region-prepare.js declines
// outright; this declines it for the same reason.
function buildLoopTree(run, headIp, name) {
  const { buildRegion, fallThroughIp } = require('./region-jit');
  const ops = run.map(o => ({ fn: o.fn, name: HANDLERS[o.fn].name, args: o.args, at: o.at }));
  const nexts = ops.map(o => fallThroughIp(o));
  nexts[nexts.length - 1] = headIp;
  let r;
  try {
    r = buildRegion(ops, nexts, headIp, name, true, [], []);
  } catch (e) {
    return { declined: `loop: build threw: ${e && e.message ? e.message : String(e)}` };
  }
  if (!r || !r.body) return { declined: `loop: ${(r && r.declined) || 'no body'}` };
  if (r.unlowered) {
    return { declined: `loop: ${r.unlowered} transfer(s) not lowered`
      + (r.unloweredWhy && r.unloweredWhy.length ? ` (${r.unloweredWhy[0]})` : '') };
  }
  const last = run[run.length - 1];
  const arity = last.at + 1 + ARITY[last.fn] - run[0].at - 1;
  return {
    tree: { name, locals: r.locals || '', body: r.body },
    arity, ops: run.length, loop: true,
    promoted: r.promoted ? r.promoted.length : 0,
    promoteDeclined: r.declined || null,
    bytes: r.body.length,
  };
}

// A CALLER BLOCK WITH ITS LEAF CALLEE INLINED (Design B, in miniature).
//
// `call` and `ret` were the two biggest NAMED entries in the decline histogram
// -- 6478 and 2858 across the nine measured programs -- and they are not a
// missing relaxation. They are a control-flow shape: a straight-line block that
// ends in a near call, a callee that does some arithmetic and returns, and two
// block transfers plus 2n dispatches paid for the round trip.
//
// NOTHING ARCHITECTURAL IS ELIDED, and that is the whole correctness argument:
//
//   * the call's return-address PUSH is still `$push16`/`$push32`, in place,
//     with the same guest value. SP and the stack bytes are the interpreter's
//     at every point inside the callee.
//   * the SHADOW-STACK record is still `$rpush`, and its arena operand is read
//     LIVE out of the arena word it has always lived in rather than baked in as
//     a constant. That word is a fixup, resolved after this pass runs and
//     different in every compile, so a constant would be a lie in exactly the
//     runs the tree is reused in -- and a zero is worse than a lie: `$rpush`
//     skips the entry, the inlined `ret`'s `$rpop` then misses on the CALLER's
//     frame, and a miss empties the whole shadow stack. The arena does not
//     change shape (see the header), so the offset from `$ip` to that word is
//     the same in every compile the tree substitutes into.
//   * the `ret` is still a `$pop16`/`$pop32` and a `$rpop`, and the region
//     LEAVES there: `splitExit` publishes whatever address came off the guest
//     stack as `$gip` and the epilogue resolves `$ip` from it. So a callee that
//     rewrote its own return address, or returned somewhere else entirely, is
//     not a special case -- the tree never assumes where the `ret` goes, it
//     only removes the two dispatches and the two block transfers of getting
//     there. What is saved is the round trip, not the frame.
//   * a fault, an expired slice or an interrupt due date inside the callee
//     leaves through the same `edge()` boundary test every other lowered
//     transfer takes, so the guest stops at the instruction it would have
//     stopped at unfolded.
//
// SELF-MODIFYING CODE is the one thing this needs that the other two folds do
// not. The callee's arena words are NOT overwritten -- other callers still
// enter it directly -- so `repairProg` would happily patch a callee operand in
// place while the caller's tree holds the old value as a constant. compile.js
// records the callee's guest bytes in `prog.treeInlined` and dos-loop.js
// declines the fast repair for a store that reaches them, which falls back to
// dropping the program: always correct, and reported.
function buildCallTree(run, spec, name) {
  const { buildRegion, fallThroughIp } = require('./region-jit');
  const ops = run.map(o => ({ fn: o.fn, name: HANDLERS[o.fn].name, args: o.args, at: o.at }));
  const nexts = ops.map(o => fallThroughIp(o));
  // The call's edge is the callee, not the word behind it; the `ret`'s is the
  // return site, which is where the region ends.
  nexts[spec.callIdx] = spec.calleeIp;
  nexts[nexts.length - 1] = spec.retIp;
  let r;
  try {
    r = buildRegion(ops, nexts, spec.headIp, name, false, [], []);
  } catch (e) {
    return { declined: `call: build threw: ${e && e.message ? e.message : String(e)}` };
  }
  if (!r || !r.body) return { declined: `call: ${(r && r.declined) || 'no body'}` };
  if (r.unlowered) {
    return { declined: `call: ${r.unlowered} transfer(s) not lowered`
      + (r.unloweredWhy && r.unloweredWhy.length ? ` (${r.unloweredWhy[0]})` : '') };
  }
  // THE SHADOW-STACK PUSH, REPAIRED. `stripArenaOperands` zeroed the arena
  // operand (it was a zero already -- fixups resolve after this pass), so the
  // lowering emitted the push with a literal 0. Read the real one out of the
  // arena instead. `$ip` is the tree's first operand word on entry and nothing
  // in front of the call writes it -- every op there passed `escapes()`, which
  // refuses a `$ip` write outright -- so the offset is a constant.
  const want = `(call $rpush (i32.const ${spec.retIp}) (i32.const 0))`;
  const idx = r.body.indexOf(want);
  if (idx < 0 || r.body.indexOf(want, idx + want.length) >= 0) {
    return { declined: 'call: the shadow-stack push is not where the lowering puts it' };
  }
  if (/\(global\.set \$ip /.test(r.body.slice(0, idx))) {
    return { declined: 'call: $ip is written before the shadow-stack push' };
  }
  const body = r.body.slice(0, idx)
    + `(call $rpush (i32.const ${spec.retIp})`
    + ` (i32.load offset=${spec.retArenaOff} (global.get $ip)))`
    + r.body.slice(idx + want.length);
  return {
    tree: { name, locals: r.locals || '', body },
    arity: spec.arity, ops: run.length, call: true,
    // Two block transfers, not one: the call and the return.
    transfers: 2,
    promoted: r.promoted ? r.promoted.length : 0,
    promoteDeclined: r.declined || null,
    bytes: body.length,
  };
}

// --- the live driver ---------------------------------------------------------

// A fold cannot be installed by writing a word: the handler has to EXIST in the
// module's table, and a module is not editable after the fact. So the shape is
// region-live.js's, in miniature:
//
//   compile   a block wants a tree -> `want()` records it, the block compiles
//             UNFOLDED and runs. Nothing is stalled.
//   pump      between two slices, off the guest clock: build the module with
//             every tree wanted so far appended, instantiate it over the SAME
//             memory, carry the globals, and drop the blocks that wanted one so
//             the next compile of them folds.
//   compile   the same blocks come back with `treeAt` holding their key.
//
// AN INSTALL MUST NOT COST THE RUN A HANDBACK. That is region-live.js's hardest
// lesson and the whole reason the drop below is not a `cache.flush()`: a block
// the cache does not hold is a handback, a handback cuts its slice short, and
// the unspent remainder shifts every later slice boundary -- and therefore
// every IRQ, every audio render and every Sound Blaster DMA fetch -- for the
// rest of the program. Identical picture, different wav, from the install on.
// So the dropped heads are compiled BACK here, on the host's turn, and the
// shadow return stack is repaired rather than cut.
class TreeFolder {
  constructor({
    session, vm, machine, portIn, portOut, build = {}, repFast = true,
    maxTrees = 256, maxInstalls = 4, minOps = MIN_OPS, log = () => {},
    batchMin = 64, batchWait = 400,
    // The hotness gate. `hot = 0` is the static fold: every eligible run gets
    // a handler whether it ever runs again or not. `hot = N` compiles a run
    // only after the arena word it starts at has been dispatched N times.
    hot = 0, warmFrom = 0, warmFor = 10e6, hits = null,
    // Ending the window EARLY, and why it is off (`quietFor = 0`).
    //
    // The window looked like the gate's constant cost -- ten million dispatches
    // of `--block-hits`, paid by every gated run and earned back only by a
    // folding one. So this samples it every `probeEvery` dispatches and closes
    // once the answer (candidates nominated / over the threshold / paragraphs
    // ever compiled) has held still for `quietFor`, never before `minWarm`.
    //
    // Two measurements retired it. The profiler is FREE: `--block-hits` alone
    // over a whole 20M run costs 1.54 -> 1.54s on DTM2, 1.76 -> 1.78 on CYCLE,
    // 2.25 -> 2.16 on BRW, so there was nothing at the end of the window to
    // save. And closing early is not cheap: candidate discovery is spread
    // across the whole window, and BRW has a 3.3M-dispatch lull in the middle
    // of it -- at `quietFor = 1M` its window shut at 1.27M and it built six
    // handlers that substituted NOTHING, against 13 substitutions over the full
    // distance. A rule safe for BRW closes DTM2 at 5.75M: three quarters of the
    // window for none of the saving.
    //
    // Kept as an arm, not deleted, because the timeline it prints
    // (`--tree-fold-window-trace`) is the evidence for that paragraph.
    probeEvery = 250e3, quietFor = 0, minWarm = 250e3,
    // How long the closed window waits, still profiling, for the dropped hot
    // blocks to recompile before the one install goes in. See closeWindow.
    settleFor = 100e3,
    // The smallest projected removal, as a fraction of the dispatches the
    // profile window itself retired, that is worth one module build. 0 is off.
    //
    // 1% is where the corpus separates. Projected against measured, seven
    // programs, 20M dispatches, gate at 64:
    //
    //   BRW      16.03% of window projected -> 4.56% of the run removed
    //   RUNDEMO   5.84%                     -> 3.97%
    //   DADEMO3   1.67%                     -> 1.90%
    //   DTM2      0.94%                     -> 0.64%
    //   CATWALK   0.04%                     -> 0.04%
    //   ACCIDENT  0.01%                     -> 1.04%
    //   CYCLE     0.00%                     -> 0.00%
    //
    // ACCIDENT is the one the projection gets wrong, and it gets it wrong in
    // the documented direction: its removal is a LOOP tree's, whose iterations
    // are invisible to `entries * (ops - 1)`. Cutting it costs a 1% dispatch
    // removal and saves a module build, which is the better side of that trade
    // at these sizes -- but it is the case to look at first if this threshold
    // is ever suspected of being too blunt.
    minPayoff = 0.01,
    // Print one line per probe at which the answer moved. Off by default: it is
    // the trace for tuning the two numbers above, not a run-time diagnostic.
    windowTrace = false,
    // Which of the census's relaxations are on. An array or a Set from the CLI,
    // normalized to a Set here so `eligibleRuns` never has to ask.
    relax = RELAXATIONS,
    // Fold a self-loop block WHOLE, terminator included, so the loop runs its
    // iterations inside the tree function and costs one dispatch per loop
    // instead of one per iteration. Off switch for the A/B, since this is the
    // one relaxation that changes which arena words the guest re-enters.
    loops = true,
    // Inline a LEAF callee into the caller's tree (buildCallTree above). On
    // within `--tree-fold`; `--no-tree-fold-calls` is the A/B arm.
    calls = true,
    // The size cap on one inlined callee, in guest ops, and the budget on the
    // total inlined across the run. Neither is a correctness bound -- both are
    // there because a handler is wasm text and a module build is the gate's
    // whole cost, so a 300-op callee inlined at forty call sites is 12000 ops
    // of generated code for a fold whose value is two block transfers.
    maxCallOps = 32, callBudget = 2000,
    // VALIDATING THE PAYOFF MODEL. With `--tree-fold-stats` the run measures a
    // second, DISJOINT window after the install -- `statsSkip` dispatches to
    // let the install settle, then `statsWindow` of counting -- and reports the
    // projection against the entries each tree actually took. Off by default:
    // it forces the per-handler histogram on, which the fold does not otherwise
    // need.
    stats = false, statsSkip = 250e3, statsWindow = 5e6,
    // The shared handler-table tail (tools/toyvm/extras.js). The region JIT
    // appends to the same one, which is what lets `--tree-fold` and
    // `--region-jit` be on together. A standalone folder gets its own.
    extras = null,
  }) {
    Object.assign(this, {
      session, vm, machine, portIn, portOut, build, repFast,
      maxTrees, maxInstalls, minOps, log, batchMin, batchWait,
      hot, warmFrom, warmFor, hits, loops, calls, maxCallOps, callBudget,
      statsOn: stats, statsSkip, statsWindow,
      probeEvery, quietFor, minWarm, windowTrace, settleFor, minPayoff,
      relax: relax instanceof Set ? relax : new Set(relax),
      extras: extras || new (require('./extras').Extras)(),
    });
    // True while the guest is running on the `--block-hits` build the gate
    // profiles with. Cleared by the first install, which is what takes it away.
    this.profilerLive = hot > 0;
    // Gated mode has three phases and this is the one state variable for them:
    // 'warm' (candidates accumulating, the profiling instance running),
    // 'closed' (the hot set has been promoted, nothing new is taken).
    this.phase = hot > 0 ? 'warm' : 'static';
    this.candidates = new Map();      // key -> {run, lins:Set, addrs:Set}
    this.hotLins = new Set();         // guest linear addresses the window found hot
    this.hotPromoted = 0;
    this.coldSkipped = 0;
    this.deadSkipped = 0;
    this.hottest = 0;                 // the highest hit count any candidate had
    this.sinceWant = 0;
    this.trees = [];                  // the `{name, locals, body}` list, in table order
    this.treeOrd = [];                // ...and each one's ordinal in the SHARED tail
    this.treeOps = [];                // guest ops each of those stands for
    this.treeIsLoop = [];             // ...and whether each one loops in place
    this.treeIsCall = [];             // ...or inlines a leaf callee
    this.treeSaves = [];              // ...and what one entry into it is worth
    this.treeHits = [];               // ...against the window's own entry count
    this.treeLoops = 0;
    this.treeCalls = 0;
    this.callSites = 0;               // call sites folded, over the whole run
    this.callOps = 0;                 // callee ops inlined at them
    this.callBudgetLeft = callBudget;
    // The stats window: `null` until the install, then two counter snapshots
    // `statsWindow` dispatches apart.
    this.statsAt = 0; this.statsFrom = null; this.statsBase = null;
    this.statsDelta = null; this.statsSpan = 0;
    this.at = new Map();              // key -> ordinal
    this.arity = new Map();           // key -> operand words the handler steps over
    this.pendingSites = new Map();    // lin -> true, blocks to drop at the next install
    this.wantedKeys = new Map();      // key -> run, not yet built
    this.installs = 0;
    this.folds = 0;                   // runs folded, over the whole run
    this.foldedOps = 0;               // guest ops inside them
    this.why = new Map();             // decline histogram
    this.declinedTrees = new Map();   // lowering declines, by reason
    this.watBytes = 0;
    this.ms = { build: 0, instantiate: 0, swap: 0 };
    this.capped = false;
    this.dropSites = 0; this.dropProgs = 0; this.dropBlocks = 0;
    // The early-close sampler's state. `probeSig` is the answer as of the last
    // probe that changed it, `quietSince` the dispatch count at which it last
    // moved, and `closedAt`/`closedWhy` record what actually ended the window
    // so the summary can say whether the cap was reached or not.
    this.lastProbe = 0;
    this.probeSig = null;
    this.paraHigh = 0;
    this.quietSince = warmFrom;
    this.closedAt = 0;
    this.closedWhy = '';
    this.settled = false;
    this.hotHits = new Map();         // hot guest address -> the count it reached
    this.projected = 0;               // trips the batch about to be built should remove
    this.preProjected = 0;            // ...the same sum over the window's captured runs
    this.refusedPayoff = 0;           // ...when that was too few to be worth a module
    this.done = false;                // ...and so nothing more will be built at all
  }

  // The answer the window exists to produce, as a comparable value: how many
  // runs have been nominated, and how many of them are already over the
  // threshold. Both halves matter -- a program still discovering code moves the
  // first, a program whose known code is warming up moves the second -- and the
  // window has stopped being informative only when NEITHER moves.
  //
  // O(candidates) and run once per `probeEvery` dispatches, so it is off the
  // per-dispatch path entirely; the cost this is here to remove is in wasm.
  windowSig() {
    let over = 0;
    for (const c of this.candidates.values()) {
      let n = 0;
      for (const a of c.addrs) { const h = this.hitsAt(a); if (h > n) n = h; }
      if (n >= this.hot) over++;
    }
    // THE THIRD TERM IS WHY THIS WORKS ON BRW. Candidates alone go quiet during
    // a depack -- BRW nominates nothing new between 250k and its blitter at
    // ~4M, so a two-term signature closed its window at 1.27M and built six
    // handlers that substituted NOTHING. What is moving in that stretch is the
    // program's own code: paragraphs it has never compiled before keep
    // arriving. So the footprint is part of the answer, and the window stays
    // open while the guest is still producing code to judge.
    //
    // High-water rather than the live size, because the live size dips every
    // time a self-modifying store drops a program and climbs back when it
    // recompiles -- CYCLE's mixer recompiles 66k times a minute and would never
    // be quiet on the raw number. A recompile of code already seen does not
    // move a high-water mark; code never seen before does.
    const byPara = this.session && this.session.cache ? this.session.cache.byPara : null;
    if (byPara && byPara.size > this.paraHigh) this.paraHigh = byPara.size;
    return `${this.candidates.size}/${over}/${this.paraHigh}`;
  }

  // Where this module's extra handlers start in the table. Read off the VM
  // rather than remembered, because `makeVm` computes it from the built
  // module's own handler count -- the same discipline region-jit keeps, for the
  // same reason: an ordinal is not a table index and only the module knows the
  // difference.
  get base() { return this.vm.regionBase || 0; }

  // Called from compile.js when a run is eligible and its handler does not
  // exist yet. `lin` is a byte inside the block, which is all the drop needs;
  // `addr` is the ABSOLUTE arena address of the run's FIRST word, which is what
  // the hotness gate counts.
  //
  // In gated mode this is not a request, it is a NOMINATION. The block has just
  // been compiled, so its counter is zero by construction and asking now would
  // decline everything; the count is read at the end of the profile window
  // instead (`closeWindow`), by which time the arena word has been bumped once
  // per execution of the run.
  // `loopHead` is the block's own guest ip when the run is a WHOLE self-loop
  // block (the loop fold above); undefined for an ordinary straight-line run.
  // It rides with the run because it is the one thing `buildLoopTree` needs
  // that the arena words do not carry.
  // `callSpec` is the same for the leaf-call fold: everything `buildCallTree`
  // needs that the caller block's own arena words do not carry (the callee's
  // guest ip, the return site, where the call sits in the run).
  want(key, run, lin, addr, loopHead, callSpec) {
    if (this.at.has(key) || this.wantedKeys.has(key)) {
      if (lin !== undefined) this.pendingSites.set(lin, true);
      return;
    }
    // How many BLOCK TRANSFERS a tree over this run removes per entry, on top
    // of its n-1 dispatches. A straight-line run removes none -- it stops in
    // front of the terminator by construction. A loop tree absorbs its back
    // edge, and a call tree absorbs the call and the return.
    const transfers = callSpec ? 2 : loopHead === undefined ? 0 : 1;
    if (this.phase === 'warm') {
      let c = this.candidates.get(key);
      if (!c) {
        if (this.candidates.size >= this.maxTrees * 8) { this.capped = true; return; }
        c = { run, lins: new Set(), addrs: new Set(), transfers };
        this.candidates.set(key, c);
      }
      if (lin !== undefined) c.lins.add(lin);
      if (addr !== undefined) c.addrs.add(addr);
      return;
    }
    // Past the window the counters are frozen, so a block compiled afterwards
    // cannot be judged on its own count -- but the WINDOW's verdict is still
    // good, because it was about a guest address and guest addresses do not
    // move. `hotLins` is that verdict, and it is what makes the gate survive a
    // recompile.
    //
    // It has to. A run captured during the window is a list of ARENA WORDS, and
    // those are not stable: fusion, the cross-block dead-flag pass and trace
    // formation all emit different words for the same guest bytes depending on
    // what was compiled alongside them. Promoting the captured run and stopping
    // there built 88 handlers for ACCIDENT and substituted THREE, because by
    // the time the module was ready the blocks had been recompiled into
    // something whose `treeKey` no longer matched. Keying the verdict on the
    // guest address instead lets every later compile of a hot block fold
    // whatever run it now has.
    if (this.phase === 'closed') {
      if (lin === undefined || !this.hotLins.has(lin)) {
        this.note('cold block (outside the hot set)');
        return;
      }
    }
    // `done` is the payoff refusal, not a cap: the window is shut and its own
    // numbers said no module is coming, so there is nothing left to nominate
    // for. Kept apart from `capped` so the report does not claim a limit was
    // hit, and apart from `installs` so it does not claim builds that never
    // happened.
    if (this.done) return;
    if (this.trees.length + this.wantedKeys.size >= this.maxTrees
        || this.installs >= this.maxInstalls) {
      this.capped = true;
      return;
    }
    this.wantedKeys.set(key,
      { run, loopHead, callSpec, transfers, hits: this.hotHits.get(lin) || 0 });
    this.sinceWant = 0;
    if (lin !== undefined) this.pendingSites.set(lin, true);
  }

  // How many times the arena word at `addr` was dispatched, out of the
  // `--block-hits` table the profiling instance has been filling.
  //
  // The index is masked exactly the way emit.js's `ipHistBump` masks it, so a
  // stray address reads a wrong counter rather than throwing -- and the mask is
  // also why this is a HEURISTIC and not a measurement: the arena recycles and
  // the counters do not, so a word that lands on a recycled address inherits
  // the count of whatever used to live there. It over-counts, never under, so
  // the failure mode is folding something cold rather than missing something
  // hot.
  hitsAt(addr) {
    if (!this.hits) return 0;
    return this.hits[((addr - isa.THREAD_BASE) & (isa.THREAD_SIZE - 4)) >>> 2] >>> 0;
  }

  // The end of the profile window: every candidate is judged on the count its
  // run actually reached, the hot ones become wants, and the phase closes so
  // the install that follows can drop the profiling build.
  closeWindow(dispatched = 0, why = 'cap') {
    this.closedAt = dispatched;
    this.closedWhy = why;
    const byPara = this.session && this.session.cache ? this.session.cache.byPara : null;
    // Is any block this run was seen in still compiled? A hot count is a
    // statement about the PAST and the install is in the future, and on this
    // corpus the two come apart hard: ACCIDENT at a 10M window promoted 88
    // trees on their hit counts and substituted THREE, because the other 85
    // blocks had been thrown away by a self-patch or an arena recycle between
    // the count and the build. A handler generated for a block that no longer
    // exists is 3KB of wasm and a slice of build time spent on nothing, and
    // without this filter it is indistinguishable from a fold that is silently
    // failing to apply.
    const live = (c) => {
      if (!byPara) return true;
      for (const lin of c.lins) {
        for (const prog of (byPara.get(lin >>> 4) || [])) if (prog.live) return true;
      }
      return false;
    };
    for (const [key, c] of this.candidates) {
      let n = 0;
      for (const a of c.addrs) n = Math.max(n, this.hitsAt(a));
      if (n > this.hottest) this.hottest = n;
      if (n < this.hot) { this.coldSkipped++; this.note(`cold (<${this.hot} entries)`); continue; }
      // THE VERDICT IS A SET OF GUEST ADDRESSES, NOT A SET OF RUNS, and the
      // captured run is deliberately thrown away here.
      //
      // Promoting it looked like a free head start and was the opposite:
      // ACCIDENT built 88 handlers off its captured runs and substituted THREE.
      // A run is a list of ARENA WORDS, and those are not stable across a
      // recompile -- fusion, the cross-block dead-flag pass and trace formation
      // all emit different words for the same guest bytes depending on what was
      // compiled beside them -- so a run measured at 4M is usually not the run
      // the block has at 10M, and its `treeKey` no longer matches anything.
      //
      // So the close publishes the addresses and drops their blocks. They
      // recompile on the host's turn, `want()` sees them again with the run
      // they have NOW, and the next install carries trees that are current by
      // construction. Two installs instead of one, and every handler built is a
      // handler that is used.
      for (const lin of c.lins) {
        this.hotLins.add(lin);
        this.pendingSites.set(lin, true);
        // ...and how hot, kept per guest address, because that count is the
        // only estimate of what a tree over this block will be WORTH. See
        // `payoff` in pump(): the gate's threshold says a block runs often
        // enough to be interesting and says nothing about how much a handler
        // over it would remove.
        if (n > (this.hotHits.get(lin) || 0)) this.hotHits.set(lin, n);
      }
      if (!live(c)) { this.deadSkipped++; this.note('hot but no longer compiled'); continue; }
      this.hotPromoted++;
      // The same projection pump() makes, made here on the CAPTURED run. The
      // run itself is thrown away (see above) and only its LENGTH is used, so
      // the instability that makes it useless as a key does not matter: a block
      // that folded eleven ops at 4M folds about eleven at 10M.
      this.preProjected += n * (Math.max(0, c.run.length - 1) + (c.transfers || 0));
    }
    // The hot set is finite and fully known now, so there is nothing left to
    // wait for: the second install only has to let the drop's recompiles land.
    this.batchWait = Math.min(this.batchWait, 100);
    this.candidates.clear();
    this.phase = 'closed';
    // Refuse the whole thing here rather than after the drop, when the window's
    // own numbers already say no module is coming. The drop is not free either
    // -- DTM2's is 258 blocks thrown away and compiled back -- and paying for it
    // to discover a batch that pump() will then refuse is the same waste one
    // level up. CYCLE projects 310 trips and DTM2 94,364 against a 10M window;
    // neither is worth a rebuild, and neither is worth a recompile storm.
    if (this.minPayoff > 0 && this.preProjected < this.minPayoff * dispatched) {
      this.refusedPayoff = this.preProjected;
      this.note(`window not worth a module (${this.preProjected} trips projected)`);
      this.hotLins.clear();
      this.pendingSites.clear();
      this.hotHits.clear();
      this.done = true;
      this.log(`[tree] profile window closed at ${this.closedAt} (${this.closedWhy}): `
        + `nothing built, ${this.preProjected} trip(s) projected of ${dispatched}`);
      return;
    }
    // THE DROP DOES NOT NEED A MODULE. It is a cache operation -- throw the
    // programs holding a hot block away and compile them straight back -- and
    // the gate used to spend a whole wasm build getting to it, because the
    // profiler-removal install was the thing that called it. That made the
    // fixed charge on EVERY gated run two module builds: one to take the
    // profiler out, and a second, after the recompiles, to carry the trees.
    //
    // Doing it here leaves one. The recompiles land immediately (`entryFor` is
    // synchronous for every block in the current CS), so `want()` has the runs
    // it will fold before the next seam, and the single install that follows
    // both removes the profiler and installs the trees. The profiler stays on
    // for the `settleFor` dispatches that buys, which is a rounding error
    // against the window it just left.
    if (this.session && this.session.cache) this.dropWanting();
    this.sinceWant = 0;
    this.log(`[tree] profile window closed at ${this.closedAt} (${this.closedWhy}): `
      + `${this.hotPromoted} hot, ${this.coldSkipped} cold, ${this.deadSkipped} hot-but-dead `
      + `(threshold ${this.hot}, hottest candidate ${this.hottest} entries)`);
  }

  note(b, n = 1) { this.why.set(b, (this.why.get(b) || 0) + n); }

  // WHEN to stop and rebuild, which is the whole install policy and the one
  // thing here that is a tuning decision rather than a correctness one.
  //
  // A run discovers its foldable blocks a few at a time, over thousands of
  // slices, so "install as soon as something wants a tree" means a module build
  // per tree. Measured on ACCIDENT at 3M dispatches: 24 installs, 38 trees,
  // 5.7 SECONDS of building against 0.16s for the whole unfolded run. Batching
  // is not an optimization of that, it is what makes the fold usable at all.
  //
  // So a batch goes in when it is big enough to be worth a build, or when it
  // has stopped growing -- the second half matters because a program that only
  // ever finds three foldable blocks would otherwise never install any of them.
  //
  // In gated mode the batch is not the trigger at all -- the profile window is.
  // `dispatched` is the guest clock the window is measured on, so this is where
  // it is closed.
  tick(dispatched = 0) {
    if (this.phase === 'warm') {
      if (dispatched >= this.warmFrom + this.warmFor) this.closeWindow(dispatched, 'cap');
      else if (this.quietFor > 0 && dispatched - this.lastProbe >= this.probeEvery) {
        this.lastProbe = dispatched;
        const sig = this.windowSig();
        if (sig !== this.probeSig) {
          // Straight to stderr rather than through `log`, which is verbose-gated:
          // this trace is asked for by its own flag and turning on the whole
          // verbose stream to read it would bury it.
          if (this.windowTrace) {
            console.error(`[tree] window probe at ${dispatched}: `
              + `${sig} (was ${this.probeSig || '-'})`);
          }
          this.probeSig = sig;
          this.quietSince = dispatched;
        } else if (dispatched - this.quietSince >= this.quietFor
                   && dispatched >= this.warmFrom + this.minWarm) {
          this.closeWindow(dispatched, `quiet since ${this.quietSince}`);
        }
      }
    }
    if (this.phase === 'closed' && this.profilerLive
        && dispatched >= this.closedAt + this.settleFor) this.settled = true;
    if (this.wantedKeys.size) this.sinceWant++;
    if (this.statsOn && this.installs > 0) this.sampleStats(dispatched);
  }

  // The counter array for the SHARED handler tail, or null if this build has no
  // histogram in it. Read fresh every time: an install swaps the instance, and
  // a view into the previous one's memory is a census of a machine that has
  // stopped.
  treeCounters() {
    if (!this.vm || !this.vm.mem || !this.extras.length) return null;
    try {
      return new Uint32Array(this.vm.mem.buffer,
        isa.HIST_BASE + this.base * 4, this.extras.length);
    } catch (e) { return null; }
  }

  // THE SECOND, DISJOINT WINDOW. The projection is made on counts from the
  // PROFILE window and spent on a batch that runs afterwards, so the only
  // honest check is to measure the same trees over a later stretch of the same
  // run and compare RATES -- entries per dispatch, which is what makes two
  // windows of different lengths comparable.
  sampleStats(dispatched) {
    if (this.statsDelta) return;
    // The install itself is the origin: the trees are in the table from here.
    if (!this.statsAt) this.statsAt = dispatched;
    if (this.statsFrom === null) {
      if (dispatched < this.statsAt + this.statsSkip) return;
      const c = this.treeCounters();
      if (!c) { this.statsOn = false; return; }
      this.statsFrom = dispatched;
      this.statsBase = Uint32Array.from(c);
      return;
    }
    if (dispatched < this.statsFrom + this.statsWindow) return;
    const c = this.treeCounters();
    if (!c) { this.statsOn = false; return; }
    this.statsSpan = dispatched - this.statsFrom;
    this.statsDelta = this.treeOrd.map((ord, i) =>
      ((c[ord] >>> 0) - (this.statsBase[ord] >>> 0)) >>> 0);
  }

  // Projected against actual, per tree, plus the top-k precision the doc
  // reports. Returns null when the window never completed -- a run that ended
  // before it closed has no measurement, and reporting the half of it that ran
  // would be reporting a shorter window as if it were the same one.
  payoffReport(k = 10) {
    if (!this.statsDelta || !this.closedAt || !this.statsSpan) return null;
    const rows = this.treeOrd.map((ord, i) => ({
      i, ord, ops: this.treeOps[i], save: this.treeSaves[i],
      loop: this.treeIsLoop[i], call: this.treeIsCall[i],
      // Per million dispatches, so the two windows are the same unit.
      projected: this.treeHits[i] * this.treeSaves[i] / this.closedAt * 1e6,
      actual: this.statsDelta[i] * this.treeSaves[i] / this.statsSpan * 1e6,
      entries: this.statsDelta[i],
    }));
    const byP = [...rows].sort((a, b) => b.projected - a.projected);
    const byA = [...rows].sort((a, b) => b.actual - a.actual);
    const kk = Math.min(k, rows.length);
    const top = new Set(byA.slice(0, kk).map(r => r.i));
    const hit = byP.slice(0, kk).filter(r => top.has(r.i)).length;
    return {
      rows: byP, k: kk, precision: kk ? hit / kk : 0,
      span: this.statsSpan, from: this.statsFrom, window: this.closedAt,
      projected: rows.reduce((s, r) => s + r.projected, 0),
      actual: rows.reduce((s, r) => s + r.actual, 0),
      // How many trees the window said were worth something and the second
      // window never entered at all. This is the number the old ranking was
      // silently wrong about on CYCLE.
      dead: rows.filter(r => r.projected > 0 && r.entries === 0).length,
    };
  }

  // A MODULE BUILD IS THE ONLY THING THE GATE COSTS, so nothing here installs
  // unless there is a tree to install.
  //
  // This used to force a build the moment the window shut, whether or not
  // anything qualified, to get the `--block-hits` profiler out -- on the belief
  // that the profiler was one load/add/store per dispatch and worth 22% on BRW.
  // Measured directly (user+sys CPU, fixed 20M dispatches, min of 3
  // interleaved reps, `--block-hits` alone against nothing at all):
  //
  //   DTM2  1.54 -> 1.54    CYCLE  1.76 -> 1.78    BRW  2.25 -> 2.16
  //
  // The profiler is free, for the WHOLE run, on all three. What is not free is
  // the rebuild it was being taken out with: one module is 1700 handlers and
  // measured 591-751ms of the 0.67-0.80s the gate charged. That charge, paid by
  // every gated run and earned back only by a folding one, is exactly the
  // constant absolute cost that put five of the six A/B programs just under
  // parity while BRW gained 10%.
  //
  // So a run that finds nothing hot now keeps the profiler and builds nothing,
  // and a run that finds something pays for ONE build, not two: the drop no
  // longer needs a module (see closeWindow), so the profiler removal and the
  // trees ride the same install. `settleFor` is the wait that makes that true
  // -- a hot block in another CS recompiles lazily, when the guest next enters
  // it, and its want has to be in hand before the build starts.
  needsInstall() {
    if (!this.wantedKeys.size) return false;
    if (this.profilerLive && this.phase === 'closed') return this.settled;
    return this.wantedKeys.size >= this.batchMin || this.sinceWant >= this.batchWait;
  }

  // Everything compile.js needs to substitute. Handed over as plain maps so the
  // compiler never reaches into this object.
  maps() { return { treeAt: this.at, treeArity: this.arity, treeBase: this.vm.regionBase }; }

  async pump() {
    if (!this.needsInstall()) return false;
    const built = [];
    for (const [key, w] of this.wantedKeys) {
      const name = `tree_${this.trees.length + built.length}`;
      const r = w.callSpec ? buildCallTree(w.run, w.callSpec, name)
        : w.loopHead === undefined
          ? buildTree(w.run, name) : buildLoopTree(w.run, w.loopHead, name);
      if (r.declined) {
        this.declinedTrees.set(r.declined, (this.declinedTrees.get(r.declined) || 0) + 1);
        continue;
      }
      built.push({ key, transfers: w.transfers || 0, ...r, hits: w.hits || 0 });
    }
    this.wantedKeys.clear();
    this.sinceWant = 0;
    // IS THIS BATCH WORTH A MODULE? The gate answers "does this block run often
    // enough to be interesting"; it does not answer "how much would a handler
    // over it remove", and on DTM2 the two came apart by a factor of seven --
    // hottest candidate 12676 entries, and the trees it built removed 0.64% of
    // the run's dispatches, against 4.56% on BRW from a batch half the size.
    // One module build is ~1700 handlers and is the gate's whole cost, so a
    // batch projected to remove less than `minPayoff` of the window's own
    // dispatches is not built at all.
    //
    // The projection is PROJECTED SAVINGS, not projected dispatches: per entry,
    // the `ops - 1` trips through `$next` the tree does not take PLUS the block
    // transfers it absorbs, summed over the batch on the window's own counts.
    //
    // The transfer term is what round 7 added, and it is not a rounding
    // correction. `tools/bench-loops.js` prices a dispatch at ~8ns and a block
    // transfer at ~9ns ON TOP of one, so a call tree's two absorbed transfers
    // are worth about as much as four more folded ops -- and a four-op leaf
    // call, ranked on dispatches alone, projects 3 where it is worth 5. The two
    // folds whose value is mostly transfer (loop, call) were therefore the two
    // the old ranking pushed to the bottom.
    //
    // It is still a LOWER bound for a loop tree, whose iterations are invisible
    // from outside -- which is the right way for it to be wrong, since it
    // biases toward building the loop folds that are worth the most.
    // `--tree-fold-stats` measures projected against actual in a second,
    // disjoint window; the table is in docs/toyvm-tree-fold.md.
    this.projected = built.reduce(
      (s, b) => s + b.hits * (Math.max(0, b.ops - 1) + (b.transfers || 0)), 0);
    if (this.minPayoff > 0 && this.phase === 'closed'
        && this.projected < this.minPayoff * this.closedAt) {
      this.refusedPayoff = this.projected;
      this.note(`batch not worth a module (${this.projected} trips projected)`, built.length);
      // Nothing more will be built: the window is shut, so no better batch is
      // coming, and leaving the profiler in costs nothing (see needsInstall).
      this.done = true;
      this.pendingSites.clear();
      return false;
    }
    // Every want declined its lowering, so there is nothing to put in a module.
    // Building one anyway is the mistake needsInstall's comment is about.
    if (!built.length) {
      this.pendingSites.clear();
      return false;
    }
    for (const b of built) {
      // How many guest ops this handler stands for, kept in table order. It is
      // the only way to turn a dispatch census back into "dispatches removed":
      // `--handler-hist` counts how often each handler ran, and a tree that ran
      // N times removed N*(ops-1) trips through `$next`. Without it the fold's
      // headline number would have to be inferred from a timing.
      this.treeOps.push(b.ops);
      // A LOOP TREE'S REMOVED-DISPATCH COUNT IS NOT `entries * (ops - 1)`.
      // The handler histogram counts ENTRIES into the handler, and a loop tree
      // is entered once per LOOP and then turns inside itself, so the trips it
      // removed are `iterations * ops - entries` and the iteration count is
      // invisible from outside. Counted separately rather than folded into the
      // same total, so the headline number stays a number and does not quietly
      // become a lower bound.
      if (b.loop) this.treeLoops++;
      if (b.call) this.treeCalls++;
      this.treeIsLoop.push(!!b.loop);
      this.treeIsCall.push(!!b.call);
      // What one entry into this handler is projected to save, and how often
      // the window said it would be entered. `--tree-fold-stats` reads both
      // back against the counters a second window measures.
      this.treeSaves.push(Math.max(0, b.ops - 1) + (b.transfers || 0));
      this.treeHits.push(b.hits || 0);
      // THE ORDINAL COMES FROM THE SHARED ALLOCATOR, not from this list's
      // length. tools/toyvm/extras.js owns the handler table's tail because
      // the region JIT appends to it too, and `--region-jit` is the page
      // default -- a tree numbered from its own array would name a region.
      const ord = this.extras.commit([b.tree]);
      this.at.set(b.key, ord);
      this.treeOrd.push(ord);
      this.arity.set(b.key, b.arity);
      this.trees.push(b.tree);
      this.watBytes += b.bytes;
    }
    await this.install();
    this.installs++;
    return true;
  }

  // Move the running program onto a module whose table has the trees in it.
  // The recipe is region-live.js `install()`, minus everything a REGION needs
  // that a tree does not: there is no guest-ip keyed substitution map to set, no
  // successor list to pre-compile (a tree replaces ops INSIDE a block, so the
  // block's own edges are untouched), and no byte guard to arm (the block was
  // decoded normally, so the code bitmap already covers it).
  async install() {
    const vm = this.vm;
    const old = vm.exports;
    const t0 = now();
    const next = await makeVm(vm.variant, {
      portIn: this.portIn, portOut: this.portOut, memory: vm.memory,
      ...this.build, regions: this.extras.handlers,
    });
    this.ms.instantiate += now() - t0;
    const t1 = now();
    carryState(old, next.exports);
    vm.rebind(next);
    // The machine caches the export table it pokes registers through, and the
    // VGA card's programming is five globals with no accessor pair, so neither
    // survives the swap on its own. `setVmExports`, never `setMemory` -- the
    // latter is the boot-time reset and takes the guest's own interrupt
    // handlers away (region-live.js "What was wrong", item 1).
    if (this.machine && this.machine.setVmExports) this.machine.setVmExports(vm.exports);
    if (vm.exports.set_rep_fast) vm.exports.set_rep_fast(this.repFast ? 1 : 0);
    if (this.session.vgaPeriod && vm.exports.set_vga_period) {
      vm.exports.set_vga_period(this.session.vgaPeriod, this.session.vgaLines);
      if (old.get_vga_phase0 && vm.exports.set_vga_phase0) {
        vm.exports.set_vga_phase0(old.get_vga_phase0());
      }
    }
    this.dropWanting();
    this.profilerLive = false;
    this.ms.swap += now() - t1;
    this.log(`[tree] install ${this.installs + 1}: ${this.trees.length} tree(s) in the table, `
      + `${(this.watBytes / 1024).toFixed(1)}KB of WAT`);
  }

  // Drop exactly the programs holding a block that wanted a tree, compile them
  // back here, and repair the shadow return stack. Every line of this is
  // region-live.js's, and the two comments worth keeping are why the last two
  // steps exist at all: a dropped head is a handback the interpreter never
  // took, and a truncated return frame is another one.
  dropWanting() {
    const cache = this.session.cache;
    const vm = this.vm;
    const sites = [...this.pendingSites.keys()];
    this.pendingSites.clear();
    if (!sites.length) return;

    this.dropSites += sites.length;
    const doomed = new Map();
    const doomedProgs = new Set();
    for (const lin of sites) {
      for (const prog of (cache.byPara.get(lin >>> 4) || [])) {
        if (!prog.live) continue;
        doomedProgs.add(prog);
        for (const [bip] of prog.blocks) doomed.set(`${prog.cs}:${bip}`, [prog.cs, bip]);
      }
    }
    // How many of the sites still named a LIVE program. A promoted tree whose
    // block has since been thrown away (self-patch, arena recycle) drops
    // nothing, is never recompiled, and so is never substituted -- which is a
    // tree built for nothing and looks exactly like a broken fold unless this
    // is counted.
    this.dropProgs += doomedProgs.size;
    this.dropBlocks += doomed.size;
    const rtop0 = vm.raw('rtop');
    const stack = new Int32Array(vm.mem.buffer, isa.RSTACK_BASE, rtop0 * 3);
    const doomedSpans = [...doomedProgs]
      .map(p => [p.arenaBase, p.arenaBase + p.words.length * 4]);
    const stale = (a) => doomedSpans.some(([lo, hi]) => a >= lo && a < hi);
    // `invalidateRange` falls back to a whole-cache flush for a wide range, and
    // a flush leaves no arena address anywhere valid -- so the repair below is
    // only sound when every drop really was narrow.
    const narrow = !cache.smcFlush;
    let keep = rtop0;
    for (const lin of sites) cache.invalidateRange(lin, lin);

    const vmx = vm.exports;
    const resets0 = cache.arenaResets;
    const curCs = vm.get('cs') & 0xFFFF;
    const codeBase = vmx.get_csb(), linmask = vmx.get_linmask(), d32 = vmx.get_d32() !== 0;
    for (const [cs, bip] of doomed.values()) {
      if ((cs & 0xFFFF) !== curCs) continue;
      cache.entryFor(cs & 0xFFFF, bip, codeBase, linmask, d32);
    }
    if (narrow) {
      for (let i = 0; i < rtop0; i++) {
        if (!stale(stack[i * 3 + 1])) continue;
        let na = 0;
        if ((stack[i * 3 + 2] & 0xFFFF) === curCs) {
          na = cache.entryFor(curCs, stack[i * 3 + 0] >>> 0, codeBase, linmask, d32) || 0;
        }
        if (na) stack[i * 3 + 1] = na; else keep = Math.min(keep, i);
      }
      if (cache.arenaResets !== resets0) keep = 0;
    } else {
      for (let i = 0; i < rtop0; i++) if (stale(stack[i * 3 + 1])) keep = Math.min(keep, i);
    }
    vm.set('rtop', narrow ? keep : 0);
  }

  stats() {
    return {
      installs: this.installs, trees: this.trees.length, folds: this.folds,
      base: this.base, treeOps: [...this.treeOps],
      treeIsLoop: [...this.treeIsLoop], treeLoops: this.treeLoops, loops: this.loops,
      treeIsCall: [...this.treeIsCall], treeCalls: this.treeCalls, calls: this.calls,
      callSites: this.callSites, callOps: this.callOps,
      payoff: this.payoffReport(),
      // Where each tree sits in the SHARED tail, which is what a counter array
      // read at `base` is indexed by. Not the same as its index in `trees` as
      // soon as the region JIT has appended anything.
      treeOrd: [...this.treeOrd], extras: this.extras.length,
      hot: this.hot, phase: this.phase, relax: [...this.relax],
      hotPromoted: this.hotPromoted, coldSkipped: this.coldSkipped,
      deadSkipped: this.deadSkipped, hottest: this.hottest, hotLins: this.hotLins.size,
      closedAt: this.closedAt, closedWhy: this.closedWhy,
      projected: this.projected || this.preProjected, refusedPayoff: this.refusedPayoff,
      minPayoff: this.minPayoff,
      dropSites: this.dropSites, dropProgs: this.dropProgs, dropBlocks: this.dropBlocks,
      foldedOps: this.foldedOps, watBytes: this.watBytes, capped: this.capped,
      why: this.why, declinedTrees: this.declinedTrees, ms: { ...this.ms },
    };
  }
}

const now = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now() : Number(process.hrtime.bigint() / 1000n) / 1000);

module.exports = {
  TreeFolder, eligibleRuns, buildTree, buildLoopTree, buildCallTree,
  treeKey, blockWidth, opAt, MIN_OPS,
  CLOCK_READERS, ESCAPES, RELAXATIONS, RELAX_ALL,
};
