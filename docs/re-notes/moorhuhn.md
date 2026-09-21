# Moorhuhn 1, 2, Winter-Edition, 3, Tennis and CD extras

Local candidates `moorhuhn`, `moorhuhn-2`, `moorhuhn-winter` in
`test/candidate-corpus/manifest.json` (archive.org item
`moorhuhn_1__2_with_addins`); app ids `moorhuhn`, `moorhuhn_2`,
`moorhuhn_winter` in `lib/apps.js`. All three reach gameplay headless and in
the browser (2026-09-21).

## Moorhuhn (2000, DirectDraw 640x480)

- Title at ~batch 260-300 (`--batch-size=100000`).
- Keys arrive through a `SetWindowsHookExA(WH_KEYBOARD, 0x40cb70)` hook, not
  WM_KEYDOWN. The hook writes `[0x45a200 + (ext<<8 | vk)]`; the title loop at
  `0x402d80..0x402e4d` reads Space `[0x45a220]` (start) and Esc `[0x45a21b]`.
- Space leads to an ENTER YOUR NAME screen, not the round. Name letters are
  WM_CHAR, so the harness needs `keypress`, and Enter confirms. The round is
  mouse-only.
- Route: `330:keydown:32,340:keyup:32,420..445:keypress:<letters>,450:keydown:13,452:keypress:13,455:keyup:13`.
  Gameplay is ~550-900 and the round-end wipe follows.

## Moorhuhn 2 (v1.1)

- Static imports mudGE/wtnlib/fmod/pluginpack/FModPlugin plus `_strdate`,
  which is absent from the built-in MSVCRT, so the real `test/binaries/dlls/msvcrt.dll` goes
  first in `dlls`.
- `fmod.dll` is UPX-packed. Its stub GetProcAddresses MSACM32 (acmFormatSuggest,
  acmStream*) and `mciGetErrorStringA`, and DllMain returns 0 if any one is
  missing, which led to a jump to EIP 0. `upx -d` to a scratch copy lists the real imports.
- The load is ~500 batches of guest compute (218k `_CIpow` calls). A click at 320,250
  held ~10 batches starts a round, and the highscore screen appears at ~1300.

## Moorhuhn Winter-Edition (2001, Haribo)

- The Moorhuhn 1 engine, with no keyboard hook on the title. The load takes ~1100 batches;
  a click (not Space) starts the round, which runs ~1850-2400.

## Moorhuhn 3 (2001 download edition, German)

Source: `Moorhuhn.zip` from archive.org `moorhuhn_202112`. It holds
`Setup_Moorhuhn3DL_DE.exe` (InstallShield); 7z that, then
`unshield -g "App Executables"` on `Disk1/data1.cab`. The candidate fetcher
does both steps (`moorhuhn-3`). `Moorhuhn3.exe` + `moorhuhn3.dat` are the
whole game. It uses DirectDraw 640x480x16 and DirectSound, and its audio is an
FPU MP3 synthesis filter at `0x43030b`, the hottest block in gameplay.

The exe is packed, and the packer is hostile. Four things had to be real:

- **`fs:[0x30]`** must be a Win9x process database (>0x80000000). A zero
  sends it down the NT PEB path, which faults. `$WIN9X_PROCESS_DB`; worker
  TIBs copy it.
- **It jumps into bytes it just zeroed** and expects the access violation
  that `add [eax],al` with a bad EAX raises. The decoder emits
  `$th_zero_entry` (handler 469) for eight zero bytes in 32-bit code, and that
  handler raises `EXCEPTION_ACCESS_VIOLATION` when EAX is unmapped.
- **Its SEH handler is a raw one**, not `__except_handler3`. `$seh_walk_from`
  calls any frame that does not look MSVC-shaped with a real
  EXCEPTION_RECORD and CONTEXT (`$seh_call_raw_handler`, continuation thunk
  `CACA0037`). The handler edits `CONTEXT.Eip` and returns
  ExceptionContinueExecution. Without this the stub loops ~150 times.
