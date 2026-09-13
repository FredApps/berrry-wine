# How often does an app-scale region occur? — measured 2026-09-13

## The question

[region-descriptor-bench-2026-09.md](region-descriptor-bench-2026-09.md)
measured the *mechanism* and returned GO: a fixed handler (H454) interpreting a
multi-block region descriptor beats threaded per-op dispatch by +31..41% at
4-10 blocks, and its fit separates the two costs — threaded ~38 ns per
micro-op and ~91 ns per loop iteration, region ~22 ns and ~49 ns. Its own
closing section says the next measurement, in order, is:

> **Frequency.** Run a region matcher in *count-only* mode over the corpus and
> over hot windows. How many hot block-graphs of ≤ 16 blocks with no
> call/fault inside actually exist? If the answer is "the hot code is all
> 20-block graphs with calls in them", none of the above matters.

This is that measurement. **Nothing here changes execution.** No WAT was
touched; `src/07b-loop-match.wat` is the specification this tool reads, not
something it edits.

## The tool

`tools/code-region-census.js` — importable (`censusRegions`), `--json`,
`--why`, `--app=`, `--relax=`.

> The obvious name, `tools/region-census.js`, is already taken by the build
> gate over the WATX **memory** region odometer — an unrelated meaning of
> "region". This file is about regions of guest **code**.

It reuses `tools/block-regions.js`'s `buildCfg` / `resolver` / `loadImage`
(the earlier region-JIT transfer study) rather than re-deriving a CFG, and
`tools/disasm.js` for the per-instruction accept test. `--app=ID` drives
`test/run.js` itself, parses the module load addresses out of the run log,
and censuses the resulting `--hot-block-dump`; `--reuse` re-censuses a window
already collected, which is what makes the relaxation ladder below comparable
across arms.

### The rules it applies, and where each comes from

| rule | source |
|---|---|
| single entry — no in-set block but the entry has an outside predecessor | the descriptor has one entry EIP |
| closed set, ≤ 8 exits | `$REGION_MAX_EXITS` |
| ≤ 16 blocks | `$REGION_MAX_BLOCKS` |
| ≤ `(4096 − 8 − 16 − 52·nblocks − 8·nexits) / 24` micro-ops | bench doc §5 — 132 at full size, **not** `$TREE_FOLD_UOPS_LIMIT`, which is the one-block clamp |
| no call / ret / int / indirect jump inside | bench doc §3: nothing that can trap or yield may sit inside a region |
| every instruction maps to a `TU_*` micro-op kind | `$tree_uop_classify`, mirrored at mnemonic granularity |
| pages spanned, counted and capped (`--max-pages`) | bench doc §2: one generation counter per covered page, re-checked at entry |

The terminator's flag producer follows `$loop_try_tree_fold`'s own rule: it is
the **last flag-writing instruction before the Jcc**, not necessarily the one
immediately before it, because a compiler that spills at the bottom of a loop
emits `dec edi / mov [esp+8],edx / jnz`.

A leaf `call`+`ret` to a straight-line callee is counted apart as **call1** —
the bench's weakest shape (+26%) — rather than admitted.

### What the weights are, precisely

`--hot-block-dump` writes one line per distinct guest address the profiling
window entered a compiled block AT. A hit is one **interpreter block
transfer**: an EIP that had to be looked up before anything ran. Fall-through
inside a decode run costs no hit, because `$decode_run` fuses a not-taken Jcc
into the next op of the same thread stream.

* **transfers are exact** — the dump, only bucketed.
* **ops are a lower bound** — hits × the static x86 instruction count of the
  block. The per-app `dispatches per x86 insn` column is the audit: near 1.0
  means the census sees essentially all the work; StarCraft's 1.23 and
  Diablo's 1.69 mean it does not, and their shares are shares of what it can
  see.

## The measurement

Six apps, headless CLI, `--quiet-api`, one `--handler-hist` window each,
`--handler-hist-thread=0`. Every window is named honestly below; two of them
are **not** the state the bench doc's wish-list asked for and say so.

| app | window (batches) | what is running there | distinct blocks | transfers | x86 ops | disp/insn |
|---|---|---|---|---|---|---|
| quake2_demo `+map demo1` | 2500-4000 | `gamex86.dll` game logic | 1296 | 1.50 M | 6.28 M | 0.98 |
| caesar3_demo | 6000-9000 | 15→16 bpp pixel conversion at `0x4a3e4f` (demo boot, **not** a simulating city) | 38 | 3.00 M | 12.1 M | 1.05 |
| heroes2_demo | 3000-6000 | Miles Sound System decode in `MSS32.DLL` (**not** the adventure map) | 172 | 3.00 M | 17.0 M | 0.86 |
| mw3 | 2000-4000 | startup, the 16-bit alpha blend near `0x526f54` | 32 | 2.00 M | 79.4 M | 1.01 |
| starcraft_shareware | 3000-6000 | title / MMX-heavy blitting | 1748 | 11.9 M | 56.4 M | 1.23 |
| diablo_shareware | 3000-6000 | boot toward the menu | 1301 | 3.00 M | 14.0 M | 1.69 |

