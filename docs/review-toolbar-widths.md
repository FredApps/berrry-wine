# Review follow-up: toolbar width near-twins

Scope: the `$toolbar_button_raw_width` / `$toolbar_button_width` pair named
in `fable-review.md` P5-3. Both duplicated the default width, item bounds,
separator detection and separator-width fallback. They differed only in
whether an embedded combo's width went through sibling negotiation.

Both now delegate to `$toolbar_button_width_core` with an explicit mode.
The large-combo negotiation still calls the **raw** wrapper for siblings;
calling the constrained wrapper there would recursively negotiate the same
two controls. Existing entry points, sizing constants and lookup order are
preserved. The WAT change removes 17 net lines.

`test/test-toolbar-widths.js` passes with both the original and refactored
implementation. It covers missing records, nonpositive/default button
widths, ordinary buttons, separator widths around both fallback boundaries,
invalid indices, two large combo siblings, narrow/wide parents, and the
small-combo exception. In a 400-pixel parent, raw widths 250/300 plus a
23-pixel sibling retain constrained widths 80/125; a wide parent retains
250/300. This tests the existing algorithm, **not** independent Win98
conformance of its 160-pixel threshold or 80-pixel minimum. Those heuristics
were not introduced or broadened by this change.

The existing toolbar insertion/state/geometry suite passes 48/48, and
WordPad's real-EXE toolbar layout/command regression passes 23/23. The
control-variant gate's ToolbarState attribution moves from the two old
bodies to the shared core; the wrappers no longer access fields themselves.
The initial full build correctly rejected those stale attributions before
they were updated. No gate rule was weakened. No
performance benefit is claimed; this removes a duplicated sizing policy,
not an interpreter hot-path optimization.

The corrected control-variant gate passes (579 sites, 200 attributed
functions). A subsequent full build is **not green**: another active lane
resized the DirectX regions in `src/00-regions.wat` while validation was
running, and the build correctly rejected its stale
`lib/region-map.generated.js`. This refactor changes no region declarations
or map. The owner was notified on the messageboard; those files were not
modified or staged here. The source-compiled width, toolbar and WordPad
tests above completed before that concurrent resize. Logs are
`/private/tmp/wa-toolbar-width-build.log` (initial attribution rejection),
`/private/tmp/wa-toolbar-width-build-final.log` (map freshness rejection),
`/private/tmp/wa-toolbar-width-insert.log`, and
`/private/tmp/wa-toolbar-width-wordpad.log`.

Follow-up: the DX owner regenerated the map. The subsequent full build during
the Win16 rectangle-bridge follow-up passed both canonical and compatibility
artifacts, including this toolbar refactor and its corrected attribution.
Log: `/private/tmp/wa-win16-rect-build.log`, layout `da439e4cfa25a28d`.
The shared-build limitation above is resolved; the earlier failures remain
recorded as such.
