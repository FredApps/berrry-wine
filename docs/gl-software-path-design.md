# A software path for OpenGL guests: scope, 2026-09-22

## ASCII TL;DR

    FRONTEND (WAT)            DESCRIPTOR                CONSUMER

    D3DIM  09ab ───────────────────────────────────────→ WAT raster 09ah  ✅
           TL verts + 31-dword state                     (0 crossings)

    D3D9   09a*  ──→ JS builds DFX1/DLT1/cascade ──────→ WAT raster 09ah  ✅
                     d3d9-software-backend.js:284-377    (JS orchestrates,
                                                          no pixels in JS)

    OpenGL 09a8e ──→ ??? ──────────────────────────────→ WAT raster       ❌
           verts ✅  matrices ❌  lights ❌  fog ❌            DOES NOT EXIST
           material ❌   (all in lib/gl-compat.js)

Goal: give the OpenGL frontend what D3DIM already has — rasterization that
never leaves WAT — by reusing the descriptor format `09aj`/`09ah` already
define, rather than by routing GL through a JavaScript device object.

**This document is scope, not a plan of record. Nothing here is implemented.**

## Why not the obvious shortcut

The tempting move is to make `lib/d3dim-gpu.js` and `lib/gl-compat.js` share
`lib/d3d9-backend.js`'s `Device.draw(snapshot)`, which is already backend-neutral
and already has two implementations selected at `lib/d3d9-host.js:62`.

For D3DIM that is a **regression**, and it is worth recording why so nobody
proposes it again. D3DIM's software path today is `$d3dim_draw_tl_triangle`
(`src/09ab-handlers-d3dim-core.wat:5632`) — WAT frontend straight into WAT
raster, zero boundary crossings. Routing it through the JS device would insert
`lib/d3dim-gpu.js:_draw`, which builds a `Uint8Array` and byte-swaps every
vertex's D3DCOLOR in JavaScript (`lib/d3dim-gpu.js:340-347`), in front of a
rasterizer that needs none of it. That JS loop is acceptable on the opt-in
`--d3dim-gpu` path, where the destination is WebGL anyway. It is not acceptable
as the default software path.

So the shared artifact is the **descriptor format**, which lives in WAT, and not
a JS object. JavaScript's remaining role is orchestration — allocation,
submission, worker dispatch, fences — which is what
`lib/d3d9-software-backend.js` already is: ~30 WAT export calls
(`d3d_software_create/bind_*/step/clear`), with no pixel ever entering JS.

## What already exists, and where the line falls

| | GL | D3DIM | D3D9 |
|---|---|---|---|
| vertices in WAT | ✅ `09a8e` (immediate, client arrays, `glDrawElements` expanded at `:442-472`) | ✅ | ✅ |
| topology expansion | ✅ WAT (`$gl_finish_immediate`, `09a8c:256-429`) | JS (`d3dim-gpu.js:314-320`) | ✅ |
| transform state | ❌ JS `gl-compat.js:352-354` | n/a (pre-transformed) | ✅ DFX1 +96/+160/+224 |
| lighting | ❌ JS `gl-compat.js:378-384` | n/a | ✅ DLT1 |
| material | ❌ JS `gl-compat.js:385-391` | n/a | ✅ DLT1 +64..+111 |
| fog | ❌ JS `gl-compat.js:392-393` | n/a | ✅ cascade5 row +136..+156 |
| software raster | ❌ **none** | ✅ `09ab` | ✅ `09ah` |

`src/09a8e-gl-state.wat`'s per-context block is **160 bytes** and has **16 free
bytes** (+0, and +148..+159 — neither declared reserved, both simply unwritten
by `$gl_state_save`/`$gl_state_context_changed`). GL's missing state does not
fit in it: the matrix stacks alone are unbounded, and lights are 8 × 4 × float4.
A new per-context allocation is required; this is not a matter of filling spare
fields.

## The five real costs

These are the items that make this a project rather than a wiring change. Each
is a measured difference between the two implementations, not a general-knowledge
concern.

### 1. Specular does not exist in the D3D lowering

GL computes Blinn half-vector specular per light and folds it into the vertex
colour (`lib/gl-compat.js:260-263`). The DLT1 accumulator has no specular term
at all: the light loop does `dp3(N,L)` → clamp → `mad` into a diffuse
accumulator, then emits `oD0.rgb = md*r5 + r4`
(`src/09aj-d3d-fixed.wat:686-697`). The DLT1 header carries no shininess and no
material-specular field (`:582-586`).

So reusing DLT1 unchanged means **GL loses specular highlights**. Either DLT1
grows those fields and the lowering grows the term, or the GL path declines to
WebGL whenever `uMaterialShininess > 0`.

### 2. Positional lights

GL branches on `uLightPosition[i].w` and supports positional lights
(`lib/gl-compat.js:254-256`). `$d3d_fixed_bind_lighting` **rejects any light
whose type is not 3 (directional)** (`src/09aj-d3d-fixed.wat:646`), and the JS
producer refuses earlier with `'point and spot lighting are not implemented'`
(`lib/d3d9-software-backend.js:371`). Neither side implements attenuation or
spot at all, so those stay dropped — but positional-vs-directional is a
difference GL guests can actually observe.

