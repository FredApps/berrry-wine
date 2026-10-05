# Paint: dock-collapse geometry (2026-09-19)

Binary: `test/binaries/mspaint.exe`, using its registered CLI companion DLLs.
Repro: `node test/test-mspaint-dock-toggle.js`. Command 59416 toggles the
Color Box. Screenshots land in `scratch/mspaint-dock-toggle/`.

## Confirmed cause and fix

The Color Box dock (`AfxControlBar42`, HWND 0x10006 in this run) shrinks from
267x49 to 267x0 when hidden. Its window geometry was updated, but
`$defwndproc_do_nccalcsize` returned early for **zero** width or height.
Consequently its recorded client height remained 49 at the new y=393,
overlapping the still-visible status bar (HWND 0x10004, y=393, height=23).

Accepting zero extents in that calculation fixes the stale client rectangle.
Negative outer extents are still rejected. No app/class special case, forced
status repaint, paint-order bypass, or pixel-threshold change was added.
This follows the documented role of
[NCCALCSIZE](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-nccalcsize_params):
derive the new client rectangle from the resized window rectangle. This is
not a claim of independently measured Win98 behavior for every degenerate
bordered-window case.

Evidence:

- Before: the dock-toggle test failed with 1,298 changed status pixels.
  Allowing 100 additional batches after each toggle did not resolve it.
- A focused regression first failed: resizing a borderless 267x49 window to
  267x0 still returned client dimensions 267x49. It now passes collapse on
  either/both axes and restoration.
- After rebuilding: the unchanged Paint dock-toggle test passes, with **0/0**
  changed status pixels for hidden/restored states.
- Full build, region/client regression, parent-child paint ordering, and
  WINDOWPOS mutation tests pass. Paint draw passes 9/9 and tools passes 22/22.
- Inspection of the hidden screenshot confirms the status text and borders
  are present, but also shows residual palette pixels near y=375 and missing
  scrollbar/layout repaint. Those remain open; this is not a whole-frame pass.

## Useful tracing / remaining investigation

`--trace-ctrl` plus
`--trace-api=SetWindowPos,InvalidateRect,BeginPaint,EndPaint,PeekMessageA`
and `BATCH:dump-windows:LABEL` distinguish geometry from repaint scheduling.
Before the fix, the native status drain repeatedly reported
`skip:ancestor-pending`; removing that guard was **not** necessary to restore
the status pixels. Do not infer from that trace alone that the guard is wrong.

Next: trace invalidation/non-client repaint of the canvas scrollbar and the
old palette footprint on dock collapse, then add assertions for those regions.

## Shared geometry cleanup: NOREDRAW (follow-up)

While tracing the repaint path, `$ctrl_geom_sync` proved to ignore
`SWP_NOREDRAW`: it immediately erased the old parent rectangle for a moved or
shrunk native control, then invalidated the parent and siblings. This is a
separate shared-path bug, not a confirmed cause of the custom Paint palette
artifacts. The cleanup now returns **after** committing geometry when the
flag is set. Both SetWindowPos and MoveWindow(FALSE) use this path.

