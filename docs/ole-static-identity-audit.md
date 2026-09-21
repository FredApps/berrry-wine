# Static OLE identity/lifetime audit — controlling identity fixed, follow-ups open

Initial reproduction: 2026-09-21, after `9078985f`. The original observations
below are preserved; the implemented correction and remaining gaps follow.

Run `node tools/probe-ole-static-identity.js`. It initializes the real PE/COM
thunks, invokes public vtable methods, prints its observations and exits 1
when controlling identity or reverse interface navigation is wrong. It reuses
the existing render harness; it is a diagnostic, not a passing test-tier entry.

## Observed

The corrected temporary precursor produced this sequence (addresses are
run-specific):

```text
IOleObject                 16880780
  QI(IDataObject)       -> 16881316, S_OK
  QI(IUnknown)          -> 16880780, S_OK
IDataObject
  QI(IUnknown)          -> 16881316, S_OK       WRONG IDENTITY
  QI(IOleObject)        -> NULL, E_NOINTERFACE WRONG NAVIGATION

After balancing temporary IUnknown references:
  Release(original root) -> 0
  held IDataObject refcount remains 1
  Release(data face)     -> 0
```

The first exploratory probe omitted PE/thunk initialization and produced
unchanged output sentinels; discard that run. The corrected probe validated
nonzero thunks and completed each guest continuation.
The committed probe was then run independently and reproduced the same
observations, reporting the expected failing contract rather than a green
test. This run occurred at roughly 50 host load average; no timing or
performance conclusion is drawn from its duration.

[Microsoft's QueryInterface rules](https://learn.microsoft.com/en-us/windows/win32/com/rules-for-implementing-queryinterface)
require one controlling IUnknown pointer across an object's interfaces and
symmetric interface navigation. A clipboard snapshot can be an independent
object; a face returned by this object's QueryInterface cannot silently be
such a snapshot.

## Ownership traced before the fix

`ole_static_data_object` allocates a normal 32-byte kind-4 data object and
stores it at root+164, holding its initial reference. It copies cached media
into that object. `ole_static_query_interface` AddRefs the child, not the
root, when returning IDataObject. The child has no controlling-owner field.
Its QueryInterface returns itself for IUnknown and rejects IOleObject.
Root destruction clears +164 and releases its child reference, allowing the
child to outlive its controlling object. The observed zero root Release is
therefore actual teardown, not merely an independent refcount convention.

## Required implementation and proof

1. Distinguish the aggregated data face from independent clipboard/data
   objects. Preserve the latter's existing ownership and snapshot semantics.
2. Every external reference to the face must keep the controlling root alive;
   returning IUnknown must return that root with one owned reference. Reverse
   queries must delegate to the root's full-GUID contract.
3. Avoid a root/child strong-reference cycle. Separate the root's private
   child-storage ownership from externally acquired face references.
4. Last release through any face must run existing guest client-site,
   advisory-sink and media cleanup continuations exactly once. Audit internal
   `ole_obj_addref/release`, public aliases, media ownership and clipboard
   retention together, not just the three public IDataObject methods.
5. Prove identity/reflexivity/symmetry/transitivity for every face, root-first
   and child-first release orders, retained-face cache updates, standalone
   data objects, independent snapshots, malformed guest cleanup and reentry.
   Re-run OLE callbacks plus WordPad embedded-picture save/paste coverage.

The adjacent IDataObject QueryInterface still matches only Data1, unlike the
recently corrected root query. Delegation must close that hole for aggregated
faces without weakening independent-object GUID validation.

## Implemented 2026-09-21

The kind-4 allocation now reserves 36 bytes, with a controlling-owner pointer
at +32. Standalone data objects and clipboard snapshots leave it zero. The
static root privately owns its child storage; external AddRef/Release route
to the root, including the internal reference helpers. Destruction detaches
the owner before retiring the child's private reference, avoiding a cycle.
The aggregated face delegates QueryInterface to the root's full-GUID check.

Public final Release routes through the existing static guest continuation.
Its preflight and media cursor now include the data face's owned entries,
alongside the root's site, sinks and cache; no new callback mechanism is used.

The public probe now returns one IUnknown pointer, successful reverse
IOleObject navigation, original-root Release=1 and final-data Release=0.
Guest callback coverage tests both release orders, public/internal reference
delegation, malformed-GUID rejection, malformed guest Release preflight and
exactly-once site/sink/stream/releaser cleanup. Existing independent snapshot
and clipboard-media checks remain in that suite.

Validation on the shared main worktree: guest callbacks 120/120, static
handler 66/66, ROT 28/28 (plus GUID assertions), and WordPad copy/cut/paste
5/5 passed. These are correctness checks, not performance measurements or
a full embedded-picture browser/save run.
An in-memory negative control substituting the pre-fix OLE source fails the
new private-face ownership assertion (refcount 2 rather than 1); no worktree
source was reverted to run it.

Still open: cache refresh via repeated IDataObject QI currently clears and
rebuilds entries synchronously; retained-face cache coherence and guest-media
copy/retirement need their own transaction audit. Internal final releases of
local objects do not generally schedule guest teardown (the pre-existing
`ole_release_local_interface`/`ole_obj_release` limitation); routing a data
reference to its owner does not solve that wider continuation problem.
Standalone IDataObject QI still checks only Data1. Exhaustive reentrant
cleanup, all-face navigation and WordPad embedded-picture save/browser
coverage remain required before calling the entire ownership audit complete.
