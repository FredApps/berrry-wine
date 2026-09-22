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

## It renders. Everything below about "where it stops" was a budget artifact

**`scr_architec` draws its scene correctly.** At 120000 batches the primary
surface comes back `640x480 bpp=16 colors=259 nonZero=1845/1850` and the capture
is a textured, lit, perspective-correct 3D interior — marble columns, stairs,
the green growth forms the screensaver is named for. Nothing in the emulator
needed fixing for that.

Every earlier verdict on this cluster — "blocked on assets", "D3DRM black
output", "stops at GetCaps and never submits geometry" — came from captures at
**4000 to 8000 batches**, and this app is still loading then. The `--trace-api`
census reproduced below is real, but it is a census of the *loader*, not of a
renderer that declined to run: the `CreateDevice` / `GetCaps` / `Release` triple
that looked like a device being rejected is `D3DTexture.cpp` probing texture
size limits (the app logs it as `Hardware driver reports min/max texture size as
%dx%d-%dx%d`), and it releases that device because it was only ever asking a
question.

There were in fact **two** independent measurement faults stacked on each other,
and the second is the sneakier. An earlier 200000-batch capture of `scr_jazz`
exists and is a uniform `#f8fcf8` field — that is where the "the render target
is not black, it is *uniform*" line below came from. But that capture picked a
**cleared offscreen surface**, not the primary: the same app at 120000 batches,
captured with `--dx-surfaces` in the command, reports `Wrote ... (dx slot 3)`
and shows real geometry, while its slot 5 is exactly the `colors=1
nonZero=1850/1850` uniform field. So a longer budget alone would not have
rescued it — a bare `--png` can photograph the wrong surface, and a uniform
picture is as likely to mean "you photographed the wrong buffer" as "nothing
drew". **Always run `--dx-surfaces` alongside `--png` on a DirectX app** and
check which slot the capture named against the one carrying content.

The general lesson, which is why the wrong version is left standing above the
right one: **a capture is a sample, not a verdict**, and an app that loads for
tens of thousands of batches looks exactly like an app that renders nothing.
The three things that would have caught it sooner, in increasing order of cost:
a second, much larger budget (`--max-batches=120000`); `--dx-surfaces`, which
distinguishes a primary that was cleared and never written from one carrying a
scene; and the app's own diagnostics — see the next section, which is the part
of this file worth keeping.

## The real open bug: lit geometry shades to black

Re-measured at 120000 batches, the cluster splits, and the split is about
*shading*, not about whether anything draws:

| app | captured surface | reading |
|---|---|---|
| `scr_architec` | 259 colours, 1845/1850 | draws — textured lit interior |
| `scr_fallingl` | 196 colours, 1814/1850 | draws — but a subset of leaves are solid black silhouettes |
| `scr_geometry` | 83 colours, 1473/1850 | draws — yellow frame correct, the small octahedra are black |
| `scr_oasaver` | 148 colours, 197/1850 | draws — correct-looking forms, plus a stray white box bottom-right |
| `scr_rockroll` | 119 colours, 1849/1850 | draws — lit form on a sunset gradient, small black patches |
| `scr_scifi` | 119 colours, 1843/1850 | draws — red sky over dunes; **two creatures lit orange, two identical ones solid black** |
| `scr_jazz` | 13 colours, **14/1850** | geometry is right, *everything* shades to near-black |

All seven draw. The split is about *shading*, and `scr_scifi` is the sharpest
statement of it: four creatures of the same mesh in the same scene, two shaded
correctly orange-and-yellow and two rendered as flat black silhouettes against
a correctly lit dune. Nothing about the rasterizer, the texture path or the
geometry can produce that — only a per-object material or light lookup that
sometimes resolves to zero.

`scr_jazz` is the degenerate end of the same thing: the five shapes are in the
right places with the right silhouettes, rendered as sparse white speckle on
black — a 16bpp dithered near-zero colour, not an absence of triangles. The
same failure appears partially in `fallingl` (black leaves beside correctly
textured ones), `geometry` (black octahedra beside a correctly lit frame) and
`rockroll` (small black patches). So one bug spans the cluster and it is in the
lighting/material path, not the rasterizer.

One capture note for `scr_scifi` specifically: its `flags=0x1` primary is
`colors=1 nonZero=0/1850` — empty — and the scene lives in its two back buffers
(slots 6 and 34). It flips rather than blitting to the primary, so on this app
the primary is the *wrong* surface to judge by, which is the mirror image of
the `scr_jazz` trap above.

`src/09ab-handlers-d3dim-core.wat` has the real implementation to interrogate:
`$d3dim_vertex_lit_color` (emissive + ambient·mat.ambient + Σ light·mat.diffuse·N·L)
and, above it, `$d3dim_vertex_shade_fallback`, which is what runs when
`$d3dim_light_n` is 0 — it shades from `$d3dim_current_material_color`, so a
material whose colour resolves to 0 renders black by construction. The
instrument already exists: `--trace-dx` emits

```
[dx] Lights  n=<count> ambient=<D3DCOLOR> light0=<type col= pos= dir=> material=<diffuse= ambient= emissive=>
```

once per change (kind 19), and its comment says exactly why it was added —
"white geometry" and "no material bound" render the same and cannot be told
apart from the API trace. Window it with `--trace-from`/`--trace-to` around a
frame late enough to be past loading.

## Reading the app's own log without a log file

These are Computer Artworks *Organic Art*, and they are unusually talkative.
`--trace-reg` shows the knobs: `TraceLevel`, `DisableLogFile`,
`FlushLogAggressively`, `DisableHardware`, `ForceRGB`, `DefaultD3DDevice`,
`DisableAllTextures`, `RenderMode`, `DeviceRenderQuality` and about forty more,
all under `HKCU\Software\Computer Artworks\Organic Art\Plus`. Seeding them with
`--reg-import` works (`TraceLevel` reads back), but no log file is ever opened —
the run makes no `WriteFile` call at all — so the knob alone does not get you
the log.

The text is still reachable, because the binary keeps its whole vocabulary as
literals and funnels them through one printf-style trace function at
`exe+0x68d60`, called as `trace(level, fmt, ...)`:

```
node test/run.js --app=scr_architec --quiet-api --no-close \
  --max-batches=8000 --trace-at=0x74468d60
```

`--trace-at` prints `[esp+0]`…`[esp+20]` on every hit, so `[esp+8]` is the
format-string pointer; resolve the collected pointers with `tools/dump_va.js`
and the app narrates itself — `Loading %s as mesh`, `Making texture [%#08x]
conformant to device caps`, `Hardware reports D3DPTEXTURECAPS_POW2`, `Scene
SetBackdrop("%s")`, `Viewport Dirtied`. 607 such calls in 8000 batches, and all
of them are loading. That sequence is what says "still working" rather than
"stuck", and it is available for any app that logs through one formatter.

The assertion strings are just as useful and are matched by
`"<the failing C++ expression>" failed`, e.g.
`"D3DMgr::GetD3DRM()->CreateDeviceFromD3D(GetD3D(), GetD3DDevice(), &pD3DRMDevice)" failed`.
`tools/find_string.js` locates one, `tools/find_bytes.js --push=0xVA` finds the
site that pushes it, and `--count` says whether that path was taken — but
**`--count` only fires on basic-block entries**, and an assert's `push` is in
the middle of its block. Counting the push site returns 0 whether the assert
fired or not. Count the branch target instead (`tools/find_fn.js` and a short
`disasm_fn.js` around the `test`/`jge` pair give it); a zero from the push
address means nothing at all, and it cost this investigation an hour.

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