### (a)/(b)/(c)/(d) — share of retired x86 ops by region size

```
app                     1 block    2-4 blk    5-16 blk   declined   1pg    2pg
------------------------------------------------------------------------------
quake2_demo              30.7%      10.9%       1.5%      57.0%    42.9%   0.1%
caesar3_demo              0.2%      96.6%       2.9%       0.3%    99.7%   -
heroes2_demo             51.7%       9.8%       0.4%      38.2%    61.2%   0.7%
mw3                       0.0%     100.0%       0.0%       0.0%   100.0%   0.0%
starcraft_shareware      15.1%      25.0%       0.9%      59.0%    40.9%   0.0%
diablo_shareware         13.1%      19.5%      20.8%      46.6%    53.4%   0.0%
------------------------------------------------------------------------------
mean                     18.5%      43.6%       4.4%      33.5%
```

Of the 1-block regions, the share that is a **self-loop** — what today's fold
already reaches — is 7.8% of ops on quake2, 0.1% on diablo and **0.0%** on the
other four. Almost every one-block region this census finds is a plain
straight-line or forward-branching block that the shipped fold cannot see,
because `$loop_match_block` only ever runs on a block that branches to itself.

**call1 is nothing.** Leaf `call`+`ret` blocks are 0.0% of ops in every one of
the six windows (6 addresses / 587 ops on quake2, 1 / 54 on mw3, zero
elsewhere). The +26% the bench measured for that shape has almost no corpus to
spend itself on: real calls here are into multi-block callees.

**Pages are a non-issue.** Every region in every app fits in **one 4 KB page**
to within 0.7% of ops. The multi-page invalidation story bench doc §2 worries
about is real but it is not on the hot path — a one-page generation check at
entry covers essentially the whole prize.

### Decline histogram, weighted by ops

```
reason                    quake2  caesar3  heroes2   mw3   starcr  diablo
-------------------------------------------------------------------------
producer:test              16.2%    0.1%    29.1%   0.0%   10.2%    6.5%
ret                        14.6%    0.0%     1.9%   0.0%    1.4%    3.6%
call (direct)              10.6%    0.1%     0.8%   0.0%    0.2%    0.1%
call-indirect               0.6%      -      3.8%     -     2.2%    4.1%
push / pop                  9.3%    0.1%     2.4%     -     2.9%    1.3%
cmp not in producer slot    5.0%      -        -      -       -       -
shift-by-cl                 1.3%      -      0.0%     -     0.1%   23.1%
rotate (rol/ror/rcl/rcr)      -        -      0.0%     -     8.9%    6.1%
MMX (movd / movq)             -        -        -      -    31.2%     -
indirect jump               0.2%      -      0.0%     -     1.7%    0.2%
test in interior            0.9%      -      1.0%     -       -       -
xchg                          -        -        -      -     0.2%    0.3%
cap: too many exits           -        -      0.1%     -       -       -
-------------------------------------------------------------------------
```

Two things stand out and neither is a cap.

1. **`producer:test` is the only decline present in all six apps**, and it is
   the single largest one in two of them. `test r,r / jcc` is the C idiom for
   `if (p)` and `while (n)`. `$loop_try_tree_fold`'s terminator scan accepts
   `inc`/`dec` (H64/H65), `cmp r,r` (H19), `cmp r,imm` (H10) and `cmp
   r,[base+disp]` (H128) — and nothing else. `test` writes only the logic
   flags and no register, so it is the same shape as H19 with
   `$set_flags_logic` in place of `$set_flags_sub`.
2. **No cap binds.** `cap:blocks`, `cap:uops` and `cap:pages` are absent from
   every histogram; `too-many-exits` appears once, at 0.1% of one app. The
   16/8/132 limits are not what stops regions from forming. Op coverage and
   the entry rule are.

The genuinely-out-of-scope declines are honest ones: StarCraft's 31% MMX
(`movd`/`movq` — there are no `TU_*` kinds for the MMX registers at all),
Diablo's 23% `shl/shr` by `cl`, and quake2's 35% of `call`+`ret`+`push`, which
is what call-heavy game logic looks like and is Design B territory, not this.

### Why accepted regions stopped growing (exit edges, weighted by transfers)

`multi-entry` leads on heroes2 (79.9%) and caesar3 (21.7%), `producer:test`
on quake2 (5.9%) and heroes2 (32.2%). Multi-entry is a real block graph
property, not a matcher artifact: heroes2's hot pair at `MSS32+0xda61` and
`MSS32+0xdae8` is a two-block loop whose second block is branched to from two
places inside the same function, so a single-entry rule splits it in half.

### Projected ceiling

`threaded = 38 ns·ops + 45.5 ns·transfers` against
`region = 22 ns·ops + 49 ns·entries`. The 45.5 is the bench's 91 ns fixed term
halved, because that term is per **iteration** of a two-block loop and also
absorbs that loop's own `dec/jnz` — attributing all of it to the two transfers
**overstates** what a transfer costs and therefore overstates the win. Region
entries are estimated by splitting a block's transfers among its predecessors
in proportion to their hit counts, since block-entry counts carry no edge
attribution. Every constant is a flag (`--ns-op-threaded` and friends).

