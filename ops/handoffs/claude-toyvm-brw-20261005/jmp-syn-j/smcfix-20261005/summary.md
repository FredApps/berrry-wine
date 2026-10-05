# Forward-SMC fix validation (root grant 14:09, 19 s, private copies)

Fix: smc-pure-forward-fix.patch (sha256 b3371e21...; compile.js + dos-loop.js, 38 lines). It applies on HEAD and on top of v2+v3+J+v4.

| check | result |
|---|---|
| BRW L1 vs jit-sepc, v4+fix, state window 330588080-330588260 | **L1 now matches jit-sepc (and the earlier smcFlush run)**: c35a si=f2b6 at 330588165, same state at 330588242, and at 330588250 identical registers (ax 8080, si f67b) at the SAME dispatch count, so the +1 offset is gone in this window |
| region-live (4) + install-clock on HEAD+fix | PASS |
| reproducer draft on HEAD / HEAD+fix / HEAD+fix+TOYVM_PURE_CLEAR_ALL=1 | PASS / PASS / PASS: it does NOT reproduce. Its subroutine never reaches the pure volatile path (likely its paragraph never goes volatile, or the call/ret shape is not pure). Needs rework; BRW remains the witness. |

Next: (1) rework the reproducer so it fails on HEAD (log volatilePure / volPara for the synthetic program first); (2) BRW L1 vs jit-sepc to 500M on v2+v3+J+v4+fix (frame parity is the target); (3) the corpus A/B for the whole stack, since the fix changes L1 behaviour; (4) user decisions. Nothing promoted.
