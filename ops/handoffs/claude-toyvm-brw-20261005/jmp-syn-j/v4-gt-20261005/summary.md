# Ground truth at the BRW split (root grant 13:47:11Z, 6 s, private HEAD+combined+v4)

Arm: L1 with smcFlush (the whole decode cache is flushed on a detected self-modification). State window 330588080-330588260. This is a stronger comparison arm, not an independent interpreter or a general guarantee against missed write detection. Its agreement with jit-sepc supports the stale cached-code diagnosis in this window; the proposed volatile-compile mechanism still needs the confirming observation below.

```
smcFlush L1  330588127 8:c179 ax=1100 si=f687 | 330588165 8:c35a si=f2b6 | 330588204 8:c179 si=f907
jit-sepc     330588127 8:c179 ax=1100 si=f687 | 330588165 8:c35a si=f2b6 | 330588204 8:c179 si=f907
L1 (cache)   330588137 8:c290 ax=500  si=f687 | 330588214 8:c290 si=f681 | 330588250 8:c34b si=f901
```

**The ground truth matches jit-sepc, not L1.** From the last shared state (330588088, 8:c35a), the cached interpreter misses the self-modifying writes to the span loop's immediates (linear e2dd-e2f4 = 8:c35d-c374; jit-sepc breaks on them at 330588165 and 330588242, L1 does not) and runs the loop with STALE immediates. So the remaining BRW L1/jit-sepc split is a defect in the INTERPRETER's SMC detection. The region arm is right here, and the +1 dispatch offset is the cost of the two correct breaks L1 skipped.

Scope and caveats: measured on the v4 tree. None of v2/v3/J/v4 touches SMC detection (J's compile.js change is only the IP-wrap end_cut), so the same L1 miss is expected on HEAD, but that is not yet run. The 'TOYVM-REGION-JIT-BRW' title assumed the JIT was wrong; for this split it is the reference.

Next: why L1 misses those writes. The block holding c35d-c374 is compiled in L1 (it executes it) but the store does not raise $smc, so its code bits for those bytes are clear or stale. Candidates: bytes decoded into another trace (a traced jcc body or fused op) whose code bitmap omits that paragraph; a code-bit clear after an arena reset; the narrow invalidate in region-live (L1 has no installs, so less likely). Confirm on HEAD, then a toyvm-only test: a loop that patches its own immediate from a different block, cached L1 vs smcFlush.

## Source finding: the likely interpreter bug (2026-10-05 ~13:52Z, no runtime)

`tools/toyvm/dos-loop.js` ~817-848, the uncached "volatile" compile for paragraphs the cache has
learned are patched often: when the compiled program is neither cyclic nor has a call
(`prog.calls || prog.cyclic` false), it CLEARS the code bits of the bytes it covers ("pure"), on the
stated assumption that "a straight line that never comes back has nothing to protect: its stores
land behind the program counter, the next entry reads the new bytes".

BRW's span routine breaks that assumption. 8:c30f-c314 store `[0xc35d]` (and nearby immediates),
which lie AHEAD of the store inside the inner span loop the same straight line runs next. If L1
compiles c179...c36x as one volatile pure program, the decoder has already baked the old immediate
into the words for c35c. The store does not break, because the bits were cleared, and the stale
copy runs. The decoder cuts a block at a store into its own instruction stream only for
CS-override writes (end_smc). This store goes through DS.

Fits every observation: the routine is patched constantly (plausibly volatile); L1 misses exactly
those breaks; smcFlush is right (flushes everything); jit-sepc's installs change where blocks start,
so its copy breaks normally.

Status: hypothesis from source. Confirming run (short slot): log, for L1 near 330.588M, which
compile path serves 8:c179 (volatile pure vs cached) and the volatilePure counter, against jit-sepc.
Fix options (none written): (a) a pure volatile program keeps the bits of bytes at or after its first
store whose target it cannot prove is behind the PC; (b) the decoder ends a block at a store whose
absolute target lies ahead within the block's own covered bytes, generalising end_smc to
DS-relative absolute stores when DS base == CS base; (c) never clear bits on the pure path (simplest,
costs spurious breaks, e.g. the CYCLE ISR the comment cites).
