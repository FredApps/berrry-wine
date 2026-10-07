# Native Arena/Daggerfall first CD/PM boundary — 2026-10-07

Short diagnostic only. Neither game reached native gameplay. Original payloads
were read in place; no fabricated CD service, input, or guest state. Session87522
closed at10:18:22.166Z after3.912s, both child processes exit0 without signals;
PIDs2505427/2505451 absent. Exact source/module/entry hashes are in raw records.
Source worktree7cb86eae has the same native runtime as the prior ecaacf5c census;
metadata-only changes are separately pinned. Original full source inventory
remains in the immutable scratch run pins.json. No performance claim.

## Arena: concrete MSCDEX installation query

Unchanged engine module87af3919 (332359B),2-second maximum guest census.
`arena.log:174` records INT2F AX=1500 BX=0 CX=0 DX=03d9, return22fe:0323,
UNHANDLED. Next message is “MSCDEX Driver not installed.” Actual guest exits6,
not a harness timeout. Native CLI exit0 means harness completed, not game success.

Original DOSBox configuration mounts this original payload as both C: and D:
CD-ROM, overlays saved files onto C:, sets ARENADATA=C:, then starts ACD on D:.
Current native flat filesystem discards drive/directory identity. Correct next
scope is explicit read-only CD drive configuration and real supported MSCDEX
contracts backed by those files, with writable C: separate. Returning an invented
installed count alone is not a fix. Additional calls remain unobserved behind
this initial check; do not claim all CD support from AX1500.

## Daggerfall: gate descriptor used as a code-segment descriptor

Private diagnostic module89d400ba (332464B) changes compiled shape to record
attempted MOV CR3 operands; it is not a performance baseline. The real-WASM
fixture recorded two explicit writes and preserved visible registers, CR0,
entire memory hash, and DOS exit against a fresh original module. Both loaded
27-file original source closures are equal. This limited test is not universal
CPU-equivalence proof.

Actual game observation has6 distinct PM entry rows, no cap/errors. One attempted
CR3 write carried0x1a000; CR0=0x80000011, GDTR=0x18a70 limit0xffff. The original
engine still discards CR3, so this is not a maintained architectural CR3 value.
No blanket paging/DPMI cause is inferred.

Observed sequence includes A8:06d1 -> A3:087d -> 5B:1c35 -> 5B:1204 ->
4B:13ad -> 4B:142a. Last two cached CS bases are0x28 and code bytes point into
CauseWay error text. At the transition, GDT+0x48 is `ad13280000ec0000`:
present/DPL3/system/typeC32-bit call gate, target selector0x28, offset0x13ad,
parameter count0. Gate target descriptor GDT+0x28 is `ffff0021009a0000`:
base0x2100, limit0xffff, present DPL0 nonconforming readable code, D=0.
The predecessor CS0x5b is DPL3 code (`ffff002100fa0000`). Correct gate resolution
therefore needs privilege/stack handling, not merely changing cached CS base.

Actual predecessor and following SS remains0x30, descriptor
`ffff608901924000` (base0x18960, DPL0 data, B=1). Source `emit.js:2484` and
`:2627` ordinary far-call handlers push their operand-sized return then call
`$sset` directly. `$sset` at4563 invokes `$segbase` at4621, whose descriptor-base
extraction interprets gate target-selector bytes as a code base. There is no
call-gate resolution in these handlers. The exact original transfer opcode was
not retained (32-byte pre-entry snippet ends before it); this bounds the causal
claim to the descriptor-loading contract, rather than an invented callsite.

GDT+0x20 retained `7401f08801e90000`: available386TSS base0x188f0 limit0x174.
The first captured code includes LLDT AX=0x53 then LTR CX=0x23. Actual TR, TSS
ESP0/SS0 and full old stack were not captured, so the live stack-switch inputs
remain unknown. Source LTR at2924 stores `$tr`; existing `$v86_to_monitor` at5549
already reads TSS ESP0(+4)/SS0(+8), but its VM86 frame is not a call-gate frame
and cannot simply be reused wholesale. Current RETF also lacks privilege-return
handling. A correct proposal must cover target validation, gate width, TSS
stack selection, frame/parameter copy and return, with same-level and failing
contracts. No engine repair is included here.

Architecture reference: [Intel 80386 manual section16.4](https://pdos.lcs.mit.edu/6.828/2016/readings/i386/s16_04.htm)
(type12 gates use32-bit operands), and [Intel SDM Vol3](https://cdrdv2-public.intel.com/851064/325384-087-sdm-vol-3abcd.pdf)
(call-gate target and protection rules). Descriptor `.valid` in raw JSON means
only bounded mapped bytes, not architectural validity. LDTR0 is explicitly
inactive; later LDTR0x53/base0 bytes are retained as raw bytes, not endorsed.

Next minimal evidence before a game-specific candidate: record actual TR and
bounded TSS prefix, old SS:ESP and the source far-transfer opcode around the
5B:1204 continuation. Prefer this precise gap over another broad startup run.
Prepare actual instruction contracts first; source implementation requires
separate review. Missing native directory/drive/paging/device support remains
independent and may be the next blocker after a truthful gate repair.
