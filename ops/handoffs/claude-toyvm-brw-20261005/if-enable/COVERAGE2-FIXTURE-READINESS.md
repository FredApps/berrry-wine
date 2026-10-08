# Corrected coverage fixture: readiness for the next cand,stack run (source only)

Queued after Daggerfall and SkiFree (120 s), with Arena when ready. Not granted, and nothing has
run.

## Exact pins (claude/toyvm-brw-phase5-20261005)

| file | commit | sha256 |
|---|---|---|
| `if-enable/test-toyvm-irq-if-enable.js` (gate [0] `exited=true`, bounded `work`, region `--why`) | d3827ebb | e19398b39cc409ce… |
| `if-enable/build-tree.js` | 2ebe2aa8 (unchanged) | b2d24038e2d63292… |
| `if-enable/run-fixture.js` | 2ebe2aa8 (unchanged) | d86f384c17ef99d6… |
| `if-enable/impl-draft/candidate-v2.diff` | 2ebe2aa8 (unchanged) | ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4 |

## Plan

Identical to `COVERAGE-FIXTURE-READINESS.md` (12b2419e), with the test pin changed: one wrapper, one
300 s bound.

    node ifen-pinned-cov2/run-fixture.js --out=<fresh>/ifen-fixture-cov2-<ts> --total=300 \
      --plan=cand,stack --candidate=ifen-pinned-cov2/impl-draft/candidate-v2.diff \
      --candidate-sha=ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4

- **Procedure:**
  - extract the four files into a fresh `ifen-pinned-cov2/` and verify all hashes;
  - CLAIM;
  - SESSION with the PIDs;
  - cleanup checks (trees removed, process tree clear, no `/tmp/toyvm-ifen-*`);
  - RELEASE.
- **Expected budget:** every case's 8 rounds fit inside `--dispatches=6m`. `region_coexist` is now
  about 0.53M per round (about 4.2M total); the others are 0.52–0.57M per round. Gate [0] fails
  any arm whose program did not reach `exited=true`.
- **Expectations, stated before running:**

  | tree | expectation |
  |---|---|
  | cand | the seven counted cases pass [0][1][2][3] |
  | stack | [0] holds, [1] fails, as before |

  `sti_movss` stays informational.
- **Region arm:** it now prints up to 8 `--why` reject lines (log-only, region-jit.js:690). If the
  region JIT still declines `work`, the reason is recorded. That is a fixture-shape finding, not a
  candidate verdict, since the stack baseline declines identically.

## Engagement claims: preserved limits

- **Three levels are kept apart:** installed/compiled, executed (only µop and µop-only report
  this), and boundary compiled+executed. No whole-run count shows the last, for any arm.
- **`region_coexist` cannot show the boundary compiled:** by construction the boundary is outside
  `work`.
- **`sti_in_loop` can show only that the region JIT declined the loop.**
- **The detour-decline path:** this fixture never reaches it. It is covered only by the static
  unit test below, which tests one decision and not execution.

## Static coverage added (source only, no emulator)

`if-enable/test-region-ifen-decline.js` calls the tree's real `buildRegion` with minimal op objects
(no VM, no wasm, no guest).

| tree | result |
|---|---|
| v2 (ee8265ba) | 7/7: path sti/popf32; detour popf; detour jmp_ifen; second of two detours; inputs untouched; control is not an IF decline |
| v1 (886c2118) | the detour case is NOT declined, as asserted; the path case is declined |

The v1 result shows the test discriminates: it would have caught v1's gap. Both trees were built by
`build-tree.js` and removed. This was run as a unit test of one decision only, not as evidence that
a real program produces such a region or that the region JIT reaches `buildRegion` for one.

## Unchanged gaps

- Correctness: the residual architecture (TF, 16-bit wrap, standalone SS shadows, HLT, the host INT
  return / IRETD to V86, timer-only pending, same-block SMC), STI-then-SS unconfirmed, and region
  and fold boundary execution unshown.
- Performance: the CONT cost is unmeasured.
- Corpus A/B, the at-risk toyvm tests, bundle regeneration.
- No promotion.
