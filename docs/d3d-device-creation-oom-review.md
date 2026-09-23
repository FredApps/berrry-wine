# D3D device creation: allocation failure

2026-09-22 follow-up to the shared lifetime implementation.

## Finding

The shared D3D2/3/7 creation path allocated a DX object, retained its creator,
then allocated a 4096-byte state block without checking for failure. A failed
heap allocation was passed as zero to state initialization, followed by a
published device and success. Fault injection reproduced success (0) instead
of E_OUTOFMEMORY (0x8007000E).

## Change

Creation clears the output, allocates and checks the state block first, then
allocates the DX object. State failure returns E_OUTOFMEMORY without attempting
to reserve a DX slot or retaining the creator. DX-object allocation failure
frees the private state and preserves the existing E_FAIL result.

Only after both allocations succeed does the path initialize state, retain
the creator, bind the render-target slot and publish the device. Allocating
state first also avoids consuming permanently retired DX slots on repeated
heap failures; freeing a partially constructed DX object would not recover
those slots under the current allocator policy.

## Regression

test/test-d3d-device-creation-oom.js compiles current source with two exact,
uniqueness-checked allocation call-site replacements scoped to
d3dim_create_device. Test wrappers can fail either allocation while invoking
the real allocator when failure is disabled; no production fault flag exists.

All D3D2/3/7 public API-table entry points are exercised, four repetitions
per failure site (24 failures), each followed by successful creation and
release (24 retries). Assertions cover failure HRESULT, cleared output,
unchanged creator refs, balanced heap/live-DX counts, no DX-slot attempt on
state failure, valid state on retry, and the version-specific stdcall cleanup
and stack guard.

The root/device lifetime regression also passes. Fragment, handler-ESP,
logical-operand, generated-epilogue, quiet-inventory, duplicate-ratchet,
test-tier and whitespace checks pass. Inventory counts remain
243 manual + 22 metadata quiet handlers and 123 groups / 487 duplicate members.

This tests the failure edges rather than exhausting the entire shared heap.
Native Win98 HRESULT/error precedence, invalid/null argument behavior,
render-target retention, object identity and retired-slot reuse remain
separate work. No browser/gameplay, performance or full-build claim is made.
