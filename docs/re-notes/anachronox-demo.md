# Anachronox demo (Ion Storm / Eidos 2001)

Registry id `anachronox_demo`. Role-playing game on a heavily extended
Quake II engine: `anox.exe` + `gamex86.dll` + `anoxgfx.dll`, renderer
`ref_gl.dll` (OpenGL only -- there is no ref_soft), Miles audio (`mss32.dll`
plus every `.m3d` provider in `ANOXDATA\MILES`), and game logic in
`ANOXDATA\PLUGINS\*.dll` (loaded in `dllorder.txt` order; `ui.dll` is a debug
build). Fixture: `test/binaries/win98-games-a-d/Anachronox-Demo-SW-OpenGL`
(InstallShield 6 cabinets); the unpacked tree is
`Anachronox-Demo-SW-OpenGL-installed/anoxdemo` (the setup's default
`C:\AnoxDemo`, 99 MB).

## Install

InstallShield 6 runs its engine (`ikernel.exe`) as an out-of-process COM
server, which the emulator does not provide ("Setup failed to launch
installation engine"). The cabinets were unpacked instead:
`node tools/is-cab.js <fixture> --extract=OUT` (114 files, every one
MD5-verified). The installer's own support files (`ctor.dll`, `objectps.dll`,
`iuser.dll`, `iscript.dll`, `isrt.dll`, `_IsRes.dll`, `setup.*`,
`value.shl`, `default.pal`, `corecomp.ini`) were left out. The setup would
also write `HKLM\SOFTWARE\Eidos Interactive\Anachronox Demo`; the game runs
without it.

## Running it

- Working directory must be `c:\anoxdemo`: the engine opens
  `anoxdata\*.dat` relative to it (with `C:\` every pack fails to open).
- `anoxgfx.dll`, `gamex86.dll` and `MSVCRT.DLL` load as real PEs (the
  entry's `dlls:`); without them `_PH_Get_Argc_Argv@12` falls to a stub.
- Args are `anox_640gl.bat`'s (fullscreen 640x480 GL). The windowed
  `anox_window.bat` args give a 646x507 framed window that a 640x480 capture
  crops.
- **Headless needs `--gl-renderer=software`.** Without a GL context
  (`--headless-gl` with no native deps) `wglCreateContext` fails and the game
  says "Couldn't load renderer!".
- GL entry points it needed beyond the measured set: `glColor3ub` (GL op
  111, HUD/font colours).
- Mouse is a pointer-lock/`GetCursorPos`+`SetCursorPos` centring loop (no
  DirectInput): drive menus with `relmousemove:DX:DY` (1:1 pixels; the cursor
  starts at about (10,0)); `mousedown:X:Y`/`mouseup` at the cursor's position
  clicks. Esc skips the title logo.

Route (CLI, default tick): "One Moment" -> 3D title logo -> Esc at ~205k
batches -> main menu; New Universe at (265,140) -> "Democratus: Town of
Whitendon" loading screen for ~150k batches -> the opening scene in Fatima's
room with her dialogue "Hi there." (~437k). Batches cost ~0.75 s each in the
world (software GL at 640x480 plus the debug-build UI), against ~1 ms in the
menu.

Open: the opening dialogue did not advance on a left click or Enter within
~200 batches, and the in-world cursor did not follow `relmousemove` -- either
the scene is scripted and ignores input, or input needs more frames than were
given. Evidence: `scratch/runs/20261006T1720Z-anachronox_demo-menu-to-world`.

## Named addresses

- `ui.dll` (base 0x10000000) `0x1000de20`: sweeps the 8192-entry widget table
  at `0x100e8f60` (then `0x10055de0`) freeing every entry owned by its
  argument; the hottest code on the Whitendon loading screen.
