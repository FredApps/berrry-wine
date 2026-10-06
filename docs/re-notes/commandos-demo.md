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

## Open

Audio (Miles mss32 over waveOut/DirectSound), FPS and the browser route are
not yet checked. `--trace-api` would be large: ~10K API calls per 1K batches
in the mission.
