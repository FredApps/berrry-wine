# Design D: a multi-block diamond loop matcher

**Status: proposal, not implemented. Needs sign-off before any WAT is written.**

## The observation

Every loop fold in the tree today is a hand-written special case for one app,
and the corpus censuses say so plainly:

| fold | corpus reach |
|---|---|
| `RLE_RUN` (H424) | **1** of 287 PEs (Caesar III) |
| `CK_LUT*` | 613 matches, **297 of them in one DLL** (SimGolf's `jgl.dll`) |
| `IMPLODE_CMP_RUN` (H466) | PKWARE implode only; zero outside compression |
| `PCX_RUN` (H462) | Quake II PCX/WAL |
| `SMK_TREE` | Smacker |
| `colorkey8` (H443) | Alpha Centauri's dest-keyed row |

Meanwhile, look at what the *profiles* keep naming as hot — in different apps,
measured independently, on different machines:

| app | hot region | share of block entries |
|---|---|---|
| StarCraft | `storm.dll` #437 span-list build + #432 span copy | **35.8% / 37.8%** (two boxes) |
| Diablo | signed-RLE + clipped-row clusters | 8.2% + 7.2% |
| Caesar III | the RLE token ladder at `0x40f71c` | (the reason `RLE_RUN` exists) |
| StarCraft (menus) | keyed byte blit `0x004c7a68` | 10.8% of that window |

**Every one of those is a multi-block diamond, and every one is invisible to the
matcher by construction.** `$loop_match_block` in `src/07b-loop-match.wat` only
ever runs on a block that branches to *itself*. A conditional store, a sentinel
test, a transparent-pixel skip — any of them splits the body into two blocks and
the loop vanishes from every recognizer we have. The existing tools say this
about themselves: `find-ck-lut-nests.js`'s header notes that a
`cmp byte [esi],0xff / jnb skip` makes a loop invisible, and `find-rle-nests.js`
exists precisely because `find-loops.js` "classifies a single self-loop *block*,
and this is a nest of ~20 blocks".

So the shape that recurs across unrelated apps is the one shape we cannot see,
and we have been paying for that with one bespoke fold per app.

## The claim to test

> A recognizer that matches a *small cycle of blocks* rather than a single
> self-looping block would subsume several of the existing one-app folds and
> reach the hot regions that none of them cover.

This is a claim, not a result. It is the thing the prototype has to establish
or refute.

## Why this is plausible

The diamond is not an arbitrary graph. In every instance above it is:

```
        ┌──────────────┐
        │  HEAD        │  load from a streaming source, test it
        └──┬────────┬──┘
           │ taken  │ not taken
        ┌──▼───┐ ┌──▼────┐
        │ ARM A│ │ ARM B │   each: branch-free, a few ops, stores or skips
        └──┬───┘ └──┬────┘
           └────┬───┘
         ┌──────▼──────┐
         │ LATCH       │  advance cursors, decrement, branch back to HEAD
         └─────────────┘
```

with the latch often folded into the arms. The properties that make Design A's
predicates work — induction variables, memory streams, no calls, no side
effects beyond the streams — are properties of the *cycle*, not of a block.
Design A's existing role analysis should lift to a cycle largely unchanged;
what is new is finding the cycle and proving it is closed.

## Sketch

1. **Detect at decode time**, where we already are when a backward branch is
   emitted. When a block's terminator targets a block we decoded within the
   last N blocks, walk forward from that target and collect the blocks reachable
   before control returns to it.
2. **Admit only a closed, bounded cycle**: ≤ 4 blocks, single entry (the head),
   every exit either back to the head or out of the loop entirely, no calls, no
   indirect branches. Reject on anything unknown rather than guessing — the
   rule `find-rle-nests.js` already follows.
3. **Run Design A's role summary over the union of the arms**, with each arm's
   stores predicated on the branch condition that reaches it.
4. **Emit one super-op** whose body is the whole diamond, iterating until the
   trip count or the sentinel ends it.

Step 2 is where this lives or dies. A cycle admitted too liberally is a
miscompile in code we cannot enumerate.

## What must be true before any of this is written

- [ ] **A static census.** Extend the existing nest finders into one
      `tools/find-diamonds.js` and run it over all ~1271 PEs. If the answer
      looks like `RLE_RUN`'s (1 app) this proposal is dead and we have saved
      the implementation.
- [ ] **A hotness census, multi-window.** Static reach is not the argument —
      `tools/hot-loop-census.js` over several windows per app, because this has
      already cost two sessions (H455 on SimGolf; the `0x004c7a68` retraction
      in `docs/re-notes/starcraft-shareware.md`). Build only against the
      "hot in EVERY window" list.
- [ ] **A correctness oracle first.** See below — this is the real blocker.

## The prerequisite: correctness (task A)

A diamond matcher is strictly more dangerous than Design A. Design A rewrites
one block whose entire body it has proven; this rewrites a *control-flow
structure*, and the failure mode is a wrong picture in some app nobody thought
to run.

Today we have no way to catch that. Six folds are **on by default for every
user** —

```
sib_fusion  rect_run  case_chain  rle_run  smk_tree  pcx_run
```

— and none has ever been run through a registry-wide A/B. `tools/block-exec-sweep.js`
is already the right harness and is already parameterized (`--flag=NAME`), but it
has only ever been pointed at `--block-exec`.

Two things make it sharper, and both are cheap:

1. **Pin the calendar clock in both arms** (done: `--wall-clock-ms`, on by
   default, `--no-pin-clock` to revert). Unpinned, an app that seeds itself
   from the date disagrees with *itself* — 88,435 of 98,304 bytes on the
   StarCraft save route — which is most of what the null band absorbs. Pinned,
   a deterministic app compares as bytes and its band goes to zero.
2. **Invert the arms for a default-on fold**: `--flag=no-rect-run` makes the
   deviation arm the one with the fold *disabled*. No tool change needed.

**Recommended order: A before D.** Validate the six folds that already ship on
by default, and the harness that does it becomes the gate the diamond matcher
has to pass. If validating the existing six turns up a miscompile, that is a
more valuable finding than the new fold would have been.

## Risks and honest unknowns

- **The cycle may not generalize.** Storm's `#437` is a per-tile-cell state
  machine, not a pixel loop; it may need more than 4 blocks, or carry state the
  role analysis has no vocabulary for. I have not read it.
- **Decode-time cost.** Walking a cycle on every backward branch is more work
  per decode than Design A's single-block check, paid by every app whether or
  not it matches. `--decode-stats` is the instrument.
- **Interaction with the block executor.** `07c-block-exec.wat` already runs
  whole blocks; a diamond fold and the executor may overlap or conflict. The
  measured relationship (`blk_mix512`: executor +42% → −11% depending on the
  leaf) says this is not obvious either way.
- **It may simply be a smaller win than one good Storm fold.** 35.8% in one app
  is a large, certain number. A general matcher that captures half of several
  5% regions may be worth less for much more work.

## Decision asked for

Approve or decline **the census step only** (`tools/find-diamonds.js` plus a
multi-window hotness pass). That is measurement, costs no source risk, and its
result decides whether the rest is worth designing in detail.

---

> **Superseded below, and the conclusion has moved.** Everything above this line
> is the original proposal for a general diamond matcher, kept for its reasoning
> and its risk register. The census declined it. The surviving scope —
> **SELFEXIT support only** — and the open issues that gate it now live in
> **§22 of [loop-idiom-superops-design.md](loop-idiom-superops-design.md)**,
> which is the doc to read when working on a fold. Do not add findings here;
> add them to §22.

# Census result, 2026-09-19 — the proposal survives, much smaller

`tools/find-diamonds.js` (5134b3e0) classifies every short backward branch in a
PE into three populations. Conflating the first two was an error in this
document's own framing:

```
 SELF      one block, no early exit        -- $loop_match_block CAN see it
 SELFEXIT  one block + a conditional exit  -- it CANNOT: the decoder splits the
                                              block at the branch, so the head
                                              stops branching to itself
 DIAMOND   an internal branch splits the body
```

COMI's blend loop at `exe+0x40340e` is the case that exposed it: both its
branches (`cmp dl,0xff / jz`, `cmp dl,0x8 / jnb`) target addresses *past* the
back edge, so they are loop **exits**, internal edge count zero — which reads as
`SELF`, "already covered". It is not covered, for the reason above.

## Static reach, 1271 PEs in `test/binaries`

| class | count | share of classified loops |
|---|---|---|
| SELF | 47,419 | 41% |
| SELFEXIT | 22,917 | 20% |
| DIAMOND | 44,633 | 39% |
| COMPLEX | 8,253 | (too large to fold) |

**59% of candidate loops are invisible to the current matcher**, carried by 1103
of 1271 binaries. The top skeleton is the sentinel-terminated string copy
(`mov al,[esi]; inc esi; mov [edi],al; inc edi; test al,al; jz`) in **378**
binaries — a CRT idiom, unlike `RLE_RUN` (1 of 287 PEs) or the keyed LUT (297 of
613 hits inside one DLL).

## The join that matters, against `hot-idiom-census-2026-09-19.md`

Static reach is not hotness. Crossing each app's measured hot region against the
classifier is what decides this, and it is mostly a **negative**:

| app | hot region | share | what the classifier sees |
|---|---|---|---|
| StarCraft | `storm+0x15024f12` (#437) | 25.8% | **no backward branch at all** — straight-line, branchy, with calls |
| StarCraft | `storm+0x15024511` (#432) | 12.0% | declined: `rep` |
| Diablo | `exe+0x45d8ef` CEL solid | 40.3% | no short back edge (unrolled; loop is elsewhere) |
| Diablo | `exe+0x460f0b` CEL line | 36.1% | no short back edge |
| Caesar III | `exe+0x40f6d9` RLE ladder | 19.9% | DIAMOND2 / DIAMOND4 / COMPLEX — **already folded by `RLE_RUN` H424** |
| COMI | `exe+0x40340e` blend | 11.7% | **SELFEXIT** — invisible, unclaimed |

Of six measured hot regions across five profiled apps, four are not
backward-branch loops this matcher family can reach at any span limit (checked
at `--max-span=1024`), one is already folded, and **one** is an unclaimed
SELFEXIT.

## Revised recommendation

Do **not** build a general diamond matcher. The general version is justified by
a static number (59%) that the hot join does not support.

Build **SELFEXIT support only** — one block plus a conditional exit, which is
the smallest possible change to `$loop_match_block`'s precondition and reuses
its existing role analysis unchanged. It is the only invisible class with a
demonstrated hot instance (COMI, 11.7% of block entries, spread 0.11pp across
three windows, 35.1% for the ±0x60 region), and it is the class the 378-binary
CRT string-copy skeleton falls into.

The gate is unchanged: [fold-correctness-oracle.md](fold-correctness-oracle.md),
extended to more apps and deeper frames.

And the standing caution still applies to the CRT skeleton itself — 378 binaries
is static reach, exactly the number that made H455/SimGolf look worth building
before it moved the frame rate not at all. It earns a multi-window hot census,
not an implementation.

## The runtime join, 2026-09-19 — `tools/loop-class-share.js`

The hot census above is per-*region*. `tools/loop-class-share.js` answers the
sharper question directly: take a handler-hist window (`test/run.js
--hist-json=F`), put every hot block inside the loop cycle that contains it, and
report the share of **block entries** by class.

Two measured apps, opposite answers:

| app / window | SELFEXIT + DIAMOND | `none` (not a loop) | `declined:call` |
|---|---|---|---|
| Caesar III, batches 300-500 | ~59% | 4.2% | 1.1% |
| Caesar III, batches 500-700 | ~88% | 10.8% | 0.4% |
| Diablo, batches 600-800 | **0.06%** | 57.0% | 27.7% |

So this is not a property of the emulator, it is a property of the app, and it
swings by three orders of magnitude between two apps in the corpus. Caesar's own
two windows disagree on which loops (SELFEXIT 28.0% → 0.9%), which is the
H455/SimGolf spread warning firing again on a different measurement.

**One concrete candidate did come out of it.** Caesar III `exe+0x49e9ca`, 27.96%
of block entries in the 300-500 window, and the only hot SELFEXIT that also
passes the blit heuristic (a load, a store and a pointer advance):

```asm
0049e9ca  mov eax,[ebp-0x4]     ; i
0049e9cd  add eax,1
0049e9d0  mov [ebp-0x4],eax
0049e9d3  mov ecx,[ebp-0x4]
0049e9d6  cmp ecx,[ebp+0x10]    ; i < n ?
0049e9d9  jge short 0x49e9ed    ; <- the exit that splits the block
0049e9db  mov edx,[ebp+0xc]     ; dst
0049e9de  add edx,[ebp-0x4]
0049e9e1  mov eax,[ebp+0x8]     ; src
0049e9e4  add eax,[ebp-0x4]
0049e9e7  mov cl,[eax]
0049e9e9  mov [edx],cl
0049e9eb  jmp short 0x49e9ca
```

An unoptimized indexed byte `memcpy` with its induction variable spilled to the
stack frame. The body is already inside `COPY_RUN`'s vocabulary — **what blocks
the fold is the precondition, not the body**. That is the single strongest
argument for SELFEXIT support: it makes an existing fold reach code it already
knows how to lower.

Caveat kept in front: 27.96% is one window (Caesar's load phase), and it is
absent from the next window's top loops. Before any WAT change this needs the
multi-window treatment `tools/hot-loop-census.js` exists to give.

### Two measurement bugs fixed while getting this number

Both produced confident, wrong-looking-right output, so they are worth naming:

1. **The blit heuristic swallowed the structural answer.** find-diamonds
   declines a cycle without a load+store+advance, which is right for a static
   blit census and wrong here — it put 79% of Caesar's block entries into one
   `nomemory` bucket. `--keep-nomemory` keeps the class and tags it `~`.
2. **`process.argv` appends after the `require`.** find-diamonds reads its
   limits at require time, so the flags this tool appends never reached it and
   the scan silently ran with defaults. The require is lazy now.
