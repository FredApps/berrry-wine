# Vertex-buffer interface audit: native prerequisite

2026-09-22 (capture timestamps are UTC).

## Why measure first

The emulator's vertex-buffer QI branch accepts every IID and returns the
current vtable. This is not valid interface negotiation. Microsoft's
[SDK d3d.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/d3d.h)
defines distinct IDirect3DVertexBuffer and IDirect3DVertexBuffer7 identities:
version 7 also has ProcessVerticesStrided, and its ProcessVertices/Optimize
signatures name version-7 objects. The declarations alone do not establish
which cross-generation queries the native runtime permits.

The new `tools/v86-reference/probes/d3d-vb-interfaces.c` creates system-memory
vertex buffers through D3D3 and D3D7 and queries IUnknown, both VB versions,
a material IID and two corrupted VB IIDs. It records HRESULT, output clearing,
pointer equality, IUnknown identity and release results. The first attempt
did not reach these calls: native DirectDrawCreate displayed a modal error
requiring 256 colors. The reference desktop is 16-color VGA, a previously
documented DirectDraw limitation in the harness's SOURCES.md.

The probe now checks display depth before DirectDrawCreate and explicitly
reports SKIP. A fresh capture ran to the end:

```text
D3D_VB_BEGIN version=c0000a04
DISPLAY bpp=00000004
SKIP requires 256-color DirectDraw display; no QI observations
D3D_VB_END
```

This is **not** a native QI result or a passing QI conformance fixture.
No WAT behavior was changed based on this capture. No Wine source was used.

## Reproduction and provenance

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/d3d-vb-apps.json --app d3d-vb-interfaces \
  --output /private/tmp/wa-vb-qi-prereq.png \
  --metadata /private/tmp/wa-vb-qi-prereq.json \
  --serial-output /private/tmp/wa-vb-qi-prereq.txt
```

The capture completed at `2026-09-23T01:19:14.838Z` on v86
`0.5.432+gf3d4472`, using the default documented online Win98 profile.
Source SHA-256:
`12b21d481b969bad8c0abefecdbd60ce446c24f75001627a0132b2256041dfb8`.
Probe executable SHA-256:
`7edfc974c6acc5c0dde88b02e3273b31c59ec0a34316893cc52132d1db8b63a2`.
The initial modal-dialog capture is `/private/tmp/wa-vb-qi.{png,json,txt}`.
Generated captures are local evidence, not committed OS screenshots or binaries.
Probe compilation, manifest listing and whitespace checks succeeded.

## Next

Run this probe on a Win98 reference image configured with a working
256-color-or-higher DirectDraw driver, repeat the observations, then pin the
supported-interface matrix before implementing version negotiation. Do not
substitute a successful SKIP or SDK vtable declarations for native results.
Vertex-buffer accept-all QI remains open. Creation allocation rollback and
buffer-payload ownership can be tested independently in the meantime.
