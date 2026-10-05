# Initial agent migration inventory

Observed 2026-10-01T23:30:01.656Z. This records local process presence plus sampled session logs and recent messageboard statements. It does **not** assert current ownership is released, work is complete, or remote jobs have stopped. Owner handoffs supersede these provisional summaries.

Found **14 local provider host PIDs**, **14 root sessions**, and **12 additional open Codex child-session logs**. Claude in-process child logs are not individually enumerated here; dashboard history may contain additional completed children. Six Codex roots had activity near the snapshot (including this migration session); the rest are idle/older observations.

- Sanitized process/session details and child PID lists: `scratch/ops-migration/initial-processes.json`.
- Dirty-file snapshot (ownership unknown): `scratch/ops-migration/git-status.txt`.
- Existing head at inventory: `d7790a79d935d4f4a856829774543124f5457db3`.
- User-requested wind-down broadcast posted to `messageboard.txt`; no process was terminated.
- Idle roots may not read the board until their next turn. No acknowledgement should be inferred.

| PID | Provider | Workstream | Observed state | Last activity UTC |
| --- | --- | --- | --- | --- |
| 10341 | claude | Older emulator performance / toyvm transfer ideas | idle | 2026-09-30T22:10:20.392Z |
| 81503 | codex | FP repeatability and next countdown experiment | tool | 2026-10-01T23:30:22.855Z |
| 27203 | codex | Serious Sam gameplay / memory / static TLS integration | tool | 2026-10-01T23:30:35.484Z |
| 36638 | claude | Older toyvm project-state overview | idle | 2026-09-30T22:32:10.837Z |
| 68796 | claude | Older Claude session recovery/summary | idle | 2026-09-29T01:41:57.570Z |
| 1433 | claude | NFS II setup / stable release preparation | idle | 2026-10-01T23:24:38.350Z |
| 53759 | claude | Older project marketing discussion | idle | 2026-09-29T04:35:52.806Z |
| 6300 | codex | Universal renderer / Glide migration | working | 2026-10-01T23:30:59.233Z |
| 87219 | codex | Older coordination / safe commit workflow | idle | 2026-09-19T21:04:10.126Z |
| 43184 | codex | Reflexive / MMX fusion experiments and real-gameplay regressions | working | 2026-10-01T23:30:57.925Z |
| 31655 | codex | Ops dashboard and coordinator migration (this session) | working | 2026-10-01T23:30:57.975Z |
| 77464 | codex | Older runtime / overlay / save integration | idle | 2026-09-19T20:55:59.964Z |
| 45907 | codex | Pirates! Worker compatibility / StretchRect | idle | 2026-10-01T23:29:29.654Z |
| 71819 | codex | Older audio / silent API / review backlog | idle | 2026-09-28T21:42:04.369Z |

## Older emulator performance / toyvm transfer ideas

- Session: `claude:91494a3e-7dfa-4287-a899-2ef1bbca97bb`
- PID: 10341; parent PID: 10298; OS state: S+; process age: 05-22:51:01.
- Session log: `/Users/vg/.claude/projects/-Users-vg-Documents-projects-phone-wine-assembly/91494a3e-7dfa-4287-a899-2ef1bbca97bb.jsonl`
- Observed 8 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Live Claude host but idle since Sep30. Historical discussion of moving toyvm optimizations to main emulator. Eight local descendants still observed; do not infer they are productive work. Current ownership and remote watchers need explicit owner audit.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## FP repeatability and next countdown experiment

- Session: `codex:01a0ea85-3924-7402-b3be-dc8fa5181697`
- PID: 81503; parent PID: 81502; OS state: R+; process age: 02-23:13:38.
- Session log: `/Users/vg/.codex/sessions/2026/09/28/rollout-2026-09-28T17-16-34-01a0ea85-3924-7402-b3be-dc8fa5181697.jsonl`
- Observed 17 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Latest board identity fp-next/root. Previous repeatability slice committed d7790a79. Current benchmark-only tools/bench-fp-combos.js and tools/bench-mw3-repeat.js/report pcm/pcp modes, new fp-next tools/docs, private modules; no production WAT. Wind-down acknowledged: existing builds18077/10265 and parity39256 only; browser70398 failed route null dstW, no timing. Retains ASCII bx_4r5uzdwv until acknowledgment.
- Handoff state at initial inventory: wind-down acknowledged; handoff being prepared.

## Serious Sam gameplay / memory / static TLS integration

- Session: `codex:01a0f6ff-da61-7710-a604-d9442103dbbd`
- PID: 27203; parent PID: 27202; OS state: R+; process age: 13:04:04.
- Session log: `/Users/vg/.codex/sessions/2026/10/01/rollout-2026-10-01T03-25-57-01a0f6ff-da61-7710-a604-d9442103dbbd.jsonl`
- Observed 15 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Gameplay with diagnostic polling config verified in retained :8138 parked batch240001. New :8146 frozen87000 uses production memory helpers. Memory/decommit integration released after five suites passed. Current ownership: src/09a-handlers3-sync.wat, src/08-pe-loader.wat, src/08b-dll-loader.wat, src/01-header.wat TLS comment, test/test-tls-lifetime.js, narrow lib/dll-loader.js failed-load guard. Static TLS/fault/REP/timer and launch/input integration remain.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## Older toyvm project-state overview

