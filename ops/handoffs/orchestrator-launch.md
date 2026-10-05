# Orchestrator launch record

- Date: 2026-10-01.
- tmux session: `wine-orchestrator`.
- Codex session: `01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0`.
- tmux pane PID at launch: `80668` (Node CLI launcher; not a worker PID).
- Working directory: `/Users/vg/Documents/projects/phone/wine-assembly`.
- CLI: existing Codex v0.153.4; no upgrade performed.
- Model/settings inherited: gpt-6-astra, medium reasoning.
- Sandbox: workspace-write; approval policy: on-request. No bypass flags.
- Worker limit: startup prompt explicitly caps active workers at three;
  invocation also sets `agents.max_concurrent_threads_per_session=3`.
- Startup instructions: `ops/ORCHESTRATOR.md` and initial inventory/ops handoff.
- Verified from the tmux pane: Codex accepted the prompt, read project guidance,
  reviewed FP and Serious Sam handoffs and dirty files, identified its session,
  and began recording ownership boundaries before dispatching workers.
- At verification, FP and Serious Sam handoffs were ready; other acknowledgments
  were still pending. No old root agent was killed or forcibly reparented.

Attach: `tmux attach -t wine-orchestrator`.

The coordinator owns `ops/handoffs/orchestrator-status.md` and subsequent queue
updates. This launch record is a snapshot, not a live heartbeat or auto-wake
service. A stopped/ended turn may need an interactive follow-up.