- **The anti-speed-hack watchdog.** After unpacking, the game calibrates RDTSC
  across `Sleep(1001)`. `SetTimer(hwnd, 1, 509, 0x413970)` then compares TSC
  time with GetTickCount time into `[0x4876c0]`. When the gap is over 1093ms
  (`[0x43f3e8]`), it calls `0x4132a0`, which exits the process. Headless,
  the Sleep used to end at the next 200ms batch boundary, so the TSC measured
  240MHz against the real 200MHz. By the first timer after loading, the drift
  had passed a second. `test/run.js` now moves the batch clock straight to a
  main-thread Sleep deadline when no other guest thread is alive.

It also writes `C:\WINDOWS\TEMP\gsm3sys32.exe` one byte at a time and
ShellExecutes it, and probes `highscores.txt` ~26 times.

Route (batch size 200000): the title is up by ~1400 batches. A click leaves
it, another click at ~1700 and Space at ~1900 start the round. The first
gameplay frames are a venetian-blind wipe (4px vertical stripes). That is the
game's transition, not a blit bug. By ~2300 the round is clean.

```
node test/run.js --app=moorhuhn_3 --quiet-api --no-close --batch-size=200000 --max-batches=2700 \
  --input=1450:mousedown:320:240,1453:mouseup:320:240,1700:mousedown:320:240,1703:mouseup:320:240,1900:keydown:32,1903:keyup:32 \
  --png=/tmp/mh3.png
```

Unpacked code is only in memory, so read it with
`--input=B:dump-mem:0xVA:LEN` + `node tools/disasm-dump.js <log> --addr=0xVA`.

### Bonus puzzles (`MOORHUHN 3 - BONUS GAMES/`)

All three are Jigs@w Puzzle (Tibo Software, 2000-2001) self-extractors:

- **Loaders**: `Moorhuhn 3.exe`, `Moorhuhn 3 Fisch.exe` and `Moorhuhn 3 Leuchtturm.exe`.
- **Unpacking**: each writes ten files to `C:\WINDOWS\TEMP\tsldrl6660\` and ShellExecutes `setup.exe` there. That `setup.exe` is byte-identical across all three; the picture is in `data.pck`/`puzzle.pzl`.
- **Capturing**: headless ShellExecute starts nothing, so capture the folder with `--capture-launch=DIR`. Don't use `--save-vfs`: the loader deletes the folder again before exit. The fixture is `candidates/moorhuhn-3-puzzles/{moorhuhn3,fisch,leuchtturm}/`.
- **Registry ids**: `moorhuhn_3_puzzle`, `moorhuhn_3_puzzle_fisch` and `moorhuhn_3_puzzle_leuchtturm`.

What it took to run them:

- **`lt_init: version not found (sfiles/lang.ini)`**: the INI stores `Version="1"`. `GetPrivateProfileString` must drop one matching pair of quotes; `...Section` keeps them. The fix is in `lib/storage.js`, covered by `test/test-profile-string-quotes.js`.
- **DrawDib calls**: it needed `DrawDibBegin`, `DrawDibEnd`, `DrawDibSetPalette` and `DrawDibRealize`.
- **Banded smear on the board**: the board is a 648x424 bottom-up DIB repainted in 8-row strips (`DrawDibDraw` with `ySrc` = 0, 8, 16…). DrawDib counts `ySrc` from the top and StretchDIBits from the bottom, so the handler converts before calling the raster path.

The board is up by about batch 700 of 500000, and dragging a piece works (hover, mousedown, several mousemoves, mouseup):

```
node test/run.js --app=moorhuhn_3_puzzle_fisch --quiet-api --no-close \
  --batch-size=500000 --max-batches=900 --png=/tmp/fisch.png
