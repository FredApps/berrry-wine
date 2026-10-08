# Dark Earth (demo)

Kalisto / MicroProse, 1997. Registered as `dark_earth_demo`.

## Fixture and install (headless)

- `test/binaries/win98-games-a-d/Dark_Earth_demo-NeedMountedCD-SW`: a
  MODE1/2048 BIN + cue of the demo CD (label DARKEARTH). The cue names the
  image in upper case; `dark-earth.cue` beside it matches the file and is
  what the registry entry mounts.
- `run.js --iso=<bin> --iso-exe='DKEDEMO\SETUP.EXE' --tick-ms-per-batch=5
  --capture-launch=cap`: the 16-bit InstallShield 3 launcher WinExecs
  `_ins0432._mp -fD:\DKEDEMO\SETUP.INS -z1 -cx -xC:\WINDOWS\TEMP\`. Keep only
  the captured `windows/temp` (the capture also copies the whole CD).
- Run the engine with `--iso=<bin>` still mounted, `--exe-guest-path`,
  `--vfs-tree=<temp tree>`, `--args=...`, `--cwd=D:\DKEDEMO`, frozen
  `--control`; Next x3, step to "Setup is complete". `C:\DARKDEMO`
  (dkedemo.exe + per-level DLLs, 778 files, 26 MB) is kept at `installed/`.
  The game data stays on the CD: without D: it stops with "Fatal error 4".

## What it needed (2026-10-06)

- `ValidateRgn` (54b72963): not an API before.

## Route

Boot shows the controls page; it waits on a WM_CHAR key queue
(`exe+0x4862a0` fills it from the wndproc's WM_CHAR case,
`exe+0x47cd30` waits on it), so on the CLI use `keypress` (keydown alone is
not translated to WM_CHAR here: the host sends WM_CHAR itself, as the
browser's keypress does). Space -> monitor settings; Enter -> main menu;
click NEW (150,62) -> Arkhan in his room; hold Up -> he walks out to the
domed hall (fixed-camera cut). Evidence: `scratch/runs/20261006-dark-earth-demo-walk`.

## Open

Audio, FPS, browser route.
