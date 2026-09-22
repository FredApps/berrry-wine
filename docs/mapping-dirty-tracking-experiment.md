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

## Bulk spans must validate their middle pages

The shared string/CRT contiguity predicate compared only endpoint translations.
A real allocation sequence (first page, unrelated page, third page, second
page) produces matching endpoints while the middle guest page has different
backing. The old predicate incorrectly returned true for the complete 12 KiB
range, permitting `memory.copy/fill` to access the unrelated physical page.

It now delegates to the existing `g2w_affine_span` validator rather than owning
a weaker second definition of contiguity. Direct-window and DIB spans retain
that validator's constant-time range checks; sparse spans check every page.
Zero-length operations remain accepted without translation. This changes the
shared predicate used by CRT bulk operations and REP paths, not their overlap
or register-update rules.

The regression first failed with the old predicate accepting the three-page
fixture. With the fix, copy in both directions, forward/backward overlapping
memmove and fill all match expected guest bytes, and the entire unrelated
page stays untouched. The existing REP MOVSD sparse-boundary test and generated
code-cache invalidation suite also pass, as does the logical-AND gate. No game
performance estimate follows from these correctness tests; quiet A/B work
remains required for performance decisions.

## Reverse calendar conversion also uses guest accessors

The earlier five-interface audit covered filesystem host imports, not all WAT
handlers. Continuing into `09a7d` found `SystemTimeToFileTime` reading seven
SYSTEMTIME fields from one translated pointer and writing FILETIME with a raw
`i64.store`. It now uses `gl16` for each consumed field and `gs64` for the
result, preserving the existing null checks, date validation, civil-days
arithmetic and stdcall result handling. The unused day-of-week field remains
ignored.

The source-compiled real-handler test failed before migration at output split
1. It now verifies all seven FILETIME output crossings with canaries and all
15 SYSTEMTIME input crossings against independently computed leap-day ticks.
Invalid month 13 must return failure without changing the eight output bytes
at every input split. Metadata-boundary and existing timestamp suites, the
logical-AND gate and diff whitespace check pass.

This is not a calendar-conformance verdict: month-specific day validation and
native range limits were not changed here. The scan also identified the three
raw 64-bit `GetDiskFreeSpaceExA` output stores in `09a0b` as a next migration
candidate; the rest of the WAT guest-write inventory remains open.

## Extended disk-space outputs use the shared 64-bit writer

`GetDiskFreeSpaceExA` now routes each of its three optional ULARGE_INTEGER
outputs through `gs64`. Geometry calculation, allocation-failure handling,
null-output behavior and returned values are unchanged. The new real-handler
regression failed before migration at the first output's one-byte split.
It now passes all seven crossings for each of the three outputs, checking
all eight result bytes and surrounding canaries. It also checks simultaneous
aligned outputs, all-null outputs and 20-byte stdcall cleanup. The full
metadata boundary suite and logical-AND gate pass; diff whitespace is clean.

No raw `i64.store` remains in `09a0b`. This is a syntactic milestone, not proof
that every guest output there is covered: raw narrower stores and translated
bulk buffers remain. The neighboring `LocalFileTimeToFileTime` handler in
`09a7d` still copies through raw translated `i64.load/store` and is another
confirmed guest-buffer candidate. Its existing no-timezone policy is a
separate behavior question, not justification for a sparse-address shortcut.

## Local/UTC FILETIME copies share a guest-aware snapshot

Both `LocalFileTimeToFileTime` and `FileTimeToLocalFileTime` now use one
`filetime_copy_bits` core: gather both DWORDs through `gl32`, assemble their
unchanged bits and pass the complete value to `gs64`. This removes raw
translated copies and ensures the entire input is read before any output,
including an in-place buffer or overlap in either direction. The APIs still
use the existing identity conversion policy; timezone/DST modeling is not
implemented by this pointer migration.

The local-to-UTC output failed red at split 1 before the fix. The metadata
regression now runs seven boundary positions through five source/destination
arrangements for each frontend (70 cases), checking full bytes, surrounding
canaries and stdcall cleanup. It also checks LocalFileTimeToFileTime's existing
null failures and output preservation. The metadata suite and logical-AND
gate pass; the timestamp suite also passed the initial local-to-UTC change.
The reverse frontend's existing lack of null validation is intentionally not
presented as native-correct behavior. Null/error policy, timezone behavior,
and the adjacent CompareFileTime's translated input reads remain follow-up
work. No complete guest-write coverage or dirty-tracking claim follows.

