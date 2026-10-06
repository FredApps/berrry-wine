# Daikatana (demo) -- PARKED

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
