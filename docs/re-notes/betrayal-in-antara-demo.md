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

## 2026-10-07: recovered original DLL; additive far relocation defect

The earlier SI/DI hypothesis is superseded by direct original-file evidence.
`SETUP.SOL` (982,010bytes) contains thirteen DH91 records followed by individual
PKWARE DCL streams. Each26-byte record stores its compressed length at+18;
those lengths cover the payload exactly. The existing native `tools/mpq.js`
`explode` reader recovered `_SETUP.EXE`, `EREGLIB.DLL`, `SMACKE16.DLL`, and
`SMACKW16.DLL` without running guest code or changing the original package.
Source/recovery receipts are in `scratch/new-game-antara-20261007/recovery.json`;
the previous scratch directory was empty, so this is independent recovery,
not a claim to have reverified the unavailable historical runtime capture.

Recovered SMACKW16.DLL is13,946bytes, SHA-256
`0c7e5a7473ac1ca979faeb48cced01b707afd55ff7138ecd867c8085f6e7fcfd`.
Its ordinal37 at1:0275 has an additive FAR_ADDR relocation at0276, resolving
ordinal43=1:01e8 with existing offset0056. The intended destination is023e,
a wrapper that explicitly sets SI=DI=01b2 before calling01e8. Ordinal39 at027b
similarly has addend0074 and must reach025c. The loader previously discarded
both far-pointer addends and jumped directly into01e8, bypassing these
initializers. No generic DLL-entry register-convention change is appropriate.

The repair adds the existing low16 offset only for additive FAR_ADDR(type3),
with16-bit wrap; the selector is replaced, without carry or selector addition.
This matches Wine's `apply_relocations` POINTER32 additive branch in
[dlls/krnl386.exe16/ne_segment.c](https://github.com/wine-mirror/wine/blob/master/dlls/krnl386.exe16/ne_segment.c).
Non-additive chains, OFFSET16 and other source types retain their behavior.

`test/test-ne-additive-far.js` invokes the actual WAT NE loader. It checks the
0056/0074 cases, offset wrap, replacement of a nonzero selector, non-additive
chaining, and unchanged OFFSET16. An optional authenticated original DLL
argument also checks its actual0276/027c targets and wrapper instruction bytes.
The unmodified-source control fails the exact0056 assertion (01e8 vs023e);
the candidate passes. The test requires no private fixture for its core cases.

Full production build gates passed on isolated base775bae77 plus the narrow
repair; existing NE loader2881checks, NE image-extent, and the new test with
original DLL all passed. Source/tests were registered by the normal UNIT rule.
Final production module is1,719,337bytes, SHA-256
`992a8b021897e52d2ec1b5f3604f5f89098f02ee2e4748e5340ff4d960f5e880`.
Receipts: `scratch/new-game-antara-20261007/production3/` and
`production3-supervisor/result.json` (exit0,16.439sec, process group clear).
Two earlier build attempts stopped at missing sparse checkout fonts/bundles;
those failures remain preserved. A complete tracked checkout resolved them,
without copying ignored payloads or modifying shared canonical outputs.

Status: generic loader repair validated; ordinary installer progression and
player-controlled Antara gameplay are still unverified. Next run the original
SETUP.EXE with original media and normal installer input on the pinned repaired
runtime. Do not skip LibMain, force function pointers, or label setup as gameplay.
