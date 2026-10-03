# Historical visuals and dashboard review

Owner: ops-dashboard. Date: 2026-10-01 (America/Los_Angeles).

Follow-up: `ops/corpus-status.json` and `ops/corpus-status.md` now assess all 76
candidates with source groups, package notes and next steps. This is an evidence
review, not 76 fresh runtime tests. Eight candidates are already in DESKTOP_APPS;
eight incomplete original-fixture entries have a registered executable elsewhere.
WEP and community-remake collections remain outside the candidate manifest.

Integrated the completed quarantine audit: original dispositions 8 confident,
5 wrong, 134 unresolved. Subsequent root proof of the exact NFS2 command moves
one unresolved association to supported (9/5/133); the original audit is intact.
All six exact-note Ricochet browser captures are now published, plus a correctly
associated copy of NFS3's `window-1-end.png` previously mislabelled GTA2. No
quarantine original was changed. Recovery manifest now contains 18 images, still
covering the same 11 newly covered candidates: overall coverage remains **30/76**.
The NFS2 published metadata now cites the root's literal command/path evidence;
Heroes2 keeps its qualified attribution. GTA reported-build validation and Alien
direct citation from the acceptance worker were preserved.

Dashboard displays historical guest-present FPS: NFS3 33.9 (two 15s samples),
GTA2 29.9 (one 10s sample), both Legacy WebGL using SwiftShader on Ryzen 9950X.
Raw source reports are copied into their run bundles with SHA-256. These are not
hardware-GPU or fresh performance claims. CLI CPU-window timings for Jazz,
Collapse and Unreal were deliberately not converted into FPS. Fresh browser
measurements are queued in `OPS-GAME-FPS-BASELINE`; NFS3 already has its own
resource-gated three-renderer task. The new run.performance schema is documented
in ops/README.md and tested for invalid samples, zero FPS and duration weighting.

Follow-up verification: all nine Overview/Tasks/Agents layout variants passed
full-scroll browser checks in `scratch/ops-scroll-review/hierarchy/`; corpus
status/groups/FPS layouts passed all three sizes in `corpus-final/`. No browser
errors, broken images or horizontal overflow. Reader/API tests now pass 19/19.

Recovered 11 candidate captures, increasing linked historical screenshot coverage from **19/76 to 30/76**. Each image was visually inspected and matched against an exact source test, log or stored capture command. `ops/historical-visuals.json` records the original path, SHA-256, source mtime, scene and association evidence. `node ops/recover-visuals.js` copies unchanged bytes into deterministic `scratch/runs/recovered-*` bundles with provenance; repeating it skips existing results.

Recovered: all three Baldur's Gate demos, Snood, Pocket Tanks installer, GTA2 demo, Alien Shooter, Ricochet Xtreme, NFS II demo, Diablo II demo installer and Heroes II demo. NFS II's file named “race” actually shows its title screen; Pocket Tanks shows a malformed installer. No recovered image establishes a current-build compatibility or performance pass. Results remain unknown/unreviewed; dates are source file modification times.

**46 candidates still have no confidently linked capture.** This does not establish that no image exists. `scratch/ops-backfill/coverage.json` lists them for a further bounded audit. Existing quarantine is preserved; the full quarantine inventory has not been revalidated. The Caesar/GeneRally misassociation was not restored. No Claude session was resumed or newly scanned.

The corpus now retains an explicitly labelled earlier capture when its newest run has no screenshot, without replacing the newest outcome. Coverage filters use any linked historical capture. Current work remains first, followed by failures and recorded results, with unrecorded candidates last. Blank placeholders are smaller and portrait screenshots use one column.

Real-data Puppeteer review covered Overview, Tasks, Blockers, Agents, Corpus and Activity at 1440×1000, 390×844 and 844×390, scrolling each page to its bottom. Activity was expanded through all 150 entries. New-task, task-detail and candidate-detail dialogs were also opened. Requests other than GET/HEAD were blocked; no real task, terminal input or approval was submitted. A real API snapshot was frozen during each review to keep polling from moving content.

Review fixes: full task criteria stay in Details, task TLDR is collapsible, mobile status labels precede task text, all six navigation links remain visible, short landscape uses a compact header, Activity initially shows 25 entries, coordinator messaging reflects current assignments, and an old blocked assignment no longer masks an agent's active task. Compact phone task headers remove repeated explanatory chrome.

Evidence: `scratch/ops-scroll-review/before/` and `scratch/ops-scroll-review/after/` contain full-page and top/middle/bottom screenshots plus reports. All 18 final view/size combinations have no page-wide horizontal overflow, broken images or JavaScript errors. The read-only review driver is `scratch/ops-scroll-review.js`.

Validation: `node --test ops/ops.test.js` passes 17/17 (local HTTP binding requires running outside the sandbox); `node ops/browser-test.js` passes, including latest-run-without-image fallback, corpus ranking, task creation/edit conflicts/discussion/reorder/defer and mobile layout. Import rerun is idempotent. Syntax and whitespace checks pass.

Coordinator follow-up: reconcile OPS-HISTORICAL-VISUALS as a bounded recovery, retaining the 46-candidate audit as unfinished follow-up. Do not describe the entire historical archive as recovered. Dashboard browser resource release is announced separately on the messageboard after the final browser closes. No shared source, emulator build, live approval or task ledger edits were made by this review.
