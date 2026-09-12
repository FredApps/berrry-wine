# TREE_FOLD — the first real decode-time expression fold (Design A)

Status: **implemented, OFF by default, gated behind `--tree-fold`.**
Handler **454** (`$th_tree_fold`), matcher `$loop_try_tree_fold` in
`src/07b-loop-match.wat`.

This is the family the census in
[int-expr-fusion-census.md](int-expr-fusion-census.md) said *not* to build yet.
It was built anyway, to find out what the census could not measure: how much a
whole-block integer fold is worth when it fires, and how often it fires on real
code. Both answers are below, and they point in opposite directions.

---

## 1. What folds

One **self-loop basic block** whose interior is entirely full-width 32-bit
integer dataflow. The predicate is exact — every clause is a check on the ops
the decoder actually emitted, never a guess:

* **Terminator** is the last two ops: a flag producer (`dec r`, `inc r`,
  `cmp r,r`, `cmp r,imm32`) immediately followed by a `Jcc` (handlers 307..322)
  whose *taken* target is this block's own entry EIP. Anything else declines.
* **Interior** is every other op, each of which must classify as one of 22
  micro-op kinds: `mov r,r` / `mov r,imm` / `lea r,[r+d]` /
  `add|sub|and|or|xor r,r` and `r,imm` / `inc` / `dec` / `neg` / `not` /
  `shl|shr|sar|rol|ror r,imm|cl` / `imul r,r` / `imul r,r,imm` /
  `load32 r,[r+d]` / `store32 [r+d],r`.
* **At least `--tree-fold-min-ops` interior ops** (default 4) and at most
  `--tree-fold-max-ops` (default 160, a structural limit rather than a
  throughput one — §11).

Everything the task's scope list rules out is ruled out *by construction*,
because the classifier works from handler indices and the decoder emits a
**different handler** for each of those cases:

| forbidden | why it cannot slip through |
|---|---|
| partial-register write (`mov al,[esi]`, 16-bit ALU) | 8/16-bit forms are separate handlers (H154, H28/29, the `_r8`/`_r16` family); none is in the classifier's accept list |
| interior flag consumer | `adc`/`sbb`/`setcc`/`jcc` are their own handlers and are not accepted |
| a store followed by an aliasing load | see §3 — the hazard is vacuous here, not permitted |
| non-32-bit memory | only `load32`/`store32` handlers classify |

## 2. Not three hand-written shapes — one parameterized interpreter

The task asked for two or three census shapes as parameterized super-ops. What
is implemented is the generalization of that: **one** handler that reads a
descriptor, so the three census shapes are three parameter values rather than
three handlers. The WAT interpreter cannot generate code at runtime, so the win
is never "compiled arithmetic"; it is

1. the eight guest registers held in **wasm locals** for the whole run instead
   of read/written through `$get_reg`/`$set_reg` per op,
2. one `$next` dispatch for the whole loop instead of one per op, and
3. one block entry for the whole run instead of one per iteration.

A per-shape handler would win (1) and (2) equally and (3) identically. It would
only additionally win the micro-op decode, which is two loads and a `br_table`
over locals. That is not worth three times the code and three times the
correctness surface, and it would have to be re-done for the fourth shape.

**Descriptor layout**, emitted by `$te 454 0` and then raw words:

```
+0   nuops          interior micro-op count
+4   live_out       bitmask of the 8 registers the body defines
+8   term_kind      0 = dec/inc r, 1 = cmp r,r, 2 = cmp r,imm
+12  term_a         register index of the counter / left cmp operand
+16  term_b         register index or immediate, per term_kind
+20  term_cc        condition code (Jcc handler - 307)
+24  term_uop       1 = inc, 0 = dec  (term_kind 0 only)
+28  fall           EIP if the branch is not taken
+32  back           EIP if it is (== the block's own entry)
+36  cost           guest ops one iteration stands for (nuops + 2)
+40  nuops * 5 words: (kind, d, a, imm, fn)
```

`fn` is the original handler index, re-recorded per micro-op when
`$handler_hist_enabled` — so a `--handler-hist` total stays comparable between a
`--tree-fold` run and a plain one, exactly as H420-424 do it.

## 3. The two rules the fusion bench named

**Per-FIELD flag last-writer.** The lazy-flag globals are five independent
fields and the `$set_flags_*` helpers write *different subsets* of them
(`$set_flags_logic` writes op+res only; `$set_flags_shift` adds flag_b;
add/sub write all four; inc/dec snapshot `saved_cf` first). The fold does not
optimize flags at all: **every micro-op calls the same helper its scalar
handler would have called, in source order.** The join is therefore exact at
every instant — including mid-loop, including a side exit — for free, and the
`$eval_cc` at the terminator reads the same globals the scalar `Jcc` would
have. Shadowing the flag fields in locals and publishing them once is the
obvious next optimization and is deliberately *not* done in v1.

**Live-out materialization at exit AND side exit.** The exit block publishes
the `live_out` mask over the eight register globals, and it is reached on both
paths — the terminator falling through, and the budget running out mid-run.
Entry materialization reads all eight unconditionally (cheaper than a live-in
mask, and it cannot be wrong about a register the descriptor forgot to name).

**Aliasing.** The fold keeps memory ops in strict source order and routes every
one through `$gl32`/`$gs32`, so a store followed by a possibly-aliasing load
observes the store exactly as the unfolded loop would. The hazard is therefore
vacuous rather than a decline — which is what keeps the most interesting shape
(the in-place transform chain, `tree_chain` in the bench and shape C in the
test) inside the family instead of outside it. `$gs32` is also what carries SMC
invalidation and page-crossing, identically to the scalar path.

## 4. Billing

An unfolded run of N iterations spends `N * cost` `$steps` and
`1 + (N-1) + 1` `$block_budget` (entry, N-1 back-edges, one exit transfer).
`$next` has already charged 1 step for the H454 dispatch and `$run` has already
charged the entry block, and `$branch_end` charges the exit transfer, so the
handler charges the remainder:

```
steps        -= iters * cost - 1
block_budget -= iters - 1
```

and the trip count is bounded *before* the loop by
`min(ceil(steps/cost), block_budget)`, floored at 1 (a do-while runs its body
once even with the budget already spent, exactly as the block would have). The
batch clock therefore keeps its meaning: a folded loop advances guest time at
the same rate as the unfolded one.

## 5. Side exit

When the trip bound is reached with the branch still taken, the handler
publishes live-outs, bills what it spent and sets `$eip` to `back` — the
block's own entry. The run resumes by re-entering the same descriptor with the
guest state fully materialized, which is exactly "the loop was interrupted
between two iterations", because it was. There is no partial state anywhere; a
condition the body cannot handle is not guessed at.

## 6. Gates

