# Fused micro-op shapes — the census that decides whether to hand-write them

Status: **census only. No fused handler was built, and this says not to build a
vocabulary of them.**

Handler **454** (`$th_tree_fold`, [tree-fold-design-a.md](tree-fold-design-a.md))
folds a self-loop into ONE generic descriptor interpreter: per micro-op it pays
five descriptor loads, a kind `br_table` and two register `br_table`s. Measured,
that wins **+23-33%** on 6-11-op bodies and loses **12-18%** on mw3's 42-op
alpha blend, where it covers 45% of all retired ops — the per-micro-op
interpretation tax eventually exceeds the one-block-transfer saving, and a long
body is where it bites.

Runtime wasm codegen is ruled out. The remaining alternative is a **fixed
vocabulary of hand-written superinstructions**, each covering one recurring
subtree shape (`load16 -> and imm -> shr imm -> add`, `lea -> load32 -> store32`,
…), matched at decode time, each a specialized wasm function with no descriptor
decode at all. The only question that decides it is: **how many such handlers
would cover most of the executed tree mass?**

`tools/tree-shape-census.js` measures exactly that, and the answer is in §5.

---

## 1. Where the shapes come from

Not from a disassembly — the micro-op classification exists only inside the
matcher. `--trace-tree-fold` (added with this census, `$tree_trace` in
`src/07b-loop-match.wat`, exported as `set_tree_trace`) dumps, per **lowered**
block, its entry EIP, terminator and the six descriptor words of every micro-op,
through the same `log_i32` channel `--trace-loopmatch` uses. The census reads
that stream and joins each block's entry EIP against a `--hot-block-dump` for
weighting, exactly as `tools/expr-fold-census.js` weights its blocks.

Each tree is then normalized: registers renamed by first appearance
(`r0, r1, …`), immediates abstracted to `i`, **except** shift counts (kept:
`shr#8`) and AND masks (kept as classes: `m8`, `m16`, `mhi16`, `mlo10`, …).
`!f` marks an op whose flag write is still live — the matcher's dead-flag pass
already told us which ones are not, and a fused arm that must publish flags is a
different, more expensive arm, so it is a different shape.

Candidate shapes are **connected runs of 2..K consecutive micro-ops**.
Consecutive, because a fused handler runs its ops in source order; fusing
non-adjacent ops is a reordering and would need an alias/flag argument this
census does not get to assume. `--allow-gaps` reports the looser bound.

Vocabulary selection is **marginal-gain greedy**, not top-N-by-own-weight, and
the difference is not cosmetic: the candidates are overlapping windows of the
same hot loop, so the top few by standalone weight are near-duplicates that tile
the same ops and every slot after the first buys nothing. Each tree is then
tiled greedily, largest shape first, non-overlapping; whatever is left stays
per-op.

## 2. What the family is worth per app, before any of this

The share of **retired ops** that sit inside a TREE_FOLD block at all. This is
the ceiling on everything below — a vocabulary cannot reach ops the family never
claimed:

| app | window | retired ops (T0) | TREE_FOLD ops | share | distinct folded loops |
|---|---|---|---|---|---|
| mw3 | 50 batches @200k | 258,573,003 | 116,240,046 | **45.0%** | 4 |
| quake2_demo (`ref_soft`) | 3000 batches @20k | 328,014,262 | 10,596,862 | 3.2% | 23 |
| heroes2_demo | b1400-2600 | 92,504,591 | 281,283 | 0.3% | 4 |
| caesar3_demo | b3400-3600 | 16,495,956 | **0** | 0% | 0 |

caesar3 folds **nothing** — same as at `ea398be8`; its hot loops are the
unrolled copies the RLE/`rect_run` superops already target. A fused vocabulary
has literally no surface there.

## 3. Coverage curves

Share of hit-weighted folded micro-ops a vocabulary of N shapes tiles, and the
dispatch reduction that leaves (micro-ops per tree before → fused ops after).

**K=4** (shapes of up to 4 micro-ops):

| app | N=4 | N=8 | N=16 | N=32 | ops/tree after (N=16) | dispatch ratio |
|---|---|---|---|---|---|---|
| mw3 | 44.4% | 88.9% | **100.0%** | 100.0% | 9.0 of 36.0 | **4.00x** |
| quake2 | 77.6% | 88.4% | 92.6% | 92.7% | 4.9 of 14.7 | 2.98x |
| heroes2 | 80.0% | 80.0% | 80.0% | 80.0% | 2.0 of 5.0 | 2.50x |
| caesar3 | — | — | — | — | — | — |
| POOLED | 38.8% | 77.7% | 98.1% | 98.9% | 7.8 of 29.0 | 3.73x |

**K=6:**

| app | N=4 | N=8 | N=16 | N=32 | ops/tree after (N=8) | dispatch ratio |
|---|---|---|---|---|---|---|
| mw3 | 66.7% | **100.0%** | 100.0% | 100.0% | 6.0 of 36.0 | **6.00x** |
| quake2 | 92.0% | 97.8% | 98.0% | 98.0% | 3.2 of 14.7 | 4.64x |
| heroes2 | 100.0% | 100.0% | 100.0% | 100.0% | 1.0 of 5.0 | 5.00x |
| POOLED | 58.2% | 95.5% | 99.7% | 99.8% | 5.9 of 29.0 | 4.90x |

