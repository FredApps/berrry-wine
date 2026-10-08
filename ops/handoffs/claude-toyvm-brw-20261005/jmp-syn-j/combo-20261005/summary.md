# Combined v2+v3+J on BRW, 2026-10-05 13:08Z (root grant 13:04:25Z, 20 s, private HEAD+combined copy)

dos-loop.js sha256 eeb9e2cd..., emit.js e07d99db..., combined patch 54de1b13...

| check | v2 alone (Phase 8b) | v2+v3+J |
|---|---|---|
| synthetic spec A3 mismatches | n/a | 0 (A4 equal, A1 0, NC1 0) |
| BRW first L1/jit-sepc divergence | 115.06M | **160.195M** |
| BRW deliveries on a different cs:ip by 500M | 522 | 522 |
| jit-sepc frame at 500M | 2fa3dd95 | 2fa3dd95 |
| L1 at 500M | a066bf27 / 94a0cf32 | a066bf27 / 94a0cf32 |

First remaining split (line 3057 of 9871): L1 `sb at=160200014 from 8:7b94` vs jit-sepc `sb at=160195306 from 8:7b94`; the next timer follows (160200457 vs 160200009). The Sound Blaster date itself differs by ~4.7k dispatches. No region install is near it (install #9 is at 162004061), so this is a host-side SB/audio clock question again, not an install effect. Next: the brw-bisect --clock-window log (audioAt/lastSbIrq/sbDue per handback) over 160.07-160.21M on both arms with this tree.
