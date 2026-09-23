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
- PROCESSVERTICES receives a WASM source base and offsets it across vertices;
  destination vertices also use a once-translated buffer base.
- Execute and Pick walk instruction records with WASM-pointer arithmetic,
  then hand those addresses to opcode handlers. Repairing the backing copy
  alone cannot repair those consumers.
- Cache status helpers also return/consume raw header pointers. A complete
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
source-base API and cache-header/status readers still need guest-relative
contracts. Tests currently force sparse source storage, not sparse allocated
cache storage or complete vertex/instruction execution.
