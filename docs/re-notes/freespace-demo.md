# Descent: FreeSpace - The Great War (demo)

Volition / Interplay, 1998. Four-mission demo (training + campaign start).
Registered as `freespace_demo`.

## Fixture and install (headless)

- Source: `test/binaries/win98-games-a-d/Descent-Freespace-sdemo10-SW-Glide.exe`,
  a WinZip SFX around an InstallShield 5 Disk1 (16-bit `SETUP.EXE`).
- `7z x` it; run `SETUP.EXE` with `--vfs-include='*' --tick-ms-per-batch=5
  --capture-launch=cap` (at 200 ms/batch the 16-bit launcher's splash timer
  quits before `_INST32I.EX_` is expanded) -> `_ins0576._mp`.
- Run that from the capture (`--exe-guest-path`, `--vfs-tree=cap`, frozen
  `--control`), Next x4, step to "Setup Complete", with
  `--save-vfs-prefix='c:\games'`: 6 files + `data\`, 39 MB, in
  `C:\Games\FreeSpaceDemo`. Kept at `Descent-Freespace demo-SW/installed`;
  `node tools/gen-win98-games-a-d-manifests.js` writes its manifest.
- `fs.exe` is the game (DDRAW, DINPUT, MSACM32...); `freespace.exe` is the
  launcher/configurator.

## What it needed (2026-10-06)

1. **acmGetVersion** (bc86ea02): not an API before; the import trapped.
2. **Monotonic QueryPerformanceCounter** (64355808): its timer
   (`exe+0x438cf0`) resets its base whenever QPC goes backwards; ours could,
   across guest threads (per-instance sub-ms counter), so the frame limiter
   at `exe+0x411980` computed a negative elapsed time and slept 31.9M ms in
   flight. Now one process-wide count.

It warns "Could not properly initialize the Microsoft ADPCM codec" (no ACM
codecs are installed here) and offers to continue: `dlg-cmd:6` (Yes).

## Route (CLI, default clock)

`--input=60000:dlg-cmd:6`, then at ~200K batches type a callsign (VIPER)
and Enter -> main hall; click the ready-room door (380,310) -> Training
Mission 01 briefing; COMMIT (595,440) -> in flight. The directive "Target
Instructor - Press T": T targets the GTF Apollo instructor (target box,
target panel, directive cleared).

Evidence: `scratch/runs/20261006-freespace-demo-target`.

## Open

Audio (missing MS-ADPCM ACM codec), FPS, browser route.
