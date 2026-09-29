# Civilization II: Multiplayer Gold Edition (Win32 retail)

Registry id `civ2_mge`, tree `test/binaries/candidates/civilization-2-mge-win32/`
(gitignored): `cd/` is the disc, `installed/` the game install.

## Movies are Indeo 4, and Indeo is a separate install

The advisor, wonder and council movies are `cd/Civ2/VIDEO/*.AVI`, all
`IV41` (Indeo 4). Civ2 MGE reaches them through AVIFIL32 +
`ICLocate`/`ICDecompress` and `MCIWndCreateA`. It bundles no decoder: the disc
has Intel's installer under `cd/Win_95nt Indeo/IVI_95NT.EXE`, which puts
`ir41_32.dll` (plus `ir41_qc.dll`, `ir41_qcx.dll`, `ir32_32.dll`,
`iyvu9_32.dll`) in `c:\windows\system` and registers them in SYSTEM.INI:

```
[drivers32]
VIDC.IV41=ir41_32.dll
VIDC.IV32=ir32_32.dll
VIDC.IV31=ir32_32.dll
VIDC.YVU9=iyvu9_32.dll
```

Without that install, `ICLocate` returns 0 and the game skips the movie, just
as Windows does on a machine without Indeo. With it, the emulator loads the
driver and runs its DriverProc as guest x86 (see "Installable codec drivers" in
`docs/video-support-design.md`). Intel's DLLs are never committed. Take them
from the disc by running the installer.

Watch out: the installed files differ in size. `ir41_32.dll` is **739,328**
bytes and `ir32_32.dll` is 199,168. Swap them and `VIDC.IV41` loads the Indeo 3
driver, which opens, accepts the stream and then decodes black frames. Nothing
crashes. Check the size first.

## Headless Indeo install (2026-09-28)

`S` = a scratch directory. Three stages, each an ordinary `test/run.js` run.

1. **Self-extractor.** `IVI_95NT.EXE` unpacks an InstallShield 3 setup into
   `c:\windows\temp`:

   ```
   node test/run.js --exe="test/binaries/candidates/civilization-2-mge-win32/cd/Win_95nt Indeo/IVI_95NT.EXE" \
     --overlay-dir=$S/ivi-ov --screen=800x600 --no-build --quiet-api --no-close \
     --max-batches=3000 --max-seconds=90
   ```

   Copy the overlay's files out under their real names (`setup.exe`,
   `setup.ins`, `setup.pkg`, `_setup.lib`, `data.z`, `_inst32i.ex_`, …) into
   `$S/ivi-tmp` (the overlay format is `index.json` + `blobs/`).
2. **setup.exe -sms.** It unpacks the real engine and ShellExecutes it. Capture
   that launch:

   ```
   node test/run.js --exe=$S/ivi-tmp/setup.exe --args=-sms --vfs-include='*' \
     --capture-launch=$S/ivi-cap --screen=800x600 --no-build --quiet-api --no-close \
     --batch-size=100000 --max-batches=3000
   ```

   `$S/ivi-cap` then holds the VFS tree, including
   `windows/temp/_ins0432._mp`, the 32-bit IS3 engine.
3. **The engine**, with the arguments setup passed it, clicking Next through
   the wizard:

   ```
   node test/run.js --exe=$S/ivi-cap/windows/temp/_ins0432._mp --vfs-tree=$S/ivi-cap \
     '--args=-sms -fC:\SETUP.INS  -z1 -cx -xC:\WINDOWS\TEMP\' '--cwd=C:\' \
     --overlay-dir=$S/ivi-ov-s3 --screen=800x600 --no-build --no-close --max-seconds=100 \
     --input=1400:dlg-cmd:1,1700:mousedown:493:454,1705:mouseup:493:454,2100:mousedown:493:454,2105:mouseup:493:454,2500:mousedown:396:337,2505:mouseup:396:337,2900:mousedown:493:454,2905:mouseup:493:454,3300:mousedown:493:454,3305:mouseup:493:454,3700:mousedown:493:454,3705:mouseup:493:454,4100:mousedown:493:454,4105:mouseup:493:454,4500:mousedown:493:454,4505:mouseup:493:454
   ```

   (493,454 is Next/Finish on an 800x600 screen. 396,337 is the licence
   "Yes".) `$S/ivi-ov-s3` ends up holding the five DLLs, `indeo.hlp`, the new
   SYSTEM.INI and `uninst.exe`. That overlay, or just SYSTEM.INI plus
   `ir41_32.dll`, is the Indeo machine.

