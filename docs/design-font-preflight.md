# Demand-driven native font preparation

Status: design and prerequisites, not an enabled dynamic-font protocol. Stock
font startup is installed on the executing owner; dynamic reads still use the
legacy synchronous paths. Lazy installed-tree defaults remain off.

## Required boundary

```text
+---------------------------+------------------------------+-------------------------------+
| PLAN (no guest mutation)  | PREPARE (guest remains parked)| COMMIT + EXECUTE ONCE         |
+---------------------------+------------------------------+-------------------------------+
| identify operation inputs | prepare bounded source lease | validate source + operation   |
| resolve catalog snapshot  | parse candidate privately    | publish immutable generation  |
| retain selected generation| retain old usable generation | enter original native action  |
+---------------------------+------------------------------+-------------------------------+
| NO DRAWING / STACK POPS   | stale/cancel/fault => discard | no replay of entered drawing  |
+---------------------------+------------------------------+-------------------------------+
```

The existing `tt_subst_path` is not a planner: it calls `tt_scan_font_dir`,
which allocates scratch, opens/registers files, and marks the directory scanned
before completing its reads. That flag is not asynchronous readiness. The
read-only `tt_subst_resolve` separates lookup against the currently published
registration/substitution tables. Its answer is provisional until the caller
has prepared a catalog snapshot: an undiscovered installed family may override
even a familiar bundled substitute. Neither a returned path nor a cache hit
proves source freshness.

## Operations that must be covered

| Entry or consumer | Why a late retry is unsafe | Required preparation |
| --- | --- | --- |
| `GetFontData` | Currently adjusts ESP/EAX before face lookup | Resolve the selected font and retain its generation before stack cleanup or output writes |
| Text, metrics, kerning and glyph outlines | `gdi_bitmap_font_selected` can open a face and synthesize a mapped-size strike | Prepare the resolved face/style/size before any enclosing layout, drawing or output mutation |
| Enumeration | Discovery registers files; callbacks can execute more guest operations | Stable catalog snapshot and resumable candidate preparation before callback delivery |
| Controls and native Help | Native code creates/selects fonts outside CreateFont API calls | Prepare dependencies before the enclosing native operation; do not replay control or Help state changes |
| Metafile playback | Earlier records may already draw before a later font dependency appears | Explicit record/operation continuation, preserving prior records without replay |
| Direct host exports and `send_message` | Bypass ordinary API dispatch; rich-edit bookkeeping can precede dispatch | The same ownership boundary must cover exports, not just guest API thunks |

CreateFont-only or scheduler-turn-only preparation is insufficient. A new
selection/style/size can first appear later in the same slice, inside a callback
or native composite operation. Do not return fallback metrics after scheduling
an asynchronous read and describe that as successful preparation.

## Catalog and immutable generations

### Native staging contract

The native catalog transaction is separate from explicit `AddFontResource`
registration and is owned by one executing instance. Its bounded metadata
table contains at most 32 records of 208 bytes each; it does not own parsed
faces, glyphs, or complete font files. Current and pending tables can coexist
so an incomplete refresh does not replace the old catalog.

- `font_catalog_begin()` returns a nonzero transaction nonce, or zero on
  failure/busy. Nonces are not allocation addresses and must not be reused.
  Initial preparation must precede legacy directory scanning: begin rejects
  a legacy-scanned instance, and commit also rejects a scan that intervened
  during staging. Legacy-discovered registrations cannot safely be mistaken
  for explicit registrations or migrated without separate ownership records.
- `font_catalog_add(token, path, bytes, size)` copies family/style/path
  metadata into the unpublished table. Input spans and the 4 MiB file limit
  are checked first. An invalid add for the active token poisons that
  transaction; a foreign/stale token must not affect it.
  Paths must be nonempty, NUL-terminated within 132 bytes, and unique in the
  staged table. Metadata acceptance checks the existing TrueType signature
  and bounded family/style tables, not full glyph validity. Heap extent
  validation follows the allocator convention; it is not a live-allocation
  capability check against forged or freed headers.
- `font_catalog_commit(token)` publishes only a healthy transaction, advances
  the catalog generation and then frees the old metadata table. Empty is a
  valid completed catalog, distinct from never prepared.
