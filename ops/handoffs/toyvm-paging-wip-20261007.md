# TOYVM-386-PAGING-20261007: incomplete foundation

Worker `codex:toyvm-paging-worker` started from origin/main
`3007158e9462d851263f29259f3c70c38dd3237d` in
`/home/user/wt-toyvm-paging-20261007`. This is **WIP, not the paging repair**.
Do not mark the task complete or cherry-pick the walker as game qualification.
The original acceptance in `toyvm-paging-implementation-20261007.md` still applies.

## Implemented and tested

Actual MOV instructions retain/read CR2 and CR3, including full upper words.
Both registers join MACHINE_STATE and have accessors shared by trace/LIVE
modules. Real DOS execution tests cover tailcall, switch and calls; state
transfer and rebind are tested against the full machine-state list.

`tools/toyvm/paging.js` emits an isolated 386 two-level translation primitive.
It is compiled into helpers, but **no guest access calls it**. Its i64 result
separates physical addresses, page-fault information and unsupported physical
backing. Zero is a valid physical address. Translation tests cover all table
permission combinations, A/D updates on success, software-bit preservation,
missing entries, directory switches, uncached remaps, noncontiguous boundary
addresses, recursive tables, physical backing bounds and A20 at all walk levels.
These are primitive tests, not guest paging acceptance tests.

Primary architecture references:

- [Intel 80386 PRM 5.2](https://pdos.csail.mit.edu/6.828/2018/readings/i386/s05_02.htm):
  CR3 holds the physical directory base; PDE/PTE entries select 4 KiB pages.
  Successful reads/writes set A at both levels; writes set leaf D. Reloading
  CR3 flushes translation caching, including a reload of the same value.
- [Intel 80386 PRM 6.4](https://pdos.csail.mit.edu/6.828/2018/readings/i386/s06_04.htm):
  CPL 0–2 accesses are supervisor; CPL 3 accesses are user. System-table and
  inner-stack accesses use supervisor checks. Supervisor writes ignore R/W.
- [Intel's complete 1986 manual, table 6-5, p.129](https://read.seas.harvard.edu/~kohler/class/aosref/i386.pdf):
  User access requires both U/S bits; user writes require both R/W bits.
  The 386 has no 486 WP or later large-page/NX contract.
- [Intel 80386 PRM 9.8.14](https://pdos.csail.mit.edu/6.828/2018/readings/i386/s09_08.htm):
  #PF saves the faulting instruction address, CR2 linear address and P/W/U
  error bits. Faults during delivery require double-fault/shutdown handling.

The primitive does not define A/D values on failed translations or implement a
TLB. Missing physical RAM is an unsupported bus condition, not a fabricated
architectural not-present fault. Paging structures in the VGA aperture are
explicitly unsupported by this RAM-only primitive. It takes A20 explicitly;
the current linmask conflates bus behavior and capacity and cannot be reused
as a paged address mask.

## Exact architecture work remaining

1. Wire checked translation into BOTH memAccessors families in emit.js, all
   wideAccessors fast paths, scalar/FPU/stack access and REP including widened
   copy/fill paths. Split noncontiguous page spans, preflight every scalar
   store before any bytes or CPU state commit, and retain completed REP
   iterations on faults. Never continue after a tagged failure.
2. Make fetch in decode.js, emit-decoder.js, compile.js, vm.stepOne and
   dos-loop.js read translated bytes across pages. Speculative block decoding
   must not deliver a fault for an instruction execution never reaches. Track
   physical decoded-byte coverage across aliases rather than masking linear
   code addresses into CODE_BITMAP.
3. End cached execution on CR0 paging transitions and ALL CR3 writes.
   Invalidate indirect/shadow-return caches, block/region/tree identities,
   operand-repair observations, volatile-code records and uop held/resume
   entries. Carry any added machine globals through MACHINE_STATE/rebind.
4. Translate GDT/LDT/IDT/TSS and descriptor accessed-bit updates consistently.
   pm-transfer.js currently returns raw contiguous pointers and reads gate,
   TSS and stack fields directly. Replace those assumptions while preserving
   reviewed CALL/RETF transaction ordering and hidden-cache authority.
   Hardware A/D writes also need physical code-alias invalidation when paging
   structures overlap executable memory.
5. Implement restartable #PF delivery, correct same/inner-privilege frames,
   CR2/error publication, stack preflight and delivery escalation. The current
   ordinary PM `$fault` path lacks error-code/privilege-changing frames;
   the V86 helper alone is insufficient. Do not merely call `$fault(14)`.
6. Audit DOS host memory entry points and A20 state. uop-wasm.js/uop-ref.js
   directly mask/load/store memory; uop-live.at/resume, uop-only, region-live
   and tree-fold must either gain equivalent semantics or hand back BEFORE
   unsupported paged execution. Guard both fresh entry and installed/resumed
   execution, including paging enabled inside an already-running block.
7. Add actual guest acceptance programs: high mapped copy preserving IVT,
   cross-page fetch/read/write, missing/protected-page restart/error/frame,
   CR3 reload/remap, self-modifying physical aliases, REP partial progress and
   nonpaged/A20 preservation. Current primitive boundary tests are not these.
8. Repeat full ToyVM correctness and both complete browser bundles after the
   integration, then bounded unchanged original Comanche installation and UI
   inspection. No original run was repeated for this incomplete foundation.

## Evidence and original result

Durable evidence: `scratch/runs/20261007T215000Z-toyvm-paging-foundation/` in the
coordinator checkout. It includes the named baseline, exact validation driver,
logs/terminal receipts, source pins/snapshots, generated bundles and authored
COM fixtures. The first test-harness exportAll/table failure is retained;
the corrected harness exports only the primitive for switch/calls.

Original Comanche remains unqualified and blocked on paging. The latest
authenticated unchanged-original result is the earlier root-reviewed copy
of 16 KiB into physical IVT `[0,4000)` from original INSTALL.BIN
`[c97d,1097d)`, hash
`a1014f71d8f0305296e65efa9c1062ce6df6868cce4c7623491846c7367770c8`.
Timer 08 then enters corrupted code at `4b4b:4b4b`. This worker claims no
installer UI, payload or gameplay. Media was never opened for execution or
modified. The allocator/Win32 sources, shared HEAD/index and remote browser
were untouched.

There is no new native-original result for the WIP source; retained CR3 can
affect guest decisions even though translation is still missing. The earlier
diagnostic is evidence for the original blocker, not a run of this candidate.
