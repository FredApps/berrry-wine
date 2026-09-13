# The expression-tree fold

`--tree-fold`, off by default. `tools/toyvm/tree-fold.js`, the pass in
`compileProgram`, `test/test-toyvm-tree-fold.js`.

**Verdict up front.** It works and it is not yet worth turning on. It removes
16.8% of BRW's dispatches and buys 12.7% there; on the other five programs
measured it removes under 2% and loses 5-14% to the flat cost of installing a
module mid-run, for a geomean of **−3.8%**. Frames are identical on all six
witnesses and on 190 of 191 corpus programs; the two programs that moved (one
`--auto-key` menu, one self-patcher) both reproduce the plain build exactly when
the install schedule changes, so nothing here computes a wrong value — it
changes *when* things happen, which on this VM is audible. Read *What it costs*
and *What is next*: the fold is static, and a hotness gate is the change that
would make the rest of it pay.

**Since then**, two things have been added and each has its own section. *The
hotness gate* (`--tree-fold-hot=N`) removes the flat install cost from the
programs that were never going to earn it. *DOS-tailored: partial registers and
flags as values* (`--tree-fold-relax=`) widens what is eligible to include the
8/16-bit ops and the `adc`/`setcc`/`dec`-`jnz` chains 16-bit real-mode code is
actually written in — `partial-reg` falls from 3515 to 15 on BRW and the
`flag consumer` bucket empties entirely. The verdict above is unchanged: the
default is still OFF.

## What it is, and what makes it different from the other two folds

The VM already collapses two shapes. [Superinstructions](toyvm-superinstructions.md)
join exactly two ops. [Spin loops](toyvm-spin-loops.md) collapse a block that is
one branch back to its own head and does nothing. Both are *fixed patterns*:
they match a shape and swap in a handler that was generated when the module was
built.

This one is not a pattern. It takes the straight-line interior of a basic block
— a run of full-width `mov`/`lea`/ALU/shift/widening ops — and *generates a wasm
function for that particular run*, at run time, and installs it. Four ops or
four hundred, the run costs one dispatch and its intermediates never touch the
guest register file.

[The static census](int-expr-fusion-census-dos.md) is what says that is worth
doing, and [the bench](int-expr-fusion-bench.md) is what says how much. This
document is the implementation: what is eligible, how a run becomes a handler,
how the clock is kept, and what it measured.

## Eligibility

> **This section describes the rule set the fold shipped with, which is now
> `--tree-fold-relax=none`.** Two of the restrictions below — the narrow-op one
> and the flag-consumer one — are lifted by default today; see *DOS-tailored:
> partial registers and flags as values*. Everything measured in *What it
> measures* is the `=none` rule set.

**The rule set is `expr-fold-census.js`'s `classify()`, imported, not
reimplemented.** The census measured the population this fold exists for; a fold
whose eligibility had drifted from the census's would be answering a different
question from the one that justified building it. In summary, an op is foldable
when it is:

* a full-width `mov`, `lea`, `add`, `sub`, `and`, `or`, `xor`, `neg`, `not`,
  `inc`, `dec`, `shl`/`shr`/`sar` by an immediate, `imul2`/`imul3`, or a
  `movzx`/`movsx` that widens — register or memory operands, either direction;
* at the block's own width (16-bit in real mode, 32-bit under a 32-bit code
  segment). **A narrower op ends the run**: AL and AH are subfields of AX in the
  register file, so an 8-bit write inside a 16-bit run is an overlap the fold
  does not model.

and it is not any of: a branch, a call, a `ret`, an `int`, a string op, a stack
op, a `mul`/`div`, a segment load, a port access, an x87 op, a `setcc`, a
`cmp`/`test`, an `adc`/`sbb`, a rotate, a shift by CL, or anything that writes
flags a later op in the same run reads.

Two rules are about the run rather than the op:

* **Memory keeps its source order.** Every load and store stays a `$rd*`/`$wr*`
  call in the order it was emitted, so a run may contain as many as it likes.
* **...but a store followed by a load ends the run.** Nothing here proves two
  addresses miss each other, so every load after a store is assumed to alias.
  This is the most expensive rule in the set and the first candidate for
  relaxation (below).

And three the fold adds on top, asked of the *lowered body* rather than the
opcode, because the handler in the arena may be a flagless or specialized twin
rather than the base op:

* it must not read the dispatch clock (`$steps`, `$slice_budget`,
  `$vga_status`, `$port_in`/`$port_out`) — the interpreter would have charged a
  step per op before it and the fold charges the whole run at once, so a clock
  read inside would see a different number;
* it must not be able to leave the handler (`$halt`, `$slice_exit`, `$fault`,
  `$jlook`, a bare `(return)`, or an `$ip` write that is not the operand
  advance) — an early exit would leave `$ip` parked in the middle of the run's
  operand words;
* its operands must fold (`foldOperands` in `trace-jit.js` must recognise the
  `ops(n)` prologue shape).

**The minimum run length is four**, `--tree-fold-min=N`. Four is the census's
own threshold — `in >=4-fold blocks` is the column that varies fifty-fold across
the corpus and decides which programs the fold can pay on.

**The terminator is not in the fold.** The block's branch, and the `cmp` or
`dec` that feeds it, stay exactly the ops they were. That is deliberate, and §
*Why the loop is not folded in place* below is the reason.

## How a run becomes a handler

**The lowering is `trace-jit.js`'s `emitTier3`, which is the region JIT's own
code generator.** Five passes, each bought with a bisect, and a second copy of
them here would have been a second set of bugs:

| pass | what it does to the run |
|---|---|
| `foldOperands` | every `(i32.load offset=K (global.get $ip))` becomes the literal operand word; the `$ip` advance disappears |
| `foldEa` | the ten-arm addressing-mode `br_table` collapses to the arithmetic of the one arm this op uses |
| `foldSeg` | the segment-base lookup becomes the base itself |
| `foldRegisterFile` | the register-file `br_table` on a now-constant index becomes a direct global access |
| `promoteRegs` | the eight register globals and the segment bases become wasm locals for the length of the run — loaded once at the top, stored back once at the bottom |

`promoteRegs` declines outright if any call in the run is not on its allow-list,
so a run that could change a segment base or the stack pointer never gets
promoted; it is still folded, just without the locals.

The emitted body is four parts:

```
  (global.set $steps (i32.sub (global.get $steps) (i32.const N-1)))   ;; the step charge
  <pro>                                     ;; live-in registers -> locals, once
  <the run, straight-line, in locals>
  <epi>                                     ;; live-out registers -> globals, once
  (global.set $ip (i32.add (global.get $ip) (i32.const ARITY*4)))
```

The handler is appended to the table the way a JIT region is — `opts.regions`,
past `HANDLERS.length`, so every existing index keeps its meaning — and its
ordinal is resolved through `vm.regionBase` at substitution time rather than
remembered, because only the built module knows where its extras landed.

Two runs with the same ops and the same operand words are the same handler
(`treeKey`). Without that, a program that recompiles its hot loop eighty
thousand times would generate eighty thousand identical functions.

### Flags

**The `$rec_*` calls are kept verbatim, in source order**, which satisfies the
census's per-FIELD last-writer rule by construction rather than by analysis. The
recorder is not one value: `$rec_add`/`$rec_sub` write `fop`/`fa`/`fb`/`fu`/
`fr`/`fw`; `$rec_logic` writes only `fop`/`fr`/`fw`; `$rec_inc`/`$rec_dec`
materialize CF first and then write `fcf`. So after `add` then `xor`, the *rule*
and the *result* come from the `xor` and the *carry* still comes from the `add`
— which is exactly what falls out of running the two recorders in order.

The compiler's own dead-flag pass ([docs/toyvm-dead-flags.md](toyvm-dead-flags.md))
has already run over these words, across block edges, with a real liveness
fixpoint, and swapped every provably-dead flag writer for its flagless twin. So
whatever recorder is still in the run is one some successor may read, and the
fold runs it. `emitTier3`'s own `deadflags` pass is turned **off** for that
reason (and because it is written for the eager scheme and would find nothing
anyway).

`test/test-toyvm-tree-fold.js` prints the six arithmetic FLAGS bits alongside
the registers precisely because this is the part a naive fold gets wrong
silently: hoist the run into locals and write the register file back at the end,
and the picture is right while `pushf` is wrong.

## The clock, and why the arena does not change shape

Two properties make `--tree-fold` a *transformation* that can be regression-
tested rather than a *retiming* that has to be re-photographed.

**1. The fold charges the dispatches it removes.** `$next` charged one step to
dispatch into the tree; the run it replaces retired N. So the body charges N−1
more, inline, up front. `$steps` at the block transfer is therefore identical to
what an unfolded compile would leave, and the block transfer is where
`$slice_exit` tests the budget, where an IRQ is injected, where the Sound
Blaster's DMA is fetched and where a handback is taken.

**2. The arena is byte-for-byte the same size.** Unlike fusion, which splices
the second op's word out, this **overwrites the run's first word with the tree's
handler index and leaves every other word of the run where it is**, as operands
the tree steps over. Word count, block boundaries, fixup indices and — the one
that matters — the arena-recycle point are all identical to an unfolded compile.
A moved recycle boundary is what shifted CONTAGIO, AQUAPHOB, COUNTDWN and
ZOKDTPLN under fusion; it cannot happen here.

### Why the loop is not folded in place

> **Superseded.** It is now, for a self-loop block whose whole body folds — see
> *Folding the terminator* below. The objection in this section was right about
> the hazard and wrong about the conclusion: the fix is not to leave the
> terminator alone, it is to take the region JIT's boundary test with it. The
> paragraph is kept because the hazard it names is still what the loop fold has
> to answer for.

