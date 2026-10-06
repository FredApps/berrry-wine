# Dark Colony (magazine demo)

SSI/Gametek's May 1997 magazine demo v0.2 in
`test/binaries/win98-games-a-d/DarkColony-MagDemo-SW/`: `dc.exe` runs unpacked
from that directory with ~970 data files (ANIMATE/, AVI/, INTRO/, map sets).
Registry id `dark_colony_demo` (localhost-only), manifest written by
`tools/gen-win98-games-a-d-manifests.js`. `README.TXT` lists the controls.

Imports GDI32, USER32, KERNEL32, DINPUT, DSOUND, WINMM, DDRAW, WSOCK32,
AVIFIL32, MSVFW32, DPLAYX. DirectDraw 640x480x8 exclusive. No emulator change
was needed to reach play.

The exe is truncated: the last section declares raw data past EOF.
`tools/xrefs.js` crashed on it until it clamped its scan to the file length.

## Route (headless, `--batch-size=20000`, default 200 ms/batch clock)

The menus are software-drawn and slow: at the default 1000-block batch one
menu frame is ~250 batches. Use `--batch-size=20000`. Every screen assembles
itself with an animation first and ignores clicks until it is done, so the
gaps below are not slack.

| batch | action / screen |
|---|---|
| 1500, 2500 | Esc, Esc: skip the intro video |
| ~3000 | main menu (DC logo flies in, credits type out) |
| 9000 | relmousemove 213,325; di-mousedown/up: NEW CAMPAIGN |
| ~29000 | campaign setup, Human vs Grey ("Type in a name for your leader") |
| 30000 | relmousemove +275,+36; click: START CAMPAIGN (empty name is fine) |
| ~44000 | briefing "Secret of Terra Tyrren" |
| 45000 / 60000 | relmousemove +10,+97, click at 60000: TO BATTLE |
| ~61500 | Mars map, human base, "Good luck lieutenant!" |
| 63000 | relmousemove +48,-286; click: select Trooper ($350) in the sidebar |
| 66000 | `keydown:32` (Space = build): a Trooper walks out of the base ramp |
| 72000-74000 | `keydown:39` held: map scrolls right, a Grey warrior comes into view |

Left idle the mission is lost by about batch 100000 (Defeat debriefing).

Evidence: `scratch/runs/20261006T014500Z-dark-colony-demo-build-scroll/`.

## Input

- The mouse is DirectInput **relative**: `GetDeviceState` on the mouse each
  frame. `0x43bd90` adds lX/lY into `0x4f8e80/84`, clamps to 639x479 and
  publishes the cursor at `0x4b4434/38`. Button 0 drives the press/release
  call at `0x43bf49`. The cursor starts at **(0,0)**, not the centre, and the
  menus draw no cursor. So drive it with `relmousemove` deltas measured from
  (0,0), plus `di-mousedown`/`di-mouseup`. An absolute `mousedown` does nothing.
- A leftward `relmousemove` from the host's initial (0,0) point is dropped in
  `renderer-input.js` (`handleMouseMove` returns when the absolute point maps
  outside the canvas, before queuing the DI delta). Harmless here, because the
  game clamps at 0 too, but it bites any game whose own cursor does not start
  at the host's.
- Keys: the pump at `0x4214ec` peeks only WM_KEYFIRST..WM_KEYLAST, and
  `0x421e2c` acts on WM_KEYDOWN/WM_KEYUP and ignores WM_CHAR. Space builds,
  arrows scroll, F2.. select unit classes (see README.TXT).

## Open / not investigated

- The sidebar BUILD button shows "Push to build" on hover but a click built
  nothing in three tries; Space works.
- Typing a leader name showed no text, and only the first WM_KEYDOWN was
  seen at `check_input`. The name is optional, so the route skips it.
- Audio, FPS, browser not evaluated.
