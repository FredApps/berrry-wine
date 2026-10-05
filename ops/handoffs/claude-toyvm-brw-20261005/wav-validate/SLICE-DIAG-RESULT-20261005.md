# Slice diagnostic result — head vs v2v3, BLIQ + CAVEIRA (2026-10-05)

## The run

Root granted the run at 17:42Z, on the exact 20e40d97 files (runner 69f5ad70, driver 5166ac41,
classifier fb59f2cd, format d12c5b29), extracted to `slice-diag-pinned-20e40d97/`.

| item | value |
|---|---|
| runner Node PID | 3036119 |
| exit | 0, PASS, 13.7 s of 300 |
| claim / session / release (board) | 17:42:39Z / 17:42:49Z / 17:43:07Z |
| cleanup | process tree clear, trees deleted, FIFOs removed |
| output | 124 MB of 512, `slice-diag-20261005/` |

**Gates, all held:**

- P3 and the full rerun reproduced on every guest field and on `handbacks`.
- irq traces complete: 384/381 (BLIQ), 254,307/254,314 (CAVEIRA).
- Slice records complete, with lines equal to handbacks:

  | run | records | max line (bound) | bytes (cap) |
  |---|---|---|---|
  | head/BLIQ, regs | 156,046 | 92 (192) | 12.4 MB (30 MB) |
  | v2v3/BLIQ, regs | 155,911 | 92 (192) | 12.4 MB (30 MB) |
  | head/CAVEIRA, plain | 1,613,727 | 25 (48) | 33.7 MB (77 MB) |
  | v2v3/CAVEIRA, plain | 1,620,118 | 25 (48) | 33.8 MB (78 MB) |

- Peak RSS 389, 404, 838 and 841 MB, under the 3,072 MB cap.

The per-delivery classification is in `classification.md` and `result.json` in the output
directory. The window listings come from `slice-window.js`.

## Measured

1. **v2v3 never delivers on a date.** 0 of 202 BLIQ and 0 of 66,269 CAVEIRA v2v3-only deliveries
   are ON-DATE: all are BUDGET stops, strictly past their date. The v2 contract holds in the run.
2. **Head delivers on a date where v2v3 does not.** Head-only deliveries: 3 of 205 are ON-DATE in
   BLIQ, and 15 of 66,262 in CAVEIRA. No EARLY delivery in either tree.
3. **Both programs' first divergence is a head ON-DATE delivery, class (a).**
   - BLIQ #48 at 13,732,896: `left` 0, frame edge 96.
   - CAVEIRA #3 at 735,672: `left` 0.
   - In both, head and v2v3 have identical handbacks up to that record. v2v3 differs only in not
     counting it as a stop.
4. **CAVEIRA #3 is the contract working as designed.**
   - v2v3 re-cuts with budget 1 and delivers at its next stop, 735,675 (`left` −2): 3 dispatches
     later.
   - (Also at 735,600, a non-delivering on-date record, v2v3 took the extra budget-1 stop 735,604.)
5. **BLIQ #48 and #70: an interrupt pending while IF=0 waits for the next stop that has IF=1.**
   This confirms H1.

   | | #48 | #70 |
   |---|---|---|
   | on-date handback (both trees) | 13,732,896, 1aeb:67, IF=1 | 19,347,242, 1aeb:67, IF=1 |
   | v2v3's budget-1 stop | 13,732,920 (`left` −23), 1aeb:46, IF=0 | 19,347,266 (`left` −23), 1aeb:46, IF=0 |
   | v2v3's next real stops | 13,750,021 and 13,768,384, IF=0 | 8 stops at 2f5:1fd, all IF=0 |
   | v2v3 delivers | 13,804,137, IF=1: **+71,241 dispatches (7.1 ms)** | 19,597,579, IF=1: **+250,337 (25 ms)** |
   | early handbacks in between with IF=1 | **291 of 435** | **1,041 of 1,553** |

   - For #48, the 13,750,000 record is on-date (tick 25), so it is not a stop under v2.
   - The block from 1aeb:67 evidently clears IF (CLI) before 1aeb:46.
   - So the guest re-enabled interrupts many times in each window, and v2v3 did not deliver,
     because those were early handbacks, not stops.
6. **Later moves.** 58 of BLIQ's 61 move episodes and 1,594 of CAVEIRA's 1,600 begin with a BUDGET
   head delivery. Both rules deliver at a BUDGET stop, so those deliveries move because state
   already differed. An episode boundary is not evidence of an independent decision.

## What this establishes, and what it does not

- **Established.**
  - The schedule change's first effect on both programs is class (a), the contract's intended
    case.
  - On BLIQ, the contract then delays an IF-blocked timer interrupt by 7.1 ms and 25 ms of guest
    time, while the guest had IF=1 at hundreds of intervening instruction boundaries that toyvm
    observed.
- **Correctness, measured against hardware.** A real 8259 holds IRQ0 pending and delivers it at the
  first instruction boundary with IF=1. Neither tree models that:
  - head delivered at a cache-dependent early handback (closer in time here, but not the same in
    every arm);
  - v2v3 delivers at the next scheduled stop with IF=1 (the same in every arm, but late by
    construction).
  - So the BLIQ audio and IRQ change is an exchange of cache-dependence for latency, not a move
    toward hardware.
- **Not established.**
  - CAVEIRA's IF state: it ran without registers to fit the cap.
  - Whether CAVEIRA's cascade (66,262 moved deliveries, 10.8% of samples, delays up to 514,521
    dispatches in the first episodes) is the same IF-blocked wait.
  - Whether a different deterministic rule would match hardware better.
- **A proposal for root (engineering choice, not decided, not tested).**
  - Make the guest's IF 0→1 transition a deterministic delivery instant. It is the guest's own
    instruction, at the same dispatch count in every arm, exactly the argument the contract
    already accepts for a Sound Blaster port-write cut.
  - That would keep v2's determinism and remove the latency.
  - It would need its own source design, test and corpus A/B.
