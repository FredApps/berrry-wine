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
