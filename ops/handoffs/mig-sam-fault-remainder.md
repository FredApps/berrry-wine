# MIG-SAM-FAULT-REMAINDER

Read-only review by `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`,2026-10-02.
Only this handoff and append-only board notices written. No source/test edits,
builds, tests, runtime/process/remote jobs or commits. `fp_parity` retains its
current REP fixture and implementation. Findings describe inspected source,
not an independent validation of that still-active owner's final submission.

Inputs: original preserved `serious-tls-integrated-build.js` under
`scratch/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd/`, the timer-only-removal
builder `scratch/mig-sam-timer-replay-20261002/build.js`,
`mig-sam-fault-plan.md`, fixture handoff and current production sources.
The eight fault/REP blocks in the timer-removal builder are the original
preserved blocks. Four timer blocks were already removed in the accepted
0c5d6ab0 diagnostic replay; persistent timer context remains production code.

## Transform disposition

Numbering follows the eight blocks in the timer-removal builder. “Remaining”
means an unresolved diagnostic dependency, never approval to ship its policy.

| Block | Exact operation | Current disposition |
| --- | --- | --- |
|1,05-alu|Add `ss_fault_pc`; make th_nop save nonzero operand|Remaining for the prototype's generic miss path. Production REP receives prefix PC directly, so no REP dependency on this instrumentation. Generic scalar precise-PC work remains.|
|2,07-decoder|Emit opcode0 with d_pc after setting insn_start|Same dependency as1. Must remain paired with1 while3 reads ss_fault_pc. Per-instruction marker correctness through folds/uops is not established by the no-uop intro replay.|
|3,03-registers|Before g2w_miss, raise AV for ga>=virtual_alloc_min with fault_raising/eip_redirected guards; set EIP from marker|Remaining generic diagnostic behavior. Production generic misses still use mode0/2/3 and sentinel completion. REP now preflights explicitly even in mode0. Allocation-floor policy is not protection/access validation and must not become global production policy.|
|4,11-seh|At “Non-C++ handler” comment, route every AV to raw handler|Classifier gap remains; shortcut is not an acceptable correction. Earlier B8 test still skips raw MOV-EAX handlers. Raw frames with accidental scope-like adjacent words still enter CRT handling. Current shortcut also invokes the legacy read-default wrapper, losing explicit write metadata if a production REP reaches it. It cannot be retained unchanged as reliable REP evidence.|
|5,05b|Replace rep_movs_do through rep_stos_do boundary with per-element prototype|Superseded by production rep_movs_do(w,pc), complete-element presence preflight, precise PC and published partial progress. Production covers separate MOVSW too. Remove from a future private builder after owner gates/ACK. Keeping it overwrites the helper with a one-argument signature while current wrappers/MOVSW pass two: a static incompatibility, not a tested compile result.|
|6,03-registers|Add ss_write_active/ss_fault_write and ss_g2w_write; wrap translations in gs8/16/32/64/gsv128|No longer needed by REP. Generic write classification remains unresolved, so its diagnostic purpose is not wholly redundant. Current generic raise_exception still supplies access0; these globals alone do not deliver write metadata after block7 becomes ineffective. Broad store wrappers remain unsuitable for unreviewed production integration.|
|7,11-seh|Insert ss_fault_write store at record+20 by matching record+24 write from global fault_address|Old insertion is superseded and now matches nothing: production writes explicit local access at+20 and local address at+24. Raw records and ContinueSearch already carry these parameters. Remove obsolete replacement, but separately adapt any retained generic diagnostic caller to the explicit metadata interface; deleting it alone does not prove generic write reporting.|
|8,05b|Patch prototype destination preflight g2w calls to ss_g2w_write|Superseded with5. Production source/destination checks pass access0/1 directly. Its substring anchor is absent from the new helper; retaining this string splice has no valid contract.|

Thus blocks5/7/8 are obsolete as written; blocks1/2/3/4/6 represent unresolved
generic/classifier dependencies. There is **no safe “delete three and run”
claim**: the generic write-metadata and classifier bridge need explicit
compatibility review in any later private builder. Preserve original builders
and artifacts. Future transformations need asserted match counts and tests;
silent String.replace success is not evidence.

## Production boundary and blockers