**K=3 and K=2 are the ones to read if a small, general vocabulary was the hope:**

| K | pooled N=4 | N=8 | N=16 | N=32 | best dispatch ratio |
|---|---|---|---|---|---|
| 2 | 29.1% | 42.9% | 43.8% | 43.8% | 1.28x |
| 3 | 34.0% | 63.1% | 88.3% | 89.8% | 2.33x |
| 4 | 38.8% | 77.7% | 98.1% | 98.9% | 3.82x |
| 6 | 58.2% | 95.5% | 99.7% | 99.8% | 5.79x |

The "covered (static)" column in the tool's own output is much lower at every N
(pooled K=4: 10.9% / 21.1% / 33.3% / 55.1%) because the unweighted bag includes
every cold folded loop equally. The weighted numbers are the ones that decide
anything; the static ones say how far a vocabulary generalizes, and they say:
not far.

## 4. The shapes themselves

Top of the greedy vocabulary, per app, read back into x86 (`%n` = the value the
n-th op of the shape produced, `!f` = flags still live):

**mw3 (K=4, first 9 picks tile 100% — they are nine consecutive windows of ONE
36-micro-op loop, its 16-bit alpha blend):**

| # | skeleton | x86 |
|---|---|---|
| 1 | `xor(r0,r0);xor(r1,r1);ld16+d(r2,%0);ld16+d(r2,%1)` | zero two accumulators, two 16-bit pixel loads off one base |
| 2 | `mov(r0);mov(r0);and(%0,r1);and(%1,r2)` | duplicate a pixel, mask off two channel fields |
| 3 | `xor(r0,r0);add(r1,r2);ld16(r3,%0);mov(r4)` | zero, channel add, next pixel load |
| 4 | `and(r0,r1);addi(r2);lea_sib(r3,%0);ld32+d(r4)` | mask, cursor bump, scaled-index address, table load |
| 5 | `and(r0,r1);ld32+d(r2);and(%1,r3);add!f(%0,%2)` | mask / table load / mask / accumulate |
| 6 | `ld32+d(r0);mov(%0);and!f(%1,r1);shr#2!f(r2)` | load, copy, mask, `shr 2` |
| 7 | `lea_sib(r0,r1);shr#2!f(%0);and(%1,r2);mov(r3)` | scaled index, `shr 2`, mask, copy |
| 8 | `and(r0,r1);or(r2,%0);ld32+d(r3);st16(%2,%1)` | mask, recombine channels, load, **16-bit store** |
| 9 | `ld32+d(r0);addi!f(r1);st32+d(r0,%1);st32+d(r0,%0)` | the loop's stack-spill tail (two `mov [esp+d],r`) |

**quake2 (K=4; picks 1-3 alone are 71.6%):**

| # | skeleton | x86 | marginal |
|---|---|---|---|
| 1 | `addi!f(r0);shl#8!f(r1);or(%1,r2)` | cursor bump, `shl 8`, OR — the 8→16bpp pixel pack | +35.8% |
| 2 | `xor(r0,r0);xor(r1,r1);ld8.hi+d(r2,%0);ld8+d(r2,%1)` | zero two regs, load a byte into `AH` and one into `AL` | +23.9% |
| 3 | `xor(r0,r0);ld8+d(r1,%0)` | zero-then-byte-load (the classic `xor eax,eax / mov al,[…]`) | +11.9% |
| 4 | `ld8(r0,r1);addi!f(r0);shl#8!f(%0);or(%2,r2)` | byte load, pointer bump, shift, OR | +6.0% |
| 5 | `addi!f(r0);shl#8!f(r1);or(%1,r2);st32+d(%0,%2)` | the same pack, ending in a 32-bit store | +6.0% |
| 6 | `sub!f(r0,r1);shr#16!f(r2);mov(%0);sub(%0,r1)` | span-delta / high-half extract | +1.7% |

**heroes2 (K=6, one shape covers 100%):**
`ld8(r0,r1);inc!f(r0);st8(r2,%0);dec!f(r2);st32abs(%3)` — byte load, pointer
bump, byte store, counter decrement, absolute spill. A byte copy loop.

## 5. Reuse — the number the decision actually turns on

Pooling all three apps' trees and counting how many distinct skeletons occur in
**more than one app**:

| K | distinct pooled skeletons | shared by >1 app |
|---|---|---|
| 2 | 55 | **1** |
| 3 | 207 | **1** |
| 4 | 376 | **1** |
| 6 | 663 | **1** |

The one shared shape, at every K, is `ld32+d(r0);mov(%0)` — a load followed by a
register copy. Nothing else recurs. The pooled greedy vocabulary is simply the
per-app vocabularies concatenated: picks 1-9 are mw3's loop, 10-12 and 14-20 are
quake2's, 13 is heroes2's.

