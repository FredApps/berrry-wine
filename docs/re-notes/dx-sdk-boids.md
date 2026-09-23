# DX5 SDK `boids.exe` — 33,423 draws, one-colour frame

`test/binaries/dx-sdk/bin/boids.exe`, image base `0x400000`. A DirectDraw +
Direct3D Immediate Mode **v2** sample: flocking birds over a wireframe ground
grid.

**RESOLVED 2026-09-21 — it renders.** 1 colour → 223, wireframe terrain in
perspective with the flock above it. The bug was ours and it was in the x87:
`FSIN`/`FCOS`/`FSINCOS`/`FPTAN` never wrote **C2**. Jump to
[the root cause](#root-cause-fsinfcos-never-cleared-c2); everything above it is
the (correct) investigation that led there, kept because each step rules
something out.

A separate 2026-09-22 blank-frame regression was fixed in the legacy viewport
Clear wrappers; see [the HRESULT follow-up](#blank-again-legacy-viewport-clear-omitted-hresult-2026-09-22).

Status was **WARN — BLANK (1 colour, 100%)**. This note records why, because
the symptom reads convincingly like a dead rasterizer and is not one.

## The frame is blank because the guest's own projection matrix is ±infinity

The app builds its projection at `0x00420720` and hands it to
`IDirect3DDevice2::SetTransform(D3DTRANSFORMSTATE_PROJECTION)`. Dumped at
batch 70:

```
node test/run.js --exe=test/binaries/dx-sdk/bin/boids.exe \
  --max-batches=80 --batch-size=100000 --max-seconds=60 --no-close \
  --quiet-api --quiet-blocks --input=70:dump-mem:0x00420720:64
```

```
0x00420720  00 00 80 ff  00 00 00 00  00 00 00 00  00 00 00 00
0x00420730  00 00 00 00  00 00 80 ff  00 00 00 00  00 00 00 00
0x00420740  00 00 00 00  00 00 00 00  00 00 80 ff  00 00 80 ff
0x00420750  00 00 00 00  00 00 00 00  00 00 80 7f  00 00 00 00
```

`0xff800000` is −∞ and `0x7f800000` is +∞, so `_11`, `_22`, `_33`, `_34` and
`_43` are all infinite. Every vertex therefore projects to infinity and nothing
can land inside the viewport. **The matrix is written by guest code**, so this
is an input we feed it, not a bug in our transform or our rasterizer.

Shape of the SDK's `D3DUtil_SetProjectionMatrix`: `_11`/`_22` are
`cos(fov/2)/sin(fov/2)` (×aspect for `_11`) and `_33 = far/(far−near)`. All of
them infinite at once means `sin(fov/2)` came back 0 **and** `far−near` came
back 0 — one shared upstream zero, not three independent ones.

## Everything else in the pipeline is healthy — don't re-check it

Measured over a 300-batch run (`--max-batches=300 --batch-size=100000`):

| call | count |
|---|---|
| `IDirect3DDevice2_DrawIndexedPrimitive` | 33,423 |
| `IDirect3DDevice2_SetTransform` | 21,946 |
| `IDirect3DDevice2_SetRenderState` | 13,956 |
| `IDirect3DDevice2_SetLightState` | 7,977 |
| `IDirect3DMaterial3_SetMaterial` | 6,492 |
| `IDirect3DViewport3_Clear` / `BeginScene` | 499 |
| `IDirectDrawSurface_Flip` | 498 |

- **Vertex data is correct.** `0x004200c0` holds `D3DLVERTEX`s with sane model
  coordinates — `(−25, 0, 35)`, `(−15, 0, 35)`, `(−5, 0, 25)`, colour
  `0xff004c7f`. That is the ground grid, drawn as `D3DPT_LINESTRIP` (primType 3)
  of `D3DVT_LVERTEX` (vtxType 2).
- **The render target is bound.** There is no `CreateDevice` and no
  `SetRenderTarget` in the trace: the device is made the D3D2 way, by
  `IDirectDrawSurface::QueryInterface` for a device IID, which
  `09a8-handlers-directx.wat` routes into `$d3dim_create_device` with the
  surface as RT. `GetRenderTarget` at `#244` returns a surface the app then
  successfully QIs at `#245`, which proves `DxObject.misc0` was seeded.
- **All three transforms are set** — VIEW (2), PROJECTION (3), WORLD (1).
- **Clear reaches the surfaces.** `--dx-surfaces` shows slots 4/5/6 (primary,
  back, offscreen, 640×480 16bpp) all at exactly one colour `#000c18`, and
  slots 12/13 (256×256 textures) holding **92 colours** — so texture upload
  works too.

## Lead: 42,117 x87 invalid-operation raises

```
node test/run.js --exe=... --trace-fpu   # 42,117 lines
[fpu] raise IE at 0x0041623c   (every one of them)
```

`0x0041623c` is `fld m80real [0x41e620]` + `fistp` inside the CRT helper at
`0x00416230`, called from `0x0041699a` and `0x004169b9`. That helper *raises FP
exceptions on purpose* — it is how MSVC's `_control87`/`_statusfp` family
reports status — so the raises are not themselves the bug. What is suspicious is
the **volume**: 42k deliberate raises means the app's math library is taking an
error path tens of thousands of times, which is consistent with the shared
upstream zero above.

`--trace-fpu` shows no `ZE` at all, so the infinities are not coming from a
plain divide-by-zero in our FPU. They come from the CRT taking an error path.

## Root cause: FSIN/FCOS never cleared C2

The builder is `0x00407c1b`. It is **not** the SDK's
`D3DUtil_SetProjectionMatrix`: it stores `cos(fov/2)` straight into `_11`.

```
00407c24  fld dword [ebp+0x14]        ; fov
00407c27  fmul qword [0x41c020]       ; * 0.5
00407c33  call 0x414eca               ; cos  -> [ebp-0xc]  -> _11
00407c4d  call 0x414ec0               ; sin  -> [ebp-0x8]
```

`0x414ec0` is `mov edx,0x41e592 ; jmp 0x416125`, and `0x41e592` is a descriptor
beginning with the Pascal string `"\x03sin"`; `0x414eca` is the same with
`"\x03cos"` at `0x41e5b2`. Both funnel into the classifier at `0x00418a70`:

```
00418a9d  fxam
00418aa6  fnstsw qword [ebp-0xa0]     ; DD /7, m2byte
00418ab4  mov cl, [ebp-0x9f]          ; status high byte
00418aba  shl cl,1 / sar cl,1 / rol cl,1
00418ac2  and al, 0xf                 ; index = C3 | C0<<1 | C1<<2 | C2<<3
00418ac4  xlat                        ; class table at 0x41f10d
00418ad5  jmp [ebx]                   ; descriptor+0x10 + class
```

Class table `08 04 08 08 08 04 08 08 00 04 0c 08 00 04 0c 08`. A positive
normal indexes 8 → `0x00` → the first handler, `0x00415f1a`:

```
00415f1a  fsin
00415f1d  fnstsw ax
00415f20  sahf
00415f21  jp 0x415f2f                 ; taken when C2 is set
00415f23  ret
```

**`SAHF` takes PF from `AH` bit 2, which is C2.** Real `FSIN` clears C2 when
`|ST(0)| < 2^63` and sets it otherwise; that is how the CRT asks "did you need
argument reduction?". Our `FSIN`, `FCOS`, `FSINCOS` and `FPTAN` never wrote C2
at all — and C2 is **sticky**, so it still held the `1` that the `FXAM` two
instructions earlier had set for a normal number. Every in-range argument took
the reduction path and came back infinite.

Fixed in `src/06-fpu.wat` with `$fpu_trig_c2`: clear C2 and compute when
`|ST(0)| < 2^63`, otherwise set C2 and leave the stack untouched (NaN counts as
in range). `FPREM`/`FPREM1` already did this; the trig ops were the gap.
Regression cases in `test/test-x86-ops.js` run `FXAM` first **on purpose**,
because that is what makes C2 dirty — without it the bug is invisible.

`dx_flip3dtl` had the same root cause and now draws its textured rotating
Windows 95 cube (77 colours).

This is not a boids-specific bug: it is every guest that reaches x87 trig
through an MSVC or Borland CRT, which is the usual way.

## Not the same bug as its neighbours

`dx_flip3dtl` did share it and is fixed too (see above). `dx_globe` and
`dx_viewer` are a different, known failure —
`D3DRMERR_BADFILE` on `sphere3.x`/`camera.x`, the `.x` loader asset gap.

The 2026-09-19 D3DIM/GL sweep scored `dx_boids` **IDENTICAL, 0% diff** between
the GPU and software backends. That is two blank frames agreeing, not coverage;
see `docs/d3d-backend-coverage.md`.

## Blank again: legacy Viewport Clear omitted HRESULT (2026-09-22)

A later blank frame was **not** the x87 issue above. The projection at
`0x420720` is finite (diagonal words `3f6c835e`, `3f6c835e`, `3ec46ccc`),
and textures contain 92 sampled colours. Nevertheless all three large render
surfaces hold only the clear colour. The direct primitive renderer is never
called: a one-batch, 100000-block trace reports 1619 Viewport2 Clear calls and
1618 flips, with no draw calls.

Original Microsoft DX5 `samples/boids/boids.cpp`, `D3DScene::Render`, tests
Clear's HRESULT against D3D_OK and returns before BeginScene if it is nonzero.
Our Viewport1 and Viewport2 Clear wrappers called the clearing helper but
never wrote EAX. They therefore returned whatever register value the guest
had left there. Viewport3's wrapper already writes S_OK correctly.

The two legacy wrappers now forward to the shared Viewport3 handler, retaining
its worker fence, return value and identical four-argument stdcall cleanup.
This is not a new always-success shortcut: it uses the existing implementation
and leaves its rectangle/error-policy limitations unchanged. The interface
regression seeds EAX with `0xdeadbeef`, invokes Clear through each version,
and checks S_OK, ESP+20 and the following stack guard. Before the fix it fails
with `3735928559 !== 0`; after the fix all three versions pass.

The existing real-app line test now honours `WINE_ASSEMBLY_WASM` for isolated
candidate testing (a missing pin is an error) and uses quiet API logging. Its 9000-batch run, 8000-batch
capture and image assertions are unchanged. The original noisy run timed out
at its 180-second harness limit on this loaded host; independent short probes
established the blank frame instead of interpreting that timeout as rendering
evidence.

With the isolated rebuilt candidate:

- `test-d3dim-line-primitives.js` passes: 10 colours, 0.64% geometry.
- A three-batch 100000-block run records 385 DrawIndexedPrimitive calls,
  six BeginScene calls and five EndScene calls. Its capture visibly contains
  the terrain grid and coloured flock rather than a flat clear surface.
- Viewport interface/ABI regression, 211-method interface spec, fragment,
  logical-operand, ESP and duplicate/silent-stub gates pass. Inventories remain
  243+22 silent handlers and 117/471 duplicate groups/members.

Artifacts/logs: `/private/tmp/wa-boids-clear-fixed.wasm`,
`/private/tmp/wa-boids-clear-fixed.png`, `/private/tmp/wa-boids-clear-fixed.log`.
The failing projection/census probe is `/private/tmp/wa-boids-isolated.log`;
the clear/flip trace is `/private/tmp/wa-boids-draw-trace.log`. No performance
claim is made, and this does not certify native near-plane line clipping.

The full main build also passes (1,505,311-byte normal / 1,507,717-byte compat;
layout `ef4939693f389572`). The main normal artifact is byte-identical to the
isolated candidate, SHA-256
`66b533e57bc12b889be5d8c465dce44bf2ece4236f327f25f813aaa32db64ef4`.
The browser probe `tools/web-input-probe.js --app=dx_boids` with a six-second
post-launch wait shows multiple coloured birds over the terrain grid;
capture `/private/tmp/wa-boids-browser-fixed.png` was visually inspected.

Repeating the original unpinned-clock test against those identical artifacts
gave both a two-colour failure and a nine-colour pass. SDK `boids.cpp:281`
calls `srand(time(NULL))`, so the flock's position at the capture depends on
launch calendar time. The test now pins `--wall-clock-ms=978307200000` using
the existing harness option. It does not loosen its colour/geometry assertions
or change the runtime clock default for users.
Two consecutive pinned-clock runs pass identically: 14 colours, 0.88% geometry.

## Neighboring HRESULT audit (2026-09-23)

After the Clear fix, an omission scan of all 177 handlers in
`09aa-handlers-d3dim.wat` found no further handler without a reachable EAX
store or explicit trap. The temporary scan followed direct helper calls across
the source files. This is only an existence check: a store on one branch does
not establish that every returning branch initializes EAX. It is not a
conformance gate or evidence that the remaining silent-success APIs are correct.

The durable coverage is in `test/test-d3dim-viewport-query-interface.js`:
29 public-dispatch calls start with poisoned EAX and check HRESULT, exact
stdcall cleanup and a stack guard. These cover Clear, Set/GetBackground with
no material, and Set/GetViewport on versions 1/2/3, plus Set/GetViewport2 on
versions 2/3. Rectangle round-trips run with both direct allocations and a
structure crossing nonadjacent sparse backing pages; an output guard catches
overwrites. All pass against freshly compiled current sources, alongside the
existing GUID, identity, sparse-output and reference-lifetime checks.

No additional runtime fix was warranted by this audit. Full viewport field
retention, null/size validation, nonzero background material semantics and
all-path return analysis remain outside this test. In particular, the current
shared viewport helper only retains the rectangle; passing this regression
does not certify its scale, clipping-volume or depth fields.

## Legacy viewport descriptor validation (2026-09-23)

The original Microsoft DX5 `d3dimref.doc` (archival source and hashes in
`docs/d3dim-execute-data-sparse-review.md`) defines both D3DVIEWPORT and
D3DVIEWPORT2 as eleven DWORD/float fields, 44 bytes, and requires an initialized
`dwSize`. Its Get/SetViewport and Get/SetViewport2 entries list
DDERR_INVALIDPARAMS among the errors. The converted reference locations are
1370–1403, 1476–1509 and 3392–3481 in the recovered `d3dimref.txt`.

Previously the shared setter ignored size and accepted null; the getter also
accepted null and replaced a zero size with an invented 80. Both now validate
the nonnull descriptor's size through the same guest-scalar helper and return
DDERR_INVALIDPARAMS (`0x80070057`) before mutation if it is not 44.
The regression first failed with S_OK instead of that error. It tests sizes
0, 20, 40, 43, 45, 80 and 0xffffffff, plus null, through all five applicable
interface/method pairs. Direct buffers and two sparse layouts exercise a
crossing rectangle field and a crossing size DWORD. Rejected getters leave
the entire descriptor and guard untouched; a subsequent valid getter proves
rejected setters did not replace the rectangle. Every call poisons EAX and
checks stack cleanup.

Two renderer fixtures had copied the same erroneous size80 convention:
`test-d3dim-indexed-texture.js` and `test-d3dim-v3-vertex-buffer-draw.js` now
declare size44. Their rendering expectations were not changed; both pass,
including the vertex-buffer test's 961 indexed pixels.

This fixes input validation, not full viewport state. Retaining scale/clip/
depth fields, applying them to transformation, cross-layout conversion and
invalid-object handling still need work. Exact native error precedence is
not established by the SDK's error list and has not been claimed here.

Validation: all 399 poisoned-EAX/ABI calls pass; indexed-texture and v3
vertex-buffer tests pass; full build passes (1,505,321-byte normal /
1,507,727-byte compat, unchanged layout `ef4939693f389572`). Boids against
that rebuilt artifact still passes at 14 colours and 0.88% geometry with the
pinned clock. Fragment/logical-operand/ESP/epilogue/interface/tier checks and
duplicate ratchet pass; quiet inventory remains 243+22, duplicates 117/471.
Build log: `/private/tmp/wa-viewport-validation-build.log`. No new browser,
native-runtime or performance comparison was performed for this change.
