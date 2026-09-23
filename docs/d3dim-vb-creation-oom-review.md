# Vertex-buffer creation allocation rollback

2026-09-22. P5 false-success and ownership follow-up.

## Fault and fix

The shared D3D3/7 CreateVertexBuffer core allocated the COM object first,
ignored descriptor/data allocation failure, and published S_OK with missing
storage. The new fault-injection regression reproduced descriptor allocation
failure returning success.

Creation now clears the output, stages descriptor and data allocations, and
only then allocates the COM object. Descriptor failure returns E_OUTOFMEMORY;
data failure frees the descriptor and returns E_OUTOFMEMORY; object failure
frees both staged allocations and preserves the existing E_FAIL result.
No heap-allocation failure consumes a permanent COM-wrapper slot. Publication
occurs only after initialization and attachment of the owned buffers.

Initialization uses existing guest_memmove/guest_memset helpers instead of
assuming a translated base covers the entire guest range. The test checks
copying a descriptor across nonadjacent sparse pages. Specialized Release
still owns descriptor/data teardown; interface negotiation is unchanged.

## Verification

`test/test-d3dim-vb-creation-oom.js` replaces exactly three allocation call
sites in this function in an in-memory test compilation. Each replacement
is asserted unique; no production fault switches or allocator edits exist.

The regression passes 24 injected descriptor/data/object failures and 24
successful retries through public D3D3/7 dispatch, alternating contiguous
and nonaffine sparse input descriptors. It checks HRESULT, cleared output,
live heap/object counts, no premature object-allocation attempts, stdcall
cleanup/guards, copied FVF, zeroed data and final public Release restoring
allocation counts. All 48 bytes of each small successful data buffer are
checked, not merely its first word.

The existing VB/VB7 alias/lock/descriptor/lifetime regression passes, as does
the D3D3 vertex-buffer draw regression (961 indexed pixels rasterized).

Fragment, handler ESP, generated epilogue, logical-operand, quiet-inventory,
duplicate and test-tier gates pass. Counts remain 243 manual quiet handlers
+ 22 metadata and 119 duplicate groups / 476 members.

## Limits and remaining work

This is not a native error-precedence or browser/full-build result. Existing
null-descriptor policy, size clamps and 32-bit size multiplication remain
unchanged and need a separate validation audit. Faults cover allocation
returns, not arbitrary memory traps. Large sparse data-buffer allocation is
not injected here; initialization delegates to the existing page-aware fill.
Vertex-buffer QI's accept-all behavior remains open pending the
[native interface probe](d3dim-vertex-buffer-native-probe.md).
