# Review: toyvm IRQ-schedule patch v2 (`dos-loop-irq-fix-v2.patch`)

Reviewer: worker B, 2026-10-05. Independent read of the patch against HEAD
`2683a6e31d0e95e7ffd1805fcafe013f94f1bcec`. Nothing here was run against a guest. The arithmetic
claims are checked by `schedule-model.js`, a pure-JS model whose expressions are grep-verified
against both source files (see `focused-checks.md`).

- Patch: `scratch/claude-orchestrator-20261004/toyvm-brw/dos-loop-irq-fix-v2.patch`,
  sha256 `4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78`.
- It applies cleanly to HEAD's `tools/toyvm/dos-loop.js`, and `tools/toyvm/` is clean against HEAD
  in the shared tree. The result has sha256 `bd4f1ee9eb1f…e016`, the same file the Phase 8b run
  validated.
- Line numbers: `H:` is HEAD's `tools/toyvm/dos-loop.js`. `P:` is the patched copy at
  `patched/dos-loop.js` in this directory.

## Verdict: LAND WITH FIXES

The four hunks are correct for the case they target. That case is an early handback landing
exactly on the date its slice was cut to: v2 no longer counts it as reaching the date, and it keeps
the date as the next slice's stop.

v2 does not close that class completely. Two other dates are still consumed or dropped by an
early handback that lands exactly on them (B1, B2). Two run-boundary effects also come from the new
rule (S1, S2).

All four fixes are a few lines each and live in the same function. Each one changes timing, so
each needs the same corpus before/after as v2. They should go into the build the corpus slot
measures, so the slot is spent once. A suggested delta is in `v3-delta-on-v2.patch` (sha256
`76825987…2e62f`). It is checked only with `node --check`, `patch --dry-run` and the model, and has
not been run on a guest.

One more blocker is about the landing commit, not the code (B3): the committed browser bundles
have to be regenerated, or the main build fails.

## The invariant v2 relies on

> **I1.** A slice that ends because it spent its budget always ends strictly past `stopAt`.

Why it holds: every budget test is `$steps < 0` at a transfer, and the budget is
`stopAt - dispatched`. So `left < 0` and `dispatched = start + budget - left > stopAt`. It follows
that `dispatched == stopAt` can only come from a handback with `left == 0`, which is an early exit,
or from a machine cut with `cut == 0`.

Every path that could break I1, checked:

| path | budget test | holds? | where |
|---|---|---|---|
| L1 blocks / `$next` | `steps < 0` at transfer | yes | emit.js:623, 731, 783 |
| VGA port-poll spin fold (`in_8_gspin`) | skips whole turns only while `steps >= S - n*cost >= 0`; exits on `< 0` | yes ("exit on the budget exactly where the one-at-a-time loop would") | emit.js:2232-2259 |
| ALU+Jcc port spin (`*_pspin`) | `steps < 0` after each turn; collapse keeps `steps >= 2` | yes | emit.js:3520-3561 |
| µop tier (`uopEnter`, uop-live.js:496) | engine `due` = `steps < 0` / `check` = `steps < I` | yes for budget exits. A program exit with `out >= 0` is an early handback, so v2 now treats `out == 0` as not reached, which matches L1 continuing to its transfer | uop-wasm.js:458, 470 |
| µop-only arm (uop-only.js:262) | hands back on `left <= 0` | `left == 0` returns become "not reached", followed by a budget-1 slice. Consistent with L1 (see N5) | uop-only.js:262 |
| region JIT / tree-fold | `$steps` billed before each branch, tested `< 0` (notes Phase 7 correction, 7b) | yes | region-jit.js 1520-1565 |
| `Machine.endSlice` cut | sets `steps = -1` and saves `left` into `sliceCut` | not a budget stop. `cut == 0` gives `d == stopAt` exactly, which is why hunk 2 keeps `>=` for cuts. **It interacts with hunk 1: S1** | dos.js:2799-2814 |
| TF single-step (`stepping`) | one-instruction block, `left = budget - ops >= 0` | early by construction. `d == stopAt` now means not reached, and the date is taken one instruction later (N3) | H:1526, 1837 |
| IRET / POPF / int-stub / far32 / v86 handbacks | `left = steps` (`>= 0`) | early. Fine | emit.js:962, 1433, 1472, 5366 |
| HLT (`H.end`) | early, `left >= 0` | early. Fine | decode.js:626-632 |
| host cap `this.slice` < `stopAt - d` | a budget stop past the *slice*, not the date | if the overshoot lands exactly on `stopAt`, v2 reads "not reached" and runs a budget-1 slice. Consistent | H:1711 |
| `max(1, …)` floor | budget 1 when `stopAt == d` | new in v2: before, `stopAt > d` always. See the livelock row below | P:1721 |
| `--no-irq-schedule` / `latticeClock` | `atStop` is `true`; `stopAt` is unused; `sbDueNow` keeps `>=` | inert, except the exit-kind label for `left == 0` (N1) | H:1710-1714, 1783 |
| `endAt` | `due(endAt)` | **S2:** the run loop ends at `dispatched == endAt` even when that handback was early | run-dos.js:825, H:2165 |

