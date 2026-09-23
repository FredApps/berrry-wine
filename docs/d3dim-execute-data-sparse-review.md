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

- d3dim_execbuf_source_base and cache_refresh duplicate cache allocation and
  whole-buffer memcpy logic. Their cache headers and payloads use raw WASM
  offsets; source_base also replaces a mismatched cache without freeing it.
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
