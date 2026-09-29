# NFS III original Glide renderer

Status: original-renderer race/input acceptance verified in Chrome with both
WebGL and native WAT software rendering.

Use the existing `nfs3_demo` fixture and keep its renderer DLLs unmodified.
Set `HKLM\Software\Electronic Arts\Need For Speed III Demo` values:

| Name | Type | Value |
| --- | --- | --- |
| Thrash Driver | REG_SZ | `voodoo` |
| D3D Device | REG_DWORD | `0` |

This selects `voodooa.dll`, SHA-256
`6c7b0a1bd3ea4f7c673b7ff89db25379939171d33b1a969aa2506e44b8103b77`.
The alternative stem `voodoo2` is not yet runtime verified.
Select the renderer through the registry; the normal app default need not change.

## Baseline trace, 2026-09-28

The initial trace used the main checkout's compiled WASM copied into this
worktree, because that build includes the Watcom BSS initialization fix.
It is external baseline evidence, not validation of the new Glide source.
The original renderer loads at `0x00b30000`, preferred base `0x60000000`;
convert a runtime address to the preferred VA by adding `0x5f4d0000`.
Its `DllMain` at runtime `0x00b3480e` returns 1.

The DLL has `.bss` with VirtualSize 0, RawSize `0x1a00`, RawPointer 0.
The PE loader must zero this unbacked section instead of copying file headers.

`LoadLibraryA("glide2x.dll")` is followed by 58 distinct decorated `GetProcAddress`
lookups, matching every name in the `voodooa.dll` static inventory at
`build/glide/nfs3-api-inventory.json`. These lookups are executed evidence;
they do not establish that the game actually calls every API.
The baseline returned zero for all 58. It then called the null `grGlideInit`
pointer at runtime `0x00b31dbd`, with return address `0x00b31dc3` (batch 4).
The next call is `grSstQueryHardware` with the hardware output at preferred VA
`0x60011504`; a false result exits initialization.

Repeatable trace (registry snapshot must contain the values above):

```sh
node test/run.js --app=nfs3_demo --threads --real-ticks --no-build \
  --quiet-api --quiet-blocks --stuck-after=100000 --max-batches=100000 \
  --max-seconds=40 --batch-size=10000 \
  --reg-import=build/glide/voodoo-reg.json \
  --trace-reg --trace-api=LoadLibraryA,GetProcAddress --trace-api-dedup
```

The CLI imports snapshots before app startup defaults. If the app later adds
defaults, use an explicit launch override or the browser harness's isolated
startup-registry override. Never modify the shared fixture manifest for a probe.

## Acceptance

`test/test-nfs3-glide-web.js` uses the ordinary browser app selection and launch
with workers enabled, records the fixture hash and console output, and saves
screenshots and runtime counters under `build/nfs3-glide/`. Both WebGL and
software must be exercised. Loading the native DLL and drawing its loading
picture alone do not pass: inspect race/HUD output, advancing frames and
accelerator input. Safari needs separate coverage from this Chromium harness.

The 2026-09-28 WebGL integration run used Chrome 153.0.8010.53 with real
workers and the unmodified renderer hash above. The displayed screenshot
shows the cockpit, HUD and track at 43 MPH after holding Up; the race clock
advanced to 0:04.39. Geometry advanced from 109,402 to 301,213 triangles and
595 to 696 presentations, with zero renderer errors and no guest traps.
Texture uploads and both LFB reads and writes ran along this route.
Artifacts: `build/nfs3-glide/webgl/{stats.json,race-before.png,race-after.png}`.

The software run on the same browser and fixture also passed: the car moved
from 0 to 61 MPH, the clock advanced to 0:05.12, and the displayed cockpit,
track, car bodies and cutout trees were inspected. Geometry advanced from
102,882 to 223,710 triangles and 536 to 598 presentations, with zero renderer
errors and no guest traps. All 307,200 pixels of the final raw drawable were
verified opaque. Artifacts are under `build/nfs3-glide/software/`.
These loaded-machine runs establish functionality, not comparative FPS.

Use `node test/test-nfs3-glide-web.js` for WebGL or
`GLIDE_RENDERER=software node test/test-nfs3-glide-web.js` for native WAT
software. The harness sets only its page's launch registry, checks the actual
composited canvas for visible geometry, focuses the game and holds Up while
frames advance. It fails on guest-worker traps as well as renderer errors.

Focused pixel tests passed in Chrome WebGL 1/2 and Safari 26.4 WebGL 1/2.
The Safari probe verified truncated mip sampling, W-depth rejection and the
published 2D presentation surface with no GL errors; its local report is
`build/glide/safari-results.json`. This is renderer coverage, not a Safari
full-game acceptance claim.

## Implemented profile and boundaries

The first profile is one Glide 2 board, one TMU and 4 MiB texture memory.
It includes triangles, lines, points, palettes, packed texture formats,
explicit mip selection, color/alpha combiners, depth, fog, gamma, front/back
swaps and RGB565 LFB synchronization. Glide 3, a second TMU, NCC/YIQ textures,
antialiased primitives, auxiliary LFB access and compare-to-bias depth modes
remain unsupported. Unsupported operations fail explicitly. The WebGL color
targets use RGB8 rather than exact Voodoo RGB565 quantization and dithering.

