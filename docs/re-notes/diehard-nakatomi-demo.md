# Die Hard: Nakatomi Plaza demo (Piranha Games / Fox Interactive / Sierra, 2001)

LithTech Talon, Direct3D 8 (`lithtech.exe` imports `d3d8.dll`), DirectInput,
Miles. Fixture: `test/binaries/win98-games-a-d/Diehard nacatomi demoD3D.exe`
(Wise installer, 88 MB). The installed tree lives beside it in
`Diehard-nakatomi-demo-installed/program files/fox/die hard nakatomi plaza demo`
(183 MB) -- the directory above `program files` is the `C:\` root, so
`--vfs-tree=Diehard-nakatomi-demo-installed` mounts it at its guest path.
Not registered yet: it does not reach gameplay.

## Install (headless)

`run.js --exe='.../Diehard nacatomi demoD3D.exe' --tick-ms-per-batch=5
--control=PORT --frozen --save-vfs=inst --save-vfs-prefix='c:\program files'`,
then held clicks (mousedown, ~200 batches, mouseup): Next (378,395) on
Welcome, Yes (378,395) to "DirectX 8.0a installed?", Yes (358,395) on the
license, Next through Readme, Destination, keyboard layout (English default)
and Start Installation; ~300k batches of copying; Finish.

- The Destination page loads `C:\WINDOWS\SYSTEM\kernel32.dll` by full path to
  ask for free disk space. Before 03e2f5f3 that LoadLibrary failed ("Could not
  load the DLL library ... kernel32.dll") and setup could not continue.
- 7-Zip cannot open the installer; it has to run.
- The install leaves an `unwise.exe ` directory holding a file `u ` -- the
  uninstall string's `/u` argument read into a path. Deleted from the fixture;
  harmless, not investigated.
- Registry: `HKLM\SOFTWARE\Fox Interactive\DIE HARD : NAKATOMI PLAZA\1.0`
  (launcher switches: Disable Sound/Music/Movies/Fog/Joystick/TripBuf/Cursor/
  Loadscreen = 0, Language = English).

## Running it

- `nakatomi.exe` is the launcher; it runs `LITHTECH.EXE ... -rez nakatomi.rez`.
  Run the engine directly: `--exe=.../lithtech.exe --cwd='c:\program files\fox\
  die hard nakatomi plaza demo' --args='-rez engine.rez -rez nakatomi.rez'`.
- Load `msvcp60.dll`, `mss32.dll` and the real `test/binaries/dlls/msvcrt.dll`
  as PEs: the built-in MSVCRT lacks C++ exports it needs
  (`?_set_new_handler@@...` was the first).
- The engine extracts `cshell.dll`, `cres.dll` and `cresl.dll` from the rez into
  `C:\WINDOWS\TEMP` and loads them; `--save-vfs=DIR --save-vfs-prefix=
  'c:\windows\temp'` writes them out for disassembly.
- `autoexec.cfg` is as installed (`"bitdepth" "16"`): since 0dbe4ab6 the 16-bit
  mode exists, and the engine's default and fallback modes are both 16-bit.
- `soundmax.dll` (the game's sound DLL, imported by `cshell.dll` by ordinal)
  must load as a real PE too; the failure read "UNIMPLEMENTED KERNEL32.#00030"
  because the ordinal stub is labelled with the wrong module.
- Rendering on the CLI needs `--d3d9-renderer=software` (D3D8 draws through
  the D3D9 backend); without it every frame is black.

Emulator fixes found on the way: 03e2f5f3 (LoadLibrary by system-directory
path), 33e4ff16 (the dispatcher's nonvolatile restore undid `_EH_prolog`'s EBP,
so the engine returned into NULL 23 batches in), b15fa588 (`__p___argv`,
`__p___argc`).

## Fixed: the 16-bit display mode (0dbe4ab6)

The renderer initialized with 640x480x32, then `cshell` asked for its own
render mode and the engine never found it:

- `cshell.dll` `0x1002137c`: SetRenderMode(saved mode) through the engine
  interface (`[0x10072088]+0x78`); on failure it logs "Couldn't set render
  mode!" and retries a hard-coded **640x480x16** (`0x100213e4..0x100213f2`),
  then the same with hardware TnL off ("Couldn't set D3D Emulation mode").
- `lithtech.exe` `0x48e924`: the mode matcher. Walks the device's mode list
  (16-byte entries width, height, ?, D3DFORMAT) for width == `[0x508be0]`,
  height == `[0x508bdc]`, and for 16 bpp format R5G6B5 (0x17) or X1R5G5B5
  (0x18), for 24/32 bpp X8R8G8B8 (0x16) or R8G8B8 (0x14).
- After a successful CreateDevice the engine probes texture formats with
  CheckDeviceFormat and treats a 16-bit mode without A1R5G5B5 (25) as unusable;
  it then resets the device (BackBufferCount 2 -- triple buffering unless the
  launcher's "Disable TripBuf" is set) and CopyRects its managed X1R5G5B5
  textures.

0dbe4ab6 gave D3D8 a 640x480 R5G6B5 mode with a 16-bit view over the 32 bpp
back buffer, Reset, CopyRects, and A1R5G5B5/X1R5G5B5 textures. With
`--count`, the matcher went from 1 success / 5 misses to all hits.

Traps met on the way, worth knowing for the next LithTech title:
- `--trace-at` on these engine addresses does not fire with the micro-op tier
  on; add `--no-uop` (the flow then differs a little: 3 matcher calls, not 6).
- A memory dump of a value inside a hot loop lands mid-update; `--watch-log`
  tells a stuck value from a busy one.

## State (2026-10-06): a very long load

`lithtech.exe` initializes, presents, and shows its loading screen (the
Nakatomi emblem, animating, orange then white). The main thread is in
`0x43aed3`, an RLE-style decompressor writing byte runs into a bounded
buffer, at ~30k API calls per 100k batches; no errors. After 1.8M batches
(~7 min wall, `--d3d9-renderer=software`) it was still loading. Next: one
long run to see whether it reaches the level, then gameplay input.
