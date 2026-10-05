# Is any tree-fold arm worth a default flip? (2026-09-12)

Measurement only. Nothing in `src/` or `tools/toyvm/` moved for this; the only
new code is `tools/fold-ab.js`, the harness that produced every number below.

The question this answers is narrow: **`--tree-fold` (Win98, H448) and
`--tree-fold --tree-fold-hot=64` (toyvm) are both OFF by default. Should either
be flipped ON?** Both features are already built, already correct on their
corpora, and already documented — [docs/tree-fold-design-a.md](tree-fold-design-a.md)
and [docs/toyvm-tree-fold.md](toyvm-tree-fold.md). What neither document could
supply is a defensible timing verdict, because every timing table in them
carries its own disclaimer that this box was at load 10-40 when it was taken.

**Short answer: flip nothing yet. Nothing is a resolved gain. The toyvm gated
fold is a resolved LOSS on five of six witnesses by the load-robust statistic,
and the mechanism is identified. Win98 `--tree-fold` is the only arm that never
regressed anywhere, and quake2 is a −1.2% to −1.5% lead it deserves one quiet-box
confirmation for.**

## What was measured, and the third arm

Build: `41022d0d`. Main HEAD at the time (`5f1c1df2`) does not compile in
isolation — `e1333413` committed a `$VIRTUAL_HOLE_TABLE` reader whose
`region.declare` is still uncommitted in the main repo's working tree — so the
worktree was reset to the last commit that builds. The Win98 arms therefore
predate `9643d33a` (x87 micro-ops in the tree fold); a re-run on that commit may
reach further into mw3's and quake2's float code than what is recorded here.

Load average on this box ran **32 to 244** across the session, with **no rep
starting below 4** — so there is no quiet-window subset to flag separately, and
wall clock is not a measurement of anything. Every number below is **USER CPU at
fixed work**: an exact batch count (Win98) or an exact dispatch count (toyvm),
never a time budget.

Three arms, not two:

```
off   baseline flags
on    baseline flags + the arm switch
null  baseline flags AGAIN, under a different label
```

`null` is the control. It is the same binary doing the same work as `off`, so
every difference it shows is noise **by construction**. It is the ruler. The
arms are interleaved inside each rep with the order rotated per rep (`off on
null`, `on null off`, `null off on`, …), so a warm cache on the first arm or a
thermal ramp on the last cannot masquerade as the feature.

The prescribed verdict rule is `|mean(on − off)| > 2 × sd(null − off)`.
**That rule is conservative to the point of being uninformative on a box at load
200**, because the paired standard deviation is dominated by additive
interference that hits all three arms. So both statistics are reported: the
paired rule, and the **minimum**, which is the right robust statistic here —
scheduler interference can only ever *add* CPU time, so the minimum of N reps is
the closest thing to an interference-free sample, and `null_min − off_min` is
what that statistic's own noise floor looks like.

```
node tools/fold-ab.js --target=toyvm --exe=/tmp/demos/1995-c-cma_brw/BRW.EXE \
  --work=20m --reps=12 --arm-on='--tree-fold --tree-fold-hot=64' --out=BRW.json

node tools/fold-ab.js --target=win98 --app=quake2_demo --work=150 --reps=8 \
  --arm-on='--tree-fold' --base='--quiet-api --batch-size=200000' \
  --extra='--args=+set vid_ref soft +map demo1'
```

`--extra=` exists because `--base` is whitespace-split and quake2's args **must**
be pinned on every single run: `lib/apps.js` persists `config.cfg` across
processes, so an unpinned rep inherits the previous one's video driver and is
not the same work as its neighbours.

toyvm arms call `runDos()` in-process and read `guestCpuSecs`, the per-slice
`getrusage` meter `bench-dos.js --cpu-time` uses; spawning would bury a 0.5s
guest slice under node startup and a wasm module build. Win98 arms shell out to
`test/run.js` under `/usr/bin/time -l` and read the child's `user` seconds.

## toyvm: `--tree-fold --tree-fold-hot=64`, 20M dispatches, 12 reps

Seconds of guest CPU. Positive `on−off` is a LOSS.

