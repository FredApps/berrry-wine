# MIG-SAM-FAULT-PLAN

Worker `codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, `/root/fp_parity`;
2026-10-02 UTC. Read-only planning complete. Only this handoff and append-only
board notices written; no source edits, tests, builds, process commands, remote
access or experiments. No CPU/browser/resource claim. Implementation is not
authorized by this note.

## Recommendation and current boundary

The smallest useful production slice is **restartable 32-bit-address REP MOVS
on an absent sparse guest page**, covering widths 1/2/4 and both DF directions.
Keep ordinary generic loads/stores and their existing diagnostic fault policy
outside that slice. Use a REP-specific fault entry carrying instruction PC,
read/write kind and failing address, rather than promoting the prototype's
global address-threshold rule or wrapping every store helper.

This is a proposed implementation boundary, not proof that the current code
supports it. The immediate ready assignment is a dedicated decoded REP/SEH
regression fixture and a bounded audit of optimized fallback and handler
classification. Production promotion remains blocked on those results and
coordinator hunk grants. Do not silently exclude MOVSW or certify only
`--no-uop` execution.

Read inputs: `mig-sam-review.md`, `mig-sam-timer-replay.md`, current WAT/test
sources, and `scratch/mig-sam-timer-replay-20261002/build.js`. The accepted
production-timer diagnostic module is
`0c5d6ab0f8f184c59e46c4f8495e77225cb918d376f883f77809559aaddd57fc`.
Its eight fault/REP transforms remain private; previous intro equality does
not establish fault semantics or optimized-path correctness.

## Eight preserved transform blocks

| Block | Current production dependency / limitation |
| --- | --- |
| `05-alu`: NOP stores `ss_fault_pc` | Prototype instrumentation, not a production PC contract. |
| `07-decoder`: emit NOP before each instruction | Avoidable for REP-only scope; folds/optimized paths still need an explicit PC contract. |
| `03-registers`: raise AV from `g2w_miss` above `virtual_alloc_min` | An address threshold is not access validation. Existing miss modes and recursion/redirection guards must survive. |
| `11-seh`: AV shortcut to raw handler | Inserted after the earlier `0xB8` C++ heuristic; therefore it does not fix every raw-handler misclassification. Blanket AV routing also bypasses real CRT handling. |
| `05b-string-ops`: replace `rep_movs_do` | Per-element preflight/progress, but does not replace the separate `th_rep_movsw` implementation in `05-alu`. |
| `03-registers`: write-active wrapper for all `gs*` translations | Broad generic-helper change unnecessary for a REP-only explicit fault record. Nested faults and stale kind state require care. |
| `11-seh`: write AV information[0] | Needed for correct read/write reporting; production currently zero-fills this field, hence reports reads. |
| `05b`: destination preflight uses write wrapper | REP can supply write kind directly; fault before any failed-element store. |

`guest_page_translate` currently tests PRESENT, not protection bits.
`guest_addr_mapped` is consequently not a complete read/write access check.
PAGE_NOACCESS/READONLY enforcement is a separately scoped prerequisite for
claiming general access violations; this first slice must state absent-page
coverage explicitly. Neither allocation floor nor mapped endpoints proves
whole-span safety. For a straddling element, identify the first absent byte
(typically the next page boundary), not merely the element's final byte as
the prototype does.

## Concrete implementation design to review

1. Encode the prefix-start `insn_start` in the currently unused operands of
   threaded REP opcodes 82/83/186 in `07-decoder.wat`. Thread that PC through
   byte/dword wrappers and the separate word handler. Zero-count REP must not
   probe memory. Restrict this contract initially to the existing 32-bit
   address path; code16/address16 uses separate decoding.
2. Preserve the mapped/contiguous bulk helper for callers that prove the
   entire span safe. For the fault-capable path, preflight each source element
   then destination element, including page crossings, before any write.
   After each successful element publish ESI/EDI/ECX; on failure record the
   prefix-start PC and access kind, raise once, and return without executing
   the failed element or a final full-count update. Preserve DF, overlap order
   and successful-store code invalidation. Guard arithmetic wrap explicitly.
3. Make the REP fault record explicit before entering SEH. Do not rely on
   a translation helper returning scratch memory after raising, or on a
   subsequent `eip_redirected` check after registers have already changed.
   Existing dispatch redirection can end the abandoned block, but optimized
   paths must not reload stale locals over the handler's restored context.
4. Reuse existing raw continuation/disposition machinery. Add accurate AV
   information[0] through a deliberately initialized/reset fault-kind field
   or equivalent narrow record path; generic faults must retain a defined
   default. Nested handler faults must not overwrite the outer saved record.
   Resolve classification independently; do not copy the all-AV shortcut.

This avoids the per-instruction NOP instrumentation **for REP**, conditional
on the execution-path audit below. It does not establish precise PC for
arbitrary loads/stores and cannot yet remove both marker blocks from the
diagnostic builder: its remaining generic `g2w_miss` transform still consumes
`ss_fault_pc`.

## Exact source and ownership dependencies

| Files / entry points | Required review / ownership boundary |
| --- | --- |
| `src/05b-string-ops.wat`: `rep_movs_mem`, `rep_movs_do`, byte/dword wrappers | Primary narrow implementation grant. `rep_movs_do` currently publishes full progress after helper return. Preserve bulk overlap and invalidation behavior. |
| `src/05-alu.wat`: `th_rep_movsw` | Separate loop currently has no early fault exit. Narrow handler grant only; no NOP instrumentation change. |
| `src/07-decoder.wat`: REP emissions; `src/02-thread-table.wat` | Decoder operand change; table read-only, existing opcodes suffice. No table growth needed by this design. |
| `src/07c-block-exec.wat`: three byte/dword helper call paths | Audit/pass PC in every consumer; current register publish/reload needs redirection review. Claim only demonstrated necessary hunks. |
| `src/07d-uop-engine.wat`: `uop_bulk_slow`; `src/07e-uop-compiler.wat`: REP lowering/fallback | Whole-span checks currently deopt on failure before `rep_movs_mem`. Prove exact-PC fallback and restored registers for cold and already compiled code. Existing dirty EMMS opcode79/kind32 hunks are unrelated and must be preserved; no broad rewrite grant. |
| `src/03-registers.wat`: mapping/miss helpers; `src/04-cache.wat`: dispatch redirection | Read-only dependencies initially. If a shared helper is essential, request a narrow grant; do not alter global miss policy or layouts as a convenience. |
| `src/11-seh.wat`: `seh_frame_is_msvc`, `seh_walk_from`, `seh_call_raw_handler`; `src/09b-dispatch.wat`: raw continuation | Mixed dirty ownership. `11-seh` and `09b` contain paired nested-Delphi state restoration, and `09b` also has accepted timer leave. Freeze/preserve those hunks; coordinator must grant distinct fault/classification hunks. No continuation rewrite assumed. |
| New focused regression, proposed `test/test-rep-movs-fault-restart.js`, plus actual tier manifest | Requires explicit file/tier grant. Existing dirty `test/test-seh-continue-execution.js` remains untouched. Use established source-compile harness and generated region constants. |

The inspected primary REP/decoder/register/cache files had no tracked diff;
that is not an ownership release. `01-header.wat` also has mixed timer/APC
changes and is not needed by this proposal. NFS2/layout/generated region and
older retained-session ownership is unchanged. Recheck the board and snapshot
current hunks immediately before any later implementation grant.

## Required discriminating regressions

Use real decoded guest instructions and an actual raw guest SEH handler,
not a direct call of the new helper. Mapping exports may construct fixtures,
but the fault, record inspection and continue-execution retry must cross the
guest machinery. No performance measurements are needed.

* Matrix: width 1/2/4 × DF 0/1 × source/destination absent page × cold/cached
  block × failure at element 0 and after three completed elements. Create
  reserved sparse holes; for cached cases warm valid mappings first, then
  decommit the relevant page without changing instruction bytes. The handler
  commits the hole and returns ContinueExecution without replacing context
  EIP. Exercise both sides of page boundaries and unaligned straddles for
  widths 2/4, including noncontiguous backing.
* At the handler, assert AV code, NumberParameters=2, information[0]=0/1,
  information[1]=first absent byte, ExceptionAddress and context EIP equal
  the REP prefix start. After k completed elements, assert ECX=N-k,
  ESI=src0+k*step, EDI=dst0+k*step, DF unchanged, all completed destination
  elements correct, and every byte of the failed destination element still
  unchanged. For both operands missing, source preflight must win.
* On retry, earlier instruction markers must not rerun and the instruction
  after REP must run exactly once. Have the handler change an already-copied
  source element: the completed destination must retain its old value,
  proving retry did not restart the entire copy. Verify final pointers/count,
  guard bytes, flags and handler count, plus deliberate ContinueSearch and
  unrepaired-refault behavior.
* Negative/compatibility cases: count zero with unmapped pointers; ordinary
  forward/backward copies; direction-sensitive overlapping/LZ copies;
  straddling mapped pages with noncontiguous backing; successful writes to
  cached code invalidate it. Check overflow handling without an unbounded
  count experiment. Repeat the fault matrix through available optimized
  block and uop paths with evidence that those paths or their exact fallback
  were exercised, not just a configuration flag.
* Raw-SEH classifier fixtures: ordinary raw handler; raw handler beginning
  `MOV EAX,imm` (`0xB8`); raw registration whose adjacent words accidentally
  look like a valid scope table/trylevel. Pair these with real supported MSVC
  scope-table and C++ stub cases so a classifier fix cannot simply route all
  AVs raw. Include nested raw fault/continue and current Delphi continuation
  preservation. Current `0xB8`-only and frame-shape heuristics are insufficient;
  the narrow replacement policy requires separate evidence/review before
  production promotion.

Existing follow-up gates: `test/test-bw-rep-copy.js` (16 ordinary cold/cached
cases, no AV); `test/test-string-ops-sparse-boundary.js` (one mapped DF1 dword
boundary case, no AV); `test/test-fault-null-raise.js`;
`test/test-seh-continue-execution.js`; `test/test-seh-unhandled-terminates.js`;
`test/test-delphi-seh-mutated-chain.js`. Run the new fixture first, then these
serially under a granted CPU slot, followed by applicable structural/tier
gates. Compile into unique scratch only; a canonical build is not required
for this correctness stage.

## Ready and blocked sequence

1. **Ready for coordinator assignment:** narrow new regression fixture plus
   read-only optimized fallback/classifier audit. Obtain exact hunk ownership,
   freeze source/compiler identity, then one CPU slot to establish expected
   baseline failures. No slot is requested or consumed by this plan.
2. **Blocked pending audit/authorization:** implement the REP-specific path,
   exact PC plumbing and AV record kind. A classifier correction needs a
   separate reviewed rule that preserves supported CRT behavior; do not
   weaken the raw-handler regressions to avoid it.
3. **Blocked pending focused gates:** remove only proven-redundant REP
   transforms in a new diagnostic builder, retain generic fault/PC transforms,
   and compare a separately authorized bounded intro replay against the
   production-timer reference. Do not erase the original builder/artifact.
4. **Still deferred:** general sparse load/store fault semantics, protection
   enforcement, precise PC across all instructions, full removal of private
   transforms, canonical build and normal Serious Sam menu/input/gameplay.

No new PASS claims arise from this inspection.
