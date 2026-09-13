# Does a region descriptor beat threaded dispatch? — measured 2026-09-13

## The question

The single-self-loop tree fold ([tree-fold-design-a.md](tree-fold-design-a.md)) is
finished. What it still declines, on both this emulator and the toy VM, is
`call/ret`, `multi-branch terminator` and `too short` — every one of those is a
**graph** of basic blocks, not a self-loop, and `$loop_match_block` cannot see a
graph by construction: it only ever runs on a block that branches to itself.

So the next fold, if there is one, is a REGION descriptor: N blocks, edges
between them, interior control flow resolved *inside* one handler. Before
anyone builds an app-scale matcher for that, one number decides it:

> Does a fixed handler **interpreting** a graph descriptor beat the threaded
> per-op dispatch by enough to matter, or does it just move the interpreter
> loop one level down?

This is that measurement. Nothing here proposes a matcher; the descriptors are
hand-written and handed to the decoder through `set_region_spec`.

**No runtime wasm codegen is involved and none is proposed.** The region
interpreter is a fixed build-time handler (H454) reading decode-time data,
exactly like every other fold in this repo.

## What was built

H454's descriptor was one self-loop block. It is now a graph, and the
self-loop is its one-block case — the shipped `$loop_try_tree_fold` emits that
case and `test/test-tree-fold.js` passes unchanged, which is what makes the
generalization checkable rather than a rewrite.

```
header      nblocks, nexits, uops_total, reserved
block table nblocks * 13 words: uop window, terminator, cost,
            succ_taken / succ_fall (>= 0 a block index, < 0 exit slot -1-v),
            entry_eip
exit table  nexits * 2 words: resume eip, live-out mask
micro-ops   one flat pool; each block names its window into it
```

`$th_tree_fold` runs a **block-index loop** over that table instead of an
iteration count. Registers stay in eight wasm locals across the whole region;
interior edges are a successor index, not a branch to `$next`; the 13-word
block record is reloaded only when the index actually changes, so the
one-block case pays one compare per trip and no reloads. Caps for the bench:
16 blocks, 8 exits.

There is deliberately no second handler and no duplicated micro-op executor.
The executor keeps the register file in wasm **locals**, and a local cannot
cross a function boundary — factoring it into a helper would have meant moving
the registers to globals or memory, which is the one thing the fold exists to
avoid. So H454 was generalized in place and the table count stays 457.

`$region_try_install` is the bench/test-only door: `set_region_spec(eip, ptr,
words)` arms a descriptor for one entry EIP, `set_region_fold(1)` lets
`$loop_match_block` install it. Both default **OFF** and no app path sets
them.

## How it was measured

`tools/bench-loops.js --toggle=region`, whose methodology is
[loop-microbench-harness.md](loop-microbench-harness.md): both arms in one
process, interleaved rep by rep with the order rotated, a fresh code page per
rep so the decode-time install actually happens, minima and paired medians over
≥ 9 reps.

Three things were added for this study and matter to reading the numbers:

- **A cross-arm checksum.** Every rep publishes all seven non-`esp` guest
  registers and the arms must agree. A hand-written descriptor that disagrees
  with its own x86 would otherwise just report a speedup. It caught two real
  bugs while these shapes were being written.
- **A NULL arm** (`region_null`): the diamond shape with the spec armed at an
  EIP the guest never reaches, so *nothing* installs in either arm. It is the
  session's own noise floor.
- **loadavg at both ends of the run.**

**Read the minima, not the paired medians, in these runs.** The box was at
**load 335–366** throughout (38 users, other agents sweeping). At that load the
NULL arm — byte-identical work in both arms — reported a paired median of
**+14.5%** while its minimum stayed at **−1.3%**. The paired median is
supposed to be the robust statistic and here it is the broken one, because
under heavy contention the two slots within a rep are not exchangeable however
much you rotate them. The minima on the NULL arm were −3.3% and −1.3% across
two independent runs, so **±3% is the floor** and anything under that is
nothing.

Everything below is quoted from `--reps=9` (step 1) and `--reps=15` (step 2).

