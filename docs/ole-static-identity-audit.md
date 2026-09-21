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

At that checkpoint, repeated IDataObject QI still cleared and rebuilt entries
synchronously (corrected below). Guest-media cache copy/retirement needs its
own transaction audit. Internal final releases of
local objects do not generally schedule guest teardown (the pre-existing
`ole_release_local_interface`/`ole_obj_release` limitation); routing a data
reference to its owner does not solve that wider continuation problem.
Standalone IDataObject QI still checks only Data1. Exhaustive reentrant
cleanup, all-face navigation and WordPad embedded-picture save/browser
coverage remain required before calling the entire ownership audit complete.

## Follow-up: interface lookup must not refresh stored data

A new public-thunk regression on `361df0bf` reproduced destructive repeated
QI: SetData successfully transferred one guest stream/releaser entry to the
face, then QI(IDataObject) reduced its entry count from 1 to 0. This is data
loss caused by interface navigation, not an application cache mutation.

Split lazy interface lookup (`ole_static_data_object`) from explicit cache
refresh (`ole_static_refresh_data_object`). Existing faces are returned
unchanged; initial creation and `ole_cache_sync_render_slot` still populate
or refresh them. This is not a lazy stale-cache workaround: the regression
also changes cache data twice and uncaches it while holding the same face.
Repeated QI from root, data, persist, cache and view interfaces preserves the
stored entry, its availability and its guest ownership until final Release.

The broader guest-media refresh transaction remains open: cache changes still
copy/retire face entries synchronously, so DLL-private AddRef/Release and
failure rollback during those changes need a separate correction. The new
cache-mutation checks use HGLOBAL, not evidence that guest-stream refresh is
fixed. Microsoft's linked QI rules above establish interface navigation and
identity; the data-loss finding itself is executable evidence from this repo.

Validation: guest callback suite (123 checks, plus repeated-QI assertions),
static handler (66 checks), and WordPad copy/cut/paste (5 checks) pass on the
shared main worktree. The new repeated-QI assertion was observed failing
before the source change (`0 !== 1` stored entries). Fragment balance and
`git diff --check` pass. No full-browser embedded-picture save claim.

## Guest-media refresh: private-layout corruption reproduced

Run `node tools/probe-ole-cache-media.js` against the current source. This is
a diagnostic that intentionally exits 1 while the contract is broken, not a
passing suite entry. It loads PE/COM thunks and supplies guest x86 AddRef and
Release methods. Unlike the older callback fixture, its COM reference count
is at +24; +4 is a private cookie. COM does not expose an object's refcount
layout to callers, so this distinguishes a real callback from host writes.

Observed after `8c9fd2b1`, in both orders (populate cache then query the face,
or query the face then populate cache):

```text
                         private cookie   refs  AddRef calls  Release calls
initial                  0x13572468           1       0             0
after face population    0x13572469           1       0             0
after unrelated edit     0x1357246a           1       0             0
after final Release      0x1357246a  0xffffffff       0             2
```

The cache takes ownership with SetData(TRUE), so it legitimately owns the
initial reference. The face does not acquire a second real reference.
Root-first Release returns 1 and final face Release returns 0, demonstrating
that successful public return values alone do not prove balanced ownership.
The fixture deliberately does not free itself on zero, allowing observation
of the second Release; a real guest object could already have been freed.

Source chain:

1. `ole_static_refresh_data_object` copies each cached medium through
   `ole_data_set_entry` -> `ole_copy_medium`.
2. For IStream/IStorage, `ole_copy_medium` calls `ole_obj_addref` directly,
   assuming the emulator's private object layout. This writes the guest's
   +4 cookie without invoking its vtable. (The older fixture's refcount at
   +4 made this mistake look superficially correct.)
3. Refresh clears prior entries with `ole_release_medium`, whose local-only
   interface release does not invoke the DLL-private Release. Another copy
   then corrupts +4 again.
4. Final public teardown correctly visits the cache and face media, exposing
   the missing acquisition as two real Releases against one real reference.

Do not fix this by skipping the second final Release: the copied face and
cache claim separate ownership, and refresh must also retire previous copies.
Do not merely reject guest pointers inside `ole_copy_medium`: refresh ignores
the copy HRESULT and would silently omit the format instead of fixing it.

