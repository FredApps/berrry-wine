# BRW parity with the full candidate stack (root grant 14:20, 18 s, private HEAD + v2+v3+J + v4 + smc-pure-forward-fix)

Tree hashes: dos-loop.js 74f94f3e..., compile.js 0910ce47..., emit.js e07d99db...

| | L1 | jit-sepc |
|---|---|---|
| frame at 500918116 | 4dbd3ff0 | 4dbd3ff0 |
| endHash (full RAM + regs) | b8c9e30a0bc99ba2 | b8c9e30a0bc99ba2 |
| dispatched | 500918122 | 500918122 |
| IRQ deliveries (vec, at, cs:ip) | 9871 | 9871, 0 differ |
| SMC breaks | 18634 | 18628 (differs, state identical) |

Start of the investigation (HEAD): L1 a066bf27 vs jit-sepc 2fa3dd95. Each mechanism moved the first divergence later: 88.9M (v2/v3 early handback on a date) -> 115.06M (J, jmp_syn budget test) -> 160.195M (v4, overdue SB date) -> 330.6M (forward-SMC: the interpreter ran stale code) -> none.

Scope (narrow, per root): this is BRW parity on one fixture with four unapplied candidate patches. It does NOT establish general forward-SMC correctness: the same-block forward patch fails on HEAD in every mode (repro2-20261005), and no synthetic reproducer reaches the pure-compile path yet. L1's own result changed (a066bf27 -> 4dbd3ff0), so landing needs the corpus before/after A/B and the user's decisions (J vs R, L1 baseline changes, the SMC fix). Nothing promoted.
