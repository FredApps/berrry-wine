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

## Not yet done

- Civ2 MGE's own movie route (an advisor or a wonder) has not been driven
  headless. The AVIFIL32 + `ICLocate` + MCIWnd paths it uses all run on the
  same driver backend.
- The Win16 build's `IR41.DL_` driver (Win16 MSVIDEO) is out of scope.
- In the browser, installing Indeo into the page's VFS and loading the DLL from
  `c:\windows\system` has not been tried. `_findDllBytes` may not search the
  system directory.
