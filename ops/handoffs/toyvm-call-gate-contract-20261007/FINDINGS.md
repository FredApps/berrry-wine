# Four actual call-gate negative controls — 2026-10-07

Before-attempt3 completed at10:57:03.087Z in0.548s; child2549655 exit0,
no forced signal, PID absent, temporary fixtures removed. Exact original
module87af3919/332359B and loaded source closure are recorded. No proprietary
game or CPU patch was involved. The PASS means the original CPU defect was
observed as specified; candidate behavior has NOT passed yet.

All four cases validated the real COM bootstrap through GDT/PE/CS/SS/TR setup.
The two ring3 cases then explicitly initialized synthetic unit architectural
context before executing real CALL. This does not prove guest-only ring3
bootstrap, IRET privilege return, or game compatibility.

| Case | Raw gate | Observed wrong CS:IP/base | Observed SS:ESP |
|---|---|---|---|
| Same CPL,0params |0004080000ec0000|43:4567/base8|28:ffc|
| Same CPL,2params |0004080002ec0000|43:4567/base20008|28:ff4|
| Ring3→0,0params |0004080000ec0000|43:4567/base8|33:1ffc|
| Ring3→0,2params |0004080002ec0000|43:4567/base20008|33:1ff4|

Proper gate target was independently checked as08:0400/base80000. Guest stage1
was reached, callee stage2 was not, and guest assertion-failure marker stayed0.
The negative predicate requires this precise wrong selector/offset/base and
successful initial state; timeout or compilation failure cannot satisfy it.
Parameter count byte2 becoming base bits16..23 explains the second wrong base.

Program source contains candidate checks for actual target,32-bit gate frame
into16-bit code,zero/two parameter order,distinct stack transition,carry,
sentinels and RETF32 immediate return/parameter release. These assertions are
prepared, NOT proven by the before run. Ordinary PM exception delivery and
outer IRET remain separate missing contracts described in the earlier design.

Prior-attempt1 was a setup-observation failure: linked execution passed the
caller boundary before the wrapper saw it. Existing slice:1 scheduling exposes
the real setup JMP boundary without changing CPU or guest instructions.
Prior-attempt2 validated setup and showed the same-CPL negatives, but the
predicate wrongly expected base8 for the2parameter gate. Its raw record instead
had20008. Both failures remain retained and are not relabeled suite successes.
Before-attempt3 derives the expected wrong base from independently validated
full raw descriptor bytes. All candidate success assertions remain unchanged.

Original runnable source lives in scratch/toyvm-dos-native-20261007/call-gate-contract.
Copies here are immutable review evidence; run.js depends on the existing
scratch probes/output.js collector. contract.js +program.js can be run with
explicit source-root/output/mode and a separately granted runtime lease.
