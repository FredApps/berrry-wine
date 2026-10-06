# Gameplay coverage inventory — 2026-10-03

Owner: coverage_audit. Read-only audit, no guest launch/build/archive extraction.

Implemented `ops/gameplay-coverage.js`, shared `ops/corpus-inventory.js` (also
consumed by dashboard category work), and `ops/gameplay-coverage.test.js`.

Reproduce:

```sh
node --test ops/gameplay-coverage.test.js
node ops/gameplay-coverage.js --output=scratch/gameplay-coverage-20261003/coverage.json
```

If the separate visual-review receipt exists, include
`--scene-reviews=scratch/gameplay-scene-review-20261003/reviews.json`. Each image
is rehashed; missing/changed bytes cannot count as a reviewed scene. This remains
historical scene evidence, not current compatibility, input response, or FPS.

The universe is 241 entries: all 76 manifest candidates plus 165 registry-only
entries after exact ID, exact normalized EXE path, and existing assessment app-ID
mapping. Unknown registry entries are kept explicitly classification-required;
these include utilities/screensavers and are not 165 asserted games. Installed
game routes behind installer candidates remain included. This intentionally
avoids excluding games simply because their manifest kind is `installer`.

The JSON gives every candidate's exact missing fixture paths, each app's full
declared dependency list, local media manifest expansion/unknown status, missing
run artifacts, saved route command, recorded scene reviews and unqualified
counter evidence. Missing `.wine-assembly-browser.json` is a dependency itself;
its absent contents remain unknown, never treated as an empty complete manifest.
Run parsing and safe-artifact checks reuse `ops/readers.js`.

At the pre-scene-receipt refresh, 28 registered apps had complete declared local
assets. Root repaired the missing `binaries -> test/binaries` symlink, making
those actual registered paths available as well. Complete asset sets include
DX-Ball, Blobby Volley, SkiFree, Solitaire, Cruel, Golf, Pegged, Rattler, Taipei,
TicTactics, Minesweeper and several 16-bit variants. The remaining complete
assets include screensavers, graphics demos and Paint; do not call these games.

Useful existing routes: `test/test-dxball-candidate.js`,
`test/test-blobby-volley.js`, `test/test-blobby-touch-keys.js`,
`test/test-skifree-gameplay.js`, `test/test-solitaire-deal.js`,
`test/test-win16-solitaire-play.js`, `test/test-win16-wep*-gameplay.js`.
These are route sources, not authorization to run every harness unexamined.
Root independently captured fresh Blobby gameplay during this audit.

Final refresh consumed the separate review receipt: 13 manually viewed,
SHA-256-matched images (six gameplay scenes, three menus, three intros, one
error). Across the conservative union this snapshot has six hash-pinned reviewed
gameplay scene groups, six additional recorded-reviewed gameplay groups,
19 other screenshot groups and 210 missing. It lists 81 missing non-image run
artifacts. Root removed the fresh Blobby proxy from public `performance` metadata
while this audit was running; the final snapshot therefore has only the two
historical Flip-event measurements. Raw proxy evidence remains separate.

Seven candidate groups currently carry recorded reviewed gameplay images:
Blobby Volley (new root run), Pirates, Serious Sam (diagnostic input polling;
ordinary production route remains blocked), Jazz2, Quake2, Collapse and Unreal.
Route metadata is an author's review assertion, not a fresh review by this
inventory. Menu/intro filenames are excluded from gameplay route sets;
special multi-scene runs pin only identified world images. Other existing
images stay scene-review-required until reviewed separately.

No qualified unique/displayed gameplay FPS is asserted. NFS3/GTA2 historical
measurements are raw guest Flip events; root's fresh Blobby measurement is a
GDI surface-flush proxy. The audit preserves numbers and labels each limitation;
`qualifiedGameplayFps` stays null. A normal exit, reviewed endpoints, elapsed CLI
time, and an FPS-shaped field cannot certify the continuous scene or counter.

Five focused tests pass: canonical union and registry path preservation,
menu/intro/unreviewed exclusion, Flip-event/non-certified counter handling, fresh
GDI proxy handling, and hash/traversal validation of scene reviews. No other
agent's files were edited. Current counts are in generated JSON and may change
as root publishes runs and fixtures finish arriving.
