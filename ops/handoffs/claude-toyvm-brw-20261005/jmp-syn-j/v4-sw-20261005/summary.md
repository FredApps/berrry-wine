# v4 state window 330.5-330.6M (root grant 13:22:34Z, 12 s, private HEAD+combined+v4)

Files: {l1,sepc}.state (d cs:gip regs) and {l1,sepc}.clock. Matching handbacks by (cs:gip, registers): 296 at the same dispatch count, 139 one dispatch apart.

- Last state-equal, count-equal handback: 330588088 at 8:c35a (both arms).
- Between it and 330588250 the arms COMPUTE DIFFERENTLY. jit-sepc hands back at 8:bec5 (cx=30, sp=65960; L1 has no handback there), and at the next loop top si is f907 (jit-sepc) vs f681 (L1). At 330588250, 8:c34b, the registers differ: L1 ax=0 si=f901, jit-sepc ax=8080 si=f67b. This is Phase 1's original register signature (then at 330588033), still present after v2+v3+J+v4.
- The states reconverge by 330588327/330588328 at 8:c34b, now ONE dispatch apart. That is the +1 seen at 330.6M and at the end of the run (500918120 vs 500918122).

So after the four timing fixes, the remaining BRW split is a guest-visible computation difference in the region arm around 8:bec5..c35a, not a schedule or billing effect. Next (needs a slot): dump guest code 8:bec0-c360 at ~330.588M and per-instruction trace (trace-at / state at every block) over 330588088-330588260 in both arms, to name the first instruction whose result differs (candidates: a clock/port read inside a region, a region path with a wrong side exit, or a divide/SMC path from worker A's B1/B2).
