# Combined correctness run 2026-10-05T20:05:54Z: result, timeout diagnosis, replay proposal

**Run:** granted by root as a sole 600 s run, released 20:12:10Z.
- **Wrapper:** node PID 3182974. The board's first SESSION line named PID 3182972, which was `setsid`'s own PID before it forked; a CORRECTION was posted at 20:06:07Z.
- **Elapsed:** 354.181 s, with no signal and no error.
- **Inputs:** runner `80d8f879…` and `build-tree.js` `b2d24038…`, both byte-identical to main `ff4c20f2`; candidate `ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4`; base `2683a6e3`; stack = v2v3j `54de1b13` + v4 `4b00d26d` + smc `b3371e21`.
- **Exact output:** `correctness-600-20261005T200554Z/`, which holds `result.json` and the 32 per-step logs (the two builds plus 15 tests in each of 2 trees).

## Result

| test | cand | stack | compare |
|---|---|---|---|
| pm-timer-vector, sb-single-cycle, sb-highspeed-autoinit, uop-only, region-live, region-install-clock, uop-live, retrace, audio, operand-patch, volatile, arena-recycle, live | PASS | PASS | same |
| tree-fold | TIMEOUT (60 s, SIGKILL) | TIMEOUT (60 s, SIGKILL) | incomplete (timeout: cand TIMEOUT, stack TIMEOUT) |
| uop | TIMEOUT (60 s, SIGKILL) | TIMEOUT (60 s, SIGKILL) | incomplete (timeout: cand TIMEOUT, stack TIMEOUT) |

There is no REGRESSION, no FIXED and nothing SKIPPED. The two TIMEOUTs are not counted for or against the candidate. Both builds passed.

**Cleanup:** `treesRemoved` is `[true, true]`, and no runner, build or test process remained afterwards (root verified that every recorded PID is gone).

**Remaining artifact:** the killed `tree-fold` tests each left their own `mkdtemp` directory behind (`/tmp/toyvm-tree-fold-u06VQQ` for cand, `/tmp/toyvm-tree-fold-dz5rAX` for stack; 320-byte `.COM` files only). The test removes that directory only at its normal end, not on SIGKILL. They are kept, because they are the progress evidence below.

## Diagnosis (source plus run artifacts; no rerun)

**Both timeouts remain unclassified and incomplete until a replay.**

What the artifacts do show is limited:
- no assertion failure was observed in either test, in either tree;
- each test made real case progress during its 60 s before the cap.

What they do not show:
- that either test would have completed;
- that it was still progressing at the moment of the kill;
- that the next, unfinished case was not stalled.

A hang inside a case remains possible, including in uop's in-process execution. All timings below are estimates from partial progress, not measurements of a full pass.

### tree-fold (`test/test-toyvm-tree-fold.js` at 2683a6e3, 1619 lines)

**Output:** it prints exactly one line, `PASS test-toyvm-tree-fold: …`, and only at the very end (`:1618`). Its 0-line logs therefore carry no progress information.

**Structure:**
- 43 cases (`CASES`, `:244–1197`), each in its own `.COM` written into an `mkdtemp` directory (`:1233–1238`).
- Each case spawns 2 to 6 `run-dos.js` children, at `--dispatches=8000000 --slice=20000` with a 120 s child timeout (`:1210–1217`):
  - plain and folded, always;
  - a no-calls arm and two IRQ arms for the call cases;
  - `relax=none` and all-but-one relaxation arms for the relaxation cases;
  - a no-loops arm.
- After the loop come about 7 more gate children (plain, hot=64, hot=50000, min-payoff, installs, both) and an in-process clock A/B (two `runDos` calls of 8M dispatches at slice 2M and slice 20k, `:1593–1612`).

**Actual progress, read from the case files the test writes before each case's runs:**

| tree | test window | case files written | last case started | completed cases in 60 s | mean per case |
|---|---|---|---|---|---|
| cand | 20:06:23 – 20:07:23 | 29 | `repcmps` (29/43), at 20:07:23.147 | 28 | ~2.1 s |
| stack | 20:09:19 – 20:10:18 | 23 | `strseg` (23/43), at 20:10:17.8 | 22 | ~2.7 s |

**What this shows:**
- Setup was short: the first case file appears within the test's first second.
- Cases were starting until shortly before the cap. The last file is ~0.1 s (cand) and ~1 s (stack) before the kill.
- Both trees went through the same cases in the same order.

**What it does not show:**
- that the case started last would have finished;
- that the test would have completed.

**Other notes:**
- The stack tree's lower rate came later in the run, under different box load. It is not evidence about either tree.
- `leftoverGroup=true` in both trees means `run-dos` grandchildren were still alive at the kill. That is consistent with a case being mid-run; it does not tell a running case apart from a stalled one. The grandchildren were reaped.

