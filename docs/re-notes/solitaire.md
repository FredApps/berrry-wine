# Solitaire (NT debug build in Entertainment Pack)

2026-09-10 mobile assertion diagnosis; no runtime fix implemented.

`sol`, `test/binaries/entertainment-pack/sol.exe`, preferred/runtime base
`0x01000000`. This is a debug build with native Assertion Failure dialogs.
Existing `test/test-solitaire-drag.js` even dismisses initial assertions;
that is not evidence that the underlying assertion cause was fixed.

## Real iPhone capture: util.c line125

Authenticated local debug hub8088, stable worktree
`/private/tmp/wa-idle-integrate-20260910`, commit8cd29260. Real iPhone Safari
iOS17.6.1. Live session d6b7bbf3 returned the native assertion stack while
the user left the dialog open. Do not confuse stale sessions or automated
Chrome sessions with the phone. Temporary server/probe scripts:
`/private/tmp/sol-phone-server.js`, `/private/tmp/sol-assert-probe.js`.
The server uses the existing dev-server/agent-remote/ctl protocol; the
credential is passed in the explicitly shared bootstrap URL fragment, not
embedded in publicly served HTML. No COOP/COEP added, no production deployment.

Main window400x757, client392x711. Assertion dialog305x214 at22,66. A later
viewport read was375x628 CSS pixels (Safari toolbar/viewport state can change).
Native stack:

- `0x01003165`: assertion return, args source pointer0x010012f0 (`util.c`),125.
- `0x01004fa1`: erase helper return, rectangle args **81,0,0,0**.
- `0x01005ad2`, `0x01006959`, `0x01007ac3`, `0x01007dea`,
  `0x01004f23`, `0x01008307`, `0x01009408`, `0x01003d45`,
  `0x0100283c`, `0x010020ef`.
- Outer wndproc frame: hwnd65537, **WM_COMMAND0x111, command1000** (new game).

`0x010030f0` is the background rectangle painter. It checks HDC at line120,
then **left <= right** at `0x0100314c..0x01003160` (line125), then
top <= bottom (line126), before PatBlt. The screenshot was this guest
assertion, not a browser/WASM trap.

`0x01004f50` erases the uncovered part beside/below a card. At the captured
call its pile pointer was0x01284ae4; pile bounds at+8,+12,+16,+20 were all0.
The card point pointer0x01284d70 held10,5; card dimensions at0x0100f180/184
were71x96. Consequently left = cardX10 + cardWidth71 =81, but the pile's
right bound was0. This is an uninitialized/reset layout rectangle, not merely
an otherwise valid rectangle slightly outside the phone viewport.

Game object0x012855f4 had13 pile pointers at+0x6c; current spacing global
0x0100f164 was11. Do not make a production fix that suppresses this assertion
or clamps its invalid PatBlt: the pile geometry itself must be valid.

## Native sizing and the relayout gate

Startup `0x01001a8d` computes:

```
spacing = floor(cardWidth / 8) + 3 = 11
clientWidth = 7 * cardWidth + 8 * spacing = 585
clientHeight = 4 * cardHeight = 384
AdjustWindowRect(..., WS_OVERLAPPEDWINDOW, hasMenu=1)
CreateWindowExA(..., computed width/height)
```

Observed usual outer size593x431. The phone shell subsequently sends
SC_MAXIMIZE and gives it a400px-wide guest desktop, producing392px client.
Cards do not shrink; portrait columns are visibly lost (see mobile-game audit).

Solitaire's WM_SIZE arm starts0x01001e7e. It computes requested spacing
`trunc((signedClientWidth - 7*71)/8)` and minimum spacing11. If requested
spacing is below minimum AND stored spacing already equals11, it **skips**
the layout call. Otherwise it clamps spacing to minimum as needed, stores it,
and calls pile-layout routine0x01006d50 at0x01001f04.

Thus a392px client produces requested spacing-13, stored/minimum11, and
does not rebuild pile bounds. This is a concrete mechanism capable of leaving
the captured zero bounds intact. **The precise startup/reset ordering that
left those bounds zero is not yet proven.** Early auto-maximize versus initial
WM_SIZE is a hypothesis, not a measured race. No claim that saved window
preferences caused it has been established.

Constructor0x01006aa0 allocates the game and piles, initially passing zero
rectangles to0x01004e10. Besides WM_SIZE,0x010097ff calls layout after an
Options-triggered recreation. Inspect this ordering for a full repro.

The application's message dispatcher has no dedicated WM_GETMINMAXINFO0x24
case; it falls through to its default handling. Its initial requested width
is a useful fallback here, not a declared tracking constraint.

Fresh-profile Chrome probes (canonical and forced compat) at390/640px CSS
widths did not reproduce with stock clicks, command1000, a card drag, repeated
stock clicks and rotation. An8x CPU-throttled375px probe likewise did not
reproduce through its initial actions. These negative probes do not negate
the real phone stack above. Full Safari startup ordering remains to capture.

## Generic window-manager gap

The inspected resize/maximize paths do not negotiate WM_GETMINMAXINFO / use
MINMAXINFO tracking constraints. That deserves a generic implementation,
not a per-app maximum-size list. Tracking minima/maxima and maximized bounds
are distinct members/semantics. WM_WINDOWPOSCHANGING can also alter a proposed
window size.

Microsoft contract references:
[WM_GETMINMAXINFO](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-getminmaxinfo),
[MINMAXINFO](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-minmaxinfo),
[Window Features](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features).

For this Solitaire build, honoring the generic contract alone will not create
an app-specific minimum it never reports. Use a safe logical desktop/window
presentation policy (preserve meaningful requested size, scale presentation),
with measured per-app minimum-client fallback only when necessary. Keep the
layout-initialization assertion investigation distinct from visual clipping.

## Startup-size floor implementation (2026-09-10)

The single-app shell now captures the eligible unowned, non-popup main
window's size immediately before host auto-maximize. The page scales its
logical desktop uniformly to at least that size before sending SC_MAXIMIZE.
Rotation always recomputes from the physical viewport and the saved natural
size, not the previously expanded desktop. Dialogs, children, popup splashes
and fixed-size windows are not auto-maximized; exclusive fullscreen retains
its own presentation. Desktop/multi-app sizing is unchanged.

Verified locally on the SAB-unavailable browser path at375x844 CSS pixels:
Solitaire requests593x431; maximized client585x1289 on593x1335 backing.
Landscape844x390 gives933x431 backing and925x385 client; returning to
portrait restores593x1335 with the original593x431 floor unchanged.
All seven columns are visible. New-game commands and rotation produced no
assertion or page error in this check. This is not real iPhone verification
and does not prove the earlier zero-pile-bounds assertion fully resolved.

Coverage is in test/test-single-app-keep-aspect.js, alongside existing
single-app mode and touch controls tests. Generic WM_GETMINMAXINFO negotiation
remains a separate native window-manager gap; this change does not invent
tracking constraints or hardcode a Solitaire minimum. Games whose initial
request is itself too small still need investigation/configuration.
