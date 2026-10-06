# Fixture inventory reconciliation — 2026-10-03

Owner: restore_evidence. No guest runtime, source build, registry edit, deployment,
TODOS or STATUS changes. Inventory/coverage ownership released by coverage_audit.

Read the migration owner's receipt: 3,275/3,275 file hashes verified, zero missing
or different files in that upload, associated with 81 game entries. This receipt
does not certify that all registry dependencies for those entries are complete.

Fixed `ops/corpus-inventory.js` and its coverage consumer: manifest executable
names are retained as `executableHints`, but actual registered routes determine
`executablePaths` and dependency blockers. A missing alternate installer or
archive-layout hint cannot block a complete installed route. Unregistered hints
remain discovery alternatives and do not establish a complete launch route.
All registered DLL/files and local-media dependencies still need to be present.
Local-media expansion follows browser URL resolution, rejects malformed file
entries/external unverified media, and blocks missing/invalid manifests. Ready
lists now also exclude registry-path repair cases.

Validation: nine focused coverage tests passed, including a disposable fixture
with present EXE but absent data/audio dependencies, encoded media filename,
missing alternate EXEs, malformed media entry and absent manifest. All 23 ops
reader/API tests passed. Scene allowlists, image hashes, logical-counter proof
and physical-FPS unknown semantics are unchanged.

Snapshot and exact per-game deltas:
`scratch/fixture-inventory-reconcile-20261003/{before,after,deltas}.json`.
The corrected snapshot has 118 complete declared registered routes across
93 of 152 game/distribution task rows; 59 rows lack a complete registered route.
Compared with saved task evidence, 78 rows newly have a complete declared route
(15 → 93). Twenty candidate missing-path lists changed from the semantics fix.
This is asset readiness only, not gameplay acceptance or permission to bypass
Ricochet/Collapse/NFS3/REP review gates.

Atomically refreshed fixture fields in the 152 existing
`scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-*.json` evidence files.
Preserved existing reviewBlockers, screenshot/FPS assessments and other fields;
originals are saved alongside the delta report as `task-before-*.json`.
Root owns task-state/dependency reconciliation. The new `fixtureInventoryAt`
timestamp distinguishes this check from the original broader evidence report.

Cave Story, Fallout and Liquid War now have no false alternative-EXE blocker.
Arcanum, Heroes II and Jardinains still have actual registered dependencies
missing in this snapshot (exact paths in deltas). StarCraft's live registry
points to `test/binaries/candidates/starcraft-demo-official/`, while the migration
board names `starcraft-shareware/`; the inventory follows the live registry and
does not silently redirect it. Eleven registered StarCraft paths remain missing.

Limit: this checks declared paths/local-media manifests, not every dynamically
loaded library or implicit NE module. Complete declared assets must still pass
route/runtime qualification; the report does not infer assets from EXE presence.
Bulk transfers continue independently, so later snapshots can improve further.
