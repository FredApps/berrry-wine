# Bounded slice-record diagnostic (head + v2v3, BLIQ + CAVEIRA): readiness

Source-only preparation answering root's review of 2994e486. No runtime has been run or requested.

## What changed since 2994e486

- **Slice records are capped live, and the transport is a FIFO.**
  - `--slice-log=/dev/fd/3` over a Node stdio `'pipe'` fails with ENXIO. Node makes those pipes
    socketpairs, and a socket cannot be reopened by path. `probes/fd3-probe.js` reproduces this
    (exit 3, 0 bytes), as root did independently.
  - The diagnostic instead hands run-dos a named FIFO. The runner holds the FIFO O_RDWR|O_NONBLOCK,
    so the driver's open never blocks and there is no EOF race, and drains it with `readSync`
    under a hard cap.
  - run-dos's `writeFileSync` blocks whenever the pipe is full, so nothing reaches disk unless the
    runner wrote it under the cap. `probes/fifo-probe.js`: 20,971,520 of 20,971,520 bytes.
- **Bounded before it starts.**
  - `slice-format.js` fixes the maximum line length: 48 bytes plain, 192 with registers.
  - Each run's handback count is pinned by the deterministic full-trace rerun.
  - The worst case is summed before anything runs, as slice bound + 64 MB log cap + WAV per run:

    | run | slice bound (bytes) |
    |---|---|
    | head/BLIQ | 29,960,832 |
    | v2v3/BLIQ | 29,934,912 |
    | head/CAVEIRA | 77,458,896 |
    | v2v3/CAVEIRA | 77,765,664 |
    | **worst case, total** | **467 MB of the 512 MB cap** |

  - The run also requires free disk of at least the output cap + 256 MB (1,357 MB free at the dry
    run).
  - CAVEIRA runs without registers, since `left` is all its classification needs. With registers
    it would be 311 MB per run.
- **Memory.**
  - V8 old space is capped by `--max-old-space-size=1536`, and the records live there until the
    end.
  - The runner polls VmRSS every 200 ms and kills the run's group past `--rss-cap-mb` (3072):
    exit 8.
  - Each row records the kernel's peak RSS and the heap figures.
- **Complete record accounting.**
  - `handbacks++` and `afterSlice` happen once each per step: one increment site, no return between
    them, and no return before the push.
  - So the record must hold exactly `row.handbacks` lines, every one matching the strict format
    within the bound, with dispatched non-decreasing and the last equal to `row.dispatched`.
  - `row.handbacks` must equal the pinned count. Otherwise the result is INCOMPLETE (exit 7) or
    VOID (exit 3).
- **Kept from 0555a08d:**
  - P3 reproduction on every guest field, with head checked against P3 base and v2v3 against P3
    cand, and both against the full-rerun rows, which are hash-pinned.
  - irq traces complete (the stdout-flush gate).
  - One total bound with process-group kill, and the hard stdout cap.
  - Pinned programs and patches, fresh `--out` only, and trees deleted on exit.
- **wav-run.js and wav-run.test.js are back to their reviewed 0555a08d bytes** (3992a701,
  298d9e56). The unbounded slice option is withdrawn from them.

## Tests (no emulator)

- `slice-diag.test.js` 15/15.
  - It runs the REAL `wav-drive.js` and `slice-diag.js` against fake trees whose `runDos` writes the
    record with run-dos's own statement.
  - It evaluates base 2683a6e3's own `sliceLog.push(...)` statement at int32 and register extremes
    against `slice-format.js`.
  - Covered cases:

    | case | expected result |
    |---|---|
    | normal run, transport through the FIFO | PASS |
    | 400,000 records | all arrive |
    | one missing line | exit 7 |
    | malformed line | exit 7 |
    | record cut live at the cap | exit 6 |
    | RSS cap | exit 8 |
    | V8 heap OOM | exit 2, 0 bytes on disk |
    | irq trace incomplete | exit 7 |
    | handbacks differ from the pin | exit 3 |
    | deadline | exit 5, grandchild killed |
    | worst case over the output cap | exit 6 before any run |
    | too little free disk | exit 2 |
    | program pins | exit 2 |
    | non-empty `--out` | exit 2 |
- `wav-run.test.js` 10/10 and `wav-compare.test.js` 5/5.
- Pinned dry run: expectation files verified and agreeing with P3, trees built (head `dos-loop`
  ebe0eb30, v2v3 eeb9e2cd) and deleted.

## Command (needs a root grant; one total bound of 300 s)

    node wav-validate/slice-diag.js --w=<stage-1 work dir> --out=<new dir> --run

Exit codes:

| code | status |
|---|---|
| 0 | PASS; classification written, not an audio verdict |
| 2 | prep, pin or driver failure |
| 3 | VOID |
| 4 | missing output |
| 5 | DEADLINE |
| 6 | SIZE |
| 7 | INCOMPLETE |
| 8 | MEMORY |

The output, `classification.md` / `result.json.classification`, gives:

- for each moved delivery in each tree: ON-DATE (`left` 0, class (a)), BUDGET (`left` < 0, a
  consequence of an earlier divergence) or EARLY (`left` > 0, a finding);
- move episodes and the class of each episode's first delivery;
- for BLIQ, the IF bit at v2v3's stops in each episode window (hypothesis H1).
