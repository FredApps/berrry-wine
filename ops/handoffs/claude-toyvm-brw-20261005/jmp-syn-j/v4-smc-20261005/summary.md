# v4 SMC-break log to 330.6M (root grant 13:40:37Z, 12 s, private HEAD+combined+v4)

l1.smc 13,206 breaks, sepc.smc 13,203 (line: dispatched +n cs:gip-after lo= hi= of the write range).

- EVERY differing break is a write to one byte, linear 0x10b90 = 8:ec10 (cs base 0x1f80): the timer ISR writes it right after each tick (break seen at 8:7cf1, date+25..30), i.e. data kept inside a code page.
- Whether that write counts as an SMC break depends on what is compiled over 0x10b90 at that moment. L1 breaks on every tick from 116.3M to 117.8M; jit-sepc misses 116.3-117.1M (11 breaks) and has extra ones at 118.0M and 120.2-120.6M; net 3 fewer by 330.6M (1,080 vs 1,082 writes counted at 0x10b90 in total). The arms' caches differ there (arena resets 6 vs 5).
- 8:ec10 lies among the installed region heads 0xea5e 0xea8c 0xeac7 0xeb02 0xee2d, so a region may cover it, and in that arm the write would be a region guard repair, not a break.
- end_smc is NOT this path (it is the decode-time CS-override store); these breaks are $wr8 setting $smc at a code paragraph, with the block ending at its next transfer.

NOT yet shown: that these breaks move the clock or guest state. The computation split is at 330.588M in the c179 span routine, far from 8:ec10. Next: per-arm smcPatched / smcFastRepairs counts, the span of every installed region (is 0xec10 inside one), and whether the c179 routine's own SMC writes (dfee-e005, e2dd-e2f4) are handled identically in both arms near 330.588M (they are present in both logs; compare their timing there).

## Near the split (330.587-330.5926M)

Both arms break on the span loop's patched immediates (linear e2dd-e2f4 = 8:c35d-c374) at
330587934, 330588011 and 330588088, the last state-equal handback. Then:
- jit-sepc breaks AGAIN at 330588165 and 330588242 (8:c35a);
- L1 takes NO break until 330588327.
From there both streams run in step, jit-sepc one dispatch later (the +1).

An extra break only re-decodes fresh code, so it is always safe; a MISSING one runs stale code.
So either jit-sepc breaks where nothing was compiled (harmless, but it moves the clock), or L1, the
reference interpreter, misses two self-modifying writes and runs its span loop with stale
immediates. That would mean L1 itself computes the wrong value, and the "region arm diverges"
reading is backwards. The registers split exactly in this interval. Next (decisive): a ground-truth
arm that cannot run stale code, `noCache: true` (or `smcFlush: true`), with the same state window
330588080-330588260, compared against both arms.
