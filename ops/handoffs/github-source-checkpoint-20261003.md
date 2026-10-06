# Migrated source checkpoint and dashboard launch

The user requested that all source changes be pushed to GitHub. This checkpoint
preserves the migrated worktree on a separate branch, based on the fetched
`origin/main` commit `e16b384ce9c06e83a711b10ce724cae670fb094e`. Remote-only
Telegram, gateway-test and snapshot-verifier updates were reconciled before the
checkpoint. The live worktree and normal Git index remain intact.

The checkpoint includes inherited emulator, renderer, compiler, test and
documentation changes, plus the coordinator's gameplay-coverage tooling, EXE
categories, release-readiness view and authenticated emulator launch links.
It is a source preservation checkpoint, not acceptance of every inherited
experiment or promotion to the production game desktop. The unresolved REP
automated-review and other correctness gates in TODOS.md remain in force;
blocked validation was not retried.

Latest dashboard validation: 59 focused/existing data, HTTP, authentication,
Telegram and release/launch tests pass; test-tier membership passes. Actual
dashboard click opened Icy Tower in a new emulator tab. The public authenticated
route ran Solitaire, with cross-origin isolation enabled. Unauthenticated
emulator entry was denied, and private repository files remained inaccessible.
Only the dashboard backend service was restarted; no public game deployment.

Ignored private configuration, credentials, transcripts, project memories,
runtime evidence, guest binaries, download archives and generated builds are
not source and are excluded. The untracked V8 profiling log and torrent file
are also excluded. The dated public desktop source snapshot is included under
`ops/release-evidence/production-20261003` so membership provenance survives a
checkout. Runtime evidence paths in other reviews remain local and are not
represented as available in a fresh clone.

Local audit receipts: `scratch/github-publication-audit-20261003/`.
Dashboard/runtime receipts: `scratch/production-desktop-review-20261003/`.
