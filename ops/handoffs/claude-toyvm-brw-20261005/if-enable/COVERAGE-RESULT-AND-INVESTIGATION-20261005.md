# Coverage fixture run (19:12Z) and source-only investigation of the `region_coexist` FAIL

## The run, as granted (preserved unchanged in `ifen-fixture-cov-20261005/`)

Exact 4604ee8a pins: test 8875ff18, build-tree b2d24038, wrapper d86f384c, candidate-v2 ee8265ba (full
sha verified). Invocation: `--plan=cand,stack`, one 300 s bound.

| item | value |
|---|---|
| wrapper Node PID | 3125881; exit 0 in 47.7 s |
| children | build-cand 3125888, test-cand 3125901 (25 s, exit 1), build-stack 3126775, test-stack 3126787 (22 s, exit 1) |
| cleanup | process tree clear; trees removed `[true, true]`; no temp dirs |
| board | claim 19:12:22Z, session 19:12:32Z, release 19:13:33Z |

| tree | result |
|---|---|
| cand | ARCH-FAIL: 6/7 counted pass (sti_nop, sti_ret, sti_cli, popf, iret, **sti_in_loop**). **`region_coexist` FAILS [1]: 5 at X (want ≥ 7) in all 5 arms.** [2] none, [3] same. |
| stack | ARCH-FAIL: every counted case fails [1] (0 at the boundary), as expected. |

**Engagement, both trees:**

- The region JIT `declined -- no self-loop region found` in every case, `region_coexist` included.
- Tree-fold built 0 folds everywhere.
- µop and µop-only installed and executed.

**This FAIL is preserved.** The count threshold was not lowered.

## Why 5 at X: evidence points to an invalid fixture assumption, not a candidate defect

The fixture assumed every one of the 8 rounds runs. In `region_coexist` they did not.

1. **Workload arithmetic.** The first `work` was 3 × 65,535 passes of a 5-op loop, about 983k
   dispatches per call, against about 196k for `spin`. With the IF=0 delay (5 × 65,535 one-op
   iterations, about 327k), a round cost about 1.31M dispatches, so 8 rounds need about 10.5M. The
   test runs `--dispatches=6m`, so only about 4.6 rounds fit. The other cases cost about 0.52M per
   round, about 4.2M for 8, and finish.
2. **µop-only's own count:** its raw line shows **`ifen 5`**, exactly five IF-enable boundary exits.
   Other cases show `ifen 8`.
3. **Delivery count:** 50 deliveries ≈ 5 rounds × (1 at X + about 10 timer IRQs during each
   983k-dispatch `work`, at the 100k interval). The other cases deliver 23 ≈ 8 × (1 + about 2).
4. **The candidate delivered at X in every round that ran:** 5 rounds, 5 at X. There were no
   deliveries in a shadow, and the sequences were identical across arms.
5. **The baseline (stack) also delivered 50:** the same truncation, independent of the candidate.

**Per-round precondition, established by construction.** In each round:

- the timer is hooked;
- the guest runs at least 327k dispatches with IF=0 (the delay), against a 100k timer interval
  (no PIT programming, so `irqEvery`). A timer date therefore passes while IF=0, and the candidate
  marks it pending at a stop;
- the IF-enable sequence then runs once (STI with IF=0 before it, so its shadow applies), and the
  owed delivery is at X.

What broke the assumption was not this precondition but the number of rounds reached.

## Why the region JIT still declines: NOT determined source-only

- The loop in `work` was 5 ops. There is no `dec`/`jnz` fusion (emit.js:46: `dec_r16_jnz` is
  "deliberately absent"), so it was at or above `minOps = 4`. **My earlier "below minOps" hypothesis
  is not supported.**
- `declined -- no self-loop region found` means `pickRegion` returned nothing. Its per-candidate
  reasons are printed only under `--why` (region-jit.js:690, log only), which the run did not pass.
  So the reason is unknown.
- The decline also happens on the stack baseline. So it is not caused by the candidate. Whether the
  region arm can be engaged at all by this fixture shape is an open fixture question.

## Corrections to the fixture (source only, not run)

The test hash moves from 8875ff18 to the new value in the commit.

- **`work` is shortened, and its body lengthened:** one pass of 22,000 iterations of a 9-op loop
  (seven arithmetic ops + `dec cx` + `jnz`), about 198k dispatches. `region_coexist` is then about
  0.53M per round and about 4.2M for 8 rounds, under 6M.
- **New gate [0]:** each arm's run must end with `exited=true` (printed unconditionally by run-dos).
  A run cut off by `--dispatches` is flagged, and its [1] is marked not meaningful. Any future
  workload change that silently drops rounds is caught.
- **The region arm runs with `--why`,** and up to 8 reject lines are kept beside its raw report
  line, so the next run records why a candidate loop was rejected.
- **Problem text** names the expected label (`Y` for `sti_in_loop`), not always `X`.
- **Unchanged:** the six original programs and `sti_in_loop` are byte-identical. Only
  `region_coexist`'s bytes change (`work`). Statically disassembled.

## Still not shown (unchanged from the readiness note)

- No arm's compiled code is shown executing the IF boundary. `region_coexist` keeps the boundary
  outside `work` by construction.
- `sti_in_loop` can show only a region decline.
- The v2 detour-decline path is uncovered.
- The residual architecture is unhandled.
- No promotion.
