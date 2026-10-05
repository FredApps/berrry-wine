# Ground truth at the BRW split (root grant 13:47:11Z, 6 s, private HEAD+combined+v4)

Arm: L1 with smcFlush (the whole decode cache is flushed on any self-modify, so stale decoded code cannot run). State window 330588080-330588260.

```
smcFlush L1  330588127 8:c179 ax=1100 si=f687 | 330588165 8:c35a si=f2b6 | 330588204 8:c179 si=f907
jit-sepc     330588127 8:c179 ax=1100 si=f687 | 330588165 8:c35a si=f2b6 | 330588204 8:c179 si=f907
L1 (cache)   330588137 8:c290 ax=500  si=f687 | 330588214 8:c290 si=f681 | 330588250 8:c34b si=f901
```

**The ground truth matches jit-sepc, not L1.** From the last shared state (330588088, 8:c35a), the cached interpreter misses the self-modifying writes to the span loop's immediates (linear e2dd-e2f4 = 8:c35d-c374; jit-sepc breaks on them at 330588165 and 330588242, L1 does not) and runs the loop with STALE immediates. So the remaining BRW L1/jit-sepc split is a defect in the INTERPRETER's SMC detection. The region arm is right here, and the +1 dispatch offset is the cost of the two correct breaks L1 skipped.

Scope and caveats: measured on the v4 tree. None of v2/v3/J/v4 touches SMC detection (J's compile.js change is only the IP-wrap end_cut), so the same L1 miss is expected on HEAD, but that is not yet run. The 'TOYVM-REGION-JIT-BRW' title assumed the JIT was wrong; for this split it is the reference.

Next: why L1 misses those writes. The block holding c35d-c374 is compiled in L1 (it executes it) but the store does not raise $smc, so its code bits for those bytes are clear or stale. Candidates: bytes decoded into another trace (a traced jcc body or fused op) whose code bitmap omits that paragraph; a code-bit clear after an arena reset; the narrow invalidate in region-live (L1 has no installs, so less likely). Confirm on HEAD, then a toyvm-only test: a loop that patches its own immediate from a different block, cached L1 vs smcFlush.
