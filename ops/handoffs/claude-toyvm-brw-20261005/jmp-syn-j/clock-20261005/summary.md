# Clock window 160.07-160.21M, combined v2+v3+J (root grant 13:11:43Z, 7 s, private)

l1.clock sha256 7d932a57..., sepc.clock 000611b5... (cols: d steps audioAt lastSbIrq lastIrq sbDue sliceStart cs:gip)

- Both arms agree through 160191298, a stop with left -16398: one block overshot its date by 16,398 dispatches in both arms, so the SB block-end date (audioAt 160174900 + sbInterval) was passed with no stop.
- L1: next handback 160200014 (a real stop at date 160200000) renders audio and delivers the SB IRQ there.
- jit-sepc: an EARLY handback at 160194854 (left 5146, region exit 8:7bd3) meets sbDueNow (overdue), renders at the ODOMETER (audioAt := 160194854) and the SB IRQ goes in at 160195306, ~4.7k dispatches before L1's.
- Mechanism 3: an OVERDUE date is serviced at whichever handback comes first, and that depends on the code cache. Worker B's v2 review listed it as a NOTE (pre-existing overdue SB render).
- Fix direction (v4, not written): due() clamps an overdue date to the odometer, so the next slice gets budget 1 and both arms stop at the same transfer; under the schedule, render audio only at a stop (clockAt = stopAt), never at an early handback.

Raw SB/timer dates: l1.irq, sepc.irq.