**Livelock.** Each date can cost at most one budget-1 slice that dispatches anything: one op makes
`d > stopAt`, and the date is then reached. A slice that dispatches nothing at all repeats forever,
but HEAD has that same exposure (`checkProgress` / `stuckLimit` exist for it). Nothing new. Phase 4
counted 280 tiny slices by 100M on BRW L1.

## Hunk-by-hunk

### Hunk 1: `stopAt = ceil(d/grain)*grain || grain`, `due()` accepts `at >= d` (H:1684-1685, P:1689-1695)

**Correct for its case.**
- `d = 0` gives `grain`, as HEAD does.
- `d = k*grain` (k > 0) gives `d` itself, with budget 1.
- `d = k*grain - 1` gives `k*grain`, with budget 1, as HEAD does.
- The model also checks that `ceil(d/g)*g` is exact and lies in `[d, d+g)` for `d` up to 2^40.

This is what moved BRW's first split from 88.9M to 115.06M (Phase 8b).

- **B1 (BLOCKER for the measured build, SHOULD-FIX for the code).** The tick date still uses
  `ceil((d+1)/tickUnit)` (H:1709, P:1719), so it excludes the odometer. An early handback landing
  exactly on a tick date `T`:
  - is not a stop under v2, so `setClock(T)` does not run;
  - and the next slice is not cut back to `T` either.

  Under the default clock, `T` is a lattice multiple (550000 = 22 × 25000), so the new `ceil` keeps
  it. It is **not** a lattice multiple under `--pit-clock`, under GUS-driven grain, or with
  `tickScale ≠ 1`. `--pit-clock` is exactly the witness recipe and the region-live-ab recipe.

  Model case 5: grain 801, T = 20,350,000, early at T. The next stop is 20,350,206, and T is lost.
  An arm without that early exit calls `setClock(T)` at T+k, so a guest reading the BIOS tick or the
  PIT phase in between sees different values in the two arms. This is the BLIQ class the doc names.
  Fix: `due(Math.round(Math.ceil(from / tickUnit) * tickUnit))`.
- **S1 (SHOULD-FIX).** A machine cut with `cut == 0` ends exactly on `stopAt`, and hunk 2
  deliberately counts it as reached (`clockAt = stopAt`). Hunk 1 then sees `d == stopAt`:
  - if `stopAt` is a lattice point, `ceil` returns it;
  - otherwise, `due(at >= d)` re-accepts it when it is a due date whose mark did not advance (for
    example a timer that lost its rung to the SB interrupt).

  So the same date is stopped at **twice**: budget 1, then a second `atStop` handback with the same
  `clockAt`. That gives a zero-length `audioAdvance`, and a second IRQ rung can fire at a date
  already consumed (model case 3). A cut is a guest instant, so both arms do this identically. It is
  baseline noise, not cross-arm divergence.

  Fix: remember the last reached date and start from `from = max(d, reachedAt + 1)`.
- **N2 (NOTE, comment accuracy).** The comment's "only an early handback can" sit on a lattice
  point, and "A date a budget stop reached is always behind the odometer", are both too strong:
  - A cut can land on its date (S1).
  - A budget stop at `S` whose overshoot lands exactly on a *different* date `D` (or lattice point)
    leaves `d == D`. v2 then takes `D` with an extra budget-1 stop, where HEAD skipped it (model
    case 6).

  Taking `D` is consistent with "reached = strictly past", so the behaviour is fine. It is a
  baseline change, and the comment should say so. Dates strictly inside an overshoot window are
  still skipped, as at HEAD. That is the pre-existing residual, not something v2 introduces.

