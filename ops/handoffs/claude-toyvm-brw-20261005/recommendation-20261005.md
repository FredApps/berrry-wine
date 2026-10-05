# BRW candidate stack: consolidated evidence and recommendation (source-only; first written 2026-10-05 16:44Z, commit 0c1fc9a7; revised 16:49Z after root review)

Branch `claude/toyvm-brw-phase5-20261005`; every number below is from committed evidence
(commits in brackets). Nothing here is promoted, and stage 2's original P4 failure stays recorded
as FAILED.

## 1. The stack and what each part fixes

| patch | mechanism (BRW L1 vs jit-sepc) | first divergence after it |
|---|---|---|
| none (HEAD) | - | 88.9M |
| v2/v3 (dos-loop.js) | an early handback landing exactly on a scheduled date counted as reaching it; the date (grain-lattice included) is now kept for the next stop | 115.06M |
| J (emit.js, region lowering, uop-ir.js) | an install-made `jmp_syn` tested the budget at a loop head, so the region arm stopped one iteration early | 160.195M |
| v4 (dos-loop.js) | an overdue Sound Blaster date was served at whichever handback came first (odometer-stamped render) | 330.6M |
| SMC fix (compile.js, dos-loop.js) | the interpreter's pure volatile compile cleared code bits, so a forward self-patch ran stale (L1 itself was wrong; smcFlush and jit-sepc agreed) | none |

## 2. Corpus evidence (pinned stack 54de1b13 / 4b00d26d / b3371e21 on 2683a6e3)

- Smoke [95828542]: all gates passed on 3 programs.
- Stage 1 [dd02d6cd]: all 28 toyvm suites pass on both trees; sweep gate clean with identity coverage
  of 199/199 programs.
- Stage 2 attempt 2 [820886d4], 80M with the schedule:
  - P3 passes: 796/796 identity rows per tree, 0 BROKE, 0 health regressions.
  - Cross-arm agreement with l1 improves: jit-sepc 197 -> 199/199, jit-early 195 -> 197/199, fold64
    190 -> 190; 4 rows fixed (CAVEIRA jit-early, anarchy jit-sepc, ANSWER jit-sepc, ZOKDTPLN
    jit-early).
  - **11 l1 rows moved under the schedule**, all in `wav`: CHANGE, CAVEIRA, anarchy, do, rage,
    BLIQ x2, BYRON, CYCLE, ANSWER, ASSAULT. Five also moved `irqs` by 1-7 (CAVEIRA, do, BYRON,
    ASSAULT, BLIQ 384 -> 381), and BLIQ moved `ints` 2985 -> 2978. No frame moved in this list.
  - **P4 FAILED**: 4 of 199 l1 rows moved with --no-irq-schedule, dispatched only.
- P4 attribution [8f1985c4], P4 reproduced on every guest field. ACIDRAIN +124, NEWSBOX3 +180 and
  BRIAN +585 come from J; COLORS +70 comes from the SMC fix; v4 adds nothing. No frame, wav, irqs,
  ints or pixels change in any tree.
- Diagnostic tail [f3034a10]: P5 candidate BRW parity at 500,918,116 (9871 identical deliveries,
  frame 4dbd3ff0); P6 over 13 moved frames: same 8, reappears 5, STABLE-DIFF 0, unstable 0.

## 3. Is the original P4 premise appropriate?

The premise, "with --no-irq-schedule nothing moves", is right for patches whose only effect is the
schedule (v2/v3/v4): with the schedule off their code paths are dormant, so any move would be a leak.
It is not right for J and the SMC fix, which deliberately change the plain interpreter whatever the
schedule:
- J removes a budget test at `jmp_syn`, so where an 8M run's last slice stops (its final dispatched
  count) can move by up to one block's overshoot. That is exactly the 3 rows J moved, with nothing
  guest-visible changed.
- The SMC fix makes forward patches break, adding SMC handbacks that move the final stop (COLORS +70),
  again with nothing guest-visible changed.

