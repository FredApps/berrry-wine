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

## Follow-up: IOleLink is not IViewObject2

The subsequent contract audit found an existing incorrect QueryInterface
alias: Data1 `0000011D` returned the view interface, and the static-handler
test used that ID while naming it IViewObject2. Microsoft's
[SDK oleidl.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/oleidl.h)
identifies `0000011D-0000-0000-C000-000000000046` as IOleLink and
`00000127-0000-0000-C000-000000000046` as IViewObject2. Their vtables are
not interchangeable: IOleLink starts with SetUpdateOptions, while the view
interface starts with Draw. The old comment incorrectly called 11D a
cache-control interface.

Removed the false IOleLink success. This static embedded handler does not
implement linking, so IOleLink now returns E_NOINTERFACE, clears output and
does not AddRef; the actual IViewObject2 IID still returns the view pointer.
The fixture now uses the correct complete IIDs. Added public-vtable queries
through IOleObject and each embedded IPersistStorage/IOleCache/IViewObject
face, with reference-count and stdcall checks.
Validation: static-handler 66/66 and ROT 28/28 plus its added public-vtable
assertions pass on main. Substituting HEAD's pre-fix OLE source in memory
fails the public IOleLink rejection assertion (S_OK rather than
E_NOINTERFACE). Fragment and diff checks pass; no new browser run was made.

This does not complete QueryInterface correctness. The common helper still
matches most requests by Data1 only; full GUID validation and the separate
IDataObject face's controlling-IUnknown identity remain audit items. The
duplicate QueryInterface wrappers have deliberately not been consolidated
before that contract review.

## Follow-up: complete static-object GUID checks

The shared query helper now translates the IID once and validates the other
three DWORDs before dispatching by Data1. Classic OLE/automation requests
require the canonical COM suffix. IPersistStreamInit uses its distinct
`7FD52380-4E07-101B-AE2D-08002B2EC713` identity, verified against
[Microsoft's SDK ocidl.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/ocidl.h).
Rejected queries clear output, do not AddRef, and cannot trigger lazy
IDataObject allocation. Existing interface/class availability is unchanged.

The public-vtable regression flips each of the twelve suffix bytes for eight
classic IDs through three embedded faces (288 rejections), plus 24 mutations
of real IPersistStreamInit/IDispatch IDs on CommonDialog. Valid requests still
succeed and their returned references release normally. Old source fails
at the first forged IUnknown suffix byte. ROT 28/28 plus these assertions and
static handler 66/66 pass. The storage suite passes 79/79 in the current
worktree, including corrected CommonDialog GUID fixtures; its pre-existing,
unrelated EOF-expectation edit is deliberately excluded from this commit,
so that result is not a clean-commit storage-suite claim. The IID fixtures
are committed independently of that edit. Initial excess parentheses were
caught by the fragment check and corrected before runtime testing.

Remaining: the separate IDataObject face's controlling-IUnknown identity,
complete class-GUID checks in the CommonDialog factory, and the duplicate
QI dispatch bodies. Full-GUID matching alone does not close those contracts.
Fragment and A/W checks pass. The shared-tree duplicate gate currently
reports three new ACM audio-stub members outside this change; no baseline
was raised. No full build or browser claim is made for this slice.