## Step 1 — the block handler

One straight-line block of K reg-reg ALU ops ending in `jmp $+0`, then a
separate `dec ecx / jnz` block. **The region is entered and left every trip**,
unlike a self-loop whose entry cost amortizes over the whole loop, so this is
the case that applies to 100% of basic blocks.

`r4` and `r8` run the **same x86** and differ only in the published live-out
mask (four registers vs all eight). Publishing an unchanged register is a
semantic no-op, so the pair isolates exactly one thing: what exit publication
costs per register.

| shape | ns/iter on | ns/iter off | min | paired med | blocks/iter on→off | dispatches removed /iter |
|---|---|---|---|---|---|---|
| `region_blk2_r4`  | 93.6  | 166.5  | **+43.8%** | +46.3% | 0.01 → 2.00 | 5 ops + 2 block entries |
| `region_blk2_r8`  | 87.5  | 163.2  | **+46.4%** | +52.8% | 0.01 → 2.00 | 5 + 2 |
| `region_blk4_r4`  | 123.4 | 200.0  | **+38.3%** | +38.6% | 0.01 → 2.00 | 7 + 2 |
| `region_blk4_r8`  | 119.0 | 213.2  | **+44.2%** | +39.9% | 0.01 → 2.00 | 7 + 2 |
| `region_blk8_r4`  | 215.5 | 325.9  | **+33.9%** | +39.8% | 0.02 → 2.00 | 11 + 2 |
| `region_blk8_r8`  | 198.0 | 295.7  | **+33.0%** | +33.0% | 0.02 → 2.00 | 11 + 2 |
| `region_blk16_r4` | 352.0 | 565.6  | **+37.8%** | +37.8% | 0.04 → 2.00 | 19 + 2 |
| `region_blk16_r8` | 389.4 | 550.7  | **+29.3%** | +30.4% | 0.04 → 2.00 | 19 + 2 |
| `region_blk32_r4` | 766.3 | 1305.5 | **+41.3%** | +28.5% | 0.07 → 2.00 | 35 + 2 |
| `region_blk32_r8` | 803.2 | 1250.1 | **+35.7%** | +29.6% | 0.07 → 2.00 | 35 + 2 |

Fitting `ns/iter = A + B·K` across K = 2…32 separates the two costs:

|  | per micro-op (B) | per iteration (A) |
|---|---|---|
| threaded, r4 | 38.0 ns | 90.6 ns |
| region, r4 | 22.4 ns | 48.8 ns |
| threaded, r8 | 36.2 ns | 90.7 ns |
| region, r8 | 23.9 ns | 39.8 ns |

Two conclusions:

1. **The win is not only the block entries.** A micro-op inside the descriptor
   costs ~22 ns against ~37 ns for the same instruction dispatched through
   `$next` — about 40% off *per op*, before a single block transfer is
   deleted. Registers living in wasm locals across a whole region is most of
   that.
2. **Exit publication is below the noise.** Going from a 4-register live-out to
   all 8 moved the fixed term by −9 ns and +1.4 ns/op, i.e. in *opposite*
   directions and both inside the floor. Publishing the full register file on
   every exit is not a cost worth designing around.

There is no crossover with length: the region leads at K = 2 and still leads at
K = 32.

## Step 2 — the region handler

| shape | blocks | ns/iter on | ns/iter off | min | paired med | blocks/iter on→off | dispatches removed /iter |
|---|---|---|---|---|---|---|---|
| (a) `region_if2` | 2 | 123.8 | 205.1 | **+39.6%** | +39.3% | 0.01 → 2.00 | 6 ops + 2 block entries |
| (b) `region_diamond4` | 4 | 173.2 | 251.1 | **+31.0%** | +49.0% | 0.01 → 3.00 | 8 + 3 |
| (c) `region_state6` | 6 | 210.7 | 360.4 | **+41.5%** | +37.9% | 0.04 → 3.75 | 10.5 + 3.75 |
| (d) `region_ladder5` | 10 | 258.4 | 436.8 | **+40.8%** | +36.8% | 0.03 → 4.80 | 12.4 + 4.8 |
| (e) `region_call1` | 3 | 300.8 | 407.4 | **+26.2%** | +26.6% | 0.03 → 3.00 | 13 + 3 |
| NULL `region_null` | — | 257.4 | 254.2 | **−1.3%** | +14.5% | 3.00 → 3.00 | 0 |

