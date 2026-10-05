# IF-enable candidate: engagement gate, staged, NOT run

Prepared 2026-10-05 ~21:10Z, source-only. It runs only on an explicit root grant, with a fresh board CLAIM / SESSION / RELEASE.

**Why this gate is next:**
- Correctness is complete for the 15 default tests: all PASS in both trees. See main `e6b09f57` + `2eb59bc6` (combined run) and `a1bb5034` + `3a51afa3` (replay).
- In every fixture run so far, the region JIT and tree-fold **never engaged**: 0 installs and 0 folds. So the candidate's IF semantics have only been shown while L1, uop and uop-only actually executed.
- A performance number before engagement would price code that never ran.

**Goal:** apply the two source-predicted fixes (NEXT-GATES-PLAN.md section 1, `predicted-engagement-fixes.diff`) and observe whether the region JIT and tree-fold install AND execute on the fixture. Every correctness assertion is re-checked on every arm while they do.

## Pinned inputs (directory `ifen-pinned-engage/`)

| file | sha256 | relation |
|---|---|---|
| `run-fixture.js` | `d86f384c17ef99d6f1809a344ee293e845ab4268eefc4f814e7857741c9b967b` | unchanged from the coverage2 run |
| `build-tree.js` | `b2d24038e2d632923dc108614bdd5f4b6960b1c51a100c50c0feddfae95d47ad` | unchanged; byte-identical to main's copy |
| `impl-draft/candidate-v2.diff` | `ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4` | unchanged candidate |
| `test-toyvm-irq-if-enable.js` | `8e3d89cb5a89046f2a20db18d62adefd8ecbaf6b28ae325e15a8fcf124960afa` | coverage2 fixture `e19398b3` + the changes below |
| `engagement-parser-check.js` | `5ed22d58fc16b8717e55e5b174413628c1bc390ff81f4027381397239ad874f4` | source-only parser check (new) |

The trees are base `2683a6e3` + the pinned stack (v2v3j `54de1b13`, v4 `4b00d26d`, smc `b3371e21`). For `cand`, `ee8265ba` is added on top. Main's `69c1371b` fix is separate and in neither tree.

## Fixture changes against `e19398b3` (all in the test file; the candidate is untouched)

1. **Region arm:** adds `--step-audit`. It only reads the region JIT's step counters at the end of the run (run-dos.js ~1582), giving executed evidence: "regions charged N steps for M instruction weights".
2. **Fold arm:** adds `--tree-fold-warm=1m --tree-fold-batch=1`, the predicted fix.
   - The profile window otherwise closes at 10M dispatches, after these programs have already exited at ~4.2–4.8M.
   - `batch=1` installs the first wanted tree at once, as `test-toyvm-tree-fold.js` does.
3. **New `foldStats` arm:** the same fold flags plus `--tree-fold-stats=1m`. Its payoff rows carry per-tree **entry** counts, which is the executed evidence.
   - It is a separate arm because the flag forces the per-handler histogram on (run-dos.js ~393). If that changed anything, the parity check on this arm alone would show it.
   - The payoff prints only if the second window closes before exit (tree-fold.js `payoffReport` ~1244). Install at ~1M + 250k skip + 1M closes at ~2.3M.
4. **`work` loop:** gains `mov [0x400],ax` (A3 00 04), the predicted region fix. The block then writes memory, so `extendThrough` does not trace the `jnz`, and `ret` leaves the loop block.
   - A new assertion refuses a program whose end would reach 0x400.
5. **Engagement parsing and tally:** the region and foldStats arms report executed evidence. After the cases, `ENGAGEMENT <arm>: installed in a/b [...]; executed evidence in c/b [...]` is printed per arm.
   - It is reported, never failed: the exit code remains correctness only.

## Static verification done (no emulator)

- **`--emit` byte comparison against the coverage2 fixture:** this assembles the programs only.
  - 7 of the 8 programs are byte-identical, with every label address unchanged.
  - `region_coexist` differs only by the 3 inserted bytes at offset 79 (92 → 95 B, ending at 0x15f, well under 0x400).
- **`engagement-parser-check.js`:** 10/10. It renders run-dos.js's **own** step-audit statement and payoff formatter at `2683a6e3` with stub values, then runs the fixture's own parser over them:
  - charged steps > 0 reads as executed, and 0 reads as not executed;
  - a missing line reads as "no report", never as executed;
  - the payoff entry sum works;
  - the plain fold arm reports installed only.
- `node --check` passes.

## Command (after GRANT)

```sh
cd /home/user/wine-assembly/scratch/claude-toyvm-brw-v2-review-20261005/ifen-pinned-engage
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
setsid node run-fixture.js --out=/home/user/wine-assembly/scratch/runs/claude-toyvm-if-engage-$STAMP \
  --plan=cand,stack --total=300 \
  --candidate=$PWD/impl-draft/candidate-v2.diff \
  --candidate-sha=ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4 \
  > ../engage-$STAMP.console.txt 2>&1 < /dev/null &
# wrapper PID: from `ps -eo pid,pgid,args | grep run-fixture` (setsid forks; $! is not it)
```

**Bounds:**
- 300 s in total, and each test gets `min(140, what is left)`. Each child runs in its own process group and is killed with its descendants at the bound.
- **Expected:** coverage2 took 23 s per tree with 5 arms. With 6 arms and a histogram on one of them, about 30–45 s per tree is expected; this is an estimate only.

## How to read the result

**Correctness** is the same as coverage2: [0] exited, [1] ≥7 deliveries at X, [2] none in a shadow, [3] the same (dispatch, ip) sequence as l1. It is now checked on 6 arms.
- **cand:** expected PASS on the counted cases.
- **stack:** expected ARCH-FAIL, as before. The stack is the contrast tree, not a baseline the candidate must match.

**Engagement** is the gate's question:

| outcome | meaning |
|---|---|
| region installed and executed in `region_coexist`, cand PASS | the predicted region fix works, and the candidate's semantics held while region code ran in that program |
| fold installed in a case, and foldStats executed (entries > 0), cand PASS | the same for tree-fold |
| `sti_in_loop` region: not installed, with a "contains sti" decline in its rejects | the candidate's decline seen in practice, which is expected |
| any arm still 0 installs | the prediction failed: read its `--why` / decline lines; that is a source finding, not a candidate defect |

**What it still cannot show:** an IRQ falling due **at a boundary inside compiled code**. `region_coexist` keeps the IF-enable boundary outside `work`, and the candidate declines regions containing sti/popf/jmp_ifen. "Region code executed in a program whose IF assertions held" is the claim, and nothing more. Boundary execution stays open.

**Out of scope:** benchmark, disassembly and promotion. No change to the candidate or to any shipped test.

**Pre-flight / post-flight:** the same as the replay.
- **Before:** record `df`, `pgrep -a node` and `ls -d /tmp/toyvm-ifen-*`.
- **After:**
  - the trees have been removed and no children remain;
  - every PID is reported;
  - the console and per-step logs are kept unchanged.
