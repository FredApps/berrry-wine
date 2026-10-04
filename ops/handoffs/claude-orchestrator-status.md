# Claude orchestrator status (CLAUDE-HANDOFF-ORCHESTRATOR)

Owner: claude:1863d2b5-bc58-4c0b-9c15-00fc951f0256 · recurring · updated 2026-10-04T10:49Z.
Reconciled against the live box, not against the 2026-10-03 audit
(`ops/handoffs/claude-handoff-audit-20261003.md`, historical): commits checked with
`git merge-base --is-ancestor <sha> HEAD` (HEAD 16f764ad), task ledger grepped, artifacts listed.
Custody (handoffs received, claims released: MIG-NFS2 / MIG-LEGACY) is **done**; the engineering
follow-ups below are **not** — until today none had a task ID.

## Active Claude work

| Task | Owner / worker | State | Next / evidence |
|---|---|---|---|
| CLAUDE-HEROES2-PERFORMANCE | subagent of 1863d2b5 (opus, launched 10:45Z) | active, holds the sole serialized runtime window (≤600 s) | delivers `docs/re-notes/heroes2-performance-20261004.md`; I review before reporting |
| CLAUDE-LAUNCH-UX | 1863d2b5 | review (uncommitted) | root review/checkpoint; handoff `claude-launch-ux-design-20261003.md` §0 |
| TOYVM-REGION-JIT-BRW | audit subagent of 1863d2b5 (see board) | active, source-only until the runtime window frees | see lane 4 |
| CLAUDE-HANDOFF-ORCHESTRATOR | 1863d2b5 | active, recurring | this file |

## Five-lane inventory

### 1. claude-icons 5e92d715 — NFS II SE install, installer shortcuts, IS3 dialog
- Verified done: 82872fd6, 0dca52b9, dd530167, b6db60d2 on main. Release head d8661c82 is NOT on
  main (origin/release/2026-10-01 only; deploy of 2026-10-02 not re-verified here, and deploying is
  not mine to do).
- Unfinished → **NFS2SE-INSTALL-ICON-VERIFY** (ready, needs the browser slot): install NFS II SE from
  `test/binaries/candidates/need-for-speed-2-se-full/sources/NFS2SE.ISO` (present, 592 MB; extracted
  `cd/` also present) via media import, check the desktop icon/label, and re-derive the IS3
  copy-dialog headless repro (original `scratchpad/is3/stage2.sh` lived on the Mac, lost). The
  "transfer blocker" no longer applies to this ISO. Retail CD: never deploy.
- Unfinished → **SYSMON-PERFSTATS-TRIAGE** (ready, needs a short runtime slot):
  `test/test-sysmon-perfstats.js` (unit tier) — get a current pass/fail; handoff says it failed
  "the guest heap is charted at all" before b6db60d2 too.
- User decision → **USER-DECISION-OPFS-SHORTCUTS** (blocked on user): should kept (OPFS) media also
  record the shortcuts its installs create? Proposed, never answered. Do not start without a yes.

### 2. sc2k-compare ac698f44 — SimCity 2000 launcher
- Verified done: 40c1c484 on main; `test/test-invalidate-erase-children.js` present.
- Optional, never requested → **SC2K-UI-DIFFS-OPTIONAL** (deferred): city menu bar File/Help only,
  budget dialog placement/sunken fields, Video Warning missing a line. Not authorized work; needs a
  user/coordinator yes. Separate from GAMEPLAY-simcity2000_* coverage tasks.

### 3. uop-merge / wine-assembly-d0 91494a3e — uop tier
- Verified done: e4cd5e5d, 6acc6543, e09a1c2d, 1e59412e, 837f0a74, d2639c00 on main.
- Unfinished → **UOP-RETRY-LADDER** (backlog until the slot is free and BRW is reviewed): ec2bf87c
  exists only on `origin/worktree-agent-aaa481e5bbddec58a`. Gate first: in an isolated worktree,
  check unit cases `movsd-nfs-record-loop` and `nobump-mark` (test/test-uop-compiler.js, ladder mask 7)
  against base. A/B only on a quiet bench box, with V8 + SpiderMonkey native captures per CLAUDE.md.
  No merge by me; ops-dashboard integrates. Icall census logs were Mac-only (lost).

### 4. toyvm-uop 88bbcb9f — region JIT
- Verified done: 604c71b9, b0f38372, deddbe2b on main; `test/test-toyvm-region-live.js`,
  `test-toyvm-region-install-clock.js`, `tools/toyvm/region-live.js` present.
- Correctness first → **TOYVM-REGION-JIT-BRW** (active): BRW checksum DISAGREE under
  `--region-jit-continuous` (jit-sepc: 500918117/2fa3dd95 vs L1 500918116/a066bf27 — one extra unit,
  different hash) plus an "only-naive" off-by-one. No region-JIT perf work (helper inlining, cheaper
  gate) until this is understood. Original logs live on bx_xegf6upd (`/home/user/sepc30.*`), not
  here. Phase 1 now: source audit of continuous re-profiling/install/decline paths; phase 2 (after
  the Heroes window): bounded single-program correctness repro, no timing.
- Missing native captures for the new arms are an optimization-gate item, recorded under the same task.

### 5. Parked lane (excluded)
- Parked by user decision 2026-10-04: excluded from this box, GitHub and all Claude queues. No tasks, no work.

## Resources needing an owner (not mine to touch)
- **RESOURCE-RECONCILE-REMOTE** (waiting on root): bx_xegf6upd `~/toyvm-ab` (detached at deddbe2b)
  and its `sepc30/sep30` logs — the BRW evidence; host key was pinned only on the Mac.
  fast-near-9tb-1 possible `uop-ladder*` dir. Neither appears in the ledger.

## Stale items dropped
- "main build fails" notes from the d0 and sc2k handoffs (region-census gate, unincluded
  09a7h) — not re-run here (no build allowed in parallel); later builds passed per board. Not tracked.
- NFS II SE "missing transfer" — ISO and tree are present locally (restore-full audit 09:02Z:
  216 present / 7 missing-files entries / 229 paths; NFS II SE full is `no-registered-route`, not missing).

## Queue order once the Heroes runtime window is released
0. **Hand the slot to corpus_categories HYPE-MENU-GAMEPLAY-20261004 first** (root request); post the exact Heroes RELEASE time on the board and wait for their release.
1. TOYVM-REGION-JIT-BRW phase 2 (CLI, ≤300 s). 2. SYSMON-PERFSTATS-TRIAGE (≤60 s).
3. NFS2SE-INSTALL-ICON-VERIFY (one browser session). 4. CLAUDE-OPS-DASHBOARD-UX-REVIEW phase 2 browser walkthrough.
5. UOP-RETRY-LADDER gate (isolated worktree build — needs build-slot coordination with root).

## Other Claude tasks (2026-10-04)
- CLAUDE-OPS-DASHBOARD-UX-REVIEW: phase-1 proposal in `ops/handoffs/claude-dashboard-ux-review-20261004.md` (source/API audit, no browser yet).
- CLAUDE-PROGRESSIVE-GAME-LOADING-DESIGN: accepted; assigned to the first free existing worker (after the BRW audit). Proposal only.
