# Round 14, experiment #1: the block-length CDF and the executor's reachable share

2026-09-15. Read-only measurement. No `src/*.wat` was touched, no app was
timed, nothing was re-run: the thirteen hot-block dumps and run logs collected
by
[`../hot-loop-vocabulary-2026-09/collect-win98-gameplay.sh`](../hot-loop-vocabulary-2026-09/collect-win98-gameplay.sh)
already exist, and the block shapes in them are a property of the guest PEs,
not of our build.

Tool: [`tools/block-length-cdf.js`](../../tools/block-length-cdf.js) (importable;
`--json`; `--dir=` sweeps all thirteen windows; `--regions` adds the census
column). Test: `test/test-block-length-cdf.js` over a nine-block fixture cut
from `freecell.exe`. Raw output: [`round14-cdf.json`](round14-cdf.json).

## The kill rule, stated before the numbers

From [`../block-executor-review-2026-09-15.md`](../block-executor-review-2026-09-15.md)
§5, round 14:

> Kill rule stated in advance: if reachable share <15% in every gameplay window
> *or* `blk_mix512` is negative, the executor is frozen as the region/self-loop
> fold, default OFF, and no further executor round is opened.

and §2 #1's own phrasing of the same test:

> if ops in blocks of ≥12 instructions are under 15% of every gameplay window,
> the 1-block executor is capped at ~3% app CPU on this corpus.

## Which thirteen windows

The thirteen of [`../hot-loop-vocabulary-2026-09.md`](../hot-loop-vocabulary-2026-09.md)
§4b — five GAMEPLAY (quake2, mw3, gta2, rct, heroes2) and eight LOADING
(quake2, mw3, gta2, rct, heroes2, caesar3, starcraft, diablo). Not §4's six
menu/intro windows, and not the three `-x87` re-collections.

## What each column is

`ops` is `hits × static x86 instruction count`, summed over the blocks the
window entered — the census's own convention, and a **lower bound**, because a
block reached only by fused fall-through has no hits of its own. The
denominator matches `tools/code-region-census.js`'s `opsLowerBound` exactly in
all thirteen windows, which is the cross-check that the two tools are counting
the same thing.

`p50 len` and the `>=N` columns bucket those ops by the block's **micro-op**
count, which is its static instruction count **minus one**: a one-block
descriptor covers the body and leaves the terminator threaded (design §1.1),
and that body is what `$BX_C_UOP` prices.

`reach` applies the shipped installer's cost model statically —
`accept iff 16·nat > 190 + 20·nfb`, with `$BX_C_ENTRY` 190 / `$BX_C_UOP` 16 /
`$BX_C_FALLBACK` 20 read straight off `src/07c-block-exec.wat:315-318` — and
hard-declines any body carrying an x87 instruction, because handlers 188-190
sit in `$bx_op_unsafe` whenever `$block_exec_x87` is 0, the shipped default
(§17.5). It is an **upper bound**: the static mnemonic test accepts operand
shapes `$tree_uop_classify` would still refuse, and it counts interior
`cmp`/`test` as native.

`region` is the census's own 2+ block eligible share at N≤16 — also an upper
bound, and the number §15.5 quotes beside the matcher's measured `opsMulti%`
(which on the same apps ran 0.05-3.25%, i.e. one to two orders of magnitude
below this column).

`cov` is `ops / dispatches` from the same run's `[handler-hist] … total=` line.
It is a sanity column, not a share: x86 instructions and handler dispatches are
different units and the ratio varies per app (the census prints it for exactly
this reason), so >100% is expected where the decoder fuses, and a *low* value
is the real warning — `gta2-loading` at 3.3% means its dump covers a thin
slice of that window's work and its row should not be leaned on.

## The table

```
window                        ops   p50     >=4     >=8    >=12    >=16   reach  region     cov
-----------------------------------------------------------------------------------------------
quake2-gameplay     2,365,189,168     9   84.4%   56.0%   47.4%   38.9%   24.7%   38.0%   99.0%
mw3-gameplay          175,044,954    10   81.7%   55.5%   48.0%   33.3%   13.4%   16.3%  105.0%
gta2-gameplay          54,328,523     4   57.6%   30.0%   20.8%   13.1%    9.8%   17.9%   53.2%
rct-gameplay          220,770,115     2   10.6%    4.9%    4.2%    3.2%    1.7%   32.6%   86.5%
heroes2-gameplay      129,566,992     5   72.5%   24.7%   10.5%    8.4%    8.6%   23.9%  113.0%
quake2-loading        262,644,674     6   63.0%   30.0%   27.0%   24.7%   24.2%   38.2%   98.3%
mw3-loading         1,041,985,128    37   89.6%   78.5%   75.7%   71.2%   75.0%   80.4%   97.0%
gta2-loading            5,721,515    16   88.9%   79.0%   75.7%   68.8%   62.7%    1.9%    3.3%
rct-loading         2,819,979,289     3   44.1%   25.2%   14.3%   13.0%   11.8%   40.4%   94.9%
heroes2-loading        83,664,362     5   75.6%   24.3%   14.5%    8.4%   14.2%   24.5%  111.6%
caesar3-loading       291,397,900     3   46.3%   10.9%    2.6%    2.2%    2.4%   89.9%   94.5%
starcraft-loading   1,974,284,410     6   72.1%   27.8%   26.5%   13.4%    6.8%   20.6%   66.9%
diablo-loading        557,852,572     4   55.6%   27.7%   24.6%    5.4%    5.4%   20.7%   93.5%
```

