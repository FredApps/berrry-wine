# 3dfx Glide support design

Status: first Glide 2 implementation, 2026-09-28. The architecture below
includes future work; it is not a claim of complete Glide compatibility.
The implementation exposes one TMU with 4 MiB texture memory, 63 canonical
Glide 2 entry points and their decorated aliases, immutable command batches,
WebGL rendering and native WAT software rendering. Glide 3 and two TMUs remain
future milestones. See [NFS III integration evidence](re-notes/need-for-speed-glide.md)
for tested behavior and compatibility boundaries. The first two milestones
below are complete for the NFS III route on both rendering backends.

## Summary

Implement `glide2x.dll` and `glide3x.dll` API interception, normalize their
state and draws, and reuse the shared GPU and software rendering machinery.
We do not need to emulate a Voodoo PCI device to support ordinary Windows
games calling Glide.

```text
Guest game / original renderer DLL
               |
    glide2x / glide3x API thunks
               |
    Glide context, vertex layouts, texture address spaces
               |
    immutable draw/resource commands + Glide shading semantics
               |
       +-------+--------------------+
       |                            |
    WebGL executor           WAT software executor
       |                            |
       +------- ordered presentation / LFB access

Reuse: queues, resources, shader infrastructure, rasterizers, presentation
New:  Glide ABI, state machine, texture addressing, semantic conversions
Hard: depth, coverage, combiners, palettes/NCC, framebuffer synchronization
```

This is a medium-sized compatibility subsystem. A first game can use a
bounded subset, but a renderer that merely produces a picture is not enough:
race/HUD transitions, texture replacement, and framebuffer accesses must work.
Glide support alone will not fix low FPS when the selected backend still
rasterizes every pixel on the CPU.

## Targets and evidence

The following local payloads contain Glide renderer paths. Presence of a DLL
or symbol does not establish that its path currently launches successfully.

| Local candidate | Evidence | Initial role |
| --- | --- | --- |
| NFS III demo | `voodooa.dll`, `voodoo2a.dll`; references to `glide2x.dll` | First Glide 2 race/HUD target; compare with native Direct3D path |
| Unreal Special Edition | `system/glidedrv.dll`, Glide 2 references | Second engine; textures, fog and multitexture coverage |
| Deus Ex demo | Installed `system/glidedrv.dll`, Glide 2 references | Later UE1 coverage; verify launch manifest mounts the selected renderer |
| GTA2 demo | `DMAGlide.dll`, `3dfx.dll`, Glide 2 references | Additional 2D/3D mixing and texture workload |
| Diablo II demo | `d2glide.dll` imports `glide3x.dll`; existing notes record failure at `_grGet@12` | First Glide 3 target |
| Quake II / Half-Life Uplink | Bundled `3dfxgl.dll` OpenGL mini-drivers | Indirect users; lower priority because our OpenGL path already exists |

Our NFS II fixture is the original software/DirectDraw demo, not the separate
Glide-capable Special Edition. Do not label it a Glide test without obtaining
and recording the appropriate fixture. Unreal Tournament '99 is a broader
Glide target; the exact local demo renderer payload was not verified in this
inventory. UT2003/2004 are not substitutes for that Glide-era target.

