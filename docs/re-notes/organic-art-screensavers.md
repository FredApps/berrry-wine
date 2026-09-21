# Organic Art / D3DRM screensavers (Plus! 98)

`test/binaries/screensavers/{ARCHITEC,FALLINGL,GEOMETRY,JAZZ,OASAVER,ROCKROLL,SCIFI}.SCR`

Seven Direct3D Retained Mode savers that share one engine. Each one is a `.SCR`
with a matching `.SCN` scene file, a `.THE` theme, a wallpaper `.GIF` + `.PAL`,
one or more `.X` meshes and texture `.GIF`s, all in the same flat directory.

They sat at WARN in `test/test-all-exes.js` (`ORGANIC_ART_D3DRM_SMOKE`,
`maxBatches: 7000`) for a long time. **Five of the seven are not broken — the
sweep budget ends before their first frame.** Details below, because the shape
of the evidence is reusable.

## Module layout

The `.SCR` loads at a high base, not `0x400000`:

```
PE loaded. Entry: 0x74492290          <- ARCHITEC.SCR itself, base ~0x74400000
DLL: comctl32.dll at 0x74612000  origBase=0xbfc00000
DLL: oleaut32.dll at 0x7479e000  origBase=0x65340000
DLL: d3drm.dll    at 0x74930000  origBase=0x64780000
d3dxof.dll loaded at 0x74aa0000        <- late, pulled in by d3drm for .X parsing
```

This matters: a hot `EIP=0x7440f532` is *below* every line in the `DLL:` list,
which reads as "unknown module" until you notice the exe is up there too. It is
`exe+0xf532`. `d3dxof.dll` is loaded by `LoadLibraryA` from inside `d3drm`
partway through the run, so it never appears in the startup `DLL:` block.

`d3drm.dll` and `d3dxof.dll` both print `WARNING: DllMain did not return
cleanly` and both work anyway — that warning is not the bug here.

## Why they looked dead: they are decoding the backdrop GIF

At 7000 batches ARCHITEC's API census is 16,381 calls of which **14,672 are
`EnterCriticalSection`/`LeaveCriticalSection` pairs** (the CRT allocator lock),
and the last non-CS calls are a run of `ReadFile`. That reads like a spin.

It isn't. The per-batch EIP dump names the loop:

```
[6975] EIP=0x7440f5ac EAX=0x00000320 ECX=0x5036c1c0 EDX=0x5032e000 EBP=0x0000013e
[6992] EIP=0x7440f76b EAX=0x00000000 ECX=0x5036c4e0 EDX=0x00000008 EBP=0x0000013f
```

`EAX = 0x320 = 800`, `ECX` advances by `0x320` per iteration, `EDX` is a DIB
base, and `EBP` counts `0x13d → 0x13e → 0x13f`. That is a **scanline counter
running a GIF LZW decode into the 800×678 backdrop**, at roughly 17 batches per
row. `AR_WALLP.GIF` is 678 rows, so the decode alone wants ~11,500 batches, and
the mesh load and first frame come after it.

`--dx-surfaces` says the same thing independently — at 7000 batches:

```
slot=5  640x480 bpp=16 flags=0x1 colors=1   nonZero=0/1850      <- primary, blank
slot=6  640x480 bpp=16 flags=0x2 colors=1   nonZero=0/1850      <- back buffer, blank
slot=11 256x256 bpp=8  flags=0x4 colors=233 nonZero=1849/1849   <- texture, loaded
slot=20 800x678 bpp=8  flags=0x4 colors=131 nonZero=912/1920    <- backdrop, ~half
```

The backdrop being *half* written is the tell: row 319 of 678 matches the `EBP`
counter exactly. Textures decode fine; the render target has simply never been
touched yet.

At 60,000 batches the same two surfaces come back
`colors=188 nonZero=1845/1850` and the capture is a fully textured 3D
architectural scene — marble columns, stairs, malachite inlay, correct
perspective.

## Status at 60,000 batches (`--batch-size=1000 --quiet-api`)

**Look at the picture, not the colour count** — the sweep's blank threshold
passes a backdrop gradient, and three of these draw nothing but their backdrop.

| saver | colours | what is actually on screen |
|---|---|---|
| ARCHITEC | 242 | **full scene** — textured marble columns, stairs, malachite |
| FALLINGL | 218 | **full scene** — a dozen distinct textured leaves |
| SCIFI | 123 | **full scene** — textured terrain under a red sky |
| ROCKROLL | 84 | backdrop gradient only; `RO_GIT.X`/`RO_PICK.X` never appear |
| GEOMETRY | 60 | backdrop gradient only; `GE_MESH1.X`/`GE_MESH2.X` never appear |
| JAZZ | 1 | blank |
| OASAVER | 1 | blank |

`WIN98.SCR` sits next to these in the directory and is **not** part of this
family — it is an MFC saver and renders at 1714 colours.

## Four of the seven are a real gap, and it is not budget

GEOMETRY, JAZZ and OASAVER were re-run at **200,000** batches (76s / 91s / 62s)
and came back at exactly the same 60 / 1 / 1 colours. More budget does nothing
for them.

The split is by geometry, not by engine: the same renderer textures and
rasterizes a full scene for ARCHITEC, FALLINGL and SCIFI. Suspect the `.X` mesh
path. One lead, not yet chased — `--trace-fs` shows GEOMETRY opening
`ge_mesh1.x` and `ge_mesh2.x` **four times each** and never issuing a single
`ReadFile` against any of those handles. ARCHITEC opens `ar_mesh.x` eight times
with no `ReadFile` either, though, so repeated opens are normal d3drm probing
and the absent reads mean the bytes arrive by some path `--trace-fs` does not
cover (file mapping?). Establish how a *working* saver gets its mesh bytes
before reading anything into the failing one.

## Sweep config

`ORGANIC_ART_D3DRM_SMOKE` in `test/test-all-exes.js` was `maxBatches: 7000`,
`timeoutMs: 30000`, no `--quiet-api`. Now 60000 / 90000 / `--quiet-api`, which
takes that block from **7 WARN to 5 PASS + 2 WARN** with the two remaining WARNs
honest. `--quiet-api` is not optional at the larger budget: these make over 1.2M
API calls per run and the default one-line-per-call trace is a blocking stdout
write on the guest's own thread — see the `--quiet-api` measurement in
`CLAUDE.md` (3:53 wall vs 1:17 for identical CPU).

The negative control is the mechanism itself rather than a config flip: at 7000
batches `--dx-surfaces` reports the primary and back buffer `colors=1
nonZero=0/1850` while the backdrop is half-written, so the blank is the capture
landing before the first present, not a render that failed.

## Not this family

`CORBIS`, `FASHION`, `HORROR`, `WOTRAVEL` are MFC photo savers, not D3DRM. They
quit after ~12 batches because `CoCreateInstance` for CLSID
`{4FD2A832-86C8-11D0-8FCA-00C04FD9189D}` / IID `{4FD2A833-…}` fails — that is
**DirectAnimation**, a separate and much deeper gap. See
`project_corbis_directanimation`.
