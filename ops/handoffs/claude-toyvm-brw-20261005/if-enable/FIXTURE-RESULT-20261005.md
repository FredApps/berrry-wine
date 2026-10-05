# Failing-IRQ fixture result: HEAD and the candidate stack (2026-10-05)

## The run

Root granted the run at about 18:11Z, on the exact 8db463eb files (test e4aeed77, build-tree
6bc77d15), extracted to `ifen-pinned-8db463eb/`. It ran under the operational wrapper
`run-fixture.js` (57e92732): one 300 s total bound, process groups, trees removed on exit,
ARCH-FAIL vs HARNESS-FAIL classification.

| item | value |
|---|---|
| wrapper Node PID | 3066425; exit 0 in 28.0 s |
| children | build-stack 3066442, test-stack 3066507 (14 s), build-head 3067255, test-head 3067264 (13 s), all exited |
| claim / session / release (board) | 18:12:35Z / 18:12:46Z / 18:13:31Z |
| cleanup | process tree clear, both trees removed, test temp dirs gone |
| trees | stack: dos-loop 74f94f3e, emit e07d99db; head: dos-loop ebe0eb30, emit 7a4f57fd (as pinned) |
| output | `ifen-fixture-20261005/` |

## Result

**Both trees: ARCH-FAIL**, the expected architectural assertion failure. Neither output has a stack
trace, crash, bound stop or kill, so this is not a harness failure.

- **All five counted cases fail assertion 1:** 0 of 8 pending deliveries return to X.
- **Every delivery returns to spin's `loop` instruction:** 0x13a (sti_nop), 0x13b (sti_ret and
  popf), 0x13d (sti_cli), 0x13f (iret); 0x141 for the informational sti_movss.
  - Confirmed with `tools/toyvm/dos-disasm.js` on the emitted programs (`100:013a loop 100:013a`,
    `100:013f loop 100:013f`).
  - The pending IRQ is delivered at a stop inside the IF=1 spin, not at the guest's IF-enable
    boundary. This is the design's prediction, on HEAD as on the stack.
- **Stack and head produce identical output.** The v2/v3/J/v4/SMC patches do not change this
  behaviour.

## What was not evaluated

The 8db463eb test throws on its first failed assertion. So in each case only assertion 1 on arm l1
was evaluated. All five arms ran, but **assertion 2** (never in a shadow) and **assertion 3** (the
same (dispatch, ip) sequence in every arm) were not checked.

The source copy now evaluates and prints all three assertions for every arm before deciding. The
programs are byte-identical, and that change is not yet reviewed or run. A rerun would record shadow
and parity evidence for HEAD; it needs its own grant.

No IF-fix candidate exists or was run.