So the failure is real under the original rule and remains recorded. The rule tested something
these two patches never claimed. A replacement must keep the original rule's power for the schedule
patches and must not weaken the guest-visible checks.

## 4. Proposed replacement P4 criteria (for a stack that changes L1); original failure retained

P4' passes only if all of these hold:
1. **Guest-visible identity off the schedule:** for every one of the 199 programs, l1 under
   --no-irq-schedule has identical frame, wav, irqs, ints and pixels, healthy status, and exact
   identity coverage (as P4 checks today).
2. **Dispatched-only moves are attributed; no numeric bound is claimed yet.** Every row whose
   dispatched count moved is named by an attribution run (as in 8f1985c4) to a patch declared to change
   L1 (J, SMC fix). The earlier "<=1024" was picked from the observed +585 and is withdrawn. What the
   semantics give:
   - The budget is tested as `$steps < 0` at block transfers, so an end stop overshoots by at most the
     ops between the date and the next budget-testing transfer.
   - Under J, a `jmp_syn` no longer tests the budget, so that stretch can run through a chain of
     jmp_syn-linked straight lines up to the next guest transfer. The bound is that chain's length,
     a property of each program's compiled code, not a constant.
   - The SMC fix adds self-modify handbacks rather than extending an overshoot, so its moves (COLORS
     +70) need their own explanation.
   Until the chain length is computed per program, report each move's size and leave the bound
   unproven.
3. **Schedule-only patches still meet the original rule:** a tree with only v2+v3+v4 (no J, no SMC
   fix) moves 0 of 199 rows under --no-irq-schedule. This tree is NOT yet run: the attribution
   covered v4 on top of v2v3j, not v2+v3 alone. It is the one new runtime check this criterion needs.
4. **Schedule-on l1 changes are reviewed, not waved through** (findings and the reference check:
   `wav-validate/PLAN.md`): the 11 wav moves (and the small irqs and
   BLIQ ints moves) are guest-observable. They come from the schedule fixes moving render and IRQ
   instants, which is the purpose of v2-v4. But nothing has yet shown the new audio is more correct,
   only more arm-independent. They need a listening or reference check, at least BLIQ (PIT
   reprogrammer, ints changed) and one SB demo, before the L1 baseline change is accepted.

## 5. Fix J versus the region-only variant R

| | J (jmp_syn drops its budget test in every arm) | R (region-only, L1 unchanged) |
|---|---|---|
| implemented | yes: jmp-syn-j.patch 7f8a7275, control flag `--jmp-syn-budget-test` byte-identical to HEAD | **no**; design only (worker A, b10733a0) |
| synthetic case | 811 -> 0 mismatched deliveries; control reproduces HEAD exactly [ea12bd8b] | untested |
| BRW | parity at 500M only with J in the stack [222feea4, f3034a10] | untested |
| corpus | P3 agreement up, 0 BROKE; 3 dispatched-only l1 moves off the schedule, nothing guest-visible [8f1985c4] | n/a |
| L1 behaviour | changes where a budget stop lands (dispatched only, observed so far) | unchanged by design |
| known correctness gaps | residuals in the J README: an unresolved `jmp_syn` target still hands back; a uop deopt stub at a jmp target reachable both ways can stop one block later; the uop held-head path is unchanged | worker A: covers only the case where the interpreter absorbed the head, and is wrong when the head was already a block start, i.e. leaves part of the BRW mechanism unfixed |
| performance | **not measured**. J removes one compare and branch from a hot transfer, so expected neutral or slightly better, but no number exists | not measured |

Recommendation: **J.** It is the only variant with evidence: synthetic, BRW, the full corpus and an
exact HEAD control. R's known gap is a correctness gap in the very mechanism being fixed, and R has
never run. J's cost is a dispatched-only L1 shift, which criterion 4.2 would account for. Before
landing, J's performance should be measured (fixed work, user CPU, quiet box, plus V8 and SpiderMonkey
disassembly per the repo's optimization rule). That measurement does not exist.

## 6. Actual unresolved design choices