The scope this could have had is "fold the whole self-loop and iterate inside
the handler while the terminator's condition holds". It does not, and the reason
is [region-live.js's DREAM row](toyvm-region-live.md): a fold that loops in place
**absorbs block transfers**, and a block transfer is where the guest's slice can
end. Absorbing them moves every later slice boundary, and therefore every audio
render, for the rest of the run — an identical picture and a different wav from
the install on. Looping in place is the region JIT's job and it already has it.

### Self-modifying code

Nothing new is needed. The block was decoded normally, so `covered` already
names its bytes and the code bitmap already covers them; a store into any of
them raises `$smc`, `dos-loop.js` drops the whole compiled program, and the fold
goes with it.

What *does* change is the fast operand repair. `CodeCache.repairProg` walks
`prog.wordIp` per instruction and checks that the arena's handler at each word
is the decoded op, one of its twins, or the fused pair. A tree word is none of
those, so it declines with `handler differs` and the store falls back to
dropping the program and recompiling it. **That is a cost, not a hazard** — it
degrades to what the VM did before operand repair existed — but it is a real
regression on the self-patching class (CYCLE, CYBOMAN2), and it is the reason
the fold is opt-in rather than on.

## Installing without costing the run a handback

A fold cannot be installed by writing a word: the handler has to *exist* in the
module's table, and a wasm module is not editable after the fact. So the shape
is `region-live.js`'s, in miniature:

1. **compile** — a block wants a tree; `want()` records it and the block
   compiles *unfolded* and runs. Nothing is stalled.
2. **pump** — between two slices, off the guest clock: build a module with every
   wanted tree appended, instantiate it over the *same* memory, `carryState` the
   globals, `vm.rebind`, `machine.setVmExports`, re-apply the VGA programming.
3. **drop** — exactly the programs holding a block that wanted a tree, then
   **compile those heads back here, on the host's turn**, and **re-point** the
   shadow return stack rather than cutting it.

Step 3 is the whole care. A block the cache does not hold is a handback; a
handback cuts its slice short; the unspent remainder shifts every later slice
boundary. `cache.flush()` would have been one line and would have moved the
audio of every program in the corpus.

### The install policy is the difference between winning and losing

A run discovers its foldable blocks a few at a time over thousands of slices, so
"install as soon as something wants a tree" means a module build per tree — and
**every install moves the guest onto a cold instance the engine has to re-tier
from scratch**. Measured on ACCIDENT at 8M dispatches:

| arm | installs | guest throughput |
|---|---:|---:|
| plain | — | 15.6M dispatches/s |
| `--tree-fold`, install per tree | 18 | **8.1M/s** |
| `--tree-fold`, capped at 2 | 2 | **18.0M/s** |

So batching is not an optimization, it is what makes the fold usable at all. A
batch goes in when it is big enough to be worth a build (`--tree-fold-batch=64`)
or when it has stopped growing (`--tree-fold-wait=400` slices — the second half
matters, or a program that finds only three foldable blocks would never install
any of them), and a run installs at most four times (`--tree-fold-installs=4`)
and generates at most 256 trees (`--tree-fold-max`).

`--tree-fold` and `--region-jit` used to be mutually exclusive: both append to
the handler table through `opts.regions`, so whichever built last owned the
ordinals the other's arena words were written against. They are not any more —
see *One allocator for the handler table's tail* below.

## Gates

### 1. The existing suite, flag off and flag on

All 23 `test/test-toyvm-*.js` run individually, twice: once normally, once with
`TOYVM_TREE_FOLD=1` (the environment override exists for this gate alone — the
tests shell out to `run-dos.js` with argument lists of their own).

```
off: 23/23 passed
on:  23/23 passed
```

Both arms pass every suite. `test-toyvm-operand-patch.js` is the one worth
naming: it is the suite that exercises the self-modifying-code plan cache, and
it passes with the fold on because a folded block declines the in-place repair
and falls back to drop-and-recompile rather than repairing the wrong word.

### 2. `test/test-toyvm-tree-fold.js`

Six hand-assembled `.COM` programs, each one shape, each run twice and required
to print an identical AX/BX/CX/DX/SI/DI/FLAGS line:

| case | shape | must |
|---|---|---|
| `dot` | 12 straight-line full-width ops | fold |
| `addrloop` | a `loop`-terminated body walking a pointer | fold |
| `incloop` | `inc si / cmp si,16 / jne` | fold |
| `partial` | an 8-bit write in the middle | **not** fold |
| `alias` | a store followed by a load | **not** fold |
| `flagcons` | an `adc` in the middle | **not** fold |

The positive cases additionally assert that a handler was generated and
substituted; the negative ones that *nothing at all* folded.

```
PASS test-toyvm-tree-fold:
  dot       12345678FA2CA3B4A97FA97E0045   2 fold(s)/1 tree(s)
  addrloop  0F0E607800004050021000000044   2 fold(s)/2 tree(s)
  incloop   003C01C0000001C0001000000044   2 fold(s)/2 tree(s)
  partial   123700AA129D0000000000000044   no fold
  alias     1234567800001234000000000044   no fold
  flagcons  1234567868ACD110000000000044   no fold
```

Two notes for whoever edits that test. Its `rel8`/`rel16` helpers measure the
displacement from the byte *after* the whole instruction, not from where the
argument is written — get that wrong and the program runs forever at a
plausible-looking address instead of failing. And the `alias` case needs a `nop`
between the loop-counter prologue and the body, because the prologue's own store
is foldable and will otherwise join the body's first three ops and fold a run
the case is supposed to refuse.

### 3. The corpus, flag off vs flag on

`sweep-dos.js --dir=/tmp/demos --reps=1 --variants=tailcall --dispatches=8m`,
once plain and once with `--tree-fold`, then `sweep-diff.js`:

```
191 programs
REGRESSIONS: 0
WENT BLANK: 1   COLORS.EXE
changed (frame and/or dispatches moved, still drawing): 42
  -- 41 of those are identical frame, identical pixel count, identical dispatches
  -- 1 real: ZOKDTPLN.COM  frame 39fca965 -> 2c2fdb2b, px 63885 -> 63887
recovered: 1    QUARTZ.EXE (timeout -> ok; the known QUARTZ flake)
unchanged: 147
```

**42 programs folded at least one tree** and both movers are install *timing*,
not a folded value. The proof is the same experiment in both cases: change
nothing but when the batch installs (`--tree-fold-batch=1`, which installs a
handful of trees early instead of 64 later) and the arm reproduces the plain
build exactly.

- **COLORS.EXE** is an interactive setup menu (video type, sound card, port,
  IRQ) answered by `--auto-key`, whose keystrokes are scheduled off the dispatch
  clock. With the default batching it exits cleanly at 2.5M with the menu still
  on screen — a keystroke landed on a different prompt. With
  `--tree-fold-batch=1` it is byte-identical to the plain arm: same frame
  `7eb1ed94`, same 28081 pixels, same 8.0M dispatches, same `cs:ip`. A fold
  computing a wrong value could not reproduce the baseline frame hash in either
  configuration.
- **ZOKDTPLN.COM** is the COUNTDWN self-patcher, and it moves by 2 pixels of
  63885. Its stats name the path: 1301 self-modify breaks and 10 volatile
  paragraphs plain, 1308 and 20 folded. A folded block declines the in-place
  operand repair, so more paragraphs get promoted to volatile and the patch
  lands a frame boundary away. `--tree-fold-batch=1` (3 substitutions instead of
  160) restores frame `39fca965`.

Both are the cost of installing a module into a running machine, and both are
arguments for the hotness gate in *What is next* rather than for a different
handler body.

### 4. Six witnesses at 80M

Each witness run twice at `--dispatches=80m --pit-clock --auto-key
--sound-pref=sb --env=ULTRASND=220,1,1,11,7 --audio=FILE`, comparing the frame
hash and the sha256 of the rendered wav.

| witness | frame | wav | trees / installs / substitutions |
|---|---|---|---|
| DADEMO3 | same | **same** | 104 / 4 / 401 (2434 ops, 223.6KB) |
| RUNDEMO | same | **same** | 146 / 4 / 133 (738 ops, 423.6KB, capped) |
| BLIQ | same | **same** | 124 / 4 / 333 (1538 ops, 262.5KB, capped) |
| CATWALK | same | **same** | 64 / 4 / 52 (219 ops, 130.0KB) |
| ACME-BIG | same | differs | 121 / 3 / 144 (1025 ops, 263.9KB) |
| CONTAGIO | same | differs | 256 / 3 / 772 (3887 ops, 458.5KB, capped) |

**The frame is identical on all six.** Two wavs are not, and the two have
different causes; both are timing, neither is a wrong value.

**ACME-BIG is the slice grid, and it is provable.** The audio renderer advances
by `budget - left` at each handback, so the sample boundaries are wherever the
slices happen to cut. An install is a handback the other arm does not take —
1812 handbacks off against 1817 on at 20M — so from the first install onward the
two arms resample the same GUS voices at different offsets. That predicts one
thing: anchor the grid and the difference disappears. Re-run both arms with
`--lattice-clock`, which cuts every slice and renders audio on fixed multiples
of the dispatch clock, and ACME-BIG's wav is **identical**
(`572514130dbaf435`). The 83% raw byte agreement with no clean time shift is
what re-quantization looks like, not what different audio looks like.

**CONTAGIO survives the lattice, and its cause is arena pressure.** Same frame,
but the wav still differs and is 24 bytes shorter, so the guest reached a
different point per dispatch. The stats name the mechanism: the folded arm
carries 860KB of arena against 563KB and takes **1 arena recycle where the
plain arm takes 0**, and downstream of that recycle the two arms make different
`rep`-widening decisions (10850 widened runs off, 9930 on) and form different
traces (706 vs 797). A widened `rep` bills a different number of dispatches for
the same guest bytes than the loop it replaces, so once the widening decisions
diverge the dispatch clock is no longer measuring the same thing in both arms,
and the audio re-times. Capping at `--tree-fold-max=64` cuts the fold's WAT to
126KB but does not get the recycle back, so this is not a knob away.

For contrast, `--region-jit` — which installs modules mid-run through the same
recipe — reproduces ACME-BIG's baseline wav byte for byte. The install
machinery is not what does this; the extra handback and the extra arena are.

**So this gate is 4/6 as specified, 5/6 once the clock grid is held fixed, and
6/6 on the picture.** That is the single strongest argument for the flag
defaulting off: the fold does not change any value the guest computes, but on a
program that is already near an arena boundary it changes when things happen,
and on this VM when things happen is what the speaker plays.

## What it measures

### What it removes (load-independent)

One run per program at `--dispatches=20m --tree-fold`, with the tree handlers'
own entries read straight out of the handler histogram, so "trips through
`$next` removed" is `Σ entries(tree) × (ops(tree) − 1)` — a count, not a time.

| program | trees / installs | substitutions (guest ops) | WAT | tree entries | `$next` trips removed |
|---|---|---|---|---|---|
| BRW | 96 / 4 | 388 (2130) | 185.8KB | 673,328 | **3,362,656 — 16.81%** |
| ACCIDENT | 167 / 4 | 124 (722) | 437.5KB | 88,108 | 367,325 — 1.84% |
| DHADREN | 66 / 2 | 59 (308) | 145.5KB | 21,938 | 128,350 — 0.64% |
| B-STEEL | 21 / 2 | 86 (378) | 46.5KB | 10,636 | 42,549 — 0.21% |
| DTM2 | 0 / 0 | 0 | 0 | 0 | 0 — 0.00% |
| CYCLE | 14 / 1 | 6 (28) | 26.3KB | 3 | 18 — 0.00% |

BRW's three hottest trees are six ops each and run 222,909 / 222,909 / 222,904
times — one blitter, three blocks of it. That single loop is most of the 16.8%.
CYCLE is the other extreme and the most instructive row: 14 handlers were
generated, 6 were substituted, and they were entered **three times** in twenty
million dispatches. The fold is static; nothing in it asks whether a block is
hot.

### What it costs (interleaved A/B)

`bench-dos.js --variants=tailcall,tailcall+treefold --reps=5 --dispatches=20m
--cpu-time --dispatch-drift=4096`, arms alternating every rep with the order
rotated, minimum of five. Frames identical on all six.

| program | plain | `+treefold` | min | paired |
|---|---|---|---|---|
| BRW | 15.29 ns/disp (65.4M/s) | 13.56 ns/disp (73.7M/s) | **+12.7%** | −3.7% |
| ACCIDENT | 13.68 (73.1M/s) | 14.47 (69.1M/s) | −5.4% | −9.3% |
| DHADREN | 4.74 (211.0M/s) | 5.45 (183.4M/s) | −13.1% | −8.7% |
| B-STEEL | 10.69 (93.5M/s) | 12.41 (80.6M/s) | −13.9% | −10.0% |
| DTM2 | 5.20 (192.2M/s) | 5.17 (193.3M/s) | +0.6% | −0.5% |
| CYCLE | 8.97 (111.4M/s) | 9.09 (110.1M/s) | −1.2% | +1.7% |
| **geomean** | | | **−3.8%** | **−5.2%** |

**The fold as it stands is a net loss, and the two columns explain each other.**
Benefit tracks the removed-dispatch share and nothing else: BRW removes 16.8% of
its dispatches and gains 12.7%, which is about the right size for a dispatch
that costs ~8ns against a ~15ns average. Cost does *not* track it — B-STEEL
removes 0.21% and loses 13.9%, DHADREN removes 0.64% and loses 13.1%. That is a
flat per-run charge of roughly 5-14% for having installed a module at all: the
guest resumes on a fresh wasm instance the engine has to re-tier, and it is a
bigger instance than the one it left. DTM2, which folds nothing and never
installs, is the control and comes back at +0.6%/−0.5% — the noise floor.

So the shape of the result is: **one program in six is worth it, and it is the
one whose folds are hot.** Everything in *What is next* is aimed at one of those
two terms — the three relaxations raise the removed share, the hotness gate
removes the charge from the programs that were never going to earn it.

Load was 6.6-6.8 throughout and the per-arm spread ran to 91% on the noisiest
row, which is why only the interleaved minimum is quoted here and no wall clock
appears anywhere in this table.

### Why the other blocks declined

Every block the pass looks at and refuses is counted by reason. Across the six
20M runs, as a share of all declines:

| bucket | BRW | ACCIDENT | DHADREN | B-STEEL | DTM2 | CYCLE |
|---|---|---|---|---|---|---|
| partial-reg | 18925 | 2279 | 669 | 1508 | 295 | 337 |
| too short (<4 ops) | 14209 | 4029 | 1883 | 1244 | 405 | 533 |
| flag consumer | 7396 | 644 | 313 | 149 | 149 | 170 |
| terminator | 6833 | 3308 | 1092 | 727 | 346 | 436 |
| stack (push/pop) | 1245 | 3884 | 1888 | 1059 | 423 | 592 |
| call / ret | 809 | 1823 | 603 | 599 | 228 | 365 |
| alias | 1604 | 539 | 73 | 30 | 2 | 7 |
| muldiv | 1660 | 314 | 65 | 86 | 35 | 36 |
| io | 350 | 311 | 95 | 864 | 15 | 13 |
| segment | 132 | 696 | 739 | 180 | 75 | 164 |
| string (rep) | 263 | 156 | 50 | 102 | 26 | 79 |
| unsupported op | ~1000 | ~350 | ~290 | ~45 | ~25 | ~30 |

`partial-reg` and `too short` are the two biggest buckets in every program, and
`flag consumer` + `terminator` together are the next. Those are exactly the
three relaxations below, in that order. `stack`, `call` and `ret` are not
relaxations at all — a block that pushes, calls or returns is a control-flow
question, and this fold is deliberately a straight-line one.

The `unsupported op` tail is long and thin: `cdq`, `cwd`, `cbw`, `cwde`,
`xchg`, `shld`/`shrd`, `nop`, `bts`/`btr`, `lar`/`lsl`, and the protected-mode
`mov cr`/`lgdt`/`lidt`/`ltr`/`smsw` group. Most of them are one line in the
lowering table each, and none of them is worth adding until a census says a
folded run actually ends on one.

## The hotness gate (`--tree-fold-hot=N`)

The static fold above compiles a tree for **every** foldable run it meets at
decode time. That is why its cost is flat and unrelated to trees executed:
CYCLE built 14 handlers for 3 tree entries, ACCIDENT built 167 handlers
(437.5KB of WAT, the install cap) to remove 1.84% of its dispatches, and both
paid the whole build + re-tier bill anyway. `--tree-fold-hot=N` makes the fold
pay only for blocks the guest actually re-enters.

### The signal

region-jit decides hotness by sampling `$ip` at slice expiry (`region-live.js`,
`sampleAfter`/`profileFor` both 6e6). That is free, but at a 2e6-dispatch slice
it takes about **ten samples per 20M dispatches** — nowhere near enough to rank
individual blocks. The gate therefore uses the exact counter we already have:
`--block-hits`, one u32 per arena word at `isa.IPHIST_BASE`, bumped at the top
of `$next` (`emit.js` `ipHistBump`). It is per-block-entry and exact.

Its per-dispatch cost is what makes it usable only as a *window*. Interleaved
against plain, the `blockhits` arm reads +3.1% min / −1.7% paired across the six
programs — i.e. inside this box's noise, but certainly not free forever. So the
gate profiles on a `--block-hits` build and then **takes the profiler away**:
the fold's own instance swap installs a build with `ipHist` off, which is a
transition it was already making.

### Three phases

1. **`warm`** — the guest runs on the profiling build. `compile.js` still calls
   `tf.want(key, run, lin, addr)` for every foldable run, but `want` only
   *records a candidate*: the run, the guest linear addresses it covers, and the
   arena addresses to read counters from. Nothing is built.
2. **window close** at `warmFrom + warmFor` dispatches (`--tree-fold-warm`,
   default 10e6). Every candidate's counters are read; a candidate whose hottest
   arena address has fewer than N entries is dropped as `cold (<N entries)`. The
   survivors publish their **guest addresses** into `hotLins`, and their blocks
   are dropped so the next compile of them can want a tree.
3. **`closed`** — the install fires (always, even with zero survivors, so the
   profiler comes out on programs where nothing is hot), and from then on `want`
   accepts a run only if `hotLins` has its guest address; everything else is
   declined as `cold block (outside the hot set)`.

**The verdict keys on guest addresses, not arena words.** The first design
promoted the captured *run* and then substituted almost nothing — ACCIDENT built
88 handlers for 3 substitutions, BRW 1 tree for 0. A run is a list of arena
words, and fusion, the cross-block dead-flag pass and trace formation all emit
different words for the same guest bytes depending on compile context, so
`treeKey` no longer matched after the drop-and-recompile. Keying on the guest
address and letting the recompile hand its own run to the install fixed it:
ACCIDENT went 167 handlers/437.5KB → 2/4.3KB, BRW 96/185.8KB → 10/19.0KB with
98 substitutions.

The window has to be placed where the hot code exists. BRW's blitter is not
compiled until ~6-10M dispatches in, so `--tree-fold-warm` defaults to 10e6, not
the 2e6 the first version used.

The arena keeps the shape the design requires: an install that lands on a block
already executing is handback-neutral by the same recipe region-live installs
use (`dropWanting()` recompiles dropped heads on the host's turn and repairs the
shadow return stack rather than cutting it), and the run's first word still
becomes the tree ordinal with every later word left in place as an operand the
handler steps over.

### Load-independent counts, 20M dispatches

The bill (handlers built, WAT bytes) against the yield (dispatches removed):

| program | static: trees / WAT / trips removed | gated N=64: trees / WAT / trips removed |
|---|---|---|
| BRW | 96 / 185.8KB / 3,362,656 (16.81%) | 10 / 19.0KB / 2,716,552 (13.58%) |
| ACCIDENT | 167 / 437.5KB / 367,325 (1.84%) | 2 / 4.3KB / 82,659 (0.41%) |
| DHADREN | — / — / 128,350 (0.64%) | 0 / 0.0KB / 0 (0.00%) |
| B-STEEL | — / — / 42,549 (0.21%) | 1 / 2.4KB / 0 (0.00%) |
| DTM2 (control) | — / — / 0 | 3 / 6.9KB / 0 (0.00%) |
| CYCLE | 14 / — / 18 (0.00%) | 0 / 0.0KB / 0 (0.00%) |

The gate's own ledger, from the `tree gate:` line:

| program | hot blocks | promoted | cold | hottest candidate |
|---|---|---|---|---|
| BRW | 11 | 9 | 87 | 47,158 entries |
| ACCIDENT | 106 | 88 | 264 | 23,543 |
| DHADREN | 0 | 0 | 22 | **2** |
| B-STEEL | 1 | 1 | 6 | 44,271 |
| DTM2 | 4 | 6 | 14 | 2,285 |
| CYCLE | 4 | 4 | 10 | 26,930 |

DHADREN is the row that explains the static arm's −13.1%: its hottest foldable
candidate is entered **twice**. Every tree the static fold built for it was
build cost against a block that never ran again. The gate builds nothing there,
and DHADREN goes from −6.4% min / −9.5% paired (static) to +0.8% / +2.3%.

BRW keeps 81% of the static arm's yield (13.58% of dispatches removed against
16.81%) for 10% of its code size.

