# D3DIM material QueryInterface

2026-09-22. P5 shared-COM cleanup and false-success follow-up.

## Findings and fix

Material1/2 accepted arbitrary interface IDs through the shared core;
Material3 bypassed that core and always returned this with an AddRef.
The new regression first failed because a material accepted a complete
viewport IID (S_OK instead of E_NOINTERFACE).

All three material entrypoints now alias Material1's handler. The shared
child QI helper validates the complete IUnknown or Material1/2/3 GUID,
selects the requested version's vtable, and returns the primary wrapper
for IUnknown. It shares span, identity and reference ownership with the
viewport implementation, while keeping the accepted interface families
separate. Failed queries clear output without acquiring a reference;
null IID/output returns E_POINTER. One 16-byte input span is acquired and
released before ownership changes; output writes remain sparse-safe.

Interface constants were checked against Microsoft's
[SDK d3d.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/d3d.h).
Canonical IUnknown identity and successful-query reference ownership follow
Microsoft's [QueryInterface rules](https://learn.microsoft.com/en-us/windows/win32/com/rules-for-implementing-queryinterface).
No Wine source was used.

## Verification

`node test/test-d3dim-material-query-interface.js` passes public dispatch
for all three versions: 60 GUID corruptions, all nine version transitions
with exact vtables, unchanged original wrappers, canonical IUnknown,
null inputs, balanced references and stdcall guards. It also covers 64
cycles with GUID/output crossing nonadjacent sparse pages and checks
temporary span storage is released.

`node test/test-d3dim-viewport-query-interface.js` passes its existing
coverage plus reciprocal rejection of a complete material IID. Fragment,
handler ESP, generated epilogue, logical-operand, silent-inventory,
test-tier and 211-method interface-spec checks pass.
The viewport/light ownership regression and root QI regression (96 GUID
corruptions and 16 version transitions) also pass against current source.
Generated dispatch freshness, API hash consistency and whitespace checks pass.

Duplicate baseline: 121 groups / 480 members -> 119 / 476.
Quiet inventory stays 243 manual + 22 metadata. Removed duplicate members
include the surviving canonical handler and light handler becoming unique;
this change does not fix the light handler's behavior.

## Limits and next work

These are focused current-source runtime tests, not a native Win98,
browser/gameplay or full-build result. Native version availability and
error precedence remain unverified. Invalid non-null pointers, auxiliary
wrapper allocation failure and span-arena exhaustion are not fault-injected.
Material payload allocation/teardown is outside this QI-only fixture.

Next: device, light, texture and execute/vertex-buffer QI validation;
DirectDraw/D3D parent identity and reference retention remain a separate
ownership issue. Material data methods and their version-specific behavior
are not certified by this change.
