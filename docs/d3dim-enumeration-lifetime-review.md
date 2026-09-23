# D3D format enumeration lifetime — 2026-09-22

The enumeration-alias audit found process-global texture/z callback state and
format allocations with no completion cleanup. Simply freeing the global
format pointer would be unsafe: a callback can start another enumeration and
replace that pointer before the outer invocation returns.

Texture and z-format enumeration now use one 128-byte owned record per call:
callback, user context, caller return, payload kind, current index, and an
inline payload large enough for DDSURFACEDESC. Its guest pointer occupies the
private stack slot behind the callback's two public arguments. Both existing
continuation thunks converge on one continuation helper.

Completion, cancellation and the single z-format return release the record,
including its payload, then restore the saved caller. A continuing texture
callback advances only its own index. Nested callbacks have independent
payloads and state. Allocation failure returns E_OUTOFMEMORY without invoking
the callback; this branch was inspected but not fault-injected in the test.
The former ten mutable invocation-state globals are removed; only the two
initialized callback thunk addresses remain global.

The public callback argument layout and final API stack cleanup are unchanged.
The private stack slot now contains the invocation pointer rather than the
caller return address directly; tests that inspected that implementation detail
now follow its saved caller field. Format values and null-callback behavior
are unchanged.

## Evidence

The expanded enumeration regression tests all 36 outer/inner combinations
across the six public entry points. Against pre-change DirectX code it failed
on the first same-family nesting: the outer enumeration resumed the inner
callback address (0x12345688 rather than 0x12345678). It now verifies preserved
outer payload/context/index, correct caller returns and exact final ESP.
Heap allocation/free counters balance across the ordinary and nested cases,
plus 120 cancellation/exhaustion cycles with exactly one live allocation per
in-flight call. Existing descriptor and interface-spec tests remain in scope.

Callback returns are simulated with RET-8 stack effects before calling the
production continuation helpers. This does not certify guest x86 callback
execution, exceptions/nonlocal exits, real worker scheduling or every D3D
enumerator. In particular, device/display-mode enumerations still need their
own invocation-state review.

A concurrent GL edit initially prevented compilation (missing GL_SW_STATE).
The old-code negative control used in-memory committed GL raster/encoder
overlays, with no worktree reverts. The positive enumeration run subsequently
compiled current shared source without overlays after the GL edits progressed.
No full release build or native Win98/game capture is claimed.

Descriptor/spec (211 methods), fragment balance, handler ESP, generated
epilogues and silent-handler checks pass. The duplicate ratchet is unchanged
at 123 groups / 491 members; quiet count remains 247 + 22. The shared-tree
logical-AND gate flagged `09a8g-gl-raster.wat:771`, outside this change; its
owner was notified. Do not treat these focused results as a green full build.