### Three-arm timing, interleaved `--reps=5`, `--cpu-time`, 20M dispatches

Baseline is plain `tailcall`. Positive is faster.

| program | `--tree-fold` (static) | `--tree-fold --tree-fold-hot=64` | `--block-hits` (control) |
|---|---|---|---|
| BRW | +0.4% min / +0.4% paired | **+23.9% / +18.3%** | +1.1% / +2.4% |
| ACCIDENT | +27.2% / −19.2% | +12.1% / −17.1% | +24.8% / −2.5% |
| DHADREN | −6.4% / −9.5% | +0.8% / +2.3% | +0.7% / −0.3% |
| B-STEEL | −6.8% / −11.0% | +3.3% / +1.5% | +2.4% / −0.2% |
| DTM2 (control) | +2.2% / +3.6% | −3.9% / −6.1% | −6.4% / −7.1% |
| CYCLE | +2.9% / +2.9% | +2.0% / −6.6% | −1.4% / −1.9% |
| **geomean** | **+2.7% min / −5.9% paired** | **+6.0% min / −1.9% paired** | +3.1% / −1.7% |

**Read the counts, not the percentages.** This box sits at load 20-40 and the
timing says so: the unchanged static arm read −3.8% geomean in the run in the
previous section and +2.7% here, and the `blockhits` control — which cannot be
faster than plain, it only adds a store per dispatch — reads +3.1% min. Both
numbers are noise. The defensible timing claim is the *shape*: the gate takes
the static fold's roughly −5% paired loss back to about parity, it is the only
arm that wins on BRW under both statistics, and it stops the three programs the
static fold regressed from regressing.

### Corpus and witnesses

Corpus sweep, 191 programs at 8M dispatches, `tailcall` off against
`--tree-fold --tree-fold-hot=64`: **191 unchanged, 0 regressions, 0 went blank,
0 frame hashes moved, 0 bucket moves.** (The static fold's own sweep was 190/191
with one explained mover; the gate is clean outright, because on most of the
corpus it now builds nothing at all.)

Six 80M audio witnesses, plain against `--tree-fold --tree-fold-hot=64`. **All
six frame hashes are identical between the arms and match the recorded values**
(DADEMO3 36128ac7, RUNDEMO 08502c5c, BLIQ a12d718a, ACME-BIG 362275f5,
CONTAGIO 163af616, CATWALK 19cfa368). Four of the six wavs are byte-identical
too; **BLIQ and CONTAGIO differ**.

That difference is the install schedule, not a wrong value. An install is an
instance swap — a handback at a point the plain arm does not have one — and a
handback cuts its slice short and shifts every later slice boundary, which is
what the audio clock is paced by. Re-running the two at several different
install schedules shows exactly that signature:

| arm | BLIQ wav | CONTAGIO wav |
|---|---|---|
| plain | e1c772ec7df8ae65 | f3424ccf29b4370b |
| gated, `--tree-fold-warm=10m` (default) | f5ea24a87bd7f09b | 54de3b4f52b71831 |
| gated, `--tree-fold-warm=20m` | **e1c772ec7df8ae65** (= plain) | 3791bac9f82f4142 |
| gated, `--tree-fold-warm=40m` | 948d3e7f2170d4c8 | 48757026068a60eb |
| gated, `--tree-fold-batch=1` | **e1c772ec7df8ae65** (= plain) | 54de3b4f52b71831 |

A wrong value would be one stable wrong answer. This is a different answer per
schedule, with two schedules landing back on plain byte for byte, and the frame
hash pinned at `a12d718a` / `163af616` through all of it. It is the same
audio-timing sensitivity region-live installs already have, and it is the reason
the fold's install policy batches and waits.

### Verdict

`--tree-fold` stays **default OFF**, and so does the gate. The gate is a strict
improvement on the static fold — it removes the flat build cost, keeps most of
the yield on the one program that has one, and turns three regressions into
non-events — but the gated arm is not >= plain on every program (DTM2, the
control, reads −3.9%/−6.1%, and CYCLE −6.6% paired), and the whole-corpus
argument for turning it on is still one program wide. Flipping the default is
the user's call regardless.

### Remaining declines, gated

BRW, N=64: partial-reg 22009, too short 19603, terminator 10169, flag consumer
9172, muldiv 2620, alias 2589, stack 1608, `cold block (outside the hot set)`
606, `cold (<64 entries)` 87.

ACCIDENT, N=64: stack 3708, too short 3606, terminator 2986, partial-reg 1924,
call 1316, segment 648, flag consumer 592, alias 445, ret 431, io 311, muldiv
275, `cold (<64 entries)` 264.

The two gate buckets are a rounding error next to `partial-reg`, `too short`,
`terminator`, `stack` and `flag consumer` — the gate is not what is limiting
coverage, the eligibility rules are, and the work list below is unchanged by it.

## DOS-tailored: partial registers and flags as values

Everything above is measured with the rule set the fold shipped with. Two of the
three relaxations the work list asks for are now implemented, behind
`--tree-fold-relax=`:

| value | meaning |
|---|---|
| absent | every implemented relaxation. At the time of this section that was `partial,flags`; it is now `partial,flags,string,rep,shifts,muldiv` — see *String instructions, CL shifts and div in the tree* below. This is the default. |
| `--tree-fold-relax=none` | the exact rules everything above was measured with. The A/B arm. |
| `--tree-fold-relax=partial` / `=flags` / `=partial,flags` | one or both, explicitly. Any subset of the full list works the same way; the list is `RELAXATIONS` in `tree-fold.js` and the CLI validates against it, so adding a name extends the flag. |

`bench-dos.js` carries the same arms as `tailcall+treefoldexact` and
`tailcall+treefoldhotexact`, and `sweep-dos.js` takes the flag corpus-wide.

### Neither one needed a new model

That is the whole reason they are one change each rather than a rewrite, and it
is worth saying why, because "8-bit writes into a 32-bit local" and "flags as
values" both sound like new machinery.

**Partial registers.** `emit.js` already spells an 8-bit register read as an
extract and an 8-bit write as a mask-and-or insert over the full-width global
(`$rget8`/`$rset8`, and `$rset16` for a 16-bit write inside a 32-bit block).
`trace-jit.js`'s `foldRegisterFile`/`foldRegisterFileWide` already collapse those
to a direct access once the register index is a constant, which it is inside a
tree, and `promoteRegs` then rewrites that global into the run's wasm local. So
AL *is* bits 0-7 of the promoted AX local by construction, not by a second copy
of the register file. 8- and 16-bit loads and stores keep their `$rd8`/`$wr8`
calls in source order like every other memory op, so they carry the same fault
and segment semantics as the per-op handlers.

**Flags.** Flags here are lazy: a producer calls `$rec_*` to record its inputs,
a consumer calls `$get_cf`/`$cond*` to materialize the one field it wants. The
fold keeps both calls verbatim and in source order inside the generated handler,
and deliberately leaves the flag globals out of the register promotion set — so
the per-FIELD last-writer state at the run's end is exactly what an unfolded
compile would have left for the terminator and the successor blocks to read.

So both are ACCEPTANCE changes. `classify()` in `expr-fold-census.js` already
tags each declined op with the relaxation that would take it; `eligibleRuns` now
consults a relaxation set instead of refusing outright.

What stays a barrier, and why: `rol`/`ror` at any width (narrow is not on its own
a licence); `lahf`/`sahf`/`pushf`/`popf` and the BCD group, which want the
architectural FLAGS word including AF, which the record does not carry as a
value; and a shift by CL, whose flag effect is undefined at count zero and so is
not a function of the recorded operands alone. The decline histogram now splits
the old `flag consumer` bucket into `shift by CL` and `flags word: <stem>` so
what is left is still a work list rather than one opaque number.

### Before and after, load-independent

One run per program at `--dispatches=20m --tree-fold --tree-fold-hot=64
--handler-hist=1 --pit-clock --auto-key --sound-pref=sb
--env=ULTRASND=220,1,1,11,7`, three arms: `=none` / `=partial` /
`=partial,flags`. Counts, so the load does not enter.

