# First IF-enable candidate fixture: result (2026-10-05)

## The run

Root granted the run at about 18:56Z, on the exact 2ebe2aa8 files, extracted to
`ifen-pinned-cand-v2/` with every hash verified.

| input | sha256 |
|---|---|
| candidate-v2 | ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4 |
| test | b108a6e3 |
| build-tree | b2d24038 |
| wrapper | d86f384c |

Invocation: `--plan=cand`, with the 140 s test inside one 300 s total.

| item | value |
|---|---|
| wrapper Node PID | 3110932; exit 0 in 17.1 s |
| build-cand | PID 3110939, exit 0; tree dos-loop 4dd7e7b0, compile 8bc68ef3, region-jit 87d41671 (= the dry build) |
| test-cand | PID 3110952, exit 0 (17 s) |
| claim / session / release (board) | 18:56:54Z / 18:57:04Z / see board |
| cleanup | process tree clear, tree removed `[true]`, no `/tmp/toyvm-ifen-*` |
| artifacts | `ifen-fixture-cand-v2-20261005/` (result.json, build-cand.txt, test-cand.txt with raw arm lines) |

## Result: PASS

There was no harness failure and no candidate compile failure: the candidate's WAT assembled and
ran in every arm. All five counted cases, on all five arms:

| assertion | result |
|---|---|
| [1] pending timer IRQ delivered at the IF-enable boundary X | **8/8 rounds** in every case and arm |
| [2] never inside an STI or SS shadow | none, everywhere |
| [3] the same (dispatch, ip) sequence as l1 | true, everywhere |

- There are 23 deliveries per run, against 21 on HEAD. Delivering at the boundary moves later timer
  dates, so the count changes; this is expected, not separately validated.
- `sti_movss` (informational): the composed oracle held with `IFEN_STI_MOVSS = true`. That shows only
  that the switch does what it says. The architectural rule remains **UNCONFIRMED**.

## Engagement: limited evidence, read before quoting [3]

| arm | installed / compiled | executed | parity evidential? |
|---|---|---|---|
| uop | 2 heads | 163 entries, about 3.19M steps | yes, limited |
| uopOnly | 11–12 programs | 249–257 entries | yes, limited |
| region | **0**: "declined -- no self-loop region found" | — | **NO** |
| fold | **0 tree folds** | — | **NO** |

**This run therefore says nothing about how the region JIT or tree-fold handle the IF boundary.**
That includes the v2 decline over detour arms. In these small programs both arms behaved as the
interpreter. Even for the µop arms, a whole-run entry count does not show their compiled code ran
through the boundary itself; per the audit, µop programs never include STI, POPF, IRET or SS loads.

## Not established by this PASS

- **Region and fold coverage.** Needed: a fixture shape whose hot loop the region JIT accepts and
  which tree-fold folds, with the IF-enable sequence near it.
- **Residual architecture, unhandled:**
  - TF / single-step;
  - 16-bit wrap below the STI (refused via `end_cut`);
  - standalone MOV/POP SS shadows;
  - HLT;
  - the host-serviced INT return and IRETD into V86;
  - timer-only pending (keyboard, retrace, GUS and SB not);
  - same-block SMC into the follower.
- **Gates still ahead:**
  - corpus A/B (does any program's output change, and why);
  - the CONT cost (one `global.get` and one `i32.or` per block transfer), measured on fixed work
    with V8 and SpiderMonkey disassembly;
  - the existing toyvm tests most at risk (CANDIDATE.md list);
  - regenerating the browser bundles.

No promotion.
