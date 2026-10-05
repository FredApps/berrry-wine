# Myth: The Fallen Lords (Bungie, 1997) — demo and retail ISO

Status 2026-10-05 (NEW-GAME-MYTH-20261005): both the official Win32 demo and
the retail CD reach in-level 3D gameplay headless with ordinary mouse and
keyboard input. Evidence: `scratch/runs/20261005-myth-tfl-retail-iso-gameplay/`
(retail, reviewed, `result.json`) and `scratch/runs/20261005-myth-tfl-demo-gameplay/`
(demo; not a registered candidate, so no `result.json`). FPS not measured.

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
  8bpp software renderer (glide 2.4.3 on the disc is not used here), DirectSound,
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

## Open

- "Networking is unavailable because no network modules were found" — the
  modules scan does not accept `modules\tcpip.dll`; single-player unaffected.
- Not yet registered in `lib/apps.js`; browser route untested.
