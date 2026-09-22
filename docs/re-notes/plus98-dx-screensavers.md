# Plus! 98 Direct3D screensavers (ARCHITEC, FALLINGL, GEOMETRY, JAZZ, OASAVER, ROCKROLL, SCIFI)

`--app=scr_architec` and its six siblings, from `binaries/screensavers/`. All
seven pass `/s` (screensaver mode, not the config dialog) and all seven name an
identical family set — ddraw + d3drm + d3dim — so
`tools/gfx-app-census.js --list` shows them as one row shape and they are worth
treating as **one cluster**: seven of the 27 apps in the OpenGL/Direct3D target
set.

They run the *real* Microsoft `d3drm.dll` as guest code, so what we provide is
DirectDraw and Direct3D Immediate Mode underneath it. That makes them a good
test of the D3DIM surface: d3drm is unmodified and will simply decline to
render if it does not like what it is given.

## Two stale diagnoses, both retired 2026-09-22

**"Blocked on Plus! 98 assets."** Not any more. `--trace-fs` shows the scene
loading cleanly: `FindFirstFile(".\*.scn") → "architec.scn"`, then
`ar_textu.gif` read in full, then `ar_mesh.x` opened. The directory probes that
look alarming — `.\Backdrop`, `.\Informs`, `.\Textures`, `.\Scenes` all
returning INVALID — are the app's search-path fallback doing its job; the
assets sit flat beside the exe and it finds them there. `--dx-surfaces`
confirms the decode end to end: two 256x256 8bpp texture surfaces with 233
colours and real palettes, plus an 800x678 backdrop with 160.

**"D3DRM black output."** The right shape, the wrong word. The offscreen render
target is not black, it is *uniform*: `slot=7 640x480 flags=0x4 colors=1
nonZero=1850/1850` — every pixel written, one colour, and the capture comes out
100% `#f8fcf8`. Something clears the target and nothing draws into it. A colour
count cannot tell those apart from a correct dark scene, which is how one
phrase came to cover several different bugs in the older notes.

Both were also masked by a third thing until 2026-09-22: `d3dxof`'s DllMain was
being abandoned half-way, which is the subject of
`docs/re-notes/dx-sdk-d3drm-samples.md`. Fixing that is what let these get far
enough to fail interestingly.

## Where it actually stops

An `--trace-api` census over 6000 batches, filtered to the COM interfaces, is
the whole story — note what is present and what is absent:

```
 41 IDirectDrawSurface_Release      7 IDirectDraw_CreateSurface
 20 IDirectDrawSurface_QueryInterface   5 IDirectDrawSurface_Blt
  4 IDirect3D2_Release              2 IDirect3DTexture2_Release
```

There is **no `Execute`, no `BeginScene`, no `DrawPrimitive`, nothing that
submits geometry.** The sequence d3drm actually performs is:

1. `IDirect3D_QueryInterface(IID_IDirect3D2)` → S_OK, then
   `IDirect3D2_EnumDevices`, then it releases D3D and DirectDraw and walks away
   (`#5713`-`#5754`). This one is a capability probe, and it also reads
   `HKCU`/`HKLM` registry values in the middle of it.
2. Later, `IDirect3D2_CreateDevice` **succeeds**, `IDirect3DDevice2_GetCaps` is
   read, and the device is released again — then a texture is QI'd and released
   (`#11920`-`#12039`). That whole block repeats verbatim later at `#21931`.

So a device is obtainable and d3drm asks for one, inspects its caps, and hands
it back without ever rendering. The next step is therefore **what
`IDirect3DDevice2_GetCaps` reports**, not the rasterizer: d3drm is choosing not
to use the device it just made. `$handle_IDirect3D2_EnumDevices`
(`src/09aa-handlers-d3dim.wat:222`) does invoke the callback through
`$d3d_enum_devices_invoke`, so "no devices enumerated" is already ruled out.

Compare `dx_globe`, which *does* render a lit textured sphere through the same
d3drm — so the D3DIM path is not wholly broken, and the difference between
these two is the lead worth pulling.

## Baseline, 2026-09-22

4000 batches, one capture each, after the DllMain fix. All seven exit 0 and
none puts up a message box:

| app | API calls | colours |
|---|---|---|
| `scr_architec` | 25643 | 1 |
| `scr_fallingl` | 24708 | 1 |
| `scr_geometry` | 20132 | 44 |
| `scr_jazz` | 72992 | 55 |
| `scr_oasaver` | 23538 | 1 |
| `scr_rockroll` | 23976 | 1 |
| `scr_scifi` | 20713 | 1 |

`scr_geometry` gave 1 colour at 8000 batches and 44 at 4000, so these are
animating and a single capture is a sample, not a verdict — take several
budgets before reading anything into one number.
