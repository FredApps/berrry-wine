# D3DIM light QueryInterface

2026-09-22. P5 false-success/shared-COM follow-up.

The light handler returned S_OK and AddRef for every IID, including a
complete Material1 IID. `test/test-d3dim-child-query-interface.js` reproduced
that failure before the change.

The handler now delegates to the existing child QI core with a separate
light family. It accepts only complete IUnknown and IDirect3DLight GUIDs,
keeps one controlling identity, clears rejected outputs without AddRef,
and rejects null IID/output with E_POINTER. Input spans are acquired once
and released; sparse output uses the existing guest writes. Specialized
light Release and light-payload teardown are unchanged.

The IID comes from Microsoft's
[SDK d3d.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/d3d.h).
No Wine source was used.

## Regression coverage

The new test invokes public API dispatch for QueryInterface and Release:
complete foreign IID rejection, twelve GUID corruptions, both supported
identities, output clearing, nulls, reference balancing, stdcall stack
guards, and 64 nonaffine sparse input/output cycles with balanced temporary
span storage. The separate viewport/light ownership test covers attached
light lifetime; the material QI test protects the shared helper's other
family.

The light, material QI and viewport/light ownership regressions pass. Scoped fragment,
handler ESP, epilogue, logical-operand, quiet-inventory, duplicate, tier and
211-method interface-spec gates pass. Counts remain 119 duplicate groups /
476 members and 243 manual quiet handlers + 22 metadata entries.

## Limits

This does not certify native Win98 error precedence, invalid non-null
pointers, allocation-failure paths, browser gameplay or a full build.
Device, texture and buffer QI paths still need their own complete-IID and
ownership audits; DirectDraw/D3D parent identity and retention remain open.
Source inspection identifies a concrete next regression: ExecuteBuffer QI
passes family 0, which has no own-IID match in the routing core, while the
vertex-buffer branch accepts everything. Device matches only the first
GUID word; texture also has an unconditional current-vtable fallback and
surface ABI/identity concerns. Those need behavior tests, not just aliases.

Follow-up: the [execute-buffer QI regression and fix](d3dim-execute-buffer-query-interface-review.md)
confirmed that own-IID rejection. The light regression was renamed to the
shared child-interface test so both object types use one test harness.
