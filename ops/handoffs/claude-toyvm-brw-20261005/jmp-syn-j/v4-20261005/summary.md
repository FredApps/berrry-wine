# v4 validation, 2026-10-05 13:19Z (root grant 13:16:14Z, 25 s, private HEAD+combined+v4; dos-loop.js sha256 2f219242...)

| check | combined (v2+v3+J) | + v4 |
|---|---|---|
| synthetic spec mismatches | 0 | 0 (A4 equal, A1 0, NC1 0, NC2 0) |
| BRW first L1/jit-sepc divergence | 160.195M | **330.600M** (line 6465/9871) |
| BRW deliveries on a different cs:ip by 500M | 522 | 855 (all after 330.6M) |
| L1 frame / endHash at 500M | a066bf27 / 94a0cf32 | f72a694d / b8eb2937 (L1 baseline moves: audio now renders only at stops) |
| jit-sepc frame at 500M | 2fa3dd95 | 4dbd3ff0 |
| dispatched at end, L1 / jit-sepc | 500918120 / 500918117 | 500918120 / 500918122 |
| region-live (4) + install-clock | PASS | PASS |

First remaining split: `timer at=330600001 from 8:c01a` (L1) vs `at=330600002 from 8:c01a` (jit-sepc): same instruction, ONE dispatch apart. That is a +1 billing offset appearing before 330.6M, matching Phase 2's H4 (jit-sepc one dispatch behind from ~336M). Mechanism 4; worker A's design lists two unconfirmed candidates (B1: a divide fault inside a region returns without billing owed ops; B2: end_smc charges a step with no refund, depending on what the host has learned). Next: registers+dispatched at every handback over 330.5-330.6M in both arms, to find the first handback where state is equal but the count is off by one.
