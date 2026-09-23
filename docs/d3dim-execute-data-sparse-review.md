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
