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
the render target. The creation-version provenance of this field is traced
below; it is not a capability bit or the current interface's version.

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
validation and render-target bounds, verifying uninitialized SetCurrentViewport
(later resolved below: selection is allowed),
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

## Clip-volume application (2026-09-23)

The retained descriptor now feeds the common untransformed-vertex path rather
than only its screen rectangle. For finite nondegenerate Viewport2 values:

```text
x' = (2/clipWidth)*x + (-2*clipX/clipWidth - 1)*w
y' = (2/clipHeight)*y + (1 - 2*clipY/clipHeight)*w
z' = (z - minZ*w)/(maxZ - minZ)
w' = w
```

The existing symmetric viewport projection and six homogeneous clip planes
then consume these normalized coordinates. This also feeds PROCESSVERTICES
clip status before division. Already-transformed TL vertices bypass projection.
Legacy SetViewport's converted scales use the same path. Default clip bounds
skip the extra arithmetic; this is a structural fast path, not a performance
measurement.

Six coefficients and an enable word occupy device-state bytes3904..3931,
previously unused. They are copied by the existing4096-byte render-command
snapshot: replay never reads the live viewport descriptor. Device7 SetViewport
clears legacy normalization; Device7 depth mapping is **not** fixed by this work.
No region placement or snapshot size changes.

The original Microsoft transform helper at `0x566afa8a` checks zero width,
height, clip dimensions and depth span before writing its cached transform.
Its target `0x566afe46` is `pop esi; leave; ret`. Application now similarly
leaves the previous transform cache unchanged for those degenerate inputs.
This does not implement the separate generation-dependent setter validation,
activation HRESULT policy. Uninitialized selection is resolved below. NaN/infinity and exact
x87 rounding still need native execution evidence.

Regression started red: identity WVP with clip box `[1,3] x [0,2]`, depth
`[.25,.75]`, and vertex `(2,1,.375)` projected to `(12,0,.375)` instead of
`(4,4,.25)`. It now passes and produces a rendered point at `(4,4)`.
Additional checks cover all six clip-status planes, negative homogeneous w,
live-vs-snapshot isolation, viewport switching, default restoration, Device7
reset, all five zero-dimension/depth guards, and nondefault legacy scale factors.
Both rendering fixtures now provide
valid legacy scale fields instead of relying on zero scales being ignored.

The unchanged Execute sparse suite passes (including324 clip-status cases),
viewport state/ABI passes440 calls, and v3 vertex-buffer draw still covers961
pixels. The earlier Worker dialog composition failure remains open and is not
claimed fixed by these transformation changes.

Full build passes: normal1,506,297 bytes, compat1,508,703 bytes, unchanged
layout `68ce5b9062e11919`; log `/private/tmp/wa-viewport-clip-build.log`.
Rebuilt Boids passes at14 colours/0.75% geometry (previous state-only step:
14/0.88%). This is a functional render check, not a pixel-identical or native
conformance claim: nondefault viewport scales now affect projection.
Interface211, fragment109, ESP/epilogue, logical-operand, tier1498, silent243+22,
duplicate117/467 and diff checks pass. No benchmark was run.

## Correction: uninitialized selection is allowed (2026-09-23)

The earlier suggestion to reject an uninitialized SetCurrentViewport was
incorrect. The activation helper's `0x88760305` is not the setter's behavior:
the public setter deliberately avoids that helper for an unset descriptor.

- Device2 table `0x566612d8`, slot13, points to `0x5666fc34`. This adapter
  adjusts the interface pointer by+4 and calls Device3 slot12.
- Device3 table `0x56661230`, slot12, points to `0x5666fc48`.
- The core validates viewport ownership at `0x5666fce0`, saves the old current
  pointer at `0x5666fcfb`, and tentatively selects the new pointer at
  `0x5666fd01`.
- At `0x5666fd12` it tests viewport+`0x5c` (initialized). Zero jumps to
  `0x5666fd3b`, bypassing activation. Otherwise activation is called at
  `0x5666fd19`; failure restores the previous pointer at `0x5666fd25`.
- The successful path releases the old selection, AddRefs the new selection,
  then returns S_OK at `0x5666fd5d`. The unset path takes this same path.

No production change is needed for unset selection. New public Device2/3
regressions seal S_OK/ABI, repeated selection reference balance, unchanged
transform cache, no invented descriptor/allocation, GetCurrentViewport identity,
GetViewport2 still reporting unset, and later SetViewport2 activating the
selected viewport. Restoring the previous viewport restores its cache, and
detachment/final release balances the late allocation.

This removes a false work item, not the remaining activation-error work:
rollback on an initialized viewport's backend failure and generation-dependent
SetViewport2 range validation remain open. Evidence is static Microsoft binary
inspection, not a native Windows execution claim.

Validation: updated viewport suite passes450 poisoned-EAX/stack-guard calls;
tier membership1499 and diff checks pass. No runtime source or build artifact
changed in this correction.

## Validation gate: immutable creation version (2026-09-23)

The device+4 field is assigned from the sixth constructor argument, not from
the viewport interface used for the call. Trace through the same Microsoft
runtime identified above:

| Step | Original VA | Evidence |
|---|---|---|
| Device3 creation | `0x56670516` | Pushes3 at `0x566705c4`, calls shared factory at `0x566705d9` |
| Device2 creation | `0x5667065e` | Pushes2 at `0x566706b3`, calls shared factory at `0x566706c5` |
| Shared factory | `0x56664c1c` | Forwards sixth argument `[ebp+0x1c]` at `0x56664f29` to device vtable slot24 |
| Base initializer | `0x56665336` | Loads sixth argument at `0x56665342`, stores device+4 at `0x56665364` |
| Derived initializer | `0x5666bc17` | Forwards the same six arguments to the base initializer at `0x5666bc91` |

The base implementation is slot24 of table `0x56661360`. The factories query
the returned device using IID_IDirect3DDevice3 at `0x56662038`
(`b0ab3b60-33d7-11d1-a981-00c04fd7b174`) and IID_IDirect3DDevice2 at
`0x56662028` (`93281501-8cf8-11d0-89ab-00a0c9054129`), respectively. This
corroborates the version labels independently of guessed function names.

For creation version>=2, the setter's checks at `0x56677781..0x566777e0` are:

- Clip width/height compare equal to zero **or unordered**: reject. `FCOMP`,
  `FNSTSW`, `SAHF`, then `JZ` also rejects NaN; a plain wasm `f32.eq 0` does not.
- minZ/maxZ compare equal or unordered: reject. It does not require minZ<maxZ
  or constrain them to `[0,1]` here.
- Unsigned x/y must not exceed target width/height. Unsigned **32-bit sums**
  x+width and y+height must not exceed those dimensions. The inspected code
  does not guard addition overflow; do not describe it as a checked sum.
- Negative finite clip dimensions are not rejected by the zero comparison.
  Screen width/height zero are not separately rejected here, although the
  transform application helper leaves its cache unchanged for them.

Failure returns `0x80070057` before canonical descriptor publication. These
are setter checks, separate from initialized-current-viewport activation
failure, which occurs after descriptor publication. Legacy SetViewport first
converts to Viewport2, so its converted clip dimensions and normalized depth
are the inputs to these checks.

### Implementation consequence / remaining work

Our `$d3dim_create_device` currently records target/parent/state but no creation
version. Its shared4096-byte state has room for an immutable version field;
surface-QI Device1 and CreateDevice2/3 paths must initialize it, and subsequent
QueryInterface must preserve it. Do not infer this policy from a wrapper's
vtable at setter time. D3D7/9 compatibility paths and reset also use this
allocator and must not accidentally acquire an unproven legacy policy.

Before enabling validation, repair the indexed-texture fixture: it creates a
Device3 with an8x8 target, then intentionally selects640x480 and128x128
viewports and tests degenerate setters. That currently depends on our missing
validation. Split unrestricted legacy projection tests from version2/3 setter
validation; do not weaken assertions or exempt production small targets.
Required cases include immutable version across aliases, direct/sparse inputs,
rejected-setter nonmutation, legacy conversion, reversed depth, negative clip
dimensions, exact target edges and the documented native overflow behavior.

This section resolves the evidence gap, not the implementation gap. No runtime
behavior changed and no new native execution or performance claim is made.

## Implementation: creation-sensitive setter validation (2026-09-23)

The implementation gap above is now closed for creation versions1/2/3.
`$d3dim_create_device` records the legacy creation version at state+3932.
QueryInterface aliases share it; version1 stays permissive when queried as3,
and version2/3 stays strict when queried as1. Zero denotes other/synthetic
creation paths. Device7/9 deliberately remain outside this proven policy;
their state initialization/reset leaves the tag zero.

After legacy conversion, the common setter checks clip/depth comparisons and
current target bounds under LOCK_DX, before allocating or publishing descriptor
state. Invalid calls return DDERR_INVALIDPARAMS and preserve descriptor,
rectangle mirrors, active transform cache and heap balance. The unordered
comparison behavior, negative spans, reversed depth, zero screen dimensions,
and wrapping rectangle sums follow the inspected Microsoft instructions.
An absent target on a strict device returns invalid parameters rather than
dereferencing an invalid target; native absent-target behavior was not tested.

The indexed-texture regression now explicitly creates a Device1-origin device
for its oversized and degenerate projection cases. Its geometry, clipping,
sampler and pixel assertions remain intact. Strict Device2/3 behavior is tested
separately against an80x60 target, not bypassed by a production exception.

The viewport suite adds a matrix of three creation versions, three viewport
interfaces and three direct/noncontiguous-sparse descriptor placements. It
checks rejected calls before first allocation (including forced allocation
failure), rejection after initialization with an active viewport, unchanged
input bytes/state/cache/heap, boundary and overflow acceptance, NaNs, zero
clip dimensions, equal depth, legacy ignored-depth conversion, public
QueryInterface aliases and balanced final release. Total1188 poisoned-EAX
calls with stack guards pass. The preexisting synthetic device helper remains
untagged for state/lifetime tests; all new policy cases use the real factory.

Indexed-texture, v3 vertex-buffer draw961pixels and the complete sparse Execute
regression pass. Boids on the first rebuilt candidate passes14colours/0.75%
geometry. Interface211, tiers1499 and diff checks pass. Remaining gaps are
initialized activation-failure propagation/rollback, Device7 depth semantics,
native exception/rounding details and the earlier Worker dialog composition
failure; this does not establish whole-runtime native conformance.

Final rebuild passes: normal1,506,664 bytes, compat1,509,070 bytes; layout stays
`68ce5b9062e11919`. Log: `/private/tmp/wa-viewport-validation-build-final.log`.
Final-source viewport rerun passes1188 calls. Silent inventory243+22 and
duplicate ratchet117/467 remain unchanged. No benchmark was run.