| program | arm | trees / installs | subs (ops) | hot blocks | tree dispatches | `$next` removed | frame |
|---|---|---|---|---|---|---|---|
| BRW | none | 0 / 1 | 0 | 1 | 0 | 0.00% | ecef58f7 |
| | partial | 3 / 2 | 8 (40) | 7 | 0 | 0.00% | ecef58f7 |
| | **partial,flags** | 3 / 2 | 8 (43) | 7 | 0 | 0.00% | ecef58f7 |
| ACCIDENT | none | 2 / 3 | 3 (13) | 106 | 15,535 | 0.28% | 1fceaf7a |
| | partial | 5 / 3 | 9 (55) | 155 | 15,535 | 0.56% | 1fceaf7a |
| | **partial,flags** | 6 / 3 | 10 (60) | 166 | 24,815 | **0.74%** | 1fceaf7a |
| DHADREN | none | 0 / 1 | 0 | 0 | 0 | 0.00% | aa293234 |
| | partial | 0 / 1 | 0 | 0 | 0 | 0.00% | aa293234 |
| | **partial,flags** | 0 / 1 | 0 | 0 | 0 | 0.00% | aa293234 |
| B-STEEL | none | 1 / 2 | 2 (10) | 1 | 0 | 0.00% | 8e8c9dc5 |
| | partial | 1 / 2 | 2 (10) | 1 | 0 | 0.00% | 8e8c9dc5 |
| | **partial,flags** | 1 / 2 | 2 (10) | 1 | 0 | 0.00% | 8e8c9dc5 |
| DTM2 | none | 3 / 2 | 3 (15) | 4 | 0 | 0.00% | 38c165c5 |
| | partial | 4 / 2 | 4 (20) | 10 | 0 | 0.00% | 38c165c5 |
| | **partial,flags** | 4 / 2 | 4 (22) | 18 | 0 | 0.00% | 38c165c5 |
| CYCLE | none | 0 / 1 | 0 | 4 | 0 | 0.00% | 38c165c5 |
| | partial | 0 / 1 | 0 | 8 | 0 | 0.00% | 38c165c5 |
| | **partial,flags** | 0 / 1 | 0 | 16 | 0 | 0.00% | 38c165c5 |

**Every frame hash is identical down all three arms**, which is the contract.

The two buckets the relaxations were aimed at empty out almost exactly:

| bucket | arm | BRW | ACCIDENT | DHADREN | B-STEEL | DTM2 | CYCLE |
|---|---|---|---|---|---|---|---|
| partial-reg | none | 3515 | 1811 | 489 | 850 | 297 | 305 |
| | partial,flags | **15** | **19** | **11** | **2** | **6** | **6** |
| flag consumer | none | 1694 | 538 | 214 | 105 | 149 | 178 |
| | partial,flags | **0** | **0** | **0** | **0** | **0** | **0** |

`flag consumer` goes to zero everywhere because the bucket is now split: what is
left of it shows up as `shift by CL` (BRW 25, DHADREN 68, ACCIDENT 8) and
`flags word: cli/sti/cld/clc/stc/sh2/sh3/cmc/sahf` (BRW 141 across six stems,
ACCIDENT 149 across nine). The residual `partial-reg` is `rol`/`ror` at 8 and 16
bits, which is a deliberate keep-out.

The `hot blocks` column is the one to read for reach, and the `$next removed`
column for what that reach was worth *here*. DTM2's hot set goes 4 → 18 and
CYCLE's 4 → 16 — four times the eligible population — while their removed share
stays 0.00%, because those blocks are still not the blocks those programs
actually spend their dispatches in. ACCIDENT is the one program where the extra
eligibility lands on hot code: 0.28% → 0.74%, from 3 substitutions to 10.

BRW is the row that does not do what the census predicted. The relaxations move
its hottest foldable candidate from 990 entries to 200,259 — a 200x — and it
still records **zero tree dispatches**, because the substituted blocks are not
re-entered after the install in this configuration. Its frame is identical at
both 20M and 60M, so this is a reach-versus-use gap and not a correctness one,
but it is unexplained and it is why the timing row below should not be read as
"the relaxations bought BRW 38%".

### Timing, and why it is not quotable here

`bench-dos.js --variants=tailcall,tailcall+treefoldhotexact,tailcall+treefoldhot
--reps=5 --cpu-time --dispatches=20m --dispatch-drift=4096`, arms alternating
every rep with the order rotated, minimum of five, guest CPU only. Load 11-13
throughout.

| program | plain | gated `=none` | gated (min / paired) |
|---|---|---|---|
| BRW | 21.50 ns/disp | 19.13 (+12.4% / +2.5%) | 15.52 (+38.5% / +31.4%) |
| ACCIDENT | 20.66 | 22.17 (−6.8% / −11.6%) | 22.08 (−6.4% / −5.1%) |
| DHADREN | 6.92 | 6.23 (+11.2% / +18.4%) | 6.21 (+11.3% / +2.6%) |
| B-STEEL | 15.23 | 16.56 (−8.0% / −8.0%) | 16.19 (−5.9% / −0.9%) |
| DTM2 | 7.90 | 7.75 (+2.0% / −7.0%) | 7.63 (+3.6% / −4.6%) |
| CYCLE | 13.15 | 13.58 (−3.2% / −5.4%) | 13.97 (−5.9% / −10.7%) |

**None of these percentages are quotable, and the table says so itself.**
DHADREN folds nothing, installs nothing and substitutes nothing in any of the
three arms — it is the control — and it reads **+11.3% min / +18.4% paired**.
The per-arm spread ran 17% to 134%. A control that moves by more than the effect
means the box, not the fold, is what got measured; this is the load-20-40
machine the rest of the doc keeps warning about. The load-independent counts
above are the result of this work. The timing rows are recorded so the next
person does not re-run them expecting an answer.

### Corpus and witnesses

Six 80M audio witnesses, plain against `--tree-fold --tree-fold-hot=64` with the
relaxations on, `--pit-clock --auto-key --sound-pref=sb
--env=ULTRASND=220,1,1,11,7 --audio=FILE`:

| witness | frame (both arms) | wav |
|---|---|---|
| DADEMO3 | 36128ac7 | **identical** |
| RUNDEMO | 08502c5c | **identical** |
| ACME-BIG | 362275f5 | **identical** |
| BLIQ | a12d718a | differs |
| CONTAGIO | 163af616 | differs |
| CATWALK | 19cfa368 | differs |

**All six frame hashes are identical between the arms and match the recorded
values.** BLIQ and CONTAGIO were already install-schedule movers before this
change (see the gate's own witness table above). CATWALK is new, and it has the
same signature: at `--tree-fold-batch=1` its wav is **byte-identical to plain**
(`9268efa36e4ed39d`), as is BLIQ's (`e1c772ec7df8ae65`, the same value the gate's
table recorded). ACME-BIG, which the static fold moved, is identical here
outright. A wrong value would be one stable wrong answer; this is a different
answer per install schedule with the frame pinned, which is the audio-timing
sensitivity documented above.

### What still declines

With both relaxations on, the largest buckets at N=64, 20M:

BRW: too short 5438, terminator 3569, alias 2020, `cold block` 1140, muldiv 795,
stack 698, call 348, io 282, ret 251.

ACCIDENT: too short 3841, stack 3628, terminator 2939, call 1292, segment 638,
alias 633, ret 411, `cold (<64 entries)` 348, io 311, muldiv 266.

The work list has changed shape. `partial-reg` and `flag consumer` are gone from
the top; what is left is **`too short`, `stack`, `terminator`, `alias` and
`call`** — and `too short` is now the largest single bucket in both programs,
which is a different kind of problem from the other four. A run that ends at
three ops does so because something a few ops away is still a barrier, so the
remaining buckets feed it: every `alias` pair that is proved disjoint, and every
`stack` op that is modelled, joins two short runs into one long one rather than
adding a run of its own. Alias disjointness (below) is therefore worth more than
its own 2020/633 suggests.

## Folding the terminator

`terminator` is the second- or third-largest decline bucket in every program
above, and it is not one barrier but two questions. The first — *may the
terminator's own `cmp` join the run?* — is answered by the flags relaxation. The
second is the one *Why the loop is not folded in place* declined: **may the tree
keep iterating, so a loop costs one dispatch per LOOP instead of one per
iteration?**

It may, and it needed no new machinery — only the discipline to stop writing
one. A self-loop block whose whole body is one eligible run is lowered by
handing that run to **`region-jit.js`'s own `buildRegion`**, as a one-block
closed region whose last `nexts` entry is the block's head. Nothing in
`buildRegion` requires the block to have come from a profiling trace, and the
looping protocol that comes with it is the protocol this doc's objection asked
for:

- **The slice boundary is the interpreter's, on every lowered edge.**
  `region-jit.js`'s `exact` path publishes `$gip` and tests
  `$smc || $halt || $steps < 0` at each edge, in the interpreter's order, and
  leaves through `$out` when it holds — where the epilogue's `leave` calls
  `$slice_exit`, exactly as `GO` would. The back edge uses the interpreter's
  `>= 0`, not a stricter `> 0`.
- **Steps are billed per op per iteration**, with the entry refund that gives
  back the one step `$next` charged to dispatch in. So a loop that runs 1000
  iterations of 5 ops charges 5000, which is what the interpreter charged.
- **`$ip` is re-resolved on the way out** through `(call $jlook (global.get
  $gip))`, never from a baked arena address.

That last point is also what keeps *this* doc's other invariant. Because the
exit re-resolves `$ip`, the block's trailing arena words are dead — the tree
never steps over them and nothing else reads them — so the arena is still
byte-for-byte the size an unfolded compile produced, and a fixup landing inside
the block resolves harmlessly into a word nobody reads.

`--no-tree-fold-loops` turns just this half off; it is the A/B partner for
everything below.

### What it reaches

Of the six programs in the table above, **only BRW builds loop trees** (2 of its
5 handlers, covering 8 guest ops at 2 sites that `--no-tree-fold-loops` leaves as
3 handlers / 8 substitutions / 43 ops). The six witness programs are where the
shape actually lives:

One run each at 20M with `--handler-hist=1`, gated against
`--no-tree-fold-loops`. **`handler entries` is the number to read** — it is the
real count of trips through dispatch, and it is the only one that can price a
loop tree at all: the `tree entries:` line reports a loop tree's *entries* on
their own and explicitly does not count its iterations, so `$next trips removed`
understates the loop fold by exactly the trip count it removed.

| program | loop handlers | handlers (loops on / off) | handler entries (on / off) | removed | handbacks (on / off) |
|---|---|---|---|---|---|
| CATWALK | 3 | 19 / 16 | 2,066,468 / 2,302,303 | **−10.2%** | 7757 / 7997 |
| DADEMO3 | 16 | 29 / 15 | 7,764,127 / 7,829,174 | −0.83% | 5570 / 7696 |
| RUNDEMO | 2 | 19 / 17 | 7,073,141 / 7,093,637 | −0.29% | 5733 / 5754 |
| BLIQ | 2 | 10 / 8 | 18,170,820 / 18,171,603 | −0.00% | 64311 / 64361 |
| ACME-BIG | 0 | 4 / 2 | 13,447,316 / 13,447,316 | 0.00% | 1812 / 1812 |
| CONTAGIO | 0 | 78 / 78 | 9,229,575 / 9,229,575 | 0.00% | 93154 / 93154 |

CATWALK is what the feature is for: three loop handlers take **a tenth of every
dispatch the program makes**, and no straight-line fold can reach them because
the run they replace ends at the terminator. DADEMO3 builds the most loop trees
(16) and gets the least out of them, which is the `--handler-hist` lesson again:
count how often a shape runs, not how many of it exist. The frame hash is
identical between the two arms in every row (the flag-off comparison for these
six is the 80M witness table below).

The decline bucket was deliberately split per stem (`loop: body breaks at
<op>`), so it is a work list rather than a wall. The measured answer is that
**the terminator was never the main barrier — the string group is**:
`movsb`/`movsb32`, `lodsb`/`lodsw`/`lodsb32`, `stosb`/`stosb32`, `rep`/`repne`
account for most declines in every program (DADEMO3: 18 `movsb32`, 5 `lodsb32`,
1 `lodsw32`; B-STEEL: 7 `lodsw`, 2 `lodsb`, 1 `repne`), followed by `out`/`in`,
the CL-shift stems and `div`. A DOS inner loop is usually a string loop, and a
string op is not an expression.

### The one thing it changes, and what it is not

Every frame hash is identical, everywhere it was checked — all six programs at
20M in all five arms, and all six witnesses at 80M. Interrupt counts, vector
counts, dispatch counts and guest seconds are identical too.

What moves is **DADEMO3's wav**, and unlike the movers in the table above it is
*not* install schedule: at `--tree-fold-batch=1` it is the same moved value
(`442a46e9`), not the flag-off one. `--no-tree-fold-loops` restores the flag-off
wav byte for byte, so this is the loop fold and nothing else. The mechanism is
visible in the report:

| | plain | loop fold |
|---|---|---|
| handbacks | 46,340 | 28,209 |
| dispatches per handback | 1726 | 2836 |
| slice entries | `8:ad7a x5918, 8:adbc x5918, 8:adfe x5918 (jt=MISS), 8:ae40 x5918` | `8:ad7a x5034, 8:b2e9 x1880, 8:adbc x1605, 8:ae40 x1492` |
| frame / interrupts / guest seconds | 36128ac7 / 177+645 / 7.99 | identical |

The interpreter was taking a **handback** at those blocks — one of them on a
jump-table miss — 5918 times each. The folded loop iterates through them in
place, so those handbacks do not happen; and because `Machine.audioNow` stamps
port writes relative to the slice start and `audioAdvance` runs per handback,
the same sound is rendered against a different slice grid.

This is the class `region-live.js` documents as "audio only": same picture, same
interrupt count, a wav rendered against slices that started and ended elsewhere.
It is not the `$steps` bug that class used to also contain — that one is fixed,
by the `exact` protocol this fold inherits — it is the residue of removing a
handback at all. `--lattice-clock`, which anchors the slice grid and the audio
render to a quantum instead of to the last handback, is the instrument for it,
and it is passed to both arms or to neither:

| witness | plain | fold | `--lattice-clock` plain | `--lattice-clock` fold |
|---|---|---|---|---|
| CATWALK | 9268efa3 | e31ee7e1 | 168aac23 | **168aac23** |
| BLIQ | e1c772ec | 9e6bdfeb | 0f735bad | **0f735bad** |
| DADEMO3 | 84b95c3f | 442a46e9 | 95fdd202 | **7839f7fd** |

**CATWALK and BLIQ are answered outright**: anchor the grid and the two arms
render byte-identical wavs, so what moved was the grid and not a value.
`--no-tree-fold-loops` restores the flag-off wav for all three on the shipped
clock, so the loop fold is the whole of the effect either way.

**DADEMO3 is not, and that is the failing witness.** Under the lattice clock its
two wavs are the same length and agree byte for byte for the first 74% of the
run, then differ in **4785 bytes of the remaining 184KB** (2.6% of that tail).
Interrupt counts are identical (177, plus 629 host-raised vectors), as are the
frame, the dispatch count and the guest seconds.

The guest event that moves is **the host's interrupt injection point, which is
quantized to handbacks and not to the clock**. `--lattice-clock` anchors where
audio is *rendered*; it cannot anchor where an IRQ is *delivered*, because the
host can only inject one between slices. Absorbing 18,228 handbacks coarsens
that grain from 1703 to 2783 steps, DADEMO3's timer ISR is what drives its
playback — `out_8` is its single hottest handler at 16.4% of all dispatches —
and so its port writes are stamped a few hundred steps from where they were.
CATWALK and BLIQ do not have that dependency, which is why the lattice clock
finishes the job for them and not for this one.

**So the honest statement is:** folding the terminator is frame-exact,
interrupt-count-exact and `$steps`-exact, and it is *not* handback-exact,
because absorbing a block transfer is the whole point of it. On a program whose
audio is driven from an interrupt handler that is the last 26% of one wav. That
is the same trade the region JIT already ships with as a page default; it is why
`--tree-fold` stays opt-in, and why `--no-tree-fold-loops` is a documented
switch rather than a bisector.

**Superseded as of the interrupt schedule.** Handback-exactness stopped being
something the audio depends on: interrupts are now delivered at the dispatch
count they are due at rather than at the next handback, so absorbing a block
transfer no longer moves an injection. DADEMO3 — the witness this section was
written about — is byte-identical in all three arms today, and so are RUNDEMO,
ACME-BIG, CONTAGIO and CATWALK. BLIQ is the one that still moves, and its
interrupt *count* moves with it, which makes it the install-schedule class and
not this one. See [toyvm-irq-schedule.md](toyvm-irq-schedule.md).

## One allocator for the handler table's tail

`--tree-fold` and `--region-jit` were mutually exclusive, and the reason was two
bugs at once. Both append their generated handlers through `opts.regions`, and
both computed their first ordinal as `HANDLERS.length` — so their ordinals
*overlapped*, and each one's module build passed only its own list, so whichever
built last shipped a table that did not contain the other's handlers at all. An
arena word written against a tree ordinal would then call a region, or call
nothing.

The fix is `tools/toyvm/extras.js`: one **append-only** `Extras` allocator,
owning the shared tail past `HANDLERS.length`, handed to both the `TreeFolder`
and the `LiveJit` by `run-dos.js`. Both commit into it, every module build is
handed the whole list, and an ordinal is never reused. The one hazard left is a
straddle — the region JIT *prepares* a module (picking ordinals) at one slice
and *installs* it at a later one, and the fold may commit in between — so the
prepared bundle carries an `extrasEpoch` and `install()` declines and re-profiles
if the epoch moved. Regions are named from their shared-tail ordinal
(`region_${base + idx}`) rather than from 0, so a second install cannot emit a
duplicate wasm function name.

Measured at 20M with the gate at 64, `--tree-fold --tree-fold-hot=64
--region-jit` against each flag alone:

| program | region JIT alone | fold alone | both | frame (all arms) |
|---|---|---|---|---|
| BRW | installed @0x7adc | 5 trees (2 loop) | **installed @0x7adc + 5 trees (2 loop)** | ecef58f7 |
| ACCIDENT | installed @0xb13 | 6 trees | declined (no self-loop region) + 6 trees | 1fceaf7a |
| DHADREN | installed @0x47 | — | **installed @0x47** | aa293234 |
| B-STEEL | declined (inconclusive) | 1 tree | declined + 1 tree | 8e8c9dc5 |
| DTM2 | declined (no region) | 4 trees | declined + 4 trees | 38c165c5 |
| CYCLE | installed @0xcba | — | declined (no region) | 38c165c5 |

**BRW is the row that proves it**: a region installed at `0x7adc` and five tree
handlers, two of them loops, live in one handler table in one run, and the frame
is the flag-off frame.

Two tests pin it. `test/test-toyvm-tree-fold.js` runs its `GATE_COM` case under
both flags at once — the region JIT declines on a program that small, so what
that one guarantees is that both allocators run in one process and the screen is
still the flag-off screen. `test/test-toyvm-region-live.js` adds the arm that
matters: its side-exit program, which is built to make the JIT install, run with
`--tree-fold` as well, asserting **1 region install and 3 tree handlers in one
table** and `bx`/`si`/`bp` and the frame identical to the interpreter's. Values
are the assertion there and timing deliberately is not — a loop tree absorbs
handbacks, so the wav grid is expected to move, while an ordinal collision shows
up as arithmetic.

Which program the sampler picks moves between arms (ACCIDENT and CYCLE install
alone and decline with the fold; B-STEEL declines either way). That is expected
and not a regression: the fold changes what the profiling arms execute, so the
region gate sees a different program. The frame is the invariant, and it holds
in all four arms of all six programs.

### The six witnesses at 80M, with both items in

`--dispatches=80m --pit-clock --auto-key --sound-pref=sb
--env=ULTRASND=220,1,1,11,7 --audio=FILE`, plain against `--tree-fold
--tree-fold-hot=64`:

| witness | frame (both arms) | trees (loop trees) | subs (ops) | wav |
|---|---|---|---|---|
| DADEMO3 | 36128ac7 | 29 (**16**) | 197 (1000) | differs — *see above* |
| RUNDEMO | 08502c5c | 19 (2) | 34 (166) | **identical** |
| BLIQ | a12d718a | 12 (2) | 33 (135) | differs (grid) |
| ACME-BIG | 362275f5 | 4 (2) | 6 (30) | **identical** |
| CONTAGIO | 163af616 | 78 (0) | 514 (3093) | differs (grid) |
| CATWALK | 19cfa368 | 10 (1) | 22 (105) | differs (grid) |

**All six frame hashes are identical between the arms and match the recorded
baselines.** BLIQ and CONTAGIO were already install-schedule movers before any of
this work; CATWALK and BLIQ are proven grid-only by `--lattice-clock` above;
DADEMO3 is the one witness whose wav is neither, and its mechanism is named
above.

### Timing

Not measured, and deliberately so. The three-arm table above was taken at load
11-13 and its control still moved 18%; the box was at **load 62** while these
counts were collected. Every number in these two sections is a count or a hash,
and counts are the same on a loaded box. `--handler-hist` entries, handbacks and
frame hashes are what this feature should be argued about, and interleaving on
an idle machine is what a timing claim would need.

The arms for that run exist, so nobody has to reconstruct them.
`tools/toyvm/bench-dos.js` gained two switches: **`treefoldhotnoloops`**, which
holds the straight-line fold fixed and moves only whether a self-loop iterates
inside its tree, and **`regionjit`**, which is now composable because the
ordinals are. So the four-arm command is

```
node tools/toyvm/bench-dos.js PROG.EXE --reps=5 --cpu-time --dispatches=20m \
  --dispatch-drift=4096 \
  --variants=tailcall,tailcall+treefoldhot,tailcall+treefoldhotnoloops,tailcall+regionjit+treefoldhot
```

and it runs (checked on CATWALK). Read its control before reading its arms.

### The corpus, gated, with all four items in

`sweep-dos.js --dir=/tmp/demos --dispatches=8m --reps=1 --variants=tailcall`,
once plain and once `--tree-fold --tree-fold-hot=64`, then `sweep-diff.js`:

```
191 programs
REGRESSIONS: 0
WENT BLANK: 0
changed (frame and/or dispatches moved, still drawing): 0
recovered: 1    QUARTZ.EXE (timeout -> ok; the known QUARTZ flake)
unchanged: 190
```

**Nothing in the corpus moves.** This is a stronger result than the ungated
sweep recorded above (42 changed, COLORS.EXE blank, ZOKDTPLN.COM two pixels),
and the reason is the gate rather than anything about partial registers, flags,
loops or ordinals: at `--tree-fold-hot=64` over an 8M budget, most programs
install nothing at all, and the ones that do install late enough that the
install-schedule sensitivity those two rows documented never gets a chance to
fire. The ungated numbers are the ones to quote for "what does substituting a
module into a running machine cost"; these are the ones to quote for "is the
shipping configuration safe".

One measurement error is worth recording because it is easy to repeat.
`sweep-dos.js` takes **`--dispatches=`**, not `--budget=`; a `--budget=8m` is
silently ignored and the run falls back to the default guest-seconds budget
(44.06M dispatches here) and the default `--reps=3`. Comparing that against an
8M/1-rep baseline reports three regressions, one blank and 166 changed, every
one of which is the 5.5x budget and none of which is the fold. Check the `opts`
object recorded in both JSONs before running `sweep-diff.js` on them — it is
there for exactly this.

## String instructions, CL shifts and div in the tree

The previous section's work list ended by naming the **string group** as the
barrier that stops a DOS inner loop folding, with `out`/`in`, CL-count shifts and
`div` behind it. Four more relaxations close all of those but the I/O pair, which
is deliberately left alone (host I/O quantization is a separate question):

| value | what joins the eligible set |
|---|---|
| `string` | non-`rep` `movs`/`lods`/`stos`/`scas`/`cmps` at every width |
| `rep` | `rep movs`/`stos` and `repne scas`/`cmps` |
| `shifts` | `shl`/`shr`/`sar`/`rol`/`ror`/`rcl`/`rcr` by `CL`, and the rotates at any count |
| `muldiv` | `mul`/`imul`, and `div`/`idiv` with its `#DE` trap |

All four are on by default when `--tree-fold` is on, and each is nameable on its
own through `--tree-fold-relax=`. `--tree-fold` itself stays default **OFF**.

### Three of the four needed no new machinery either

The same thing that was true of partial registers and flags is true here, and for
the same reason: the fold splices the *existing* handler bodies into a run, so
whatever a handler already does it keeps doing.

**String ops.** A `stosb` handler is a `$rd`/`$wr` pair plus a `$si`/`$di` update
whose sign is read from the live direction flag, and a segment override is
already an operand rather than a branch. Folding it is admitting it to the set;
DF, the override and the fault behaviour come along because the WAT does.

**`rep`.** REP widening (`$rep_fast`, `$rep_span_ok`, `$code_clear`) lowers a
`rep movs`/`stos` to a `memory.copy`/`memory.fill` under hoisted guards with a
byte-loop fallback. Inside a tree it is the **same** primitive under the **same**
guards with the **same** step billing — the three bookkeeping calls simply had to
be declared safe in `trace-jit.js`'s `SAFE_CALLS` and classified as such in
`handler-effects.js`. `repne scas`/`cmps` stays the bounded scan loop it already
was, so count, flags and pointers land where the interpreter leaves them on each
of its three exits.

**CL shifts.** `$sh_<kind><w>` masks its count with the live `(global.get
$shmask)` — the 8086-vs-186 setting programs probe on purpose — returns early at
a masked count of zero *without writing any flag*, and reads the incoming carry
through `$get_cf`. The census declined these because it could not say what the
flags come out as. A tree does not have to say.

### `div` is the first escape the fold repairs rather than refuses

`div`/`idiv` carry the divide-error trap, written `(call $fault0 <ip>) (return)`
twice per handler. That is not an unknown escape, it is a known one, so
`buildTree` splices two statements in front of each call — and the order is the
correctness argument:

1. **the step refund.** The tree charged the run's `n` steps up front; an
   unfolded interpreter would have charged `i+1` by the faulting op, so `n-1-i`
   go back. `$fault` copies `$steps` straight into `$left`, which is why this
   cannot happen after it.
2. **the promotion epilogue.** Promoted registers out of their wasm locals and
   back into their globals. `$fault` pushes FLAGS/CS/IP through SP and halts, and
   everything downstream of a halt reads globals.

`$ip` is deliberately not advanced — an unfolded `div` leaves it parked
mid-operand too, and control re-enters through `$gip`/`$jlook`.

Two constraints fall out of that. `div` folds in **straight-line runs only**: a
`(return)` out of the middle of a loop tree would skip region-jit's own epilogue,
so the loop path passes `allowFault: false` and the histogram says `div (loop
tree)` rather than going quiet. And `$fault0` is promotable **only for a caller
that promises to flush** — it is a gated pass option, not a new `SAFE_CALLS`
entry, because `region-jit.js` lowers through the same `emitTier3` and does not
splice: its refusal to promote across a `div` today is exactly what keeps it
correct, and an unconditional entry would have silently taken that away.

### Before and after

Nine programs, 20M dispatches, `--tree-fold-hot=64`, four arms on **one build**
separated by `--tree-fold-relax=` rather than by commit — same binary, same
arena, same install schedule, so a difference cannot be anything else. `base` is
`partial,flags`, the rule set the section above was measured with.

