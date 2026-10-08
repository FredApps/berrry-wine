# Full 199-program corpus validation as two checkpointed stages (prepared 2026-10-05 ~15:05Z; NOT started)

Same pinned candidate stack as the passing smoke (95828542), base 2683a6e3:
1. v2-v3-j-combined.patch     54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82
2. v4-delta-on-combined.patch 4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b
3. smc-pure-forward-fix.patch b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612
Runner corpus-plan.js sha256 b2eb63e4f79a0b7c9d66c39ef6a4d1bec3e52bdd77fb40fce4d79bc5658e2fc4; fixture tests corpus-plan.test.js (39/39).

## One deadline account

`SLOT_S=5700` (95 min) is the budget for BOTH stages together. `$W/out/slot-spent.txt` accumulates the
seconds each invocation actually ran; each invocation gets `SLOT_S - spent`. So the gap between the two
grants is not charged, and the stages together can never exceed 95 min. Each invocation is ALSO
capped on its own by `INVOCATION_S` (default 3300 s for `stage1`, 2400 s for `stage2`; root review
~15:10Z), so stage 1 cannot spend the whole 95 minutes. `$W` persists between the
stages (about 100 MB: both trees, the unpacked corpus, outputs).

## Stage 1: P0 prep, then P1 || P2, then a checkpoint

    W=/tmp/claude-1000/-home-user-wine-assembly/1863d2b5-bc58-4c0b-9c15-00fc951f0256/scratchpad/full-W SLOT_S=5700 JOBS=3 CAND=stack \
    PATCHES="/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v2-v3-j-combined.patch:54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82,/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v4-delta-on-combined.patch:4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b,/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/smc-pure-forward-fix.patch:b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612" \
    node /home/user/wine-assembly/scratch/claude-toyvm-brw-v2-review-20261005/corpus-plan.js stage1

- P0: archive both trees, apply and verify the stack, bundles, unpack all 199 programs plus the corpus
  hash, BRW 10M smoke on both trees.
- P1: all test-toyvm-* suites of the base commit, on both trees (600 s per suite); a suite newly
  failing on cand aborts.
- P2 (concurrently): sweep-dos 8M over all 199 programs on both trees (SWEEP_S 3000 s cap), sweep-diff
  gate, and identity coverage of all 199 programs (a cut sweep is INCOMPLETE).
- Writes `out/stage1.done.json`: candidate, patches, program count, the exact sha256 of programs.txt,
  and a digest of EVERY file in each tree's closure (all extracted files plus brw-bisect.js, path by
  path; node_modules is the shared symlink), and the spent seconds.
- Estimate (extrapolated from the smoke, unmeasured): P2 about 10 s per program at 8M, about 35 min per
  tree (trees in parallel); P1 about 5-15 min, overlapping. **Request a 55-minute slot.**

## Stage 2: P3, P4, P5, P6 on the stage-1 checkpoint

The same command with `stage2`. It refuses (exit 13) without a stage-1 checkpoint, if the
candidate/patches differ, if any file in either tree's closure changed or appeared, or if programs.txt
changed in any way (a same-count substitution included).
- P3: corpus-ab, 4 arms (l1, jit-early, jit-sepc, fold64) at 80M, witness recipe, 2 jobs per tree,
  796 rows per tree, identity coverage.
- P4: --no-irq-schedule control at 8M, 199 rows per tree, exactly "0 of 199 l1 rows moved".
- P5: BRW 500,918,116 dispatches on both trees; the candidate's interrupt lists, frame and dispatch
  count must match (the full-stack run already showed parity: 9871 deliveries, 4dbd3ff0).
- P6: the three-way rubric for every moved l1 frame.
- Estimate: P3 about 1.5 s per row at 80M, so about 10-15 min; P4 about 2 min; P5 about 1 min; P6 depends on
  how many frames moved. **Request a 40-minute slot** (the spent account caps both stages at 95 min).

Exit codes: 0 pass, 2 child/prep failure, 3 tests, 4 sweep, 5 arms, 6 control, 7 deadline,
8 candidate, 9 BRW parity, 11 INCOMPLETE coverage, 12 coverage integrity, 13 stage checkpoint,
130 signalled. Every abort kills all live child process groups first.

## Diagnostic continuation after the FAILED stage 2 (prepared 2026-10-05 ~16:25Z; NOT run)

Stage 2 attempt 2 FAILED its P4 gate (820886d4); the P4 attribution (8f1985c4) shows the four moves
are dispatched-only, from fix J (ACIDRAIN, NEWSBOX3, BRIAN) and the SMC fix (COLORS). That failure
stands. `diagtail` is a diagnosis tool, not a pass:
- it verifies the unchanged stage-1 checkpoint (exit 13 otherwise), then runs ONLY P5 (BRW 500,918,116
  candidate parity gate) and P6 (the rubric for moved frames); P3 and P4 are not rerun;
- every journal line is tagged DIAG and states that stage 2 remains FAILED at P4; it writes
  out/diagtail.json with `fullStagePass: false`; it never prints a stage-complete line;
- it NEVER exits 0: exit 20 means "P5 and P6 complete, diagnostic only"; a P5 parity failure keeps
  exit 9;
- the default cap is 1200 s for this invocation (INVOCATION_S), inside the shared 5700 s account
  (1388 s spent so far).

Runner corpus-plan.js sha256 3ec295c173f15232e40118da2bf607bb5b555244f5a4ed3e96edbe8d064f8e88; corpus-plan.test.js daab23c73e932494c11461cf452ca6e17b40eb8e26c9d81408837864ac4ef48b (45/45, incl. checkpoint refusal, changed
tree refusal, exit 20 with no pass claim, and a P5 failure keeping exit 9).

    W=/tmp/claude-1000/-home-user-wine-assembly/1863d2b5-bc58-4c0b-9c15-00fc951f0256/scratchpad/full-W SLOT_S=5700 JOBS=3 CAND=stack \
    PATCHES="/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v2-v3-j-combined.patch:54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82,/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v4-delta-on-combined.patch:4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b,/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/smc-pure-forward-fix.patch:b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612" \
    node /home/user/wine-assembly/scratch/claude-toyvm-brw-v2-review-20261005/corpus-plan.js diagtail
