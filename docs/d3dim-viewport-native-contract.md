# Legacy viewport state: Microsoft runtime evidence

2026-09-23. Follow-up to `ac9c482c` (descriptor validation).

## Finding

Do **not** implement two independent opaque D3DVIEWPORT/D3DVIEWPORT2 records.
The inspected Microsoft runtime stores one canonical D3DVIEWPORT2 plus an
initialized flag. Legacy Set/GetViewport convert to/from that record, and
do not round-trip every original legacy field. This changes the next
implementation step from preserving caller bytes to reproducing conversion,
ownership and activation behavior.

This is static evidence from the original Microsoft executable, not execution
on native Windows, not Wine source, and not proof of all DirectX versions.
The existing v86 Win98 profile cannot provide the missing dynamic oracle:
see [the DirectDraw display prerequisite](d3dim-vertex-buffer-native-probe.md).

## Artifact and identification

- Corpus path: `test/binaries/win98-games-a-d/DrakanOrderOfTheFlameDemoD3D/DirectX/D3DIM.DLL`
- Size: 610064 bytes; preferred image base: `0x56660000`.
- Version resource: Microsoft Corporation, Microsoft Direct3D,
  FileVersion/ProductVersion `4.06.02.0436`, DirectX for Windows 95 and 98.
- SHA-256: `7c1d066070aa5743ca12a62afcbed2e39faf7a576d118520e2f60b8aa168caf2`.
- Viewport vtable: `0x566625c0`. Its QueryInterface implementation at
  `0x5667b733` compares complete IUnknown/Viewport1/Viewport2/Viewport3 GUIDs;
  the Viewport1 GUID is at `0x566620b8`.
- Constructor at `0x56677549` installs that vtable, clears eleven DWORDs at
  object+`0x30`, and clears the initialized flag at object+`0x5c` and device
  pointer at object+`0x14`.

| Slot | Method | Original VA |
|---|---|---|
| 4 | GetViewport | `0x5667788f` |
| 5 | SetViewport | `0x5667759c` |
| 16 | GetViewport2 | `0x566779b1` |
| 17 | SetViewport2 | `0x566776f8` |

## Conversion, not byte preservation

SetViewport first checks `this`, descriptor pointer and exact size44.
At `0x56677604` it tests the two legacy scale values. For ordinary finite,
nonzero scale values it computes:

```text
clipWidth  = unsigned(width)  / scaleX
clipHeight = unsigned(height) / scaleY
clipX      = -0.5 * clipWidth
clipY      =  0.5 * clipHeight
minZ       = 0
maxZ       = 1
```

It copies the screen rectangle, uses those derived fields, and invokes vtable
slot17 (SetViewport2) at `0x56677693`. Legacy maxX/maxY/minZ/maxZ do not feed
this conversion. If either scale comparison selects the zero case, both clip
dimensions are set to zero. NaN/exception details need separate tests; do not
infer their treatment merely from the finite-input formulas.

GetViewport invokes slot16 (GetViewport2) into a stack-local 44-byte record at
`0x566778f9`, then synthesizes:

```text
scaleX = unsigned(width)  / clipWidth
scaleY = unsigned(height) / clipHeight
maxX   = clipX + clipWidth
maxY   = clipY
minZ   = 0
maxZ   = 1
```

It returns the inner HRESULT. Notably, the outer conversion has **no failure
branch** before writing its output after GetViewport2. Do not invent a
preserve-output assertion for an uninitialized legacy GetViewport based on
the cleaner GetViewport2 behavior below.

The constants at `0x56662618` are float32 `0`, `-0.5`, `0.5`.
The width/height conversion uses `DF /5` (FILD m64int) after placing the DWORD
in the low half and clearing the high half. Our current disassembler prints
this as `fild word`; that operand-width label is wrong. The adjacent stores
and raw opcode establish unsigned DWORD-to-floating conversion, not signed
16-bit conversion. Exact x87-to-f32 rounding should be tested explicitly.

## State and errors

GetViewport2 checks, in order:

