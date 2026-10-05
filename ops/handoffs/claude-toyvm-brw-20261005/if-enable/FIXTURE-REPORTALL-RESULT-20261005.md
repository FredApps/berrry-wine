# Report-all IF-enable fixture: HEAD and stack (2026-10-05)

## The run

Root granted the run at about 18:32Z, on the exact 965728ae files (test 36d51baf, build-tree
6bc77d15, wrapper 57e92732), extracted to `ifen-pinned-965728ae/` with all three hashes verified.

| item | value |
|---|---|
| wrapper Node PID | 3086160; exit 0 in 35.1 s of 300 |
| children | build-stack 3086167, test-stack 3086179 (18 s), build-head 3086919, test-head 3086928 (16 s), all exited |
| claim / session / release (board) | 18:32:31Z / 18:32:40Z / 18:33:27Z |
| cleanup | process tree clear; trees removed `[true, true]`; no `/tmp/toyvm-ifen-*` left |
| trees | stack: dos-loop 74f94f3e, emit e07d99db; head: dos-loop ebe0eb30, emit 7a4f57fd |
| artifacts | `ifen-fixture-reportall-20261005/` (result.json, test-stack.txt, test-head.txt, build-*.txt) |

## Result

**Both trees: ARCH-FAIL.** This is the architectural assertion failure. There is no stack trace,
crash, bound stop or kill, so it is not a harness failure. The stack and head outputs are
byte-identical.

Five counted cases, each on five arms (l1, region, uop, uopOnly, fold), 21 deliveries per run:

| assertion | result |
|---|---|
| [1] pending IRQ delivered at the IF-enable boundary X | **fails in every arm**: 0 at X; every delivery returns to spin's `loop` (0x13a/0x13b/0x13d/0x13f) |
| [2] never inside an STI or SS shadow | **holds in every arm and case** (in shadow: none) |
| [3] the same (dispatch, ip) sequence as l1 | **holds in every arm and case** |

`sti_movss` (informational) shows the same pattern: 0 at X, return 0x141, nothing in a shadow, all
arms identical.

## What this does and does not establish

- **Measured:**
  - On HEAD and the stack, a timer IRQ blocked by IF=0 is never delivered at the guest's
    IF-enable boundary (STI;NOP, STI;RET, STI;CLI…STI;NOP, POPF, IRET), only at a later stop
    inside the IF=1 spin.
  - No delivery landed in a shadow.
  - All five arms produced identical delivery sequences.
- **Not established, and a caveat on [3]:** the test does not record whether the region JIT, µop or
  tree-fold arm actually installed or compiled anything in these small programs. If an arm never
  engaged, its parity with l1 is trivially true. Before [3] is used as evidence of arm parity for
  any candidate, the fixture should also print each arm's engagement, such as region installs,
  µop programs entered and fold installs. This is a source change, to be prepared.
- **[2] on HEAD is weak evidence on its own.** Deliveries only happen at stops in the spin loop,
  far from any shadow, so there was no opportunity to violate one. It becomes meaningful for a
  candidate that delivers at IF-enable boundaries.
- No candidate was involved, and nothing is promoted.
