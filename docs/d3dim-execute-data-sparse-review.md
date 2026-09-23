# ExecuteData across sparse pages

2026-09-22. Public buffer-access follow-up to ExecuteBuffer lifetime work.

SetExecuteData read its scalar fields with guest accessors but copied the
24-byte dsStatus tail through a single g2w pointer. GetExecuteData similarly
cleared 48 bytes and copied its status tail through single translated
pointers. Adjacent guest pages need not be adjacent in WASM memory, so these
operations could leave the output partially untouched and modify unrelated
backing storage while still returning S_OK.

The new regression first failed on an uncached GetExecuteData output starting
two bytes before a guest page boundary: scalar stores succeeded but the
remaining output retained 0xcc instead of being cleared. The handlers now
use guest_memset/guest_memmove for the full clear and both status copies.
The existing cache-header helper still returns a WASM address; convert that
base once with w2g before adding the guest-relative status offset. No whole
caller buffer is treated as affine merely because its first byte translates.

## Coverage

`node test/test-d3dim-execute-data-sparse.js` exercises sixteen layouts:
cached/uncached objects, boundaries crossing dwSize or dsStatus, and independent
contiguous/sparse input and output choices. It checks all 48 output bytes,
input preservation, output canaries, both interleaved backing-page guards,
and stdcall cleanup/stack guards. Objects use public creation and Release;
public Unlock prepares the cached cases. Tests retain the existing missing
cache behavior (zero status) and fixed 48-byte output policy, not a newly
asserted native size/flag contract.

All sixteen cases pass after the fix, as do the eight cached/uncached lifetime
cases and scoped fragment, ESP/epilogue, logical-operand, silent-stub,
duplicate and test-tier checks. Quiet remains 243 manual + 22 metadata;
duplicates remain 117 groups / 471 members.

## Execution audit still open

This fixes the caller's ExecuteData buffers, not the whole Execute engine.
The audit found these additional dependencies:

- Cache allocation/copy duplication and the mismatched-cache replacement leak
  are addressed by the shared-owner follow-up below. Source-base return values
  and downstream consumers still use raw WASM pointers.
- PROCESSVERTICES source/destination traversal is addressed in the bounded
  vertex follow-up below; opcode records still arrive as WASM pointers.
- Execute and Pick walk instruction records with WASM-pointer arithmetic,
  then hand those addresses to opcode handlers. Repairing the backing copy
  alone cannot repair those consumers.
- Cache status helpers now use guest headers (follow-up below). The remaining
  migration must keep persistent addresses guest-relative and acquire bounded
  spans at consumers requiring contiguous records, with explicit release and
  writeback. Span allocation/failure limits must be verified before using a
  whole-buffer span as a fallback.

No native Win98, real x86 indirect-call, browser/game rendering or full-build
validation is claimed by this focused regression.

## Shared cache owner follow-up

The new cache regression reproduced the lazy source path leaking one allocation
on size mismatch (live heap 74 instead of 73). Both lazy source lookup and Unlock
refresh now use d3dim_execbuf_cache_ensure. It owns guest-address header reads,
allocation, initialization, page-aware snapshot copying and replacement. A
matching lazy lookup preserves its snapshot; matching Unlock refreshes only
the payload and preserves status. A successful replacement clears status,
publishes the complete new cache, and frees the old allocation. Failed
allocation leaves the old cache owned and unchanged; a subsequent retry or
final Release can still retire it. No failure switch is added to production.

`test/test-d3dim-execute-cache.js` first verified 32 direct/sparse source
snapshots and replacements across both paths, every snapshot byte, unchanged
interleaved backing, lazy reuse versus Unlock refresh, status preservation
and final heap balance. The fixture varies stored size explicitly to exercise
replacement; it does not claim a public resize API exists. It borrows its
payload and detaches it before public Release, leaving cache ownership real.
The extended regression injects failure only at the shared cache allocation
site and checks eight initial/replacement failures plus retries: no publication
on initial failure, old pointer/bytes/count preserved on replacement failure,
and balanced final cleanup. The unchanged lazy allocation-failure fallback
returns the original buffer's translated base; that fallback is not yet safe
for downstream cross-page consumers.

All 32 snapshot cases and eight fault/retry cases pass, along with the sixteen
ExecuteData layouts, eight lifetime cases and scoped static gates. Quiet and
duplicate counts remain unchanged.

This consolidates the writer/owner, not the entire execution engine. The
source-base API is migrated in the bounded vertex follow-up. Cache-header/status
readers are migrated in the follow-up below. The owner test forces sparse
source storage, not sparse allocator-returned cache storage or complete
vertex/instruction execution.

## Guest-address header/status contract

The expanded ExecuteData regression relocated a real cache into borrowed
nonaffine test pages, retaining the original owned allocation for cleanup.
It reproduced lost status when the first identity DWORD crossed a page:
cache_header rejected a valid cache after reading unrelated backing bytes.

The helper is now explicitly named d3dim_execbuf_cache_header_guest, reads
both identity fields with guest accessors and returns the persistent guest
address. All three consumers use that contract: public Set/GetExecuteData
no longer reverse-translate a WASM header, and the opcode status writer uses
guest stores for its six status DWORDs and its extent updates. The opcode
record itself retains its existing WASM-address input contract; this does not
repair the instruction decoder's separate sparse-read assumptions.