- Session: `claude:88bbcb9f-c099-48e3-b1e2-5f1a74dea00d`
- PID: 36638; parent PID: 69987; OS state: S+; process age: 09-01:46:22.
- Session log: `/Users/vg/.claude/projects/-Users-vg-Documents-projects-phone-wine-assembly/88bbcb9f-c099-48e3-b1e2-5f1a74dea00d.jsonl`
- Observed 0 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Live Claude host; idle since Sep30, no local descendants at snapshot. Historical summary, no current implementation claim established.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## Older Claude session recovery/summary

- Session: `claude:ac698f44-68ef-413b-b515-19e31a29a4f3`
- PID: 68796; parent PID: 76945; OS state: S+; process age: 09-00:55:04.
- Session log: `/Users/vg/.claude/projects/-Users-vg-Documents-projects-phone-wine-assembly/ac698f44-68ef-413b-b515-19e31a29a4f3.jsonl`
- Observed 0 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Live Claude host; idle since Sep29, requested summary of session249e8325-0f95-45f3-8600-900ef040ac65. No current implementation claim established.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## NFS II setup / stable release preparation

- Session: `claude:5e92d715-203b-491b-97c5-fd8ebf17c1de`
- PID: 1433; parent PID: 1353; OS state: S+; process age: 03-01:08:24.
- Session log: `/Users/vg/.claude/projects/-Users-vg-Documents-projects-phone-wine-assembly/5e92d715-203b-491b-97c5-fd8ebf17c1de.jsonl`
- Observed 9 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Claude title describes prior release work; latest project board identifies NFS2 setup and IS3 gauge investigation by child. Session currently idle; inspect handoff before assuming any current release authorization. Start Menu shortcut publishing committed0dca52b9; prior browser8137 closed per board. Recent IS3 gauge child inspecting black background/text/clipped Cancel. Remote/resource state needs owner confirmation.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## Older project marketing discussion

- Session: `claude:361d8f4f-158f-469d-b70b-904b9c3d7eeb`
- PID: 53759; parent PID: 53688; OS state: S+; process age: 07-02:26:49.
- Session log: `/Users/vg/.claude/projects/-Users-vg-Documents-projects-phone-wine-assembly/361d8f4f-158f-469d-b70b-904b9c3d7eeb.jsonl`
- Observed 0 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Live Claude host; idle since Sep29, no local descendants. Historical discussion, not an active implementation task.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## Universal renderer / Glide migration

- Session: `codex:01a0eb29-4302-7e20-9b06-7084fb37358b`
- PID: 6300; parent PID: 6293; OS state: R+; process age: 02-20:14:18.
- Session log: `/Users/vg/.codex/sessions/2026/09/28/rollout-2026-09-28T20-15-45-01a0eb29-4302-7e20-9b06-7084fb37358b.jsonl`
- Observed 6 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Private /private/tmp/wa-render-unify; frontend/backend/validation children. Latest board: 82-file checkpoint failed duplicate-WAT helper gate; owner consolidating. Software Q2 measured ~0.85 vs main ~10.5 completed FPS, so performance acceptance unresolved. New native specular and common RGBA resource work in progress. Owner must state branch/commit and remote resource status.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.
- Open child threads: `/root/glide_frontend` (codex:01a0eb3e-864c-7bc3-a134-e6ef8aa33a8b, idle); `/root/glide_backend` (codex:01a0eb3e-a2a9-7a00-81c7-0318413b01a0, working); `/root/glide_validation` (codex:01a0eb3e-d002-7022-9568-13d937dd6dde, tool).

## Older coordination / safe commit workflow

- Session: `codex:01a0a731-f217-7f30-a0e6-a0d782017f2f`
- PID: 87219; parent PID: 87218; OS state: S+; process age: 16-00:59:10.
- Session log: `/Users/vg/.codex/sessions/2026/09/15/rollout-2026-09-15T15-31-03-01a0a731-f217-7f30-a0e6-a0d782017f2f.jsonl`
- Observed 2 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Idle Codex root since Sep19. Prior completed scratch-build isolation/runner extraction. Open suggestions: private-index safe commit tooling, provenance, queryable ownership and resource scheduling. Historical recommendations require re-triage, not automatic execution.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## Reflexive / MMX fusion experiments and real-gameplay regressions

- Session: `codex:01a0eef4-21b2-76b3-8352-48b0d6ac6e7f`
- PID: 43184; parent PID: 43183; OS state: R+; process age: 02-02:33:49.
- Session log: `/Users/vg/.codex/sessions/2026/09/29/rollout-2026-09-29T13-56-12-01a0eef4-21b2-76b3-8352-48b0d6ac6e7f.jsonl`
- Observed 19 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Own experimental files under /private/tmp/mmx-more-fusions and scratch/mmx-more-fusions-20261001; native, island and x87-history children. Latest board: balanced Jazz/Unreal 20-run sets and parity passed; Jazz no net speedup, combined Unreal still slower than original. Remote fast-near-9tb-2 CPU currently Collapse regression. No production/default change authorized by evidence. docs/re-notes/reflexive.md and reviewed run bundles are source references.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.
- Open child threads: `/root/mmx_island` (codex:01a0f6e3-3637-7672-a2a7-f6b76e4f3c3b, idle); `/root/mmx_native` (codex:01a0f6c8-2fa8-7a23-b5f5-e7368308bd2e, idle); `/root/x87_session_history` (codex:01a0f6f4-7a88-77a1-87a1-47e10c5d66cf, idle).

