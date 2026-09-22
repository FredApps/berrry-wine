# Mapping dirty-page tracking: audit and first cost experiment

2026-09-21; production baseline `62f8332d`. Status: **not implemented**.

Native evidence in `test/fixtures/win98-file-mapping/native.serial.txt` shows
that separately created file sections retain independent bytes. An untouched
writable section must not overwrite another section's disk updates, but a dirty
page writes back its whole contents. The runtime's unconditional writeback
fails `node test/test-virtual-free-mapped-view.js --verify-writeback` at 4/4/0:
actual `[65,66]`, native `[27,66]`. Normal identity tests do not cover this gap.

## Write-path audit

These are inspected entry points, not a complete coverage census. A search for
every `store` also finds emulator-private registers/counters; those must not
mark guest pages dirty.

| Path | Evidence / integration requirement |
|---|---|
| Scalar CPU writes | `src/03-registers.wat` `$gs8/$gs16/$gs32` already carry guest address and width, including cross-page stores. A scalar hook alone is insufficient. |
| SIMD/MMX | `src/06c-mmx.wat` `$xmm_store128/$mmx_store64` lower to `$gs32`; ordinary stores there can inherit scalar tracking. |
| x87 | `src/06-fpu.wat` guest FST/FSTP use direct `f32.store/f64.store(g2w(addr))`; environment/extended-real helpers also write translated buffers. They bypass scalar helpers. |
| REP / folded bulk writes | `src/05b-string-ops.wat` range invalidation covers many fast copy/fill handlers, but generic span helpers and their callers need a separate coverage audit. Mark every destination page, not just endpoints. |
| Block executor | Inspected normal store cases call `$gs*`; generated/page-compiled paths and fused operations still require complete review. A raw store at the end of this file updates private profiling counters, not guest memory. |
| Native CRT handlers | `src/09a6-handlers-crt.wat` includes direct floating-point output and realloc `memory.copy` into guest buffers. API implementations cannot be assumed to inherit CPU-store hooks. |
| JS file I/O | `lib/filesystem.js` ReadFile fills translated guest chunks directly; its existing `invalidate_code_range` notification is an executable-cache operation, not a dirty-page contract. |
| Other host/API outputs | Need output-span review, including strings, structures, GDI and async completions. A read-only translation function cannot distinguish reads from writes. |
| Section initialization | Provider/eager initial fills must **not** count as guest dirties; a late fill must continue respecting initialized intervals and cancellation. |

Further required invariants: write-then-restore still dirties a page; writes
straddling pages mark both; release/reuse clears ownership and stale dirties;
COPY never writes the file; dirty reset/flush must not lose concurrent worker
writes. Atomic OR alone does not solve races between clearing the bit, copying
bytes, and a store performed after its dirty notification.

## Isolated experiment

`tools/bench-mapping-dirty.js` compiles two modules from the same source. The
candidate adds a scalar `$gs32` hook: fixture-specific direct-address rejection,
one byte per guest page, tracked-bit load, atomic dirty-bit OR. The control has
no hook. The 1 MiB table occupies unused PE staging memory in this no-PE fixture;
this is not a production allocation or proposed packed-PTE layout.

The benchmark asserts final stored values and actual tracking activation,
warms both arms, rotates execution order over nine paired samples, and supports
`--control-only` for A/A. It covers repeated aligned dword stores to one direct,
one sparse-untracked, and one sparse-tracked page. It excludes instruction
dispatch, games, cross-page writes, host writes, flush/clear races and complete
tracking coverage. Its address shortcut must not be copied into production.

Ran in `/private/tmp/wa-dirty-pages.Hu7Clr/tree`, a detached clean test worktree
at the baseline commit with ignored assets linked by `make-test-worktree.sh`.
Only the new benchmark script was transferred with `rsync`. Development stays
on main. Reproduce from that revision with:

```sh
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js --control-only
```

Node v24.21.0, arm64. The machine exceeded the project's load threshold of 4;
these measurements are exploratory, not release or game-performance evidence.
Raw paired samples and load readings accompany this report.

