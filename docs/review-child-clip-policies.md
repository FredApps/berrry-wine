# Review P5-3: shared child exclusion scan

2026-09-19: `dc_exclude_children_for_clip` now retains its
`WS_CLIPCHILDREN` guard and delegates the visible-child rectangle scan to
`dc_exclude_visible_children_for_erase`. The erase path remains unconditional.
Removed the duplicate scan and its unused locals; no region representation,
coordinate calculation, visibility rule or rendering policy changed.

## Verification

`test/test-child-clip-policies.js` creates actual USER windows/children and a
64x64 DIB-backed DC, then checks every point of its effective device clip.
The 49,152-point matrix covers both entry points with/without the parent
style, three origins (including negative offsets), overlapping visible
children, hidden children, zero-width children, and children of another
parent. It passes on both the original and refactored source.

The first harness draft had no selected bitmap and tried an unsupported
system-clip COPY operation; it failed even with exclusion disabled. Selecting
the DIB and using the supported intersection operation corrected the fixture
before any runtime source was changed.

A negative in-memory mutation removing the style guard fails the ordinary
clip path with `clipChildren=false`. The distinction between the two entry
points is therefore exercised, not merely described. The existing real
parent/child paint-order and nested/subclass UpdateWindow regression passes.
Full canonical/compat build and gates pass.

Evidence: `/private/tmp/wa-child-clip-before.log`, `wa-child-clip-after.log`,
`wa-child-clip-negative.log`, `wa-child-clip-paint.log`,
`wa-child-clip-build.log`.

## Scope limitation

The existing unconditional erase exclusion compensates for children sharing
the parent's backing surface. This refactor preserves it; it does not prove
that this policy matches every native Win98 visible-region case. No new
native conformance or performance claim is made.
