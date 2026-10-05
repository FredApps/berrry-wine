# Handoff: wine-assembly-d0 (Claude session 91494a3e-7dfa-4287-a899-2ef1bbca97bb, board tag "uop-merge")

- Owner session and local PID: Claude Code session wine-assembly-d0 [be43e2]; no child processes running.
- Objective and done criteria: uop-tier perf work and merging verified agent work into main; emulator bug fixes. Paused by user (weekly limit) 2026-09-30, frozen for migration 2026-10-02.
- State: checkpointed. Everything finished is on main; one unmerged partial branch (below).
- Worktree, branch, relevant commits:
  - Merged to main this session: COPY/FILL uops; e4cd5e5d (§20 trace limits); 6acc6543 (straight-line traces, RECT_RUN retired, §21); e09a1c2d (unhandled SEH exception stops guest); 1e59412e (VerQueryValue VB6 byte counts, JigSawedME error 5); 837f0a74 (hot-table aging §22, icall megamorphic rule §23); d2639c00 (uop census kinds 10-17, tools/uop-census-diff.js, §23.7).
  - UNMERGED, NOT READY: branch `worktree-agent-aaa481e5bbddec58a`, commit ec2bf87c "uop retry ladder: icall-cut, halve-before-nocall, nocall keeps the head's call" (fix for §23.7 finding). Agent stopped mid-check: unit cases `movsd-nfs-record-loop` and `nobump-mark` in test/test-uop-compiler.js may fail under ladder mask 7 — verify against base first. A/B never run.
  - Scratch merge worktree: /private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/91494a3e-7dfa-4287-a899-2ef1bbca97bb/scratchpad/jig (detached, disposable).
- Owned modified and untracked files: none in the main checkout. (Dirty hunks in 07d/07e/test-uop-compiler/worker-imports/01-header are another session's EMMS/APC work — NOT mine; I renumbered their EMMS from 07e kind 31 to kind 32 during the 6acc6543 merge, noted on the board.)
- What changed and what is verified: each merge built with tools/build.sh and passed the listed unit tests (test-uop-compiler, test-x86-ops, worker globals/imports, SEH tests, file-version-info, etc.).
- Tests, artifacts: icall census results in scratchpad/icall-results/ (h3/rodent diffs, raw census logs, handler-hist runs).
- Remaining failures and blockers: main's build trips the region-census gate on another session's test/test-menu-post-disabled-owner.js (d53b404c); flagged on board.
- Exact next step: resume ec2bf87c → check the two unit cases against base → A/B on a bench box (arms uop / uop+ladder / icall / icall+ladder × h3, rodent, sc, c3, diablo) + h3 census confirming head 0x4522f9 returns. Memory: project_uop_retry_ladder_wip.md.
- Local child PIDs, ports, browser/control sessions: none (dev server on 8080 stopped; all agents stopped/completed).
- Remote hosts, running jobs, resource claims: none held. The stopped retry-ladder agent may have left a dir on fast-near-9tb-1 (name like uop-ladder*); no lock is held by me.
- Safe stop/resume instructions: nothing running; resume only after ownership reconciliation.
- Released claims: all.
- Retained claims: none.
- Last updated (UTC): 2026-10-02