```
                 MEDIAN                       MIN                  PAIRED MEAN ± SD
prog      off     on     null      off     on     null      on-off        null-off     rule
------- ------- ------- -------  ------- ------- -------  ------------- ------------- ----------
BRW      0.549   0.507   0.595    0.528   0.477   0.520    -0.011 ±0.078 +0.027 ±0.051 unresolved
RUNDEMO  0.178   0.227   0.180    0.146   0.207   0.156    +0.060 ±0.055 +0.005 ±0.059 unresolved
DADEMO3  0.329   0.380   0.348    0.290   0.339   0.286    +0.064 ±0.064 +0.005 ±0.079 unresolved
CATWALK  0.157   0.204   0.172    0.131   0.178   0.130    +0.064 ±0.045 +0.028 ±0.032 unresolved
DTM2     0.221   0.289   0.220    0.183   0.264   0.185    +0.050 ±0.048 -0.021 ±0.056 unresolved
CYCLE    0.384   0.432   0.395    0.332   0.402   0.330    +0.058 ±0.061 -0.007 ±0.046 unresolved

                 MIN-STATISTIC (interference can only add time)
prog     on_min-off_min   null_min-off_min   reading
------- ---------------- ------------------ ------------------------
BRW           -0.051            -0.008       resolved GAIN
RUNDEMO       +0.061            +0.010       resolved loss
DADEMO3       +0.049            -0.004       resolved loss
CATWALK       +0.047            -0.001       resolved loss
DTM2          +0.081            +0.002       resolved loss
CYCLE         +0.070            -0.002       resolved loss
```

Frame hashes are identical across all three arms on all six programs (BRW
`ecef58f7`, RUNDEMO `08502c5c`, DADEMO3 `88b5bd0e`, CATWALK `9af00ca9`, DTM2 and
CYCLE `38c165c5`), and the dispatch count varies by at most 25 out of 20,000,000.
The correctness contract holds. This is a cost question, not a safety one.

### The deterministic side, which the load cannot touch

One run per program, `--handler-hist` on, the gated arm. Counts, so these are
the same numbers at load 2 and at load 244.

```
prog     trees installs folds foldedOps  hotPromoted coldSkipped  tree entries  dispatches removed
------- ------ -------- ----- ---------  ----------- -----------  ------------  ------------------
BRW         36        2   275      1410           41         647       566,777   4,479,388  22.397%
RUNDEMO      8        2    18       101           14         118        46,080     230,400   1.152%
DADEMO3     42        2   214      1153           41         353        53,748     352,609   1.763%
CATWALK      4        2     4        19            6          82           526       1,578   0.008%
DTM2         4        2     4        22           21          34             0           0   0.000%
CYCLE        1        2     1         3           20          39             3           6   0.000%
```

## Win98: `--tree-fold`, 8 reps

Seconds of child-process user CPU. Negative `on−off` is a GAIN.

```
                        MEDIAN                        MIN                   PAIRED MEAN ± SD
app      work        off     on     null       off     on     null      on-off        null-off     rule
------- ---------  ------- ------- -------  ------- ------- -------  ------------- ------------- ----------
mw3     12 batch    15.615  15.555  15.525   14.630  14.790  15.090  -0.068 ±0.208 -0.011 ±0.356 unresolved
quake2  150 batch    5.200   5.135   5.225    5.120   5.060   5.130  -0.078 ±0.078 +0.009 ±0.076 unresolved

app      on_min-off_min  null_min-off_min  median on-off as %   reading
------- ---------------- ----------------- -------------------- --------------------------
mw3          +0.160           +0.460             -0.44%          unresolvable (null > on)
quake2       -0.060           +0.010             -1.25%          suggestive GAIN, not resolved
```

Deterministic side, one run each with `--loopmatch-stats --handler-hist`:

```
app      self-loops  TREE_FOLD  runs    iters     ops caught  retired ops  share of guest ops
         decoded     blocks                                   (folded)     the fold stands for
------- ----------- ---------- ------- --------- ----------- ------------ --------------------
mw3          27          5         255    35,863     251,018   10,087,199        2.4%
quake2      162         34      34,401   528,754   8,953,619  148,926,853        5.7%
```

Declines: mw3 `short 15 / long 0 / terminator 3 / unfoldable-op 4`; quake2
`short 47 / long 0 / terminator 69 / unfoldable-op 12`. Quake2's barrier is the
terminator, by a factor of six over unfoldable ops — that, not eligibility
width, is where its next tranche of reach is.

Pictures are byte-identical between arms: `png-diff.js` reports **0 of 76,800
pixels** differ for quake2 and **0 of 307,200** for mw3 at the measured batch
counts.

## Per app

**BRW** is the only program in the whole set where the gated toyvm fold pays for
itself, and it pays handsomely: 275 substituted blocks entered 566,777 times,
removing **22.4% of all dispatches**, and it is the one row whose min goes the
right way (−0.051s against a null of −0.008s) — about a 10% gain on a 0.53s
baseline. It is also, from the previous session's table, the row the fold was
designed around. One program is not a default.

**RUNDEMO** removes 1.15% of dispatches from 18 substitutions and pays +0.061s
on the min against a null of +0.010s. The cost is six times the yield. Note the
shape: 8 trees built, 14 blocks promoted hot, 118 skipped cold — the gate is
doing its job of not building junk, and the run still ends up slower.