| program | trees (loop) base → all | handler entries base → all | removed |
|---|---|---|---|
| RUNDEMO | 19 (2) → **25 (4)** | 7,052,573 → 6,732,950 | **−4.53%** |
| DADEMO3 | 29 (16) → **42 (25)** | 7,765,417 → 7,551,951 | **−2.75%** |
| ACCIDENT | 6 (0) → 5 (0) | 15,348,403 → 15,301,153 | −0.31% |
| CYCLE | 0 → 1 (1) | 14,636,552 → 14,636,066 | −0.003% |
| CATWALK | 10 (1) → 12 (1) | 2,071,381 → 2,071,381 | 0.00% |
| B-STEEL | 1 (0) → 3 (1) | 12,945,634 → 12,945,634 | 0.00% |
| BRW | 5 (2) → 6 (3) | 17,767,653 → 17,767,653 | 0.00% |
| DTM2 | 4 (0) → 4 (0) | 4,020,375 → 4,020,375 | 0.00% |
| DHADREN | 0 → 0 | 1,988,405 → 1,988,405 | 0.00% |

Attributed per relaxation, on the two programs that move:

| | RUNDEMO entries | DADEMO3 entries |
|---|---|---|
| base (`partial,flags`) | 7,052,573 | 7,765,417 |
| `+string` | 6,874,397 (−2.53%) | 7,553,637 (−2.73%) |
| `+rep` | 6,874,397 (−0.00%) | 7,553,127 (−0.01%) |
| `+shifts,muldiv` | **6,732,950 (−2.06%)** | 7,551,951 (−0.02%) |

**`string` is most of the win and `rep` is almost none of it**, which is the
opposite of what the work list guessed. The reason is in the same logs: REP
widening already collapses a `rep` to one dispatch however far it runs, so
folding it removes one `$next` trip, while a *non-rep* `stosb` in a loop body is
one dispatch per iteration and blocks the whole body from folding. `shifts` +
`muldiv` are then worth as much again as `string` on RUNDEMO alone — it is a
16-bit renderer whose inner loops are `sh4_r16`/`sh5_r16` shift chains.

The share of dispatches the fold retires, which is the load-independent version
of the same number:

| program | base | all four |
|---|---|---|
| RUNDEMO | 2.66% | **3.95%** |
| DADEMO3 | 1.29% | **1.55%** |
| ACCIDENT | 0.77% | **1.05%** |

ACCIDENT is the interesting row: its tree **count** fell 6 → 5 while its entries
dropped, because one longer run absorbed what had been two.

### What the histogram says now

Every bucket these four relaxations target is **gone**, not smaller. DADEMO3's
`string: stosb32 3933`, `stosd32 3690`, `stosw32 2472` — 10,095 declined sites —
are absent from the after-run, as are RUNDEMO's `rcl/rcr 72`, `shift by CL 42`,
`muldiv: div 40` and its eleven string buckets. What is left at the top:

| | RUNDEMO | DADEMO3 |
|---|---|---|
| 1 | stack 7064 | terminator 5265 |
| 2 | too short 5590 | too short 5056 |
| 3 | terminator 3480 | stack 1812 |
| 4 | segment 2185 | call 1724 |
| 5 | call 1704 | cold block 1401 |
| 6 | alias 865 | alias 708 |
| 7 | ret 799 | io 585 |

`push`/`pop` is now the largest single named barrier, `call`/`ret` behind it, and
`alias` went *up* on both (729 → 865, 664 → 708) because longer runs expose more
load-after-store pairs. Two of the three remaining leaders are control flow,
which is Design B's territory rather than this fold's; `alias` and `stack` are
not.

### Safety

**All 36 frame hashes are identical across all four arms in all nine programs.**

The corpus, `sweep-dos.js --dir=/tmp/demos --dispatches=8m --reps=1
--variants=tailcall` off against `--tree-fold --tree-fold-hot=64`, both arms run
on this build (the pre-rebase baseline was discarded on purpose — main
`e7a7c2e5` changed when interrupts are delivered, so every plain result moved
and a stale diff would have credited that to this fold):

```
191 programs
REGRESSIONS: 0
WENT BLANK: 0
changed (frame and/or dispatches moved, still drawing): 0
recovered: 0
unchanged: 191
```

**Nothing in the corpus moves at all** — a clean sweep, without even the QUARTZ
flake the previous section's run picked up.

The six 80M audio witnesses: every frame matches the plain build exactly
(DADEMO3 `36128ac7`, RUNDEMO `fcf5e9b5`, BLIQ `dbb3c55d`, ACME-BIG `362275f5`,
CONTAGIO `163af616`, CATWALK `19cfa368` — the post-`e7a7c2e5` values), and five
of six wavs match byte for byte. BLIQ's wav differs, and it is **pre-existing
install-schedule sensitivity, not these relaxations**: re-run at the `base`
eligibility it produces the *same* divergent hash (`383ec794`), and
`--tree-fold-batch=1` moves it again (`8a3e5522`) rather than back to plain,
which is what a schedule effect looks like and what a wrong value does not. The
frame is identical in every one of those arms.

## BLIQ's residual divergence: a handback was costing a dispatch

The last witness this fold could not keep byte-identical was BLIQ.EXE, and the
cause was not in this file. `$next` charged its step *before* it tested `$halt`,
so the trip through dispatch that only discovers a slice is over — running no
guest instruction — was billed to the emulated clock. That made the clock count
**handbacks**, and handbacks are a property of the code cache: a guest transfer
costs one dispatch when its edge is linked and two when it is not.

Installing a tree is exactly such a change. `dropWanting` drops the programs
holding a wanting block and recompiles their heads, which loses their traced
edges — so the install moved the clock with nothing in the arena different, the
IRQ dates derived from the clock moved with it, and BLIQ (which reprograms PIT
channel 0 and reads the count back) then ran its timer at a different rate. Its
interrupt count moved, 2979 against 2984, which is what made it look like guest
divergence.

The tell was that restricting the lowering to a single tree reproduced the
divergence **even for a tree that made zero substitutions**. A fold that changes
nothing in the arena cannot change what the guest computes.

The fix is in `emit.js` (`HALT_FIRST`): test `$halt` first, in all four dispatch
shells, so the phantom is free. The regression test is in
`test/test-toyvm-tree-fold.js` and does not use the fold at all — it runs one
program at two slice lengths and requires the same dispatch count out of both.
Full write-up, evidence and the new witness table: *A handback is not a
dispatch* in [toyvm-irq-schedule.md](toyvm-irq-schedule.md).

**All six witnesses are now identical in all three arms** (plain, `--tree-fold
--tree-fold-hot=64`, `--region-jit`), frame and wav.

## `push`/`pop` in the tree

The bucket the previous section's work list named first, and the largest one the
histogram has ever carried: **`stack`**, 7064 declines on RUNDEMO and 3884 on
ACCIDENT over a 20M run. 16-bit code pushes an argument in the middle of the
arithmetic that computes the next one, so a barrier at `push` does not cost one
op — it cuts the run in half.

`--tree-fold-relax=stack` is the seventh relaxation and is on by default with
the others. `--tree-fold` itself stays default **OFF**.

| value | what joins the eligible set |
|---|---|
| `stack` | `push`/`pop` of a register, a memory operand or an immediate, at both widths, plus the 8086 `push sp` form and `pushf`/`popf` |

Three groups stay barriers, and none of them is an oversight:

- **`push ds` / `pop es`** move a segment register and go through `$sset`, which
  can move any segment base. That is the `segment` class wearing a stack op's
  name, and it declines as `segment` would.
- **`pusha`/`popa`/`enter`/`leave`** are eight or more accesses with their own
  SP ordering. Nothing is wrong with them; they are simply not written out.
- **`call`/`ret`** stay barriers permanently. A run ends at a terminator
  whatever it does to the stack.

`popf` is offered and declines on its own: it can hand the block back when it
raises TF (that is how a DOS trace decryptor arms its INT 1), and `escapes()`
catches the `$halt` write.

### What it needed: the stack helpers, inlined

Admitting the opcode is half of it, and it is the half that would have bought
almost nothing on its own. `$push16`/`$pop16`/`$push32`/`$pop32` are on
`trace-jit.js`'s `SAFE_CALLS`, so a body containing one already lowered — but
being on that list **costs SP and the SS base**, because those helpers move SP
and address through SS behind `promoteRegs`' back and the pass bans both for the
whole run. Every one of them writes SP. A run of pushes would have kept SP in a
global and paid a load and a store per op.

So `inlineStack` does for them exactly what `inlineCounters` already did for
`$cxdec`: writes them out as expressions over the globals they touch, which
turns the hidden accesses into text the promotion pass can rewrite. SP becomes a
local for the length of the run, the offsets between the pushes are local
arithmetic, and the register is written back once.

**The stack slots are still written**, in source order, by the same `$wr16` with
the same arguments. This does not elide a store or collapse a matched push/pop
into a register move — the point is removing the *barrier*, not the memory
traffic — so the SS segmentation, the `$spm` wrap and anything a fault would see
are the interpreter's, instruction for instruction.

Two details that are load-bearing:

- **The push forms need a temporary.** `(call $push16 X)` evaluates X *before*
  SP moves, and `push [bp-2]` with BP−2 == SP−2 reads the word the push is about
  to overwrite. Storing first and reading afterwards is a different program, so
  the inline is `(local.set $Lsv X)` then the SP update then the store. The pop
  forms need none: the loaded value stays on the wasm stack across the SP
  update, inside a `(block (result i32) ...)`.
- **The alias rule is not widened to the stack.** A push is a store and its
  matching pop is a load at the same address, so counting stack accesses as
  memory would split every matched pair back apart and leave the relaxation with
  nothing to do. It is sound not to: nothing in this lowering *moves* memory —
  every pass in `emitTier2`/`emitTier3` rewrites one op's body in place and the
  bodies are concatenated in source order — so every `$rd*`/`$wr*` runs exactly
  where the interpreter runs it. (Measured both ways: widening the rule turned
  2713 recovered `stack` declines on ACCIDENT into 793 more `too short` and 389
  more `alias`, for no correctness the lowering did not already have.)

The inline is **opt-in** (`passes.stack`), asked for only by `buildTree`. A
region built by `region-jit.js` lowers through the same function and is
byte-for-byte the region it was before this existed.

### Before and after, 20M with the hot gate

`--dispatches=20m --pit-clock --auto-key --sound-pref=sb
--env=ULTRASND=220,1,1,11,7 --tree-fold --tree-fold-hot=64`, once with
`--tree-fold-relax=partial,flags,string,rep,shifts,muldiv` (the five that were
already on) and once with the default set, which adds `stack`:

| program | frame | trees off/on | loop trees off/on | substitutions off/on | guest ops off/on | `stack` declines off/on |
|---|---|---|---|---|---|---|
| BRW | ecef58f7 | 6 / 6 | 3 / 3 | 13 / 13 | 66 / 66 | 698 / **47** |
| ACCIDENT | 90ddad9a | 5 / 5 | 0 / 0 | 4 / 4 | 50 / 50 | 3628 / **915** |
| DHADREN | aa293234 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 1441 / **365** |
| B-STEEL | 8e8c9dc5 | 3 / **4** | 1 / 1 | 6 / 6 | 28 / 26 | 615 / **189** |
| DTM2 | 38c165c5 | 4 / **5** | 0 / 0 | 4 / **10** | 22 / **74** | 441 / **187** |
| CYCLE | 38c165c5 | 1 / 1 | 1 / 1 | 1 / 1 | 3 / 3 | 771 / **268** |
| RUNDEMO | 08502c5c | 25 / **42** | 4 / **6** | 46 / **62** | 245 / **331** | 7064 / **2985** |
| DADEMO3 | 88b5bd0e | 42 / **54** | 25 / 25 | 214 / **229** | 1153 / **1202** | 1812 / **65** |
| CATWALK | 9af00ca9 | 12 / 11 | 1 / 1 | 20 / 18 | 100 / **111** | 1488 / **583** |

**The frame is identical on all nine.**

Two things this table says that are worth separating. The `stack` bucket falls by
59-96% everywhere — the barrier really is gone. But the *gated* fold only builds
trees for blocks the run entered 64 times or more, and on four of the nine that
hot set produces the same trees it did before: the recovered runs are in cold
code. Where the hot blocks do push, the effect is large — RUNDEMO **+68% trees**
(25 → 42, and two more loop trees), DTM2 **+236% guest ops**, DADEMO3 **+29%
trees**. CATWALK loses a tree and gains eleven guest ops, which is one longer
run replacing two short ones.

The ungated population is the other way round: on ACCIDENT the relaxation
recovers 2713 declines outright, and every one of them is a run in a block the
gate refuses.

### Handler entries removed

The static counts above say what was *built*. What ran is the `--handler-hist`
total, 20M dispatches, `--tree-fold-min-payoff=0` on both arms so this measures
the relaxation and not the payoff gate that arrived with it:

| program | handler entries, `stack` off | on | removed |
|---|---|---|---|
| RUNDEMO | 6,712,708 | 6,724,481 | **−11,773 (−0.18%)** |
| DADEMO3 | 7,546,096 | 7,455,919 | 90,177 (1.20%) |
| DTM2 | 4,016,554 | 3,874,218 | 142,336 (3.54%) |
| B-STEEL | 12,870,217 | 12,855,279 | 14,938 (0.12%) |