| gate | result |
|---|---|
| `bash tools/build.sh` | green (handler table 449; every ratchet, region and layout gate passed) |
| `test/test-tree-fold.js` (new) | pass — 10 blocks matched, 101 super-op runs, 1572 guest iterations, 15616 guest ops |
| `tools/check-test-manifest.sh` | OK (934 files, all accounted for) |
| `test/test-worker-wasm-globals.js` | pass — 22 setters, `set_tree_fold` inherited by both Worker backends |
| quake2_demo 20000 batches, flag on vs off, `--png` | **0 of 307200 pixels differ**, max channel delta 0 |
| caesar3_demo 20000 batches, flag on vs off, `--png` | **0 of 307200 pixels differ**, max channel delta 0 |

`test/test-tree-fold.js` runs each shape twice — once with the gate off, once
with it on at a *different* guest address so neither arm reuses the other's
decoded block — and demands identical registers, identical CF/ZF/SF/OF/PF and
identical memory. It also asserts the predicate accepted the block in **both**
arms, which is what proves the off arm declined to *emit* rather than failing to
*recognize*. Plus: a side-exit case (tiny `run()` budget vs one large one must
agree), a pacing case (`iters` and `ops` must equal the unfolded counts), the
min-ops knob, and three negatives that must not fold — a partial-register write
(`mov al,[esi]`), an `adc` (interior flag consumer), and a body under the floor.

## 7. Bench (`tools/bench-loops.js --toggle=tree_fold`)

Three new shapes, one per census shape. 4 MB working set, 7 interleaved reps,
order rotated per rep, both arms in one process.

**Box was at load 41.** So the load-independent column is the one to read.

| shape | blocks/iter off → on | ops/iter off → on | min time | paired median |
|---|---|---|---|---|
| `tree_span` (quake2 span interleave) | 1.00 → **0.01** | 11.00 → 9.01 | +33.7% | +40.5% |
| `tree_dot` (load/imul/add/sar/store) | 1.00 → **0.01** | 9.00 → 7.01 | +48.6% | +44.7% |
| `tree_chain` (in-place chain, cmp/jb) | 1.00 → **0.01** | 8.00 → 6.01 | +40.8% | +39.7% |

Null control, same session, same shapes, `--toggle=rect_run` (which cannot fire
on any of them — ops/iter and blocks/iter identical in both arms, as printed):
minima **-22.0% / -1.9% / -0.3%**, paired medians **+9.9% / +12.7% / +8.8%**.
That is the instrument reading at this load, and it is large: the `-22%` on
`tree_span` is pure noise on a shape where nothing changed. TREE_FOLD's +34..49%
clears it, and `blocks/iter` collapsing from 1.00 to 0.01 — a count, not a time
— is the part that is not a measurement at all.

`ops/iter` falls by 2 in every arm because the fold retires the terminator's
`cmp`/`dec` and `Jcc` without re-recording them; the interior ops are
re-recorded, so the remainder is the unfolded-equivalent count (the harness
prints the `H454 live` note for exactly this).

## 8. What share it actually catches — the honest half (v1, before the widenings)

> Superseded by §9. Kept because it is the measurement that motivated the three
> relaxations, and because its decline split is the before-column of §9's table.

**quake2_demo, 20000 batches, `--handler-hist` total 92,436,920 retired ops:**

| setting | blocks matched | super-op runs | guest ops caught | share |
|---|---|---|---|---|
| default (`min-ops=4`) | 1 | 1 | 150 | **0.00016%** |
| `--tree-fold-min-ops=2` | 1071 | 1078 | 41,269 | **0.045%** |

Per CLAUDE.md's rule — never quote a microbench % as an app %: **+40% x 0.045%
is nothing.** The fold is worth what the bench says on the code it covers, and
on quake2 it covers essentially none of the code that runs.

The decline split says why (quake2, default floor, 2613 self-loops seen):

| reason | count | share |
|---|---|---|
| fewer than `min_ops` interior ops | 1280 | 49% |
| an interior op is not a foldable micro-op | 1132 | 43% |
| terminator is not `dec`/`cmp` + `Jcc` back to the head | 201 | 8% |
| more than 24 interior ops | 0 | 0% |

And the second row is the real barrier: dropping the floor to 2 converts almost
all of the first row into matches (1280 → 10) while the unfoldable-op count
*rises* to 1322 — the short loops that now qualify still hit it — and buys
0.045% of ops. The hot self-loops in `ref_soft.dll` are byte and word code
(`H154 $th_alu_r8_i8` 3.07%, `H28/H29` load8/store8 6.15%, `H402` `mov byte
[sib],imm8` 3.74%), and every one of those is a partial-register write the
family excludes on purpose.

**caesar3_demo is a harder zero, and for a structural reason rather than a
window one.** At 42,050 batches (75,212 API calls, well past the intro) it had
decoded **32 self-loop blocks in the entire run** and matched none:
`short 1, terminator 26, unfoldable-op 5`. Caesar's hot drawing code is the RLE
token ladder at `0x40f71c` — a *nest* of ~20 blocks reached through a compare
ladder, already covered by `rect_run`/H424 — and a nest is not a self-loop, so
Design A never sees it at all. Its equivalence check is real (pixel-identical
with the flag on) but there is nothing here for this family to catch, at any
floor.

## 9. The three widenings, measured (2026-09)

Relaxations 1-3 of the old §9 list are implemented, each behind the same
`--tree-fold` flag, in the order (a) memory forms, (b) partial registers,
(c) per-field flag shadowing.

### The command, and the trap in it

```
node test/run.js --app=quake2_demo --args='+set vid_ref soft +map demo1' \
  --no-threads --quiet-api --batch-size=20000 --max-batches=3000 \
  --tree-fold --loopmatch-stats --handler-hist --handler-hist-thread=0
```

**`--args` must be pinned, and this is not optional.** `lib/apps.js` gives
`quake2_demo` `persistFiles: ['c:\\baseq2\\config.cfg']`, so the renderer
choice survives across runs *and across processes*. Another agent's
`+set vid_ref soft` run silently rewrote the persisted value mid-session and
moved this one from `ref_gl` to `ref_soft`, changing the retired-op total from
263M to 328M with no source change involved — an hour went into bisecting a
regression that was a shared config file. The §8 numbers above were taken
without the pin and are not reproducible as written; every number below is
`ref_soft`, which is also where the coverage is.

caesar3 is `--app=caesar3_demo --batch-size=20000 --max-batches=3600`.

### Before/after

| stage | commit | q2 blocks matched | q2 ops caught / retired | share | declines short/long/term/unfoldable-op | c3 blocks | frame identical | bench span/dot/chain |
|---|---|---|---|---|---|---|---|---|
| rebased v1 | `6a26a17e` | 454 | 1,701,563 / 329,082,451 | 0.517% | 16116 / 3799 / 36337 / **32484** | 0 | — | — |
| + (a) memory forms | `2025bd74` | 548 | 2,130,462 / 328,987,768 | 0.648% | 16116 / 3799 / 36335 / **32395** | 0 | yes (0/76800) | — |
| + (b) partial regs | `7e2af37d` | **32,882** | 10,404,993 / 328,041,132 | **3.17%** | 16120 / 3798 / 36340 / **54** | 0 | yes (0/76800) | +23.7 / +29.9 / +33.1% |
| + (c) flag fields | `ea398be8` | 32,882 | 10,404,993 / 328,041,132 | 3.17% | 16120 / 3798 / 36340 / 54 | 0 | yes (0/307200) | +22.9 / +31.3 / +33.2% |