- `font_catalog_abort(token)` releases a matching pending transaction and
  preserves the current catalog; stale aborts are harmless.
- `font_catalog_ready()` and `font_catalog_generation()` describe catalog
  publication only. They do not certify current VFS sources or give parsed
  faces/glyphs/strikes a generation identity.

Explicit registration wins over discovered metadata; catalog entries win over
substitutes. Enumeration merges these sources without duplicate family names.
Returned path/name pointers are borrowed from their table: copy them before an
await or later catalog commit. Native calls alone cannot certify VFS freshness;
the host must validate the entire candidate snapshot before committing.

Automatic catalog preparation must not release earlier read leases and merely
re-enumerate names/sizes/timestamps at the end: that misses same-size entry
replacement, nested-provider revisions and eager in-place mutation. Until a
durable metadata-token API exists, keeping all source leases through commit
requires an explicit aggregate retained-byte budget. Sequential reads alone
do not bound retained memory.

`lib/font-catalog.js` now implements that bounded retained-lease alternative.
It snapshots direct-child TTF membership with public VFS enumeration, closes
every enumeration handle, and retains all prepared leases until release.
Its default aggregate payload budget is 16 MiB, configurable up to 128 MiB;
candidate count is capped at 32 and each file at 4 MiB. The remaining budget
is passed into each lease request before its allocation/read. Validation
checks current membership and every retained source lease, including earlier
files while a later read is pending. This establishes a consistent snapshot
at publication, not exact entry identity at the start of discovery.

Local installation stages one copied file at a time, revalidates the complete
batch immediately before native commit with no intervening await, and aborts
failed native transactions. The temporary owned payload bound is the lease
budget plus one read copy (at most 4 MiB) and one native staging file (at most
4 MiB), plus bounded path/catalog metadata and allocator overhead. Existing
VFS bytes, provider buffers/caches and already parsed fonts are outside this
bound; this is not an aggregate process-memory acceptance result.

Automatic startup is still pending. The caller must supply an exclusion
snapshot matching both actual native substitution tables; `fontMounts()`
alone is not a sufficient authority for that list. Worker installation must
hold source ownership through its reply, validate again before admitting
execution, and discard an unstarted process on stale publication. The local
installer must not be passed a shadow instance or asynchronous Worker proxy.

Separate directory discovery from face registration/loading. Catalog work may
read bounded metadata incrementally, but must not fill the 32-face parsed cache
merely to discover names. Publish catalog changes only after source validation;
an incomplete scan must remain distinguishable from a completed empty catalog.

Each prepared source needs an opaque process-local generation identity tied to
the complete VFS entry/provider dependency graph, not merely a path hash.
Installed/explicit registration ownership and already-selected font ownership
must be separate from the current implicit lookup result. Replacing or deleting
a source must not destroy bytes still owned by a selected or registered font.
Failed replacement publication must preserve the prior usable generation.

Generation identity must reach every derived cache: instance-local TTF faces,
glyphs, and the shared synthetic-strike registry. Synthetic strikes currently
key only family/style/size, so clearing a face cache alone can still return old
pixels. Slot reuse must never make an old selected handle refer to a new face.
Registration refcounts are a separate compatibility issue; do not silently
change repeated Add/Remove behavior as part of cache invalidation.

## Ownership and acceptance

Use the existing immutable VFS read-lease checks, but define an aggregate
process budget covering concurrent preparation, parsed faces, pinned old
generations and derived bitmaps before enabling lazy installed-tree defaults.
The per-file 4 MiB TTF limit and 32-face cache are not a total-memory budget.
Only the executing instance publishes native state. Worker replies require
source and operation-generation validation; stop must join pending ownership.

Required regressions include pending/faulted reads before any side effects;
replacement during preparation; selected A versus newly resolved B; explicit
registration surviving source deletion; same family resolving a different
path; strike eviction with an old selection; and two shared-memory instances
warming/replacing generations in different orders. Direct exports, composite
operations and enumeration callbacks need their own coverage. Full completion
also requires installed-tree memory and low-load input/audio acceptance.