RUNDEMO is the one to explain, because it is the program the static table likes
most — 25 trees to 42 — and it comes out 0.18% *worse*. Seventeen extra trees in
a program is not seventeen extra folds on the hot path; the new ones land beside
existing fusions and traces, and displacing a fused pair with a tree that covers
the same ops trades one dispatch for one dispatch. At this size that is noise
either way, and the honest reading is that `stack`'s value on RUNDEMO is
structural rather than immediate: it is what takes its batch over the payoff
threshold at all. With the shipping policy (`--tree-fold-min-payoff=0.01`) the
`stack`-off arm projects under 1% and builds **nothing** — 7,699,380 entries —
so end to end the relaxation is worth **−12.66%** there. Two true numbers about
two different questions; the like-for-like one is in the table.

### Corpus and witnesses

`sweep-dos.js --dir=/tmp/demos --dispatches=8m --reps=1 --variants=tailcall`,
off against `--tree-fold --tree-fold-hot=64`, through `sweep-diff.js`:
**191 programs, 0 regressions, 0 went blank, 0 changed, 0 bucket moves.**

The six 80M witnesses, three arms each, are in the table at the end of *What the
gate costs* below.

## What the gate costs, and where it was actually going

The A/B in [tree-fold-ab-2026-09.md](tree-fold-ab-2026-09.md) left the gated
fold in an odd shape: BRW **−10%**, and RUNDEMO, DADEMO3, CATWALK, DTM2 and
CYCLE each **+0.05..0.08s**. The same absolute charge on programs whose run
times span 3.5x is not a proportional cost, it is a fixed one, and the obvious
suspect was the profile window — `--block-hits` is a load/add/store per dispatch
and the window is ten million of them.

**It is not the profiler.** `--block-hits` alone, for a whole 20M-dispatch run,
against nothing at all, user+sys CPU, min of three interleaved reps:

| program | off | `--block-hits` | delta |
|---|---|---|---|
| DTM2 | 1.54 | 1.54 | 0.00 |
| CYCLE | 1.76 | 1.78 | +0.02 |
| BRW | 2.25 | 2.16 | −0.09 |

Free, twice the distance the window runs. The earlier "22% on BRW" in
`needsInstall`'s comment was never measured this way and is withdrawn.

What the gate actually charges is **wasm module builds**. One module is ~1700
handlers, and the gated fold was doing two or three of them on every run:

| program | before | after |
|---|---|---|
| DTM2 | 3 installs, 1490ms building, 29 handlers, 9 substitutions | 1 install, 5 handlers, 10 substitutions |
| BRW | 2 installs, 1186ms building, 6 handlers, 13 substitutions | 1 install, 6 handlers, 13 substitutions |

Three changes, in the order they matter.

**1. The drop does not need a module.** The window's verdict is published by
throwing away the programs holding a hot block so they recompile and re-nominate
their current runs — a *cache* operation. It was being reached through
`install()`, because the profiler-removal build was the thing that called
`dropWanting()`, which made the fixed charge two builds: one to take the
profiler out, one to carry the trees. Dropping at the window close instead, and
waiting `--tree-fold-settle=` (100k dispatches) for the stragglers, lets the
profiler removal and the trees ride the **same** build. Byte-identical results
on both programs above — BRW keeps all 13 substitutions and its frame — for half
the builds. DTM2 gets *better* results as well as cheaper ones, because a single
late install carries only runs that are current.

**2. Nothing is built for a batch that is not worth a module.** The gate's hit
count says a block is entered often; it says nothing about how much a handler
over it would remove, and the two come apart by a factor of seven. Projecting
`entries * (ops − 1)` over the promoted batch, against what the run then removed:

| program | projected, as a share of the window | measured, as a share of the run |
|---|---|---|
| BRW | 16.03% | 4.56% |
| RUNDEMO | 5.84% | 3.97% |
| DADEMO3 | 1.67% | 1.90% |
| DTM2 | 0.94% | 0.64% |
| CATWALK | 0.04% | 0.04% |
| ACCIDENT | 0.01% | 1.04% |
| CYCLE | 0.00% | 0.00% |

`--tree-fold-min-payoff` (default **0.01**) refuses the build below 1% of the
window. The projection is a lower bound for a loop tree, whose iterations are
invisible to `entries * (ops − 1)`, and ACCIDENT is exactly that case: 1% of its
dispatches removed by a fold the projection scores at 0.01%. Cutting it trades a
1% dispatch removal for a module build, which is the better side at these sizes
— but it is the first case to look at if the threshold is ever suspected.

**3. The refusal happens before the drop**, not after the build, because a
recompile storm is not free either: DTM2's drop is 258 blocks.

Together, on the same statistic as the first table (user+sys CPU, fixed 20M
dispatches, min of three interleaved reps):

| program | gate before | gate after |
|---|---|---|
| DTM2 | +0.80 | **+0.08** |
| CYCLE | +0.78 | **+0.08** |
| BRW | +0.79 | +0.75 (one build, and the program the fold is for) |

The residual 5% on the two refusing programs is the eligibility analysis at
compile time, which is the gate's irreducible cost — it is what decides there is
nothing to fold.

BRW's row is worth reading carefully, because it is measuring something the A/B
does not. This is *total process CPU*, so it charges the module build in full:
one build on a box at load 48 is 0.6-0.75s, against the ~0.10s that removing
4.56% of a 2.1s run is worth. At 20M dispatches BRW's build is not repaid by
BRW's fold; the −10% in the A/B is the guest loop, over a longer run, on a
quieter box. Both numbers are true and they are answers to different questions:
*is the fold faster* and *does the fold pay for itself at this run length*. What
these three changes fix is the case where there was no first number at all.

### The early-close window, and why it is off

`--tree-fold-quiet=N` samples the window every `--tree-fold-probe=` dispatches
and closes it as soon as its answer — candidates nominated, candidates over the
threshold, paragraphs ever compiled — has held still for N. It is implemented,
it works, and it is **off by default**, for two measured reasons.

The profiler is free (above), so there is nothing at the end of the window to
save. And closing early is not cheap: candidate discovery is spread across the
whole window. `--tree-fold-window-trace` on BRW:

```
window probe at  250339: 10/6/29
window probe at 1526738: 62/7/237
window probe at 2373699: 64/12/241
window probe at 3397397: 74/12/265
window probe at 6691788: 76/12/273
window probe at 7259693: 99/13/383
```

A **3.3M-dispatch lull** in the middle. At `quietFor = 1M` BRW's window shut at
1.27M and it built six handlers that substituted **nothing**, against 13
substitutions over the full distance. A rule wide enough to survive that lull
closes DTM2 at 5.75M: three quarters of the window, for none of the saving.

The flag stays because the timeline it prints is the evidence for this
paragraph.

### The same A/B again, after the three changes

`tools/fold-ab.js --target=toyvm --work=20m --reps=12 --arm-on='--tree-fold
--tree-fold-hot=64'`, the identical protocol
[tree-fold-ab-2026-09.md](tree-fold-ab-2026-09.md) prescribes: three interleaved
arms (`off`, `on`, and a second `off` labelled `null`) with the order rotated per
rep, fixed work of exactly 20M dispatches, guest CPU seconds. Loadavg was
**30.2–33.5** for every rep of every program, so the paired `2 × sd(null−off)`
rule calls all twelve rows unresolvable, exactly as it did before. The **MIN**
is the statistic that survives that load — interference can only add CPU — and
`null−off` on the min is its own noise floor.

Seconds. Positive is a LOSS.

| program | on−off min, before | **on−off min, after** | null−off min, after | what the gate does now at 20M |
|---|---|---|---|---|
| BRW | −0.051 | **−0.124** | +0.006 | 1 install, 33 handlers, 198 subs, 3.08M trips projected |
| DTM2 | +0.081 | **+0.003** | −0.005 | refused: 94,455 trips, under 0.01 of the window |
| CATWALK | +0.047 | **+0.037** | +0.003 | 1 install, 4 handlers, 4 subs |
| RUNDEMO | +0.061 | **+0.038** | −0.002 | 1 install, 18 handlers, 42 subs |
| DADEMO3 | +0.049 | **+0.046** | +0.019 | 1 install, 54 handlers, 229 subs |
| CYCLE | +0.070 | **+0.058** | −0.001 | refused: 310 trips |

Every row improved and none regressed; BRW's gain more than doubled, and DTM2 —
the program that used to pay 0.081s for four trees it entered **zero** times —
is at parity now that its window refuses to build at all.

Two rows say the story is not finished. **CYCLE** also refuses, builds nothing,
and still shows +0.058 on the min against a null of −0.001; **DTM2** refuses in
exactly the same way and shows +0.003. Two programs running identical host
policy cannot differ by 0.055s because of that policy, so at least one of those
two numbers is the box and not the feature — which is what a paired sd of 0.05
to 0.09 at loadavg 30 already says. **CATWALK** and **DADEMO3** do build, do
substitute, and are the honest residual: a module's build time spent for a yield
that (four substitutions on CATWALK) is not there.

So the flip condition — all six at or above parity on the min, with BRW keeping
its gain — is **not** met, and `--tree-fold` stays OFF. What changed is that the
gap is now 0.04-0.06s on four programs instead of 0.05-0.08s on five, the
mechanism behind it is named (module builds, not the profiler), and one of the
two knobs that closes it (`--tree-fold-min-payoff`) demonstrably works where its
projection is honest.

### Nothing the guest can see

The whole of this section is host-side policy — when to build a module, and
whether to build one at all — so the guest must come out the same. It does.

`sweep-dos.js --dispatches=8m --reps=1 --variants=tailcall` off against
`--tree-fold --tree-fold-hot=64`: **191 programs, 0 regressions, 0 went blank,
0 changed.**

The six witnesses at 80M with `--pit-clock --auto-key --sound-pref=sb
--env=ULTRASND=220,1,1,11,7`, FNV-1a over the wav bytes, three arms each:

| witness | frame | wav plain | wav `--tree-fold --tree-fold-hot=64` | wav `--region-jit` |
|---|---|---|---|---|
| DADEMO3 | 36128ac7 | 55358cf2 | **55358cf2** | **55358cf2** |
| RUNDEMO | fcf5e9b5 | 9b51195e | **9b51195e** | **9b51195e** |
| BLIQ | 3243b8e3 | e2a1b6b5 | **e2a1b6b5** | **e2a1b6b5** |
| ACME-BIG | 362275f5 | 27904a23 | **27904a23** | **27904a23** |
| CONTAGIO | 163af616 | bb5cf796 | **bb5cf796** | **bb5cf796** |
| CATWALK | 19cfa368 | 1031f0ce | **1031f0ce** | **1031f0ce** |

BLIQ included — see *BLIQ's residual divergence* above for why that row is the
one worth checking twice.

## Leaf-call inlining (Design B, in miniature)

`call` and `ret` were the two largest *named* declines left after `push`/`pop`
(6478 + 2858 over the nine programs), so this round makes the smallest version
of Design B that can be argued to be safe: when a block ends in a near `call`
with a static target, and the callee is a **single block** ending in one `ret`
or `ret imm16`, the caller's ops and the callee's ops are compiled as one tree
and the call site disappears.

**Every architectural stack store stays.** The call's return-address push and
the `ret`'s pop are the push/pop tree micro-ops from round 6, so SP, SS and the
bytes at `[SS:SP]` are exactly what the interpreter would have written at every
point inside the inlined body. Nothing about a frame is elided. That is what
makes a fault, an interrupt due date or a slice cut landing anywhere in the
callee indistinguishable from the unfolded run — the tree can be abandoned
mid-body and the machine is already in a state the interpreter could have
produced.

Three parts, one in each file:

- **`compile.js`** runs the fold as a **pre-pass**, before the loop and
  straight-line passes. It has to: once the callee's arena words have been
  overwritten with a tree ordinal they are no longer the ops the pre-pass needs
  to read. It checks the caller's last op is `call_rel`/`call_rel32`, resolves
  `args[1]` through `ipIndex` to a block *in this program*, requires that
  block's last op to match `/^ret(_imm)?(32)?$/` and to fit `maxCallOps`, and
  then requires `eligibleRuns(..., allowFault: false)` to return exactly **one**
  run covering caller-ops-minus-the-call concatenated with
  callee-ops-minus-the-`ret`. Anything else declines, with a named bucket.
- **`tree-fold.js`**'s `buildCallTree` hands that op list to `buildRegion` with
  a doctored `nexts` array — the call's successor is the callee's first IP, the
  last op's successor is the return IP — and `closed = false`. `buildRegion`
  already lowers `call_rel` through `splitJump` (keeping the push and the
  `$rpush`) and `ret` through `splitExit` (keeping the pop, the `$rpop` and the
  `$gip` publish), so the assembly is the whole of it.
- **`region-jit.js`** grew `ret_imm`/`ret_imm32` in `isTransfer`. `chainFrom`
  never walks through one, so until this fold no profiled region had ever
  contained a `ret imm16`, and the trailing `GO` would have been emitted
  verbatim.

### The one thing that needed care: the shadow stack

`$rpush(ip, arena)` **returns early when `arena == 0`** — it skips the entry
entirely. The obvious implementation bakes the call's `arenaRet` operand into
the tree as a constant, and that constant is **always zero at fold time**:
`compile.js` resolves arena fixups *after* the tree pass. So the inlined `ret`'s
`$rpop` would miss on a frame that was never pushed, set `rtop = 0`, and quietly
flatten the shadow stack for the rest of the run. `buildCallTree` therefore
patches the one `$rpush` the lowering emits to **load the arena word live**,
`(i32.load offset=K (global.get $ip))`, and declines outright if that call is
absent, duplicated, or preceded by a write to `$ip`.