**This is a ceiling, not a forecast.** It prices only the machinery the bench
measured, over the ops this census can see, with no matcher cost, no SMC
re-check cost and no install cost in it.

```
app                    all regions   2+ block only  (what today's fold cannot reach)
------------------------------------------------------------------------------------
quake2_demo               17.3%          6.2%
caesar3_demo              54.8%         54.7%
heroes2_demo              21.2%          4.0%
mw3                       43.8%         43.8%
starcraft_shareware       16.9%         12.1%
diablo_shareware          25.4%         21.1%
------------------------------------------------------------------------------------
mean                      29.9%         23.7%
```

### The relaxation ladder

One census per candidate rule, same dump, so "which decline to relax first"
is answered with a number rather than a ranking of decline counts. Figures are
the 2+ block ceiling.

```
app                    baseline  +test producer  +multi-entry   +both
----------------------------------------------------------------------
quake2_demo               6.2%       21.6%          14.8%      30.3%
caesar3_demo             54.7%       54.8%          55.1%      55.2%
heroes2_demo              4.0%       17.4%          26.9%      46.6%
mw3                      43.8%       43.8%          43.8%      43.8%
starcraft_shareware      12.1%       15.8%          12.8%      19.6%
diablo_shareware         21.1%       27.0%          22.4%      28.4%
----------------------------------------------------------------------
mean                     23.7%       30.1%          29.3%      37.3%
```

Both rules are worth roughly the same on average and they **compose**: taken
together they lift the mean 2+ block ceiling from 23.7% to 37.3%, and on
heroes2 from 4.0% to 46.6%. `test` is the cheaper of the two by a wide margin
— it is one more arm in an existing backward scan and one more `term_kind`
that calls `$set_flags_logic`, against an entry switch and a per-entry
resume-EIP table for multi-entry.

## Verdict

**BUILD IT.** Three of six windows already have a majority of their retired
ops inside a multi-block region under the *unrelaxed* rules — caesar3 at 99.5%,
mw3 at 100%, diablo at 40.3% — and the mean 2+ block projected ceiling is
23.7% of guest CPU before any rule is loosened. That is not "the hot code is
all 20-block graphs with calls in them"; on this corpus the hot code is
mostly 2-4 block graphs of ALU and memory ops in one page.

Order of work:

1. **Relax the terminator producer to accept `test` first.** It is the only
   decline present in all six apps, the cheapest possible change to
   `$loop_try_tree_fold` (one arm in the existing backward scan; `test r,r`
   and `test r,imm` are H72/H73), and it is worth +6.4 points of mean 2+ block
   ceiling on its own — more than any cap change, which is worth zero.
2. **Then multi-entry**, as an entry switch over a small per-entry resume
   table. Worth +5.6 mean on its own and +7.2 more on top of `test`; it is
   what unlocks heroes2 entirely (4.0% → 46.6% with both).
3. **Do not touch the caps.** 16 blocks / 8 exits / 132 micro-ops / 4 pages
   bind on nothing measurable here. Regions are one page wide in every app.
4. **Do not build call1.** Zero ops in six of six windows.

What this does **not** authorize, and the bench doc already said so: the app
A/B. The two costs this census cannot see are the matcher's own decode-time
cost and the SMC generation re-check — bench doc §6 item 2 — and the pages
result above is the good news for the second of those, not a measurement of
it.

## Reproducing

```bash
node tools/code-region-census.js --app=caesar3_demo --out=/tmp/rc --why
node tools/code-region-census.js --app=heroes2_demo --out=/tmp/rc --reuse --why
node tools/code-region-census.js --app=diablo_shareware --out=/tmp/rc --reuse --json
node tools/code-region-census.js --dump=FILE --pe=EXE --pe=DLL@0xBASE --relax=test,multi-entry
```

`--reuse` re-censuses an already-collected window; re-running the app to
change a matcher rule gives a *different* dump and the two arms stop being
comparable.

### Caveats worth restating

- **Two windows are not the scene the bench doc asked for.** caesar3 is at its
  boot-time pixel conversion, not a simulating city, and heroes2 is inside the
  Miles decoder, not the adventure map. Both are real hot loops in real
  binaries, and both are labelled above; neither is evidence about the
  gameplay loop of its own game.
- **Ops are a lower bound** and the `dispatches per x86 insn` column says by
  how much. Diablo's 1.69 in particular means a third of its work is in
  fall-through the dump cannot attribute.
- **The accept set is checked at mnemonic granularity**, so it accepts shapes
  `$tree_uop_classify` might still refuse for an operand reason. Every number
  here is therefore an upper bound on what the real matcher would take.
- The box was busy. Nothing in this document is a wall-clock measurement, so
  that does not matter — every figure is a count or a projection from the
  bench's fit.
