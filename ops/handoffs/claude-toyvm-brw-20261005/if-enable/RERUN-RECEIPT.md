# Bounded rerun receipt: report-all IF-enable fixture on stack and head

This is prepared for root's grant. Nothing here has run.

## Purpose

The 18:12Z run (965728ae, FIXTURE-RESULT-20261005.md) established assertion 1 only: 0 of 8
deliveries at X, on arm l1. The version it ran (e4aeed77) threw on the first failure, so it never
evaluated:

- assertion 2: no delivery inside an STI or SS shadow;
- assertion 3: the same (dispatch, ip) sequence in all five arms.

This rerun records both for HEAD and the stack, as the baseline any IF-enable candidate is judged
against. It is not a test of a fix; no candidate is involved.

## Exact inputs (all on branch claude/toyvm-brw-phase5-20261005)

| file | commit | sha256 (first 16) |
|---|---|---|
| `if-enable/test-toyvm-irq-if-enable.js` (report-all) | 965728ae | 36d51bafbab4942c |
| `if-enable/build-tree.js` | 1773b424 (unchanged since) | 6bc77d1539ba8f1b |
| `if-enable/run-fixture.js` (wrapper) | 965728ae | 57e9273200248d6a |

- Trees, built by `build-tree.js` from base 2683a6e3:
  - stack (+ v2v3j 54de1b13, v4 4b00d26d, smc b3371e21): expect dos-loop 74f94f3e, emit e07d99db;
  - head: expect dos-loop ebe0eb30, emit 7a4f57fd.
- Diff e4aeed77 → 36d51baf: test only, +18/−14. It drops `assert`, gathers every assertion per arm
  into a problem list, and prints one line per arm (deliveries, count at X, shadow hits, parity
  with l1, first return ips). The emitted .COM programs are byte-identical; checked with `cmp` on
  all six.

## Procedure (one process at a time, one total bound)

1. Preflight: `uptime`; at least 100 MB free (`df -h /`); none of `run-dos`, `test-toyvm`,
   `run-fixture` or `build-tree` running.
2. Extract the three files from 965728ae into a fresh directory, `ifen-pinned-965728ae/`, and
   verify the three hashes above. Refuse on any mismatch.
3. Post a board CLAIM with the hashes.
4. Run:

       node ifen-pinned-965728ae/run-fixture.js --out=<fresh>/ifen-fixture-reportall-<ts> --total=300

   The wrapper is one 300 s total bound. It builds stack and tests it, then builds head and tests
   it. Each test gets `TOYVM_TEST_TOTAL_S` = min(140, remaining). Every child runs in its own
   process group and is SIGKILLed with its descendants at the bound. Trees are removed on every
   exit, and `result.json` records every PID and exit code.
5. Post SESSION with the wrapper PID (`pgrep -af '^node ifen-pinned-965728ae/run-fixture.js'`) and
   the child PIDs from `result.json`.
6. On exit, verify:
   - the wrapper PID is gone;
   - nothing matching `run-fixture|test-toyvm-irq|run-dos.js|build-tree` remains;
   - `treesRemoved` is `[true,true]`;
   - no `/tmp/toyvm-ifen-*` is left.

   Then post RELEASE.

Expected size and time: the last run took 28 s; this one prints 30 extra lines per tree. Outputs
are under 100 KB, with no WAV and no slice records.

## Classification (unchanged wrapper logic)

| class | condition |
|---|---|
| PASS | exit 0 |
| ARCH-FAIL | exit 1 with `FAIL <case>:` lines and no harness signature |
| HARNESS-FAIL | a stack-trace frame (`\n\s+at `), `Error: Command failed`, `SyntaxError`, `ENOENT`, the test's own bound stop (exit 5), a kill, or a build failure |

The new per-arm lines begin with the case name, not `at `, so they cannot match the harness
signature. A run-dos crash still surfaces as an uncaught `execFileSync` error with a stack trace,
so it is still classified HARNESS-FAIL.

## Expected outcome (stated before running)

- **Assertion 1** fails on all 5 arms × 5 counted cases, on both trees. Measured on l1 already;
  the other four arms are expected to match.
- **Assertion 2** — no expectation either way: this is what the rerun measures. A shadow hit on
  HEAD would be a separate finding. Today a delivery lands only at a stop, and a stop could fall
  inside a shadow only if the shadowed instruction ended a block.
- **Assertion 3** — no expectation either way; it is measured. The v2 schedule was built to be
  arm-independent, and a difference would be a finding in its own right.
- `sti_movss` is reported as `info` either way.

## Not included

No IF-fix candidate, no benchmark, no build (`tools/build.sh`), no browser, no promotion.
