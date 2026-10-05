# Marbles (`MARBLES.EXE`)

App id `marbles`. `test/binaries/plus98/MARBLES.EXE`, the marble-solitaire game
from Microsoft Plus! 98. `imageBase=0x400000`, entry `0x00434ff0`, no DLLs of
its own — everything below is both an original and a runtime VA.

One window, created `640x480` at `0,0` with style `0x90080000`
(`WS_POPUP|WS_VISIBLE|WS_SYSMENU` — **no caption, no close box**), wndproc
`0x00401352`. It drives a DirectDraw exclusive-fullscreen primary and flips;
the browser therefore puts the page into `exclusive-fullscreen` and, on a
browser with no element Fullscreen API (iOS Safari), `page-fullscreen` as well.

## Reaching each screen headlessly

```
node test/run.js --app=marbles --quiet-api --no-close \
  --max-seconds=60 --max-batches=999999 --input='600:png:/tmp/menu.png'
```

At ~batch 600 (default `--tick-ms-per-batch=200`) the attract sequence has
finished and the **SELECT A MODE** panel is up. Item centres, in guest pixels
at the native 640x480:

| item | centre |
|---|---|
| practice | 250,166 |
| one player | 410,165 |
| OPTIONS | 330,232 |
| HELP | 325,284 |
| PLAY | 247,336 |
| QUIT | **422,336** |

`PLAY` is highlighted (pink) on entry and the little marble character standing
beside it **is the game's own pointer**, not decoration.

## API profile

`--trace-api` over the first 25 s: 5059 `IDirectDrawSurface_BltFast`, 603
`Flip`, 1802 `timeGetTime`, 827 `GetTickCount`, 597 `PeekMessageA`, 584
`Sleep`. Imports `DDRAW`, `DSOUND` (ordinal 1), `DINPUT`, and a large `WINMM`
set (`midiStream*`, `mmio*`, `joyGetPos`, `joySetCapture`). USER32 imports
contain **no `GetCursorPos`/`SetCursorPos`** — worth knowing before assuming
the Win32 cursor is involved in anything.

## How the pointer actually moves (the important one)

Marbles keeps its own cursor and moves it **only** from DirectInput relative
mouse deltas:

```
DirectInputCreateA(0x400000, 0x0300, ...)          ; DX3
IDirectInput_CreateDevice(...)  -> keyboard  (format dwDataSize=0x100, 256 objs)
IDirectInput_CreateDevice(...)  -> mouse     (format dwDataSize=0x10,  7 objs)
IDirectInputDevice_SetCooperativeLevel(dev, hwnd, 0x06)   ; NONEXCLUSIVE|FOREGROUND
IDirectInputDevice_SetDataFormat(dev, 0x00432350)         ; dwFlags=2 = DIDF_RELAXIS
IDirectInputDevice_Acquire(dev)
```

`GetDeviceState(dev, 0x10, buf)` — a `DIMOUSESTATE` — is called **exactly once
per `WM_MOUSEMOVE`** and nowhere else (`grep -c IDirectInputDevice_GetDeviceState`
equals the number of moves injected). The `WM_MOUSEMOVE`'s own `lParam` is
ignored: injecting a move onto `QUIT` at `422,336` leaves `PLAY` highlighted and
the marble character where it was. A click activates whatever the *internal*
pointer is over, wherever the Win32 cursor happens to be.

Reproduction of that, and of the bug it caused (see below):

```
node test/run.js --app=marbles --quiet-api --no-close --max-seconds=65 \
  --max-batches=999999 \
  --input='600:mousemove:100:240,610:mousemove:320:240,625:png:/tmp/h0.png,\
640:mousedown:320:240,660:mouseup:320:240'
```

`h0.png` shows the character walked +220px to the right — onto `QUIT`, which is
now highlighted — and the click prints `[Exit] code=0`. Note the click was at
`320,240` (over `OPTIONS`) and the game quit.

## Bug found and fixed: "clicking in Marbles just quits" (2026-09-13)

User report, on an iPhone in single-app mode. Cause was host-side, not guest:

`lib/renderer-input.js` `handleMouseMove` synthesises the DirectInput relative
delta from the difference between successive **absolute** pointer positions.
That is right for a mouse and wrong for a finger — each tap arrives as one jump
from wherever the previous tap was, and nothing physically moved across the gap.
Marbles believes it, so a few taps walked its pointer off the finger, it
saturated at the bottom-right of the mode menu — `QUIT` — and every later tap
anywhere on the screen called `ExitProcess`.

Fix: `handleMouseMove(x, y, { teleport: true })` reseats the DirectInput
reference point and emits no delta, and `lib/browser-input.js` publishes tap
positions that way (touchstart, and the pre-click publish at touchend).
Regression test `test/test-touch-teleport-di-delta.js` (and two static asserts
in `test/test-web-touch-input.js`).

Second half of the fix: `mobileTouch: 'trackpad'` on the `marbles` entry in
`lib/apps.js`. With absolute taps the game is not merely quit-prone, it is
**unaimable** — an absolute position reaches its pointer through no channel at
all. Trackpad mode makes a drag send honest relative motion and a tap click the
guest's virtual cursor, which is the only touch model this game can be played
in.

Verified after the fix with the new `tap:` step of `tools/web-input-probe.js`
(a real touchscreen tap; `click:` drives `page.mouse` and never reaches the
touch bridge):

```
node tools/web-input-probe.js --app=marbles --viewport=844x390@3 --touch \
  --no-fullscreen-api --query='?single-app=1' \
  --steps='wait:22000;tap:500,400;wait:1200;tap:120,120;…;shot:/tmp/tap1.png'
```

Eight taps scattered across the screen: the app stays up and reaches gameplay.

## Ruled out

- **The page's close chip.** `#page-fullscreen-exit` calls `stopAllApps()` in
  single-app mode and has a 46px hit target, so it was the obvious suspect. It
  is at the top-right of the *page*; at 844x390 the guest picture is
  pillarboxed to page x 163..681 and the chip sits at 802..848, over black.
  Not over the picture, in either orientation.
- **An unimplemented API / WASM trap.** There is none on this path; the exit is
  a guest-initiated `ExitProcess` and the log says `[Exit] code=0`.
- **Coordinate mapping.** `--trace-input` plus the `[check_input] lParam=` line
  shows the injected point arriving exactly (`125,150` → `lParam=0x96007d`),
  letterboxed presentation included. The Win32 side was never wrong; the game
  just does not read it.
- **A click landing on the guest's own `QUIT` by mis-aim.** The guest hit-tests
  its internal pointer, not the click position, so where the finger lands is
  irrelevant — which is why the failure reads as "it quits *whatever* I tap".
