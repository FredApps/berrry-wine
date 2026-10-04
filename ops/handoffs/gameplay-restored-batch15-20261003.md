# Restored gameplay batch 15 — 2026-10-03

Published three bounded current-browser attempts: one new Heroes II gameplay scene, zero verified gameplay responses. Performance is null throughout. All final artifact hashes pass. No source/build/task edits.

Actual served module: `f76ee66ec69cddbe0ddb3f7fff1c0438181821dd55e0c0ef9f56e0169a38b4df` (1657877 bytes). Each run preserves dependency hashes, full served response hashes, raw inputs, exact failed request URLs, cleanup and scene review. No partial responses occurred; partial and representation hashing remain distinct.

## Outcomes

- **diablo_demo**: Actual August1996 demo has New Game, class and name menus, contrary to old no-menu route note. Ordinary Warrior selection, rapid typed Player and Enter produced only final R visible and a dark title/name transition; no active world reached before180sec guard. Zero-delay synthetic typing may lose characters to guest polling, not an established text defect. Deadline includes operator review gaps and is not a compatibility failure. No gameplay input or FPS claim. Run: `scratch/runs/20261003-diablo_demo-gameplay-restored15`. Cleanup: 2026-10-03T14:58:45.781Z, browser/server closed.
- **heroes2_demo**: New Game, Standard Game and Broken Alliance scenario OKAY reach personally reviewed complete adventure map, hero, castle, minimap and full faction-specific gray stone HUD. Prepared wooden-HUD descriptor was over-specific; no readiness assertion was recorded.150sec guard expired before attempted movement command, which is absent from inputs.jsonl. Scene-only; no hero movement, camera pan, combat or FPS claim. Deadline is orchestration/route limitation, not app crash. Run: `scratch/runs/20261003-heroes2_demo-gameplay-restored15`. Cleanup: 2026-10-03T15:01:33.935Z, browser/server closed.
- **jazz2_demo**: Stock JazzII logo/introduction movie personally reviewed. One ordinary Escape400ms held; subsequent screenshot still intro animation with rabbit, no level/player HUD. A later command was submitted after240sec guard and never executed, so inputs.jsonl contains only initial wait and one Escape. Session budget includes operator review/context gaps; no measured slow-start or compatibility failure established. No attraction/gameplay/input-response/FPS qualification. Run: `scratch/runs/20261003-jazz2_demo-gameplay-restored15`. Cleanup: 2026-10-03T15:06:26.994Z, browser/server closed.

## Limits and next route correction

No active-title missing dependency was established. Missing request paths are preserved per run in missing-path-review.json; they concern desktop icon/app discovery and infrastructure probes. There were no matching RuntimeError, unreachable, pageerror or TypeError entries in these saved browser logs. A bounded deadline by itself does not prove a game fault or measured loading duration.

Diablo future helper should use an explicit recorded bounded typing delay, e.g.100ms, and follow the actually observed New Game/class/name screens. Heroes future route should use faction-neutral complete-HUD wording and send ordinary input immediately after the ready screenshot; the attempted late command here never executed. Jazz needs movie-boundary Escape and subsequent reviewed main-menu selections; only one Escape actually ran before guard, with review/context gaps consuming budget. Prior evidence remains immutable.

## Validation and release

`scratch/gameplay-restored-batch15-20261003/publication.json` and `scratch/gameplay-restored-batch15-20261003/validation.json` pin all three result/provenance files. Final Jazz51217 exited2 at the240sec guard, browser/server closed15:06:26.994Z; subsequent process check found no batch15 harness or Puppeteer profile. Diablo45629 and Heroes93535 likewise deadline exit2 with clean receipts. Runtime explicitly returned to root.
