# Ops dashboard handoff

- Owner: codex:01a0f707-fd50-7e13-b020-2cc1b9f4758f, local root PID 31655.
- Objective: file-backed operations UI, capture evidence, PID observation,
  blockers, and migration to one coordinator. Dashboard implementation complete;
  this session is bootstrapping the new coordinator.
- Worktree: repository main checkout. Dashboard commits `4a5de61b`, `99eecd7f`.
- Uncommitted owned blocker changes: ops/README.md, app.js, browser-test.js,
  index.html, ops.test.js, readers.js, server.js, style.css. These add explicit
  blocked TODO fields, Overview/Blockers UI, same-origin append-only board replies,
  owner-verification semantics, tests and docs. Do not conflate other dirty files
  with these changes. No authorization to commit unrelated work.
- Validation: 9 ops data/HTTP/PID tests pass; Chromium desktop/mobile, explicit
  blocker reply, board preservation, unchanged task status pass. Preview under
  scratch/ops-preview/blockers.png. Real Claude/Codex PID matching checked.
- Run evidence: scratch/runs/import-* contains historical captures with original
  timestamps/provenance; do not treat these as current-build verification.
- Service: `node ops/server.js`, loopback port 8098, intentionally retained.
  Host started in exec session 45037; OS PID can be found among this root's
  descendants or the listener on 8098. Do not stop unrelated services on other
  addresses. Restart only when applying backend changes.
- Resource release: ops UI source ownership released to coordinator after this
  startup handoff. No emulator, canonical build, remote CPU, or fixture claims.
- Caveat: task list is mostly old prose. New coordinator should record current
  tasks explicitly; unstructured board messages are not inferred as blockers.
- Next: receive other owners' handoffs, reconcile claims, populate current task
  queue. Optional next dashboard work is parent/task grouping; not a prerequisite.
- Migration files: ops/ORCHESTRATOR.md and ops/handoffs/initial-inventory.md are
  bootstrap records. scratch/ops-migration/initial-processes.json includes the
  sanitized local process snapshot, no command arguments or transcript bodies.
