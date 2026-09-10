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
* **At least `--tree-fold-min-ops` interior ops** (default 4) and at most 24.

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

## 10. Flags

```
--tree-fold                 arm the family (default off)
--tree-fold-min-ops=N       interior-op floor (default 4)
--loopmatch-stats           prints matches / runs / iters / ops / deadflag and the decline split
node tools/bench-loops.js --shapes=tree_span,tree_dot,tree_chain --toggle=tree_fold
```

`set_tree_fold` is in `INHERITED_WASM_GLOBALS`, so every guest-thread instance
gets the same setting, cooperative and real-Worker alike.
