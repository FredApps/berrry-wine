# Myth: The Fallen Lords (Bungie, 1997) — demo and retail ISO

Status 2026-10-05 (NEW-GAME-MYTH-20261005): both the official Win32 demo and
the retail CD reach in-level 3D gameplay headless with ordinary mouse and
keyboard input. Evidence: `scratch/runs/20261005-myth-tfl-retail-iso-gameplay/`
(retail, reviewed, `result.json`) and `scratch/runs/20261005-myth-tfl-demo-gameplay/`
(demo; not a registered candidate, so no `result.json`), and the browser route
`scratch/runs/20261005-myth-tfl-retail-browser/` (reviewed). FPS not measured.

## Registered app `myth_tfl` (localhost-only)

`lib/apps.js` LOCAL_CANDIDATE_APPS; refused by `tools/deploy-berrry.js`. Local
media under `test/binaries/candidates/myth-the-fallen-lords/` (gitignored):

- `installed/` — the Small install Setup.exe writes (copied out with
  `--save-vfs-prefix='c:\program files'`), mounted at `c:\` by
  `.wine-assembly-browser.json` (`c:\tags\tags.gor`, `c:\modules\tcpip.dll`, …).
- `sources/myth-tfl.cue` — one `MODE1/2048` track over `myth-tfl.iso`; the
  `cdAudio` config mounts it lazily as `D:` `MYTH_TFL` (HTTP Range in the page),
  so the 538 MB ISO is never loaded whole. `disc/` (the fetch tool's extraction)
  is not used by the route.

Browser (headless Chrome, `web-input-probe.js --app=myth_tfl`, served by
`tools/dev-server.js` for Range support): menu at ~48 s, level ~110 s real time.
In real time the enemy is already crossing the bridge by the time the level is
on screen. Input verified there: A turns the camera, F8 key list, minimap click
moves the view; Enter (Select All) reached the guest as WM_KEYDOWN 0x0D with no
visible selection. Unit select/move was verified on the CLI.

## Sources

| What | Where | Checksum |
|---|---|---|
| Demo installer | https://archive.org/download/MYTHDEMO/MYTHDEMO.EXE (32,647,564 B) | md5 a38fe6ef950e22c1c7e7d231c29d0afc, sha256 d6b85468bed2714685e827311047083339f4123f03baa804ebe039a5e52b2771 |
| Retail ISO | candidate `myth-the-fallen-lords` (`tools/fetch-candidate-corpus.js`), 538,191,872 B | md5 1edda1890e32e7bde09ce3bf563c0479 |

`tucows_205995_Myth_-The_Fallen_Lords-Demo` on archive.org is the Mac `.sit`; skip it.
Myth II demo (`MythIiSoulblighterDemo`) was not needed.

Both installers are MindVision **Installer VISE** (`vise32ex.dll`); 7-Zip cannot
open them, so they must run in the emulator. Demo: 52 MB install, payload is
one `tags/tags.gor` (51,594,033 B). Retail "Small" install is 31 MB
(`myth_tfl.exe`, `tags/tags.gor`, `tags/scrap.gor`, DLLs); `artsound.gor`
(320 MB) and `cutscene.gor` (114 MB) are read from the CD (`D:\TAGS\`, label `MYTH_TFL`).

## Modules and API profile

- `myth_tfl.exe` (demo 713,216 B; retail 714,752 B), image base 0x400000. DirectDraw
  8bpp software renderer, or its own 3dfx renderer through our built-in glide2x
  (the default since 2026-10-06; see "3dfx (Glide 2) renderer" below; the disc's
  real glide 2.4.3 driver is never loaded), DirectSound,
  DirectInput keyboard device (acquired, state never read in-game — keys arrive
  as WM_KEYDOWN), WSOCK32.
- `uber.dll` — Bungie protocol switch (`GetIndexedProtocol`, `Protocol*`),
  LoadLibrary's `modules\tcpip.dll`. `mclient.dll` — bungie.net client, imports uber.
  **Both must be real PEs** (`lib/dll-registry.js` APP_LOCAL_DLLS); as stubs the
  main menu traps on `GetIndexedProtocol`.
- In-game input: mouse buttons via window messages, sampled once per rendered
  frame. Headless at 200 ms/batch an in-game frame is ~250 batches (~50 guest s),
  so a `--input` press must be held across a frame (`mousedown` … 400 batches …
  `mouseup`); same-batch `click` and short presses are silently dropped. Menus run
  fast enough that `click` works there.

## Emulator fixes this title needed

1. `_hwrite` (api id 4093) — VISE installer writes with it; delegates to `_lwrite`.
2. `CreateFile` on an existing **directory** must fail `ERROR_ACCESS_DENIED` (5).
   Myth's dir-exists probe (`exe+0x412b40`: CreateFile(dir, GENERIC_READ,
   OPEN_EXISTING); `GetLastError()==5||==32` ⇒ exists) got 2, then
   CreateDirectory → 183 and the tag-file layer reported
   "error #2 while writing (#0,#1228)", ending in
   `initialize_myth_for_new_map(NULL) failed.` (string 0x4a0014) → exit(-1)
   with **no visible message**. Retail recursed on `C:\TAGS\PRIVATE` instead.
3. `uber.dll`/`mclient.dll` app-local DLLs (above).
4. Harness: `--iso-exe` now reports the disc path (D:\Setup.exe) from
   GetModuleFileName — VISE copies "from its own directory" and failed with
   "cannot open the source file 'C:\mclient.dll'". `--save-vfs-prefix=` added:
   an unfiltered `--save-vfs` after an ISO install exports every disc file
   Setup read and filled the host disk.

## Named addresses (demo exe)

- `0x411e90` set-error(type, code, fmt, …); `0x411fc0` error-pending check
  (global `[0x4b64c0]`), returns 1 ⇒ init fails.
- `0x412b40` directory-exists probe; `0x412750` CreateDirectory wrapper.
- `0x425e60` new-game/map setup; `0x43b570` `initialize_myth_for_new_map`.
- `0x40d5b0` halt-with-message (prints nowhere visible) → `0x4256f0` → exit(-1).

## Reproduction

Retail (after a Small install into `retail-installed/`, ISO on D:):

    node test/run.js --exe=<retail-installed>/myth_tfl.exe \
      --vfs-include='*.dll,tags/**,modules/**,*.ini' --iso=<myth-tfl.iso> \
      --quiet-api --stuck-after=0 --max-seconds=280 --max-batches=84000 --no-close \
      --input=12000:mousedown:320:240,12100:mouseup:320:240,16000:mousedown:320:240,16100:mouseup:320:240,20000:click:404:272,21900:mousemove:310:258,22000:mousedown:310:258,22100:mouseup:310:258,44000:mousedown:320:400,44100:mouseup:320:400,75000:png:/tmp/game.png

Intro ≈ batch 11900, menu ≈ 21800 (after dismissing "no network modules"),
briefing ≈ 40000, Crow's Bridge in-level ≈ 75000. F8 = key list; W/S/Z/X move,
A/D turn, Q/E orbit, C/V zoom.

## Network modules notice (fixed 2026-10-05)

"Networking is unavailable because no network modules were found in the
modules folder" came from UBER.DLL's **DllMain** (0x10002a7a orig): it chdirs to
`.\Modules`, enumerates `*.*`, `LoadLibraryA`s each DLL and asks for
`NMGetModuleInfo`, then restores the CWD. Three emulator faults stacked:

1. CLI: `run.js` mounted the app's files after the static DllMains ran, so
   `C:\Modules` did not exist yet (the page loads files first). It now mounts
   the manifest before `loadDlls`.
2. VFS: a directory that only exists because a mounted file lives under it was
   refused by SetCurrentDirectory/GetFileAttributes (`_isDirectory`).
3. Both hosts: `callDllMain` runs an initializer synchronously and treated the
   LoadLibraryA yield (reason 5) as "resume", so LoadLibraryA returned a stale
   EAX (0x074ff7b0) and the load was serviced only after DllMain had given up.
   `serviceLoadLibraryYieldSync` (lib/process-boot.js) now maps the DLL in place
   when its bytes are resident; anything needing a fetch keeps the async path.
   (`--trace-api` still prints the stale EAX for that call: it records the
   return at yield time.)

After the fix "Multiplayer Game" is enabled in the main menu.

## Performance and audio (browser, headless Chrome, 2026-10-05)

- Metric: `WinePerf.snapshot().guestFps` = **PRESENT/s** (explicit DirectDraw
  presents). In-level Crow's Bridge: **29.3–30.2 PRESENT/s** across five samples
  over ~25 s; page 60 fps, ~26–34M blocks/s, throttled 0%. Myth runs its game
  loop at 30 ticks/s, so this is at its cap. Menu presents only on change
  (0/s idle). Headless Chrome only: no display/Xvfb on the box, so no headful
  number; treat as indicative, not as a felt frame rate.
- Audio (fixed 2026-10-06): intro and menu music always played; **in-level
  was silent**. Myth mixes into a few looping DirectSound rings through
  Lock/Unlock. Once its heap had spilled into the sparse VirtualAlloc backing,
  `IDirectSoundBuffer_Lock` rebuilt the guest pointer with the direct-window
  inverse (`wa - GUEST_BASE + image_base`), which names unmapped memory there:
  `--fault-null` counted ~2.8M writes from the mixer (EIPs 0x476e75/0x476fbf/
  0x476e68) to 0xa1b519c-0xa27ccb0, all landing in the NULL sentinel, so every
  voice refresh played zeros (browser probe: 67 plays/20 s, PCM peak 0, output
  0/400). Fixed with `$w2g`; same window now: PCM peak 0.282, output non-silent
  400/400 samples. Regression: test/test-directsound-lock-sparse.js.

## 3dfx (Glide 2) renderer (2026-10-06)

Myth has its own 3dfx renderer (`C:\myth\render\render_3dfx.c`) and picks it by
itself. `0x419a80` loads `glide2x.dll` (our built-in module) through `0x419db0`,
which resolves 33 entry points by name and **returns failure on the first NULL**
(`test eax,eax / jnz` after each store, e.g. `[0x4b63f0]` =
`_grDrawPolygonVertexList@8`); it then calls `grSstQueryBoards` and sets
`[0x4ab950]=1` ("3dfx available") when a board is reported. `0x46d1f0(type)` is
"renderer usable": 0 = software always, 1 = 3dfx if available and the memory
tier `[0x4ac13c]` >= 1 (`0x42a710`: `GlobalMemoryStatus.dwAvailPageFile` - 8 MB,
capped at 32 MB, against tiers at `0x4a0910`: 7 MB, then 12 + 1.5 MB). The
graphics prefs record (validated by `0x46d2e0`) holds the renderer at `+0x1c`;
the defaults routine `0x46d380` takes the **highest usable** renderer, so a fresh
preference file uses 3dfx whenever Glide is complete.

What it needed from us:

- `grDrawPolygonVertexList` (convex fan from vlist[0], 60-byte `GrVertex`; Myth
  fills its list with `add eax,0x3c`). It is most of Myth's terrain: 2814 calls
  vs 280 `grDrawTriangle` per 1000 in-level batches.
- `grSstWinOpen(0, 7=640x480, 0, 0, 0, nColBuffers=1, nAuxBuffers=2)` (`esi=1`
  is a constant at `0x46027e`). The release Glide 2.4 driver on the disc
  (`glide 2.4.3/grtvgr.exe` -> `Glide/Drivers/Voodoo/Win95/glide2x.dll`,
  `_grSstWinOpen@28` at `0x100094d0`) only checks nCol+nAux against frame-buffer
  memory for 800x600/856x480/960x720 on <= 2 MB boards; ours reports 4 MB. We
  now accept 1-2 colour buffers (1 = single-buffered: front and back are one
  surface in both backends) and up to 2 aux buffers.
- Sampling TMU RAM that was never downloaded: Myth draws from 0x0..0x13fff
  before (and without) any download there; the hardware samples whatever the RAM
  holds, so both backends now do too (zero-initialised) instead of failing.

Evidence: scratch/runs/20261006T003007Z-myth-3dfx-inlevel-final (CLI,
`--glide-renderer=software`); compare the 8bpp software frame in
scratch/runs/20261005-myth-tfl-retail-iso-gameplay/05-gameplay.png. Software
stays selectable in Myth's own Preferences.

## Open

- CLI and browser both need a press held across one in-game frame.
