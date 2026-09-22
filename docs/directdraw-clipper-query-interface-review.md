# Clipper QueryInterface — 2026-09-22

The native clipper handler returned success for every IID, did not acquire a
reference, and wrote through NULL output. The DX7VB clipper delegated to it,
so it also claimed native interfaces despite its incompatible method layout.

Both now delegate to `dx_query_interface_single`: one IID translation, all four
GUID words checked, one reference acquired for success, NULL output rejected,
and unsupported output cleared. Native accepts IUnknown/IDirectDrawClipper;
VB accepts IUnknown/its distinct DirectDrawClipper typelib IID. Each preserves
its own pointer and vtable. They share state internally, but the hidden native
implementation pointer is not advertised as a VB object's COM interface.
Specialized clipper Release and explicit clip-list destruction are unchanged.

## Evidence and scope

The [native fixture](../test/fixtures/win98-clipper-interfaces/README.md) records
two identical Win98 runs: native own/IUnknown queries preserve identity and
acquire references, while forged and VB IIDs fail and clear output. The VB IID
and incompatible ABI come from Microsoft's loaded typelib. A real VB clipper
could not be created in that VM, so the VB implementation is a bounded
IUnknown/declared-interface contract, **not a native VB QI conformance claim**.
Optional interfaces beyond those two remain unsupported.

`test/test-directdraw-clipper-query-interface.js` uses actual native and VB
creation handlers. Before the fix, it failed because three successful queries
left refcount 1 instead of 4. It checks repeated own/IUnknown queries, distinct
vtables, cross-family and IDispatch rejection, corruption of each GUID word,
NULL output, output clearing, reference conservation, actual specialized
Release down to retirement, and QueryInterface/Release stdcall cleanup.

The new regression, surface-clipper ownership suite and native-fixture integrity
checks pass. Silent inventory (248 manual + 22 metadata), handler ESP, fragment
balance, logical-AND, test-tier and whitespace checks pass.

## Open

- The VB factory still builds 10 slots instead of the typelib's 11. Repairing
  its IsClipListChanged tail requires establishing the output type/width and
  adapting it, not blindly wiring a native BOOL writer into a VB method.
- VB's other DirectSlot fallbacks are not implementations of its full typelib.
- NULL riid keeps the shared helper's defensive policy; arbitrary invalid
  pointers, sparse-page-straddling IIDs and concurrent refcounts remain outside
  this change. Factory aggregation/argument validation also remains separate.
- No browser/game, performance, full-build or comprehensive Win98 result is
  claimed by this focused fix. The quiet-handler pin does not change: the old
  clipper already wrote an output and therefore was not a quiet entry.