Other well-known targets include NFS II SE, Tomb Raider's 3dfx version, POD,
and Carmageddon 1/2. Version and patch requirements differ; DOS versions need
a separate runtime integration, beyond Windows DLL interception. See the
[Glide game catalog](https://www.pcgamingwiki.com/wiki/List_of_Glide_games).

A preliminary printable-symbol scan found 66/67 distinct `gr*`/`gu*` names
in NFS III's two renderer DLLs, 53 in Unreal, 55 in Deus Ex, 18 in GTA2's
`DMAGlide.dll`, and 37 in Diablo II's renderer: 93 distinct strings combined.
These counts include potential dynamic lookups and are neither an executed
API census nor a count of distinct normalized semantics.

Related investigations: [NFS demos](re-notes/need-for-speed.md),
[Diablo II](re-notes/diablo2-demo.md),
[Unreal-family demos](re-notes/unreal-family-demos.md).

## Scope and compatibility contract

First support ordinary Win32 Glide 2.x DLL consumers, followed by Glide 3.x.
Keep the original game renderer DLLs intact. Resolve both static imports and
dynamic `LoadLibrary`/`GetProcAddress` usage through the existing thunk system.
Verify decorated names, argument widths, float arguments, return values and
stdcall cleanup against each version's headers; similarly named functions
must not be assumed ABI-compatible across versions. Add ordinal mappings
only when supported by a known DLL export table.

Expose a documented virtual board profile rather than claiming every Voodoo
capability. Texture memory size, TMU count, resolutions, extensions and query
results must agree with implemented behavior. A two-TMU profile is an eventual
goal; advertise only the supported profile at each milestone. Do not claim
unsupported rendering operations succeeded. Preserve the repository's
fail-fast diagnostics for missing operations, while implementing specified
API error returns for invalid calls.

Initial exclusions: register/MMIO access, PCI discovery, original 3dfx kernel
drivers, cycle-accurate timing, SLI emulation, DOS `GLIDE2X.OVL` integration,
and exhaustive Voodoo-generation-specific pixel fidelity. Record deliberate
visual approximations; broad hardware fidelity is a later compatibility tier.

## Architecture and state ownership

The guest-facing WAT layer owns API validation, context handles, selected
context/board semantics, vertex layout interpretation, and guest-visible
memory. Allocate through the region/heap machinery; do not introduce fixed
WASM addresses. Use guest-span helpers for potentially noncontiguous arrays
and uploads, with checked sizes and arithmetic.

Each context owns render state, front/back/aux buffer identities, TMU state,
texture-memory mappings, palette/NCC generations, and LFB lock state. Model
context selection and concurrency according to the applicable Glide version;
do not invent one global cross-thread mutable renderer state. Serialize each
context's command stream and preserve resource lifetime across queued work.

Normalize vertices into screen position, explicit depth mode/value, reciprocal
W, color/alpha, fog inputs and per-TMU texture coordinates. Retain enough
information for Glide 2 fixed layouts and Glide 3 configurable layouts.
Never reinterpret a `GrVertex` as a D3D vertex based only on similar fields.

Draw commands contain immutable state snapshots or references to immutable
interned state, copied vertex data, and versioned resource references. A
later guest state change or upload must not change an earlier queued draw.

### Existing backend reuse

| Component | Reuse and boundary |
| --- | --- |
| `lib/gpu-backend.js` | WebGL resources, programs, raster state, draw/readback primitives |
| `lib/d3d9-backend.js`, `lib/d3d9-fixed.js` | Existing shader/geometry lowering where semantically equivalent; factor reusable helpers rather than fake guest COM calls |
| `lib/d3d9-software-backend.js`, `lib/d3d-shader-ir.js` | Candidate software shader/quad execution route; audit representable Glide semantics before selecting it |
| `lib/d3d-command-stream.js`, `lib/d3d-render-worker.js` | Ordered transport, completion and resource ownership; extend the neutral command path without pretending Glide state is a D3DIM snapshot |
| `lib/d3dim-gpu.js` | Reference for transformed vertices and GPU/DIB ownership; its current descriptor is D3D-specific, not a ready-made Glide ABI |
| Existing browser presentation and window handling | Reuse window/canvas lifecycle, sizing, input and frame delivery |

Prefer one normalized Glide shading description with GPU and WAT lowering.
If an operation cannot be represented by existing fixed-function lowering,
extend the shader representation or add a Glide-specific shader generator.
Do not silently replace it with the nearest D3D state. The legacy D3DIM
software rasterizer may supply reusable primitives, but is not assumed to
cover all Glide combinations or both TMUs unchanged.

Proposed new modules are a Glide WAT frontend/state fragment, a host resource
adapter, and shared Glide shader lowering. Final filenames follow source
ordering conventions. API IDs must be appended, generated
dispatch/hash files regenerated, and new WAT fragments included in
`src/main.watx`. The first implementation uses `src/09a8h-glide.wat`,
`lib/glide-host.js`, `lib/glide-backend.js` and `lib/glide-software.js`.

## Semantic differences to implement explicitly

The [3dfx Glide 2 reference](https://www.gamers.org/dEngine/xf3D/glide/glideref.htm)
and [Glide 3 reference](https://www.3dfxglide.com/download/GL3REF.PDF) are the
specification starting points. Pin the relevant SDK/header version during
implementation; do not infer exact equations from this summary.

| Area | Required treatment | Typical failure |
| --- | --- | --- |
| Coordinates and interpolation | Convert screen origin and pixel convention; handle `sow`, `tow`, `oow` and TMU-specific values with the correct perspective interpolation and texture scale | Swimming textures, seams, inverted images |
| Depth | Preserve Z/W modes, comparisons, range, bias, write masks and relevant precision; derive the conversion rather than copying the input into WebGL depth | Incorrect occlusion, flicker, missing polygons |
| Color and alpha combiners | Express local/other inputs, factors, inversion, intermediate clamping and RGB/alpha operations explicitly | Wrong brightness, lightmaps or transparency |
| Multiple TMUs | Preserve each unit's source, coordinate inputs, sampler state and combine order | Missing detail/lightmaps or wrong modulation |
| Texture formats | Decode packed formats, palettes and NCC/YIQ tables; version table changes independently of texel uploads | Wrong colors or stale textures |
| Mipmaps | Preserve aspect ratio, LOD conventions, level layout and even/odd level masks | Incorrect mip selection, corruption or shimmer |
| Coverage | Specify pixel centers, edge ownership, clipping and rounding; test shared edges and subpixel positions | Cracks or double-blended edges |
| Fog | Implement table generation/lookup, source selection and composition order | Incorrect haze or distance transitions |
| Chroma key and alpha test | Compare the appropriate value at the specified stage, including interaction with filtering | Dark outlines, holes or opaque sprites |
| LFB access | Honor buffer selection, origin, format, stride and pixel-pipeline flag semantics; order accesses against rendering | Corruption, stale reads or frequent GPU stalls |
| Swap/finish/query | Distinguish command submission, completion and presentation; account for swap interval and pending swaps | Flicker, stale frames or avoidable blocking |
| Dithering and gamma | Keep render-target quantization/dither and display gamma separate | Banding or incorrect captured/displayed colors |

Coverage defects can resemble a horizontal seam, but this is not a diagnosis
of the separately reported NFS III Direct3D artifact.

### Texture memory is an address space

`grTexSource` selects an address and texture interpretation within a TMU's
virtual memory. An address alone is not a stable texture object identifier.
Track uploaded ranges, format/LOD interpretation, and generation numbers.
Overlapping partial uploads invalidate affected cached views, not just a
cache entry with the same starting address. Validate reported memory limits.

Palette/NCC changes must affect subsequent draws using those tables even
when texture bytes have not changed. Keep versions alive until their queued
draws retire, or fence before modifying storage still in use. Test the
sequence draw A, overwrite/table change, draw B before optimizing it.

### Framebuffer ownership and ordering

Keep GPU-rendered surfaces resident until a guest operation needs CPU-visible
pixels. LFB lock returns a stable, correctly formatted guest-accessible view;
reads require all earlier writes to that buffer to complete. A write unlock
publishes CPU modifications before later draws sample or render that buffer.
Unless the API provides a trustworthy dirty range, assume the writable locked
area may have changed. Some lock modes apply the pixel pipeline, so a raw
memory copy is not universally sufficient.

Queued swaps must preserve front/back identity for subsequent locks, reads,
clears and draws. Define a GPU/CPU generation and last-writer record per
surface. An outstanding readback or queued draw holds a resource lease so
close/reopen cannot reuse its storage early. Avoid GPU readback on every draw
or every ordinary swap merely to reuse a CPU-DIB presentation path; assess
existing GPU presentation facilities before designing the adapter.

## Performance and diagnostics

Batch adjacent draws only when state, texture generations and ordering permit.
State setters should not automatically fence or issue a synchronous host RPC.
Cache texture conversion and shaders by semantic state, and use a small
number of owned upload buffers rather than allocating per triangle. Do not
reorder transparent geometry to reduce state changes.

Provide a per-frame/API census from the start:

- API calls by name; draws, submitted triangles, state changes and shader variants.
- Texture upload/conversion bytes and palette/NCC invalidations.
- LFB locks/readbacks, bytes copied, fence reason/count, guest wait time.
- Producer CPU time, worker replay time, queue depth, presented frames and
  distinct rendered frames; GPU time only when a reliable timer is available.
- Backend fallbacks classified by semantic reason, with a bounded diagnostic.

Report overlapping worker/wait times separately. A high presentation count
does not establish an equally high game frame rate. Benchmark a fixed scene
and input sequence with threads enabled, on CPU and GPU backends, including
Safari and Chromium. Do not disable guest threads to conceal ordering bugs.

## Implementation milestones

1. **Inventory and ABI.** Capture actual imports/dynamic lookups for NFS III,
   then runtime calls. Add context initialization, discovery, versioned query
   semantics and exact thunk ABI tests. No unsupported capability claims.
2. **Glide 2 core.** Clear/swap, triangles, one-TMU uploads/sampling and the
   blend/depth/chroma/fog subset exercised by NFS III. Verify race entry,
   cockpit HUD, movement and repeated frames on both backends.
3. **Second engine and semantic breadth.** Exercise Unreal/Deus Ex; complete
   required two-TMU, mipmap, table, fog and LFB behavior. Add GTA2 as an
   independent workload rather than equating one engine with general support.
4. **Glide 3.** Add configurable vertex layouts, context/query differences and
   extensions actually needed by Diablo II. Verify game/menu transitions and
   gameplay without regressing Glide 2.
5. **Performance and robustness.** Measure batching, texture caching and LFB
   synchronization; validate close/reopen, resource exhaustion and backend
   failure. Expand titles only with recorded renderer-path evidence.

A small LFB implementation may be needed before milestone 2 completes: the
runtime census determines this, not the milestone numbering.

## Validation and acceptance

Use SDK samples and focused fixtures with independent expected pixels for
shared-edge coverage, perspective interpolation, Z/W comparisons, blend and
combiner equations, chroma/alpha behavior, and texture table updates. Test
Glide 2/3 ABI stack cleanup and vertex-array layouts separately from drawing.
Include uploads and output structures crossing guest memory boundaries.

Exercise partial/overlapping texture uploads, odd/even mip levels, palette
changes between queued draws, LFB read/write origins and pitches, front/back
locks around swaps, and destruction with pending commands. GPU/software
agreement is useful but insufficient: both could share the same wrong
conversion. Compare with documented expectations and, where available, real
hardware captures or independently validated wrapper output. Record the
reference version and pixel tolerances; packed-color/coverage tests should
have exact expectations where practical.

An application acceptance result must record fixture hash, selected original
renderer DLL, Glide API version, backend, worker mode, browser, screenshot
stages, advancing gameplay and input, missing operations, fallbacks and
per-frame costs. Test the actual browser dropdown/launch path as well as CLI.
A loaded DLL or first textured triangle alone is not a compatibility pass.
Keep proprietary fixtures local according to their existing corpus policy.

## Effort estimate and open decisions

These are planning ranges for new handwritten code, excluding tests,
generated API tables and assets, not measured implementation sizes:

| Scope | Approximate API coverage | Approximate code |
| --- | --- | --- |
| One-game subset | 30-60 meaningful calls, plus required discovery/helpers | 3-6k lines |
| Useful Glide 2 + 3 coverage | 80-120 calls, subject to census | 8-15k lines |
| Broad compatibility | Extensions and hardware-specific accuracy | Not yet bounded |

WAT verbosity, backend gaps and LFB behavior can move these estimates
substantially. Schedule estimates require the first runtime census and a
backend semantic audit. Number of exported functions is not the main cost;
many setters are small while one framebuffer-lock path can be substantial.

Resolve before implementation expands:

- Exact virtual board profile and initial advertised TMU/texture limits.
- Which shared shader operations need extension for depth, fog and combiners.
- Whether GPU presentation can avoid routine full-frame DIB readback.
- Context selection/thread rules for the targeted Glide SDK versions.
- Fidelity targets: game-correct output versus reproducing specific Voodoo
  quantization, dithering and filtering artifacts.

The recommended first deliverable is NFS III's native Glide 2 path with
measured, correct race rendering. Keep its working Direct3D configuration as
a comparison route; do not switch app defaults until the new path passes
the acceptance checks.
