# Disciples: Sacred Lands (demo)

Strategy First's 1999 demo, `test/binaries/win98-games-a-d/Disciples demo SW/DisciplesDemo.exe`:
a 37 MB Wise self-extracting installer ("Disciples - Sacred Lands Demo
Installation"). Its own setup was run in the emulator and its output is
kept beside it as `installed/` (the `C:\Program Files\Disciples Demo` tree,
174 files). Registry id `disciples_demo` (localhost-only).

The game is `Exe\discipdm.exe` with `SHW32.dll` (MicroQuill SmartHeap),
`C4dll-R.dll`, `mss32.dll` (Miles 5.0i), `smackw32.dll` and its own
`msvcrt.dll`, all real PEs. It reaches DirectDraw through
`CoCreateInstance(CLSID_DirectDraw)` + `IDirectDraw::Initialize`, not
`DirectDrawCreate`, and plays Smacker video.

## Install (in the emulator, headless)

`node test/run.js --exe="…/DisciplesDemo.exe" --batch-size=20000
--max-batches=150000 --save-vfs=DIR --input=` with six Next clicks at
(365,382), one every 3000 batches. The wizard goes Welcome, Program Manager
group, …, copy (about 130k batches at 20000 blocks), "Installation
Complete". `--save-vfs` then holds `program files/disciples demo/`. The
default 1000-block batch copies about 36% in 220k batches, so use the larger
batch size.

`Exe\disciple.ini` names every data directory by absolute path
(`globals=C:\Program Files\Disciples Demo\Globals`, …). The game also builds
its log/INI paths from its own module path and gives up when that directory
is the drive root. So the tree must mount at its install path **and** the
image must report `C:\program files\disciples demo\exe\discipdm.exe`. The
registry entry's new `exeGuestPath` does that: the CLI takes it as
`--exe-guest-path` and the browser passes it to `loadExe`. Verified in the
browser 2026-10-06: `tools/web-input-probe.js --app=disciples_demo` (headless
Chrome, `CHROME=/usr/bin/google-chrome` on Linux) shows the main menu at 60 s.

## Route (headless, `--batch-size=20000`)

| batch | action / screen |
|---|---|
| ~1000 | "Loading ..." then the Smacker intro |
| ~2000 | main menu: SINGLE PLAYER / MULTIPLAYER / INTRO / CREDITS / QUIT |
| 3600 | click (318,147): SINGLE PLAYER, then NEW SAGA / LOAD SAGA / NEW QUEST / … |
| 4500 | click (318,150): NEW SAGA, then Choose Race (The Empire) |
| 5500 | click (320,368): check, then Choose Lord Type, Warrior Lord |
| 6600-6800 | keypress A, C, E (name); 7200 click (555,360): check |
| ~8500 | quest briefing "Capture the city Venusia" |
| 8700 | click (580,447) (the bottom-right arrow, not ▶): adventure map, "Beginning day 1" |
| 13100, 14600, 15400-17200 | click the red seal on each tutorial scroll |
| ~18100 | colour adventure map, Empire capital, "Game saved under Campaign Start.sg" |
| 18300 | double-click (240,150): city management (Sir Arken, Move 20/20) |

The map is drawn desaturated while a modal scroll is up; that is the game's
own effect, not a palette bug. Mouse is plain Win32 (no DirectInput).

Evidence: `scratch/runs/20261006T030000Z-disciples-demo-city/`.

## Emulator gaps fixed (2026-10-06)

1. **HeapWalk / GetProcessHeaps** (HeapWalk was a crash stub; GetProcessHeaps,
   api id 4100, was missing). SmartHeap's DllMain (`shw32+0xad60`) calls
   `GetProcessHeaps(0,0)` and then `HeapWalk(GetProcessHeap())`, and picks its
   Win95 path when `GetLastError() == 120`. Both are NT-only, and Win9x
   KERNEL32 fails them with ERROR_CALL_NOT_IMPLEMENTED, which is what they do
   now. `test/test-heapwalk-win9x.js`.
2. **GetDisplayMode depth.** It reported a 16bpp 5-6-5 mode with a
   width*2 pitch whatever `SetDisplayMode` set. The game (640x480x8, no
   `CreateSurface` at all on this path) builds its software back buffer from
   it, and its first `SmackBlitClear` (`smackw32+0xb4e0`, called from
   `0x4e9a62`) got `buf=0`, `pitch=0x2c373034`. That `rep stosd` then
   overwrote guest memory from address 0 to 0x2c373030, through every loaded
   image. The Miles service thread executed zeros (EIP 0, ESP 0xC), and the
   interpreter later read a garbage threaded-code pointer (0x08000000,
   `$dispatch_bad`). All three were downstream of one bad field.
   `test/test-ddraw-getdisplaymode-depth.js`.

## Debugging notes

- `--fault-null` showed 152M unmapped writes from one EIP over
  `0x0-0x2c373030`; that is what to look for whenever `$dispatch_bad`
  (`[i32] 0xcac4bad0`) appears with no page chunk loaded.
- `--vfs-include='../**/*'` does **not** include files in the exe's own
  directory (their relative path has no `../`); `--vfs-tree=ROOT` mounts a
  whole tree at `C:\`, and `--vfs-mount` mounts single files only.
- The `<ord>` count (about 175k per 30k batches) is the game's DLLs calling
  each other by ordinal through real PE exports; it is not a missing import.

## Open / not evaluated

- Browser gameplay past the main menu not driven (launch to menu verified).
- Audio, FPS, battles, the Multiplayer modes.
- The `ole32.dll` warning: the game uses only CoInitialize/CoCreateInstance/
  CoUninitialize, which the WAT handles.