Two integration prerequisites were exposed by the original renderer: its
Watcom zero-raw-pointer BSS must be zero initialized, and a worker must adopt
newly published API/continuation thunks within its current execution slice.
The same-slice thunk regression reproduces the original unreachable trap
when the refresh is disabled. GPU-only windows also need the compositor's
ordinary backing surface before their presentation layer can be displayed.
Each completed frame schedules a compositor repaint. Opening Glide publishes
the selected fullscreen mode and window/client dimensions; close or shutdown
restores the previous mode and window rectangle exactly once, including when
another guest thread closes the board.

## WAT software lowering

`lib/glide-software.js` consumes the same owned packets as WebGL, lowers color
and alpha combiners to normalized PS1.4 IR, and uses
`D3D9SoftwareBackend.Device` for native vertex processing, interpolation,
texture filtering, depth, coverage and pixel shading. JavaScript converts
textures, packs immutable draws and presents BGRA pixels; it contains no
triangle rasterizer. Adjacent equal-state triangles share a native draw,
up to the native descriptor's vertex bound. Texture generations retire on
upload/table mutation, and resident native texture storage is reused between
draws. Front and back colors have distinct identities and share one depth
surface. Ordinary swaps and front-buffer writes publish complete frames.
Depth uses an explicit shared D16 attachment. Coordinates are shifted by half
a pixel when entering the native rasterizer, whose sample centers are integer
based. Independent edge-coverage, color-interpolation and near-equal-depth
fixtures distinguish these choices from the previous float-depth/integer-center
behavior. A captured 189-vertex race packet matches WebGL RGB exactly after
the center conversion.

The presented RGB565 display is always opaque; render-target alpha remains
available for blending. A zero-alpha red draw therefore displays opaque red
while retaining zero alpha in native storage and `0xf800` through LFB readback.
Passing render-target alpha into Canvas2D incorrectly hid car panels and
cutout-tree pixels even when their computed RGB values were correct.

The opt-in `d3d_software_bind_glide` descriptor attaches a copied 64-entry fog
table to a native draw. Global reciprocal W travels in texture coordinate Z;
TMU reciprocal W travels independently in coordinate W for projected sampling.
The rasterizer encodes global W *after interpolation*, including signed
16-bit depth bias, then performs the existing depth test. Table fog uses that
encoding, independently of the selected Z/W depth-buffer mode. The helper
matches the exponent/mantissa formulation of MAME's Voodoo `compute_wfloat`:
reciprocals `1, .875, .75, .625, .5, .25, 0` encode to
`0, 1024, 2048, 3072, 4096, 8192, 65535`.

`test/test-glide-software.js` checks independent expected colors and depth
values for Z/W occlusion, perspective inputs, table fog, palette replacement,
chroma rejection, front/back LFB and native-rendered lines/points. The shared
`test/test-d3d-software-pipeline.js` regression passes 375 native pipeline cases.
The software line path expands one-pixel rectangular geometry; matching the
hardware's diamond-exit edge rule remains a documented fidelity limitation.
Separate RGB/alpha clear masks, two-TMU detail/LOD combiners and unsupported
fog modifier flags are explicit errors rather than accepted approximations.

## Original Glide snapped coordinates

The first native Glide browser run reached `_grDrawLine@8` with vertex x bits
`0x494024dd`, or `787021.8125 = 786432 + 589.8125`. This is an original Glide
coordinate encoding, rather than a corrupted vertex or an NFS-specific offset.
In pinned 3dfx source revision
`2f226f0f9225ce8ee83e6a4a7042981e719d19ee`,
[`glide2x/sst1/glide/src/gsplash.c`](https://github.com/sezero/glide/blob/2f226f0f9225ce8ee83e6a4a7042981e719d19ee/glide2x/sst1/glide/src/gsplash.c#L633)
defines `SNAP_BIAS` as `3 << 18`, adds it directly to projected `GrVertex.x/y`,
and calls `grDrawTriangle` without removing it. The same source tree's
[`gdraw.c`](https://github.com/sezero/glide/blob/2f226f0f9225ce8ee83e6a4a7042981e719d19ee/glide2x/sst1/glide/src/gdraw.c#L124)
explicitly accepts already-biased point coordinates. No hint enables this path.

The [3dfx programming guide](https://www.gamers.org/dEngine/xf3D/glide/glidepgm.htm)
documents signed 12.4 screen coordinates and the `3 << 18` snapping technique.
The frontend decodes precisely the alternate signed coordinate interval
`[786432 - 2048, 786432 + 2048)` by subtracting `786432` from copied x/y only.
Ordinary coordinates and values outside that interval remain unchanged. This
includes biased negative coordinates and preserves the existing 1/16-pixel
precision. All primitive packets share the conversion, so GPU and software
receive the same screen coordinates and guest vertex arrays remain untouched.
`test/test-glide-abi.js` checks both interval boundaries, ordinary positive and
negative coordinates, and the observed NFS bit pattern.
