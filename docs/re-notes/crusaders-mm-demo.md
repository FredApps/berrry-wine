# Crusaders of Might and Magic (demo) -- PARKED

3DO, 1999. Fixture: `test/binaries/win98-games-a-d/Crusaders MM demo-D3D`,
installed tree at `installed/` (`crusaders demo.exe`, `gfx_d3d.dll`,
`gfx_sw.dll`, `uz.dll` = Info-ZIP UnZip32 5.4, Miles `mss32.dll`;
data in `caps\`, `meshes\`, `models\`, `script\`, `textures\textures.zip`).
Image base `0x400000`, no relocations needed.

Registry entry used for the runs (not committed, it is not playable yet):
exe `crusaders demo.exe`, `localFileManifest` under the install dir,
workingDirectory/exeGuestPath
`c:\program files\3do\crusaders of might and magic demo`, plus a
`tools/gen-win98-games-a-d-manifests.js` entry with that vfsRoot.

## Route

At boot it asks "Use This DLL?" for `gfx_d3d.dll`, then `gfx_sw.dll`
(`MessageBoxA` MB_YESNO). `--input=20000:dlg-cmd:7,40000:dlg-cmd:6` picks the
software renderer. Title (any click) -> main menu (Play Game 132,175) ->
Play Game screen (New Game 158,115). Title and both menus render correctly
in software DirectDraw with its own drawn cursor.

## Fixed on the way (commit with this note)

- `VerQueryValueA` returned every ANSI string in one scratch slot. The game
  keeps `FileVersion`, queries `CompanyName`, then compares the first against
  "5.4" (`0x4cbf01`), so it read "Info-ZIP" and refused `uz.dll` ("has the
  wrong version number"). Each string now gets its own slot at half its
  UTF-16 offset.
- A fixed-address `MEM_RESERVE` past the image window (guest `0x04000000+`
  with image base `0x400000`) used to "succeed" with the literal address --
  which `$g2w` translates onto emulator tables (`$TITLE_TABLE` for
  `0x04000000`) -- or fail by accident. It now fails with
  `ERROR_INVALID_ADDRESS`, as Windows does for a range it cannot place.

## Why it is parked

`0x450ea0` reserves three pools at fixed addresses: `0x04000000` (512 KB),
`0x06000000` (0xEE1000) and `0x08000000` (1 MB), storing the results at
`[obj+0/0xc/0x18]`. They are not hints. The level files (`caps\CaDEMOa.cap`,
`meshes\CaDEMOa.msh`) are memory images whose embedded pointers are already
relocated to those bases: with the pools relocated into the sparse arena, the
command list at `0x58ca48` holds records like `0x0609c0e2` (= pool base
`0x06000000` + `0x9c0e2`), the texture-register caller at `0x4783ff` passes
records with a NULL name 49 times (`0x4c34f0` builds `"Textures\" + name`),
and the interpreter switch around `0x4787ae`-`0x478bac` finally calls
through a NULL vtable at `0x4cb57a` (record `0x0800e37d`, a pointer into the
`0x08000000` pool), batch ~435150 on the route above.

Guest `0x04000000`-`0x09000000` is inside the direct window and overlaps the
emulator's own pinned guest regions (heap at `0x04100000`, stack at
`0x07400000`, thunks at `0x07500000`; see CLAUDE.md "Memory Layout"). Running
this game needs those three ranges to be real guest memory at exactly those
addresses -- a memory-map change (moving the pinned regions or letting a
sparse mapping shadow part of the direct window), not a handler fix.
`--virtual-alloc-top=0x10000000` does not help (same crash).

Unrelated noise seen: `\\.\ramlockC.vxd` CreateFile fails (it falls back);
loose `Textures\*.tga` misses are normal, it then reads `textures.zip`.
