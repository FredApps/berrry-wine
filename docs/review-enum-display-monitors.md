# EnumDisplayMonitors: remove fixed-address callback scratch

2026-09-19 follow-up to the P5-8 core split / region-literal inventory.

The six counted literals in the extracted USER fragment were not six memory
addresses. Four are the ABI constant `WS_DISABLED` (0x08000000), numerically
equal to a region base; replacing them with that region symbol would corrupt
window semantics when the layout moved. The other two were obsolete
guest/WASM conversions in `EnumDisplayMonitors`.

That handler first built and discarded a stack RECT, then wrote a fixed
0xAD40 scratch area, advertised it through pre-region-map arithmetic, and
returned hardcoded 640x480 dimensions. Its monitor handle 0x10001 disagreed
with MonitorFromPoint/GetMonitorInfo's 0x10000. It ignored clip selection,
did not give nested invocations private storage, and silently replaced any
supplied HDC with NULL.

## Change

The supported single-monitor / NULL-HDC path now uses live screen dimensions,
the canonical primary-monitor handle, and a per-invocation guest-stack frame.
A return thunk restores the API caller's stack and propagates the callback's
BOOL. Frame data survives nested callbacks without global scratch ownership.
It reuses the existing continuation-thunk allocator; the new marker is
`CACA0036`.

Clipping filters whether the primary monitor intersects the selection.
Importantly, with NULL HDC the callback receives the **full monitor RECT**,
not the clipping intersection. These contracts follow Microsoft's
[EnumDisplayMonitors](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaymonitors)
and [MonitorEnumProc](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nc-winuser-monitorenumproc)
documentation. This is not a fresh native Win98 capture comparison.

The initial correction explicitly rejected non-NULL HDC. The subsequent DC
implementation below removes that limitation. NULL callbacks fail with
ERROR_INVALID_PARAMETER (87); invalid/non-display DCs fail with
ERROR_INVALID_HANDLE (6). These error choices are not measured native
last-error values. Multiple monitors are not modeled.

## Verification

`test/test-enum-display-monitors.js` executes real guest x86 stdcall callbacks,
dereferences the RECT, records every argument, and checks 800x600 geometry,
primary identity, callback FALSE, empty/reversed/edge-only clips, full RECT
under a nonempty clip, caller stack preservation and nested frame isolation.
The old handler fails the same test at primary identity (65537 vs 65536).
`test/test-monitor-selection.js` also passes.
The full build, including both WASM variants and all gates, passes. The final
callback test with caller-stack canaries passes as well
(`/private/tmp/wa-enum-monitor-test3.log`).

The raw-region bucket ratchets from six to four; the four remaining style
flags are not memory-map debt. Local logs:
`/private/tmp/wa-enum-monitor-test2.log`, `wa-enum-monitor-baseline.log`,
`wa-enum-monitor-selection.log`, `wa-enum-monitor-build.log`.

## Display-DC follow-up — 2026-09-19

Non-NULL screen/window DCs now use the existing effective clip region, not
just its bounding box. The monitor bounds are translated into DC coordinates
using the window/client screen origin, then intersected with that region and
the caller's optional device-coordinate selection. Empty intersections do not
invoke the callback. Region holes remain holes during actual drawing.

For the single modeled monitor, the callback receives the same display DC
with its clipping narrowed for the enumeration. Its color attributes and
logical drawing mapping are retained. SaveDC/RestoreDC brackets each callback;
the saved level and HDC live in the invocation's 32-byte guest-stack frame.
Return (including FALSE) restores the caller's state. Nested enumeration on
the same HDC restores the outer selection before the original caller state.
This uses existing GDI primitives and does not edit the concurrently owned DC
implementation file.

Added checks cover complex clip holes, callback RECT bounds, actual mapped
SetPixel acceptance/rejection, attribute/mapping restoration, empty/reversed
selections, nested clipping on one HDC, and a partially off-screen window DC.
Three hundred repeated enumerations still invoke the callback and leave the
next SaveDC level at one, checking temporary-region and saved-frame cleanup.
Monitor-selection and all seven SelectClipPath regressions pass as well.
The prior implementation fails at `nonempty DC selection invokes callback`;
its different private RECT frame offset is adjusted only for that baseline
test. Both canonical and compatibility full builds pass all gates.

Local evidence: `/private/tmp/wa-monitor-dc-test7.log`,
`wa-monitor-dc-baseline.log`, `wa-monitor-dc-build3.log`,
`wa-monitor-dc-selection.log`, `wa-monitor-dc-path.log`.
Remaining limitations include the runtime's single-monitor model and the
underlying GDI visible-region model; this is not evidence of complete native
Win98 multi-monitor or cross-thread shared-HDC conformance.
