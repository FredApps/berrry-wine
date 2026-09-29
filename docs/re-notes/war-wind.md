# War Wind (USA) and War Wind II — Human Onslaught (Europe)

Both are DreamForge / SSI RTS games shipped as CD images (`.cue`/`.bin`) with
InstallShield 3 setups. Verified 2026-09-28: both install from the mounted CD
and reach real gameplay with the CD still mounted.

## Discs

| Game | Setup | Installed exe | Notes |
|---|---|---|---|
| War Wind | IS3 **Win16** `SETUP.EXE` | `WARWIND\WW.EXE` | music streams from `D:\warwind\data\res.003` at runtime, so the CD must stay mounted |
| War Wind II | IS3 `SETUP.EXE` → `_ins0432._mp` engine | `C:\WarWind II\warwind2.exe` + `smackw32.dll` | data in `data\res.000/001/008`, `network\*.lvl` |

## Bugs fixed to get here

- **War Wind setup: `OpenFile(OF_CREATE)` alone was read-only.** The Win16
  SETUP creates its engine stage file with style `0x1000` (access bits = OF_READ)
  and then `_lwrite`s into it. DOS create (INT 21h AH=3Ch) always opens
  read/write; `$handle_OpenFile` now does the same whenever OF_CREATE is set.
  Covered by `test/test-openfile-create.js`.
- **War Wind II setup spun forever in SdAskOptions.** The IS3 engine's startup
  (`_ins0432._mp` `0x408cc9` → `0x408d29` → `0x40931f`) registers GDI32,
  KERNEL32, USER32 into a DLL list at `[0x4964ac]` by GetModuleHandleA for
  system DLLs, **stopping at the first NULL**. `GetModuleHandleA("GDI32")`
  returned 0, so USER32 was never registered, and every script call into USER32
  (resolved by `0x408f7f`, lstrcmpiA over that list) was silently dropped — the
  dialog never appeared. `gdi32` is now in `$STATIC_SYS_DLL_NAMES` (before the
  DirectX tail; `$STATIC_SYS_DLL_FIRST_DX` is 4, and the DPLAYX/DSOUND ordinal
  rules in `08b-dll-loader.wat` derive their positions from it). Covered by
  `test/test-wide-api.js`.

## Headless commands

The CLI resolves import DLLs beside the host exe, so for War Wind II copy
`smackw32.dll` out of the install overlay next to a host copy of
`warwind2.exe` (otherwise: `UNIMPLEMENTED API: <ord>`).

**War Wind II also runs straight off the disc, no install needed**:
`WW2\WARWIND2.EXE` and `WW2\SMACKW32.DLL` are stored uncompressed on the
CD. Extract both beside each other and point the guest path at `D:`:

```sh
node tools/cue-bin-to-iso.js "<disc>.cue" ww2.iso
node tools/iso-dir.js ww2.iso --extract='WW2\WARWIND2.EXE' --out=host/warwind2.exe
node tools/iso-dir.js ww2.iso --extract='WW2\SMACKW32.DLL' --out=host/smackw32.dll
node test/run.js --exe=host/warwind2.exe --exe-guest-path='d:\ww2\warwind2.exe' \
  --media-mount="<disc>.cue" --media-exe=SETUP.EXE --cwd='D:\WW2' \
  --screen=800x600 --no-build --quiet-api --count=0xa205c0
```

### Intro movie (Smacker, through the game's own `smackw32.dll`)

`WW2OPEN.SMK` is 2169 frames, 640x160 at 15 fps (144.6 s), shown
letterboxed in a 640x480 DDraw surface. It plays in full with no WAT
Smacker code: smackw32.dll runs as ordinary guest x86. The DLL loads at
`0xa1c000` (origBase `0x400000`), so `_SmackDoFrame@4` (`+0x4045c0`) is
`0xa205c0`, `_SmackWait@4` `0xa1f170`, `_SmackOpen@12` `0xa20ef0`.
`--trace-at` on DoFrame prints nothing (it is not called on the main
thread's batch boundary); `--count` works.

Decode throughput, measured 2026-09-28 by running to fixed `--max-batches`
(deterministic) and reading the DoFrame count, on the M1 at load 5-8:

| batch | frames | wall |
|---|---|---|
| 10,000 | 334 | 8.2 s |
| 20,000 | 617 | 16.1 s |
| 40,000 | 1,199 | 26.4 s |
| 80,000 | 2,169 | 72.0 s |

That is ~36-56 decoded fps against the 15 fps the movie needs, 2.5-3.5x
real time headless. The headless clock runs ahead, so the decoder never
waits and this is its ceiling; browser paint is not included.
On the 10,000-batch runs, ~30 batches go by per frame.

```sh
# install (drive with tools/ctl.js on the control port)
node test/run.js --media-mount="<disc>.cue" --media-exe=SETUP.EXE \
  --overlay-dir=/tmp/ww2-overlay --screen=800x600 --quiet-api \
  --control=8133 --frozen --max-seconds=3000

# run the installed game with the CD mounted
node test/run.js --exe=<host>/warwind2.exe --exe-guest-path='c:\warwind ii\warwind2.exe' \
  --media-mount="<disc>.cue" --media-exe=SETUP.EXE --cwd='C:\WarWind II' \
  --overlay-dir=/tmp/ww2-overlay --screen=800x600 --no-build --quiet-api \
  --control=8133 --frozen
```

## Driving it (screen/PNG coordinates at `--screen=800x600`)

Both games poll `GetKeyState` for the button, so a bare ctl `click` is lost:
send `mousemove`, step ~60, `mousedown`, step ~60, `mouseup`.

- **WW2 install:** Welcome Next (494,454) → options (Suggested) Next →
  destination `C:\WarWind II` Next → "create directory?" Yes (334,363) → copy →
  DirectX prompt No (434,336) → README prompt → setup exits 0.
- **WW2 game:** main menu star button (677,108) → mission screen → Start Game
  (450,32) → loading → tip dialog (right button 436,314) → "Start Game?" Yes
  (354,456) → gameplay.
- **WW1 game:** race circle (150,120) → Begin New Campaign (472,543) → campaign
  map → the black box at (665,540) is "Begin the scenario" (its art is missing —
  open question) → briefing → army screen → checkmark (665,535) → zoom-in
  transition (static for a few thousand batches while the level initialises in
  `0x4252xx`) → tip dialog. **The round-arrow button (437,317) closes the tip**;
  the checkmark on the left is "Next tip" → gameplay.

## Open questions

- ~~`$handle_ICOpen` returns 0, so WW1's Cinepak AVIs are skipped.~~ Fixed:
  `09a7g-video-icm.wat` opens Cinepak and `09a7f-video-avi.wat` reads the
  files, so `LOGOS.AVI` and `WWOPEN.AVI` play in-game (dd4437aa). All 63 disc
  AVIs are Cinepak 320x240 15 fps + 22 kHz PCM, and they are listed in
  `tools/avi-player/` from `test/binaries/cd-movies/War Wind/`.
- WW1's "Begin the scenario" button draws as a black box.