### Hunk 2: `atStop = !sched || d > stopAt || (cut >= 0 && d >= stopAt)` (H:1783, P:1801-1802)

**Correct.** It relies on I1 (see the table). The cut clause keeps HEAD's behaviour for a guest
instant. A cut can never give `d > stopAt`, since `cut >= 0` implies `d <= start + budget`, except
on the floor budget of 1, where `cut == 0` gives `d = stopAt + 1`, which is still reached.

- **B2 (BLOCKER for the measured build, SHOULD-FIX for the code).** H:1801-1804 (P:1820-1823)
  still advances `vgaFrame` from `clockAt` on **every** handback, and `clockAt` equals the odometer
  when `!atStop`.

  For a non-stop handback, `d <= stopAt <= (vgaFrame+1)*period`, so a frame changes only when an
  early handback lands exactly on the edge. That is the very case v2 creates. There:
  1. The edge is armed (`retraceEdge = true`) and `vgaFrame` moves on, so the next slice's
     `due((vgaFrame+1)*period)` is the following frame, and the edge date is dropped.
  2. The retrace IRQ waits for whatever stop comes next.

  An arm without the early exit stops at edge+k and delivers it at the edge (model case 4). This
  has the same shape as the `sbDueNow` defect that hunk 4 fixes. It matters for programs that hook
  IRQ2. No test covers IRQ2 retrace delivery: `test-toyvm-retrace.js` covers only the port-3DAh
  status bit.

  Fix: `if (this.vgaPeriod && atStop)`. Under `--no-irq-schedule`, `atStop` is always true, so
  that path is unchanged. For any other early handback, the frame index cannot change.

### Hunk 3: exit label `left < 0 ? date/budget : early` (H:1841, P:1860)

**Correct.** A `left == 0` handback is never a budget stop (I1).
- **N1 (NOTE).** It changes `exitKinds` under every clock, `--no-irq-schedule` included. µop-program
  exits and HLT handbacks with `left == 0` now count as `early <why>`, which is `early ?` when
  `exitwhy` is 0.

  `exitKinds` is only reported (`--handback-kinds`, sweep-dos rows). No test asserts it, and
  sweep-diff does not compare it (grep: no reader in `test/test-toyvm-*.js` or `sweep-diff.js`).
  Mention it in the commit message, because any corpus diff of `exitKinds` will move.

### Hunk 4: `sbDueNow` strict under the schedule (H:1943, P:1969-1971)

**Correct.** Under the schedule, a non-stop handback has `d <= stopAt <= audioAt + sbInterval`
whenever `due()` accepted the SB date. So strict `sbDueNow` is true only when that date was already
*overdue* at slice start (rejected by `due`).

That is exactly how the patch stops an exact-on-date early handback from consuming the date. Model
case 9 shows both sides.

- **N4 (NOTE, pre-existing, not v2).** In the overdue case (a previous stop overshot the SB date by
  more than `sbInterval >= 200`, which is possible with large region lumps), an early handback
  still renders with `audioAt = odometer` (H:1954). That is the Phase 7c residual. The schedule
  comment at H:1944-1946 says `stopAt` already holds both clauses, so the candidate follow-up is
  `this.irqSchedule ? atStop : …`, which drops `sbDueNow` under the schedule. That is a separate
  baseline change; it is not needed for v2.

## Run boundary

- **S2 (SHOULD-FIX).** The run loops are `while (dispatched < budget)` (run-dos.js:825,
  dos-loop.js:2165). An early handback landing exactly on `endAt` therefore ends the run, even
  though under v2's own rule the date was not reached. That arm gets no final `audioAdvance` and no
  final IRQ rung. An arm that budget-stops at `endAt+k` renders up to `endAt` (model case 8).

  The result is a different final wav length or hash across arms, at a rate of roughly one per few
  hundred runs on handback-heavy region arms. In the corpus A/B it would show up as a spurious
  "BROKE" row. Fix: loop while `dispatched < budget || owesEnd(budget)`, where
  `owesEnd = irqSchedule && !lastAtStop && dispatched === budget`. The suggested delta does this in
  both loops.

## Landing mechanics

