# Drakan: Order of the Flame demo (Surreal / Psygnosis 1999)

Registry id `drakan_demo`. Riot Engine, Direct3D 6 (DX6 HAL through D3DIM),
DirectInput keyboard and mouse, DirectSound. Fixture:
`test/binaries/win98-games-a-d/DrakanOrderOfTheFlameDemoD3D` (InstallShield 5
Disk1); the installed tree lives beside it in
`DrakanOrderOfTheFlameDemoD3D-installed/drakan demo` (65 MB).

## Install (headless)

The Driver recipe (docs/re-notes/driver-demo.md) unchanged:

1. `run.js --exe=.../SETUP.EXE --vfs-include='*' --tick-ms-per-batch=5
   --capture-launch=cap` -> `c:\windows\temp\_ins5176._mp`.
2. `run.js --exe=cap/windows/temp/_ins5176._mp
   --exe-guest-path='c:\windows\temp\_ins5176._mp' --vfs-tree=cap
   --tick-ms-per-batch=5 --control=PORT --frozen --save-vfs=inst
   --save-vfs-prefix='c:\program files'`: Next (410,394), Next, Next, Next,
   step ~550k batches of copying, untick README (238,202), Finish.

No emulator fixes were needed for the install or the game.

## Running it

- **Mount with `--vfs-tree`, not `--vfs-include`.** The engine builds every
  path from the directory of `drakan.exe`
  (`c:\program files\psygnosis\drakan demo\dragon.rrc`). `--vfs-include`
  mounts companions relative to `C:\`, so `dragon.rrc` fails to open and the
  game sits in its frame loop on a black screen forever -- a plain
  `PeekMessageA` loop with no rendering, which reads like an activation or
  D3D bug and is neither. The registered app gets the right paths from its
  manifest's `vfsPath`s.
- **First run opens "Riot Engine Options"** (a property sheet) and writes
  `HKLM\SOFTWARE\Surreal\Riot Engine\Settings100` (REG_BINARY, 84 bytes:
  primary display driver, 640x480x16, dithering, shadows, bilinear) on OK.
  The app's `startupRegistry` carries that value, so launches skip the sheet.
- A **"Drakan Beta Demo Warning"** message box comes up first every launch
  (`--input=40:dlg-cmd:1`).
- dragon.rfl is the game-logic DLL (base 0x10000000), loaded with LoadLibrary
  by the engine; dragon.rrc / music.rrc are the resource containers.
- Input is DirectInput: menus need `relmousemove` + `di-mousedown`/`di-mouseup`
  (window mouse messages do not move its cursor), and play uses
  `di-keydown`/`di-keyup` (37 Left turns, 38 Up flies forward).

Route (CLI, cooperative, default tick): Direct3D intro logos by ~30k-60k
batches, main menu by ~90k, New Game is `relmousemove:-6:-75` from the menu's
starting cursor, Normal is `relmousemove:-2:69` from there, level 1 (riding
Arokh in the rain, an enemy walks up) ~230k batches later.
Evidence: `scratch/runs/20261006T1600Z-drakan_demo-gameplay`.

## Named addresses (drakan.exe, base 0x400000)

- `0x410a97` main loop: PeekMessage keyboard range, mouse range, then any;
  calls the frame `0x4078b0` every pass.
- `0x4078b0` frame: `[0x476fd0]` is a state word (0 at WinMain init,
  `0x407bf0` sets it, shutdown `0x410cf0` clears it); with it 0 the frame only
  draws a resource image through `0x40f990` when `[[0x47b660]+4]` is set.
- `0x407bf0` set-state; `0x410cf0` shutdown (set-state 0, PostQuitMessage).
