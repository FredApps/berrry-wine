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
// word including AF, which the lazy record does not carry as a value, and
// `rcl`/`rcr` and a shift by CL are the same problem in the shift group. They
// stay barriers, and the decline histogram still names them.
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
// The census's third relaxation, `alias`, is not here: it is a disjointness
// PROOF over two operands rather than a class to accept, and it is the one
// extension that needs code of its own.
const RELAXATIONS = ['partial', 'flags', 'string', 'rep'];
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
function eligibleRuns(ops, width, { minOps = MIN_OPS, why = null, relax = RELAX_ALL } = {}) {
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
    if (ESCAPES.test(folded)) { close(); note('escapes'); continue; }
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
    });
  } catch (e) {
    return { declined: `lowering threw: ${e && e.message ? e.message : String(e)}` };
  }
  const joined = t3.bodies3.join('\n');
  if (readsClock(joined)) return { declined: 'the lowered body reads the clock' };
  if (ESCAPES.test(joined)) return { declined: 'the lowered body can leave the handler' };
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
  const n = run.length;
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
    // Which of the census's relaxations are on. An array or a Set from the CLI,
    // normalized to a Set here so `eligibleRuns` never has to ask.
    relax = RELAXATIONS,
    // Fold a self-loop block WHOLE, terminator included, so the loop runs its
    // iterations inside the tree function and costs one dispatch per loop
    // instead of one per iteration. Off switch for the A/B, since this is the
    // one relaxation that changes which arena words the guest re-enters.
    loops = true,
    // The shared handler-table tail (tools/toyvm/extras.js). The region JIT
    // appends to the same one, which is what lets `--tree-fold` and
    // `--region-jit` be on together. A standalone folder gets its own.
    extras = null,
  }) {
    Object.assign(this, {
      session, vm, machine, portIn, portOut, build, repFast,
      maxTrees, maxInstalls, minOps, log, batchMin, batchWait,
      hot, warmFrom, warmFor, hits, loops,
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
    this.treeLoops = 0;
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
  want(key, run, lin, addr, loopHead) {
    if (this.at.has(key) || this.wantedKeys.has(key)) {
      if (lin !== undefined) this.pendingSites.set(lin, true);
      return;
    }
    if (this.phase === 'warm') {
      let c = this.candidates.get(key);
      if (!c) {
        if (this.candidates.size >= this.maxTrees * 8) { this.capped = true; return; }
        c = { run, lins: new Set(), addrs: new Set() };
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
    if (this.trees.length + this.wantedKeys.size >= this.maxTrees
        || this.installs >= this.maxInstalls) {
      this.capped = true;
      return;
    }
    this.wantedKeys.set(key, { run, loopHead });
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
  closeWindow() {
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
      for (const lin of c.lins) { this.hotLins.add(lin); this.pendingSites.set(lin, true); }
      if (!live(c)) { this.deadSkipped++; this.note('hot but no longer compiled'); continue; }
      this.hotPromoted++;
    }
    // The hot set is finite and fully known now, so there is nothing left to
    // wait for: the second install only has to let the drop's recompiles land.
    this.batchWait = Math.min(this.batchWait, 100);
    this.candidates.clear();
    this.phase = 'closed';
    this.sinceWant = this.batchWait;   // install at the next seam, whatever the batch size
    this.log(`[tree] profile window closed: ${this.hotPromoted} hot, ${this.coldSkipped} cold, `
      + `${this.deadSkipped} hot-but-dead `
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
    if (this.phase === 'warm' && dispatched >= this.warmFrom + this.warmFor) this.closeWindow();
    if (this.wantedKeys.size) this.sinceWant++;
  }

  needsInstall() {
    // The profiling build has to come OUT whether or not anything qualified.
    // `--block-hits` is one load/add/store per dispatch and measured 22% on
    // BRW, so a gated run that found nothing hot -- which is the whole point of
    // the gate, and is what DTM2 and CYCLE do -- would otherwise pay for a
    // profiler it is no longer reading, forever, and read as the gate costing
    // what the profiler costs.
    if (this.profilerLive && this.phase === 'closed') return true;
    if (!this.wantedKeys.size) return false;
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
      const r = w.loopHead === undefined
        ? buildTree(w.run, name) : buildLoopTree(w.run, w.loopHead, name);
      if (r.declined) {
        this.declinedTrees.set(r.declined, (this.declinedTrees.get(r.declined) || 0) + 1);
        continue;
      }
      built.push({ key, ...r });
    }
    this.wantedKeys.clear();
    this.sinceWant = 0;
    // ...but a profiler-drop install carries no trees and still has to happen.
    if (!built.length && !(this.profilerLive && this.phase === 'closed')) {
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
      this.treeIsLoop.push(!!b.loop);
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
      // Where each tree sits in the SHARED tail, which is what a counter array
      // read at `base` is indexed by. Not the same as its index in `trees` as
      // soon as the region JIT has appended anything.
      treeOrd: [...this.treeOrd], extras: this.extras.length,
      hot: this.hot, phase: this.phase, relax: [...this.relax],
      hotPromoted: this.hotPromoted, coldSkipped: this.coldSkipped,
      deadSkipped: this.deadSkipped, hottest: this.hottest, hotLins: this.hotLins.size,
      dropSites: this.dropSites, dropProgs: this.dropProgs, dropBlocks: this.dropBlocks,
      foldedOps: this.foldedOps, watBytes: this.watBytes, capped: this.capped,
      why: this.why, declinedTrees: this.declinedTrees, ms: { ...this.ms },
    };
  }
}

const now = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now() : Number(process.hrtime.bigint() / 1000n) / 1000);

module.exports = {
  TreeFolder, eligibleRuns, buildTree, treeKey, blockWidth, opAt, MIN_OPS,
  CLOCK_READERS, ESCAPES, RELAXATIONS, RELAX_ALL,
};