1. Null `this`: `0x88760082` (DDERR_INVALIDOBJECT).
2. Null descriptor or size other than44: `0x80070057` (DDERR_INVALIDPARAMS).
3. Object+`0x5c` unset: `0x88760305` (viewport data not set), without copying.
4. Copy eleven DWORDs from object+`0x30`; return S_OK.

The flag test is at `0x56677a0a`; the copy is at `0x56677a23`.

SetViewport2 checks null `this` and pointer/size first, then requires a
nonzero attached-device pointer at object+`0x14`. Without it, the result is
`0x88760306`. For device field+4 >=2, the path beginning `0x5667777b` also
checks clip dimensions, unequal minZ/maxZ, and the viewport rectangle against
the render target. The precise meaning of the device field is not yet traced;
do not label it a capability bit or assume these checks apply identically
to every device generation.

At `0x566777f8` it copies all eleven DWORDs to object+`0x30` and sets the flag.
If this is the active viewport, it calls the application helper at
`0x56677332`. That helper checks initialization, updates the device transform
through `0x566afa8a`, and invokes a device method. **Publication precedes that
call**, so an activation failure is not evidence that the old record survives.

The transform helper reads clip and depth fields, not merely the screen
rectangle. At `0x566afb2a` onward it calculates reciprocal clip width/height,
the clip-origin offsets, reciprocal depth range and the minimum-depth offset.
Its full projection/rasterization integration remains to be traced and tested.

## Consequences for current implementation

The current helpers in `09ab-handlers-d3dim-core.wat` retain only x/y/w/h and
derive symmetric projection scales from width/height. Both public structure
families use those same helpers without a layout discriminator. Remaining work:

1. Add one canonical Viewport2 owner and an initialized state shared by all
   COM views; ensure final direct/device-owned Release tears it down.
2. Separate legacy conversion from Viewport2 Set/Get while keeping one
   validation/storage/activation core. Avoid two conflicting state records.
3. Apply stored clip/depth fields when selecting or changing the active
   viewport; switching to another viewport must restore that viewport's state.
4. Cover uninitialized getters, cross-layout conversion, noncentral clip
   volumes, asymmetric scales, nondefault depth, invalid inputs, allocation
   failure, sparse structures, alias identity and independent objects.
5. Correct fixtures to attach a real device and initialize valid scale/clip
   fields before enforcing the device-dependent checks. The existing
   rectangle-only test deliberately creates detached objects and zero-fills
   those fields; its passing result is not a native conformance oracle.
6. Re-run Boids, Globe and Viewer after state/transform integration. Native
   execution remains necessary for ambiguous error, rounding and device cases.

The immediately preceding size44 validation fix is corroborated by the
explicit native `cmp [descriptor], 0x2c` branches. It does **not** resolve the
remaining state or device checks above.

## Reproduce the inspection

Use the artifact path above as `<dll>`:

```sh
node tools/pe-version.js '<dll>'
node tools/vtable_dump.js '<dll>' 0x566625c0 21
node tools/disasm_fn.js '<dll>' 0x56677549,0x566775e9,0x56677645 130
node tools/disasm_fn.js '<dll>' 0x56677745,0x5667777b,0x566777f8 180
node tools/disasm_fn.js '<dll>' 0x566778dc,0x566779b1,0x56677332 150
node tools/disasm_fn.js '<dll>' 0x566afa8a 140
node tools/dump_va.js '<dll>' 0x56662618 12
```

`disasm_fn` stops at some jumps/returns, so the branch-target entries above
are intentional. No original DLL or SDK document is added by this note.

## Implementation: canonical storage and lifetime

The first implementation step now stores one heap-owned 44-byte Viewport2
descriptor per DX object slot, shared by every COM view. The shared pointer
table covers all 8192 DX slots; a null pointer is the unset state. Publication,
updates, reads and final descriptor cleanup use LOCK_DX. The screen rectangle
is mirrored in the existing DX entry for existing clear/draw consumers; no
second descriptor or per-interface copy is retained.