The regression expands to 32 layouts: absent, original, header-crossing and
status-crossing caches, crossed caller dwSize/status fields, and independent
input/output placement. Each cached case also invokes the opcode status writer
with a contiguous status record and verifies readback. All three interleaved
backing pages and caller canaries are checked. Borrowed caches are detached
and their original heap-owned pointers restored before public Release.
The opcode record requests status only; native extent semantics and the
device-state-dependent extent calculation are not certified by this fixture.

All 32 ExecuteData layouts, 32 cache snapshots/replacements with eight forced
allocation failures/retries, eight lifetime cycles and scoped static gates
pass. Quiet remains 243 manual + 22 metadata and duplicates 117 / 471.

## Bounded vertex follow-up

The snapshot accessor is now d3dim_execbuf_source_guest: both cached and
allocation-failure/no-owner paths return guest addresses. PROCESSVERTICES
keeps source/destination indexing in that address space. COPY uses
guest_memmove. The transform modes gather at most one 32-byte source vertex
and one 32-byte destination vertex for the existing math helpers, then write
back the destination and release the source in reverse acquisition order.
No whole-buffer contiguous copy or extra persistent render surface is added.

`test/test-d3dim-execute-vertices-sparse.js` reproduced untouched destination
bytes in a crossing-source transform. Eighteen sparse/control comparisons now
pass: three modes, absent/heap-owned/borrowed-sparse source caches, and source
or destination page crossings. Every buffer byte matches the contiguous
control; neighboring backing pages, buffer canaries and span cursor/overflow
counters remain unchanged. Two vertices per record check advancing across
the boundary rather than only transforming the first vertex. Fixtures attach
borrowed storage directly and detach it for cleanup, so this proves the vertex
helper's addressing, not native creation policy or full Execute dispatch.

The cache regression's eight failure/retry cases now assert guest-address
fallback results. Its 32 snapshots/replacements, the adjacent vertex-buffer
ProcessVertices regression and scoped static gates also pass. Quiet and
duplicate inventories are unchanged. Native transform/lighting semantics are
not newly certified by comparing two layouts of the same implementation.

Remaining: Execute/Pick instruction walking and record inputs, other primitive
vertex readers, range/overflow validation, and full application rendering.
The generic span arena's unsafe exhaustion fallback is removed in the
[shared exhaustion follow-up](guest-span-exhaustion-review.md): exhaustion
now stops explicitly before copying. This vertex path uses at most 64
additional bytes and the test observes no overflow; graceful recovery from
arena exhaustion remains separate work.

## Execute instruction/record follow-up (2026-09-22)

Execute now retains a guest-address cursor for instruction headers, operand
records, branch targets and trace offsets. All nine record helpers share
that contract: points, lines, triangles, matrix load/multiply, state walking,
PROCESSVERTICES, branch and status. Scalar reads use gl8/gl16/gl32;
SETSTATUS copies its 24 bytes with guest_memmove. No whole-stream gather or
record-group scratch allocation is needed. The two existing helper-level
tests now pass guest record addresses instead of translating them first.

`node test/test-d3dim-execute-instructions-sparse.js` first passed its
contiguous control, then failed on the first sparse layout: render state
remained zero instead of becoming one. With the migration it passes:

- One control and 195 page-boundary placements across every byte of a
  multi-opcode stream, including headers, multirecord operands and a taken
  branch that skips a state write. Untaken branches are also exercised.
- Matrix load/multiply, transform/light/render state, COPY vertex output,
  public GetExecuteData status readback, guest-relative opcode traces,
  stdcall stack checks, unchanged instruction bytes and surrounding canaries.
- A 2,200-record render-state group spanning nonaffine pages, larger than the
  16KiB span arena, without consuming scratch or changing overflow counters.
- 65 sparse/control pixel comparisons for point, line and triangle record
  streams on a real 32x32 surface. Two records per opcode exercise record
  advancement. Triangle coverage uses point fill; vertex bytes themselves
  deliberately remain within one page. Interleaved backing pages stay intact.

The fixture uses public Execute/CreateExecuteBuffer/SetExecuteData/Unlock/
GetExecuteData/Release dispatch, with an initialized synthetic device and
borrowed sparse buffer mappings. It restores the owned buffer before Release.
It does not exercise x86 indirect calls or certify native driver behavior.

Adjacent ExecuteData (32 layouts), PROCESSVERTICES (18 comparisons), cache
(32 snapshots/replacements plus eight allocation faults/retries), interface
metadata and scoped static gates pass. Quiet remains 243 manual + 22 metadata;
duplicate census remains 117 groups / 471 members. No browser/full-build or
performance result is claimed. The unrelated in-progress GL fog hunk in the
same core file is excluded from this change.

Still open: primitive vertex-base translation; invalid record sizes, bounds,
indices, arithmetic overflow and branch loops; actual branch status/mask
semantics (the current helper still assumes status zero); the end-of-range
header comparison (tests pad EXIT to preserve that separate policy); full
application rendering. Pick walking and output crossings were handled in
the separate [Pick review](d3dim-pick-sparse-review.md).

