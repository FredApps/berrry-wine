# Three-game review publication reconciliation — 2026-10-05

Source-only audit of `PERF-THREE-GAMES-TOYVM-20261004` against
`origin/main` at `2f9bbd436935640cf60e985ef9d62860d5746516`. No benchmark,
browser, build, or performance promotion occurred.

* Claude's completed review was already merged as `2c94e0f1`. Its 372-line
  `claude-three-game-performance-review-20261004.md` is byte-identical to the
  released local copy, SHA-256
  `9926a206624f4834ca153490e7139328a98a52f03931140009737073bac603c6`.
  The task's “assigned, pending” wording was stale; no duplicate document is needed.
* Codex's completed independent review was absent from this main tree. It exists
  in the older box checkpoint `a9c8df90` and the released local handoff,
  SHA-256 `78d9cb411bc6bfb60c2f626c46b4d43a0e36939676bb21aae24044bc895d384c`.
  The publication commit adds that exact historical report without rewriting
  its independently ranked recommendations.

Both reports are dated evidence reviews, not new measurements. Their dated
missing-raw statements and then-open BRW observations describe what those
reviewers had on October 4. Subsequent private BRW parity and the ongoing corpus
validation belong to `TOYVM-REGION-JIT-BRW` and its current owner receipts; they
must not be inferred from these reports or counted as production promotion.
The task to publish independent recommendations is distinct from executing
their suggested experiments. Whole-process cost, scene qualification, sound,
engine identity, and correctness gates remain necessary for any later claim.

Local byte-comparison receipt:
`scratch/perf-three-games-reconcile-20261005/audit.json`. Existing task ownership
is preserved. Only the missing Codex review and this reconciliation are proposed
for integration; runtime sources and Claude's ongoing work are unchanged.
