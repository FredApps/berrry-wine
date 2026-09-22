# DirectDraw attachment query ownership

Follow-up to the COM lifetime work in `fable-review.md` P5 #5.

The successful `IDirectDrawSurface_GetAttachedSurface` path returned its
stored child pointer without acquiring a caller reference. A caller releasing
that result could therefore consume the attachment's reference instead.
[Microsoft documents that GetAttachedSurface increments the returned interface's reference count](https://learn.microsoft.com/en-us/windows/win32/api/ddraw/nf-ddraw-idirectdrawsurface7-getattachedsurface).
The successful path now uses the existing `$dx_com_addref` core before
publishing the child. Failure paths do not acquire a reference.

The surface-caps regression now checks two successful queries (counts 2 and
3), rejection without another reference, and two public Release calls back
to count 1. GetSurfaceDesc still succeeds afterward. Before the runtime fix,
the test fails at the first count assertion: actual 1, expected 2.
After the fix, surface-caps, back-buffer descriptions, mip-chain and explicit
attachment-detachment suites pass. Fragment balance, handler ESP and whitespace
checks pass on the shared worktree.

## Separate stale failure-output assertion

The reported surface-caps failure was not caused by generated test wrappers:
the test calls its own injected handler adapter. Commit `ddefa6378` changed
failed GetAttachedSurface queries to clear the output for the mip-chain path,
whose regression expects zero. The older caps test still expected its seeded
`0xdeadbeef`. It now asserts the existing zero-output policy explicitly, without
claiming that policy is a measured native Win98 contract. This change does not
alter failure-output behavior in production.

## Scope and open work

This is a successful-query ownership fix, not complete attachment support.
The handler still searches the one stored implicit child rather than all
explicit attachments; ambiguity, invalid pointers/objects and full capability
structures require further review. Parent teardown also does not yet retire
its implicit child chain. Those gaps remain open. No native capture, browser
gameplay, performance or full-release validation is claimed here.

## Invalid receiver and NULL parameter follow-up

GetAttachedSurface now resolves receivers and its stored child through a
bounded primary/auxiliary COM-wrapper registry lookup. It rejects unaligned,
foreign, null-vtable, out-of-range-slot, non-surface and retired wrappers
without using `$dx_from_this`'s invalid-slot-to-zero fallback. This check is
local to this API; other users of that fallback remain to be reviewed.
NULL capability/output parameters return DDERR_INVALIDPARAMS before accessing
either pointer or acquiring a reference. Invalid receivers return
DDERR_INVALIDOBJECT. Both early returns retain the 16-byte stdcall cleanup.

The public-handler regression exercises NULL/wild/unaligned/heap-forged
receivers, a corrupted registered slot, retired receiver/child, NULL
parameters, preserved output/refcount on invalid input, and a live auxiliary
interface. Restoring only the previous handler during compilation fails the
invalid-receiver assertion. The mip-chain fixture now seeds its surface
vtable as production initialization does; it previously created null-vtable
objects because it called handlers directly.
Surface-caps, mip-chain and back-buffer suites pass after this change, as do
fragment balance, handler ESP, logical-operand, tier and whitespace gates.

The error categories follow Microsoft's documented API surface; exact
Win98 fault precedence and output preservation on invalid input have not
been captured natively. This does not validate arbitrary non-NULL guest
buffer accessibility or enforce PAGE_* permissions. Recycled-wrapper ABA,
concurrent lifetime races, explicit-attachment lookup and parent-chain
teardown also remain open.