- **B3 (BLOCKER for the commit).** `tools/build.sh:155` runs `node tools/toyvm/bundle-browser.js
  --check`, and `docs/dos-corpus/live/toyvm-bundle.js` / `toyvm-jit-bundle.js` inline `dos-loop.js`
  verbatim. Both currently contain the HEAD `floor+grain` line (1 match each). A commit carrying v2
  without `node tools/toyvm/bundle-browser.js` (no `--check`) and the two regenerated bundles fails
  the main build gate. Note that `docs/dos-corpus/live/` is the deployed site.
- **N6.** `test/test-toyvm-uop-live.js` has an uncommitted edit by another agent in the shared tree
  (CHAIN option). The corpus plan therefore runs the HEAD copies of the tests, from a pinned
  archive.

## Other notes

- **N3.** TF single-stepping (`stepping`). Each slice is one instruction. HEAD took a date when an
  instruction ended exactly on it; v2 takes it at the next instruction (`d = stopAt + 1`), still
  with `clockAt = stopAt`. Every arm steps identically, so this is not a divergence, but it moves
  the interrupt one instruction later for INT 1 protectors such as JULTRO.EXE (in the corpus). It
  is a baseline change, to be expected in the l1 diff.
- **N5.** Budget-1 slices can enter a µop head through `uopEnter(vm, 1)`. Each such entry counts
  toward uop-live's "short entries" demotion test (uop-live.js:527). This is rare: it needs an
  exact-date early handback at a head. It could still change a demotion decision, so read the `uop`
  arm's install counts in the corpus output.
- **N7.** Every comparison in the plan should use HEAD's `tools/toyvm` closure for both arms, from
  a pinned `git archive`. Running the "after" arm from a private copy and the "before" arm from the
  shared tree is not equivalent. `dos.js` reads `../../fonts/Terminal.fon` relative to its own
  directory, and silently falls back to blank text tables when the file is missing. `vm.js`
  requires `../../lib/compile-wat.js`, and `run-dos.js` requires `../disasm` → `./simd-ops`. A
  private tree without those files either fails to load or differs from the shared tree. Verified
  here: the first require of a bare copy failed on `../disasm`.
- **N8 (testability).** `test-toyvm-irq-early-handback.draft.js` does not reproduce the bug, so
  nothing in the suite pins v2's behaviour. The cheapest durable test is a refactor: move the
  stop/due/atStop arithmetic into a pure `planSlice({d, grain, dates, reachedAt})` and
  `reached({d, stopAt, cut})` pair, and unit-test the cases in `schedule-model.js`. Then add one
  integration case through `DosSession` with a forced early exit on a date. Not needed for landing,
  but without it the next clock change can silently undo this one.

## Findings index

| id | class | location (HEAD) | one line |
|---|---|---|---|
| B1 | BLOCKER (measured build) | dos-loop.js:1709 | tick date skipped after an exact-date early handback under `--pit-clock`/GUS/tickScale |
| B2 | BLOCKER (measured build) | dos-loop.js:1801-1804 | VGA frame edge consumed by an exact-date early handback |
| B3 | BLOCKER (commit) | tools/build.sh:155, docs/dos-corpus/live/toyvm-*bundle.js | bundles must be regenerated with the patch |
| S1 | SHOULD-FIX | dos-loop.js:1684-1685 + 1783 | `cut == 0` on the stop gives a double stop at one date |
| S2 | SHOULD-FIX | run-dos.js:825, dos-loop.js:2165 | run ends on an exact-endAt early handback without reaching the date |
| N1 | NOTE | dos-loop.js:1841 | `exitKinds` label shifts under every clock |
| N2 | NOTE | patch comments | "only an early handback can" / "always behind the odometer" are overstated; budget stop onto another date now takes it |
| N3 | NOTE | dos-loop.js:1526 | TF stepping takes dates one instruction later |
| N4 | NOTE (pre-existing) | dos-loop.js:1943-1954 | overdue SB date still renders at the odometer on an early handback |
| N5 | NOTE | uop-live.js:527 | budget-1 µop entries feed the short-entry demotion |
| N6 | NOTE | test/test-toyvm-uop-live.js | another agent's uncommitted edit; plan uses HEAD copies |
| N7 | NOTE | dos.js:53, vm.js:18, run-dos.js:31 | private trees need the font/lib/disasm closure, both arms identical |
| N8 | NOTE | — | no reproducing test; extract a pure planner and unit-test it |
