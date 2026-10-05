# Typed window presentation evidence in the dashboard

The isolated ops patch adds `selected-window-presentations`, requiring a matching counter kind, accepted scene/counter/evidence review, physicalFps explicitly null, and positive finite visible-client rectangle/fraction. Existing sample arithmetic is reused. UI label is **window presentations/s (coalesced GDI)**, with clipped client/fraction and physical-display-not-measured detail. Different clipping prevents before/after comparison. Existing logical and Flip metrics retain their prior semantics.

A new independent run `scratch/runs/20261005-dredmor-window-presentations` contains the accepted67/5.00351s sample, raw source pins and ordinary input log. Prior11.8/s run is untouched. No new renderer telemetry, release decision or SDL/physicalFPS claim. Metadata copy: `ops/release-evidence/dredmor-window-metric-publication-20261005/result.json`.

Validation: four actual reader/UI normalization tests passed, including invalid review/physicalFPS/geometry/fraction negatives and older metric compatibility. All10 release-model tests passed, including differing clipping comparison rejection. A private updated reader against the actual local corpus finds the new typed13.3906/s result and repaired TetriNET four reviewed gameplay images. No browser/service restart was run.

TetriNET timestamp repair uses the first preserved successful seat1 owner-IP startup receipt at2026-10-03T17:57:46.523Z, explicitly labelled in startedAtBasis; it is not an invented process launch time or duration measurement. Original result and artifact-hashes are retained in `ops/release-evidence/tetrinet-metadata-repair-20261005`. All four scene-review image hashes still match. Only result metadata and its artifact-manifest entry changed.

Implementation was prepared against main2f9bbd43 in scratch, preserving the dirty shared ops files. Coordinator integration/restart owns the live dashboard change.
