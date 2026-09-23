# D3D root QueryInterface identity

2026-09-22. Scope: the root-family branch of the shared D3DIM QI core,
called by IDirect3D1/2/3/7.

## Finding and change

The core recognized only the first GUID word. Changing another word still
returned success and gained a reference; the new regression reproduced this.
Its IUnknown path also chose the current wrapper's vtable, allowing an
upgraded root interface to return a different IUnknown pointer.

Root queries now reuse the existing complete DirectDraw/D3D GUID classifier,
without duplicating its constants. A single 16-byte guest span handles a
GUID crossing nonadjacent sparse pages and is released before ownership
changes or returns. Rejected queries clear the output and do not AddRef;
null output or null IID returns E_POINTER. The supported set is unchanged:
IUnknown, the existing DirectDraw1 parent path, and D3D1/2/3/7.

IUnknown now returns the root entry's primary wrapper and gains one reference.
That enforces identity across the root's versioned wrappers, as required by
[Microsoft's QueryInterface rules](https://learn.microsoft.com/en-us/windows/win32/com/rules-for-implementing-queryinterface).
It does not establish a common identity between the separately allocated
DirectDraw and D3D entries.

## Coverage

test/test-d3d-root-query-interface.js calls all four public API-table QI
entries. It tests 96 GUID corruptions (each of four words independently),
all 16 root-version upgrade combinations, preserved original vtables,
canonical IUnknown, null inputs, output clearing, stack guards and balanced
reference counts. Another 64 cycles use deliberately nonadjacent sparse
pages for a crossing GUID and crossing output, checking that temporary
guest-span storage returns to its original cursor.

Root/device lifetime and DirectDraw QI regressions also pass. Scoped fragment,
ESP, logical-operand, epilogue, quiet-inventory, duplicate, test-tier and
whitespace gates pass. Quiet counts remain 243 manual + 22 metadata;
duplicate counts remain 123 groups / 487 members.

## Remaining

DirectDraw-parent retention, the slot-zero ambiguity/fallback scan, and
native Win98 interface-generation rules remain open. Other D3DIM interface
families still use the older partial-IID core; this change deliberately
does not claim those families were audited. Invalid non-null pointers and
guest-span arena exhaustion are not certified by this regression.

No native Win98, browser/gameplay, full-build or performance claim is made.