| Store target | Control median ms | Candidate median ms | A/B change | Separate A/A change |
|---|---:|---:|---:|---:|
| Direct window | 128.040 | 126.220 | -1.42% | -2.79% |
| Sparse, untracked | 204.796 | 213.586 | +4.29% | +0.96% |
| Sparse, tracked | 201.157 | 272.742 | +35.59% | -1.47% |

Twenty million identical stores/sample, nine paired repetitions after three
warmups/arm. A/B one-minute load was 7.50 → 8.45; A/A was 7.07 → 6.92.
The A/A columns are observed differences, not statistical confidence bounds.
Direct-window results do not establish a benefit. The tracked-store candidate
shows a large cost in this fixture, but this is not a predicted game slowdown.
Do not ship the naive atomic-OR-per-store prototype on these measurements.
Raw data: [mapping-dirty-tracking-samples.json](mapping-dirty-tracking-samples.json).

An initial two-million-store exploratory run was unstable: direct +25.23%,
untracked +2.06%, tracked +27.55%, load 5.56 → 6.35. Increasing sample work
changed the apparent direct-window result substantially. That discrepancy is
another reason not to treat this busy-machine measurement as a release verdict.

Next: complete output-span coverage and concurrent-flush design, then compare
candidate implementations on a quiet machine before integrating a hot-path
change. Game A/Bs remain required; this microbenchmark cannot select a default.

## Prerequisite fixed: scalar x87 store bypasses

The write audit reproduced an independent correctness defect: FST m32 at guest
page offset 0xffd wrote three bytes into the first backing extent but left the
last byte in the next guest page unchanged. The fixture deliberately places
unrelated backing between adjacent guest pages. Before the fix, storing 1.25
produced the wrong fourth byte (`0xcc` instead of `0x3f`).

FST/FSTP m32 now use `$gs32`; FST/FSTP m64 and both raw/converted FISTP m64
paths use a shared `$gs64`. MMX delegates its 64-bit store to the same helper.
The ordinary 64-bit same-page path translates once; boundary cases check
backing continuity and scatter through the existing dword helpers when needed.
These paths now also use the existing code-cache invalidation contract.

`test-sparse-width-boundary.js` exercises every crossing offset for the affected
widths, unchanged surrounding bytes, raw signed integers beyond f64's exact
range, and MMX stores. `test-sparse-generated-code-cache.js` checks that x87
32-bit, 64-bit and integer stores retire decoded destination code. The existing
FPU-instance isolation/raw-integer and SSE scalar regressions also pass.

This is a guest-store correctness/common-helper change, not dirty tracking.
Extended-real, environment/save-state, x87 loads, native CRT and other host
output paths still require review. The audit table above describes the original
benchmark baseline, which remains available at its recorded commit.

Logical-AND and region gates pass. The shared worktree's duplicate gate currently
reports two unrelated Direct3D SetTransform members from parallel edits. With
only these three changed WAT files copied into the temporary baseline tree,
the gate passes at 138/142 exact groups and 532/548 members. No ratchet baseline
was changed, and no full-build pass is claimed.

## Compound x87 output paths migrated

The extended-real boundary regression also failed before migration: FSTP m80
with one byte before the sparse boundary left all nine bytes of the next guest
page untouched. Extended-real output now encodes through one `$fpu_store_m80_bits`
helper using `$gs64/$gs16`; environment output uses `$gs32`; packed BCD output
uses `$gs8`. FNSAVE inherits the environment and extended-real helpers. Unused
WASM-base/slot calculations were removed from the register-save loop.

The boundary test compares all split positions for 10-, 28- and 108-byte outputs
against a deterministic aligned result, plus explicit extended-real encodings
for 1.25, negative zero, infinity and NaN and a signed packed-BCD vector. It
checks the untouched bytes on both sides. Code-cache tests now cover m80, BCD,
FNSTENV and FNSAVE alongside scalar x87 stores; FPU instance isolation still
passes. Logical-AND and region gates pass.