[Microsoft's SetWindowPos contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
explicitly includes uncovered parent areas in the redraw suppression.
The regression in `test-movewindow-child-size.js` checks both APIs, a
shrink-only move, and an ordinary redraw-enabled move that must still queue
parent/sibling paints. With the current test and the HEAD version of the
control helper compiled in memory, it fails; the patched helper passes.
WINDOWPOS mutation and parent-first paint tests also pass. Full build and
Paint dock-toggle (0/0) / drawing (9/9) remain green. Palette remnants and
scrollbar repaint remain open.

## SetWindowPos non-client invalidation

The trace confirms that Color Box toggling resizes the surrounding dock/view
windows with `DeferWindowPos(..., 0x14)` (redraw enabled). EndDeferWindowPos
delegates those entries to SetWindowPos, which did not queue WM_NCPAINT for
geometry changes. It now marks NC paint pending for a visible window whose
position or outer size actually changed, respecting SWP_NOREDRAW and hidden
ancestors. It queues the normal message; it does not force a direct paint.

`test-movewindow-child-size.js` covers resize, identical geometry, NOREDRAW,
and hidden-ancestor cases. Compiling the pre-change SetWindowPos into the
current test fails the resize assertion; the candidate passes. The full
build and WINDOWPOS mutation test pass, and Paint's status remains pixel
identical across toggles. Visual inspection shows the view border is now
continuous, but the palette remnant and missing scrollbar are **not** solved
by this alone. The separate MoveWindow API's NC invalidation path and the
ordering of parent client paints versus child NC paints still need checking.

## MoveWindow parity

Filtered tracing confirms the inner canvas (HWND 0x10003) uses
`MoveWindow(…, 0, 0, 206, 327, TRUE)` when hiding the palette and height 278
when restoring it. That API also omitted NC invalidation. It now shares
`$windowpos_queue_ncpaint` with SetWindowPos, using the final normalized
NOMOVE/NOSIZE and NOREDRAW flags rather than a second hand-copied policy.
The unit test failed before this change and passes for resize, unchanged
geometry and `bRepaint=FALSE` afterward.

[MoveWindow's documented redraw contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-movewindow)
includes non-client scrollbars. This change addresses their missing
invalidation, **not** full API conformance: the documented synchronous
UpdateWindow/WM_PAINT behavior is a separate remaining gap in this handler.

Result: full build and WINDOWPOS tests pass; Paint drawing remains 9/9.
The hidden screenshot now has a complete horizontal scrollbar at y=375,
covering the formerly stale palette pixels. The strengthened dock-toggle
test crops with `PNG.bitblt` and compares with the shared `diffPng`: the
206x16 bar at y=326 initially, y=375 hidden, and y=326 restored is exactly
identical (**0/0 changed pixels**). Status pixels also remain **0/0**.
This resolves the palette-remnant/missing-scrollbar observation above;
full Win98 repaint timing and other unrelated Paint behaviors are not claimed.

## UpdateWindow prerequisite

Before reusing UpdateWindow for MoveWindow's synchronous repaint, inspection
found that it unconditionally called `$paint_flag_set_inv`, creating a full
client update even on a clean window. The
[official UpdateWindow contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-updatewindow)
sends WM_PAINT only for an existing nonempty update region. The handler now
returns without painting on empty damage and marks only the paint flag for
existing damage, preserving its original bounds.

The parent/child paint test first failed on the clean native child; it now
checks empty damage, a partial 3,4–12,15 region on the still-deferred native
path, and an executable guest callback that receives no WM_PAINT when clean
and exactly one before return when dirty. Build and Paint draw 9/9 pass;
status and scrollbar toggle comparisons remain 0/0.

Remaining: the existing synchronous-send depth/Win16/native restrictions in
UpdateWindow and MoveWindow's missing synchronous call are unchanged. Do not
equate the existing-damage fix with complete repaint/reentrancy semantics.

## Native UpdateWindow completion

Unsubclassed WAT-native controls now dispatch their target WM_PAINT
synchronously when effectively visible. The implementation propagates the
existing update to descendants, consumes its queue/update state, clears the
native background erase obligation, and invokes the normal native painter.
It does not drain other dirty windows. This supersedes the native deferral
noted above, but leaves subclassed/guest and Win16 restrictions unchanged.

The test failed before the fix because native update damage remained pending
after return. It now observes exactly one target paint through the existing
control trace import before UpdateWindow returns, plus empty update and paint
state afterward. Hidden partial damage is preserved without expansion.
Full build, guest callback/paint-order checks, Paint status/scrollbar 0/0, and
Calculator pressed-button 8/8 pass. MoveWindow's synchronous call remains open.

## MoveWindow uses the shared update core

`$update_window_now` now holds the existing UpdateWindow behavior without an
API-specific stdcall epilogue. Both UpdateWindow and MoveWindow(TRUE) call
it; MoveWindow(FALSE) does not. This removes the missing call without a
copied painter or an artificial nested API stack frame.

Regression: before the change a native MoveWindow(TRUE) returned without
invoking its painter. It now invokes exactly the target painter before
returning, while FALSE invokes none. The executable guest callback test
likewise records one WM_PAINT for TRUE and none for FALSE. Existing clean,
partial, hidden, WINDOWPOS mutation, and native/guest UpdateWindow checks
pass. Full build and Paint draw 9/9, status 0/0, scrollbar 0/0 pass.

The missing MoveWindow call is resolved for paths already supported by the
shared core. Reentrant x86 sends, subclassed native controls and Win16 remain
restricted there; those require separate callback/reentrancy work, not another
MoveWindow-specific shortcut.

## Nested x86 UpdateWindow

The blanket `$sync_msg_depth == 0` restriction was independently reproduced
with a real outer x86 wndproc calling UpdateWindow through its API thunk.
The outer procedure read the target's WM_PAINT counter immediately after the
call: it saw 0 before the fix instead of 1. Removing that restriction lets
the existing synchronous sender preserve each frame's registers and stack.
The regression now sees 1 before the outer procedure resumes, then verifies
that ESP is restored and synchronous depth returns to zero.

This resolves the nested x86 restriction described in earlier sections;
subclassed native controls and Win16 remain separate limitations. No Wine
source was used, and no app-name or initialization-phase exception was added.

Validation: full build, nested/stack regression and WINDOWPOS mutation pass;
Paint dock status and scrollbar remain 0/0. The tools test's normal 15-second
subprocess run failed before screenshots; a serial diagnostic invocation
overriding only that timeout to 120 seconds passed 22/22 (load average about
20). The permanent test timeout was not changed. Do not report the default
15-second invocation as passing.

## Subclassed native-control painting

Three shared-path shortcuts prevented ordinary native controls with guest
subclasses from owning their paint: UpdateWindow excluded every nonzero
control class, the internal synchronous sender intercepted WM_PAINT even
for subclasses, and CallWindowProc's built-in marker discarded a forwarded
WM_PAINT. Those restrictions are removed. A real x86 subclass now receives
the synchronous paint and can either replace it or chain to the native
procedure. This follows Microsoft's
[pre-ComCtl32 v6 subclassing contract](https://learn.microsoft.com/en-us/windows/win32/controls/subclassing-overview#subclassing-controls-prior-to-comctl32dll-version-6),
not a Win98 reference screenshot or Wine-source implementation.

The executable regression covers direct internal send, clean versus dirty
UpdateWindow, replacement without native painting, and forwarding through
both the fixture's original native procedure and WNDPROC_BUILTIN. Chaining
paints exactly once and preserves ESP and synchronous-send depth. The old
sender fails the subclass counter assertion; independently compiling the
old CallWindowProc branch fails the built-in native-painter assertion.
Independently restoring the old UpdateWindow core fails the dirty-subclass
synchronous callback assertion as well.

Full build, parent/child paint, MoveWindow and WINDOWPOS mutation tests pass.
Paint dock status and relocated scrollbar remain exactly 0/0 changed pixels.
Win16 far-procedure delivery and special native tab/status-bar interceptors
are still separate limitations. This does not claim all common-control
subclasses or update-region validation semantics are now correct.

Installer regression comparison: `test-winamp-installers.js` reports **25
passes / 28 failures** both with this fix and with all three touched WAT
fragments replaced in memory by their `ec165107` versions. All 53 assertion
lines (including pixel counts) match exactly. Both direct Winamp 2.91 silent
runs hit unimplemented `DllUnregisterServer` at batch 536. Remaining installer
failures include progress-fill/hidden-detail painting and completion; this
suite is not green and is not counted as an acceptance pass. Candidate and
baseline logs for this session are `/private/tmp/wa-subclass-nsis.log` and
`/private/tmp/wa-subclass-nsis-suite-baseline.log`. CreateWindowEx creation
failure/subclass transaction tests also pass.

## Native paint owns update consumption

The subclass regression exposed a second bug: CallWindowProc reached the
native painter but left the native control's update region nonempty. A
second UpdateWindow therefore sent the same paint again. Validation had
been copied into UpdateWindow, DispatchMessage, the native queue drain and
selected individual controls, rather than owned by the common procedure
boundary. This is the review's duplicated-state-transition problem in a
concrete USER path.

The ordinary native-control dispatcher now propagates the existing damage
to descendants, consumes the target's update/queue state and clears its
native background-erase obligation before painting. The three public/pump
callers no longer duplicate that policy. Status bars retain their separate
queue-drain handling because they bypass the ordinary control dispatcher.
Individual direct-to-class painter paths are not claimed consolidated.

The regression fails before the change (update region still present after
forwarded paint) and passes afterward. It also verifies that the next
UpdateWindow does not enter the subclass again, while a subclass that does
not validate retains its damage. A nonzero supplied DC does not trigger the
new dispatch-level consumption. This distinction is documented in the
[WM_PAINT remarks](https://learn.microsoft.com/en-us/windows/win32/gdi/wm-paint):
some controls accept an explicit DC; the ordinary paint path uses the
BeginPaint/validation transaction. This is not a claim that every native
control already implements supplied-DC drawing correctly.

Validation: full canonical/compat build, parent/child paint regression,
MoveWindow and automatic-button tests pass. Paint dock status and scrollbar
comparisons remain 0/0. The real Chrome Paint test passes drawing, flood
fill, airbrush, tool visibility, exact brush endpoints, and its existing
Win98 line-bound/mask assertions on a 1260x764 canvas. Its first attempt
failed before launch with CDP `Execution context was destroyed`; an unchanged
retry passed. Load averaged about 44 during the build, so no performance
conclusion is drawn. Logs: `/private/tmp/wa-native-validation-build.log`,
`/private/tmp/wa-native-validation-browser.log` and
`/private/tmp/wa-native-validation-browser-retry.log`.
