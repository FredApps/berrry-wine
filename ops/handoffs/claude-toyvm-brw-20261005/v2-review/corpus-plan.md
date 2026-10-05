# Corpus before/after plan: landing the toyvm IRQ-schedule patch

Nothing in this plan has been run. Every command is in `corpus-plan.sh` in this directory, which
passes `bash -n`. The driver `corpus-ab.js` passes `node --check`, and its compare, moved and nudge
modes were self-tested on synthetic rows.

## Pins

| what | value |
|---|---|
| base commit | `2683a6e31d0e95e7ffd1805fcafe013f94f1bcec` (HEAD on 2026-10-05). `tools/toyvm/` is clean against it in the shared tree. |
| patch v2 | `scratch/claude-orchestrator-20261004/toyvm-brw/dos-loop-irq-fix-v2.patch`, sha256 `4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78` |
| v3 delta (recommended, see review.md B1, B2, S1, S2) | `v3-delta-on-v2.patch`, sha256 `76825987d215d05287ace963b7fb8e15f0448371df0aa6d148cd683e89b2e62f` |
| tree hashes after patching | base `dos-loop.js` `ebe0eb30…de8e21`; cand v2 `bd4f1ee9…e016`; cand v3 `eeb9e2cd…085c1`, and its `run-dos.js` `82ae85cd…6dea` |
| corpus | the 199 programs of `docs/dos-corpus/live/programs-index.json` (146 directories, 684 files, 70.4 MiB), unpacked by `unpack-corpus.js` from the committed site bundles. Content sha256 `3f9b2023…fc475`. The resulting list is `programs-199.txt`, rebased to `$W/demos`. BRW.EXE in it is byte-identical to the longrun-bg fixture (`65b61f6c…ddfeb4`). |
| node | v24.18.1 (main host) |
| scripts | `corpus-plan.sh` `aa6d35e6…`, `corpus-ab.js` `362d4c5e…`, `unpack-corpus.js` `56283121…` |

**Coordinator decision 1: measure `CAND=v3` (v2 plus the delta) or `CAND=v2`.**
I recommend v3. Every item in the delta moves timing, so measuring v2 and then landing the fixes
would need a second slot.

## Layout (why both arms come from pinned archives)

```
$W/base/  git archive $BASE <closure> test/test-toyvm-*.js   + node_modules symlink
$W/cand/  same, then patch -p1 < v2 [< v3 delta]
closure = tools/toyvm tools/fnt-read.js tools/ne-dump.js tools/disasm.js tools/simd-ops.js
          lib/compile-wat.js lib/wat-manifest.js fonts/Terminal.fon          (2.8 MB per tree)
$W/demos/ the unpacked corpus (70.4 MiB)       $W/out/ results        $W/logs/ per-run logs
```

Both arms run from identical, pinned copies. That way the shared tree can change during the slot
without affecting the comparison. `test-toyvm-uop-live.js` has an uncommitted edit there today, and
it will not be in either tree.

The closure is the minimum that loads. A bare copy of `tools/toyvm` fails on `../disasm`, which
was verified. If `fonts/Terminal.fon` is missing, the text tables are silently blank. Disk needed:
about 90 MB plus outputs (well under 10 MB). The main host has about 600 MB free. `prep` aborts
below 300 MB.

## Phases

Run as `W=<dir> CAND=v3 JOBS=3 bash corpus-plan.sh all`, or phase by phase. Each line below says
what the phase gates.

**P0 `prep`** (about 3 min)
- Build both trees and regenerate each tree's browser bundles: `node tools/toyvm/bundle-browser.js`,
  needed by `test-toyvm-browser-bundle.js`.
- Unpack the corpus and check its hash.
- Smoke-run BRW for 10M dispatches in each tree.
- Abort on any hash mismatch or a smoke failure.

**P1 `tests`** (both trees in parallel, one core each; estimate 15-20 min)
- Every HEAD `test/test-toyvm-*.js` (28 suites), each with `timeout 600`.
- **Gate:** no suite passes on base and fails on cand. If one does, abort the slot before any
  corpus time is spent.

**P2 `sweep`** (the schedule doc's corpus gate, verbatim; runs alongside P1 on the other two
cores; estimate 30-45 min, capped by `SWEEP_S=3000`)
```
node $W/{base,cand}/tools/toyvm/sweep-dos.js --dir=$W/demos --dispatches=8m --reps=1 --timeout=180 --out=$W/out/sweep-{base,cand}.json
node $W/cand/tools/toyvm/sweep-diff.js $W/out/sweep-base.json $W/out/sweep-cand.json
```
- This is the four interpreter shells plus the JIT-tier bench, with the default silent card, as
  docs/toyvm-irq-schedule.md "Gates" ran it.