## 6. Verdict

**On mw3, yes — arithmetically, comfortably. As a vocabulary, no.** Nine 4-op
handlers (or six 6-op ones) cover 100% of mw3's folded mass and cut its loop
from 36 micro-op steps per iteration to 9 (or 6). Price that with bench-loops'
~8 ns per dispatch and ~9 ns per block transfer: the unfolded loop costs
~38x8 + 9 ≈ 313 ns per iteration, and since H454 measures 12-18% *slower* than
that, its per-micro-op interpretation tax is ≈ 350-369/36 ≈ **10 ns — about one
full dispatch, which is why a long body loses**. A fused tiling at 9 dispatches
plus the same arithmetic lands near 80-110 ns, i.e. roughly 3x the unfolded
block and ~4x today's fold on that one loop; mw3 spends 45% of its retired ops
there, so this is the rare case where a microbench ratio would actually show up
app-side. But those nine shapes are nine consecutive windows of one loop in one
demo: across three apps and 663 distinct 6-op shapes, exactly **one** shape
occurs in two apps, and it is `load; mov`. That is not a vocabulary, it is a
transcription of mw3's alpha blend into WAT by hand — nine new handlers, each
with its own flag/lane/memory-ordering correctness surface, buying ~0% on
quake2 (3.2% family share, and its own shapes are different), ~0% on heroes2
(0.3%), and exactly 0% on caesar3 (the family folds nothing there). A *general*
vocabulary — the K=2/K=3 end, where a shape has some chance of recurring —
tops out at 43.8% / 89.8% pooled coverage for 32 handlers and a 1.28x / 2.33x
dispatch reduction, which at K=2 does not even cover the tax it is meant to
remove.

**So: do not build the fused-handler vocabulary.** The cheap fix this census
points at instead is a **body-length cap on H454** — it wins +23-33% at 6-11
micro-ops and loses only on the long bodies, and the crossover is exactly where
`nuops x 10 ns` overtakes `(nuops+2) x 8 ns + 9 ns`, i.e. around 20-25
micro-ops. Declining above that keeps every win and drops the one loss, for one
comparison in the matcher and no new correctness surface. If mw3's blend is
worth chasing after that, it is worth chasing as **one** hand-written
`$th_mw3_blend_row`-style superop over the whole loop, matched as a single
shape — not as nine reusable primitives that are not reusable.

## 7. Reproducing

```bash
S=/tmp/shape
node test/run.js --app=mw3 --no-threads --quiet-api --batch-size=200000 \
  --max-batches=50 --tree-fold --trace-tree-fold --loopmatch-stats \
  --handler-hist --handler-hist-thread=0 --hot-block-dump=$S/mw3-hot.txt > $S/mw3-run.log 2>&1
node test/run.js --app=quake2_demo --args='+set vid_ref soft +map demo1' \
  --no-threads --quiet-api --batch-size=20000 --max-batches=3000 \
  --tree-fold --trace-tree-fold --loopmatch-stats \
  --handler-hist --handler-hist-thread=0 --hot-block-dump=$S/q2-hot.txt > $S/q2-run.log 2>&1
node test/run.js --app=heroes2_demo --no-threads --quiet-api --batch-size=20000 \
  --max-batches=2600 --repaint-every=50 \
  --input='400:click:535:225,700:click:528:68,1200:click:283:373' \
  --tree-fold --trace-tree-fold --loopmatch-stats --handler-hist \
  --handler-hist-thread=0 --handler-hist-start=1400 --hot-block-dump=$S/h2-hot.txt > $S/h2-run.log 2>&1
node test/run.js --app=caesar3_demo --no-threads --quiet-api --batch-size=20000 \
  --max-batches=3600 --tree-fold --trace-tree-fold --loopmatch-stats --handler-hist \
  --handler-hist-thread=0 --handler-hist-start=3400 --hot-block-dump=$S/c3-hot.txt > $S/c3-run.log 2>&1

node tools/tree-shape-census.js \
  --app=mw3:$S/mw3-run.log:$S/mw3-hot.txt \
  --app=quake2:$S/q2-run.log:$S/q2-hot.txt \
  --app=heroes2:$S/h2-run.log:$S/h2-hot.txt \
  --app=caesar3:$S/c3-run.log:$S/c3-hot.txt \
  --k=2,3,4,6 --n=4,8,16,32 --top=32 --json=$S/census.json
```

`--args` must be pinned on quake2 (`config.cfg` persists across processes) for
the same reason [tree-fold-design-a.md](tree-fold-design-a.md) §8 pins it.

Two caveats on the numbers above, both stated rather than corrected:

* **A hot-block hit is one loop RUN, not one iteration.** With the fold armed,
  the folded block is entered once per run, so a long-trip loop is under-
  weighted against a short-trip one. The per-shape shares are therefore
  per-run-weighted; the tool's `static` column is the other bracket.
* The quake2 capture exited on its `timeout 600` guard *after* printing its
  `loopmatch:` summary and writing its dump, so its trace covers the full
  3000-batch window; the exit code is not a truncated capture.
