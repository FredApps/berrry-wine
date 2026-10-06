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

Evidence: `scratch/runs/20261006T1720Z-anachronox_demo-menu-to-world`.

## Open: the opening dialogue never advances (parked 2026-10-06)

The opening scene in Fatima's room shows her line "Hi there." and stays on it.
Measured on two runs (one ctl session to 434k, one scripted to 440k):

- Batches in the scene are fast (~300 per few seconds); the ~0.75 s/batch
  seen on the first visit did not recur.
- The in-world cursor follows `relmousemove` (input reaches the game).
- Nothing advances the line: Space (bound to `selectforward` in
  `ANOXDATA\CONFIGS\default.cfg`), left clicks on the box and on Fatima, Enter,
  F1 (`fatstat goals`) -- over ~10k batches.

Ruled out, with how:

- **RSX 3D provider timer.** Its 11 ms `timeSetEvent` callback
  (`mssrsx+0x22d0cda0`) fires once because RSX itself calls
  `timeKillEvent(1)`: Miles opens each 3D provider, probes it and closes it.
  The callback returned normally (`--count` on its unlock landing).
- **A wedged Miles mixer.** The DirectSound mixer timer
  (mss32 `0x211136e0`, 10 ms, timer table at runtime `0x021325cc`) runs: a
  `--watch-log` on its `lock inc`/`lock dec` re-entrancy counter
  (`[0x2114f8cc]`, runtime `0x1e338cc`) shows ~23k clean 0->1->0 passes on
  thread T1 in 30k batches. Single memory dumps catch it at 1 because they land
  mid-pass -- do not read a dump of that counter as "stuck".

- **Silent audio.** Sound mixes: thread T1 makes ~314k
  `IDirectSoundBuffer_GetCurrentPosition` and ~119k `Lock` calls per 60k
  batches. An earlier "zero DirectSound calls in the scene" was a tracing hole,
  not a finding: a guest thread's COM calls were logged as `<ord>` (and dropped
  entirely under `--quiet-api`), so no `--trace-api=NAMES` filter matched them.
  Fixed in the same commit as this note; a trace run before it says nothing
  about guest threads.

Next lead: read how `ui.dll`'s dialogue code decides a line is finished
(`UI_StartTalk`, `ui_skipscene`, `A3SV_Playback_Skip`; scripted playback is
`A3SV_Playback_*` in `planet.dll`). `anoxsnd.dll` polls `AIL_sample_status` /
`AIL_sample_ms_position`, so a voice sample that plays but never reports done
is still possible.

## Named addresses

- `ui.dll` (base 0x10000000) `0x1000de20`: sweeps the 8192-entry widget table
  at `0x100e8f60` (then `0x10055de0`) freeing every entry owned by its
  argument; the hottest code on the Whitendon loading screen.
