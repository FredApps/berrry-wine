# Easy screenshot batch — 2026-10-05

Seven historical screenshot gaps were resolved by personally viewing the exact existing images and pinning their hashes and run metadata. No browser, build or benchmark was needed. Tile World source work remains paused at its frozen repair handoff.

Accepted historical scenes: Collapse! Crunch (puzzle board, score15); Unreal Special Edition (weapon/world/HUD); Alien Shooter (character/outdoor world/HUD); NFS II full (cockpit/race HUD); NFS III demo (cockpit/race HUD); Baldur's Gate Chapters I–II (selected character/world/tutorial); Baldur's Gate interactive (same kind of world scene, but visibly corrupted lower region/portrait). The last remains a correctness concern. Alien Shooter's unusual ammo/experimental source settings are retained. Root independently inspected Unreal and Alien Shooter and accepted scene-only classification.

`ops/screenshot-reviews-20261005.json` contains the original 13 pinned scene reviews plus these seven, with exact image/run paths and hashes. It does not rewrite historical results, establish current compatibility, ordinary input response or FPS. Recompute with:

```
node ops/gameplay-coverage.js --scene-reviews=ops/screenshot-reviews-20261005.json --output=scratch/screenshot-batch-easy-20261005/recomputed.json
```

Result: 152 game/package entries, 110 scene-covered (previously103), 42 without reviewed scenes, six qualified logical-frame measurements. Thus146 still need performance qualification:104 already scene-covered and42 with other screenshot/route/fixture work. Physical FPS remains unknown.

## Backlog consolidation proposal

`ops/screenshot-batch-consolidation-20261005.json` preserves exact original task blocks, IDs, Done criteria and evidence for44 conservatively selected scene/input-covered, locally complete entries. They may be represented under one visible performance aggregate; preserve their unchecked obligations in the archived checklist. This is not44 completed tasks and does not imply all counters are easy: event-driven titles may need a documented semantic limitation instead of an FPS number. The other102 performance-incomplete entries are not proposed for this transfer; active repairs, user bugs, partial-input routes, missing assets, package coverage and historical-only acceptance remain distinct. Root owns the actual task ledger edits.

## Reusable script and validation

`tools/screenshot-easy-batch.js review PLAN OUTPUT` verifies personally supplied review metadata against image and source-run hashes. Used for this batch. `capture PLAN OUTPUT --slot-granted` serializes an existing hash-pinned harness with explicit ordinary-input commands, existing route evidence, app/task/run IDs, required assets, per-title deadline<=90s and total<=10min, screenshot hashes and cleanup receipts. It refuses automatic gameplay/FPS acceptance and stops the batch when cleanup is unproven. Capture mode is prepared, not browser-qualified in this task; only use a reviewed harness that closes its own browser/server and supplies matching cleanup evidence. Unknown routes do not belong in this batch.

`node tools/screenshot-easy-batch.test.js` passes real subprocess checks for accepted review hashes, changed-image rejection, and two serialized pinned mock harnesses with cleanup. The mock creates no browser or real screenshots. No fresh capture was warranted for the seven existing images.

Private detail: `scratch/screenshot-batch-easy-20261005/{coverage,after,reviews,reconciliation,safe-consolidation}.json`. Main integration belongs to ops-dashboard; this scoped commit does not deploy or restart services.
