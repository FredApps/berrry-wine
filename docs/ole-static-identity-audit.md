# Static OLE identity/lifetime audit — OPEN

2026-09-21, after `9078985f`. This is a reproduced correctness gap, not a fix.

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

## Ownership traced in current source

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
