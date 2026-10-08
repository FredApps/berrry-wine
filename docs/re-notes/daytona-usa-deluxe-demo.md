# Daytona USA Deluxe (Win95 demo)

Sega's 1997 demo in `test/binaries/win98-games-a-d/DaytonaUSA Deluxe-SWonly/`.
`GAME\DAYTONA USA Deluxe Demo WWW.exe` with `ddse.dll`, `dpctrl.dll` (both
static imports), `DXERROR.dll`, `Resource.dll` and `WINCPUID.DLL`, and 700
files under `GAME\Resource\`. The CD root also has Sega's own installer
(`Setup.exe` + `SSP.dll`, driven by `Ssp.ini`).

Registry id `daytona_usa_deluxe_demo` (localhost-only). The manifest from
`tools/gen-win98-games-a-d-manifests.js` lays the files out the way
`Ssp.ini` installs them: `SourcePath1 = game\` plus
`LangExeclusive = DOC\English`, both into one directory. The game will not
start without `thanks.txt` beside it: it reports `ERR_FILEOPEN(thanks.txt)`
after looking in the current directory and then `D:\Game\`.

Imports DDRAW, DINPUT, DSOUND, DPLAYX, MSACM32 (only `acmMetrics`), WINMM,
COMCTL32, SHELL32, ole32, LZ32. Rendering is the game's own software 3D into
a 640x480x8 DirectDraw flip chain.

## Route (headless, `--batch-size=20000`)

| batch | action / screen |
|---|---|
| ~1500 | attract demo: records table over a track flyby, "Press Enter Key" |
| 2000-3200 | Enter held: title menu ARCADE / TIME ATTACK / 1P VS 2P / MULTIPLAYER / RECORDS / EXIT |
| 6000 | Enter: Arcade, then Car Settings (Hornet, AT) |
| 8000, 10000 | Enter, Enter: race grid, lap 1/2, position 20/20 |
| 12500+ | X held (gas): 163 mph in 4th by batch 21000 |

**Do not press Enter once the race is loading**: in a race Enter opens the
EXIT? / YES / NO / RESTART pause box.

Evidence: `scratch/runs/20261006T015500Z-daytona-usa-deluxe-demo-race/`.

## Input

Keyboard is DirectInput only: `GetDeviceState` on a 256-byte DIK buffer at
`0x899534` (= `0x898300 + 0x1234`), polled at `0x4235fa`. Any non-zero byte
posts event 0x11 through `0x4038a9`. Send `di-keydown` with `keydown`.

Default keyboard layout, from the help file (`DAYTONA USA Deluxe.hlp`, topic
text): Steering LEFT/RIGHT, **Gas X**, **Brake Z**, Shift Up UP, Shift
Down DOWN. The help also lists three alternative layouts and joystick
mappings. Up arrow is a gear shift, not the accelerator. A run holding Up sits
at 0 mph and looks exactly like dropped input.

## Emulator gaps fixed (2026-10-06)

1. **Cascaded menu state by command id.** The window's resource menu has
   Settings > Screen mode with items 40009-40013 (320x240x8 …
   Window Mode), all grayed in the resource. The game calls
   `EnableMenuItem` for each mode `EnumDisplayModes` reports, then reads them
   back with `GetMenuState` (wrapper `0x426670`). Both walked only one popup
   level, so every mode read -1 and it quit with `ERR_NORESOLUTION`
   (Resource.dll string 15). Fixed in `src/09c5-menu.wat`
   (`$menu_group_set_disabled` recursion and `$menu_group_find_flags`).
   Covered by `test/test-menu-cascade-state-by-id.js`.
2. **SZDD / LZInit.** `LZInit` was missing from `api_table.json`. Seventy-two
   `Resource\*` files (`*.mdl`, `*.tex`, `cmvdata.bin` …) are COMPRESS.EXE
   SZDD streams. `LZInit` now expands an SZDD file whole into a heap buffer
   and returns LZ handle `0x400 + slot`; `LZRead`/`LZSeek`/`LZClose` serve
   those handles and fall through to files otherwise. A read-only
   `LZOpenFileA` goes through it too. Covered by `test/test-lz-szdd.js`.
3. **GetColorKey with no key** returned `DDERR_NOCLIPPERATTACHED`. The game's
   wrapper (`0x434507`) tolerates only `DDERR_NOCOLORKEY` (0x887600D7) and
   raised its fatal DXError path for anything else. Covered by
   `test/test-ddraw-getcolorkey-nokey.js`.
4. **mmioAscend padding.** `8_8_mo00.bin`/`8_8_mo01.bin` are concatenated
   WAVE files at odd offsets. `mmioAscend` aligned the absolute end position
   to even instead of adding the pad byte only when `cksize` is odd, so the
   following `mmioDescend` for `data` missed. The sound got `bytes=0`, and
   `CreateSoundBuffer`'s `E_INVALIDARG` went down the same fatal DXError path
   right after the title. Covered by `test/test-mmio-ascend-odd-offset.js`.

`--trace-api` now decodes `IDirectSound::CreateSoundBuffer`'s DSBUFFERDESC and
WAVEFORMATEX (`LPDSBUFFERDESC` in `lib/api-format.js`). That is what showed
the `bytes=0` request.

## Notes

- After a fatal DXError the game destroys its window and shows the "Thanks
  for playing" dialog (the same one it shows on a normal exit). A thanks box
  at launch therefore means an init failure, not a finished session.
- Mid-run `B:png:` captures can lag a few frames behind the final one.
- Not evaluated: steering, audio output, FPS, browser, the network modes.
