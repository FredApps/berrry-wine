# Coordinator review

The recorded baseline run demonstrates delayed IRQ delivery in both tested trees. Its early assertion failure left shadow and cross-arm parity assertions unevaluated. The report-all test change removes that short circuit without changing the assembled programs; its rerun remains pending.

The design is a proposal, not an implemented or validated correction. In particular, the composed STI/MOV SS case remains informational. Earlier expectations in the design do not replace the measured result or the explicit unknowns in RERUN-RECEIPT.md.

The adjacent SMC work is diagnostic preparation only. The current stale-byte behavior is not an accepted CPU contract; neither rewriting an expected result nor observing zero events in a finite corpus resolves correctness or arm parity. The original failing regression remains open.

These handoffs contain no promoted runtime optimization. The archived patch file is preserved byte-for-byte, including its blank diff context line.