SetViewport converts its scales to symmetric clip dimensions and normalizes
depth to 0/1. GetViewport synthesizes its legacy fields from the canonical
record. Set/GetViewport2 preserve the canonical fields. Both reject invalid
object families and descriptors; setters reject a detached viewport. Getter
unset state returns `0x88760305`. Allocation failure returns E_OUTOFMEMORY
before descriptor publication or rectangle mutation; later setters reuse the
allocation. Final viewport Release and device-owned final Release share the
same descriptor/light cleanup owner.

The existing light-head table had only 4096 entries despite DX_MAX=8192. It is
expanded to 8192 as part of making high-slot viewport teardown safe. The new
descriptor pointer table is also 8192 entries. The generated memory-map mirror
must ship with the rebuilt wasm; this changes region placement and layout hash.

The viewport regression now uses real device-state objects and Add/DeleteViewport
ownership rather than detached successful setters. It checks finite conversion
formulas in both directions, complete Viewport2 fields, direct and two sparse
layouts, allocation failure/retry/reuse, COM alias sharing, interleaved objects,
highest-slot state/cleanup, and both direct and device-owned final release.
Its allocator fault hook replaces only the descriptor allocation in a temporary
compiled test module; production has no fault flag. Viewport2 adapters forward
to the Viewport3 handlers so ABI cleanup is not duplicated.

Still open: **projection/clip/depth application**, device-generation-dependent
validation and render-target bounds, rejecting uninitialized SetCurrentViewport,
and native floating-point exception/rounding details. Legacy GetViewport on an
unset record returns the error without synthesizing bytes from uninitialized
stack memory; those native failure-output bytes are not modeled. This state
implementation is not a claim of complete viewport or rendering conformance.

Validation for this step:

- 440 public calls with poisoned EAX and exact stack guards pass, including
  allocation-failure/retry/reuse, cross-layout, sparse, alias, final-release
  and confirmed DX slot 8191 coverage.
- Indexed texture, v3 vertex-buffer draw (961 pixels), and viewport/light
  ownership tests pass. The full build passes: normal 1,505,923 bytes,
  compat 1,508,329 bytes, layout `68ce5b9062e11919`.
- Rebuilt Boids passes at 14 colours/0.88% geometry. Globe's 11 Render items
  pass at 224/3642/13535 point/wire/solid pixels; Viewer selection opens its
  Change Color dialog.
- The duplicate ratchet is reduced from 471 to 467 members, still 117 groups.
  The first build stopped at newly split duplicate adapter groups; delegation
  removed those copies, and the subsequent full build passed. Quiet-handler
  inventory remains 243+22. Interface/tier/fragment/ESP/logical checks pass.

Build logs: `/private/tmp/wa-viewport-state-build.log` (duplicate gate failure)
and `/private/tmp/wa-viewport-state-build-fixed.log` (success).

### Browser failure and controls

`test-d3dim-viewer-open-web.js` passes its cooperative route but fails the
Worker Open-dialog visual check: backing-canvas controls are populated,
yet only about4% of sampled display pixels match. This is not reported as a
browser pass. The sandbox initially refused the local listening socket; the
actual runs below used the permitted browser/local-server execution path.

Two isolated controls retain the current shared-tree host/UI code and replace
the viewport fragments with their `41ebab20` versions. One keeps the new region
layout; the other also restores the old `00-regions.wat` and serves the matching
old JS region mirror. Neither overwrites the main artifact or source tree.

| Viewport code | Layout | Worker display-match ratio | Result |
|---|---|---|---|
| New | `68ce5b9062e11919` | 0.039451 | Fail |
| Old | `68ce5b9062e11919` | 0.045883 | Fail |
| Old | `ef4939693f389572` | 0.040738 | Fail |

All three report the same backing-canvas census: 75402 opaque pixels, 31557
button-face pixels, 39359 white pixels. The controls establish that neither
the new viewport logic nor the layout change is required for this failure;
they do not identify its cause. Worker dialog composition remains open.

Driver/logs: `/private/tmp/wa-viewport-browser-control.js`,
`/private/tmp/wa-viewport-browser-control.log`,
`/private/tmp/wa-viewport-browser-old-layout.log`. The server logs confirm
that the old wasm and, for the second control, old mirror were actually served.
No performance or complete native-conformance claim is made.
