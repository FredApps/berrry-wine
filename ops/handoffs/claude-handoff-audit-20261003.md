# CLAUDE-HANDOFF-AUDIT — 2026-10-03

Worker: claude:15bdfca1-abf3-4b95-af83-2ed1a7f2f92d (read-only; no builds, runs, code/ledger/STATUS edits).
Inputs: the five `ops/handoffs/claude-migration-*.md`, `ops/ORCHESTRATOR.md`, `ops/STATUS.md` (18:59Z),
`TODOS.md`, `ops/handoffs/migration-core-ready-20261003.md`, migrated memory under
`~/.claude/projects/-home-user-wine-assembly/memory/`, git objects/refs on this box.

## Headline

Custody is closed correctly: MIG-NFS2 and MIG-LEGACY (`TODOS.md:49-55`, `:166-174`) record all five handoffs
received and claims released. Both entries say "Unfinished engineering remains separately queued".
**For the Claude lanes, that is not true.** None of the open follow-ups below has a task ID in `TODOS.md`.
The only Claude-lane subjects that appear are the generic GAMEPLAY-* coverage rows for SimCity 2000 and NFS II SE.
(MIG-LEGACY also has a stray duplicate `Evidence:` line at `TODOS.md:174`.)

## Per-lane reconciliation

| Lane | Claimed done, verified here | Open follow-up | Queued? |
|---|---|---|---|
| claude-icons 5e92d715 (NFS II SE install, desktop icons, IS3) | 82872fd6, 0dca52b9, dd530167, b6db60d2 are on main; release head d8661c82 exists on `origin/release/2026-10-01`. Deploy is claimed for 2026-10-02 but **not re-verified here** (the audit was not allowed to fetch it). | (a) a browser NFS II SE install showing the new icon/label was never verified; (b) IS3 copy dialog vanishes headless at batch ~360-420k, plus a 2px caption band and extra space under Cancel; (c) `test/test-sysmon-perfstats.js` fails with "guest heap is charted at all", and this predates the work; (d) **pending user decision**: should kept (OPFS) media record installer shortcuts? Do not start without a yes. | **No.** GAMEPLAY-need-for-speed-2-se-full (`TODOS.md:2081`) is a fixture-blocked gameplay row and does not cover (a)-(d). |
| sc2k-compare ac698f44 | 40c1c484 is on main. Its test file `test/test-invalidate-erase-children.js` exists. | Differences the user observed but never requested: the city menu bar shows only File/Help, budget dialog placement and sunken fields are wrong, and the Video Warning is missing a line. | No. These are optional. GAMEPLAY-simcity2000_demo/_net (`TODOS.md:2426-2448`) are separate coverage tasks. |
| uop-merge / wine-assembly-d0 91494a3e | The listed merges (e4cd5e5d, 6acc6543, e09a1c2d, 1e59412e, 837f0a74, d2639c00) are on main. | **Retry ladder ec2bf87c**: present only on `origin/worktree-agent-aaa481e5bbddec58a`, not on main. Two unit cases (`movsd-nfs-record-loop`, `nobump-mark` under ladder mask 7) are unchecked and the A/B was never run. | **No task.** It is recorded only in memory `project_uop_retry_ladder_wip.md`. |
| toyvm-uop 88bbcb9f | 604c71b9, b0f38372 and deddbe2b are on main (HEAD's ancestors). | **Correctness bug:** BRW DISAGREE under `jit-sepc` (`--region-jit-continuous`): 500918117/2fa3dd95 vs 500918116/a066bf27, plus an "only-naive" off-by-one. Perf work: inline region helpers, cheaper install gate. Missing x86-64 and V8/SpiderMonkey native captures (these are mandatory under CLAUDE.md's optimization-variant rule). | **No task.** The BRW bug is **not in memory either**: no memory file mentions jit-sepc/DISAGREE. It survives only in the handoff. |
| marketing 361d8f4f | No commits. `MARKETING.md`, `BERRRY-TODO.md` and `berrry-issues.md` are present on this box. | User decisions: the next "live now" post (recommended: StarCraft on phone), a copy pack, a German Moorhuhn repost. Uncommitted owned hunks: the `.gitignore` `BERRRY-TODO.md` line and `README.md:40` (js-dos row). Both files also carry other agents' hunks. External dependency: berrry events API, per BERRRY-TODO #1. | Correctly unqueued. This is a non-engineering lane, and memory `feedback_marketing_session_no_engineering.md` forbids engineering in it. The two uncommitted hunks have no owner now. |