Ops-pooled across the five gameplay windows: **reach 21.3%**, share≥12 **42.1%**,
region-reachable 35.3%. That pooled figure is carried by quake2, which is 80%
of the pooled ops.

## Verdict against the kill rule

**The kill rule is NOT met on this axis.** It requires reachable <15% in
*every* gameplay window, and two of five clear it:

| gameplay window | reach | verdict |
|---|---|---|
| quake2-gameplay | 24.7% | **above 15%** |
| mw3-gameplay | 13.4% | below |
| gta2-gameplay | 9.8% | below |
| rct-gameplay | 1.7% | below |
| heroes2-gameplay | 8.6% | below |

Same answer on §2 #1's stricter wording: ops in blocks of ≥12 micro-ops are
47.4% / 48.0% / 20.8% / 4.2% / 10.5%, so three of five gameplay windows are
above 15% there too.

So experiment #1 alone does not close the round. The round-14 rule is an OR
(`reachable <15% everywhere` **or** `blk_mix512` negative), and the decision
now rests on #3(b) — whether the executor's 22 ns/op survives a working set
large enough to defeat the branch predictor — and on #2's leaf breakeven.
Those were not run here.

## What the numbers actually say, beyond the pass/fail

**The review's coverage argument is right about four of five gameplay windows
and wrong about quake2.** rct-gameplay at 1.7% reachable with a p50 of 2
micro-ops is the review's thesis in its purest form: 57% of that window is a
two-block memset and the executor can never see it. heroes2-gameplay (8.6%),
gta2-gameplay (9.8%) and mw3-gameplay (13.4%) are the same story with less
concentration. quake2-gameplay is the counter-example, and it is not a small
one: 47.4% of its ops are in blocks of ≥12 micro-ops, because `D_DrawSpans8` is
a 16-texel unrolled body.

**x87 is what separates `>=12` from `reach`, and it is the bigger filter of the
two.** Share of ops in blocks carrying at least one x87 instruction:

| window | ops in x87-carrying blocks |
|---|---|
| mw3-gameplay | **53.4%** |
| quake2-gameplay | 29.5% |
| gta2-loading | 13.3% |
| gta2-gameplay | 10.0% |
| quake2-loading | 6.6% |
| mw3-loading | 2.4% |
| every other window | 0.0% |

That is the whole of mw3-gameplay's drop from 48.0% (≥12) to 13.4%
(reachable), and most of quake2-gameplay's 47.4% → 24.7%. In other words the
one lever the design turned **off** in round 12 (§17.5, x87 in the executor,
measured as a loss at `$BX_C_X87FB` = 96) is also the single largest thing
standing between the executor and the 3D gameplay windows. Both facts are
true at once, and they are the same fact: an x87 micro-op buys nothing because
`$nat` is deliberately not bumped for it.

**The region column is an upper bound that the matcher has never come near.**
caesar3-loading is 89.9% 2+ block eligible against a measured `opsMulti%` of
0.16% (§15.5); rct-gameplay is 32.6% eligible against a matcher that captures
essentially none of it. Nothing here changes §15.6's reading that caesar3 is
the big remaining gap — it just prices the gap on the gameplay windows too.

**The cross-check against §13.4 holds.** That table measured `in-region %`
20.77 for quake2 and 1.24 for caesar3 on its own (menu) windows, against this
tool's upper bounds of 24.2-24.7% for the two quake2 windows and 2.4% for
caesar3-loading. The static model is ~15-25% optimistic against the one place
where a measured number exists, which is the right direction and the right
size for an upper bound.

## Caveats, ranked

1. **`reach` is an upper bound and is never a CPU share.** Multiply it by the
   19-23% of guest CPU that dispatch + accessors actually cost
   (dispatch-attribution) before quoting anything: quake2-gameplay's 24.7%
   reachable is ≈5% of app CPU *if the per-op win is fully real*, which is what
   #3(b) exists to test.
2. **`gta2-loading` covers 3.3% of its window's dispatches.** Its 62.7% is a
   statement about a thin slice, not about that window.
3. **The dumps are from the 2026-09-14 collection**, i.e. the round-12 build.
   §22.5 notes the thirteen-window sweep has not been re-run against round 13.
   Block *shapes* are a property of the guest PE and do not move; which blocks
   got hit can. Re-running `collect-win98-gameplay.sh` and pointing
   `--dir=` at the new dumps reproduces every number above in ~13 seconds.
4. **mw3 is missing `msvcrt.dll` and `mfc42.dll`** from this worktree's binary
   set, so 1.7M of its 94M loading transfers (1.8%) count as unmapped and are
   outside the denominator.
5. **Interior `cmp`/`test` are counted native.** `tools/code-region-census.js`
   declines a non-producer `cmp`; this tool accepts it, which is the optimistic
   arm of an upper bound and is stated rather than hidden.

## Reproducing

```bash
# the dumps (only if the scratch copies are gone; ~250s per window, 13 windows)
bash docs/hot-loop-vocabulary-2026-09/collect-win98-gameplay.sh

# the table, ~13s, no emulator
node tools/block-length-cdf.js --dir=<dir with <window>-hot.txt + -run.log> --regions
node tools/block-length-cdf.js --dir=<...> --regions --json > round14-cdf.json

# the tool's own test
node test/test-block-length-cdf.js
```

A worktree needs `test/binaries/{candidates,shareware}` linked from the shared
checkout before the exes resolve; without them every window reports zero ops
and the `[run] WARNING: no file found for loaded module(s)` line is the tell.
