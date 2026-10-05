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