```

## Best Of Moorhuhn (2001 CD, `archive.org/details/best_of_mh`)

The ISO holds three InstallShield 5 setups (`unshield` each `data1.cab`).

- **Moorhuhn 1**: `moorhuhn.exe` is byte-identical to the `moorhuhn` candidate.
- **Moorhuhn 2 and Winter-Edition**: other builds of games already listed, not new content.
- **What is new**: MH1's `spiel1.exe`, `spiel2.exe` and `making_of.exe`. These are registry ids `moorhuhn_training_1`, `moorhuhn_training_2` and `moorhuhn_2_making_of`, with the fixture in `candidates/best-of-moorhuhn/`.

Each of the three is a Delphi **Jester** wrapper:

- **What it does**: it opens itself, reads data appended to the image and writes the real Flash projector plus `jesterrun0.dll` to `C:\WINDOWS\TEMP\Jgl_Rt\`. It sets WH_KEYBOARD/CBT/MOUSE hooks from the DLL and deletes everything again.
- **Headless**: the wrapper launches nothing and posts itself WM_CLOSE. The hooks are what hide the projector's menu bar on a real machine.
- **First failure**: `EFOpenError "Cannot open file C:\spiel1.exe"`. The first VFS handle was `0xF0000001`, and Delphi's `FileOpen` treats any handle < 0 as failure. Handles now start at `0x70000001` (`lib/filesystem.js`, covered by `test/test-vfs-handle-sign.js`).
- **Getting the projector out**: neither `--save-vfs` nor `--capture-launch` works, because the files are deleted and there is no launch. Export them mid-run instead:

  ```
  --batch-size=5000 --input=300:vfs-export:\WINDOWS\TEMP\Jgl_Rt\spiel1.exe:/tmp/x/300.exe,...
  ```

  Keep the last full-size export.
- **Running them**: the projectors run standalone. START is at (305,160) in Training 1 and (320,140) in Training 2, and the stopwatch counts down with `--batch-size=400000`.

## Gallinelle XXL (2003 Italian Moorhuhn 1, `archive.org/details/gallinelle-xxl`)

**The image**: the zip is a raw MODE2/2352 BIN/CUE. Keep bytes 24..2071 of every sector to get an ISO, then `unshield` `SETUP/DATA1.CAB`.

**The game** (`gallinelle`): `Game/Gallinelle.exe` is a different build from our `Moorhuhn.exe`, but it runs unchanged. The route is the same:

- Title at ~300 (`--batch-size=100000`).
- Space, a typed name, Enter.
- The round is up by ~650.

**Bonus**: `Bonus/trainingsarea{1,2}.exe` are plain Flash 6 projectors with no Jester wrapper, the Italian twins of the Best Of Training-Areas. They are kept in the fixture but not in the dropdown.

## Moorhuhn Tennis (2002, Flash)

Source: `Moorhuhn-Tennis.exe` from archive.org `moorhuhn-tennis`, a Wise
installer. Its payload is in an overlay 7z cannot open, so install it inside
Wine Assembly. Control id 3 exists on a hidden progress dialog as well
(its Abbrechen), so `wait-dlg-control:3` + `dlg-click:3` cancels setup.
Click Weiter by position (378,395) every ~400 batches of 10000 instead.

The installed `moorhuhn_tennis.exe` is only a wrapper. It unpacks
`swfxxlrt.dll` and a `<random>TMP\` folder holding `MH_Tennis_V14.exe`,
`source.swf` and `basepath.txt`, then CreateProcesses the exe and polls
EnumWindows/GetWindowThreadProcessId/Sleep for its window. Headless
CreateProcess does not start a child, so it waits forever. `MH_Tennis_V14.exe`
is a stock Macromedia Flash Player 6 projector with the game appended (it
seeks to its own tail). It runs directly. `lib/apps.js` `moorhuhn_tennis`
points at it, and the candidate manifest entry is manual and lists these
steps.

Route (batch size 100000): the instruction screen appears by ~300 batches. Hover
"weiter" (243,462), press at 1500 and release at 1520; a two-batch click only
highlights the button. The chicken follows the mouse.