Confirmation at `--reps=9` earlier in the same session, same order: +20.9,
+31.3, +36.0, +39.1, +14.6, −3.3. Every shape keeps its sign and (b)–(d) stay
above +30% in both runs.

The shapes:

- **(a) `region_if2`** — `while (esi < edx) { ebx += *esi; esi += 4; }`. The
  guard block's *taken* edge is the loop exit. A self-loop matcher is blind to
  this by construction, and it is the head of essentially every bounded scan.
- **(b) `region_diamond4`** — head, two data-dependent arms, tail. What
  `match-loops.js --why` counts as `multi-branch`.
- **(c) `region_state6`** — a two-rung compare chain selecting one of three
  arms per token.
- **(d) `region_ladder5`** — the Caesar III `0x40f71c` RLE token ladder in
  miniature: four `cmp/je` rungs, five case bodies, one shared tail. Ten
  blocks. `tools/find-rle-nests.js` finds exactly this nest in one PE out of
  287, so this shape is here as a *hard* case for the interpreter, not as a
  claim about corpus frequency.
- **(e) `region_call1`** — a leaf call inlined with the **frame stores kept**:
  the return address is still materialized, still pushed on a shadow stack and
  still popped. That is the honest thing a region descriptor could do to a leaf
  call, and it is the weakest result here (+26%) precisely because five of its
  fifteen ops are memory traffic the fold cannot make cheaper.

`region_call1` is the shape that prices the ceiling: the more of a block is
real memory work, the smaller the share dispatch was, and the less a region can
win. That is the same lesson `tree_mem*` taught the single-block fold.

## Verdict

The pre-registered rule was: **≥ +20% time at (b), (c) and (d)** for the
app-scale design to proceed, and the block handler **≥ parity at K = 4,
winning at K = 8+**.

| criterion | measured | |
|---|---|---|
| (b) diamond, ≥ +20% | +31.0% / +31.3% | **PASS** |
| (c) state machine, ≥ +20% | +41.5% / +36.0% | **PASS** |
| (d) RLE ladder, ≥ +20% | +40.8% / +39.1% | **PASS** |
| block handler at K = 4, ≥ parity | +38.3% / +44.2% | **PASS** |
| block handler at K ≥ 8 | +29% … +41% | **PASS** |

**GO.** A region descriptor does not merely move the interpreter loop one level
down. It deletes the block-transfer machinery outright (2–4.8 block entries per
iteration become 0.01–0.07) *and* makes each remaining op ~40% cheaper by
holding the register file in wasm locals across the whole graph.

### What this is not

- **It is not an app percentage.** Multiply by the profile share of the
  machinery it removes, exactly as [loop-microbench-harness.md] insists — the
  +57% CASE_CHAIN microbench and its ≤2% on Caesar agreed only after that
  multiplication.
- **It says nothing about how often these shapes occur, or how hot they are.**
  This measures the *mechanism*. `find-loops.js`, `match-loops.js`,
  `find-rle-nests.js`, `browser-handler-hist.js` and `hot-loop-census.js`
  answer the frequency question, and `hot-loop-census.js` exists precisely
  because one profiling window already produced a fold (H455) that moved
  nothing.
- **The descriptors here are hand-written.** Building a matcher that produces
  them from real x86 is the work this measurement authorizes, not work this
  measurement did.
- **A periodic loop is perfectly BTB-predicted**, so the harness understates
  what dispatch costs in real code. The sign is safe; the magnitude is a floor.

## What an app-scale region descriptor would need

The bench descriptor is a fair model of the *interpreter*. It is not a model of
the *matcher*, and everything below is what the difference costs.

### 1. Region discovery at decode time