### SMC: the callee's bytes are now the caller's bytes

A tree is invalidated by a write into the run it was built from. An inlined
callee makes a *second, disjoint* byte range load-bearing for the caller's tree,
and nothing knew that. Two changes: `compile.js` records every inlined callee's
range on `prog.treeInlined`, and `dos-loop.js` (a) refuses the fast in-place
operand repair for any store that reaches one of those ranges, and (b) clears
the plan cache when a program carrying one is registered. Without either, a
program that rewrites an immediate inside a leaf keeps executing the immediate
the tree was built from. `test/test-toyvm-tree-fold.js`'s `callsmc` is exactly
that program.

### What it reaches: almost nothing, and the histogram says why

Nine programs at `--dispatches=20m --auto-key --tree-fold --tree-fold-hot=64`:

| program | trees | subs (ops) | call sites inlined | callee ops |
|---|---:|---:|---:|---:|
| BRW | 33 | 198 (1109) | **0** | 0 |
| DADEMO3 | 54 | 229 (1202) | **0** | 0 |
| RUNDEMO | 18 | 42 (226) | **0** | 0 |
| CATWALK | 4 | 4 (20) | **0** | 0 |
| B-STEEL | 6 | 8 (38) | **2** | 8 |
| ACCIDENT | 0 | 0 | 0 | 0 |
| DHADREN | 0 | 0 | 0 | 0 |
| CYCLE | 0 | 0 | 0 | 0 |
| DTM2 | 0 | 0 | 0 | 0 |

(The last four install nothing at all at this budget with the gate on; CYCLE and
DTM2 are still on a blank mode 3 at 20M.)

**Two call sites in one of nine programs.** The `call`/`ret` decline rows are
unchanged by this work and were never going to change — those record a
straight-line *run* ending at a transfer, which is a different mechanism from
the block-level pre-pass. The evidence is the new `call:` buckets, 3303
refusals against 2 acceptances:

| refusal | count | what it means |
|---|---:|---|
| `call: body breaks at out` | 1172 | the **caller** writes a VGA/DAC port right before the call |
| `call: callee ends <op>, not ret` | 2008 | the callee is **more than one block** |
| `call: body breaks at <op>` (rest) | 113 | caller+callee is not one run for some other reason |
| `call: callee is not a block in this program` | 10 | the target is in another program image |

The two headline numbers are the finding. `callee ends …, not ret` (2008) is
the multi-block callee — real Design B, not this — and its largest *followable*
sub-bucket, a callee ending in an unconditional `jmp` (103), is 5% of it; the
rest end in a conditional branch, another `call`, or an `int`. `body breaks at
out` (1172) is a demo-corpus signature rather than a general one: this code
reprograms a VGA register and immediately calls something, and `out` is
deliberately outside the fold because host I/O quantization is its own
investigation.

So the round's honest verdict is: **the single-block leaf callee does not occur
in this corpus at a rate worth a fold.** The machinery is correct, it is
committed with tests, it costs nothing when it does not fire, and it is the
right first step only if the follow-up — a callee that is a *chain* of blocks
joined by unconditional `jmp`/fall-through, then one that branches — is
actually taken. `--no-tree-fold-calls` is the A/B; `--tree-fold-max-call-ops`
(32) and `--tree-fold-call-budget` (2000) are the caps.

## Ranking by projected savings, and validating it

Round 6's `--tree-fold-min-payoff` projected `entries x (ops - 1)` — the
*dispatches* a tree removes. That undercounts a loop tree and a call tree, both
of which also remove a **block transfer**, and `tools/bench-loops.js` prices a
block transfer at ~9ns against ~8ns for a dispatch, so a transfer is worth
slightly more than the dispatch it comes with. The projection is now

    savings = entries x ((ops - 1) + transfers)

with `transfers` = 0 for a straight-line tree, 1 for a loop tree (the
self-branch) and 2 for a call tree (the call and the `ret`).

### Validating it: a second, disjoint window

`--tree-fold-stats` measures what the projection was worth. After the install
settles (`--tree-fold-stats-skip`, 250k dispatches), it counts each tree's real
entries over a fresh window (`--tree-fold-stats=N`, 5M) and reports projected
against actual in **savings per million dispatches**, plus top-k precision and
the number of trees that were projected and then never entered at all:

| program | projected /Mdisp | actual /Mdisp | ratio | top-k precision | dead trees |
|---|---:|---:|---:|---:|---:|
| BRW | 343353 | 454594 | **x1.32** | 70% (k=10) | 10 |
| B-STEEL | 287236 | 39922 | x0.14 | 100% (k=6) | 0 |
| CATWALK | 27406 | 342 | x0.01 | 100% (k=4) | 2 |
| DADEMO3 | 19876 | 43916 | **x2.21** | 40% (k=10) | 0 |
| RUNDEMO | 27936 | 26908 | **x0.96** | 60% (k=10) | 16 |

The model is within 1.4x on the two programs where the fold is worth the most
(BRW 34% of all dispatches removed, RUNDEMO 2.7%) and wrong by two orders of
magnitude on CATWALK, which folds four trees in a scene that then ends. That is
the shape of the error everywhere: **the projection is a good estimate of a
tree's rate and a poor estimate of its lifetime.** BRW's own per-tree rows say
it plainly — its top projected tree (`#2 loop`, 100963/Mdisp) is entered *zero*
times after the install, while `#15` was projected at 47550 and delivered
183192.

### Should the default rise to 0.03?

`--tree-fold-min-payoff` refuses a module whose projected savings are under that
fraction of the window's dispatches. The measured question is whether 0.03
separates yield from no-yield better than 0.01 does. It does not:

| program | projected (fraction) | actual (fraction) | admitted at 0.01 | admitted at 0.03 |
|---|---:|---:|:--:|:--:|
| BRW | 0.343 | 0.455 | yes | yes |
| B-STEEL | 0.287 | 0.040 | yes | yes |
| RUNDEMO | 0.028 | 0.027 | yes | **no** |
| CATWALK | 0.027 | 0.0003 | yes | **no** |
| DADEMO3 | 0.020 | 0.044 | yes | **no** |

Raising the bar to 0.03 buys one avoided dud (CATWALK, 0.03% actual) and costs
**two real winners** — DADEMO3, whose actual 4.4% is larger than B-STEEL's 4.0%
and which 0.03 would reject while admitting B-STEEL, and RUNDEMO at 2.7%. The
projection under-shoots exactly where it matters (x2.21 on DADEMO3), so a
higher bar is applied to the number that is least trustworthy on the downside.
**The default stays 0.01.**

### Nothing the guest can see

- **Corpus**, `sweep-dos.js --dir=/tmp/demos --dispatches=8m --reps=1
  --variants=tailcall`, off against `--tree-fold --tree-fold-hot=64`, through
  `sweep-diff.js`: **191 programs, 191 unchanged.** 0 regressions, 0 went
  blank, 0 changed, 0 bucket moves.
- **Six 80M witnesses**, `--pit-clock --auto-key --sound-pref=sb
  --env=ULTRASND=220,1,1,11,7 --audio=FILE`, in **three** arms — plain,
  `--tree-fold --tree-fold-hot=64`, and `--region-jit`:

| witness | frame (all three arms) | wav |
|---|---|---|
| DADEMO3 | 36128ac7 | identical across all three |
| RUNDEMO | fcf5e9b5 | identical across all three |
| BLIQ | 3243b8e3 | identical across all three |
| ACME-BIG | 362275f5 | identical across all three |
| CONTAGIO | 163af616 | identical across all three |
| CATWALK | 19cfa368 | identical across all three |

Every frame matches its recorded baseline, and every wav is byte-identical in
all three arms — including the three (BLIQ, CONTAGIO, CATWALK) that were
grid-movers in earlier rounds. **The wav hashes themselves no longer match the
ones recorded with those baselines**, and that is not this change: the `plain`
arm runs none of this code (`repairProg`'s `treeInlined` check is a null test on
a program that has none, and `isTransfer` is only reached from the JIT), yet it
produces the same bytes as the other two. Whatever moved the wav baseline moved
it for the interpreter, before this round; the three-arm identity is the safety
statement, and it is the strong one.

### Tests

Six cases in `test/test-toyvm-tree-fold.js`, each laying its callee inside the
loop body so the caller block, the callee block and the return landing are all
in one program: `leafcall` (a two-op leaf called from a hot loop), `retimm`
(`ret 2` against a `push dx`, which is what catches an SP drift of two per
trip), `callfault` (a `div` in the callee — never inlined, because
`allowFault: false` ends the run at it), `callint` (an `int` in the callee — the
named negative), and `callsmc` (the caller rewrites the callee's immediate every
trip). Each inlining case additionally runs a `--no-tree-fold-calls` arm, so the
screen agreement is attributable, and an `--irq-every=997` pair, so an interrupt
falling due at a different point inside the callee on nearly every trip has to
leave the same registers, SP and memory as the interpreter would.

## What is next

The decline histogram is the work list, and the three relaxations it points at,
in the order the corpus argues for them. **Two of the three are now implemented**
— see *DOS-tailored: partial registers and flags as values* above — and are
described here as they were originally argued for. Two further items that were
not on this list are also in: the terminator now folds for a self-loop block
(*Folding the terminator*), and the fold stacks on `--region-jit` (*One
allocator for the handler table's tail*). The string group that the terminator
work left at the top of the histogram — `movsb`/`lodsw`/`stosb`/`rep`, ahead of
`out`/`in`, CL shifts and `div` — **is now in too**, along with the shifts and
`div`; see *String instructions, CL shifts and div in the tree* above. The guess
recorded here that the string group was "not expression-tree material at all"
and belonged to `rep`-widening turned out to be right about `rep` and wrong
about the rest: `rep` inside a tree is worth ~0.01% because widening already
collapses it to one dispatch, while the *non-rep* string ops were worth −2.5% on
their own. The two mechanisms do not compete so much as stack.

What that left at the top of the histogram was **`push`/`pop`**, `call`/`ret`,
`segment`, and `alias`. **`push`/`pop` is now in** — see *`push`/`pop` in the
tree* above. **`call`/`ret` has now been attempted** in its smallest safe form
and measured to reach almost nothing — see *Leaf-call inlining (Design B, in
miniature)* above, where the refusal histogram says the corpus's callees are
multi-block (2008) or sit behind a caller that just wrote a VGA port (1172).
Widening it means a callee that is a chain of blocks, then one that branches,
which is Design B proper. `out`/`in` remain deliberately out of scope: host I/O
quantization is a separate investigation.

### The histogram after `stack`

Summed over the nine 20M runs in the table above, with every relaxation on:

| bucket | declines |
|---|---|
| too short (<4 ops) | 25706 |
| terminator | 18773 |
| call | 6478 |
| stack (the three groups left out) | 5604 |
| alias | 5031 |
| segment | 4442 |
| cold block (outside the hot set) | 3999 |
| io | 2915 |
| ret | 2858 |
| cold (<64 entries) | 1860 |
| int | 564 |
| unsupported: nop | 552 |
| unsupported: xchg | 516 |

`too short` and `terminator` are now the whole top of the list, and neither is a
new relaxation: `too short` is what `MIN_OPS` refuses and shrinks whenever
anything else joins two runs, and `terminator` is Design B's territory except
for the self-loop case already folded. Of the rest, `call`+`ret` (9336) is the
single biggest remaining number and is control flow; `alias` (item 1 below) is
the biggest that is *not*. `xchg` and `nop` are now the two `unsupported` entries
worth a line of lowering each.

**1. Alias disjointness.** Today every load after a store in the same run is
assumed to alias, and the run ends there. Most of those pairs are provably
disjoint at compile time — two absolute addresses, two displacements off the
same base register with different constants, a stack slot against a data
segment. Each of those is a decision the compiler can already make from the
operand words it has in hand, and each one that holds joins two runs into one.

**2. Partial registers as insert/extract.** An 8-bit write inside a 16-bit run
is not unmodellable, it is unmodelled: AL is bits 0-7 of the promoted AX local
and an 8-bit write is a mask-and-or on it. `partial-reg` is one of the two
largest buckets in every program measured, so this is the biggest single number
in the histogram — and it is also the one most likely to introduce a wrong
answer, because it is the only relaxation that changes what a *value* means
rather than merely what may be joined.

**3. Flags as values.** The fold refuses any op that reads flags, so a `cmp` in
the middle of a run, an `adc` chain, and a shift by CL all end it. Inside a
generated handler there is no reason for the flag state to live in globals at
all: it could be locals, computed where a reader needs it and materialized only
on the way out. That subsumes the `flag consumer` bucket and, more importantly,
is what would let the terminator's own `cmp` join the run.

Beyond the three: the fold is **static**. It generates a handler for any block
whose shape qualifies, hot or cold, which is why ACCIDENT generates 167 trees
and 437KB of WAT to remove 1.8% of its dispatches while BRW generates 96 and
186KB to remove 16.8%. A hotness gate — fold only a block the run has actually
entered often — would cut the module size and the build time by most of that,
and the block-hit census (`--block-hits`) is already the signal.
