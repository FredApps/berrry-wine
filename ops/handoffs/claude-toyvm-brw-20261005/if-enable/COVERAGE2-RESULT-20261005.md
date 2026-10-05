# Coverage2 fixture result: candidate v2 and stack baseline (2026-10-05)

## The run

Root granted the run at about 19:29Z, after Arena was released. Exact 00bc2dd0 pins: test e19398b3,
build-tree b2d24038, wrapper d86f384c, candidate-v2
ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4 (all verified).

| item | value |
|---|---|
| invocation | `--plan=cand,stack`, one 300 s bound |
| wrapper Node PID | 3143896; exit 0 in 47.1 s |
| children | build-cand 3143903, test-cand 3143916 (23 s, exit 0), build-stack 3144517, test-stack 3144529 (23 s, exit 1), all exited |
| cleanup | process tree clear; trees removed `[true, true]`; no `/tmp/toyvm-ifen-*` |
| board | claim 19:29:38Z, session 19:29:49Z, release in the board post after |
| artifacts | `ifen-fixture-cov2-20261005/` (result.json, test-cand.txt, test-stack.txt with raw arm lines and `--why` rejects) |

## Result

- **Candidate: PASS.** All 7 counted cases on all 5 arms:

  | assertion | result |
  |---|---|
  | [0] program exited | `exited=true` everywhere |
  | [1] at the boundary | ≥ 7 everywhere; `region_coexist` 8/8 at X, `sti_in_loop` 11 at Y |
  | [2] inside a shadow | none |
  | [3] parity | identical sequences across arms |

  - µop-only's own `ifen` counts agree: 8 for `region_coexist`, 11 for `sti_in_loop`.
  - `sti_movss` (informational) held under `IFEN_STI_MOVSS = true`, which is still UNCONFIRMED.
- **Stack: ARCH-FAIL, as expected.** [0] held everywhere; every counted case fails [1] with 0 at the
  boundary.

This answers the earlier `region_coexist` count failure: with `work` bounded, all 8 rounds ran, and
8/8 were delivered at X. This shows only the count; it is not a general claim about the candidate.

## Engagement (limited evidence; three levels kept apart)

| arm | installed/compiled | executed | boundary compiled+executed |
|---|---|---|---|
| uop | 2 heads | 164–170 entries, about 3.2–3.3M steps | not shown (µop programs never contain STI, POPF, IRET or SS loads) |
| uopOnly | 11–13 programs | 251 / 65,811 entries | not shown |
| region | **0**: declined "no self-loop region found" in both trees | — | — |
| fold | **0 tree folds** in both trees | — | — |

**Region JIT `--why` rejects** (first 8 lines only, so not exhaustive):

| case | tree | rejects |
|---|---|---|
| `region_coexist` | cand | a block with `int_imm` (the `int 21h` exit), blocks ending in `ret` "with no inlined call to return to" (delay/spin/`work`), and a block that "runs into an installed region or an unknown handler" |
| `sti_in_loop` | cand | additionally **"0x10001dc contains sti"** |
| `sti_in_loop` | stack | the analogous block is rejected as "runs into an installed region or an unknown handler" |

- So the region JIT refuses that hot loop in both trees. On the candidate, the first reason it hits
  is the candidate's walk-level IF-boundary exclusion (`IF_BOUNDARY_OPS` in `chainFrom`/`traceFrom`).
  That is evidence the exclusion fires on a real hot loop, not that any region compiled or ran a
  boundary.
- **`work`'s own loop:** its reject reason is not among the first 8 lines. Why the region JIT will not
  take it is still not established. The capture limit is the fixture's, and raising it is a
  source-only change.

## Still not shown

- **Region and fold execution through an IF boundary:** never shown. The detour-decline path is
  covered only by the static unit test (00bc2dd0).
- **Residual architecture, unhandled:** TF, 16-bit wrap, standalone SS shadows, HLT, the host INT
  return / IRETD to V86, timer-only pending, same-block SMC.
- **Gates still ahead:** corpus A/B, CONT performance, the at-risk toyvm tests, bundle regeneration.
- No promotion.
