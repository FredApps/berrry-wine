# Selective build evidence recovery — 2026-10-03

Owner: restore_evidence. Released to migrated coordinator. No guest runtime,
benchmark, network request, source build, or result metadata edit performed.

Verified `/home/user/wine-assembly-migration-20261002/build.tar.gz` against
`scratch/migration-transfer.json`: 1,220,180,654 bytes, SHA-256
`33da55868b58a9e2e703bcb3a1a0020b23d1a36aa75811f9c96ef20132408a88`.
33 GiB was free before staging. No partial archive used or whole archive unpacked.

Staged 82 selected members (66,843,526 bytes) under
`scratch/migration-build-evidence-20261003/`. `members.txt` is the archive
inventory; `selected-members.txt` records selections; `mappings.json` records
existing provenance bindings; `receipt.json` records restoration dispositions.
`recover.js` is the JavaScript recovery operation. Source paths were selected
from exact existing run provenance or reviewed historical mappings, never from
guessed game names. Existing files were preserved; restored bytes were copied
with exclusive-create semantics after their full pinned SHA-256 matched.

Restored one previously missing artifact:
`scratch/runs/import-20260930T074616739Z-need-for-speed-3-demo/output.log`, from
`build/lazy-games/coverage-nfs3-on1/console.log`, SHA-256
`0471bc63170a858b2612e80ef1043866f9523f933d5e7f1367216213674d57f4`.
149 already present mapped files were preserved and independently rehashed:
all match their provenance. No screenshots needed restoration within this set.
Six pinned log/helper mappings have sources outside the build archive; exact
source and destination paths are in receipt entries marked
`archive-member-unavailable`.

The wider artifact audit is
`scratch/migration-build-evidence-20261003/final-artifact-audit.json`: 175 run
records and 272 image references, zero missing images, and 81 missing non-image
artifacts across 10 candidates. It records every missing artifact's exact
path and candidate, including unpinned paths that cannot safely be reconstructed
from unrelated files. Historical images are not fresh gameplay/FPS acceptance.

The staged module at
`scratch/migration-build-evidence-20261003/build/wine-assembly.wasm` hashes to
`c474288de1a738d5fa4835d2057c73b563a5d20909251e7e50982f19677e287c`.
Its source identity is unverified. Staged `combined.wat` hashes to
`b41b80e911d0d496a4c5ccee63e453952988e595dd54c2902348d6dc7f5e7879`, whereas
the current source concatenation hashes to
`4d835ee2b8a0c3512e8d8e6e79f79c0246e65512899055b14610edc85d705a90`.
They differ. Root independently built a current module; do not use the archived
module as current-source validation. Canonical module was not restored.

Remaining work: when the owner verifies scratch history, selectively recover
the exact missing artifact paths from that archive without overwriting present
files. Preserve existing scene/counter review blockers. This recovery adds no
new FPS measurement and does not establish that every game reaches gameplay.