Current `rep_movs_element_present` checks every byte of width1/2/4, source first,
and calls `raise_exception_access(code,access,address)` with prefix EIP before
any failed-element store. Full contiguous-span copies keep the bulk helper.
MOVSW, decoder operands,07b TU_REP_STR and07c consumers now carry PC; redirected
execution must exit before stale register publication. The owner is validating
those paths; mode0/3 matrix PASS notices are not this review's test evidence.
This remains absent-page coverage, not PAGE_NOACCESS/READONLY enforcement,
all generic accesses, code16/address16 or arbitrary optimized execution.

`raise_exception_access` and `seh_walk_from_access` now carry metadata by
parameters; raw ContinueSearch reloads it from the guest record. Legacy
`raise_exception` intentionally passes access0. Generic g2w_miss still returns
NULL_SENTINEL after raising, so the failed operation can finish against scratch
and mutate a register before dispatch honors redirection. Precise generic PC,
failed-instruction effects, straddles and nested faults require separate proof.
The global fault_address used by diagnostic storm tracking is distinct from
the explicit REP record address; do not silently substitute one for the other.

Classifier remains two ambiguous heuristics in11-seh: first byteB8 is treated
as C++ before raw-frame recognition; a mapped+8 pointer and+12 trylevel -1 or
<0x400 are treated as MSVC frame shape. Neither identifies handler ownership.
A fix needs a reviewed positive recognition rule for supported CRT stubs/frame
formats, with real MSVC/C++ controls. An all-AV raw route breaks that contract.
Preserve existing Delphi nesting and timer continuation hunks in11-seh/09b.
No region/header/NFS2 ownership is required or released by this review.

## Smallest next discriminating fixture

First, let the existing owner finish and freeze REP evidence. The ready
classifier discriminator already exists in its fixture: same default MOVSD
destination-hole case, mode0, threaded, only change `--handler=mov-eax` and
`--handler=scope-like`, compared with `--handler=plain`. The first handler
starts B8 imm0; the second places a mapped pointer and trylevel-1 beside an
otherwise raw registration. Both should invoke the raw handler once, record
write1/exact REP PC, repair, and continue without replaying the prior marker.
No new fixture edits are necessary to expose these two ambiguities. These
commands are proposals for its owner/coordinator, not executed here:

```sh
node test/test-rep-movs-fault-restart.js --fault-mode=0 --handler=plain
node test/test-rep-movs-fault-restart.js --fault-mode=0 --handler=mov-eax
node test/test-rep-movs-fault-restart.js --fault-mode=0 --handler=scope-like
```

Do not grant a classifier implementation based on those negatives alone.
Before changing routing, pair them with an actual supported MSVC scope-table
AV/filter case and a real supported C++ B8 FuncInfo/jump stub, showing the
proper filter/catch behavior and hardware-exception search. That prevents
“route every AV raw” or “every B8 raw” from satisfying the suite incorrectly.

For **generic fault semantics**, the smallest separate baseline is decoded
scalar MOV read versus write to the same reserved absent page, after a marker
in the same basic block, using a plain raw handler and diagnostic mode3.
Capture the first exception/context before repair; have the handler advance
saved EIP to the known following instruction and ContinueExecution. Assert
exact scalar PC (not block head), read0/write1, absent address, pre-fault GPRs,
one handler, prior marker once and following marker once. A mapped-memory
control verifies the instruction/handler scaffold. Mode0 remains a documented
sentinel-policy control, not a request to change its default behavior.
This isolates generic PC/kind/abort semantics without mixing REP or classifier
failures. Require a fresh fixture claim (suggested
`test/test-generic-fault-context.js`), private source identity and CPU grant;
do not edit the other owner's current fixture. Add straddling/partial-store,
cached/optimized, nested and protection cases only after this minimal baseline
identifies the failing contract and coordinator grants the next bounded slice.

No production policy, builder rewrite or replay is authorized by this note.
Next replay remains blocked on owner ACK, exact transform adaptation review,
focused gates and a separate CPU/GL grant; Serious Sam gameplay is still open.

Inspection hashes (shared files may subsequently change under active owner):

```text
03-registers.wat 649f2beeb1c11cd2de526174947448788e15a1a2c40d01440897f30c444c04f8
05b-string-ops.wat 35d5c977e9acb33dd3511e1529985cadc546a4c06b4c9cfe8c46176c9aea7a47
11-seh.wat 62c8f2fbff37646f357fb9bf1564fd186be3cf54d980252ca1f105cf4f1ae184
timer-removal build.js fb30a78c5e71e495271a2534e88f93fb5f8bcbad305ca76c46090692a903515a
```
