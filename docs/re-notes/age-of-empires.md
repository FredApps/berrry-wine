# Age of Empires (1997 shareware demo)

`lib/apps.js` id **`aoe1`**, exe `test/binaries/shareware/aoe/aoe_ex/Empires.exe`
(1,607,680 bytes, `imageBase` 0x400000). All VAs below are **original** VAs —
what `tools/disasm_fn.js` prints for the file on disk.

## Status: reaches the main menu

```sh
node test/run.js --app=aoe1 --quiet-api --max-batches=60000 --max-seconds=90 \
  --no-close --png=/tmp/aoe1.png
```

Measured 2026-09-20 on `main`: 60000 batches in 16.5s, 225,722 API calls, and
the capture is the full animated title screen with Single Player / Multiplayer /
Help / Scenario Builder / Exit. Two runs at 30000 batches produced a
byte-identical PNG, so the route is deterministic and usable as an A/B oracle.
`test/test-aoe-menu.js` drives it further, to gameplay and the in-game menu.

## "Could not initialize graphics system" — solved, do not re-investigate

That message box is **not** a DirectDraw problem, and chasing it through the
DirectDraw handlers is a dead end that has now cost two sessions. It was root
caused and fixed in **501e4133** (2026-09-19), pinned by
`test/test-virtual-free-mapped-view.js`.

The cause: AoE memory-maps its `.drs` archives and its allocator hands
**unaligned interior pointers into those views** to a "decommit these bytes"
helper, which calls `VirtualFree(ptr, size, MEM_DECOMMIT)`. On Windows a view is
released with `UnmapViewOfFile` and `VirtualFree` on one fails with
`ERROR_INVALID_ADDRESS` without touching a byte. Here it reached
`$virtual_map_decommit_zero`, which zeroed the interface shapes straight out of
the mapped `Interfac.drs`; the shape count then read 0 and the game blamed the
video card. Measured example from that dig: `0x7de5d197` size `0x183e`, inside
the guest `0x7d1b0000` view.

**The misleading trail.** Every address a trace shows just before the bail sits
in this allocator, and none of them is what it looks like:

| VA | What it actually is |
|---|---|
| `0x0046e810` | file-mapping wrapper — `CreateFileMappingA` at `+0x83` (ret `0x46e893`), `MapViewOfFile` at `+0xbb` (ret `0x46e8cb`) |
| `0x0046e69e`, `0x0046e7a0` | neighbouring allocator helpers. A trace hit here reads as "registry", it is the archive mapper |
| `0x0046ebb0` | arena/view list walk: for each node, `[esi]` vs `ebp` over a `0xc`-byte stride, `0` on miss. Only caller is `0x0046ecdf` |
| `0x0046ef00` | the decommit wrapper: `VirtualFree(ecx, eax, MEM_DECOMMIT)` through `[0x7735c0]`. Two callers, `0x00499ac9` and `0x00499af2` |
| `0x00499820` | the allocator body that owns both those calls — the "guest code at `0x00499a13`" a failing trace reports |

So a report of the form "registry op at `0x46e7f3`, guest code at `0x499a13` and
`0x46ec22`, then `LoadStringA` → `MessageBoxA`" is describing the *fixed* bug,
not a new one. Re-check the emulator build before digging.

The message text itself lives in the UTF-16 string table at `0x00785666`
(length word `0x6f`, text from `0x00785668`)
("Could not initialize graphics system. Make sure that your video card and
driver are compatible with DirectDraw."), next to the sound and communications
variants — `tools/parse-rsrc.js` truncates its dump, `tools/dump_va.js
<exe> 0x00785560 640` shows the block.

## Startup API profile (`--trace-api`, current build)

Roughly, by API call index:

- **#79–#96** — four `CreateFileMappingA`/`MapViewOfFile` pairs: the `.drs`
  archives (Interfac, Graphics, Border, Terrain). All succeed.
- **#253–#259** — `DirectDrawCreate`, `SetCooperativeLevel(0x11)`,
  `SetDisplayMode(800, 600, 8)`.
- **#333** — the first `IDirectDrawSurface_Blt`. This is where the old abort
  landed ("roughly 334 API calls in"); a healthy run walks straight past it into
  `HeapFree` traffic and then font `LoadStringA`s (ids 101–130, Copperplate
  Gothic Light / Comic Sans MS / Arial — the TTFs `lib/apps.js` mounts).
- **#479 onward** — `IDirectSound_SetCooperativeLevel`, then the menu's
  `SetEntries`/`Blt`/`timeGetTime` loop.

No DirectDraw call fails anywhere in this sequence.

## Ruled out

- **VFS / `MapViewOfFile`.** Every `.drs` opens (`CreateFileA` → `h:0x700000xx`)
  and both mapping calls succeed. Any note saying "AoE VFS-blocked" or "stuck in
  MapViewOfFile" is stale (retired 2026-09-16).
- **A failing DirectDraw handler.** `CreateSurface`, `GetSurfaceDesc`, `Blt`,
  `SetClipper`, `GetCaps` and the palette calls all return success.
- **A guest acceptability check on a value we return.** The 2026-09-20 session
  looked for one on the theory that the abort was still live; it is not. The
  guest never reaches the bail on the current build.

## Related

- `docs/re-notes/aoe2-trial.md` — the sequel's trial, a separate binary.
- `test/test-aoe-menu.js`, `test/test-aoe2-span-prefix.js`,
  `test/test-virtual-free-mapped-view.js`.
