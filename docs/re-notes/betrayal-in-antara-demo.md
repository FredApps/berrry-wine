# Betrayal in Antara (demo) -- PARKED

Sierra, 1997 (SCI32 engine, VMD video). Fixture:
`test/binaries/win98-games-a-d/Betrayl-a-Antara-DEMO-SW` (35 MB): the game is
not in the directory unpacked; Sierra's 16-bit `SETUP.EXE` installs it.

## Installer, stage 1: SETUP.EXE (Win16 NE)

- Imports `LZEXPAND` (no such DLL on the machine). Fixed in d576fea9: LZEXPAND
  is an emulated Win16 module over LZ32 (LZCopy/CopyLZFile, LZOpenFile,
  LZInit, LZSeek, LZRead, LZClose, LZStart, LZDone; GetExpandedName still
  fails fast). It LZ-copies its second stage and helpers into
  `C:\WINDOWS\TEMP` (`_setup.exe`, `ereglib.dll`, `smackw16.dll`,
  `smacke16.dll`, `setup32.exe`, ...) and WinExec's
  `C:\WINDOWS\TEMP\_SETUP.EXE /o <source dir>` (format strings in SETUP.EXE).

## Stage 2: _SETUP.EXE (Win16 NE, second task on a guest thread)

- `DdeInitialize(&id, cb, afCmd=0xFFFFFFFF, 0)` (`66 6a ff` at seg 3:0x9cd0)
  -- every flag, APPCLASS_MONITOR included -- and any non-zero answer is a
  fatal "System Error: DdeInitialize returned 4004". Fixed in d576fea9.
- Then the task ends silently (thread exits). `--trace-win16` does not reach
  a second task's guest-thread instance, so it was run directly instead:
  `run.js --exe=<captured>/_setup.exe --exe-guest-path=c:\windows\temp\_setup.exe
  --args="/o C:" --vfs-tree=<demo dir> --vfs-tree=<captured temp tree>`.
- That run traps in **SMACKW16.DLL's LibMain**, before any LoadLibrary:
  - LibMain (seg 1:0x0) calls LocalInit, then entry #37 (1:0x275 -> #43,
    1:0x1e8, Watcom `__InitRtns`), then #38 (1:0x910).
  - #38 is what sets `[0x5ec]`: `LoadLibrary("SMACKE16.DLL")` (a WATCOM
    Win386 extended DLL in the same temp dir) and
    `GetProcAddress(h, "Win386LibEntry")` (exported as WIN386LIBENTRY).
  - But an initializer reached from `__InitRtns` already does
    `call far [0x5ec]` (1:0x415) while it is still 0 -> CS selector 0
    (marker 0xCA165E10).
  - `__InitRtns` at 1:0x1e8 takes its table bounds in SI/DI from the caller
    (`call 0x73` is a bare `ret`), i.e. from the registers the loader hands
    LibEntry (Windows: DI=hInstance, DS=autodata, CX=heap, ES:SI=cmdline).
    **Next step:** compare our NE loader's LibEntry register set with
    Windows' and with Watcom's Win16 DLL startup; the walk over the wrong
    range is the likely cause.

Status 2026-10-06: parked (claude:d10ba697); TODOS NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006.