### 3. The 256-vertex / 768-index batch ceiling

`09ah` validates `3 <= vertices <= 256` and `3 <= indices <= 768` with
`indices % 3 == 0` (`src/09ah-d3d-software.wat:266-271`), and the file is
explicit that these are implementation limits rather than advertised adapter
caps (`:25-26`). GL guests submit far larger arrays in one call. A GL software
path therefore needs **chunking** — splitting a draw into ≤256-vertex batches
with the descriptor rebuilt per batch — which is new code with its own
correctness surface (shared state across chunks, index remapping) and its own
per-batch overhead. This is the item most likely to decide whether the result
is fast enough to be worth having.

### 4. Fog is a different stage on each side

GL interpolates `vFogDistance = abs(eyePosition.z)` and computes **both the
factor and the colour blend in the fragment shader**
(`lib/gl-compat.js:279`, `:324-330`). D3D computes the factor in the **vertex**
shader and hands it to the rasterizer, which owns the RGB blend
(`src/09aj-d3d-fixed.wat:410`, `:366`). The encodings also disagree: GL maps
`LINEAR→0` (`lib/gl-compat.js:547`) where D3D's linear is mode 3, and D3D's
mode 0 means "take fog from the specular input register"
(`src/09aj-d3d-fixed.wat:377-381`) — a case GL cannot express. D3D additionally
*rejects* a draw with non-finite or equal start/end (`:386-387`) where GL guards
the denominator and always produces a finite factor (`:326`).

Per-vertex fog is also simply a different picture from per-fragment fog on large
triangles. This is a visible difference, not a plumbing detail.

### 5. Normal matrix and matrix convention

GL uses the plain upper-left 3×3 of the modelview with no inverse or transpose
(`lib/gl-compat.js:211`, used `:246`). D3D computes a full world-view **inverse**
and dots against its rows (`src/09aj-d3d-fixed.wat:284-286`, `:659-660`). These
agree only when the modelview has no non-uniform scale or shear.

The convention change itself is mechanical and cheap by comparison: GL stacks
are column-major with world and view conflated (`lib/gl-compat.js:352-354`,
`:242-243`); DFX1 is row-major with separate world/view/proj at +96/+160/+224.
Transpose, and put identity in world — except that DLT1's light-direction
lowering reads **only** the view matrix (`src/09aj-d3d-fixed.wat:681-683`), so
conflating GL's modelview into view alone is required for lights to land in the
right space, and that interacts with the world-matrix choice rather than being
independent of it.

## Two smaller facts worth knowing before estimating

- **The descriptors are built in JavaScript today** — `DFX1` at
  `lib/d3d9-software-backend.js:284-306`, the 6×160-byte cascade table with the
  fog tail at `:308-351`, `DLT1` at `:357-377`. No WAT code builds them for
  anyone. "GL builds descriptors in WAT" is therefore new capability, not reuse
  of an existing WAT builder; alternatively GL can build them in JS like D3D9
  does, which is less pure but is the shape that already works and keeps pixels
  out of JS either way.
- **GL state that is already in WAT** is the per-vertex current values (colour,
  normal, texcoord, shade model) and the client-array pointers
  (`src/09a8e-gl-state.wat:47-83`). Nothing transform- or light-related.

## Where this leaves the decision

Shape of the work, in dependency order:

1. GL state lift into a new per-context WAT block — matrices, 8 lights,
   material, fog. Mechanical, bounded, testable against
   `glGetFloatv(GL_*_MATRIX)` (`lib/gl-compat.js:1404-1407`) as an oracle.
2. Descriptor build for a GL draw — DFX1 + DLT1 + cascade fog row. Decide JS
   (matches D3D9 today) or WAT (matches the stated goal).
3. Chunking to the 256/768 ceiling. Item 3 above.
4. Semantic gaps: specular (item 1), positional lights (item 2), fog stage
   (item 4), normal matrix (item 5). Each is either an extension to the shared
   descriptor or an explicit decline to WebGL.

Steps 1 and 2 are the unification. Steps 3 and 4 are the reason a GL software
path would not be pixel-identical to the WebGL one on day one, and they should
be priced before any of it starts.

An honest smaller alternative exists and should be weighed against the above:
extend the *decline* model instead. GL draws that fit the intersection —
directional lights, no specular, ≤256 vertices, linear/exp fog — take the WAT
path; everything else falls back to WebGL, exactly as D3DIM's `_draw` returns 0
and drops to WAT today. That yields a working software GL for simple content
without first closing four semantic gaps, at the cost of a coverage cliff that
has to be measured per app rather than assumed.

## Unverified

- Whether the D3D VM saturates `oD0` after lighting; not visible in
  `09aj-d3d-fixed.wat`. GL explicitly clamps (`lib/gl-compat.js:269`).
- The rasterizer's exact fog blend expression
  (`src/09ah-d3d-software.wat:53`, "interpolated four-lane factor264..279"),
  so equivalence with GL's `mix(fogColor, color, factor)` is not established.
- Whether chunking at the 256-vertex ceiling is fast enough to matter, for any
  real GL guest. Nothing here has been measured on a running app.