**Estimate for a full pass** (an extrapolation from partial progress, not a measurement):
- cases: 43 × 2.1–2.7 s ≈ 90–115 s;
- the call-case extras;
- the gate section: about 7 children at ~2–3 s, plus two 8M in-process runs.

That is ≈ **120–160 s per tree on this box**.

### uop (`test/test-toyvm-uop.js` at 2683a6e3, 724 lines)

**Output:** it prints `ok <tag>: 28 pass configurations x 12 budgets agree` per case tag, and a final `ok test-toyvm-uop: N differential runs agree` (`:715, :719`). The logs therefore show exact progress.

**Structure:**
- 14 case functions, with `dshift` having an extra head (`dshift@147`, `:411`), giving 15 tags.
- Each tag: one capture, then 28 ablation configurations × 12 budgets, the largest budget being 200,000.
- This is all in process. That does not rule out a hang: in-process execution can stall just as a child process can.

**Progress:**

| tree | tags ok (in order) | not reached |
|---|---|---|
| cand | 12: sprite, checksum, mixed, flags, carry, muldiv, divfault, segloads, dshift, dshift@147, segfwd, shifts | rotcarry, memshifts, wraps |
| stack | 10: … through dshift@147 | segfwd, shifts, rotcarry, memshifts, wraps |

**Per-tag agreement:**
- Every tag both trees reached agreed in all 336 differential runs. No `assert`/fail text appears in either log.
- On the 10 tags both reached, the per-configuration µops/iteration lines are identical between the trees. The diff of the two logs is exactly the two extra cand tags.

**What the logs can and cannot say:** the log lines have no timestamps.
- The completed tags prove progress at some point before the cap.
- They do not show whether the test was progressing at the cap.
- They do not show whether the next tag (cand `rotcarry`, stack `segfwd`) stalled.

**A plausible, unconfirmed reason it ran long:** the unreached tags include the heaviest by construction. The `shifts` naive arm is 1083 µops/iteration against `sprite`'s tens, and `rotcarry`/`memshifts` are the same rotate/shift families over 8/16/32-bit widths and three operand forms. This is a hypothesis for the replay to test, not a finding that the test is long rather than stuck.

**Estimate for a full pass:** ≈ 120–180 s per tree on this box. This is an estimate only, and weaker than the tree-fold figure: there are no per-tag timestamps, and the cost per tag is not uniform.

## Replay proposal (bounded, NOT run; needs an explicit root grant)

**Queue and scope:**
- Queued after the current Daggerfall run and the Arena/short Ski proof, in whatever order root grants.
- It intentionally keeps the original base `2683a6e3` and the pinned stack, so it replays exactly the same comparison.
- Main's install(false) accounting fix (`69c1371b`) is separate, and is not part of either tree.

**Recommended: the same pinned runner, unchanged, with only these two tests and realistic caps.** No code change, and the comparison stays both-trees, same order, same archive:

```sh
cd /home/user/wine-assembly/scratch/claude-toyvm-brw-v2-review-20261005/correctness-600-staged
node run-toyvm-tests.js --out=/home/user/wine-assembly/scratch/runs/claude-toyvm-if-replay-treefold-uop-<UTC stamp> \
  --plan=cand,stack --tests=tree-fold,uop --total=1260 --per-test=300 \
  --candidate=$PWD/candidate-v2.diff \
  --candidate-sha=ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4
```

- **Per-test cap 300 s:** about 2× the higher estimate for either test.
- **Total 1260 s:** 4 × 300 s plus both builds and margin. A fifth step can never start, and if the total runs out first, what is left is recorded SKIPPED and not counted.
- **Expected wall time:** about 8–12 min if both tests finish near their estimates.
- **What still counts:** a TIMEOUT at 300 s still counts as incomplete, never as a REGRESSION. In that case the next step is the targeted form below, not a longer cap.
- **Archive:** the runner archives all 15 defaults plus the require closure regardless of `--tests`, as before.

**Narrower fallback, if root prefers a smaller grant:**
- **uop:** run per tag with its own `argv[2]` filter (`:676`): `node test/test-toyvm-uop.js <tag>` inside each built tree, covering only the 5 tags that the stack tree did not reach (segfwd, shifts, rotcarry, memshifts, wraps), at about 90 s per tag per tree. The runner does not pass per-test arguments, so this would be a reviewed driver change or `build-tree.js` trees driven by hand; it is not proposed as the first option.
- **tree-fold:** it has no case filter, so it can only be replayed whole.

**Not part of either option:** benchmark, disassembly, promotion, and any change to the candidate or the tests.
