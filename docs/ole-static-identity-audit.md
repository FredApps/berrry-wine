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

## Fresh-process picture reopen and resave

The roundtrip test now imports the saved RTF into a second WordPad process,
opens it, verifies both U+FFFC object positions and saves it under a new name.
The original strict WMF-size/StretchDIB checks also apply to that second file.
The first draft reversed the VFS import arguments; that failed-import run
was discarded. With the correct import, the first real run lost both objects
and resaved a 135-byte text-only RTF (9/11 checks).

The trace showed `CreateStreamOnHGlobal(NULL,FALSE)` and
`GetHGlobalFromStream`, followed by `SetMetaFileBitsEx(0,0)` for each picture.
Two stream contracts were wrong: newly created/grown buffers were private
heap allocations, and creation/growth forced delete-on-release ownership.
[Microsoft's CreateStreamOnHGlobal contract](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-createstreamonhglobal)
explicitly leaves the final handle to the caller when FALSE, including NULL
input, and allows GetHGlobalFromStream to expose it for GlobalLock access.

Streams now carry an explicit +60 HGLOBAL-backing flag (64-byte allocation).
New and grown HGLOBAL buffers receive Global provenance. Growth retires the
old allocation while retaining the requested final-delete policy; final
release uses the appropriate Global/private free path. Shared resize checks
kind=3 before reading the new field, so shorter ILockBytes records are not
read past their layout. Tests cover TRUE/FALSE, growth, old-handle invalidation
and a clone keeping the backing alive until the final interface is released.

That restored both object positions (10/11), exposing a second boundary bug:
SetMetaFileBitsEx stored all 4,100 allocation bytes although METAHEADER
declared 2,438 bytes. It now validates the declared word count against the
supplied buffer and stores only that extent. No picture-size assertion was
weakened. A public regression supplies a valid 24-byte WMF in a 64-byte
allocation and rejects a declared size beyond the supplied buffer.

Final verification: fresh-process picture roundtrip **11/11**, guest COM
callbacks **149/149**, public metafile suite **12/12**, and CreateMetaFile A/W
coverage pass. Both saved RTFs are 10,261 bytes with two complete 32x24 WMFs.
The storage suite passes 79/79 on the shared worktree (its pre-existing,
uncommitted EOF-expectation edit remains unrelated and is not included here).
Browser rendering and reopened-picture pixel verification remain separate;
this result establishes parsing, object reconstruction and serialized data.

## Reopened pixels — confirmed missing rendering, still open

The roundtrip test now captures canonical pixels after the fresh-process
reopen, before Save As, and checks the red/blue fixture bitmap colors inside
the document client area (excluding caption/toolbars). This intentionally
strengthens the existing test beyond object positions and saved bytes.
The screenshot `test/output/wordpad-richedit/wordpad-ole-reopened.png` was
visually inspected: it contains the text `before` and blank picture space.
The first whole-image census counted only one red pixel and 666 blue UI
pixels, demonstrating why the assertion must crop to the document area.

Source inspection explains the missing branch: both IViewObject::Draw and
OleDraw only read the legacy CF_DIB render slot at root+64/+92. Reopened
pictures are retained as CF_METAFILEPICT, so their serialized bytes survive
but the draw helpers report failure instead of playing the cached metafile.
Native WMF playback already exists in `gdi_metafile_play_wmf`; OLE still
needs a bounds-aware presentation path, preserving caller DC state, clipping,
mapping and extent semantics. Extracting a particular StretchDIB record or
rasterizing via the fixed 640x480 recording DC would only mask this gap and
would not implement general cached-metafile drawing.

The new pixel assertion is a known failing regression, not a rendering fix
or a browser test. Keep the full data roundtrip assertions alongside it;
blank pictures must not be called complete based on successful serialization.
The final cropped run reports red=0, blue=0 and **11/12** checks passed:
only reopened-picture rendering fails. Production source was unchanged in
this verification slice. The image is CLI canonical output, not a browser
screenshot; browser validation remains outstanding.

## Cached anisotropic WMF drawing — fixed and pixel-verified

`OleDraw` and `IViewObject::Draw` now share a canonical-cache draw helper,
matching FORMATETC aspect/index rather than assuming the legacy DIB mirror
is the only presentation. CF_DIB remains supported; CF_METAFILEPICT with
MM_ANISOTROPIC is played through the existing native WMF interpreter.

The wrapper maps the requested logical bounds through the caller's DC,
saves its state, initializes the picture viewport, plays the records, and
restores state on both success and failure. The metafile supplies its own
logical window coordinates. This follows Microsoft's
[MS-WMF mapping-mode guidance](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-wmf/2678f2fe-df2e-489d-83db-713a9f6397de).
No temporary 640x480 raster surface or special-case StretchDIB extraction
is involved. Cache, bounds and picture pointers are translated once per use.

Verification:

- The unchanged fresh-process WordPad regression passes **12/12**, including
  red=760 and blue=752 document pixels after reopen. The canonical screenshot
  was inspected: both 32x24 checker pictures are visible beside `before`.
- Public metafile coverage passes **13/13**. The new vector fixture exercises
  both OLE drawing entry points, nonzero window origin, a caller with 2x
  scaling and viewport offset, caller clipping, target placement, aspect
  selection, stdcall stack cleanup, full DC restoration, and an invalid
  cached handle. Existing text/vector/region/EMF playback tests still pass.
  Compiling the same test with only the pre-fix OLE fragment substituted
  fails at the new public draw assertion (E_FAIL instead of S_OK).
- Static OLE handler **66/66** and guest COM callbacks **149/149** pass.
- The full build stops at 11 GdiObject variant-attribution errors in
  `gdi_object_delete_full` (the shared worktree's `tools/union-gate.js` is
  independently modified). This slice does not edit the GDI fragment or
  that gate; focused tests compile the source with the canonical compiler.

Scope still open: browser save/reopen verification; other METAFILEPICT
mapping modes; cached EMF drawing; guest continuation/cancellation callbacks;
general OleDraw delegation to arbitrary guest IViewObject implementations.
The new WMF path deliberately reports failure for unsupported mapping modes.

The vector test also exposed a **separate existing ownership gap**:
`ole_copy_medium` aliases TYMED_MFPICT and `ole_release_medium` does not
retire its metafile/outer memory. A trial final-release assertion observed
GetObjectType=9 after releasing the static object. The drawing test checks
that playback does not consume the cached handle, then explicitly cleans up
the fixture. Correct independent copies, pUnkForRelease ownership, and final
retirement must be implemented together; adding deletion alone would turn
the current aliasing into use-after-free. This is the next ownership task,
not a claim that metafile lifetime is fixed by rendering it.

## Metafile medium ownership — independent copies and retirement

The follow-up fixes the alias/retirement pair together. TYMED_MFPICT copies
now clone the GDI metafile and allocate an independent Global-memory wrapper;
TYMED_ENHMF copies clone the enhanced metafile. A single WMF-picture cloning
helper also serves OleDuplicateData, including rollback if the wrapper
allocation fails. Normal medium release retires both WMF resources (or the
EMF handle), while a non-null pUnkForRelease retains responsibility for the
payload. This matches Microsoft's
[ReleaseStgMedium ownership table](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-releasestgmedium).

The root-owned WMF synthesized from a DIB is now retired on final static
object release, after detaching the borrowed live face. Independent GetData
results and clipboard snapshots remain alive. The vector rendering test no
longer manually deletes a leaked handle: it requires final owner release
to delete it.

Regression coverage uses real public API thunks for cache SetData(FALSE),
IDataObject GetData and Release, and ReleaseStgMedium. Both WMF and EMF
outputs must differ from their originals, survive source/cache/snapshot
retirement, honor a DLL-private custom releaser, and retire cleanly when
owned. WMF wrappers must also pass GlobalLock and become invalid on release.
Substituting the pre-fix OLE fragment fails the independent-WMF assertion.
The fresh-process WordPad roundtrip remains **12/12**, with the same red=760,
blue=752 pixels; the public metafile suite is **13/13** and static OLE is
**66/66**. Guest callback coverage passes **161/161**, including synthesized
root-presentation retirement; clipboard wrapping passes **13/13**.
This does not close browser verification, mapping-mode support,
metadata allocation-failure atomicity or guest final-release reentrancy.

## Synthesized presentation freshness — fixed

A held IDataObject could still return obsolete picture content: cache refresh
reused root+168 after replacing the underlying DIB. A new public-thunk
regression failed before the fix by replacing a blue pixel with red and
reading back blue from the newly requested WMF.

Refresh now removes the old borrowed descriptors, retires the root-owned
derived picture, and builds a presentation from the current cache. Uncache
also removes the derived format and frees its handle. Previously returned
GetData copies keep their original bytes. Repeated QueryInterface remains a
lookup, not a refresh, so it does not trigger regeneration.

SetExtent now updates the synthesized wrapper's suggested HIMETRIC dimensions
without reallocating or changing its WMF record stream. Earlier GetData
copies retain their old dimensions. This keeps the derived presentation
consistent with the extent accepted by the existing static-object setter;
it does not claim full running-state or advisory-notification conformance
for [IOleObject::SetExtent](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nf-oleidl-ioleobject-setextent).

Coverage checks replacement pixels, independent earlier copies, new extents,
Uncache withdrawal, and repopulation followed by final owner release. The
guest callback suite passes **164/164** and static OLE passes **66/66**. The
fresh-process WordPad picture roundtrip remains **12/12** (red=760, blue=752).
Refresh metadata allocation-failure atomicity remains open: this change
corrects freshness but does not make the existing descriptor rebuild
transactional under out-of-memory conditions.

## Browser document roundtrip — verified

The browser test now forces `?compile-wat`, so it verifies the current source
instead of silently exercising a potentially stale prebuilt artifact. Its
existing startup, typing, date insertion and DIB-paste checks pass. It then
uses WordPad's actual Save As command and native filename dialog, verifies
the saved RTF contains a WMF picture, creates an empty new document (accepting
the default type in WordPad's New dialog), and reopens the saved RTF.

The document is 5,225 bytes; reopened text/object length is 35. The new
editor-only pixel check sees **384 red and 384 blue pixels**. The capture
`test/output/wordpad-web/picture-reopened.png` was visually inspected. This
is headless Chrome browser rendering, not a performance measurement or
Safari claim. It tests document teardown/reopen within one browser app;
the separate CLI regression supplies fresh-process reopen coverage.

Two initial harness attempts were corrected: posted IDOK did not complete
the native file dialog, whereas the synchronous confirmation already used
by the CLI does; File New presents a document-type dialog that must be
accepted before expecting an empty editor. Neither timeout proved a
picture-rendering failure.

Build-gate attribution correction: the previously reported 11 union-gate
errors are caused by **our earlier 62329da4** WMF validation adding five
lines above `gdi_object_delete_full`. Its bySite anchors are five lines
stale. Calling that blocker unrelated was too broad: it was unrelated to
the later drawing/ownership slices, but is a missed earlier gate update
that still needs repair. The dirty 10f attribution changes in the same
gate belong to other work and must remain separate.

## Missed WMF gate annotations — repaired

Rechecked all eleven `gdi_object_delete_full` accesses against their actual
type-guarded branches and advanced the 10e bySite anchors by five lines.
No variant exemptions or validation rules were removed. The union gate now
passes **188 sites** (28 shared-prefix, 160 variant accesses).

The full build retry passes the earlier gates but stops at a different
concurrent-worktree issue: the toy-VM browser bundles no longer match their
sources (reported deltas: 1,769,103 to 1,770,392 bytes and 1,740,448 to
1,741,737 bytes). Those generated assets remain with their owner; this is
not a full-build pass. The independent dirty 10f gate hunk is excluded from
this repair's commit, using an isolated Git index for the two owned changes.
`test/test-union-gate.js` passes all **38 checks**, including negative cases.
A second full-build attempt after the owner's regeneration notice still
finds ongoing source/bundle drift (now 1,770,392 to 1,771,444 bytes and
1,741,737 to 1,742,789 bytes). Neither attempt reached a successful full
build; both processes terminated with exit 1 at bundle freshness.

## Synthesized clipboard WMF scaling — fixed

The DIB-to-WMF producer recorded the original pixel viewport extent, which
overrode the container's requested drawing bounds. A new regression failed
before the fix: a 64×48 request painted only 768 pixels (32×24), not 3,072.
Removed that viewport record; retained the logical window and bitmap record.
This follows Microsoft's [MS-WMF clipboard initialization guidance](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-wmf/2678f2fe-df2e-489d-83db-713a9f6397de):
the metafile supplies window mapping and the player supplies viewport mapping.
Normal playback still honors viewport records supplied by applications. This
is a producer fix, not a rewrite of arbitrary existing WMFs or a native Win98
comparison.

Verification: public metafile **14/14**, guest COM callbacks **164/164**, and
fresh-process WordPad roundtrip **12/12** pass. The new pixel regression covers
64×48 enlargement, 16×12 reduction and 48×12 nonuniform scaling through OleDraw
and IViewObject::Draw. The CLI RTF is 10,221 bytes; reopened pictures contain
752 red and 736 blue pixels. Current-source browser Save As/New/Open also
passes: 5,205-byte RTF, text/object length 35, 376 red and 368 blue pixels.
The reopened browser capture was inspected. This is headless Chrome correctness
coverage, not Safari or performance evidence.

Other mapping modes, cached EMF drawing and transactional allocation-failure
handling during live data-face refresh remain open. No full-build success is
claimed by these focused tests.

## Initial IDataObject allocation failures — rollback before publication

The first query used to attach the child before constructing its descriptors,
drop descriptor/picture construction failures, and leave later queries returning
the incomplete child. Failing the initial child allocation also incorrectly
returned E_NOINTERFACE. Microsoft's [guidance on E_NOINTERFACE](https://devblogs.microsoft.com/oldnewthing/20061208-00/?p=28783)
distinguishes allocation failure from an unsupported interface; a resource
shortage must not change the object's supported interface set.

Initial construction now publishes root+164 only after every descriptor and
derived picture succeeds. Failure clears borrowed descriptors without releasing
canonical cache media, retires the derived picture and unpublished child, leaves
the output null, and reports E_OUTOFMEMORY. Descriptor insertion and picture
construction results are no longer dropped. Already-published faces retain
their identity; a failed refresh clears partial descriptors, but does not yet
roll back the canonical mutation or automatically retry the refresh.

The static-handler test injects a single failure at each of the **nine OLE heap
allocations** observed while building a DIB-backed face (test-only source
instrumentation, no production allocator hook). Before the fix it passed only
68/85 checks: failures left partial faces and retries lost formats. After the
fix all 85 pass, including null output, unchanged root reference count/cache
count, unpublished child/picture pointers and successful retries exposing both
DIB and WMF. This is not a sweep of allocations inside the GDI allocator or a
claim that all live-cache mutations are transactional.

Final verification: static-handler **85/85**, guest callback **164/164**, public
metafile **14/14**, and fresh-process WordPad picture roundtrip **12/12** pass
(275 checks). WordPad still reopens both pictures with 752 red and 736 blue
pixels. All four test processes terminated successfully; no full-build or new
browser verification is claimed for this allocation-failure slice.

## Cached enhanced metafiles — routed through the native player

`ole_static_draw` now recognizes CF_ENHMETAFILE/TYMED_ENHMF and sends its
opaque GDI handle to the existing native EMF player. WMF and EMF paths share
the caller-logical-to-device bounds conversion; the EMF path uses a private
16-byte target rectangle and the player's existing SaveDC/RestoreDC. It does
not translate a GDI handle as a guest pointer, rasterize to an intermediate
fixed-size image, or duplicate the EMF record interpreter.

Microsoft documents the caller rectangle as controlling positioning/stretching
for [IViewObject::Draw](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nf-oleidl-iviewobject-draw)
and specifies logical-coordinate bounds for
[PlayEnhMetaFile](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-playenhmetafile).
The internal native player expects the already-mapped target and retains the
device origin independently, so the shared OLE adapter performs that mapping.

The new public-handler regression failed with E_FAIL before the implementation.
It now passes through both OleDraw and IViewObject::Draw using a vector EMF
with nonzero source bounds, 2× caller scaling, viewport offset and clipping.
It checks interior/exterior pixels, all 96 caller DC-state bytes, unsupported
aspect and invalid DC rejection, handle survival across draws, and retirement
on final cache-owner release. The public metafile suite passes **15/15**.

This closes the missing cached-EMF dispatch, not every possible EMF record or
mapping issue in the existing player. In particular, its header-bounds versus
physical-frame treatment has not been established against native Windows here.
Remaining OLE gaps include other WMF mapping modes, draw continuation callbacks,
arbitrary guest IViewObject delegation, and transactional live-cache refresh.

Additional regression verification: static-handler **85/85** and guest COM
callbacks **164/164** pass, for **264 checks** across three terminal successful
test processes. No new browser or full-build result is claimed for this slice.

## Drawing failure contracts — distinct HRESULTs

The shared static drawing core now distinguishes missing presentation data
(`OLE_E_BLANK`) from unsupported/combined aspect values (`DV_E_DVASPECT`),
non-whole-object indices (`DV_E_LINDEX`), null required bounds (`E_INVALIDARG`),
zero-width/height bounds (`OLE_E_INVALIDRECT`), and native playback/DC failures
(`VIEW_E_DRAW`). A valid but uncached aspect reports blank, not an invalid aspect.
The DC validity check also precedes direct DIB drawing. Allocation failure for
the EMF target rectangle still reports E_OUTOFMEMORY.

These results follow the documented
[IViewObject::Draw contract](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nf-oleidl-iviewobject-draw)
and [OleDraw results](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-oledraw);
numeric HRESULTs were checked against Microsoft's
[SDK winerror.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/shared/winerror.h).
The test failed on the empty-cache case before the fix (E_FAIL instead of
OLE_E_BLANK). Public-handler coverage now exercises both drawing entry points,
their stdcall cleanup, invalid index values through IViewObject, and unchanged
DC state on argument rejection. Existing WMF/EMF pixel and ownership tests
remain in place, with their previously generic failure expectations corrected.

This is documented-contract coverage, not a native Win98 error-precedence
comparison. Windowless optimized DVASPECT2 views, cancellation callbacks and
arbitrary guest IViewObject delegation remain outside this static handler's
implemented surface. Inverted-coordinate rectangle semantics are not changed
by the zero-extent validation.

Verification: public metafile **16/16**, static-handler **85/85**, guest callback
**164/164** (265 checks); all processes terminal with exit 0. No new browser or
full-build pass is claimed. An unrelated dirty `lib/api-format.js` currently
labels 0x8004006A as DV_E_DVASPECT (the SDK says 0x8004006B); this diagnostic
label issue was noted on the coordination board and left outside this commit.
