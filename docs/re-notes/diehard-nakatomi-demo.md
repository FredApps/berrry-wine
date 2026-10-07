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

## State (2026-10-06): the main menu, drawn black

What looked like an endless load is the **main menu**. The animated emblem is
`Interface\menu\sprites\logo.spr` (a string in `cshell.dll`), and the
"repeating" nakatomi.rez reads are its sprite frames. Keys and clicks change
nothing visible because nothing else is visible. Pass `--tick-ms-per-batch=2`:
at the default 200 ms the guest clock runs ~15 guest hours per 275k batches.

- Fixed (this commit): `CreateImageSurface(320x480, R5G6B5)` failed, because
  the backend colour surfaces took only formats 21/22. The engine then retried
  its 9 menu-background surfaces every frame
  (`exe 0x49e202` -> device `+0x6c`). A 16-bit image surface is now a 32-bit
  backend surface behind the 16-bit lock view, so `CopyRects` into the
  back buffer (`exe 0x49e478`) is a same-format copy. With the fix the menu
  draws about 118 `DrawPrimitiveUP` quads a frame.
- Still black: each frame is pretransformed quads (FVF 0x1c4 = XYZRHW |
  DIFFUSE | SPECULAR | TEX1, triangle fan) over 64x64 A1R5G5B5 tiles, with
  ALPHABLEND, SRCALPHA/INVSRCALPHA, point filtering, clamp addressing, and Z
  off. A `dump-mem` of two tile textures at batch 100004 shows real texels
  with the alpha bit set (`0x8xxx`), so the textures are fine.
- Next: dump one draw's vertices (the `DrawPrimitiveUP` stream pointer is on
  the stack, `0x074ff928`, stride 32) and check the diffuse alpha and RHW. If
  those are sane, check the software rasterizer's handling of XYZRHW + TEX1
  with SRCALPHA blending on a 16-bit device, e.g. by drawing one such quad in
  `test/test-d3d8-16bit-mode.js`.

## 2026-10-07: host texture admission rejects supported 16-bit formats

A bounded150-second CLI run on module
`8eb283c1b595afe336c3e2407f722e19d47aad0739784de4864ba699c8b5712f`
(runtime sources equivalent between3b8189f5 and8de5d0b3) repeatedly reported
`invalid texture resource stage=0 ... kind=3 levels=1 lod=0 format=25`.
The final640x480 image remained black apart from the lower-left gold emblem.
No gameplay or independent menu-state qualification follows from that image.

The bridge's admission list omitted24/25 although its existing decoder already
implemented X1R5G5B5 and A1R5G5B5. Admit exactly these two formats; no WAT or
decoder change. The expanded real-WASM16-bit test uploads native managed
textures and draws an XYZRHW/diffuse/specular/TEX1 fan through the production
Bridge/software backend. It verifies opaque X1 with bit15clear, opaque A1,
transparent A1 preserving the blue target, and untouched outside pixels.
The original host fails the real draw with D3DERR_INVALIDCALL; the candidate
and existing D3D8 unavailable/ABI probe pass. Ordinary game validation is next.

Retained evidence: `scratch/wt-diehard-20261007/scratch/menu-contract/`,
`attempt2/final.png`, `attempt2/capture.json`, and
`contract2/{before,candidate,unavailable}.log`. The107,442,011-byte production
log is retained losslessly as `attempt2-driver.log.gz`; its decompressed SHA256
is `11e974a0dcd602f523a6498fd1d855d982cb26d22c6f16b441a49fc969fdd9c1`.
The late draw gate did not arm because rejected draws never reached it;
there are no captured vertex alpha/RHW conclusions. Earlier attempt1 lacked
sparse bundled fonts and is a harness error despite the runner's exit0.