- **Gate:** `REGRESSIONS: 0` and `WENT BLANK: 0`. A blank is discharged only as sweep-diff.js
  instructs: re-run at matched `--guest-seconds`, and do not widen the filter.
- `do.exe`-style `arms-disagree` recoveries are wins. A new `arms-disagree` is a regression
  (sweep-diff reports it as a status change).
- Known blind spot: rows are keyed by basename, so the 199 programs collapse to 191 names
  (two BLIQ.EXE, three ZERO-BBS.EXE). P3 is keyed by path.

**P3 `arms`** (the question v2 exists for; both trees in parallel, 2 jobs each; estimate 30-40
min, capped at slot end minus 30 min)
```
node corpus-ab.js --tree=$W/{base,cand} --list=$W/programs.txt --arms=l1,jit-early,jit-sepc,fold64 \
  --recipe=witness --budgets=80m --jobs=2 --timeout=300 --max-seconds=S --out=$W/out/arms-{base,cand}.ndjson
node corpus-ab.js --compare=$W/out/arms-base.ndjson,$W/out/arms-cand.ndjson --md=... --moved=$W/out/moved-80m.txt
```
- The recipe is the doc's witness recipe (`--pit-clock --auto-key --sound-pref=sb
  --env=ULTRASND=220,1,1,11,7`, audio at 22050). The arms are the doc's three: plain;
  `--tree-fold --tree-fold-hot=64`; `--region-jit` on the CLI's 6M/6M schedule with the speed gate
  off (`gateAt: 0`, so a loaded box cannot quietly install nothing). The fourth is BRW's failing
  arm, `jit-sepc`, from arm-bench.js.
- Per row it records frame, pixels, wav (sha256 of the rendered wav), irqs, ints, dispatched,
  handbacks, exit kinds, and the JIT phase.
- A run that P3's cap cuts short covers the same prefix of the list in both trees.

**P4 `control`** (about 5 min)
- l1 only, `--no-irq-schedule`, 8M, both trees.
- **Gate: `0 of N l1 rows moved`.** The patch must be inert off the schedule. By reading the code
  this should hold for v2 and v3 alike; only `exitKinds` changes, and the compare ignores it. Any
  moved row means a leak and **blocks**.

**P5 `brw`** (about 1 min)
- BRW.EXE to 500,918,116 dispatches, l1 and jit-sepc, both trees, through the original
  `brw-bisect.js` (copied to `scratch/o/toyvm-brw/` so its ROOT resolves to the tree), with
  `--trace-irq`.
- Expected values, from notes Phase 8b:
  - base: l1 frame `a066bf27`, jit-sepc `2fa3dd95`.
  - cand: first l1-vs-sepc differing delivery **no earlier than 115.06M** (v2 measured
    `sb at=115063087` vs `115063080`). The l1 frame may move; that is a baseline change.
- **Gate:** the cand's first split is not earlier than 115.06M.

**P6 `nudge`** (the schedule doc's rubric for moved frames; about 5-10 min, scales with the number
moved)
- Every program whose l1 row moved, in either P2 (`changed`) or P3, is re-run at
  8.00/8.01/8.02/8.04M in both trees: `corpus-ab.js --budgets=8m,8.01m,8.02m,8.04m`, then
  `--nudge=`.
- Each one is classified the way docs/toyvm-irq-schedule.md "The corpus run" did:

| class | meaning | action |
|---|---|---|
| reappears | a frame the before tree draws at some nudge, the after tree also draws | expected (retiming) |
| unstable | one tree's own hash changes across a 0.5% nudge, so it was never an identity | expected |
| STABLE-DIFF | one frame per tree, and they differ | one line of reason each. Locate it with a 0.1M walk of the before tree (`after@8.00M == before@X`), as the doc did for BKSNOTE. Must still draw (pixels > 0); a loss of pixels **blocks**. |

## Outputs to compare

| output | P2 | P3 | P4 | P5 | P6 |
|---|---|---|---|---|---|
| frame hash | yes | yes | yes | yes | yes |
| wav hash | n/a (silent card) | yes (sha256-16) | n/a | n/a | n/a |
| irqs | n/a | yes | yes | yes, plus a per-delivery list | n/a |
| ints | n/a | yes | yes | yes | n/a |
| dispatched | yes | yes (±64, arm-bench's OVERSHOOT) | yes | yes | n/a |
| pixels / went blank | yes | yes | yes | n/a | n/a |
| handbacks, exitKinds | yes (report only) | yes (report only) | n/a | yes | n/a |

## Gates, in one place

**BLOCKING** (any one of these means do not land):
1. A P1 suite goes pass → fail.
2. P2 `REGRESSIONS` > 0 or an undischarged `WENT BLANK`.
3. P3 `BROKE` > 0: a (program, arm) pair that agreed with l1 on base and disagrees on cand.
4. P3 health regressions: ok → crash, timeout or stuck, or went blank, on cand only.
5. P4 any moved row.
6. P5 cand's first split is earlier than 115.06M, or a cand crash.
7. P6 a STABLE-DIFF that lost pixels.

**EXPECTED** (not blocking): l1 frame, wav or irq moves on time-paced programs, each classified in
P6; `dispatched` shifts within 64; `exitKinds` label shifts (review N1); the BRW l1 frame at 500M
(Phase 8b already saw endHash move).

**Direction check (must hold):** for every arm, P3 agreement after ≥ agreement before. `fixed` rows
are the benefit to quote.

## Abort criteria

- P0: any pinned hash differs, smoke fails, or free disk < 300 MB. Abort the slot.
- P1: the suite gate fails. Abort and report; do not run P2/P3 (P2 may already be running in
  parallel: kill it).
- P2/P3: if P3's rolling compare (re-run `--compare` on the partial ndjson every about 50 programs)
  shows `BROKE` ≥ 5, or ≥ 3 cand-only crashes or timeouts, stop P3 and report. That is a design
  problem, and spending the rest of the slot will not fix it.
- Slot clock: P3 gets `--max-seconds = time left − 30 min`. P4-P6 need about 15 min. If fewer than
  10 min remain, skip P6 and report the moved list unclassified.

## Runtime and slot

Rates are derived from measured runs on this host. BRW: L1 500M in 5.8 s, jit-sepc 500M in 11 s
wall / 13 s CPU (longrun-bg result.json). That is a fast program. Handback-heavy ones run slower
and are capped by the per-run timeouts.

Per program at 80M, estimated: l1 about 2-4 s, fold64 about 4 s, jit-early about 4 s, jit-sepc
about 5 s. That gives about 15 s × 199 × 2 trees ≈ 100 CPU-min for P3. The P2 sweep is serial per
tree: about 8-12 s per program, so about 30-40 min per tree with the two trees in parallel.

Nothing in the corpus has been timed under this exact recipe, so treat these as ±50%.

| host | layout | estimate | **slot to request** |
|---|---|---|---|
| main host (4 cores, 7 GB RAM, about 4 GB available; JOBS=3, child heap 1536 MB) | P0 → (P1 ‖ P2) → P3 → P4 → P5 → P6 | 100-110 min | **120 minutes, one root slot, exclusive use of all 4 cores** |
| worker box (≥ 16 cores, ≥ 16 GB) | P2 sharded: split `programs.txt` into 8 lists, pass each as positional args to sweep-dos.js, merge with `jq -s '{opts: .[0].opts, rows: map(.rows) \| add}'`; JOBS=14 | 35-45 min | 60 minutes |

On the worker box:
- Copy `$W/base`, `$W/cand` (or build them with `git archive` from a clone at `$BASE`), this
  directory, the two patches and `docs/dos-corpus/live/programs*` (about 100 MB), or the unpacked
  `$W/demos` (70 MB).
- **It still needs `boat login`, which is the current blocker.**

Partial-slot fallback, if only 30 min can be granted: P0 + P1 + P4 + P5 + a P3 limited to the six
doc witnesses plus BRW and DREAM, with `--list` holding those eight paths, at 80M, about 8 min.
That checks the doc's "all six identical in all three arms" claim and BRW, but **it is not enough
to land**: the doc's own gate is the full-corpus P2.

## After the slot (landing checklist; coordinator or the landing agent)

1. Apply v2 and, if chosen, the v3 delta in the shared tree.
2. `node tools/toyvm/bundle-browser.js`. Commit `docs/dos-corpus/live/toyvm-bundle.js` and
   `toyvm-jit-bundle.js` with the source, or `tools/build.sh:155` fails (review B3).
3. Add a section to `docs/toyvm-irq-schedule.md`: the before/after tables from `out/`, using the
   doc's "The baselines changed" framing.
4. Promote `test-toyvm-irq-early-handback` only once it reproduces (review N8).