Inspection of remaining raw stores in `src/06-fpu.wat` finds only the private
FPU register bank and emulated status-register destinations. That statement
is limited to this fragment: fused/generated x87 paths elsewhere, native CRT
outputs, host writes, input-side cross-page accesses and architectural precision
limitations remain open. No dirty bit is yet recorded by these common helpers.

## Fused x87 output paths migrated

The pipeline and tree handlers in `07b-loop-match.wat` also bypassed guest
stores. A source-compiled differential regression reproduced the error: with
one destination byte before a noncontiguous sparse boundary, the fused 64-bit
store left the other seven destination bytes unchanged. Both handlers now use
`$gs32/$gs64`, removing their redundant local translation and inheriting code
invalidation. The affine arithmetic handlers do not store guest results; the
island handler delegates its memory operations to `$fpu_exec_mem`.

`test-x87-pipeline4-fusion.js` now compiles current source instead of reading a
potentially stale build artifact. Its 31 differential cases include all crossing
positions for both widths in both handlers, checking output bytes, full FNSAVE
state, registers, flags, actual fusion counts, destination canaries and the
unrelated backing page. These pass, as does the shared duplicate gate
(138/142 groups, 532/548 members). Input-side raw loads remain a separate gap;
this change neither implements dirty-page tracking nor establishes game
performance or architectural fault/precision equivalence.

## CRT floating-point scan outputs migrated

`sscanf_impl` used the common guest stores for integer/string outputs but raw
WASM stores for floating-point outputs. Both defects were reproduced before
the change: `%f` with one destination byte before a sparse boundary left the
next three bytes untouched, and an aligned `%f` output into decoded sparse
code left its cache entry live. The float/double branches now use `$gs32/$gs64`
with bit reinterpretation; parsing and assignment-count logic are unchanged.

Source-compiled sparse tests pass for `%f`, `%lf`, `%e`, and `%lg`, aligned and
at every crossing position, using positive, negative and negative-zero values
and destination canaries. Float and double outputs retire decoded destination
code. The existing `test-sscanf.js` passes all 24 cases; logical-AND and duplicate
gates pass. This is not full CRT write coverage: the adjacent `realloc` still
has a raw `memory.copy`, and its allocation-failure path needs investigation
before merely substituting a copy helper. Dirty tracking remains unimplemented.

## CRT realloc delegates to the failure-safe heap core

The follow-up confirmed a separate ownership defect: refusing an oversized
`realloc` request returned NULL but freed the original block, replacing its
first four payload bytes with free-list bookkeeping. The private copy also used
the block extent (including its header) instead of the payload extent.

The CRT handler now delegates allocation/growth/shrink to `$heap_realloc`,
which already preserves the old block when allocation fails and bounds copying
to its payload. The wrapper retains the CRT-specific non-null size-zero free
and reports ENOMEM on allocation failure. These follow the
[Microsoft CRT contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/realloc?view=msvc-170);
this is not a new native-Win98 oracle or a claim about optional new-handler mode.

`test-crt-realloc.js` fails before the change on original-payload preservation
and passes after it. It covers refused oversized allocation with and without
an original block, non-reuse of the retained block, preserved data on growth
and shrink, zero-size free, errno and cdecl stack cleanup. The existing
GlobalFlags and Diablo runtime suites pass; logical-AND, duplicate and test-tier
gates pass. Shared `$heap_realloc` remains unchanged: its raw bulk copy/zero
paths still need write-notification review. Removing the private copy does
not itself close that coverage gap or implement dirty tracking.

## Common bulk writes notify decoded-code invalidation

The public `memcpy`, `memmove` and `memset` handlers delegated to guest-aware
bulk helpers, but those helpers did not notify code invalidation. The new
regression failed before the change on public `memcpy`: its destination bytes
changed while the decoded entry remained cached. Both `$guest_memmove` and
`$guest_memset` now notify `$invalidate_code_write` once per non-empty operation,
before selecting linear or page-chunked copying/filling. Empty writes still
return before translating or invalidating anything. REP handlers retain their
separate existing notification paths; they do not call these helpers.

