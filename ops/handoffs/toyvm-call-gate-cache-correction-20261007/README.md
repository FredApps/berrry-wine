# Protected call-gate cache correction — 2026-10-07

Follow-up to feature candidate271648db, not yet approved for main.

The backend carries all six hidden segment bases and loaded data-segment access
metadata. It snapshots before selector replay because both instances share the
register-file memory. Trace audit seeding also restores caches after replay.
Outer RETF uses the hidden loaded access rights (Intel SDM RET Vol2B4-568), not
subsequently modified descriptor-table bytes:
https://cdrdv2-public.intel.com/782156/325383-sdm-vol-2abcd.pdf

Actual before/candidate validation11:50:58.325–11:51:00.275Z,1.950seconds:
- Before source: checked setup then exact wrong-gate-target assertion failed.
- Candidate:36 actual-instruction cases passed. This includes original31 plus
  SS/TR/LDTR table changes followed by real second-instance shared-memory
  carryState/rebind and continued CALL/RETF, and two outer RETF cases retaining
  cached DPL3 or clearing cached DPL0 despite opposite live descriptor DPL.
- Module SHA25682d4c8cb733d3c1ea87a9601555f5644dd5aeb7ff5a9559f0dce4e595abf09f2.
- Both child processes/groups absent; no signals; no game/browser launched.

This directly tests the carry seam, not the complete asynchronous LiveJit
installation. Real/VM86, PM timer/IP, full region-install/clock and browser-bundle
regressions remain separate required gates. CPL3 setup is synthetic unit CPU
initialization followed by real x86 execution, not a game state modification.
No paging, architectural exception delivery or Daggerfall qualification claimed.
Original31-case receipts remain unchanged in the preceding handoff.
