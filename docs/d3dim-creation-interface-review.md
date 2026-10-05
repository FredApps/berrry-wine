# D3D child creation returns the declared interface

2026-09-22. Creation-path follow-up to the material lifetime review.

Microsoft's [SDK d3d.h declarations](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/d3d.h)
declare that IDirect3D, IDirect3D2 and IDirect3D3 CreateMaterial/CreateViewport
return the corresponding material/viewport interface version. This is an
explicit creation contract, independent of cross-version QueryInterface
availability on particular native DirectX installations.

Three creation paths selected the version-3 vtable incorrectly:

| Creator | Before | After |
| --- | --- | --- |
| IDirect3D2::CreateMaterial | Material3 | Material2 |
| IDirect3D::CreateViewport | Viewport3 | Viewport1 |
| IDirect3D2::CreateViewport | Viewport3 | Viewport2 |

CreateMaterial v1 already returned Material1 correctly. Earlier session notes
that described every material creator as returning version 3 were inaccurate.
The three corrected interfaces share leading method layouts with their newer
counterparts; this is a version/dispatch correctness fix, not evidence that
every affected app previously called a shifted method slot.

The production change is limited to three vtable constants and one comment.
Allocation, null-output, aggregation and reference ownership policies are
unchanged. The viewport/light fixture now initializes all three synthetic
viewport vtables, instead of assuming every creator uses version 3.

## Verification

`node test/test-d3dim-creation-interfaces.js` first failed with exactly the
three version mismatches above, then passed after the fix. It dispatches all
six public creation APIs, checks every returned vtable slot against the
version's API entries and verifies COM thunk markers. AddRef and both Releases
are dispatched using the API IDs read from those returned thunks. Assertions
cover initial refcount, 1-to-2-to-1-to-0 lifetime, stdcall cleanup and stack
guards. This exercises selected-vtable routing, not real x86 indirect calls.

The test intentionally uses a null creator fixture because these creation
handlers currently do not inspect their creator argument. It does not certify
native invalid-this handling or creator/child ownership. The SDK interface
spec regression separately checks metadata/ABI consistency; this regression
specifically detects selecting the wrong already-generated vtable.

Adjacent viewport/light ownership and material sparse-copy/public-release
regressions pass, as do the fragment, ESP/epilogue, logical-operand, silent
stub, interface-spec (211 methods), generated-dispatch and test-tier checks.
The exact-duplicate ratchet drops from 119 groups / 476 members to 117 / 471:
creation handlers with distinct return contracts no longer have identical
bodies. Quiet remains 243 manual + 22 metadata. No full-build claim.

Native Win98 cross-generation QI availability, invalid arguments, allocation
failure policy and application/browser rendering remain separate work.