The source-compiled cache regression exercises all three CRT entry points,
checks their cdecl stack/result, and executes the changed instruction to verify
its new immediate. It covers linear buffers, noncontiguous split sources and
destinations, and zero-length preservation of an existing decoded entry.
Sparse-width tests retain overlap/canary coverage for copy and fill. This does
not establish process-wide publication for every write, page permissions,
dirty-file writeback or game performance. The heap core and other raw-memory
callers do not automatically inherit this hook and remain audit work.

## Heap reallocation copy and zero paths use the guest helpers

A real heap-reuse regression confirmed the remaining bypass: after executing
code in an allocation, freeing it, and growing a different allocation into
that exact reused block, `$heap_realloc` copied new bytes but retained the old
decoded entry. Its payload copy now calls `$guest_memmove`; its NULL-input
zero-initialization and expanded-tail zeroing call `$guest_memset`. The unused
translated destination local is removed. Allocation policy, payload bounds,
failure ownership and Global/Local flags are unchanged.

The source-compiled cache suite checks actual reuse, decoded-entry retirement,
execution of the new copied instructions, and zeroed bytes in both zero paths.
This closes the three identified `$heap_realloc` output bypasses, not every
allocator write: header/free-list bookkeeping, other raw API outputs, host
writes and dirty-page tracking still require separate review. No performance
claim is made for this correctness change.

Validation: the cache-reuse suite, CRT realloc failure/ownership, GlobalFlags
cross-worker validation, and sparse heap-arena release/growth/reclamation suites
pass. Logical-AND and duplicate gates also pass (138/142 groups, 532/548 members).

## File-read prefixes notify on early exits

`fs_read_file_result` already scatters reads across sparse mappings, but its
code invalidation ran only after the read loop completed. A later mapping
chunk could park or fault after earlier chunks had written guest bytes,
returning without retiring code in that changed prefix. The notification now
lives in `finally` around the loop: one notification for the actual written
prefix on success, park or failure, none for an empty read. Existing cursor
rewind, byte-count and thread-owned pending/error behavior remain unchanged.

`test-file-read-invalidation.js` reproduces the missing parked-prefix notice
before the fix. It uses real VFS reads and noncontiguous packed-PTE backing,
with a controlled second-chunk outcome to exercise each exit. Assertions cover
actual guest bytes, exact notification span/count, error/pending status,
cursor and zero-length behavior. This is host-import notification coverage,
not a new native read-failure oracle, worker publication proof or dirty-page
implementation. The broader lazy-provider suite passes 51/51 cases.

## Filesystem scalar outputs use the canonical guest writer

The filesystem-local `gs32` still used one raw `DataView.setUint32` after
translating only the first byte. A byte-count output with one byte before a
noncontiguous boundary reproduced three missing output bytes. The production
path now delegates to the exported `guest_write32`, inheriting the CPU writer's
sparse handling and notification. Lightweight hosts without that export use
page-bounded chunks and one explicit invalidation. This covers callers of this
local helper, including read/write byte counts and file-part pointers; it does
not migrate the separately encoded find-data structures or strings.

The focused test covers all three DWORD crossing positions, neighboring
canaries, zero-byte read counts and fallback notices. A separate wiring check
requires exactly one exported-writer call per scalar assignment and no duplicate
host notification. The real-WASM ReadFileEx callback/ABI test and all 51 lazy
provider tests pass. Dirty bits are still not recorded by the canonical writer.

## Find-data and string output paths

`fillFindData` still assumed its complete A/W structure occupied contiguous
WASM bytes. The regression failed with one ANSI output byte before a sparse
boundary: only that byte reached the intended structure. It now encodes into
a zero-initialized local byte buffer and scatters it through `guestChunk`,
then notifies the complete output span once. Layout, timestamps and file-name
encoding are unchanged. The ANSI and wide string writers already scattered
correctly but lacked notifications; both now notify their bytes including the
terminator. These paths, scalar fallback and file-read prefixes share one
filesystem-local notification helper rather than repeated export checks.

