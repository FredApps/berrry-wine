# Schedule-on l1 WAV/IRQ changes: findings from the preserved rows, and the smallest reference check

Prepared 2026-10-05 16:46-16:49Z, source only. Evidence: stage 2 attempt 2 rows
(`v2-review/full-stage2-attempt2-20261005/out/arms-{base,cand}.ndjson`, commit 820886d4), P3 recipe
`witness` at 80M.

## What the preserved rows already show (no new runtime)

All 11 moved l1 rows (CHANGE, CAVEIRA, anarchy, do, rage, BLIQ x2, BYRON, CYCLE, ANSWER, ASSAULT):

1. **Capture length: UNPROVEN either way.** Final dispatched is equal or within +-1 in every row (CAVEIRA
   -1, do +1; ANSWER 80001871 both), and every frame is identical. That does NOT establish an identical
   WAV sample count or render end time: dispatched counts guest work, not the audio clock, and the last
   render instant depends on where the final stop falls. Whether length/duration contributes to the hash
   change stays unproven until the WAVs are captured and their sample counts, durations and render clock
   are compared (wav-run.js reports all three per tree).
2. **Arm agreement cannot validate them.** In base and in cand the four arms already agree on these
   programs. BLIQ, CYCLE, rage and CHANGE are identical across l1/jit-early/jit-sepc/fold64 in both
   (for BYRON and ANSWER only fold64, and ANSWER's jit-sepc in base, differ). So the change is
   uniform across arms: the clock/render model changed for every arm.
3. **The leading confound is render instants.** cand has MORE `date` stops than base in every row
   (+1 ASSAULT to +6,377 CAVEIRA; CYCLE +340, anarchy +2,844, do +2,205), while the `early` count is
   unchanged (do +3, BYRON -1). That fits the schedule patches adding real stops: v2/v3 re-cut to a
   date an early handback landed on (a budget-1 slice), the lattice ceil, and v4's overdue-SB clamp.
   Audio is rendered at every stop, and the Sound Blaster's DMA is read when a slice's audio is
   rendered. So more render instants change the samples even when the guest does the same work.
4. **IRQ counts:** +1 to +7 for CAVEIRA, do, BYRON and ASSAULT; BLIQ -3. CAVEIRA has +7 with -1
   dispatched, so this is not an end-of-run effect. It is consistent with deliveries moving from
   early-on-date handbacks to the next real stop (v2/v3), and rate-limited lines (SB `irqEvery`)
   then counting differently.
5. **BLIQ is the only observed `ints` change:** 2985 -> 2978 (the guest made 7 fewer INT calls). This
   is not evidence that BLIQ is the only program whose guest behaviour changed: the IRQ-count changes
   (item 4) and the audio differences in the other rows are guest-observable too, and the preserved
   rows carry no field that would show other behaviour changes. BLIQ reprograms PIT channel 0 and reads it back (docs/toyvm-irq-schedule.md; dos-loop.js
   comments). Its timer rate depends on what it reads, so the extra stops (PIT phase updated at more
   dates) plausibly change its readback and therefore its behaviour.

None of this says the new audio is right or wrong. It says render and delivery instants are the
leading explanation for the hash change (unproven until the WAVs are compared), and that BLIQ is the
only row with an observed `ints` change; IRQ and audio differences elsewhere are guest-observable too.

## Smallest reference check (needs one slot; one total bound of 300 s, traced time unmeasured)

Programs: BLIQ (1994-b-bliq; PIT reprogrammer, ints changed), CYCLE (1994-c-cyclewar; SB mixer cited
in the schedule doc), CAVEIRA (1993-c-caveira; largest stop delta, irqs +7).

Trees (from base 2683a6e3, hash-pinned, `--no-backup-if-mismatch`, built like
p4-attribution/attribution.js):
- head;
- v2v3 (dos-loop-irq-fix-v2.patch 4a9ba394 + v3-delta-on-v2.patch 76825987; schedule only, no J, no SMC fix; verified to apply cleanly on 2683a6e3);
- v2v3j (54de1b13);
- v2v3j_v4 (+4b00d26d);
- stack (+b3371e21).

Runner: `wav-validate/wav-run.js` (stub tests `wav-run.test.js`, 8/8; no emulator). Each run is
`wav-drive.js`, which calls the tree's `runDos` with corpus-ab.js's exact `witness` recipe (variant
tailcall, cpu 386, autoKey, pitClock, soundPref sb, ULTRASND=220,1,1,11,7, audioRate 22050, budget
80M, schedule on) and hashes `audio.wavBytes(audioChunks)` exactly as corpus-ab does. The run-dos
CLI is NOT used: its defaults are not corpus-ab's, so a P3 mismatch from it would say nothing about
the patches. Traces are added as the read-only `traceIrq` (all three) and `traceIo` 40,43 (BLIQ
only) options. The gate checks every guest field, so a trace that perturbed a run would be VOID.

    node wav-run.js --w=<stage-1 work dir> --out=<new dir> --dry-run|--run \
      [--total=300] [--log-cap-mb=64] [--out-cap-mb=512] [--no-trace]

Exit codes:

| code | status | meaning |
|---|---|---|
| 0 | PASS | completed with P3 reproduced; not an audio-correctness verdict |
| 2 | — | prep, pin or driver failure, or a non-empty --out |
| 3 | VOID | P3 not reproduced; the middle trees are not run |
| 4 | — | missing or unhealthy WAV or row |
| 5 | DEADLINE | the one total bound was reached; process groups are killed |
| 6 | SIZE | hard per-log cap, or the remaining output budget, reached |
| 130 | — | signalled |

Inputs are pinned: base 2683a6e3, the five patches by sha256, and each program directory by a
digest of its files. The trees are deleted on every exit; the logs, WAVs and rows are kept. Each
row also carries the audio clock (frames, `audio.rendered`, the `outAcc` residue,
guestSeconds(dispatched)). Per `audio.js` `Sound.advance`, the frame count is floor(rendered guest
time x rate), carried across slices, which is why final dispatched alone cannot settle the length
question.

Gates and analysis:
1. **Validity:** sha256 of head's and stack's WAV (first 16 hex) must equal P3's preserved l1 `wav` for
   that program (BLIQ bcad8597.../5c99cf30..., CYCLE 53d35b45.../271394da..., CAVEIRA
   f61246d0.../b1319eb4...). Otherwise this is not P3's setup and nothing is attributed.
2. **Attribution:** which tree first changes the WAV hash, irqs and ints (v2v3 vs head isolates the
   schedule-only patches; v2v3j adds J; v4; the SMC fix).
3. **Shape of the difference:** `wav-validate/wav-compare.js head.wav stack.wav` (tests 5/5) gives the
   first differing sample time, the differing share, the max and RMS difference, and the differing runs.
   Short low-amplitude runs mean render-instant jitter; long runs or large differences mean content.
4. **BLIQ guest behaviour:** diff the `[io]` PIT lines (port 40/43, with dispatch stamps) and the
   `irq` lines between head and stack to the first divergence. Classify it: (a) an IRQ head delivered
   at an early handback exactly on a date (`at` == date) that stack delivers at the next real stop,
   which is the v2/v3 contract; (b) a PIT readback that differs because the phase was updated at a
   different stop; (c) something else (a defect to investigate).
5. **Reference for "correct":** this emulator has no external recording. The reference is the
   schedule's own contract: interrupts and renders happen only at dates, never at cache-dependent
   handbacks. A divergence classified (a) or (b) follows from that contract and is evidence for the
   new behaviour. A class (c) divergence blocks accepting the audio change.

The analysis needs no new emulator code: run-dos already has --audio, --trace-irq and --trace-io, and
wav-compare.js is a pure-JS comparison.
