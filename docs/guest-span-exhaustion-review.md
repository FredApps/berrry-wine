# Guest-span exhaustion must not return a false contiguous pointer

2026-09-22. Shared safety follow-up to the ExecuteBuffer sparse-page audit.

guest_span_in promises contiguous WASM storage for a guest byte range. Affine
ranges can be returned directly; nonaffine ranges are gathered into a bounded
LIFO scratch arena. Previously, an exhausted arena incremented a counter but
returned plain g2w anyway. Callers then read or wrote unrelated backing pages
as if the promised contiguous range existed. The capacity addition also used
i32 arithmetic, allowing a huge requested length to wrap under the limit.

The helper now checks the sum in unsigned i64 and traps before copying when
capacity is exceeded. It increments the existing overflow counter and logs
three diagnostic DWORDs: 0x5350414E (SPAN), occupied bytes, requested bytes.
It does not change the cursor or existing borrowed spans. The affine fast
path and null/zero-length behavior remain unchanged.

This is an emulator safety stop, not a Win98 out-of-memory result. The current
helper/caller ABI has no propagated failure result: returning zero would let
unchecked callers write through zero, and returning raw g2w violates the
span contract. Graceful guest-visible recovery or a larger/dynamic contiguous
scratch facility would require a separate design and caller audit. No automatic
retry of an interrupted guest operation is implied by preserving the arena.

## Verification

`test/test-guest-span-exhaustion.js` first failed because a full arena returned
normally. It fills the actual arena with crossing 32-byte spans, accepts the
exact-fit final span, and verifies explicit traps for another span and a
0xfffffff0-byte request whose addition would wrap in i32. Both traps preserve
all held bytes and the cursor, increment the counter, and perform no partial
copy. It also covers full-arena affine bypass, null/zero-length calls, LIFO
writeback/release, and reuse after the fixture deliberately catches the trap.

The exhaustion regression, eighteen sparse/control PROCESSVERTICES comparisons
and 32 ExecuteData layouts pass. Fragment, ESP/epilogue, logical-operand,
silent-stub, duplicate and test-tier gates pass; inventories remain 243 manual
+ 22 metadata quiet handlers and 117 duplicate groups / 471 members.

These checks address scratch exhaustion, not inaccessible guest pages,
concurrent shared-arena ownership, mismatched release lengths or guest-range
validation generally. Full application/browser testing is not claimed.
