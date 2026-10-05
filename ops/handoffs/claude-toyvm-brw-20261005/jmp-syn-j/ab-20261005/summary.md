# Fix-J A/B, 2026-10-05 12:58Z (root grant 12:57:12Z, 21 s, single core, private copies)

Base HEAD 2683a6e3; emit.js sha256 HEAD 7a4f57fd..., J e07d99db...; jmp-syn-j.patch sha256 7f8a7275...; J-old = J with TOYVM_JMP_SYN_BUDGET_TEST=1.

| arm | A3 IRQ deliveries on other cs:ip | A4 ISR di | A1 dispatched delta | A5 closed form | NC1 control | region-live (4) + install-clock |
|---|---|---|---|---|---|---|
| head | 811 | differs | 0 | ok | 0 diffs | PASS |
| j | 0 | equal | 0 | ok | 0 diffs | PASS |
| jold | 811 | differs | 0 | ok | 0 diffs | PASS |

- J-old reproduces HEAD exactly: report.json identical except wallMs, and all 7 IRQ lists (L1, RJ, NC1-L1, NC1-RJ, NC2, A2-L1, A2-RJ) byte-identical.
- J leaves the interpreter unchanged on this program: L1, NC1-L1, NC1-RJ and NC2 IRQ lists are byte-identical between HEAD and J. Only the region arm moves (811 lines), and under J it equals the interpreter exactly (J RJ == J L1 == HEAD L1).
- Not covered here: BRW 500M parity, the corpus, the uop arms, and L1 timing on programs where L1 itself has jmp_syn edges. The latter needs the corpus re-baseline.