## Primitive vertex follow-up (2026-09-22)

Points and lines now index vertices using guest addresses and read positions
and color through guest scalar accessors. Triangles acquire three bounded
32-byte vertex spans for the existing raster/math helpers. A single cleanup
block releases them in reverse order after all normal draw/skip paths, including
point fill, wireframe, fully hidden triangles and partially clipped triangles.
It also removes four duplicated record-advance/loop-continue sequences.
Directly contiguous vertices use the span helper's existing no-copy path;
at most 96 bytes are gathered by this caller, not the entire execute buffer.

The Execute regression first failed with unrelated positions/colors for a
point whose first vertex crossed a page. It now compares 2,470 sparse/control
vertex layouts: 95 byte-boundary placements for points and lines, plus all
three triangle fill modes and eight positive/negative-rhw combinations.
Every draw verifies unchanged input vertices and balanced span cursor/overflow
counters; neighboring backing pages retain their sentinels. The all-visible
controls must actually draw pixels, rather than merely agree on a blank image.
The existing 195 instruction-boundary cases, 65 record/pixel comparisons and
2,200-record group remain covered. This is layout-equivalence evidence for the
existing rasterizer, not new native clipping/lighting/texture conformance.

The 18 PROCESSVERTICES sparse comparisons and existing v3 vertex-buffer draw
regression (961 indexed pixels) also pass, alongside interface/dispatch and
scoped static gates. Quiet and duplicate inventories remain unchanged. No
full-build, browser gameplay or performance claim is made by this change.

Remaining: malformed record sizes and vertex indices, overflow/range checking,
branch status semantics and full application/browser verification. A trap on
scratch exhaustion is still an emulator safety stop, not graceful API recovery.

## Branch comparison follow-up (2026-09-22)

Microsoft's [SDK d3dtypes.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/d3dtypes.h)
describes D3DBRANCH as masking driver status, comparing the result to dwValue,
and optionally negating the comparison. Its D3DSTATUS definition identifies
dwStatus separately from the flags and extent. This is the primary-source
basis for the comparison change; Wine implementation behavior is not its basis.

The old branch helper ignored dwMask and assumed status zero. Execute now
passes the execute-buffer identity, and the helper reads the same guest-safe
retained status that SETSTATUS writes and GetExecuteData returns. It compares
`(status & mask) == value`, with any nonzero bNegate reversing the result.
Target arithmetic, zero-offset termination and first-record-only handling
are unchanged, not newly certified by this change.

The extended Execute regression failed before the fix for status/mask
0x80000000, value zero, negate zero: it incorrectly skipped a state write.
Afterward all 1,152 combinations pass: four statuses, four masks, four values,
three negate values (0/1/2), status seeded through either SetExecuteData or a
SETSTATUS instruction, and three direct/sparse stream placements. Each case
checks the observable render-state write, retained status readback and public
stdcall ABI. Existing 195 instruction boundaries, 65 record/pixel comparisons,
2,470 vertex layouts and the large record group still pass, as do the 32
ExecuteData layouts and scoped static gates. Quiet243+22 and dup117/471 remain
unchanged. No native/browser/full-build/performance claim is made.

Important remaining status work: storage is still tied to the source cache;
the regression intentionally Unlocks before seeding status. SetExecuteData
and SETSTATUS without that owner can still lose status, and cache-allocation
failure is not repaired here. SETSTATUS flag-selective updates, multi-record
branch dispatch, clip-generated status and device-vs-buffer lifetime across
Execute calls still require review/native evidence. The SDK's device-status
lifetime comment is not sufficient evidence to certify our per-buffer storage.

## Multi-record branch/status traversal (2026-09-22)

The same Microsoft SDK header defines D3DINSTRUCTION.bSize as the size of
each data unit and wCount as the number that follow. Execute previously
ignored that count for BRANCHFORWARD and used only the first SETSTATUS record.
Both now traverse the declared count/stride. The first taken branch transfers
control immediately; no match falls through. Zero records consume no operands.
SETSTATUS applies each record in order using the existing status writer.

The regression initially trapped on a zero-record branch: the old helper
interpreted the following render-state instruction as a branch record and
jumped into invalid instruction bytes. After the fix, 68 cases pass across
zero/one/three records and direct/sparse placement. Branch cases cover first,
middle, last and no matches, multiple simultaneously matching records with
distinct destinations, and taken zero-offset termination. SETSTATUS cases
verify that the final record is retained, or the existing status survives a
zero-record instruction. All calls check the public Execute ABI.

The complete Execute sparse/render suite, 32 ExecuteData layouts and scoped
static gates pass; quiet243+22 and dup117/471 are unchanged. The test uses
standard record sizes, not malformed sizes or an assertion that arbitrary
padded records are native-compatible. Branch offset origin/zero-offset policy
are preserved and regression-tested, not newly native-verified. Status flags,
cache-independent ownership, clip status, device lifetime, buffer/index bounds
and browser/full-application verification remain open.