## Ops dashboard and coordinator migration (this session)

- Session: `codex:01a0f707-fd50-7e13-b020-2cc1b9f4758f`
- PID: 31655; parent PID: 31654; OS state: R+; process age: 12:55:10.
- Session log: `/Users/vg/.codex/sessions/2026/10/01/rollout-2026-10-01T03-34-51-01a0f707-fd50-7e13-b020-2cc1b9f4758f.jsonl`
- Observed 9 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Dashboard commits4a5de61b/99eecd7f. Completed uncommitted blockers workflow, 9 tests + browser pass. Retain dashboard port8098. Own migration docs; see ops/handoffs/ops-dashboard.md.
- Handoff state at initial inventory: ops handoff recorded.

## Older runtime / overlay / save integration

- Session: `codex:01a08812-a2da-7333-83fc-851ef8fff7b1`
- PID: 77464; parent PID: 77463; OS state: S+; process age: 22-02:01:25.
- Session log: `/Users/vg/.codex/sessions/2026/09/09/rollout-2026-09-09T14-28-37-01a08812-a2da-7333-83fc-851ef8fff7b1.jsonl`
- Observed 3 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Idle Codex root since Sep19 with three old child logs. Historical next step: memory integration/allocator tests, clean-main validation, save/input repeatability and review recovery. These overlap newer work; reconcile commits before creating tasks.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.
- Open child threads: `/root/runtime_fixes` (codex:01a08866-70e9-70e2-bb37-1e83828e5d7f, idle); `/root/overlay_fixes` (codex:01a08866-9d96-7ff0-941d-c5daa417c2f0, idle); `/root/save_fixes` (codex:01a08866-bdde-7f63-894d-38783212e725, idle).

## Pirates! Worker compatibility / StretchRect

- Session: `codex:01a0f736-78f1-7822-8b37-159d6f8ed94d`
- PID: 45907; parent PID: 45906; OS state: R+; process age: 12:04:25.
- Session log: `/Users/vg/.codex/sessions/2026/10/01/rollout-2026-10-01T04-25-37-01a0f736-78f1-7822-8b37-159d6f8ed94d.jsonl`
- Observed 13 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Latest board: canonical build PASS, module 7c5f97f5ba26f556c4fbeebbee40519851295a6e66b0f5f8a2df985fc71689af; canonical build claim released. StretchRect src/09am-d3d-color.wat, D3D9 capabilities/test work; independent old Worker UpdateSurface assertion reproduced. Isolated browser harness used because global profile cleanup can kill other harnesses. Long Worker sailing validation requires owner result. Evidence scratch/runs/20261001-pirates-worker-castoff-before.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.

## Older audio / silent API / review backlog

- Session: `codex:01a04d26-4255-7ee2-bb58-9e2cbedb68df`
- PID: 71819; parent PID: 71818; OS state: S+; process age: 21-03:16:38.
- Session log: `/Users/vg/.codex/sessions/2026/08/29/rollout-2026-08-29T03-52-28-01a04d26-4255-7ee2-bb58-9e2cbedb68df.jsonl`
- Observed 44 host descendants (see JSON); these can include watchers, shells, servers or workers, not necessarily active tasks.
- Idle Codex root since Sep28 with three old child logs and44 local descendants. Last summary: uncommitted wave capability buffer sparse/bounded writes; earlier920 cases passed, full build unverified. Old requests for audio ID/mapper validation and review backlog may be stale. Audit owner/children before takeover.
- Handoff state at initial inventory: awaiting explicit owner acknowledgment.
- Open child threads: `/root/next_review_gap2` (codex:01a0a766-afeb-7602-a4a9-49bd601d85c3, idle); `/root/next_silent_candidate` (codex:01a0a757-da66-77f2-a0d0-77e9d7c41378, idle); `/root/toyvm_bundle_repair` (codex:01a0a725-ed06-76a3-a23c-de984f6355f9, idle).

## Resource cautions

- Canonical build is shared. Last Pirates announcement released it, but recheck board before claiming.
- Serious Sam browser/control ports8138 and8146 are retained at frozen checkpoints until owner instructions.
- FP ASCII bx_4r5uzdwv and MMX fast-near-9tb-2 require explicit handoff; do not overlap benchmark work.
- Universal-render private worktree/remote checkpoint require owner confirmation.
- Existing browser harness global cleanup has killed other active harnesses; use isolated profiles.
- Dashboard8098 is intentionally retained.
- No bulk commit/reset/cleanup. Current dirty files have multiple owners.
