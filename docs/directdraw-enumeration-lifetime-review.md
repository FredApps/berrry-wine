# DirectDraw display-mode enumeration lifetime — 2026-09-22

EnumDisplayModes used five mutable globals for callback, user context, caller
return, descriptor and current index. Its 108-byte descriptor was allocated
on every call and never released. A nested enumeration replaced the outer
callback and iteration state.

Each invocation now owns one 124-byte heap record containing those fields
and an inline DDSURFACEDESC. A hidden pointer behind the callback arguments
identifies that call on return. Normal exhaustion and cancellation release
the record; allocation failure returns E_OUTOFMEMORY before dispatching a
callback. The existing mode table, hole skipping, pixel masks, host-resolution
policy, filters/flags behavior and callback argument layout are unchanged.

## Evidence

The new `test/test-directdraw-enumeration-lifetime.js` reproduced the old
nested-call failure: outer callback 0x12345678 became inner callback
0x12345688. It tests real public API dispatch with simulated RET-8 callback
returns through the production continuation. Assertions cover separate live
payloads/context, outer index advancement, caller EIP/ESP and stack sentinel,
the full dense mode count, the 320x200x8-only hole rule, and the final
1920x1080x32 row. Sixty-four alternating exhaustion/cancellation cycles require
one live record during enumeration and zero net allocations on return.

The pre-existing display-mode suite additionally checks the shared A/W mode
table and host-size behavior (32 checks passed); launch-resolution tests pass
18 checks. The D3D enumeration regression also passes its 36 nested pairs and
120 allocation-balanced cycles. No native Win98 driver capture, real x86 callback
execution, OOM fault injection or exception/nonlocal-exit cleanup is claimed.
Existing descriptor filtering and flags validation remain separate API
correctness work; this fix does not certify the complete native contract.

Fragment balance, handler ESP, generated epilogues, silent inventory, duplicate
ratchet, test tiers and whitespace checks pass. Counts remain 247 + 22 quiet
handlers and 123 duplicate groups / 491 members. The shared-tree logical-AND
gate still flags the concurrent `09a8g-gl-raster.wat` (line 797 in this run),
not this change; no green full-build claim is made.

D3D EnumDevices remains the next lifetime candidate: its callbacks still use
global state, and each advertised device allocates separate strings/GUID/caps
without the completion cleanup seen in these repaired enumeration families.