**DADEMO3** builds the most trees of any witness (42, 214 substitutions, 1153
folded ops) for 1.76% of dispatches removed, and lands at +0.049s min against
−0.004s null. It is the clearest statement that *tree count is not yield*:
five times BRW's substitution effort into a program whose hot code is somewhere
else entirely.

**CATWALK** substitutes four blocks that are entered 526 times in twenty million
dispatches — 0.008%, i.e. nothing — and pays +0.047s. Its paired numbers land
exactly on the rule's threshold (|+0.064| against 2×0.032), which is the one row
where the conservative rule and the min statistic visibly disagree; the min is
unambiguous and the mechanism below says which to believe.

**DTM2** and **CYCLE** are the control pair, and they are the cleanest result in
the table. DTM2 enters its four trees **zero** times and CYCLE its single tree
**three** times, so the fold's yield on both is exactly nothing, and both still
pay +0.081s and +0.070s on the min against nulls of +0.002s and −0.002s. Two
programs where the feature provably did no work and still cost 20-30% of their
runtime is the measurement that identifies the cost, because it cannot be
anything the trees did.

**mw3** is the Win98 app the box could least afford. One batch costs ~1.3s of
user CPU, so the 12-batch fixed work here is ~15.6s and **the gameplay window at
batch 888 is out of reach by three orders of magnitude** — 888 batches is ~19
minutes of user CPU per run, ~7.6 hours for a 24-run protocol, against a 120s
per-run budget. What the boot window shows is 5 folded blocks catching 2.4% of
retired ops and a −0.44% median that the null arm swamps (`null_min` is 0.46s
*above* `off_min`, larger than the effect). Unresolvable, and honestly so.

**quake2** is the best-behaved measurement of the session: 150 batches, 5.2s per
run, an arm spread of ±0.1s, and the fold catching 5.7% of retired guest ops
across 34 folded blocks entered 34,401 times. Median goes −1.25%, min goes
−0.060s against a null of +0.010s, and the sign is the same under both
statistics. It fails the prescribed rule (0.078 against a 2×sd of 0.152) but it
is the only arm in the whole session pointing consistently at a gain.

## What is actually costing the toyvm arm 0.05-0.08s

Look at the loss column, not the programs: **+0.047, +0.049, +0.050, +0.058,
+0.060, +0.064 seconds** across programs whose *totals* range from 0.16s to
0.55s and whose yields range from 22.4% of dispatches to literally zero. A cost
that is constant in absolute seconds while everything else varies by 3.5x is not
a property of the trees. It is a fixed per-dispatch tax over a fixed window:
0.05-0.08s over the gate's `--tree-fold-warm=10m` profiling window is
**≈5-8 ns per profiled dispatch**, which is the size of the one load/add/store
`--block-hits` adds — the census the hotness gate profiles with.

`docs/toyvm-tree-fold.md` anticipated this exactly, and measured `blockhits`
alone as a control arm for it. What this session adds is the two programs that
turn the argument from an estimate into a subtraction: DTM2 and CYCLE run the
gate, build their trees, enter them 0 and 3 times, and still pay the full toll.

So the gate's economics are: **it pays the profiler everywhere and collects only
where a hot block is also foldable.** On this six-program set that is 1 program
in 6. The fix is not a bigger `--tree-fold-hot`; the threshold already declines
the right blocks (647 cold-skipped on BRW, 118 on RUNDEMO). The fix is making
the profiling window cheap or self-limiting — closing it early when the promoted
population stops growing, or sampling instead of counting every dispatch.

## Verdicts

| arm | app / program | verdict |
|---|---|---|
| toyvm `--tree-fold --tree-fold-hot=64` | BRW | **resolved gain** (min), ~10% |
| | RUNDEMO, DADEMO3, CATWALK, DTM2, CYCLE | **resolved loss** (min), 20-35% each |
| | all six, prescribed 2×null-sd rule | unresolvable at this load |
| Win98 `--tree-fold` | quake2 | unresolvable (suggestive gain, −1.25%) |
| | mw3 | **unresolvable at this load** |

**Flip nothing today.**

The toyvm gated fold must stay off: five of six witnesses are a resolved loss,
and the loss is a profiler tax that the feature pays whether or not it collects.
That is a design finding, not a load artifact, and no quiet box will change it —
DTM2 pays 0.081s for zero tree entries at any load.

Win98 `--tree-fold` is the arm to come back to. It is pixel-identical on both
apps, never regressed on either, catches 5.7% of quake2's retired ops, and both
statistics agree on the sign. It needs one thing this box cannot give: a rerun
of `tools/fold-ab.js --target=win98 --app=quake2_demo --work=400 --reps=8` at
loadavg under 4. If the −1.25% survives that, flip it; the 400-batch work size
is what the protocol wanted here and what the load would not allow.
