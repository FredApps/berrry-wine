# Ricochet lifecycle and scene-continuity assessment

Owner `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`, 2026-10-02. Read-only follow-up during the separately authorized qualification. No request to stop that run, no code/runtime change, and no measurement enablement.

**Current observations cannot prove primary lifecycle or continuous Round 1-1 validity.** The frozen runtime has useful surface allocation/free notifications for a later observer-only diagnostic. Existing Ricochet evidence can establish gameplay at reviewed checkpoints, but supplies no trusted continuous scene signal or game-state address.

## Current driver evidence and its limits

Reviewed `scratch/ops-game-fps-baseline-20261002/fixture/tools/{bench-ricochet-guest-presents,ricochet-fps-analysis}.js`, frozen audio/NFS3 source, prior frame-semantics handoff, and `docs/re-notes/ricochet-xtreme.md` only. Exact reviewed identities are in `scratch/ops-game-fps-lifecycle-20261002/input-hashes.json`.

The overlay observes raw kinds 5/6 and records surface slot, remaining arguments, sequence and timestamp. Its `contextGeneration` is a **Worker instance identity**, not a DX object generation. It does not observe surface allocation/free. Arm/stop snapshots additionally call `test_dx_primary_entry`; matching endpoint addresses cannot rule out release/reallocation or an intervening primary change. A Flip swaps DIB pointers normally, so changing DIB address is not itself a lifecycle failure; an unchanged DIB address is not generation proof either. Multiple primary candidates can survive a mode change.

**Correction to my earlier review:** `test_dx_primary_entry` is not strictly nonmutating. The export calls `$dx_primary_entry` (`src/13-exports.wat:1158`), whose frozen implementation clears the instance-local cached `$dx_primary_wa` when its saved entry fails validation (`src/09a8-handlers-directx.wat:6197`). Valid-primary calls normally return without writes. The current diagnostic's accessor caveat should be recorded; it does not justify interrupting the granted run. Future strictly nonmutating observers should read the documented DX memory structures directly, not call this accessor. This corrects, rather than silently edits, the prior handoff's “read-only accessor” claim.

## Existing lifecycle evidence

Frozen `src/09a8-handlers-directx.wat`:

- `$dx_alloc` (581–596) serializes allocation, releases LOCK_DX, then emits kind 21 for a DDSurface: `(21,slot,2,0,0)`. This occurs before CreateSurface fills dimensions, DIB, owner and primary flags; never treat the allocation callback alone as a fully initialized primary snapshot.
- `$dx_free` (1194–1210) clears object type/owner and emits kind 22 for a released DDSurface. `guest-rpc.js` forwards both, but a collector at the originating import can avoid asynchronous delivery ambiguity.
- `$dx_alloc_locked` (598–658) first chooses unused entries, then explicitly recycles logically freed slots when needed. Comments near `$dx_free` saying slots are permanently retired do not describe the fallback allocator. Slot number and wrapper address are not generation tokens.
- `DxObject` is 32 bytes; fields include type/refcount, width/height/bpp/pitch, misc0 attachment, misc1 DIB, and flags. DX_OBJECTS base must come from this module's generated region map, not a copied numeric address. Primary is internal flags bit 1, surface type 2; DDSCAPS primary input uses a different bit. Surface owner metadata relates the surface to its DirectDraw object, not a monotonically increasing generation. Pixel-write versions track writes and are not allocation generations.
- `$dx_primary_entry` (6185–6211) prefers valid cached newest primary, otherwise scans valid type-2 entries with primary flag and nonzero DIB. The private cached pointer is not exported as a pure getter. If multiple valid primary objects exist, a memory scan cannot prove which cached primary wins. Observing matching emitted front/present slots establishes the active event stream, not necessarily uniqueness of all display-capable objects.

A later bounded observer can assign **observer generations** from a complete kind-21/22 history from launch, with no WAT changes. That generation is synthetic evidence, not a guest field. Record every guest context and worker lifetime with sequence/overflow status; never derive a globally ordered lifecycle by sorting unrelated worker clocks. Allocation notifications occur outside the allocator lock and can race with other threads. Reject ambiguous cross-context transitions instead of inventing their order.

The smallest conservative stable-window gate would require complete capture, a valid selected type-2 primary at observed event checkpoints, compatible dimensions/owner/attachment, no selected-slot free/allocation during the window, no competing primary transition, stable context, and matching selected kind-6/kind-5 front stream. Read entry fields before/after an observation and reject inconsistent snapshots; memory reads do not lock out concurrent writers and double reads alone cannot exclude ABA. A stricter no-lifecycle-activity guard across the short diagnostic avoids needing to resolve transition order. Direct memory snapshots are nonmutating but remain observations, not atomic whole-process proofs. If selected identity or ownership can change without covered notifications, the gate remains unproven.

The current 5/6-only capture cannot be retroactively upgraded to a complete lifecycle history. It should retain `lifecycleQualified:false` regardless of apparently stable endpoint primary values.

## What can establish Ricochet gameplay

Existing notes document the menu sequence, Round 1-1 entrance animation, complete bricks/running timer, launched ball, score/brick changes, shield movement and eventual out-of-bounds penalty. Later browser acceptance explicitly supports ordinary mouse input; older relative-mouse diagnostics are not a requirement to change registry/input mode. None of the notes specifies validated game-memory addresses for round, lives, pause, score or timer.

The current scene helper counts blue/yellow pixels in fixed rectangles. `roundCandidate` requires HUD-blue and brick-color thresholds plus few option-yellow pixels; it does **not** decode Round 1-1, timer, score, lives, ball flight or pause. It can plausibly accept entrance animation, an inactive ball, another round with similar art, or a partially covered game screen. Whole-image hash changes between left/right screenshots can come from timer, animation or debris, not necessarily shield displacement. These are useful candidate detectors, not qualification proofs.

Nonmutating checkpoint evidence sufficient for **sampled gameplay progression** would be native 640×480 images with independently reviewed round label, stable lives/round, advancing timer, active ball, changed bricks/score and shield location matching the delivered left/right input. Include full screenshots and HUD/board crops with input/capture times; do not infer a score increase means no life loss, or a moving timer means no pause/menu interval. A sequence of such checkpoints only proves states at those observations. Endpoint screenshots cannot prove the complete unobserved interval stayed in Round 1-1, even when Flip cadence continues.

## Smallest feasible next diagnostic (proposal, not a grant)

First inspect the already authorized qualification artifacts. If it fails before gameplay or provides only kind 5, report that concrete failure; do not expand into measurement or automatically rerun.

If root requests a follow-up, use one short **non-performance** diagnostic to collect complete raw kind21/22 alongside existing5/6 from launch, derive candidate lifecycle state from actual module layout, and collect a bounded sequence of native gameplay/HUD images around the existing input schedule. Keep original imports unchanged, fixed buffer caps, all worker identities and explicit gaps. This can answer whether Ricochet has a stable primary lifecycle and whether visual round/life/timer regions are sufficiently legible for a later validated detector. It cannot by itself claim continuous gameplay through missing image intervals.

No current evidence supplies the continuous scene guard needed by the proposed unobserved 20-second measurement windows. Options require an explicit reviewed change in scope: validate a nonmutating game-specific state detector from real evidence, or accept and label a weaker sampled-scene/event-throughput diagnostic. Do not invent memory addresses, promote color thresholds to semantic truth, or enable the measurement phase automatically.

No shared source/helper/result was changed. This report does not block the existing single qualification and holds no resources.
