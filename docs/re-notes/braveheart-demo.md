# Braveheart demo (Red Lemon Studios / Eidos 1999)

Registry id `braveheart_demo`. Real-time tactics over a 3D battlefield. The
"Covermount Demo" ships three renderers side by side: `brave.exe` (Glide),
`bhd3d.exe` (Direct3D) and `bhsoft.exe` (software, into DirectDraw). The
registry entry runs `bhsoft.exe`. Fixture:
`test/binaries/win98-games-a-d/braveheart-demo-Glide` (InstallShield 5
Disk1); the installed tree lives beside it in
`braveheart-demo-Glide-installed/braveheart covermount demo` (199 MB,
`dad.io` is 133 MB of it).

## Install (headless)

The Drakan/Driver recipe (docs/re-notes/drakan-demo.md) unchanged:
`SETUP.EXE --vfs-include='*' --tick-ms-per-batch=5 --capture-launch=cap`,
then `cap/windows/temp/_istmp1.dir/_ins5576._mp` with `--vfs-tree=cap
--tick-ms-per-batch=5 --control=PORT --frozen --save-vfs=inst
--save-vfs-prefix='c:\program files'`: Next (413,394) on Welcome,
Destination and Program Folder, ~1.2M batches of copying (about 3 minutes),
Finish. Target: `C:\Program Files\Red Lemon Studios\Braveheart Covermount
Demo`. No emulator fixes were needed for the install or the game.

## Running it

- `winplay.dll` (the movie player: `Player_InitMovie` ...) and its chain
  `winstr.dll` -> `dec130.dll`/`edec.dll`/`winsdec.dll`, plus `mss32.dll`,
  must load as real PEs (the entry's `dlls:`). Without them the first movie
  call crashes as an unimplemented API.
- Intro movies (Eidos logo, then the game's) are interlaced by design; Esc
  skips each one. Window `keydown:27` is enough.
- Mission Brief: "Take the Field" at (535,450) needs a real press
  (mousedown, a few hundred batches, mouseup); ctl `click` is too quick.
- In battle the cursor is DirectInput: `relmousemove:DX:DY`, then
  `di-mousedown:1`/`di-mouseup:1` selects a unit (portrait + order bar +
  health bar), button 2 moves the camera. The cursor redraws only when a
  frame completes, so give each input a frame (several thousand batches)
  before reading the screen.

## Headless clock spiral (read before calling the battle frozen)

At the default `--tick-ms-per-batch=200` the battle freezes on one frame for
good. It is not a hang: the sim is a fixed 16 ms tick fed by a sliding window
of the last eight frame deltas, and every frame costs more guest time than it
simulates, so the window only grows.

- `0x504be0` returns milliseconds (CRT time: seconds*1000 + ms).
- `0x4916e8` shifts the eight-entry delta ring at `0xc5aef8`, stores the new
  delta, and writes `sum >> 7` (i.e. average/16 ms) to `[0xc5aef4]`, the
  step count.
- `0x491776..0x4917b1` runs `[0xc5aef4]` steps over the 250 objects at
  `0xc526dc` (stride 0x50).

Measured with `--input`/ctl `dump-mem:0xc5aef4:4`: 180,176 steps per frame at
200 ms/batch; at 5 ms/batch it starts at 551 and creeps up (~1,650 after
100k batches, still diverging slowly); dropping to 1 ms/batch (ctl POST
`{"action":"tick","ms":1}`) converges to under 200 within ~30k batches. So
run the battle at `--tick-ms-per-batch=1` (or 5 to reach it faster, then 1).
In a browser real time is the clock and one step costs far under 16 ms, so
the window should converge there; that has not been checked in a browser.

Route (CLI): `--tick-ms-per-batch=5`, Esc every 40k batches x6 -> Mission
Brief by ~160k; Take the Field; battle frames from ~390k.
Evidence: `scratch/runs/20261006T1640Z-braveheart_demo-gameplay`.