Whole-app A/B, `--tree-fold` off vs on at `ea398be8`, fixed work
(`--max-batches=3000`), 8 interleaved reps with the arm order rotated, **user
CPU** (the box sat at load 17-21, so wall clock is unquotable): off 16.50s, on
16.39s — **1.007x, paired sd 1.65s.** That is indistinguishable from zero at
this load, and it is also exactly what the two honest numbers predict:
3.17% of retired ops x ~25% on the covered shapes ~= 0.8%. The app-level
measurement and the microbench agree; neither of them says this is worth
turning on by default.

### What each one actually did

- **(a) memory forms** — absolute (`[addr]`) and SIB (`[base+index*scale+disp]`)
  loads and stores inside the tree, evaluated in source order through the same
  `$g2w`/`$gl*`/`$gs*` path as the per-op handlers, so the fault and SMC
  semantics are the per-op ones by construction. Worth +94 blocks and 0.13
  percentage points. It was cheap and it was *not* the barrier.
- **(b) partial registers** — a sub-register is a lane of the 32-bit container
  local: container index `r & 3` for a byte (AH..BH alias AL..BL's container),
  `r & 7` for a word, with `mask` and shift decoded unconditionally from the
  `b` word. This is the one that mattered: `unfoldable-op` collapses from
  32,395 to **54** and matched blocks go 548 → 32,882, a 60x. §8's diagnosis
  was right — the hot `ref_soft` self-loops are byte code, and excluding
  partial writes excluded essentially all of them.
- **(c) per-field flag shadowing** — a backward decode-time pass marks a
  `$set_flags_*` call dead when every field it writes is overwritten before any
  reader, seeded from the terminator's own write set. It elides **163,575** flag
  writes across 32,882 lowerings (~5.0 per block) and is behaviour-identical
  (same retired-op total, same coverage, same frame). It bought **nothing
  measurable**: the bench moved within its own ±1% floor on two of three shapes.
  The old §9's claim that these calls were "the largest remaining per-iteration
  cost" is not supported by measurement, and that is the finding.

### What still declines most, at `ea398be8`

| reason | count | share of 56,312 self-loops |
|---|---|---|
| terminator is not `dec`/`cmp` + `Jcc` back to the head | 36,340 | 64.5% |
| fewer than `min_ops` interior ops | 16,120 | 28.6% |
| more than 24 interior ops | 3,798 | 6.7% |
| an interior op is not a foldable micro-op | 54 | **0.1%** |

The op vocabulary is finished. What is left is control flow — two thirds of
declines are a terminator shape the family does not model — plus a long tail of
loops too short to be worth a super-op and 6.7% that are too long for the
24-uop arena. Widening the terminator is the next Design A move; the bodies
themselves are no longer the problem.

**caesar3 is a structural zero at every stage.** 3600 batches / 329M retired
ops decode **32 self-loop blocks in the whole run**
(`short 5, terminator 26, unfoldable-op 1`) and match none. Its hot drawing
code is the RLE token *nest* at `0x40f71c`, already covered by H424/`rect_run`,
and a nest reached through a compare ladder is not a self-loop. No amount of
Design A widening reaches it; that is Design B's territory, along with the
corpus-wide `call` / `multi-branch` declines that are 58% of
`match-loops.js --why`.

**Recommendation: keep the flag off.** It is correct, paced, tested,
pixel-identical and now catches 3.17% of a real app's ops instead of 0.00016%
— but 3.17% x 25% is under a percent, and one app's software renderer is not a
corpus.

## 9b. mw3, and what a 45%-coverage app says about the design

§9 ended with "one app's software renderer is not a corpus". mw3 is the second
app, and it is the one the loop census picked out as the case where self-loops
dominate: 84% foldable, 98% of that in two blocks (`0x526f54`, `0x527075`), a
42-op 16-bit software alpha blend.

Getting it to fold took three fixes, and the reason it took three is worth more
than the fixes: **each barrier hid the next.** The whole ~9850-decline
population walks from class to class, which is what identifies it as the same
two blocks throughout.

| stage | blocks folded | where the blend declined |
|---|---|---|
| cap 24, as shipped | 6 | `long 9847` |
| cap 64 | 6 | `terminator 9881` |
| + terminator suffix | 7 | `unfoldable-op 9861`, lastFn 166 |
| + 16-bit memory (`45735fb0`) | **5207** | `unfoldable-op 5041`, lastFn 149 |

So raising the cap on its own bought **nothing**. The blend's next objection was
its terminator: it ends `dec edi / mov [esp+8],edx / mov [esp+c],edi / jnz`,
and the matcher wanted the flag producer at exactly `n-2`. The fix walks back
from the Jcc over micro-ops that neither write nor read a flag field and
records where the terminator runs as `$term_pos`; the suffix keeps its original
position relative to the counter, which matters because mw3's second store
stores the register the `dec` just wrote. Then it objected to H166
`mov r16,[base+disp]` — widening (a) did 32-bit memory and (b) did partial
registers in *register* form, and nobody had done 16-bit memory.

### Coverage, three apps, at the new cap

All `--no-threads --quiet-api --tree-fold --loopmatch-stats --handler-hist
--handler-hist-thread=0`. mw3 `--batch-size=200000 --max-batches=50`; quake2
`--args='+set vid_ref soft +map demo1' --batch-size=20000 --max-batches=3000`;
heroes2 `--batch-size=20000 --max-batches=2600` (the §10.1 window from
[loop-idiom-superops-design.md](loop-idiom-superops-design.md)).

| app | blocks | runs | ops caught / retired | share | `$next` dispatches removed | declines short/long/term/uop |
|---|---|---|---|---|---|---|
| **mw3** | 5207 | 115,287 | 116,240,046 / 258,573,003 | **45.0%** | 116,124,759 (**43.9%**) | 71 / 0 / 21 / 5041 |
| quake2 soft | 33,040 | 48,340 | 10,596,862 / 328,014,262 | 3.23% | 10,548,522 (3.22%) | 16120 / 53 / 37054 / 2927 |
| heroes2 | 4 | 3 | 373 / 105,438,520 | **0.00035%** | 370 | 124 / 0 / 10 / 4 |

Dispatches removed is `ops caught − runs`, because the super-op is one dispatch
per *run*, not per iteration. heroes2 is the negative control and behaves like
one: 124 of its 138 declining self-loops are under the four-op floor, so its
loops are too short to be worth a super-op at all.

### The A/B, and why it cannot be quoted as a win or a loss

mw3, fixed work (`--max-batches=50`), 8 interleaved reps with the arm order
rotated, user CPU. Box drifted from load 16 to 38 across the run.

| statistic | off | on | verdict |
|---|---|---|---|
| mean user CPU | 71.06s | 73.87s | **+3.95% slower** |
| paired mean delta | — | +2.81s (sd 6.51, SE 2.30) | **t = 1.22, not significant** |
| minimum user CPU | 62.81s | 60.27s | **−4.04% faster** |
| retired ops | 264,585,738 | 258,573,003 | on does 2.3% *less* work |
| frame at batch 50 | — | — | identical, 0 / 307200 |

**The mean and the minimum disagree in sign on the same 16 runs.** That is the
whole result: this is not a measurement, it is the box. The first two pairs read
+12.7% and +18.4% and looked like a clean regression; reps 3-8 read −9.5%,
−4.0%, +3.2%, +1.4%, +1.9%. Anyone quoting either end of that is quoting load.
Note also that the ON arm retires 2.3% fewer ops for its CPU, so a like-for-like
per-op figure is ~2% worse than whatever the wall figures say.

What this does establish: at 45% coverage and 44% of dispatches removed, the
effect on a real app is **still inside the noise floor of a loaded box.** The
microbench's +23..33% was measured on 6-to-11-op bodies, where the saving is one
block transfer (~9ns) spread over a handful of ops. mw3's body is 42 ops, so the
same one-transfer saving is spread 4-7x thinner while the generic walker's
per-micro-op cost is paid 42 times. That is a prediction the design makes, and
it is why §9c stops guessing the cap and measures it.

## 9c. Interior flag consumers: a capability with no corpus

The family's founding licence was "nothing inside the tree looks at the flags
the ops leave behind", which is why `adc` declined. That licence was stronger
than it needed to be. The tree keeps the lazy-flag **globals** current wherever
a reader exists — the dead-flag pass elides a write only when no later op reads
the fields it wrote — so an interior consumer can call the same `$get_cf` the
scalar handler calls and get the same answer. ADC/SBB are now micro-op kinds
(32-bit `H5/H6/H14/H15`) and the sub-register ALU accepts sub-ops 2 and 3.

Two things make this safe rather than merely plausible:

* `$tree_uop_flag_reads` reports the consumer's CF read, so every earlier write
  it can observe stays live. This is the *only* thing between a folded tree and
  a wrong answer, and the mutation test is to make ADC report no read: shape K
  then diverges in `edx`, the accumulator.
* `$tree_uop_flag_writes` reports **zero** writes for ADC/SBB, which makes them
  permanently inelidable. Their CF fix-up writes `flag_op`/`flag_a`/`flag_b`
  outside `$do_alu_sized`, so a no-flags variant would have to replicate it.
  Under-reporting a write set can only keep an earlier write alive that could
  have gone — conservative in the safe direction.

**Measured effect on the corpus: none.** mw3 and quake2 are byte-identical
before and after — same blocks, same ops caught, same declines:

| app | blocks before → after | ops caught before → after |
|---|---|---|
| mw3 | 5207 → 5207 | 116,240,046 → 116,240,046 |
| quake2 soft | 33,040 → 33,040 | 10,596,862 → 10,596,862 |

Not one block in either window contains an interior `adc`. The residual
barriers are elsewhere and are named by `lastFn`: quake2's is **H83
`$th_rep_movsd`**, a REP string op that is an entire loop inside one handler
and is not a micro-op in any useful sense; mw3's is **H149
`$th_compute_ea_sib`**, which computes an EA into `ea_temp` for the *next*
handler to consume — a cross-op dataflow the tree's one-op-at-a-time model does
not represent. Neither is a flag problem.

So this is a capability the family now has and the corpus does not ask for. It
cost nothing to carry and it removes a stated limitation, but anyone looking for
the next percentage point should look at H149's two-op EA pairing, not here.

## 10. Flags

```
--tree-fold                 arm the family (default off)
--tree-fold-min-ops=N       interior-op floor (default 4)
--tree-fold-max-ops=N       interior-op ceiling (default 160; see §11)
--loopmatch-stats           prints matches / runs / iters / ops / deadflag and the decline split
node tools/bench-loops.js --shapes=tree_span,tree_dot,tree_chain --toggle=tree_fold
```

`set_tree_fold` is in `INHERITED_WASM_GLOBALS`, so every guest-thread instance
gets the same setting, cooperative and real-Worker alike.

## 11. The body-length ceiling, measured (2026-09)

Both earlier caps were guesses about throughput. 24 was "past this the run
length stops being the thing that pays"; 64 was "mw3's blend is 42 ops, make it
fit". Neither was measured. `tools/bench-loops.js` now measures it: one shape
at nine lengths, so nothing but the body varies — `mov eax,[esi]`, then N-4
serially dependent `add eax,ebx`, then a store and two cursor bumps.

| interior ops | fold=1 min | fold=0 min | paired median | blocks/iter on→off |
|---|---|---|---|---|
| 8   | 169.2ms | 339.9ms | **+50.0%** | 0.01 → 1.00 |
| 16  | 247.9ms | 477.6ms | **+50.4%** | 0.02 → 1.00 |
| 24  | 291.2ms | 519.8ms | **+37.4%** | 0.03 → 1.00 |
| 32  | 231.5ms | 358.4ms | **+37.6%** | 0.03 → 1.00 |
| 48  | 474.5ms | 689.3ms | **+37.9%** | 0.05 → 1.00 |
| 64  | 410.7ms | 711.9ms | **+42.8%** | 0.06 → 1.00 |
| 96  | 841.2ms | 1624.9ms | **+37.6%** | 0.09 → 1.00 |
| 128 | 1238.0ms | 2116.7ms | **+33.3%** | 0.13 → 1.00 |
| 160 | 1191.6ms | 1931.0ms | **+35.2%** | 0.14 → 1.00 |

**There is no crossover.** The fold leads at every length tested and the lead
does not trend towards zero — 50% at 8 ops, 33-43% from 64 to 160. So the
question the cap was supposed to answer ("where does the generic walker stop
beating per-op?") has no answer inside the range a descriptor can physically
hold: body length was never the variable.

That leaves only structure, and two structures bound it. `$decode_block`
reserves 4096 bytes of slack past `$thread_alloc`; the descriptor is a 44-byte
header plus 24 bytes per micro-op, so `(4096 - 44) / 24 = 168`. The classify
scratch is the far half of `OP_INDEX`, 1024 words at 6 words per micro-op =
170. `$TREE_FOLD_UOPS_LIMIT` is the smaller of the two and the setter clamps to
it, because a descriptor past either one **corrupts rather than declines**. The
default is 160, the longest length actually measured, inside both limits.

### The null control, and what it says about every percentage on this page

`tree_mem16/32/96` were written as the honest worst case: a memory interior
(`mov eax,[esi]` / `add [edi],eax`), where both arms pay `$g2w` and a real
load and store and only the dispatch is left to win. They turned out to be
something more useful — a **null control**, because the fold declines them
outright. H127, the read-modify-write ALU-to-memory form, is not a foldable
micro-op, and the two arms ran byte-identical code: identical handler
censuses, `1.00 blocks/iter` on both sides, `+0.0% block entries`.

Two arms of identical code should differ by 0%. They differed by:

| shape | wall minima | paired median |
|---|---|---|
| tree_mem16 | **-35.4%** | -14.1% |
| tree_mem32 | +3.5% | +7.8% |
| tree_mem96 | +27.3% | +8.2% |

So the ±1% noise floor this harness is documented to have **did not hold for
this session** — the box was at load 45 with several agent sweeps running, and
the floor was nearer ±15% on the paired median and ±35% on the minima. Every
percentage in the table above carries that error bar. What survives it is not
the magnitude but two things that are not timings: the **sign is consistent
across nine lengths and two independent runs** (32 and 64 were measured twice,
+37.6/+30.7 and +42.8/+37.6), and `blocks/iter` — a deterministic count —
falls by 86-99% exactly where the fold fires and by 0% where it does not.

Read the null control before quoting any figure here. It is also the reason
the mw3 app-level A/B in §9b cannot be called a regression: a mean of +3.95%
against a null control that swings ±14% is not a measurement of anything.

H127 is a free finding from the same run: RMW-to-memory is a real widening
candidate, and it is the shape a `for (i) dst[i] += src[i]` loop compiles to.

### Flag

```
--tree-fold-max-ops=N       interior-op ceiling (default 160, clamped to 168)
```

It exists to A/B a *shorter* cap — "what are this app's long bodies actually
contributing?" — since the default is no longer a guess that needs relaxing.
Both thresholds now propagate through `inheritWasm`, so a `--threads` arm is
not silently folding by a different rule in its worker instances.

### mw3 re-measured at the default cap, with a null arm in the same run

§9b's "+3.95% mean slower, minimum 4.04% faster, t=1.22" is superseded. The
re-run has three arms instead of two, rotating every rep, fixed work
(`--app=mw3 --batch-size=200000 --max-batches=50 --no-threads --quiet-api`),
user CPU:

* **off** — no fold
* **cap24** — `--tree-fold --tree-fold-max-ops=24`: every short body still
  folds, the 42-op blend declines as `long`. Measured, this leaves **17 blocks
  and 51,246 folded ops** against the default's **5,207 / 116,240,046** — 0.02%
  of retired ops, so against `off` it is a **null pair inside the same run**,
  and its spread is a live noise reading taken under the same load as the real
  comparison.
* **on** — the default cap, 160: the blend folds (identical census to the old
  64: 5,207 blocks, 116,240,046 ops, `long 0`).

| rep | off | cap24 | on |
|---|---|---|---|
| 1 | 76.72 | 72.92 | 69.97 |
| 2 | 67.17 | 68.90 | 66.76 |
| 3 | 68.91 | 63.52 | 70.56 |
| 4 | 64.13 | 61.46 | 62.96 |
| 5 | 59.83 | 65.04 | 60.48 |
| 6 | 59.41 | 58.66 | 59.87 |
| **mean** | **66.03s** | **65.08s** | **65.10s** |

| pair | paired mean | sd | SE | t |
|---|---|---|---|---|
| on − off (45% of ops fold) | **−0.93s (−1.4%)** | 3.01 | 1.23 | −0.76 |
| cap24 − off (**null**, 0.02% of ops fold) | −0.61s (−0.9%) | 3.92 | 1.60 | −0.38 |

**The null pair is noisier than the real one.** Two arms that differ in 0.02%
of the work swing ±3.9s run to run; the arm that folds 45% of all retired ops
differs from `off` by 0.93s. So the fold's app-level effect on mw3 is smaller
than what this box can resolve — and that is now demonstrated inside the
measurement rather than argued about afterwards. It is **not** a regression:
the sign is now negative (faster) and it was positive last time, which is the
signature of noise, not of a change.

Read the raw column too: `off` drifts 76.72 → 59.41 monotonically across six
reps as the box unloads. That drift is 29%, more than an order of magnitude
larger than any effect being looked for, and it is the entire reason the arms
rotate. Loadavg over the run: 191 at the start, 108 by the second sample.

## 12. Three more widenings, and what each was worth (2026-09-11)

Three barriers were taken down in order: the H149 effective-address pair, REP
MOVS/STOS, and one terminator shape. Two of the three bought nothing
measurable. That is the finding, and this section is written to make it hard
to read otherwise.

### The windows, and the denominator

Every number below is from one command per app, all with `--no-threads
--quiet-api --no-build --loopmatch-stats --handler-hist
--handler-hist-thread=0`:

| app | window |
|---|---|
| mw3 | `--app=mw3 --batch-size=200000 --max-batches=50` |
| quake2 | `--app=quake2_demo --args='+set vid_ref soft +map demo1' --batch-size=20000 --max-batches=3000` |
| heroes2 | `--app=heroes2_demo --batch-size=20000 --max-batches=2600` |
| caesar3 | `--app=caesar3_demo --batch-size=20000 --max-batches=3600` |

**The denominator is the FOLD-OFF retired-op total, not the fold-on one.** H454
re-records the handler index of every interior micro-op but not of the
terminator or the Jcc, so an armed run's `[handler-hist] total` is short by two
ops per folded iteration — 264,438,340 against 252,355,242 on mw3, a 4.6% gap
that is pure accounting. Dividing by the armed total would inflate every share
on this page. The fold-off total is identical on the `main` build and on this
branch's tip for all four apps, so it is also a stable denominator.

**`--args` is pinned for quake2 on purpose**: its `config.cfg` persists across
processes, so a run without it measures whatever the previous run left behind.

### Coverage, per app, per commit

`ops` is `TREE_FOLD ... ops` from `--loopmatch-stats`; `share` is that over the
fold-off retired total; `declines` is `short / long / terminator / unfoldable-op`.

| app | commit | blocks | ops caught | share | declines | lastFn |
|---|---|---|---|---|---|---|
| mw3 | main `ff44490d` | 6 | 116,422,492 | **44.03%** | 15 / 0 / 4 / 5 | 149 |
| mw3 | H149 pair `54997cbc` | 7 | 247,968,049 | **93.77%** | 15 / 0 / 4 / 4 | 83 |
| mw3 | REP `9b24da19` | 7 | 247,968,049 | **93.77%** | 15 / 0 / 4 / 4 | 408 |
| mw3 | mem bound `7fd5b9ea` | 8 | 248,218,929 | **93.87%** | 15 / 0 / 3 / 4 | 408 |
| quake2 | main | 55 | 9,372,997 | **3.13%** | 51 / 0 / 262 / 13 | 190 |
| quake2 | H149 pair | 55 | 9,236,701 | **3.09%** | 51 / 0 / 262 / 13 | 190 |
| quake2 | REP | 55 | 9,236,701 | **3.09%** | 51 / 0 / 262 / 13 | 190 |
| quake2 | mem bound | 55 | 9,236,701 | **3.09%** | 51 / 0 / 262 / 13 | 190 |
| heroes2 | main → mem bound | 4 | 373 | **0.0003%** | 11 / 0 / 4 / 4 | 155 |
| caesar3 | main → mem bound | 0 | 0 | **0%** | 3 / 0 / 1 / 1 | 133 |

Fold-off retired totals: mw3 264,438,340 · quake2 299,375,553 · heroes2
126,324,744 · caesar3 281,817,744.

So, item by item:

* **The H149 pair is the whole story.** mw3 44.03% → 93.77% — its hottest
  loops address memory through a SIB, and every one of them was declining on
  the one emitted op that is not an instruction.
* **REP MOVS/STOS bought zero on all four apps.** It removed a decline class
  (mw3's `lastFn` moved 83 → 408) without folding a single new block: the one
  mw3 block it unblocks then declines on `$th_load32_base_run`, a run-fusion
  super-op from a different family. It is kept because it is correct, tested,
  and cheap, not because it paid.
* **The memory bound is worth 0.10% of mw3 and nothing elsewhere.** +250,880
  ops, which is exactly 35,840 block entries × the block's 7 ops — the
  arithmetic closes, which is the point of quoting it that small.

**Correction to commit `9b24da19`'s message.** It claims quake2 was unchanged
by the H149 pair and that `54997cbc`'s 9,372,997 was a `config.cfg` artifact.
Rebuilt at `ff44490d` and measured with `--args` pinned, quake2 really does go
9,372,997 → 9,236,701 across that commit: runs rise 34,942 → 42,819 while
iterations fall 575,050 → 559,906, i.e. the block count is unchanged but a
short-trip, often-entered loop displaced a long-trip one. A **1.5% loss** on
quake2 against a **2.1x gain** on mw3.

### The `terminator` bucket was never the lever it looked like

`terminator 262` on quake2 is 64% of that app's declines and was the headline
reason to open this bucket. The count is the wrong unit twice over: it counts
DECODE EVENTS, so a re-decoded block appears once per decode, and it weights
every block equally, so a loop entered once weighs what a loop entered 32,705
times does.

The matcher now emits its own verdict per declined block under
`--trace-loopmatch` (marker `0x100C0001`: entry, reason, detail; the six
reasons are enumerated at `$tree_decl_term_bump`), and
`tools/loopmatch-decode.js --tree-why --hot=HOT` joins those to the run's
`--hot-block-dump`. For a DECLINED block a hot-block hit is one loop
*iteration*, so that weighting is directly comparable to retired-op share —
unlike the folded case `tools/tree-shape-census.js` has to caveat.

| app | decline events | distinct blocks | block entries | share of entries |
|---|---|---|---|---|
| quake2 | 262 | **15** | 83,170 | **0.14%** |
| mw3 | 4 | **3** | 35,875 | **0.89%** |
| heroes2 | 4 | **4** | 172 | **0.00%** |

And what is actually in them:

| app | block | entries | the op that stopped the walk | verdict |
|---|---|---|---|---|
| quake2 | 13 blocks incl. `0x004129b0`, `0x00412a34` | 32,705 each for the top two, 83,134 total | `$th_fpu_mem`, `$th_fpu_mem_ro`, `$th_fpu_reg` | **x87 — out of family at any width** |
| quake2 | 2 blocks | 36 | `$th_alu_r8_i8` | a byte ALU between counter and Jcc |
| mw3 | `0x0042d9b1` | 35,840 | `$th_alu_r_m32_ro` (CMP form) | **implemented** — term_kind 3 |
| mw3 | `0x018118aa` | 35 | `$th_test_r8_r8` | TEST + Jcc, 0.001% |
| mw3 | `0x018372dd` | 0 | `$th_test_r_i32` | never entered |
| heroes2 | `0x004c4472` | 127 | `$th_mov_m16_r16` | a 16-bit SIB store, 0.0005% |
| heroes2 | 3 blocks | 45 | `$th_nop`, `$th_alu_r_m32`, `$th_test_r_i32` | noise |

None of the shapes the bucket was expected to hold — `loop`, `jecxz`, a `jmp`
back with the branch elsewhere, two exits — occurs even once. Every one of the
22 distinct declined blocks across three apps IS a real self-loop with a single
back edge ending in an ordinary `Jcc`; what stopped them was the op standing
between the counter and the branch, which is reason 3 in the new enumeration
and not a terminator *shape* at all.

So exactly one shape was worth building: `cmp r32,[base+disp] + Jcc`, 89% of
mw3's bucket by weight. `test` + `Jcc` is the next one and it is worth 0.001%;
it is left undone on that evidence, not on difficulty.

### The A/B, with a null arm in the same run

Fixed WORK (`--app=mw3 --batch-size=200000 --max-batches=50 --no-threads
--quiet-api`), **user CPU**, three arms in one build, order rotated every rep,
as §11 did. The null arm is `--tree-fold --tree-fold-max-ops=24`: measured, it
folds **302,210 ops, 0.11% of retired**, against the default cap's 93.87%. So
`cap24 − off` is a pair that differs in a tenth of a percent of the work, and
its spread is a live noise reading taken under the same load as the real
comparison.

Six reps, 18 runs, `/usr/bin/time -p` user CPU:

| rep | order | off | cap24 (null) | on |
|---|---|---|---|---|
| 1 | off,cap24,on | 58.98 | 56.04 | 52.98 |
| 2 | cap24,on,off | 45.10 | 66.21 | 59.84 |
| 3 | on,off,cap24 | 59.78 | 66.46 | 53.82 |
| 4 | off,cap24,on | 66.57 | 66.33 | 64.29 |
| 5 | cap24,on,off | 63.06 | 67.16 | 54.00 |
| 6 | on,off,cap24 | 67.31 | 67.53 | 56.21 |
| **mean** | | **60.13s** | **64.95s** | **56.86s** |

| pair | paired mean | sd | SE | t |
|---|---|---|---|---|
| `on − off` | **−3.28s (−5.4%)** | 9.33 | 3.81 | **−0.86** |
| `cap24 − off` (**null**) | **+4.82s (+8.0%)** | 8.68 | 3.54 | **+1.36** |

Loadavg over the run: 3.4 min, 6.3 max, 5.3 mean.

**The null arm moved further than the real one, and with a larger |t|.** Two
builds that differ in 0.11% of the folded work separated by 8.0%; the build
that folds 93.87% separated by 5.4% in the other direction. Neither |t| clears
2 at 5 degrees of freedom. So the honest statement is: **this box, at this
load, cannot resolve the effect of TREE_FOLD on mw3 user CPU at all**, and the
−5.4% must not be quoted as a speedup. Anything under roughly ±10% is inside
the noise floor of a paired six-rep run here.

Read the `off` column on its own: 58.98, 45.10, 59.78, 66.57, 63.06, 67.31 for
one identical command. A 49% spread between its own best and worst run, against
the 5% being looked for. Rotating the arms is what keeps that drift from
landing entirely on one of them; it does not make the drift small enough to see
through.

What the coverage table *can* say without a timer is unaffected: the H149 pair
took mw3 from folding 44% of its retired ops to 93.87%, and the fold is
behaviour-identical (mw3 `--png` at batch 50, fold off vs on: 0 of 307,200
pixels differ; quake2's census is byte-identical). Whether 93.87% coverage is
worth wall-clock or CPU on this hardware is a question for a quiet box.


## 13. x87 inside an integer tree (2026-09-12)

§12 ended with one line in the decline table that was not a shape problem:

> | quake2 | 13 blocks incl. `0x004129b0`, `0x00412a34` | 32,705 each for the top two, 83,134 total | `$th_fpu_mem`, `$th_fpu_mem_ro`, `$th_fpu_reg` | **x87 — out of family at any width** |

"Out of family at any width" was wrong, and the reason it was wrong is worth
stating plainly, because it is the same mistake in both directions.

**Those thirteen blocks are not x87 loops.** They are ordinary integer
address-stepping loops with two or three x87 instructions in the middle. Both
fold families refused them, each for a reason that is true and neither of which
is the whole picture:

- TREE_FOLD declined because H188/H189/H190 are not integer dataflow.
- The x87 semantic families (H449–453) declined because the integer ops
  *between* the x87 ops break the contiguity their fusers require.

So nobody folded them, and the interpreter paid a full `$next` plus `get_reg` /
`set_reg` traffic for the **integer** half of a body it was already going to run
op by op for the x87 half. The barrier removed here is an integer barrier that
happened to be standing next to an x87 instruction.

### What the corpus actually contains

Census first, implement in population order. Command per app: the §12 window,
plus `--trace-loopmatch --hot-block-dump=`, read back with the new
`tools/loopmatch-decode.js --x87-census --hot=FILE` — which classifies each
distinct self-loop shape as MIXED (integer + x87) or x87-only and weights every
x87 op by hot-block entries, so the ranking is iterations and not decode events.

| app | self-loop shapes | containing x87 | MIXED | x87-only | block entries in mixed loops |
|---|---|---|---|---|---|
| quake2 soft | 47 | **10** | **10** | 0 | **82,625** |
| mw3 | 20 | 0 | 0 | 0 | 0 |
| heroes2 | 19 | 0 | 0 | 0 | 0 |
| heaven7 | 4 | 0 | 0 | 0 | 0 |
| blobby_volley | 13 | 0 | 0 | 0 | 0 |
| elasto_mania | 26 | 0 | 0 | 0 | 0 |

**Quake2 is the entire population, and every one of its x87 self-loops is
mixed — not one is x87-only.** That is a finding about scope, not a
disappointment: it says this widening is aimed at exactly one app in the
corpus, and it says the *other* family (H449–453) has no self-loop territory
here at all.

Inside quake2, by block entries:

| x87 op | form | sites | entries |
|---|---|---|---|
| `fadd m32 [r+d]` | H190 | 8 | 78,730 |
| `fstp m32` | H188 | 5 | 78,097 |
| `fld m32` | H188 | 3 | 77,007 |
| `fsub m32 [r+d]` | H190 | 3 | 77,007 |
| `fmul st,st(1)` | H189 | 2 | 36,490 |
| `fmul m32 [r+d]` | H190 | 2 | 32,821 |
| `fmul m32` | H188 | 2 | 12,247 |
| `fld m32 [r+d]` | H190 | 7 | 5,519 |
| `fld st(0)` / `faddp` / `fstp st(0)` | H189 | 1 each | 3,785 each |
| `fstp m32 [r+d]` | H190 | 6 | 1,794 |
| `fxch st(1)` | H189 | 4 | 1,607 |
| `fild m32 [r+d]` | H190 | 2 | 655 |
| `fsub st,st(1)`, `fld st(1)` | H189 | 1 each | 506 each |
| `fmul m64`, `fsubrp st(1),st` | H188 / H189 | 1 each | 11 each |

Eighteen distinct instructions across three handler indices. That count is the
design: **enumerating x87 mnemonics is the wrong axis.** The right one is the
three handlers, because each already has one canonical semantic helper behind
it.

### The implementation, in one sentence

Four micro-op kinds — `TU_X87_MEM` (50), `TU_X87_MRO` (51), `TU_X87_REG` (52),
`TU_X87_SW_AX` (53) — each of which calls **exactly the helper its scalar
handler calls**: `$fpu_exec_mem(group, reg, addr)` for H188/H190 and
`$fpu_exec_reg(group, reg, rm)` for H189, with the same nibbles the decoder
produced and the same address.

Nothing about x87 is reimplemented, so the x87 stack, the tag word, the raw
64-bit shadows, the C1 stack-overflow bit and every sticky exception bit in
`$fpu_sw` are produced by the interpreter's own code in source order. That is
not a convenience; it is why the widening is small enough to trust. Preserving
sticky status "exactly" is true **by construction** here, and a design that
re-derived any of it would have to earn the same claim by testing.

Three fields ride in the `b` word above every bit the integer kinds use: group
at 16–19, reg at 20–23, rm at 24–27.

**ST(0) is deliberately not cached in a wasm local across consecutive x87 ops.**
It was the obvious next step and it is the wrong one: it would have to
reproduce `$fpu_set`/`$fpu_get`'s tag and raw-shadow bookkeeping, FXCH's
payload move, and the C1 bit at every push. The moment any of that is
approximated this family stops being "the interpreter's own code" and becomes a
second x87 implementation — for a saving of a few f64 loads against a call that
already does real floating-point work. The corpus agrees the guard could not be
dropped anyway: `fxch` appears at four sites in quake2's mixed loops.

### Coverage, before and after

Same windows as §12, same denominator rule — **the FOLD-OFF retired-op total**,
because an armed run's `[handler-hist] total` is short by two ops per folded
iteration and dividing by it would inflate every share here.

| app | fold-off retired ops | ops caught before | share | ops caught after | share | blocks matched | declines before → after |
|---|---|---|---|---|---|---|---|
| quake2 soft | 299,375,553 | 9,372,997 | **3.13%** | 10,193,586 | **3.41%** | 52 → **307** | terminator 262 → **7** |
| mw3 | 264,438,340 | 248,218,929 | **93.87%** | 248,218,929 | **93.87%** | 8 → 8 | 15/0/3/4 unchanged |

heroes2 is deliberately absent from that table rather than filled in from §12.
Its 2,600-batch window did not finish on this box — the machine sat at load
220–290 for the whole session, and the run was at batch 25 after three minutes
— so there is no fresh measurement to put in a row. What *is* measured for it
is the census above: **zero x87 ops in any of its 19 self-loop shapes**, which
is why it was not re-run at a shorter window either. A number copied forward
from §12 and presented beside two that were re-measured would read as a third
measurement.

Read the quake2 row twice, because it contains the result and the correction to
the result.

**255 more self-loop blocks fold, and they were worth 0.27 percentage points.**
The `terminator` bucket collapsed from 262 decline events to 7 — those thirteen
mixed blocks were counted there, not under `unfoldable-op`, because §12's
reason 3 is "an op standing between the counter and the branch", and an x87 op
sitting there is exactly that. So the widening did remove the top decline the
bucket named. And the top decline the bucket named was worth **820,589 retired
ops out of 299 million**, because 83,134 block entries at ~10 ops each is a
small number however large it looks in a decline table.

That is the same unit lesson §12 wrote down about decline *events*, one level
further in: entries are the right weight for comparing declines to each other,
and still not the right weight for deciding whether a widening matters. Only
ops over the fold-off total is.

`x87-op 0` on every app: **not one x87 instruction in the corpus's self-loops
falls outside the accepted set.** The whitelist is not costing coverage
anywhere it was measured, and FCMOVcc/FCOMI — the two deliberate declines —
never occur in one.

### The new top decline

`tools/loopmatch-decode.js --tree-why --hot=` over the same quake2 window, after
the widening:

| reason | blocks | entries | share of entries | the op that stopped the walk |
|---|---|---|---|---|
| `walkback-hit-non-microop` | 4 | **514** | 0.00% | `th_test_r_r` (503), `th_mov_m16_r16` (11), `th_test_r_i32` (0) |
| `walkback-hit-flag-op` | 2 | 36 | 0.00% | `th_alu_r8_i8` |

514 entries out of 59,129,336 in the hot dump. The `unfoldable-op` bucket is 13
decline events with `lastFn 76` = `$th_mov_m32_i32`, and `short` is 51 blocks
under the four-op floor.

**quake2's decline list is now noise, and the next lever is not on it.** The
app still folds only 3.4% of its retired ops, so what is left is not blocks
that decline — it is the ~96% of quake2's work that never enters a self-loop
block at all. That is Design B's territory, and no amount of widening Design A
reaches it.

### Behaviour

`--png` at the end of the identical window, fold off vs fold on, through
`tools/png-diff.js`:

| app | pixels differing |
|---|---|
| quake2 soft | **0 of 76,800** (max channel delta 0) |
| mw3 | **0 of 307,200** (max channel delta 0) |

### Where the saving comes from

Only from the integer side, and one form makes that visible. H190
(`$th_fpu_mem_ro`, `fadd dword [ebx+0x10]`) is the most common x87 form in the
census, and its base register is read **out of the run's register local**
through the existing SIB EA hoist — the scalar handler pays a `$get_reg` for
the same number. The x87 call itself is identical in both arms; the microbench
below confirms that directly (`H190:1,572,864` in *both* arms of `tree_x87`).

### The three declines that are on purpose

| op | why | cost of accepting it |
|---|---|---|
| `FCMOVcc` (DA/0-2, DB/0-2) | **reads** CF/ZF via `$get_cf`/`$get_zf` | the decode-time dead-flag pass learns readers from `$tree_uop_flag_reads`, which reports zero for every x87 kind — an FCMOV would read flags an earlier micro-op was allowed to skip writing |
| `FCOMI`/`FUCOMI` (DB/5-6, DF/5-6) | **writes** EFLAGS via `$fpu_compare_eflags` | mirror image: writes lazy-flag fields from outside `$tree_uop_flag_writes`' model, so the terminator's `$eval_cc` could read a field the pass believed only the terminator writes |
| anything `$fpu_exec_*` does not implement | would reach `$fpu_crash_op` | a trap taken **inside** the fold reports a register file still sitting in wasm locals, so the crash log that exists to name the next thing to implement would name the wrong EIP and stale registers |

The first two are each a two-line change to the reader/writer sets. They are
not made because no corpus app has one inside a self-loop, and an unexercised
widening in a correctness-critical pass is worse than a decline. The third is
structural: the accepted set mirrors `$fpu_exec_mem`/`$fpu_exec_reg`'s own
implemented arms arm-for-arm, and an arm added there later is simply not folded
until it is added here too — a missed lowering, never a wrong one.

`FNSTSW AX` (DF E0) is the one x87 op that writes a general register, and it is
**accepted**, as its own kind, because `fcom / fnstsw ax / test ah,imm` is how
every pre-P6 compiler reads a comparison back. It publishes and reloads EAX
alone (not all eight, the way `TU_REP_STR` must), and it is excluded from
`$tree_uop_is_store` so the live-out mask picks EAX up through the ordinary
path.

Declines are counted under their own name rather than vanishing into
`unfoldable-op`: `--loopmatch-stats` now prints `x87-op N lastX87 0xGRM`, and
`tools/loopmatch-decode.js` turns that encoding back into a mnemonic. `lastFn
188` names three hundred different instructions; `lastX87 0x36f` names one.

### Tests

`test/test-tree-fold.js` grows three mixed positives and one named negative,
all on the file's existing A/B contract — decode and run the same bytes twice
at different guest addresses, gate off then on, and demand the two arms agree
on all eight registers, on CF/ZF/SF/OF/PF, on the memory touched **and now on
`$fpu_sw`**, which was added to the compared state for every shape in the file.

| case | body | what only it can catch |
|---|---|---|
| MIX1 | `fld [esi]` / `fmul [edi]` / `fstp [edi]` + two pointer bumps | the census's dominant shape |
| MIX2 | the same with `fdiv`, over a divisor buffer of zeros | **ZE**: asserted directly on both arms (`fpuSw & 0x04`, plus the ES summary bit), not only through the A/B — so a build where *neither* arm raised it cannot pass by agreeing |
| MIX3 | `fld st(0)` / `fmul st,st(1)` / `fxch` / `faddp` / `fstp [edi]`, cmp/jb close | register forms, and the `fxch` that rules out caching ST(0) |
| NEG | `fcomi st,st(1)` in an otherwise foldable body | that the decline is counted under the **named** x87 reason, not the generic one |

The status word is sticky, so comparing it across arms is a stronger assertion
than comparing the stored results: a fold that dropped, doubled or reordered an
x87 op shows up there even when the arithmetic happens to come out the same.

### CPU, on the microbench only

`tools/bench-loops.js` grows a `tree_x87` shape (the quake2 `0x004129b0` body:
`fld / fmul / fstp` with two pointer bumps), measured with
`--toggle=tree_fold --reps=6 --bytes=4m`, both arms in one process alternating:

```
tree_fold=1   min 1023.1ms   0.01 blocks/iter   H190:1,572,864  H3:1,048,576  H454:3,667
tree_fold=0   min 1358.4ms   1.00 blocks/iter   H190:1,572,864  H3:1,048,576  H65:524,288  H312:524,288
=> +24.7% time (min), paired median +19.6%
```

Read the H190 column before the percentage: **identical in both arms**. The x87
work is unchanged; what disappeared is one block transfer, one `dec` and one
`jnz` dispatch per iteration. And per the harness's own standing warning, this
is a microbench percentage and must not be quoted as an app percentage — the
app-level share it applies to is in the coverage table above.