## Stale blockers

- d0's handoff says main's build trips region-census on `test/test-menu-post-disabled-owner.js` (d53b404c), and memory `project_uop_retry_ladder_wip.md` repeats it. sc2k's handoff says the build fails on an unincluded `09a7h-video-mciavi.wat`. Both are dated 2026-10-02 or earlier, and later builds on this box (MIG-AUDIO-CAPS "isolated/full build PASS") suggest both are cleared. **Unverified here (no build allowed).** Treat both as stale until a build log says otherwise.
- `test-sysmon-perfstats` "predates" failure: no current pass/fail evidence either way.
- Automated-review rejections (MIG-SAM-REP-RESTART, `TODOS.md:223-232`) are out of scope. They were not retried.

## Local-only artifacts and obsolete paths

- **Mac paths that do not exist here:**
  - `/private/tmp/wa-release-20261001` (icons). The branch is on origin, so this is safe to drop.
  - `/private/tmp/claude-502/.../91494a3e.../scratchpad/jig` (d0 merge worktree, disposable).
  - The `scratchpad/icall-results/` census logs, `scratchpad/is3/stage2.sh` (the IS3 headless repro), the marketing `tw.py`, and `/Users/vg/Downloads/moorhuhn-18s.mp4`. All of these live in Mac session scratchpads. **The IS3 repro script and the icall census are the only copies cited by a next step, and they are not on this box** (no repo `scratchpad/`).
  - Memory still names `/private/tmp`: `project_int_expr_fusion.md:12`, `project_page_compile_verdict.md:12`, `project_civ2_campaign_paused.md:22` (already annotated to substitute `scratch/civ2-campaign`), and `project_screensaver_sweep.md`. The handoff's `~/.claude/projects/-Users-vg-...` transcript path (`TODOS.md:248-249`) is historical.
- **Remote, unreconciled:**
  - bx_xegf6upd (91.107.229.168): `~/toyvm-ab` is detached at deddbe2b, and its logs are `/home/user/sepc30.{txt,json}` and `sep30.*` on *that* box. They are not present on this box (`/home/user` glob: none). The host key was pinned only in a Mac scratchpad.
  - fast-near-9tb-1: a possible `uop-ladder*` directory.
  - Neither host appears as a resource in the TODOS ledger.
- `build/simcity2000-demo-wall.png`: an untracked build output, present.

## Recommended follow-up tasks (for Codex to create; not created here)

1. **TOYVM-REGION-JIT-BRW**: reproduce and fix BRW DISAGREE under `--region-jit-continuous` with `test/test-toyvm-region-live.js`. Add the finding to memory. Pull the sepc30 logs from bx_xegf6upd first.
2. **UOP-RETRY-LADDER**: rebase ec2bf87c, check the two unit cases against base, then run the A/B only on a quiet bench box.
3. **NFS2SE-INSTALL-ICON-VERIFY** (browser, one session): install NFS II SE and check the desktop icon. Also re-derive the IS3 copy-dialog repro, because the script is lost.
4. **SYSMON-PERFSTATS-TRIAGE**: get a current pass/fail on `test/test-sysmon-perfstats.js`.
5. **USER-DECISION: OPFS-SHORTCUTS**: blocked on the user. Record it as a waiting-on-user item so it stops living only in a handoff.
6. **RESOURCE-RECONCILE**: either archive or release bx_xegf6upd `~/toyvm-ab` and any fast-near-9tb-1 `uop-ladder*` directory, and assign an owner to the orphaned marketing `.gitignore`/`README.md:40` hunks.

Board note: this session could not append to `messageboard.txt` (shell redirection needed approval that was not granted). Its claim and release are therefore recorded in this file only.
