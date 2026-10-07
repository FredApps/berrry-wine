# Actual CALL/RETF contract fixture — prepared, not executed

Four cases: same-CPL0 and ring3→0, each with zero/two parameters. All use a
present typeC gate whose target code descriptor is16-bit. The immediate CALL
is16-bit and supplies an intentionally wrong offset4567; the gate targets400.
Original engine must fail by reaching selector43/base8/IP4567 after checked
setup, not by a compiler exception, missing export or setup timeout.

The COM bootstrap really copies a4KiB synthetic blob, LGDT, MOVCR0 and far
jumps into ring0. It sets flat data selectors, distinct ring0/ring3 stack bases,
TSS ESP0=1000/SS0=28, and executes LTR38. Same-CPL cases are entirely ordinary
COM instruction execution. Ring3 cases explicitly initialize synthetic unit
fixture state at one verified pre-execution caller boundary: CS13/SS33/ESP2000
and data selectors23. This is required because normal protected IRET/RETF
outer-stack setup is itself missing. It is not a guest-only ring3 startup claim
and never changes a proprietary game. Actual GDT/TR/CR0 and cached CS/SS base,
D and B widths/ESP are asserted before and after that one initialization.

Guest instructions check target selector, carry preservation, callee SS/ESP,
dword return pair, parameter order, old stack pointer/selector where required,
and sentinels around the new frame. RETF32 imm then checks caller CS/SS/ESP,
parameter release and carry preservation, records stage3 and exits DOS0.
Stages1/2 are reached only by real guest stores. Before mode requires stage1
and a read-only observed wrong target; candidate mode requires all guest checks
and exit0. No candidate engine patch exists yet.

run.js supervisor allows40sec total, childTERM35sec/KILL+1sec, retained
head/tail200KiB/fullstreamSHA, fresh output,2GiB disk floor and exact source
hashes. Each case has20kdispatch/0.3sec runDos limit; guest performance is not
measured. Fresh temporary fixture files are deleted in finally; receipts retain
source/module/fixture hashes, initial state and real target observations.

Known prerequisites remain explicit: ordinary protected exception frames,
invalid gate/stack faults and outer IRET are NOT proved by these valid CALL/
RETF cases. More tests from CALL-GATE-DESIGN.md follow before any broad CPU fix.
No tests, builds or emulators have run for this fixture yet. Requested next
lease <=40sec includes source builder sanity and actual baseline validation.

## Preserved first setup failure and bounded correction

Before-attempt1 reached guest stage1, but the pre-step wrapper never saw caller
0200 because the normal compiler linked the direct setup jump within a slice.
The fixture correctly rejected initialized=false; this is not a gate negative.
No input/code/CPU change is used to force a rendezvous. Corrected fixture uses
existing runDos `slice:1`: emit.js633 CONT rejects a linked transfer after the
dispatch budget is spent; the real setup JMP then returns normally at caller
0200 before its instructions execute. All boot validation remains mandatory.
This is an explicit unit-test scheduling setting, not a game/performance claim.
The original failed output remains immutable. No retry has run.

Before-attempt2 validated setup and proved same-CPL params0 wrong target. The
params2 record also shows selector43/IP4567 but base20008: the gate parameter
count occupies byte4, which the wrong descriptor-base extraction interprets as
base bits16..23. The original expected-base8 predicate was too specific and
stopped the suite before ring3 cases. Corrected baseline predicate expects
8+parameters*65536, preserving exact wrong selector/IP and validated setup.
Candidate assertions remain unchanged; raw failed suite is not relabeled PASS.
