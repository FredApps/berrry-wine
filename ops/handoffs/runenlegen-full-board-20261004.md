# Runenlegen narrow full-board and player-input acceptance

Root accepted private candidate14aadaac5e6b64bbad3a0c846774ec48cae9eeb204bf7f3d7e241dc472a1c124 (1665493bytes): full12×8 Beginner board, ordinary first-cell click and stable71runes/0points/95moves. Before72/0/96; goldM placed, previewpinkM. NoFPS or completed-game claim. Canonicalf40 unchanged. Browser25427 closed18:10:04.170Z errors[],processclear.

Evidence: scratch/runs/20261004-runenlegen-frame-candidate (33hashes,86servedchecksPASS); scratch/new-games-pipeline-20261004/runenlegen-preparation/frame-qualification/publication.json. Previous clipped runs remain immutable.

Integration: scratch/new-games-pipeline-20261004/runenlegen-preparation/runenlegen-scoped.patch plus integration-pins.json. Patch is against captured DIRTY source before-images, not cleanHEAD; preserve unrelated COM/DirectPlay/LF2/other inherited changes. Eight WAT files plus two new tests; do not cherry-pick whole dirty files. Ops-dashboard exclusively owns main integration; public deployment is separate.

Changes: real default WM_WINDOWPOSCHANGING minmax query in A/W, bounded synchronous callback completion and per-call memory; no app-specific size. Generic AdjustWindowRectEx/nonEx caption-frame inverse matches existing fixed/sizing helper and current menu reservation, without changing painter/NCCALCSIZE metrics. No renderer patch.

Validation: private minmax positive/negative actual x86 callback, nesting/sparse/ABI/timeout and threeexisting windowpos suites; scratch/new-games-pipeline-20261004/runenlegen-preparation/minmax-implementation/validation-run/publication.json. Generic control inverse fails with fixed-caption2×1 excess; actual SetMenu variants prove menuextra1. Candidate30casesPASS and control-create-geometry,child-cbt-native-scrollbar,windowpos-changing,minmaxPASS, scratch/new-games-pipeline-20261004/runenlegen-preparation/child-layout/frame-fix/publication.json. Initial dynamic-menu-at-creation harness presence failure retained; corrected actual SetMenu+MoveWindow route validates attached menu before assertions.

Durable tests test/test-windowpos-minmax.js and test/test-adjust-client-roundtrip.js. Last promotion changes only paths/guard/comments from passing private regression; syntaxPASS, not rerun or fullbuild since promotion. Automatic test-tier membership should be checked by coordinator during integration. Remaining validation: fullbuild gates and integration regression on final main tree; private qualification is not public deployment.
