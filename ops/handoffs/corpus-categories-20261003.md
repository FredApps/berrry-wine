# EXE corpus categories — 2026-10-03

Implemented in `ops/app.js`, `ops/style.css`, `ops/readers.js`, and
`ops/corpus-categories.js`; documented in `ops/README.md`. Uses the shared
`ops/corpus-inventory.js` released by coverage_audit.

The dashboard now includes 241 identities: 76 manifest entries and 165
registry-only entries. Exact app IDs, assessment mappings and executable paths
merge registry aliases with manifest titles; names never establish identity.
Existing runs retain their candidate IDs and exact aliases share evidence.
No manifest, game fixture, emulator source or run result was edited.

All current identities have one editorial category across 14 groups, with an
explicit Unclassified fallback for new unknown identities. Genre filtering
combines with existing source/status/search filters. Categories are ordered by
name; active work, failures and name ordering are preserved within categories.
Source distribution groups remain separate. Graphics samples/screensavers and
applications are separated from games. Installers use the target title's genre.
The classifications describe titles, not compatibility or measured performance.

Local evidence includes `test/candidate-corpus/manifest.json`, `lib/apps.js` and
`test/binaries/SOURCES.md`. The latter identifies Bricks as Klotski (puzzle),
Winarc as a Pegs/Krypto/LifeGen collection, claass as XP Calculator and xp_eos as
the XP warning utility. Registry paths distinguish DirectX SDK/screen savers.
Win98-apps fixture/registry records identify the Welcome/Tour utilities.

Registry-only fixture status reports executable presence only; dependencies and
gameplay still need their own validation. Original manifest fixture status is
preserved and registered executable presence is separately available in the API.
FPS remains absent when unmeasured; no gameplay or FPS evidence was fabricated.

Validation:

- `node --test ops/ops.test.js`: 22 passed, including registry deduplication,
  exact alias evidence, missing fixtures, category mapping and unknown fallback.
- `CHROME=/usr/bin/google-chrome node ops/browser-test.js`: passed, including
  combined category/source/status filters, empty result, alphabetical headings,
  default work order, navigation and mobile overflow. Added a wait after agents
  navigation to resolve a pre-existing asynchronous click race on this box.
- Separate fresh local dashboard smoke: actual 241 rows / 14 groups, FreeCell
  visible under puzzle + Registry only filters. No guest was launched.
- `git diff --check` on owned modified files passed.

Screenshots: `scratch/ops-preview/corpus-categories.png`,
`scratch/ops-preview/corpus-categories-mobile.png` (synthetic fixture, mobile
image visually inspected), `scratch/ops-preview/corpus-live-categories.png`
(real corpus filtered to registry puzzle games). These are dashboard evidence,
not guest gameplay captures.

Deployment: **the existing dashboard server needs its owner to restart it** to
load the changed Node reader/category modules. A browser reload loads the new
static UI. After startup, manifest, assessments and run records refresh on the
existing polling cycle; Node registry/category code edits require a restart.
No hosted service was restarted or deployed by this worker.

All owned test servers/browser processes have exited. Board watcher released.
No live guest, benchmark, remote handle or resource claim remains.
