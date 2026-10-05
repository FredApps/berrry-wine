# Review P5-3: shared Win16 image ownership lookup

2026-09-19: `$win16_image_ne_off` and `$win16_image_base_addr` now query
one `$win16_current_image_record` scan in `src/08c-ne-loader.wat`.
The named accessors retain their distinct record fields and task-image
fallbacks. This removes the near-twin scan identified in the review without
changing allocation, selector ownership or resource-loading policy.

The shared lookup preserves the existing `(base, base + count]` segment
interval, nonzero loaded count, ascending module precedence, and full fixed
plus dynamic slot range. Zero means no matching DLL, not a pointer to a
synthetic record. No cross-call cache is introduced, so retirement and code
selector changes remain immediately observable.

## Verification

- `test/test-win16-image-owner.js` executes both real WAT accessors for all
  36 module slots: first/interior/last segments, excluded lower/upper bounds,
  empty and retired slots, overlapping-record precedence, final dynamic slot,
  and task fallback. It passes against both original and refactored source.
- An in-memory mutation changing the lower bound from exclusive to inclusive
  fails specifically at `module 1 excludes 100`; the test is boundary-sensitive.
- Full canonical/compat build and gates pass; 239 data segments, no overlaps.
- `test/test-ne-loader.js` passes 2,881 real-binary segment/fixup/resource
  checks after the rebuilt artifact is available.

Local evidence: `/private/tmp/wa-image-owner-before.log`,
`wa-image-owner-after.log`, `wa-image-owner-negative.log`,
`wa-image-owner-build.log`, `wa-image-owner-ne.log`.
This is a behavior-preserving refactor, not a claim of new Win98 compatibility
or measured performance improvement.
