# DirectDraw palette QueryInterface review — 2026-09-22

The palette handler always returned E_NOINTERFACE, including for its own IID
and IUnknown. It now delegates to `dx_query_interface_single`, translating the
IID once and reusing the existing full-GUID comparison and output/refcount
mechanics. No new COM helper or alternate lifetime path was added. The palette's
specialized Release (including its worker fence) remains unchanged.

Microsoft's [QueryInterface contract](https://learn.microsoft.com/en-us/windows/win32/api/unknwn/nf-unknwn-iunknown-queryinterface%28refiid_void%29)
requires an acquired reference on success, NULL output on unsupported interface,
and E_POINTER for a NULL output argument. The palette inherits IUnknown;
its IID is defined in Microsoft's [SDK ddraw.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/ddraw.h).

## Verification

`node test/test-directdraw-palette-query-interface.js` failed against the old
handler at the first own-interface query (E_NOINTERFACE instead of S_OK).
The regression checks own IID and IUnknown, repeated stable identity, one
reference per successful query, mutations in each of the four GUID words
(including the clipper IID), output clearing, NULL output, unchanged refcount
on failures, and actual palette Release down to object retirement. Query and
Release stack cleanup are checked separately.

After the fix, the new regression, `test-directdraw-palette-format.js`, and
`test-directdraw-factory-query-interface.js` pass. Silent inventory, handler
ESP, WAT fragment balance, logical-AND, test-tier and whitespace checks pass.

NULL riid retains the shared helper's defensive E_NOINTERFACE/clear-output
policy; this is not a native Win98 observation or a promised COM input.

## Remaining work

- The subsequent [clipper QI fix](directdraw-clipper-query-interface-review.md)
  separates native/VB identities and acquires references. The native probe also
  exposed a missing VB vtable tail slot; the follow-up native ABI probe and
  regression now cover its repair. Other VB methods remain incomplete.
- Arbitrary invalid pointers, cross-page IID buffers, concurrent refcount
  updates and PAGE permissions are not covered by this change.
- This is a focused handler regression, not a browser/game performance result
  or a native Win98 conformance run. Other palette methods remain separate work.

Quiet inventory: 249 -> 248 manual entries; 22 metadata entries unchanged.
