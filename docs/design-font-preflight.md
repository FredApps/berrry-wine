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