`test-filesystem-output-boundaries.js` exercises all 319 ANSI and 591 wide
structure crossing positions against an aligned result, explicit attributes,
file size/name bytes, and destination canaries. Current-directory strings cover
every crossing position, including odd-byte UTF-16 splits, with exact notices.
The notification helper still represents decoded-code invalidation, not a
complete dirty-page protocol; no native layout/encoding expansion or performance
claim is made by this patch.

Validation also passes the existing file-API ANSI/OEM codepage, exact timestamp,
FindFirst/FindNext error, read data/count notification and test-tier checks.

## Remaining filesystem raw-write classification (after e8de2997)

An end-to-end inspection of direct writes in `createFilesystemImports`, paired
with their WAT callers, narrows the next work to five translated-pointer
interfaces. These are not safely fixed by treating every WASM address as a
guest address, or by applying dirty marking to every `.set` found in JavaScript.

| Interface | Actual destination / outstanding work |
| --- | --- |
| `fs_file_information` | `GetFileInformationByHandle` passes `g2w(arg1)`; the host writes 13 DWORDs linearly. Migrate the guest output pointer and test all 51 crossing positions, errors and identity fields. |
| `fs_file_time` | Get/SetFileTime pass translated optional guest pointers. Each FILETIME has two DWORDs; reads and writes both assume contiguous backing. Preserve null/sentinel and error semantics while migrating both directions. |
| `fs_file_size_result` | Low result is private `reg_base`; optional high result is translated guest memory. GetFileSize and GetCompressedFileSize share this mixed contract. Keep the private low result raw; fix the high output. Compressed-size validation currently requires an affine four-byte span, so migration must address that guard too. |
| `fs_seek_result` | Result is private `reg_base`; optional high word is guest in/out memory translated once in SetFilePointer. Preserve signed input and success-only high-word output, while making the guest access page-aware. |
| `fs_filetime_to_systemtime` | Host reads eight bytes and writes sixteen through translated pointers. Inspect both FileTimeToSystemTime and FileTimeToDosDateTime callers before changing the interface; the latter uses scratch output. |

Other raw-write categories deliberately excluded from a guest-write sweep:

- CreateFile, mapping create/open/map and mapping-duplicate result cells are
  passed `reg_base` by their WAT wrappers. These are emulator-private outputs,
  not guest buffers; dirty-page or guest-address conversion would be wrong.
- `copyFresh` and legacy eager/async mapping fills initialize newly committed
  backing. They must remain distinct from subsequent guest modifications.
  Existing initialized-interval and pending-lifetime guards prevent late fills
  from replacing guest data. Initialization may need code-cache retirement on
  reused storage, but must not make a file page dirty merely by loading it.
- `syncMappedView`'s `dest.set` copies **from** guest backing **to** file data;
  it is writeback, not a guest-memory output. Its unconditional writable-view
  copy is the still-open clean-page overwrite defect established by the native
  distinct-section oracle.
- Remaining RTF byte-array assembly and VFS file-data copies are host-owned
  buffers. The migrated find-data `DataView` is now local staging, not guest
  memory; its later scatter is the guest write.

This is a bounded filesystem audit, not proof of coverage for other host
modules, generated code, allocator metadata or graphics. Next implementation
target is the 52-byte file-information output: one guest-only pointer avoids
the mixed private/guest semantics of the other four interfaces. Keep import
argument counts and worker transport synchronized while changing pointer
meaning, and verify real WAT callers as well as isolated JavaScript tests.

## File-information guest output migrated

The first metadata interface above now keeps the output as a guest address
across the WAT/host boundary. A real compiled GetFileInformationByHandle call
failed before the change at split one, leaving 51 bytes untouched. The host
encodes the 13 metadata DWORDs locally and scatters them through a common
`writeGuestBytes` helper, also used by find-data. WAT no longer prematurely
translates this buffer. Import arity remains two; its header contract comment
now names a guest address. Private result-cell interfaces remain unchanged.

