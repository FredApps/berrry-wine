# OPS-COORDINATOR-CONTINUITY: durable passive inbox

Status: complete for the existing active native-goal coordinator; no external wake service.
Worker `/root/fp_parity`, Codex `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, 2026-10-02.

Implemented new `ops/coordinator-inbox.js` and `ops/coordinator-inbox.test.js` only. Existing dashboard, terminal, task store, reader and orchestration files remain untouched. No real task/status/approval/terminal mutation, daemon install, model launch, extra app-server, REP work or nested agent. Native goal continuation remains the existing coordinator's responsibility; this inbox does not wake it.

## Behavior

- Reads `TODOS.md` using the existing parser and every local Markdown file in `ops/handoffs/`. Reports ready tasks with dependency and pickup state, ready tasks with unresolved dependencies, backlog dependencies now done, active tasks lacking pickup, and missing/ambiguous task IDs. Backlog dependency completion does not authorize scheduling.
- Uses stable semantic task hashes independent of source line shifts. Handoff identities hash full bytes. Each changed or reappearing observation has a durable occurrence number and notice ID, so ready→deferred→ready is visible even if the final content repeats. Repeated polling/restart does not create a second identity for unchanged content.
- Every pending notice remains until an explicit exact-ID acknowledgement. Emitting JSON does not acknowledge it. Superseded/deleted source versions remain pending with `current:false` and `actionable:false`. Acknowledging an old handoff never acknowledges a newer version.
- Handoff completion is conservative: only explicit `status:` or `handoff-status:` metadata in the first twenty non-example header lines is classified. Fenced examples are ignored; conflicting declarations are ambiguous. Free-form historical handoffs are emitted as `unclassified`, including PASS prose. No report implies an accepted worker result or released resource. The coordinator's own handoff updates are also observations; explicit ack and unchanged-content dedupe avoid automatic feedback, but repeated edits will create new notices.
- Cursor is `scratch/ops-coordinator-inbox.json`; exclusive lock is `scratch/ops-coordinator-inbox.lock/owner.json`. `openInbox` holds the lock for its lifetime. CLI holds it for one scan/ack. A second observer is rejected; a stale/crash lock is never stolen. Cursor writes use a temporary file, file sync, atomic rename and directory sync. Source files are never written.
- The cursor separately stores current observation identities, pending versions, delivered receipts and acknowledged IDs. Acknowledgement is neither task acceptance nor task completion; the coordinator must still update its authorized ledger and verify ownership normally. Unknown/never-delivered IDs fail. Coordinator identity changes or corrupt state fail instead of resetting history.
- Verified active/busy runtime allows read-only notice delivery/ack with `pickupAllowed:false`. Active/idle allows review eligibility, not execution authorization. Missing, malformed, stale, future-dated, disconnected, absent-CLI, ambiguous-coordinator/turn, approval-pending/unknown or non-active-goal observations withhold delivery and acknowledgement; scans still retain pending changes. There is no dispatch operation in either case.

## Runtime evidence is supplied, not discovered

The module **cannot authenticate runtime truth from a JSON field or file presence**. `provider:"native-goal"` is a schema tag, not proof. A trusted caller must obtain a fresh `get_goal` result and current registered coordinator/connection/turn/approval evidence, and supply only what it can establish. A goal alone does not establish CLI availability, turn state, absence of approval or exclusive coordinator identity. Terminal text, process presence, historical transcript and `orchestrator-status.md` are not authoritative replacements.

The current Goals tool returns `threadId`, not a standalone goal ID. For this integration use `runtime.goal.id = get_goal.threadId` (the root thread `01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0`) and `runtime.goal.status = get_goal.status`. The runtime `coordinatorId` must exactly match the CLI/API `coordinatorId`; root may consistently use `codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0`. Never fill unknown fields with optimistic defaults. The caller is responsible for verifying that the supplied goal belongs to that coordinator.

Runtime schema:

```json
{
  "schema": 1,
  "provider": "native-goal",
  "coordinatorId": "codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0",
  "coordinatorCount": 1,
  "observedAt": "FRESH_ISO_UTC_FROM_TRUSTED_OBSERVATION",
  "connected": true,
  "cliPresent": true,
  "goal": {"id": "01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0", "status": "active"},
  "turn": {"state": "busy"},
  "approvalPending": false
}
```

This example is deliberately not valid runtime evidence until populated from actual observations. Runtime age must be at most thirty seconds when the scan finishes; future timestamps fail. Root should report `busy` when polling during its own turn. `pickupAllowed` means only that the observed turn is idle and remaining gate fields pass. Always review `current`, task status/dependencies and ownership again before assigning work.

## Concrete CLI/API integration

Root may place its own fresh observation in `scratch/coordinator-runtime.json` and run:

```sh
node ops/coordinator-inbox.js --root=/Users/vg/Documents/projects/phone/wine-assembly --coordinator=codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0 --runtime=scratch/coordinator-runtime.json
```

Review returned notices and act through the existing authorized coordinator workflow. After review, refresh runtime evidence and acknowledge only the exact reviewed IDs with the same command plus `--ack=NOTICE_ID,NOTICE_ID`. An idempotent repeated acknowledgement is allowed. No `--ack-all`, auto-completion, terminal input or wake flag exists. Running without `--runtime` safely queues observations and returns a withheld gate with counts. This was tested in disposable fixture roots only; no live cursor was initialized by this worker.

For in-process polling, `await openInbox({root,coordinatorId})`, then `await inbox.poll({runtime,acknowledge:[]})`, and `await inbox.close()` in `finally`. Calls on one handle serialize. The caller owns polling cadence; no background timer/watch process is created. Do not poll through a second coordinator or app-server. The CLI itself does not collect authoritative runtime evidence or call Goals.

If the process crashes while holding the lock, inspect its owner record and confirm that observer ownership is released before manually retiring that specific lock. Do not infer release from age or quiet output. A cursor capacity limit (4 MiB), input file limit (4 MiB each) and handoff-count limit (2,000) fail explicitly; archival/migration needs an intentional reviewed operation. No automatic pruning discards unacknowledged evidence. Task projection hashes cover parsed status/dependency/pickup/next/done/notes/evidence/blocker fields; arbitrary unknown metadata and pure queue reordering are not separate events. Scanning detects changes during individual file reads and rechecks the task source, but is not an atomic snapshot of the whole repository. Recheck live sources before assignment.

## Validation and source identity

`node --test ops/coordinator-inbox.test.js`: **10 tests passed, zero failures**, final run exit 0. Tests use temporary roots and synthetic runtime observations; cleanup closes owned observers before deleting fixture directories. Coverage includes idle delivery, busy review, approval, disconnect/reconnect, paused/blocked/complete goals, stale/future observations, missing CLI, duplicate observations, restart/ack replay, dependency and pickup changes, ambiguous IDs, repeated content after reopen, updated/deleted handoffs, unclassified historical/fenced completion prose, exclusive/stale lock, corrupt cursor, unknown/hidden acknowledgement, symlink rejection, malformed CLI runtime and changed coordinator identity. The initial run caught notice-ID/task-ID field collision and fixture teardown ordering; both were fixed before the final pass.

Exact reviewed implementation identities:

| New file | SHA-256 |
| --- | --- |
| `ops/coordinator-inbox.js` | `405824c6fe2ab3d866fda01656a78fafba5b81f1cabf60460f4b87f23cd6f3be` |
| `ops/coordinator-inbox.test.js` | `bab96ad7e88007dba1441604b570c77f7e8a9f66d03032cf69d0dac3961bf4fb` |

Both are untracked new files, so their complete contents are the proposed patch; existing-file diffs are absent. No broad test suite or emulator/browser work was run. This handoff is the third owned new file.

## Remaining live validation and limitations

1. Root reviews the module and supplies trustworthy fresh runtime evidence from its existing Goals/runtime connection. If any required state cannot be confirmed, retain a withheld gate; do not invent a runtime adapter from terminal text.
2. Run one live read-only scan during the existing active turn. Confirm the busy-review gate, real task/handoff identities and initial historical backlog. Initial scanning intentionally emits historical handoffs instead of silently considering them acknowledged.
3. Review and acknowledge a small exact notice set; repeat a scan/restart and verify those identities remain acknowledged while unrelated notices remain pending. Do not mutate a real task merely to test the observer; synthetic transition coverage already exists.
4. Include polling at the root's actual queue/handoff boundaries and check one subsequent naturally changed task or completed handoff. Update coordinator instructions only after coordination with the active dashboard owner. This worker did not edit those shared files.

The native goal dispatcher already owns safe idle continuation per root's official-documentation review. When the goal is paused/blocked/completed, the CLI is absent, the runtime is disconnected or approval is pending, this inbox cannot resume the coordinator. It also cannot prove that a future turn will occur, that a user approval was accepted, or that work was assigned. The broader continuity task remains **live-integration/observation pending**; passing this fixture suite is not full continuity acceptance. No daemon or runtime slot remains held by this worker.

## Root live acceptance — 2026-10-02T04:34:28.257993+00:00

The registered root independently reviewed source hashes and supplied current busy-turn evidence after fresh get_goal results. Live scan delivered51 notices with pickupAllowed=false. Two exact reviewed acknowledgements persisted through close/reopen while49 unrelated notices remained pending. The subsequent natural Zuma worker handoff update generated a new notice and retained its previous version as noncurrent; both were reviewed and explicitly acknowledged. Four acknowledgements now persist. Evidence: scratch/coordinator-live-scan.json, scratch/coordinator-live-ack-restart.json and scratch/coordinator-natural-handoff.json.

Root recorded mandatory polling at actual queue/handoff boundaries in orchestrator-status.md. The existing native goal continues orchestration; there is no terminal-input waker, daemon or duplicate coordinator. Fixture approval/disconnect cases remain fixture evidence, not a claim to have disconnected this live session. Unknown runtime state still withholds delivery. Earlier pending-work wording above describes the implementation handoff before this root acceptance.

At 2026-10-02T04:35:51.181483+00:00, the existing native goal delivered the next continuation after root ended its prior turn; root performed fresh goal/queue/inbox checks without a manual user prompt. This verifies one actual continuation boundary, not indefinite uptime or recovery from a stopped CLI.
