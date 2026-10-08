# Run evidence containment, 2026-10-07

Checked 731 existing `scratch/runs/*/result.json` manifests on the persistent
box. Localized 24 declared file references across 10 runs (169,303,558 bytes),
including external symlink targets. Only individually named files were copied;
no work directories or original files were removed. Copies were compared byte
for byte before atomically publishing the rewritten metadata.

The initial estimate of about 70 runs did not match the current artifact fields.
Many references to old work directories occur in historical commands, which
remain unchanged rather than being presented as commands that actually ran
from the new evidence location.

The containment check now passes. Completeness remains distinct: 82 missing
historical local references are reported in the receipt. Additionally,
`scratch/new-game-myth-20261005/myth-fixes.patch` was absent and could not be
recovered. The Myth run's `build.dirtyPatch` is now explicitly null, with the
original path and reason recorded in `missingEvidence`; its original metadata
was preserved before this correction. No replacement evidence was invented.

Local audit bundle: `scratch/runs/20261007-run-evidence-localization/`:

- `migration.json`: exact old/new paths, SHA-256 and byte counts.
- `check.json`: containment result and exact missing historical paths.
- `myth-result-before.json`: original metadata for the unavailable patch.

`node ops/check-run-evidence.js ROOT` fails on escaping declared artifact paths,
including absolute paths, symlink targets and missing files beneath escaping
symlink ancestors. Missing contained artifacts are reported separately. The
optional `--localize` operation retains originals and enforces the 2 GiB disk
floor. Regression tests cover traversal, sibling references, absolute paths,
symlinks, missing evidence, shared filenames, unchanged historical commands,
byte preservation and idempotence; both test groups passed.

Evidence remains local and gitignored; the checker, tests, workflow and this
report are committed. No browser, emulator run or public deployment was needed.