1. **P4 criterion for an L1-changing stack.** Recommend P4' (section 4). It needs one more runtime
   check (v2+v3+v4 alone, off the schedule) and keeps the original failure on record. Owner: root
   (integration gate).
2. **J vs R.** Recommend J (section 5). Open evidence gap: performance.
3. **The L1 baseline change.** BRW's own frame moves a066bf27 -> 4dbd3ff0; 11 corpus wav/irq moves
   under the schedule; 13 moved 8M frames, all same or reappears. Recommend accepting the frame-level
   changes on the P6 evidence (0 STABLE-DIFF). Do not accept the audio changes until criterion 4.4's
   check is done.
4. **The forward-SMC fix.** Recommend landing it. BRW evidence: the interpreter ran stale code and
   jit-sepc agreed with the smcFlush reference. Under the 386/486 contract the patched byte is 0x49
   ahead of the store and the loop re-enters by a jump, so stale execution is wrong on that CPU too.
   Its corpus cost is one dispatched-only move (COLORS +70). No synthetic test reproduces it yet.
5. **Same-block forward SMC** (TOYVM-SMC-SAME-BLOCK-FORWARD-PATCH). Not part of this stack. It is a
   CPU-contract decision (386/486 prefetch vs Pentium snooping), blocked on that choice.

## 6b. The 11 schedule-on l1 changes (wav-validate/PLAN.md)

From the preserved rows:
- Capture length/duration as a cause is UNPROVEN: final dispatched equal or +-1 and identical frames
  do not establish identical WAV sample counts or render end times. Labelled unproven until the WAV
  capture compares sample counts, durations and the render clock.
- Arm agreement cannot validate them: all four arms already agree on most of these in base and cand,
  so the change is uniform across arms.
- The leading confound is render instants: cand has more `date` stops (+1 to +6,377), each a render
  point where the SB DMA is read.
- BLIQ is the only observed `ints` change (2985 -> 2978, a PIT reprogrammer). That is not proof it is
  the only guest-behaviour change: the IRQ-count and audio differences elsewhere are guest-observable.

The smallest reference check (one slot; 15 runs, about 3 s each untraced in P3, traced time
unmeasured, so the total bound is 300 s): BLIQ, CYCLE and CAVEIRA on head, v2v3, v2v3j, v2v3j_v4 and
stack. It runs wav-validate/wav-run.js, which drives runDos with corpus-ab's exact witness recipe,
plus read-only irq traces and PIT port 40/43 traces for BLIQ. Validity gate: head and stack equal
P3's l1 rows on every guest field (wav, frame, dispatched, irqs, ints, pixels); otherwise the result
is VOID. Each row records the audio clock (frames, rendered, outAcc residue, guest seconds), so the
length question is answered by measurement. The run attributes which patch changes the audio, classifies the first
divergence against the schedule's date contract, and compares samples with wav-compare.js (tests 5/5).

## 7. Evidence gaps and follow-ups

- No performance measurement for J, the SMC fix or the stack.
- SMC fix regression risks, unmeasured:
  - keeping code bits up after a pure program's first store adds self-modify breaks wherever a straight
    line stores into its own later bytes; the CYCLE-style mixer the original comment cites is the case
    to watch for speed;
  - no synthetic reproducer reaches the pure-volatile path yet (repro2: the transfer-separated form
    passes everywhere); BRW remains the only witness.
- J residuals (jmp-syn-j README): an unresolved jmp_syn target still hands back; a uop deopt stub at a
  jmp target reachable both ways can stop one block later; uop parity with L1 under J is unmeasured.
- The v2+v3+v4-only off-schedule check (criterion 4.3) is not run.
- The wav correctness of the 11 schedule-on moves is not assessed.
- The uop tier is not among the corpus arms (P3 covers l1, jit-early, jit-sepc, fold64).
- Housekeeping:
  - runner prep should pass `--no-backup-if-mismatch` (a compile.js.orig appeared in stage 1);
  - brw.txt's first-difference summary should strip `hb=` as the gate does;
  - landing needs the docs/dos-corpus/live browser bundles regenerated.
