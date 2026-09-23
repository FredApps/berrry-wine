# Legacy D3D root lifetime

2026-09-22. Review items: shared COM lifetime implementations and silent-success
handlers (P5 #5/#7).

## Finding and fix

IDirect3D and IDirect3D3 AddRef returned 1 without changing ownership; Release
returned 0 without retiring the object. Version 2/7 already used the shared
DX reference-count handlers. The new public-dispatch regression failed on
the first D3D1 AddRef (actual 1, expected internal count 2).

The four constant handlers are removed. API-table aliases route them to
dx_com_addref / dx_com_release_basic. This follows the increment/decrement
contract described by Microsoft:
[AddRef](https://learn.microsoft.com/en-us/windows/win32/api/unknwn/nf-unknwn-iunknown-addref),
[Release](https://learn.microsoft.com/en-us/windows/win32/api/unknwn/nf-unknwn-iunknown-release).
Exact internal counts in the test are emulator ownership assertions, not a
claim that native implementations expose identical diagnostic counts.

The audit also found that a device stored its creator slot for GetDirect3D
without owning a reference. Making root Release real without fixing this
would expose an early-retirement bug. Shared device creation now retains the
creator; nonfinal device release leaves it intact; final release clears the
link and drops it. D3D3's duplicated creation body now delegates to that same
core, preserving its distinct 24-byte stdcall cleanup.

## Coverage

test/test-d3d-root-lifetime.js uses actual API-table dispatch for all four
root interfaces and device versions 2/3/7. It checks AddRef/Release state,
nonfinal/final retirement, GetDirect3D after the caller releases its creator,
both parent/device release orders, intermediate device references, stack
guards/cleanup and device-state allocation balance.

The existing device/viewport/light ownership regression, DirectDraw
QueryInterface regression and 211-method D3DIM interface-spec check also pass.
Fragment balance, handler ESP, generated epilogues, logical operands, quiet
inventory, duplicate ratchet, test tiers, dispatch freshness, API hash table
and whitespace checks pass.

Manual quiet handlers: 247 -> 243; metadata stubs remain 22.
Exact duplicates: 123 groups unchanged, 491 -> 487 members.

## Still open

This does not certify the whole DirectDraw/D3D ownership model. D3D root
QueryInterface still recognizes partial GUIDs and its DirectDraw-parent
lookup has a slot-zero ambiguity and a fallback scan. DirectDraw-created
D3D roots remain independent entries without a retained DirectDraw parent;
cross-interface controlling-IUnknown identity and native Win98 generation
rules need a dedicated review. Render-target/texture retention, device
creation allocation-failure rollback, thread-safe reference counts and
retired-slot reuse are also outside this change.

No native Win98, browser/gameplay, full-build or performance claim is made.