The next implementation must either eliminate duplicated media ownership
(make the aggregated data face operate on the canonical cache, while keeping
clipboard snapshots independent), or stage/retain/commit/retire refresh via
guest continuations, including failure rollback and reentry. Audit GetData,
GetDataHere, QueryGetData, SetData, EnumFormatEtc, InitFromData, synthesized
metafiles and cache mutation together. Existing independent clipboard staging
already models guest AddRef before publication; it is not interchangeable
with a live aggregated interface. This diagnostic is the acceptance check
for private-layout integrity and balanced final guest callbacks.

## Correction: cache owns media; live face borrows

The live face now owns only its entry array and copied FORMATETC metadata.
Its STGMEDIUM descriptors borrow the canonical cache's media. All external
references already keep the controlling root alive. Rebuilding or destroying
the view therefore frees metadata without AddRef/Release on the borrowed
media; final root cleanup releases the canonical cache once. The redundant
child-media teardown scan was removed. Independent IDataObject instances
and clipboard snapshots retain their existing owned-media behavior.

IDataObject::SetData on a live face forwards to IOleCache's existing mutation
transaction, including real guest AddRef for FALSE and guest retirement for
replacement. It no longer creates a second media owner invisible to the
cache. GetData still acquires the caller's own reference/copy through its
existing public callback path.

The corruption probe now passes both creation orders: the cookie remains
0x13572468 throughout, refresh makes no guest reference calls, and final
destruction makes exactly one Release, taking the real reference count to 0.
The regular callback suite adds opaque-layout IStream/IStorage tests with
SetData(TRUE/FALSE), owned GetData outputs, independent GetClipboardData
snapshots that survive root destruction, and Uncache while the face is held.
137 callback checks pass. Substituting the pre-change source in memory fails
the new canonical-owner assertion, without editing the worktree.

Static-handler 66, ROT 28 and WordPad text copy/cut/paste 5 checks pass.
This does not prove allocation-failure atomicity of the descriptor rebuild:
the existing refresh still ignores individual metadata-copy failures. Nor
does it solve the general internal-final-release continuation limitation or
exhaustive callback reentry. Those remain open rather than being hidden by
the successful opaque-layout probe.

Additional integration finding: `test/test-wordpad-ole-roundtrip.js` fails
7/9, exporting a 177-byte RTF with two object positions but no WMF picture
payloads. The same test against a separately compiled pre-change OLE fragment
also fails 7/9 with the same 177-byte output. The baseline artifact was
`/private/tmp/wa-ole-before-borrowed.wasm`, compiled with the normal source
closure and only `09a7b-ole.wat` substituted from HEAD; `WINE_ASSEMBLY_WASM`
pinned the CLI to it. Thus this patch does not establish picture round-trip
support, and that failing integration route is the next investigation, not a
passing result or a failure attributed to these borrowed-media changes.

## WordPad picture-save correction: OleDuplicateData returns HGLOBAL

The targeted API trace showed successful IDataObject::GetData for
CF_METAFILEPICT and successful OleDuplicateData, followed by GlobalLock on
the returned copy. No GetMetaFileBitsEx followed. The duplicate wrapper was
allocated with `heap_alloc` but never marked as Global memory; the stricter
GlobalLock correctly rejected that private allocation. RichEdit consequently
serialized two empty `\\pict\\wmetafile0` groups. The trace is available from
the investigation at `/private/tmp/wa-wordpad-picture-trace.log`.

[Microsoft's OleDuplicateData contract](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-oleduplicatedata)
specifies GlobalAlloc flags for copied memory. The handler now publishes its
memory result, including the METAFILEPICT wrapper, with `heap_global_mark`.
The CF_ENHMETAFILE branch remains a GDI handle, not a Global allocation.
GlobalLock's validation is unchanged. This fixes the producer's handle type
rather than permitting arbitrary heap pointers through the consumer.

The public-API regression duplicates text, DIB and registered-format memory,
checks independent bytes and GlobalLock/GlobalSize, and verifies GlobalFree
succeeds once while a second free/lock rejects the dead handle. The existing
WordPad picture save test now passes **9/9**, exporting **10,261 bytes** with
two structurally valid WMFs, each containing a complete 32x24 StretchDIB.
This test validates saved bytes, not reopening them or browser interaction.
Allocation flags beyond the runtime's current fixed-address Global-memory
model and the other GDI clipboard formats remain separate coverage gaps.
Guest callback suite: 143/143; opaque cache-media probe: both orders pass.
The same new HGLOBAL assertion fails with the pre-change OLE source supplied
in memory. Fragment balance and whitespace checks pass; no foreign changes
were reverted for either comparison.
