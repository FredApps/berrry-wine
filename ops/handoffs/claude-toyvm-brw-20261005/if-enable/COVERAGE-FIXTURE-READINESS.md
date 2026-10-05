# Region/fold coverage fixture: combined candidate + baseline readiness (source only)

Prepared for root's review of 4604ee8a. It is queued after Daggerfall (PID 3116623, 600 s) and the
Ultima original-save-overlay run (600 s). Not granted, and nothing has run.

## Exact pins (all on claude/toyvm-brw-phase5-20261005 at 4604ee8a)

| file | sha256 |
|---|---|
| `if-enable/test-toyvm-irq-if-enable.js` (8 cases: the original 6 + `region_coexist`, `sti_in_loop`) | 8875ff18cc56437c… |
| `if-enable/build-tree.js` | b2d24038e2d63292… (unchanged since 2ebe2aa8) |
| `if-enable/run-fixture.js` | d86f384c17ef99d6… (unchanged since 2ebe2aa8) |
| `if-enable/impl-draft/candidate-v2.diff` | ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4 |

The original six programs are byte-identical to every earlier run (checked with `cmp`). The two
new programs were statically disassembled.

## Plan: one wrapper process, one 300 s total bound

    node ifen-pinned-cov/run-fixture.js --out=<fresh>/ifen-fixture-cov-<ts> --total=300 \
      --plan=cand,stack --candidate=ifen-pinned-cov/impl-draft/candidate-v2.diff \
      --candidate-sha=ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4

- **Order:** the candidate first, then the stack baseline.
- **Time:** each test gets `TOYVM_TEST_TOTAL_S` = min(140, remaining − 2). Measured: 6 cases × 5 arms
  took 17 s, so 8 cases should take about 25 s per tree, roughly 60 s in total.
- **Head is omitted.** Its six-case output was byte-identical to the stack's (bce16cb1), so the stack
  is the baseline the candidate is applied to. Root can add `,head`, and the wrapper gives it what
  remains.
- **Procedure,** same as CANDIDATE-FIXTURE-READINESS.md:
  - preflight;
  - extract the four files from 4604ee8a into a fresh `ifen-pinned-cov/` and verify all four
    hashes (refuse on mismatch);
  - CLAIM, then SESSION with the wrapper PID and child PIDs from `result.json`;
  - cleanup checks (`treesRemoved` all true, process tree clear, no `/tmp/toyvm-ifen-*`), then
    RELEASE.
- **Classification, per tree:**

  | class | meaning |
  |---|---|
  | PASS | test exit 0 |
  | ARCH-FAIL | exit 1 with `FAIL` lines |
  | HARNESS-FAIL | anything else, including a candidate compile failure |

## Expectations, stated before running

| tree | case | [1] at boundary | [2] shadow | [3] parity |
|---|---|---|---|---|
| cand | original 5 counted | 8/8 (as 18b17779) | none | same |
| cand | `region_coexist` | ≥ 7 at X | none | same |
| cand | `sti_in_loop` | ≥ 7 at Y (after the NOP in the loop) | none at the NOP or at X | same |
| stack | original 5 | 0 at X (as bce16cb1) | none | same |
| stack | `region_coexist`, `sti_in_loop` | expected to fail [1] | measured | measured |

`sti_movss` is informational in both trees.

## How to read engagement (limited evidence; three levels kept apart)

1. **Installed or compiled** (region installs, µop heads or programs, tree folds), from the arm's raw
   report line.
2. **Executed** (µop entries and steps, µop-only entries) from the same line. The region JIT's and
   tree-fold's execution counters are not printed without instrumentation flags that would change
   the arm, so those two arms read installed-only.
3. **The IF boundary itself compiled and executed.** **No whole-run count shows this, for any arm.**

What each new case can and cannot show:

- **`region_coexist`:**
  - **What it can show:** a region and/or fold installed for `work`, the 5-op IF=1 loop. Deliveries
    at stops inside or around that compiled loop then match the interpreter.
  - **What it cannot show:** that the IF-enable boundary was compiled. By construction the
    boundary (`STI; NOP` then X) is outside `work`, so the interpreter executes it. **It does not
    prove the boundary ran in compiled code**, and the result note will say so.
- **`sti_in_loop`:**
  - **What it can show:** the region JIT's raw line reading `declined -- contains sti (IF-enable
    boundary)`, which is the candidate's decline firing on a real hot loop, together with correct
    delivery at Y in every arm.
  - **What a decline means:** the region JIT refused to compile across the boundary, which is the
    candidate's design. It is not engagement of the region at the boundary.
  - **Other raw lines:** if the line shows a different decline or pick, that is reported as is.
  - **Tree-fold:** its raw line gives only a fold count, not which runs or why. A fold count of 0
    here is consistent with the design (STI, CLI and POPF are never folded) but does not
    demonstrate it.
- **Neither case touches** the v2 detour-arm decline path, which needs a region whose detour arm
  contains a boundary op. **The detour path stays uncovered**, and the result note will say so.
- The µop tiers never compile STI, POPF, IRET or SS loads (AUDIT). So their engagement in any case
  shows only that compiled µop code ran around the boundary.

## Not in this grant

Corpus A/B, performance, the existing toyvm tests, bundle regeneration, and promotion are all out of
scope. The residual architecture stays unhandled (TF, 16-bit wrap, standalone SS shadows, HLT, the
host INT return / IRETD to V86, timer-only pending, same-block SMC), and STI-then-SS stays
unconfirmed.
