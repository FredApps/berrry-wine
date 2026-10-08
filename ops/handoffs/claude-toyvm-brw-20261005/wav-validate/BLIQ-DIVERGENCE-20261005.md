# BLIQ first divergence vs the schedule contract (source only, 2026-10-05)

Inputs: the complete BLIQ traces from the granted run `wav-run-20261005/`. BLIQ's irq logs are
complete: 384/384 in head and 381/381 in each of the other four trees (RESULT-20261005.md). No new
runtime. `bliq-dates.js` reproduces every number below from the logs. Its outputs are
`bliq-dates-head.txt` and `bliq-dates-v2v3.txt`.

## The contract (source)

The contract is v2's `atStop`, kept by v3 and the stack (`dos-loop-irq-fix-v2.patch`):

- A scheduled interrupt goes in only at a handback **strictly past** the date the slice was cut
  to: `dispatched > stopAt`.
- A machine cut (the guest's own port write) keeps `>=`.
- Head used `>=` for every handback. So an early handback that lands exactly on a date counted as
  having reached it.
- Per the patch's own comment, a budget stop always ends at least one dispatch past its date.
  The budget is tested as `$steps < 0` at a block transfer.

The v2 and v3 changes act only when the odometer equals a date exactly. Each one, read in the
source:

- lattice `ceil` vs `floor+grain`;
- `due(at >= …)`;
- strict `atStop` and strict `sbDueNow`;
- v3's `from = max(dispatched, reachedAt+1)`;
- v3's tick due date;
- v3's VGA edge armed only at a stop.

So the first behaviour difference between head and v2v3 can only arise at a handback whose
odometer equals a date, or right after a cut that ended exactly on one.

Dates under `--pit-clock`, with dispatchesPerTick 550,000 (dos-loop.js):

| date | value |
|---|---|
| VGA frame edge | `k x 143051` (70 Hz: round(10,013,566 / 70)) |
| lattice | `k x 35762` (grain = floor(min(timer 200266, vga 143051) / 4)) |
| BIOS tick | `k x 550000` |

The timer is periodic, not one-shot. Its next date is `lastIrq + timerInterval()`, and after BLIQ's
reload 0x5d37 that interval is 200,266.

## Measured facts

1. **v2v3 and head agree on IRQs 1–47.** All 47 timer IRQs have the same `at`, `t` and
   interrupted cs:ip. v2v3's handback index is exactly head's +1 on all 47, so v2v3 took exactly
   one extra handback before 3,504,677 and none after it up to line 47.
2. **Line 48 is the first divergence.**
   - Head delivers at **13,732,896 = 96 x 143,051 exactly**, a VGA frame edge, overshoot 0
     (hb 24403, interrupting 1aeb:46).
   - v2v3 (and stack) deliver at 13,804,137 = lattice point 386 (13,804,132) + 5, a budget stop
     (hb 24844, interrupting 1aeb:36). That is 71,241 dispatches (7.1 ms of guest time) later.
3. **Lines 49 onward re-converge**, `hb` included (13,839,896, hb 25053), until the next such
   event.
4. **Head has two zero-overshoot deliveries, and v2v3 has none.**
   - Line 48 (frame #96) and line 70 (lattice #541, at=19,347,242).
   - The same IRQ is delivered by v2v3 at 19,597,579 (lattice #548 + 3), 250,337 dispatches later.
   - Every other delivery after mode 13h is +1 to +7 past a lattice point or frame edge, which is
     the budget-stop pattern.
5. **BLIQ has no machine cuts.** `kinds.cut` = 0 in every tree's row, so a zero-overshoot
   handback is an early handback, not a cut.
6. **BLIQ's PIT handler writes the same values every tick** (43<-30, 40<-37, 40<-5d), so the port
   writes simply follow the delivery instant (@13.7329M vs @13.8042M).
7. **Stack differs from v2v3 for the first time at IRQ line 155.** The delivery is at 37,335,544
   vs 37,335,543, a 1-dispatch difference, interrupting 16ce:29fa vs 16ce:2d23. The WAV, irqs and
   ints are equal for v2v3 and stack. This is a J or SMC accounting difference, not a schedule one.

## Classification of the first divergence

**Class (a), on measured evidence.** Head delivered the timer IRQ at an early handback that landed
exactly on a scheduled date (frame edge 96, overshoot 0, no cuts). The v2 contract says that date
has not been reached, so it does not deliver there. This depends on the code cache: per the v2
comment and the BRW evidence, a different cache moves early handbacks.

## Hypotheses (not measured)

- **H1: why v2v3 waits 71,241 dispatches rather than delivering at the budget-1 stop just past
  frame edge 96.**
  - The contract predicts that v2 re-cuts the next slice to that date with budget 1 and delivers
    at the next block transfer.
  - The timer rung also needs IF=1, a hooked vector, and `clockAt - lastIrq >= interval`. The
    simplest explanation is IF=0 at that stop and at the stops after it, until lattice 386.
  - BLIQ's loop 1aeb:36..46 is interrupted at both ends (head 1aeb:46, stack 1aeb:36), which fits
    a loop with a short interrupt window. Not verified.
- **H2: which instant is closer to real hardware.** Here the contract and hardware can disagree.
  - A real 8259 holds IRQ0 pending and delivers it at the first instruction boundary with IF=1.
  - toyvm delivers only at handbacks. Head reached that window by the luck of the cache; the
    schedule reaches it only at the next date where IF=1.
  - So class (a) makes the delivery deterministic across arms. It does **not** show the later
    instant is the more faithful one. An IF-blocked IRQ can now wait up to the next date with
    IF=1.
- **H3: BLIQ's other differences** (3 fewer IRQs, 7 fewer INTs, 3.16% of samples) all follow from
  the two moved deliveries. Not shown: only lines 48 and 70 were traced through.

## The decisive check (folds into the already-planned complete-trace rerun)

`run-dos.js` already has `sliceLogFile` + `sliceLogRegs`. For every handback they record
`dispatched`, `left` (left > 0 = early), cs:ip, the registers and FLAGS, written with
`writeFileSync` at the end of the run (not through the pipe). For BLIQ on head and v2v3 this
settles two things without guessing:

- **Fact 2 and class (a):** head's handback at 13,732,896 should show `left > 0`.
- **H1:** the IF bit at each v2v3 handback between 13,732,896 and 13,804,137, and whether a
  budget-1 stop follows the frame edge.

The driver change is one option, `--slice-log=FILE`, which passes `sliceLogFile` and
`sliceLogRegs` through. The runner passes it for BLIQ only. It is a read-only hook, and the P3
full-field gate still applies.