`$loop_match_block` runs on one block, at the end of `$decode_block`, and knows
nothing about the block's successors — they may not be decoded yet. A region
matcher needs a **multi-block window**: decode forward from an entry until
every edge either lands inside the set or leaves it, cap the set at 16 blocks
and 8 exits, and refuse anything else. `$decode_run` already chains
fall-through blocks, so the hook is a generalization of that chain, not a new
pass. Every block in the set must be a *maximal decoder block* — if the
descriptor's block boundaries differ from the decoder's, the two arms are not
comparable and a side exit lands somewhere the cache has no entry for.

### 2. Self-modifying code, per page generation

This is the requirement with teeth. A single-block fold is invalidated by the
existing code-page bitmap that already guards every decoded block. A region
spans **several pages**, so one region must be invalidated when *any* of them
is written. The cheap version: record the set of pages a region covers and its
generation counter per page at install, and re-check the counters at region
**entry** — one compare per covered page, amortized over the whole region, and
zero cost inside it. A region entered while any covered page has moved on falls
back to threaded execution for that entry.

Checking mid-region is not on the table: the whole win is that nothing inside
the region touches memory the guest can see it touch.

### 3. Safepoints at block edges only

Already true of the implementation and already tested. The meters (`$steps`,
`$block_budget`) are checked on the edge between blocks; the resume EIP is that
block's `entry_eip`. `test/test-tree-fold.js` parks the diamond mid-region,
asserts the EIP is one of the descriptor's own block edges, then resumes the
**published registers and EIP in a threaded-only copy** and demands the final
state match the all-threaded run exactly. That test is the contract; any
app-scale version has to keep passing it.

Anything that can trap or yield inside a block — an API thunk, a guest fault, a
`$g2w` miss — is therefore *not allowed inside a region*. Blocks containing a
call, an interrupt, or an unmodelled instruction have to end the region, which
is why (e) keeps its frame stores instead of eliding the call: eliding it is a
different, much larger claim.

### 4. Exit state publication

Measured above as free at 8 registers, so the design does not need per-exit
masks for speed. It still needs them for **correctness of the flags**: a
terminator's lazy-flag state has to be live at whichever exit was taken. The
current descriptor publishes the register mask per exit and leaves flags in the
usual `$flag_*` globals, which is what makes the resume test above pass.

### 5. Caps, and what happens at them

16 blocks / 8 exits / 167 micro-ops are what fit in `$decode_block`'s 4096-byte
slack (the one-block header is 76 bytes; the region header costs four words,
which is why `$TREE_FOLD_UOPS_LIMIT` went 168 → 167). A real matcher wants
those numbers derived, not typed: the limit is
`(4096 − 8 − 16 − 52·nblocks − 8·nexits) / 24` micro-ops, and the matcher must
compute it and decline rather than truncate. A descriptor past the slack
corrupts the next block silently instead of failing.

### 6. What to measure next, in order

1. **Frequency.** Run a region matcher in *count-only* mode over the corpus and
   over `hot-loop-census.js` windows. How many hot block-graphs of ≤ 16 blocks
   with no call/fault inside actually exist? If the answer is "the hot code is
   all 20-block graphs with calls in them", none of the above matters.
2. **The SMC re-check cost**, on a real app with a real page-generation table —
   the one cost this bench does not model at all.
3. **Only then** the app A/B, on fixed work and user CPU
   (`--max-batches` + user time), never on a loaded box's wall clock.

## Reproducing

```bash
node tools/bench-loops.js --toggle=region --reps=15 --bytes=4m \
  --shapes=region_if2,region_diamond4,region_state6,region_ladder5,region_call1,region_null
node tools/bench-loops.js --toggle=region --reps=9 --bytes=4m \
  --shapes=region_blk2_r4,region_blk2_r8,region_blk4_r4,region_blk4_r8,region_blk8_r4,region_blk8_r8,region_blk16_r4,region_blk16_r8,region_blk32_r4,region_blk32_r8
node test/test-tree-fold.js
```

`region_null` must come out inside ±3% of zero on the minimum, or the box was
too busy and nothing else in the run is worth quoting.