**Registry quirk.** The IS script writes its ICM registration to
**HKCR**`\System\CurrentControlSet\control\MediaResources\icm\vidc.IV41`. The
guest really passes `hKey = 0x80000000`, so that is the script's own doing
and not an emulator bug. It means no Windows finds the codec through the
registry, and SYSTEM.INI `[drivers32]` is the lookup that matters on Win9x.

## Proving the decode without Civ2's own route

The simplest player that exercises the path is Half-Life: Uplink's intro, which
plays `media\intro.avi` with MCI `play sierravideo wait` into a 320x240 window
at (160,120) of 640x480. Give it Civ2's `ANARCHY0.AVI` (480x120, 15 fps,
111 frames) as `c:\media\intro.avi` in the overlay:

- `test/test-icm-indeo4-candidate.js` builds that overlay at run time from
  `INDEO_IR41_DLL` or `test/binaries/candidates/civilization-2-mge-win32/indeo/ir41_32.dll`,
  and SKIPs if either is missing.
- `--tick-ms-per-batch=20`, capture at batch 900: the stop/close come back 0.
  The best-matching ffmpeg `indeo4` frame (56), point-sampled the way
  StretchDIBits scales, is **99.98% within 24, max delta 27**, and 94.4% within
  8. The rest is YUV→RGB rounding. About 6 s wall.

Getting there took two emulator fixes (details in the design doc):
- ROL/ROR set ZF/SF. Indeo's generated VLC reader loops on `ror eax,0x10 / jz`.
- `$current_thunk_eip` was not restored after a nested DriverProc, which made
  the parked `play wait` land at address 0.

ir41_32 also calls `LocalHandle` as the stream ends.

## The game's own movies (2026-09-28)

`--app=civ2_mge` plays `opening.avi` with nothing extra: no overlay and no
`--media-mount`. `test/test-civ2-mge-movie.js` pins this. The same route works
in the browser with the guest in a Worker. It took three fixes:

- **The CD's data track.** The registered CUE is mixed-mode, and the movies
  live on its data track (`D:\civ2\video`). Registry `cdAudio` mounts used to
  mount only the audio tracks. Now both hosts mount a data track as the ISO it
  is: test/run.js through `openParts`, and lib/browser-shell.js through
  `HttpRangeProvider`s sized from the manifest's `trackSizes`. Both then go
  through `mediaImport.analyzeCueBundle`, the same plan a dropped CUE gets. The
  disc's label is its own (`Civ2:MGE v1.0`; the Win16 disc's label is blank),
  not the registry's `volumeLabel`. test/static-server.js now serves byte
  ranges for the browser tests.
- **Indeo.** The registry entry mounts `indeo/ir41_32.dll` (the file the
  install recipe above produces) at `c:\windows\system`, marked
  `optional: true`: without it the game still launches, it just has no codec.
  It also sets `HKLM\...\Windows NT\CurrentVersion\Drivers32` `vidc.iv41`,
  which `$icm_drv_lookup` reads when SYSTEM.INI has no `[drivers32]` line.
- **Audio clock.** Civ2 paces video off `waveOutGetPosition` and refills audio
  only on `MM_WOM_DONE` to its `CALLBACK_WINDOW`. The host read the callback
  record from stale pre-allocator literals (`0xD164`/`0xD16C`) instead of
  `$WAVE_OUT_SHARED`, so `WOM_DONE` was never posted and the movie froze after
  its first 8 buffers (1.49s). Fixed in 4e5bd041, which also keeps a lazily
  backed `AVIFileOpen` handle parked, so that closing it no longer cancels the
  read it is waiting on.

Headless recipe: `--batch-size=100000 --tick-ms-per-batch=20`. The Diplomatic
Heralds prompt (first launch) appears around batch 500. Its OK button is at
403,387 (mousedown at batch 1210, mouseup at 1230). The movie follows; after it
comes the main menu with its animated IV41 map.

## Not yet done

- Advisor and wonder movies have not been driven. They use the same AVIFIL32 +
  `ICLocate` path as `opening.avi`.
- The Win16 build's `IR41.DL_` driver (Win16 MSVIDEO) is out of scope.
