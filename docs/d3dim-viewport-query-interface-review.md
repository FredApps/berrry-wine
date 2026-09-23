# D3DIM viewport QueryInterface

2026-09-22. P5 shared-COM cleanup and false-success follow-up.

## Findings

Viewport1/2's shared QI accepted every IID and returned the current vtable.
Viewport3 bypassed that helper and always returned this with an AddRef.
The new regression reproduced success for a corrupted GUID.

All three now enter one handler and one viewport QI core. Only complete
IUnknown / Viewport1 / Viewport2 / Viewport3 identities are accepted.
The GUIDs and versioned interfaces were checked against Microsoft's
[SDK d3d.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/d3d.h).
Each viewport request gets the matching vtable without mutating an existing
wrapper; IUnknown returns the object's primary wrapper. Successful queries
gain one shared object reference, while failures clear output without AddRef.
Null IID/output returns E_POINTER.

The input GUID is acquired as one 16-byte guest span and released before
ownership changes, including rejection paths. Output writes remain
sparse-safe. Version 2/3 API entries alias Viewport1's handler; the interface
spec preserves the version-2 alias. Specialized Release and light ownership
teardown are unchanged.

## Verification

test/test-d3dim-viewport-query-interface.js covers public dispatch on all three
versions, 60 corrupted GUIDs, complete unrelated DirectDraw IID rejection,
all nine version transitions with exact vtable checks, canonical IUnknown,
null inputs, original-vtable preservation, balanced references, stdcall
guards, and 64 crossing sparse GUID/output cycles with balanced span storage.

The existing device/viewport/light ownership test and 211-method
interface-spec test pass. Scoped fragment, ESP, generated-epilogue,
logical-operand, quiet-inventory, duplicate and test-tier gates pass.
Duplicates: 122 groups / 483 members -> 121 / 480.
Quiet inventory remains 243 manual + 22 metadata.

## Limits and next work

This is not native Win98 generation-policy or error-precedence certification,
nor a browser/gameplay/full-build result. Invalid non-null pointers,
wrapper-allocation failure and span-arena exhaustion are not fault-injected.
Device, material, texture and execute/vertex-buffer QI paths still need their
own complete-IID/ABI/ownership reviews. The separate DirectDraw/D3D parent
identity and retention issues remain open.
