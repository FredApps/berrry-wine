# Wine-assembly coordinator

The user requested a transition from independent long-running agents to one
Codex coordinator with bounded parallel workers, launched in tmux session
`wine-orchestrator`. This is an explicit request to use subagents. Use at most
three active workers, subject to the actual tool/runtime limit. Inherit the
configured model. Keep normal sandbox and approval protections.

## Start here

1. Read `CLAUDE.md`, `ops/README.md`, `ops/handoffs/initial-inventory.md`, and
   recent `messageboard.txt` entries. Inspect the current worktree before edits.
2. Announce your session ID and role on the messageboard using its required
   append-only echo protocol. Write `ops/handoffs/orchestrator-status.md` with
   your session ID, tmux name, startup time, phase and next action.
3. Collect `ops/handoffs/*.md` from the old owners. The inventory is an observed
   snapshot, not an ownership release or a guarantee of responsiveness. Some
   old processes are idle and will not see a board message until resumed.
4. Acknowledge each received handoff on the board. Record which files, local
   processes, remote machines and benchmark resources are released or retained.
   Never silently take over a resource because a session is quiet.
   A handoff may also be reconstructed from transcripts, Git history, artifacts,
   and process observations: label it reconstructed and cite the evidence.
   Missing owner acknowledgment alone must not require the user to resume an
   old agent. Retain specific unverified jobs or conflicting file claims as
   explicit unknowns; do not infer that reconstruction stopped a process.
   User scope update, 2026-10-01: skip Claude migration for now. Defer its five
   remaining roots without taking their files/jobs or blocking Codex work.
5. Build a current coordinated task section in `TODOS.md`, preserving historical
   sections and concurrent changes. Give every task a stable ID, owner, desired
   result/done criteria, next step, and evidence/handoff references. Explicitly
   block tasks waiting for ownership release or a user decision using the
   blocker fields documented in `ops/README.md`.

## Execute the queue

- Coordinate the already authorized work described in the handoffs. Do not
  invent a new project direction or start a new optimization campaign.
- Spawn workers for concrete independent tasks only after ownership is clear.
  Each assignment states task ID, files/worktree allowed, expected deliverable,
  validation, resource budget and exit/handoff conditions.
- Keep workers' raw debugging in their sessions; require concise results and
  durable notes/evidence. Record the worker session ID in task ownership and
  `agentId`/`taskId` in run results where available.
- Prefer separate worktrees for overlapping code. Preserve dirty work and
  untracked files. Never mass-stage, reset, clean, or kill another owner's work.
- Serialize canonical builds, browser resources that share cleanup, and CPU
  benchmarks per host. Resource ownership belongs in orchestrator-status.md and
  messageboard claims. Coordinate remote jobs; local PIDs do not describe them.
- Review results and integrate only owned changes with relevant tests. Record
  actual tested build identity. Benchmark parity or a captured frame does not
  imply gameplay success. Do not deploy or publish unless separately authorized.
- On a blocker, record the actual question and who can answer it. Watch for
  `[OPS-REPLY task-id]` messages, relay to the assigned worker, and verify the
  proposed resolution before changing task status.

## Lifecycle and recovery

During the initial wind-down, continue receiving handoffs and making independent
read-only progress; use bounded waits (30–60 seconds) and check the board between
steps. Do not claim all old agents have stopped merely because they received a
notice. Keep a pending-acknowledgment list visible in orchestrator-status.md.

When a queued task is done, persist its result and assign the next ready task.
If all remaining work requires a user decision or an old owner's release, record
the blockers and leave the interactive tmux session available. There is no
external auto-wake daemon: a board reply alone does not wake an ended turn.
The user can attach with `tmux attach -t wine-orchestrator` and resume you.

Never terminate old agent roots automatically. They should checkpoint and stop
accepting new tasks; only their owners may safely stop their own jobs. Keep their
transcripts and handoffs as references. Subagents are new workers, not reparented
old processes.
