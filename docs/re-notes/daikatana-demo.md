# Daikatana (demo)

Ion Storm / Eidos, 2000, Quake II engine. Fixture:
`test/binaries/win98-games-a-d/Daikatana-demo-OpenGL-SW.exe`, a WinZip SFX
around an InstallShield 5 Disk1 (107 MB).

## Install (works, headless)

`unzip` the SFX; 16-bit IS5 `Setup.exe` with `--vfs-include='*'
--tick-ms-per-batch=5 --capture-launch=cap` -> `_ins5576._mp`; run it from the
capture (frozen `--control`): Next x4, "Confirm New Folder" Yes, Next, step to
"Setup Complete". `C:\Program Files\Eidos Interactive\Daikatana Demo` (456
files, 127 MB) is kept at `Daikatana demo-SW/installed`. Only `ref_gl.dll`
ships (no ref_soft), so the CLI needs `--gl-renderer=software`; the game,
physics, weapons and world DLLs load from `dlls\`.

Registry entry used for the runs (not committed, it is not playable yet):
exe `daikatana.exe`, dlls `[mss32.dll]`, workingDirectory/exeGuestPath under
the install dir, manifest generator entry with that vfsRoot.

## Where it stops

Boots to the main menu (Single Player -> Select Difficulty is already shown,
renders correctly in software GL). Choosing a difficulty, or starting with
`+map e1m1a`, shows the dark-red loading plaque forever. `+set logfile 2`
writes `data/dk_console.log`: sound and renderer init fine, server
initializes, the map loads ("Registration time"), then "Starting Music" is
the last line, also with `+set s_music 0`. The frame loop keeps running
(8 frames of 2D quads + wglSwapBuffers per 200 batches; polls `./kick.dat`),
nothing else is read from pak1.pak. Next: what follows S_StartMusic /
CL begin (spawn handshake over the in-process loopback?) -- break after the
"Starting Music" print and follow the client state.

Status 2026-10-06: parked (claude:d10ba697); TODOS NEW-GAME-DAIKATANA-DEMO-20261006.

## Un-parked: in-world (claude:202b4b39, 2026-10-06)

Two causes, neither in the music code the console log pointed at:

- **The DLL table was 32 slots.** Miles (`mss32.dll`) enumerates and
  `LoadLibrary`s ~30 providers from the install directory (`*.flt`, `*.m3d`,
  `mp3dec.asi`) at sound init, so the game's own `dlls\physics.dll` was the
  33rd and failed ("DLL table capacity 32 exhausted"). Fixed on main 4cf9420e
  (64 slots). Without it, `+map` falls back to the Select Difficulty menu.
- **The headless clock.** At the default 200 ms/batch, registration takes
  ~3495 guest seconds ("Registration time" in `dk_console.log`) and the level
  stays on its loading plaque. `--tick-ms-per-batch=5` reaches the level
  (registration ~107 guest s). The console log simply stops being flushed
  after "Starting Music"; it is not where the game stops.
- Route: `node test/run.js --app=daikatana_demo --gl-renderer=software
  --tick-ms-per-batch=5 --args='+map e1m1a' --max-batches=112000` is in the
  e1m1a swamp by ~95,000 batches; holding VK_UP walks forward and picks up a
  weapon (scratch/runs/20261006T1830Z-daikatana-demo-gameplay).
- `--save-vfs=DIR --save-vfs-suffix=.log` exports `data/dk_console.log`;
  `+set logfile 2` writes it.
- Main is busy in `physics.dll` and in an exe name-list walk (`0x45ed52`,
  a strcmp over a linked list) once in-world: ~20M API calls per 112k
  batches. FPS and the browser are separate.
