# tree-fold / uop replay 2026-10-05T20:51:39Z: result

**Run:** granted by root as the sole runtime after Daggerfall released at 20:50:42Z.
- **Wrapper:** node PID 3226859 (own pgid); started 20:51:39Z; total-bound deadline 21:12:39Z.
- **Elapsed:** 325.879 s of the 1260 s total, with no signal and no error.
- **Command:** as in `correctness-600-staged/REPLAY-READY.md`: `--plan=cand,stack --tests=tree-fold,uop --total=1260 --per-test=300`.
- **Inputs:** runner `80d8f879…` and `build-tree.js` `b2d24038…`, both byte-identical to main's copies; candidate `ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4`; base `2683a6e3` and the pinned stack (v2v3j `54de1b13` + v4 `4b00d26d` + smc `b3371e21`). Main's `69c1371b` accounting fix is separate and in neither tree.
- **Exact output:** `replay-treefold-uop-20261005T205139Z/` (`result.json` and 6 logs).

| test | cand | stack | compare |
|---|---|---|---|
| tree-fold | PASS, exit 0, 96.5 s | PASS, exit 0, 98.7 s | same |
| uop | PASS, exit 0, 64.5 s | PASS, exit 0, 66.0 s | same |

- **Builds:** both PASS.
- **Identical output:** for each test, the cand and stack logs are byte-identical.
  - `tree-fold`: the single PASS line, with every case's screen and fold/tree counts.
  - `uop`: all 15 tags, each with `28 pass configurations x 12 budgets agree`, and `5040 differential runs agree` in each tree.
- **Child processes:** `leftoverGroup` is `false` for all four, so no test left a child process behind.

**This resolves the two incomplete entries from the 20:05:54Z run** (main `e6b09f57` + `2eb59bc6`). Both were the 60 s cap: each test needs ~65–99 s on this box, inside the earlier 120–180 s estimates.

**Combined with that run:** all 15 default tests PASS in both the candidate and the stack tree, with no REGRESSION and no FIXED. This is correctness evidence only. It is not a benchmark, and it does not promote the candidate.

**Cleanup:**
- `treesRemoved` is `[true, true]`.
- No `run-toyvm-tests` / `test-toyvm` / `build-tree` / `run-dos` process remained.
- No new `/tmp/toyvm-tree-fold-*` directory: both tests exited normally and cleaned up. The two directories from the earlier killed run remain.
- Free disk afterwards: 737.3 MB.

**Still open (unchanged):** STI;MOV SS is unconfirmed; region JIT and tree-fold boundary execution under the candidate is unshown; bundle regeneration; corpus A/B. Native disassembly and the fixed-work benchmark each need their own grant.
