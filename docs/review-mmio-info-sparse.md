# MMIOINFO sparse-page follow-up — 2026-09-23

During the `fable-review.md` follow-up, a fresh caller-buffer census found two
MMIOINFO writers that translated the caller's pointer with `$g2w` and then
accessed the full 72-byte structure as linear WASM memory. Inspection of
their consumers found the same assumption in memory-file open/synchronization,
file refill and `mmioSetInfo`. A single translation is not a span guarantee:
adjacent guest pages can have nonadjacent backing pages.

## Reproduction and change

`test/test-mmio-info-sparse.js` maps the first guest page, an unrelated page,
then the second guest page, and asserts their backing is noncontiguous.
It places MMIOINFO both two bytes and 24 bytes before the boundary, alongside
a direct-memory control. Before the fix, the first sparse memory-file open
read the unrelated page's `0xa7` guard as `adwInfo[0]`, falsely treated the
fixed-size file as expandable, and trapped in `$crash_unimplemented`.
The old failure log is `/private/tmp/wa-mmio-info-red.log`.

Six MMIO structure consumers now acquire one 72-byte `$guest_span_in` view.
Read-only paths release it; writers scatter it back and release it. The
memory-file opener uses a borrowed-view helper so its ordinary early error
returns all reach writeback. An unbuffered refill releases before returning;
a pending lazy refill writes back and releases before the handler enters
`IO_WAIT`, so a retry retains no scratch allocation. Contiguous memory keeps
the existing span helper's direct-view path.

This does not change MMIO's flags, handles, buffer ownership or error policy,
implement expandable memory files, or establish Windows conformance for
unsupported/invalid pointers. It fixes the emulator's own valid sparse
address translation contract. No Wine source was consulted.

## Validation

The focused regression checks memory/file open/get/set/advance/close paths,
all 72 output bytes, input preservation, invalid-size/unbuffered/full-memory
errors, pending provider retry, stack cleanup and guards, neighboring guest
and unrelated backing bytes, and a zero span cursor after each return.
The existing `test/test-wat-mmio.js` checks FOURCC conversion, buffer ownership,
SimGolf-style 128 KiB memory files, and lazy read/refill retries.

Final full-record regression: 36 completed ABI calls plus three pending
calls pass (the completed refill retries are included in the 36); existing
MMIO suite passes. Full build passes: normal 1,506,325 bytes, compatibility
1,508,731 bytes, layout `68ce5b9062e11919`, no data-segment overlaps. Test
discovery includes the new regression (1,501 total). Silent inventory remains
243 manual + 22 metadata; duplicate baseline remains 117 groups / 467 members.
`git diff --check` passes. Logs are `/private/tmp/wa-mmio-info-final.log`,
`/private/tmp/wa-mmio-existing.log`, and `/private/tmp/wa-mmio-info-build.log`.

The source census now reports no single-translation caller spans of at least
64 bytes in the audio fragment; that heuristic does not prove every audio
buffer is sparse-safe. No benchmark or browser-gameplay claim is made.
