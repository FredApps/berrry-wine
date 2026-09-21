# Embedded OLE reference-count aliases, 2026-09-21

Addresses the remaining Pass-5 recommendation 5 duplicate-handler drain in
`fable-review.md`. IPersistStorage, IOleCache and IViewObject had three copies
each of the same AddRef and Release dispatch body. Six API rows now name two
shared generated-handler aliases, removing four redundant bodies. API IDs,
names, argument counts and vtable slots are unchanged.

This is not a merge into generic direct-object lifetime handling. The shared
AddRef first resolves the embedded interface through `ole_static_root`, then
increments the controlling object's count. Release still calls
`ole_static_release_api` with the same root and eight-byte stdcall cleanup,
preserving client-site, advisory-sink and cached-medium guest continuations.
QueryInterface behavior is untouched.

The ROT test pins all six metadata aliases and absence of private duplicate
bodies, then invokes each interface's real AddRef/Release vtable slots. It
checks the controlling count, balanced AddRef/Release, final Release, and the
existing thunk runner's ESP restoration and continuation termination checks.
The static-handler and guest-callback suites provide adjacent teardown coverage.
The latter additionally releases each embedded interface with both an owned
DLL-private client site and advisory sink, checking that each guest Release
callback runs exactly once and restores the caller's sole reference.

Validation on main: ROT 28/28 plus the new vtable/stack assertions; static
handler 65/65; expanded guest callbacks 114/114. Each suite compiles current
source. No browser run or full build-gate run was performed for this refactor.
A negative test substitutes the generic direct-object Release in the compiled
dispatch source in memory, without editing files. It fails the new
IPersistStorage guest-site/sink teardown assertion, demonstrating that the
test distinguishes the specialized cleanup from an incorrect generic alias.

The live exact-duplicate census falls from 142 groups / 548 members to
140 groups / 542 members. The existing ratchet passes without raising or
re-recording its baseline. API append-only and generated-dispatch freshness
checks pass. The overall recommendation remains partial: other duplicate
families still require individual contract and ownership review.
