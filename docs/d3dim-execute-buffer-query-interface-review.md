# D3DIM execute-buffer QueryInterface

2026-09-22. P5 COM correctness/shared-implementation follow-up.

## Reproduced fault and fix

ExecuteBuffer QueryInterface delegated to family 0 in the old routing
core. That branch recognized only the first word of IUnknown and had no
execute-buffer IID match. A valid own-interface query returned
E_NOINTERFACE; the new regression failed on that exact result before the fix.

The handler now uses the shared child QI core with its own interface family.
Only complete IUnknown and IDirect3DExecuteBuffer IDs are supported. Both
return the object's identity with one reference acquired; rejection clears
output without AddRef. Null IID/output returns E_POINTER. One acquired GUID
span supports nonadjacent sparse pages and is released before ownership
changes; output writes remain sparse-safe.

The IID is from Microsoft's
[SDK d3d.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/d3d.h).
No Wine source was used. Execute-buffer creation, payload storage and
specialized Release/cache cleanup are unchanged.

## Coverage

The former light-only regression is now
`test/test-d3dim-child-query-interface.js`. One harness runs both light and
execute-buffer cases: own and IUnknown identity, a complete material IID
rejected, twelve GUID corruptions per type, nulls/output clearing, balanced
references through public Release, stack guards, and 64 sparse input/output
cycles per type with balanced temporary span storage.

Both child cases and the material QI regression pass against current source.
Fragment, ESP, epilogue, logical-operand, quiet-inventory, duplicate, tier
and 211-method interface-spec gates pass. Counts remain 119 duplicate groups /
476 members and 243 manual quiet handlers + 22 metadata entries.

This fixture creates bare COM objects, not populated execute buffers.
It does not certify creation failure rollback, payload/cache teardown,
invalid non-null pointers, native Win98 error precedence, browser gameplay
or a full build. Those are not implied by passing QI/reference tests.

## Next audit

Vertex-buffer QI still accepts every IID. Device QI matches only the first
GUID word. Texture QI has an accept-current-interface fallback plus surface
ABI/identity concerns. DirectDraw/D3D parent retention remains separate.