## CompareFileTime sparse inputs and review checkpoint

`CompareFileTime` now reads its four input DWORDs through `gl32` instead of
assuming both translated eight-byte structures are contiguous. Its unsigned
high-word/low-word ordering is unchanged. The old implementation compared
equal `0x7fffffff` values as unequal when the first input crossed a page after
one byte. The expanded existing test passes nine representative unsigned
64-bit values against one another, with either input at each of seven splits
(1,134 comparisons), plus same-pointer equality and stdcall cleanup.

At this checkpoint the actual review gates report:

- A/W census: STUB 0, DIVERGENT 3, BOTH_STUB 0; ratchet passes.
- Exact duplicates: 138 groups / 532 members, within 142 / 548 ceilings.
- Silent-handler inventory: 250 manual + 22 metadata; inventory and D3D9
  output-stub checks pass.
- Logical-AND and diff whitespace checks pass.

These counts supersede older census numbers for this working-tree snapshot,
not the review's requirements. `fable-review.md` still marks common-core work
(#5), metadata/test-call migration and handler review (#7), and carried
cleanup (#8) partial. A passing inventory gate pins existing behavior; it does
not prove all 250 manual quiet handlers are correct. The current memory work
removes demonstrated unsafe address assumptions but does not close those
broader items. Before implementing dirty-page writeback, remaining guest-write
coverage and flush concurrency still need a complete design; timing decisions
still require quiet game A/B evidence. No full-build/browser pass is claimed
by this checkpoint.

## Timezone structure uses the shared guest fill

`GetTimeZoneInformation` was still clearing a translated raw 172-byte span.
It now calls `guest_memset` with the original guest pointer, so page splitting
and write notification follow the same core as CRT fills and startup-info
initialization. The existing zero-bias/no-transition structure and
TIME_ZONE_ID_UNKNOWN return are unchanged; this is not timezone/DST modeling.

`test/test-timezone-info-boundaries.js` failed before the change at split 1.
Afterward all 171 sparse crossings and a page-local control pass, checking
every result byte, surrounding canaries, unrelated backing preservation,
return value and stdcall cleanup. The new test is automatically tiered;
test-tier, logical-AND and whitespace gates pass. Broader API semantics,
remaining raw guest writes and dirty-page writeback remain open.

## Quiet-host scalar remeasurement (2026-09-22)

Revalidated the native writeback diagnostic on the current worktree: 4/4/0
still returns `[65,66]` rather than `[27,66]`. The 14 protection observations
and sparse lifetime checks preceding it pass; they do not close writeback.

Local load was 12.10, so no local timing was used. A clean tracked-source
worktree at `679d3e99f6f466b3444642003dab48259b098c9d` was created under
`/private/tmp/wa-dirty-quiet.UTx4J2/tree`; its asset-link helper adds an
untracked node_modules symlink, not source modifications. `src`, `lib`,
`tools` and `test/compile-src.js` were transferred with rsync to
`fast-near-9tb-1:/home/vg/tmp/wa-dirty-quiet.sPIiKa/`. The first transfer to
`/tmp/wa-dirty-quiet.UMRAA9` failed because the root volume was full; no old
data was deleted. The separate home volume had 836 GiB available.

Used the unchanged benchmark script, Node v20.11.1 x64, 20 million stores per
sample, three warmups per arm and nine alternating pairs. A/B and A/A ran
sequentially, with one-minute loads 0.00 -> 0.45 and 0.35 -> 0.57 respectively.
Run from the remote scratch directory:

```sh
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js --control-only
```

| Store target | Control ms | Hook ms | A/B change | A/A change |
|---|---:|---:|---:|---:|
| Direct window | 215.931 | 236.447 | +9.50% | +2.01% |
| Sparse, untracked | 267.467 | 300.371 | +12.30% | +0.17% |
| Sparse, tracked | 268.004 | 328.876 | +22.71% | +0.21% |

Raw samples, loads and benchmark-script hash are retained in
[mapping-dirty-tracking-quiet-samples.json](mapping-dirty-tracking-quiet-samples.json).
These A/B effects exceed the observed A/A differences for all three shapes.
That is evidence against calling this naive hook free or neutral, including
its direct-window rejection path. A/A differences are not confidence bounds.
Do not compare the absolute times or deltas to the earlier arm64/Node24 run as
though only load changed: source revision, architecture and engine differ.

Verdict remains **do not integrate the naive hook**. This is a single-page
scalar-store loop, not a guest game or browser workload. Full write coverage,
flush/store concurrency and a better candidate design remain prerequisites;
quiet repeated game A/Bs are still required before selecting a production
implementation. No runtime default or production memory path changed here.

## Flush race model and next candidate (2026-09-22)

`node test/test-mapping-dirty-interleavings.js` is an executable, bounded
interleaving model, not a runtime memory implementation. Its negative control
finds the premark-only loss directly:

```text
writer: read -> mark DIRTY --------------------------> store
flusher:                 claim/clear -> copy old bytes
result: new bytes in memory, stale file, no pending dirty bit
```

The candidate packs a generation and DIRTY bit into one atomic state word:

1. Writer reads the state; if clean, atomically ORs DIRTY. An already-dirty
   state can skip the redundant RMW.
2. Writer performs its data store, then rereads the generation. If it changed
   since step 1, atomically OR DIRTY again so a racing flush cannot lose it.
3. A flusher atomically advances the generation and clears DIRTY in one CAS
   operation (retry on interference), then copies the page. Flushers for one
   page must be serialized through copy/publication; copying before clear or
   clearing the bit independently of generation advancement is not this model.

The model passed **1,075,830 schedules** across one/two writers, one/two
serialized flushes, initially clean/dirty pages, distinct writes and
write-then-restore. It tracks write identity separately from byte value:
equal bytes cannot disguise an unflushed write. Each terminal schedule must
either have flushed the latest store or retain DIRTY; a quiescent final flush
must catch up. The premark-only negative control must actually fail the same
invariant for the test to pass. Test-tier and whitespace checks pass.

Limits matter: this assumes sequentially consistent indivisible model steps
and an abstract page snapshot. It does not validate actual WASM non-atomic data
access ordering, torn multi-byte copies, failed backing writes, page lifetime/
reuse, generation wrap, missing host/API notifications or cross-page stores.
Generation wrap requires an explicit quiescence/lifetime rule, not an assumption
that 31 bits never wrap. A production flusher must preserve/re-mark failed
writeback and must not race section retirement. The candidate still adds
state reads to stores and is **not benchmarked**. Next is an isolated real-WASM
candidate with forced interleavings and cost measurements; production remains
unchanged and the native writeback regression remains open.

## Real-WASM forced-interleaving fixture (2026-09-22)

`test/test-mapping-dirty-wasm-races.js` compiles a standalone one-page shared
memory module with the vendored WATX compiler. A Node worker executes one
uninterrupted WASM writer call, pausing through a host rendezvous after its
state read, conditional atomic OR, ordinary DWORD store and generation reread.
The main instance can claim/clear using real WASM compare-exchange and copy the
fixture DWORD while the writer is paused. This isolates the protocol without
adding hooks, globals or test controls to the production module.

The test passes 16 candidate cases: initially clean/dirty, four flush pause
points, and a single write or write-then-restore. It also requires the disabled
repair negative control to produce memory=9, disk=0 and DIRTY=false. Candidate
cases verify a quiescent drain catches the final value and that flushing before
the store leaves DIRTY pending even when the writer restores the original byte
value. Every expected pause must occur; waits are bounded and workers are
terminated in cleanup. Test-tier and whitespace checks pass.

These tests validate emitted atomic instructions and the chosen operation
ordering across real shared-memory WASM instances. The rendezvous deliberately
adds synchronization: this is not proof of unrestricted non-atomic WASM data
ordering, a contention stress test, or a test of full-page torn copies. It has
one writer, serialized flushes, no reuse/wrap/failure handling and no emulator
store-path coverage. No performance or production-writeback result follows.
Next: benchmark the candidate only in isolated scratch, then address those
remaining correctness obligations before integrating a runtime hook.

## Generation-wrapper cost experiment (2026-09-22)

`tools/bench-mapping-dirty.js --generation` adds an isolated source-transform
candidate: rename the original gs32 body, wrap it with tracked-page state
checks, conditionally mark a clean page and recheck the generation after the
store. It uses a DWORD per page (TRACKED=1, DIRTY=2, 30 generation bits) in
unused PE staging. This is not a proposed production allocation. The wrapper
retains the fixture-only direct-address shortcut; it handles only the aligned
single-page stores measured here, not cross-page writes, flush or retirement.
The naive default and `--control-only` remain available.

A short local scratch run checked compilation, final values and actual dirty
activation; its busy-machine timings were not used. Only the changed benchmark
script was rsynced onto the previous clean `679d3e99` remote source snapshot.
On Node20.11.1 x64, nine alternating pairs of 20 million stores and three
warmups per arm ran sequentially as A/B then A/A:

```sh
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js --generation
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js --generation --control-only
```

| Store target | Control ms | Wrapper ms | A/B change | A/A change |
|---|---:|---:|---:|---:|
| Direct window | 212.343 | 247.942 | +16.77% | -0.09% |
| Sparse, untracked | 265.659 | 309.233 | +16.40% | +0.07% |
| Sparse, tracked | 265.431 | 326.598 | +23.04% | -0.06% |

One-minute loads stayed low: 0.01 -> 0.35 and 0.29 -> 0.60. Raw samples and
the script hash are in [mapping-dirty-generation-samples.json](mapping-dirty-generation-samples.json).
The overhead greatly exceeds the observed A/A differences. **Do not integrate
this wrapper shape.** Avoiding repeated atomic OR did not establish a win:
this candidate also pays for wrapper calls and generation loads, so this is
not an isolated comparison of OR versus generation checking or a lower bound
on an inlined implementation. Nor is it a game slowdown estimate.

Next candidate work should remove wrapper overhead and preserve the direct
fast path before any repeated game A/B. The generation protocol still requires
the correctness work listed above; no runtime default or production handler
was changed. JavaScript syntax and whitespace checks pass.

## Inline generation cost experiment (2026-09-22)

`--generation-inline` removes the extra wrapper call. The source transform
keeps gs32's original translation/invalidation and changes only its same-page
store branch. The fixture's direct-address branch stores and returns without
looking up dirty state. Sparse stores read the packed state, conditionally OR
DIRTY, store, then recheck the generation when tracked. This still uses the
fixture-only address shortcut and does **not** track cross-page stores.

The unchanged clean-source baseline `679d3e99` was used in the same local and
remote scratch directories, with only the benchmark script rsynced again.
A local 1,000-store smoke checked values/dirty activation, not performance.
Quiet remote Node20.11.1 x64 A/B and A/A ran sequentially with the same nine
pairs, 20 million stores and three warmups per arm:

```sh
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js --generation-inline
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js --generation-inline --control-only
```

| Store target | Control ms | Inline ms | A/B change | A/A change |
|---|---:|---:|---:|---:|
| Direct window | 212.399 | 217.212 | +2.27% | +0.01% |
| Sparse, untracked | 265.152 | 285.271 | +7.59% | -0.08% |
| Sparse, tracked | 265.452 | 290.712 | +9.52% | -0.08% |

One-minute loads: 0.06 -> 0.38 and 0.23 -> 0.49. Raw samples and script hash:
[mapping-dirty-inline-samples.json](mapping-dirty-inline-samples.json).
This shape substantially reduces the measured overhead relative to the earlier
wrapper experiment, but each A/B effect still exceeds this run's observed A/A
difference. Avoiding a lookup on the direct path does not make that path free:
the accessor's branch/code shape changed. The experiments do not isolate a
specific machine-code cause or establish a universal overhead percentage.

**Keep experimental.** This is promising relative to the rejected wrapper,
not performance neutrality or production readiness. Repeated game A/Bs need
a width-complete candidate first; cross-page marking, real concurrent flush,
write coverage, mapping lifetime and generation wrap remain correctness work.
No production source changed. JavaScript syntax and whitespace checks pass.

## Full-source scalar width/crossing candidate (2026-09-22)

`test/test-mapping-dirty-widths.js` compiles the actual source tree with
test-only wrappers around gs8/gs16/gs32/gs64. Each wrapper snapshots/marks both
touched pages before calling the original accessor and rechecks each generation
afterward. Existing scalar stores, translation, code invalidation and nested
64-bit-to-32-bit fallback remain the real implementation. The test uses a
DWORD/page table in unused PE staging; no executable is loaded and no production
region or handler changes are made.

All **152 cases** pass: four scalar widths, interior and page-end controls,
every crossing position, neither/first/second/both pages tracked, and either
no flush or a forced generation advance/clear before the actual store. Adjacent
guest pages have noncontiguous backing, and expected output bytes, guards,
unrelated backing and exact dirty/generation words are checked. A byte-store
negative control disables repair and must leave DIRTY clear after the forced
flush while the new byte is present. The initial fixture accidentally placed
an interior case at a mapping start, leaving its preceding guard unmapped;
moving that case inside the page corrected the fixture, not production code.
Test-tier and whitespace checks pass.

This is a correctness wrapper, **not** the inline timed candidate and not a
game-ready tracker. Its forced flush is synchronous test injection, not a new
uncontrolled-concurrency result. Bulk/REP stores, host/API direct writes,
permission faults, address-space wrap, mapping retirement/reuse, generation
wrap and failed writeback are not certified. The existing native mapping
writeback failure is still open. Width coverage permits further experimental
work; it does not justify shipping the scalar wrappers or extrapolating the
earlier DWORD timings to them.

## Bulk range candidate coverage (2026-09-22)

The same source-harness fixture now wraps guest_memmove and guest_memset.
Unlike scalar stores, an arbitrary bulk range cannot retain its generation
snapshots in two locals. This experiment marks every tracked destination page
before the original operation and again afterward, avoiding an unbounded
per-call snapshot array. The postmark may conservatively leave a page dirty
after a concurrent flush already captured it; it must not omit a later write.
The original full-span contiguity checks and chunked overlap-safe copies still
perform all data movement. No production bulk helper is edited.

All **48 bulk cases** pass, alongside the existing 152 scalar cases: a fill
crossing four noncontiguous pages, forward/backward overlapping memmove,
nonoverlapping source/destination, four tracked-page masks, forced generation
clear and no-clear cases, and zero-length calls (including an invalid pointer
that must not be touched). Entire destination/source spans and unrelated
backing are compared, including untouched bytes. Exact state words ensure
middle pages are marked and source-only pages remain clean. The forced-clear
callback also asserts that every tracked destination page was marked before
the operation. Disabling postmark reproduces a written fill with DIRTY clear.
Test-tier and whitespace checks pass.

This closes the fixture's two canonical bulk-helper paths, not every bulk
writer. REP/fused handlers with their own raw copy/fill sequences, JS/host
outputs and asynchronous completions still need coverage; notification timing
and partial failures require explicit contracts. The earlier scalar timings
do not measure this bulk algorithm. Full-page concurrent-copy stress,
lifetime/reuse/wrap behavior and production mapped-file writeback remain open.

## Canonical REP candidate coverage and fused-path audit (2026-09-22)

The width fixture now wraps the actual rep_movsb_do, rep_movsd_do,
rep_stosb_do and rep_stosd_do cores. It snapshots the initial count and
destination, derives the low destination address for DF=1, and applies the
experimental pre/post range markers around the original core. The core still
owns copy order, contiguity/fallback choices and register updates; it is not
replaced with memmove, which would change overlapping REP semantics.

All **192 REP cases** pass: four cores, both DF settings, zero/small/multi-page
counts, four tracking masks, and a forced generation clear or no clear. Entire
buffer contents, unrelated backing, ECX/ESI/EDI, destination-only page state
and both sides of sparse crossings are checked. A disabled-postmark control
uses the raw REP STOSB fill path and reproduces the lost dirty bit. The earlier
152 scalar and 48 bulk cases continue to pass, as do tier/whitespace checks.
This fixture's REP data cases use disjoint source/destination; it does not
claim new overlap or fault-restart coverage for REP.

Inspection also found separate fused fast paths in `07b-loop-match.wat`:
32-byte MMX row copies can choose memory.copy or v128.store after one
invalidate_code_write; 64-byte row copies and strided byte-copy chunks likewise
use raw stores after a pre-write notification. Scalar fallback arms inherit
the candidate wrappers, but those fast arms do not. Attaching a dirty hook
only to gs*/guest_memmove/guest_memset therefore remains incomplete, and using
the existing pre-write invalidation alone would retain the demonstrated race.
The `07c-block-exec.wat` memory.copy sites inspected here save/restore threaded
instruction bytes rather than caller output; ownership matters more than the
presence of a copy opcode. This is a bounded source audit, not a certificate
for every generated store, host output or optimized loop.

No production handler or default changed. The wrappers are correctness
experiments, not the timed inline candidate, and game A/B readiness remains
unproven until those remaining fast writers and lifecycle contracts are covered.