`test-file-information-boundaries.js` runs the actual handler for all 51 split
positions, comparing the complete result and neighbor canaries, checking
attributes/size/link count, one exact output notification and stdcall cleanup.
Invalid handles preserve all output bytes and notify nothing; null output
retains the existing invalid-parameter result. Host-import signatures (257),
test-tier, logical-AND and duplicate gates pass. The other four metadata
interfaces in the audit are still open, as is actual dirty-page tracking.

The existing DuplicateHandle/file-metadata public-API suite, filesystem A/W
output-boundary suite and read-output notification suite also pass after this
pointer-contract change.

## File timestamp input/output interface migrated

GetFileTime and SetFileTime now pass nullable guest addresses to `fs_file_time`
instead of translating each pointer prematurely. Input DWORDs use a shared
filesystem `gl32` that delegates to the exported guest reader when available,
with a page-chunked fallback for lightweight hosts. Output FILETIMEs encode
locally and use `writeGuestBytes` once per supplied timestamp. The import's
five-argument shape and status semantics are unchanged.

The metadata boundary suite reproduced the old GetFileTime split-one failure
and now checks all seven crossings for creation, access and write timestamps
in both directions. SetFileTime's stored VFS values are checked independently
before reading them back. GetFileTime checks complete bytes, neighbor canaries,
exact eight-byte notifications, failure preservation and stdcall cleanup.
Existing timestamp tests retain null, all-ones sentinel, rights, exact stored
values and calendar tests; their pointer-forwarding expectation now correctly
requires guest addresses. Host-import signatures, logical-AND and duplicate
gates pass. Remaining metadata interfaces are size-high, seek-high and calendar
conversion; dirty-page tracking is still not implemented.

## Size and seek high words keep guest addresses

`fs_file_size_result` and `fs_seek_result` now distinguish their two pointer
roles explicitly: the low result still targets private `reg_base` through a
WASM address, while the optional high word retains its guest address and uses
`gl32/gs32`. SetFilePointer still interprets that input as signed and writes
the high output only on success. Import arities are unchanged.

GetCompressedFileSize shares the high-output contract. Its guard now validates
the DWORD as one or two page fragments instead of requiring contiguous backing
for all four bytes. Each fragment is translated once during validation; wrap
is rejected first. Unmapped output remains an error before opening a file.

The real-handler regression failed before migration with three untouched
GetFileSize high-word bytes. It now covers every DWORD split for ordinary and
compressed size using a >8 GiB lazy provider whose reader throws if called;
metadata never materializes bytes. Seek tests cover a 64-bit absolute input,
relative carry into the next high word, canaries, stdcall cleanup and invalid
handle preservation. Additional checks reject a missing second output page
and address wrap without creating a handle. Host signature, logical-AND and
duplicate gates pass. Calendar conversion is the remaining translated-pointer
metadata interface in this bounded audit; dirty tracking remains open.

## Calendar conversion retains guest addresses

The last of the five translated-pointer metadata interfaces identified above,
`fs_filetime_to_systemtime`, now reads its FILETIME through `gl32` and scatters
its locally encoded 16-byte SYSTEMTIME through `writeGuestBytes`. Both real
WAT callers pass guest addresses. The DOS conversion keeps its existing owned
scratch allocation and private translated reads, but its two caller-owned FAT
WORD outputs now use `gs16` rather than raw stores. Import arity, calendar
arithmetic and scratch lifetime are unchanged.

Before the fix, the real-handler regression failed at SYSTEMTIME split 1:
only its first byte reached the intended guest buffer. It now passes all 15
SYSTEMTIME output crossings with canaries and one 16-byte notification, all
seven FILETIME input crossings through both calendar and DOS conversion, and
both FAT WORD output crossings. Expectations use an independently specified
leap-day calendar, not an aligned invocation of the same conversion. Stdcall
cleanup is checked. Existing file timestamp and CoFileTimeToDosDateTime tests
also pass, including FAT year limits, leap day and invalid-pointer rejection.

This closes the bounded five-interface migration, not the global write audit
or native calendar conformance. Guest writes elsewhere, true dirty-page
tracking, flush concurrency and quiet game performance measurements remain
open; no production dirty tracking or performance result is introduced here.
