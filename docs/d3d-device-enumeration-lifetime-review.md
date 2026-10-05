# Direct3D device enumeration lifetime

2026-09-22. Scope: IDirect3D1/2/3/7 EnumDevices invocation ownership,
not a new native Win98 capability census.

## Finding

Five module globals held callback, context, caller return, index and version.
A callback starting another enumeration overwrote the outer invocation.
The pre-fix regression failed when the outer enumeration resumed callback
0x12345688 (inner) instead of 0x12345678 (outer).

Each legacy item also allocated GUID, description, name and two descriptors
without freeing them; D3D7 allocated two strings and a caps descriptor.

## Change

One 588-byte heap record owns both invocation state and inline payload:

| Offset | Contents |
| --- | --- |
| 0–19 | Callback, context, caller return, index, interface version |
| 20–35 | GUID |
| 36–67 | Description |
| 68–83 | Short name |
| 84–335 | Legacy HW descriptor or D3D7 caps |
| 336–587 | Legacy HEL descriptor |

A hidden guest-stack slot carries the record pointer across callbacks.
Cancellation and exhaustion share cleanup: capture caller return, free record,
pop the hidden slot, return success. Allocation failure returns E_OUTOFMEMORY
without pushing that slot. The five mutable globals are removed; the shared
continuation thunk remains.

Legacy six-argument and D3D7 four-argument callbacks remain distinct.
Existing device order, GUIDs and descriptor contents are preserved. Inline
buffers are callback-scoped scratch; callers must copy data they retain.
The internally allocated record is contiguous, so each dispatcher translates
its base once and derives its inline string/GUID addresses.

## Evidence and limits

`node test/test-d3d-device-enumeration-lifetime.js` exercises actual API-table
dispatch for all four interfaces, 16 nested version pairs, and 96 alternating
complete/cancel cycles. It checks callback/context restoration, descriptor
sizes and color models, GUID identity, names/order, stack guards, one live
allocation during enumeration, and allocation balance after returning.

Adjacent format enumeration (36 nested pairs / 120 balanced cycles) and
DirectDraw mode enumeration (64 balanced cycles) also pass on current source.
Fragment balance, handler ESP, generated epilogues, boolean operands,
generated dispatch, test tiers and whitespace checks pass. Quiet-stub and
duplicate ratchets remain unchanged at 247 manual + 22 metadata and
123 groups / 491 members respectively.

The first group simulates callback RET and calls the production continuation.
A second group now executes 32 real x86 nested cases: every outer/inner
interface pair, each with full completion and immediate cancellation. Guest
code calls the generated COM vtable thunk, each outer callback invokes the
inner enumerator, and callbacks execute RET 24 or RET 16 into the production
continuation thunk. Assertions cover both callback counts, HRESULT, final
and nested ESP, a caller stack guard, and allocation balance. Each case uses
unique code addresses so cached decoding cannot conceal changed instructions.

The real-x86 setup loads the bundled Notepad PE to initialize CPU state and
continuation thunks, but never runs its entry point. An initial harness-only
attempt omitted the PE-loader continuation setup: the first inner callback
returned to zero with an unbalanced stack. Loading through the production
path fixed that test setup; no runtime workaround was added.

No native Win98 comparison, browser/gameplay claim, allocation-failure fault
injection, nonlocal callback exit cleanup, or full-build certification is
implied.

Next candidates: audit remaining callback enumerators for mutable invocation
globals and unowned payloads; extend real x86 callback coverage to the mode
and format families, and add allocation-failure coverage.
