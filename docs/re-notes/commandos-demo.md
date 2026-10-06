# Commandos: Behind Enemy Lines (demo)

Pyro Studios / Eidos, 1998. Playable demo with two missions (Baptism of
Fire, Reverse Engineering). Registered as `commandos_demo`.

## Fixture

- Source: `test/binaries/win98-games-a-d/commandos-demo-SWonly.exe`, a WinZip
  self-extractor whose payload is the installed game (it carries
  InstallShield's `DeIsL1.isu`), so it is unzipped as is:
  `unzip -q commandos-demo-SWonly.exe -d 'Commandos demo-SWonly/installed'`
  (32 files, 41 MB), then `node tools/gen-win98-games-a-d-manifests.js`.
- `Comandos.exe` (Spanish spelling) imports KERNEL32, USER32, GDI32, ADVAPI32,
  SHELL32, ole32, DDRAW, WINMM, mss32 (Miles, shipped as `MSS32.DLL`) and
  WSOCK32. Data: `wargame.dir`, `DATOS\`, `OUTPUT\*.CFG`, `VIDEO\*.avi`.
- Software DirectDraw, 640x480x16 (dx slot 5 in `--png` captures).

## Route (headless, worked first time with no emulator change, 2026-10-06)

Batch numbers at the default `--batch-size`, `--quiet-api`:

| batch | input | screen |
|---|---|---|
| ~0-300K | - | "Welcome to the playable demo" |
| 300K | keydown/keyup VK_RETURN | main menu |
| 460K | mousedown/up 315,162 | New Game submenu |
| 570K | mousedown/up 275,200 | Mission 1 "Baptism of Fire" briefing (voice-over) |
| 700K | keydown/keyup VK_ESCAPE | in mission: intro camera pan, then the map |
| 880K+ | mousedown/up 30,20 (first portrait) | Green Beret selected, camera centres on him, inventory panel |
|  | mousedown/up 250,400 (ground) | he walks there, footprints in the snow, patrols move |

Escape inside the mission opens the in-game menu (do not press it twice).
A ground click at 320,330 right under the tree canopy did nothing visible;
pick open snow. Use `run.js --control --frozen` + `tools/ctl.js` beyond the
briefing: one 880K-batch scripted run takes ~80 s of wall clock.

Evidence: `scratch/runs/20261006-commandos-demo-move`.

## Audio (CLI, data level)

Two DirectSound users, and the first one is a trap when measuring:

- MSS32 (Miles) opens DirectSound in write-primary mode: `CreateSoundBuffer`
  with `DSBCAPS_PRIMARYBUFFER` (flags 0x1), 22050 Hz stereo 16-bit, Play
  looping. Its ring stays all zeros through menu and briefing; dumping it
  says nothing about whether the game has sound. Its service thread
  (`mss32+0x12b0`) is a `WaitForSingleObject(event, 5)` loop that services
  timers on each WAIT_TIMEOUT; it runs (~73K passes in 300K batches).
- The game itself (`exe+0x44a332` Lock, `exe+0x449e00` Play) streams
  `DATOS\BRIEFING\WAVE\MUS_BR01.wav` (11025 Hz mono 8-bit) into a 32 KB
  looping secondary buffer (flags 0x180e0), refilled from guest thread tid 3
  (`ReadFile` 4 KB chunks). Two more 11025 Hz voices carry the voice-over.

A guest thread's API calls only reach the log with `--trace-api=NAMES`
(`[API T1]` lines); `--trace-api` without names prints none of them, so a
census from the default log undercounts every streaming mixer.

Measured 2026-10-06: `--trace-host=voice_play_ring` shows the music voice
refreshed 75,849 times by batch 760K; a dump of its ring at 750K has peak
1.0 and 91% non-silent samples. Real browser output, FPS and the browser
route are not yet checked.
