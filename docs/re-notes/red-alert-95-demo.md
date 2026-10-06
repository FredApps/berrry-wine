# Command & Conquer: Red Alert (Win95 demo)

Westwood's 1997 demo CD in `test/binaries/win98-games-a-d/CnC-Red Alert Demo-SW/`.
The CD's `INSTALL\` directory is the game itself: `RA95.EXE` (v1.19 demo) runs
straight from it, with `MAIN.MIX`, `REDALERT.MIX`, `REDALERT.INI`, `RESLIB.DLL`
and the `THIPX16/32.DLL` IPX thunk pair beside it. No installer run needed.
Registry id `red_alert_95_demo` (localhost-only), manifest written by
`tools/gen-win98-games-a-d-manifests.js`.

## Route (headless, default 200 ms/batch clock)

All mouse coordinates are host canvas coordinates. The game runs a 640x400
mode that we letterbox 40 px down inside 640x480, but `GetCursorPos` is not
letterbox-corrected. **A host point (x, y) lands at game (x, y)**, so to hit
something the screen shows at (x, y+40), click (x, y).

| batch | action / screen |
|---|---|
| ~96 | `timeSetEvent(16ms periodic)` + `Sleep(1000)` timer self-check (see below) |
| ~100000 | main menu: Start New Game / Exit Game |
| 120000 | click (321,183): Start New Game, then the difficulty slider |
| 170000 | click (500,253): OK, then "Choose your side" |
| 200000 | click (260,228): Allies, then the mission briefing |
| 640000 | click (318,271): OK, then the first Allied mission (snow map, squad + MCV) |
| 900000+ | click a unit, click ground: it drives there |

Use end-of-run `--png-canvas --png=` captures. Mid-run `B:png:` captures came
back black on this 640x400 mode, which is a capture-path gap, not the game.

## Emulator gaps fixed

- **THIPX32 `_IPX_Initialise`.** THIPX32 is a flat thunk to THIPX16 and the
  real-mode IPX driver. Our `ThunkConnect32` reports success without
  connecting, so loading the real DLL jumps into its unfilled thunk table.
  `_IPX_Initialise` (cdecl, no args) is a constant-FALSE stub row in
  `api_table.json`, the answer of a box without IPX installed. The other
  `_IPX_*` exports stay unimplemented: they are only reached after a
  successful initialise.
- **Main-thread Sleep between thread slices** (`lib/thread-manager.js`
  `noteMainSleep`). At `0x553ad0` the game starts a 16 ms periodic
  `timeSetEvent`, Sleeps 1000 ms and compares a tick counter (`0x6525bc`); an
  unchanged counter is "There has been a timer initialization error". The CLI
  re-ran main between cooperative slices before recording the Sleep deadline,
  so the Sleep returned before the new winmm timer thread had run once.

## Open

- `GetCursorPos`/mouse input not letterbox-corrected (see Route).
- Audio, FPS, browser not evaluated.

Evidence: `scratch/runs/20261006T005200Z-red-alert-95-demo-claude202b4b39-mission1`.
