# Dashboard gaps — implementation (CLAUDE-DASHBOARD-GAPS-20261005)

Claude worker under claude:1863d2b5 · 2026-10-05 · branch `claude/dashboard-gaps-20261005`
off origin/main `dd0dd740`, own worktree. Not pushed (no push rights); SHAs below are for
ops-dashboard to integrate. No shared-tree or review-branch edits, no main merge, live
8098/8099 servers untouched (one read-only `GET /api/state`; test servers ran on 8197).

## Audit: what already worked (origin/main dd0dd740, live state 2026-10-05 01:20Z)

Source `[SRC]` and one read-only `/api/state` `[API]` (4.3 MB, 12 agents, 333 runs). No browser pass.

| Area | Already present | Gap |
|---|---|---|
| Release readiness | `release-readiness.js` derives per-game status + six gates (gameplay, input, correctness, performance, distribution, package), blockers, production membership from a hash-verified snapshot. Corpus has release filter chips and per-candidate gate detail. `[SRC]` | No single "what is left per unreleased game" list; gates visible only one candidate at a time. Stale reviews said only `reviewStale: true`, not why. `[API]` 103 unreleased games, 62 with reviewed gameplay, 0 ready, 4 recorded reviews all stale (source hashes no longer match). |
| FPS labels | `corpusFps` keeps metric-specific labels (logical gameplay frames/s, guest Flip events/s, guest presentation events/s); readers reject unqualified counters. `[SRC]` | Not shown next to release gates. `[API]` 4 unreleased games have a reviewed logical-frame rate; 1 has only an unreviewed historical Flip-event rate. |
| Sound evidence | none | No gate and no `result.json` field records audio (census of 341 result.json files: no audio key). Shown as "not recorded". |
| Launch | `emulator-server.js` catalog: per-app route, availability, `missingPaths`; corpus card + detail show Launch / Launch unavailable with reason and missing files (detail only). `[SRC]` | No build identity at launch; served files are the live root tree. |
| Commit visibility | Activity shows commits (subject, author, hash, GitHub link) `[SRC activity.js]` | No main/branch/pushed/deployed state. |
| Agents | Overview + Agents cards, `agentSignal` attention ranking; subagent rows exist only on `origin/ops/subagent-summaries-20261004` (63a248a6), not on main. `[SRC]` | Two-column grid (`style.css .agent-list`), multi-row cards. |
| Blockers | Shared `blocker-model.js` kinds (Dependency / Review blocked / Capacity needed / Needs follow-up), Telegram `/blockers` uses it. `[SRC]` | No "needs user input" vs "agent-resolvable" split. |
| Perf comparison | Per-run perf samples only. | No before/after comparison. |

## Commits

### 1. Ready for desktop view (DASH-GAPS-READY-DESKTOP)

- New nav view **Ready for desktop** (`#release`): one row per unreleased game (verified
  membership `no`); reviewed gameplay screenshot (opens the run), recorded rate with its metric
  label + reviewed/unreviewed + qualification state, or **Rate unknown — no measurement
  recorded**; input gate; **Sound not recorded**; gameplay-run build (`rev · dirty · wasm`, each
  "not recorded" when absent — current data has wasm only); ✓/✕/? gate chips; every unmet gate
  with status, summary and source; recorded blockers; why a recorded review is not current;
  next step; existing Launch actions and Details. Filters: all / reviewed gameplay / no blockers /
  ready. Sort: ready, reviewed gameplay, fewest blockers, fewest unmet gates.
- `release-readiness.js`: adds `staleReasons` (no reviewer, no date, basedOnRunKey not a reviewed
  gameplay run, newer failed gameplay, source hashes changed). Status logic unchanged.
- Logic in new UMD `ops/release-model.js` (served, loaded before app.js); a stale review's old gate
  summary is shown as "it said: …", never as a pass.
- Tests: new `ops/release-model.test.js` (6): unreleased-only + unknown rate, Flip-event rate never
  labelled frames/FPS, stale reasons, build identity never invented, rendered view escaping/unmet
  gates/launch states/filter (app.js executed in a vm with an inert DOM), script served.
- Real data via own server (8197): 103 unreleased, 62 with reviewed gameplay, 4 reviewed logical
  rates (cave-story 24.9, icy-tower 50.0, moorhuhn-2 8.0, moorhuhn-winter 36.4), gta2-demo
  29.9 guest Flip events/s (unreviewed); 4 stale reviews, reason: source hashes changed.

### 2. Exact-build Play (DASH-GAPS-PLAY-BUILD)

- `emulator-server.js`: `getBuildIdentity(root)` — SHA-256 of the served `build/wine-assembly.wasm`
  (cached by size+mtime), `git rev-parse HEAD`, tracked dirty-file count; `null` when git or the
  module is unavailable, never a guess. Exposed as `emulatorBuild` in `/api/state`.
- Available launch URLs gain `&build=<wasm sha256>`; the emulator index refuses with 409
  "Served build changed since the dashboard snapshot: link expects wasm X, now Y" if the module
  changed. The unavailable-app 409 now lists the missing files.
- UI: corpus launch bar states the served build once; candidate details and Ready rows show a build
  chip; unavailable routes list up to three missing files on the card (+N more → Details, full list
  open there); Ready rows say whether the served wasm matches the reviewed gameplay run's wasm.
- Tests: `emulator-server.test.js` +1 (identity without git / clean / dirty, pinned URL, 200 when
  equal, 409 after rebuild, 409 with missing paths); `release-model.test.js` +1 (served build text,
  match/differs/unknown, rendered chip, missing files on row, compact corpus cards).
- Real tree (own server 8197): rev 16f764ad, dirty (196 tracked files), wasm f40d4ca33822; pinned
  nfs2_demo link 200, wrong pin 409, snood 409 listing its two missing files.

### 3a. Cherry-pick of 63a248a6 (dependency)

`255aeab6` = `git cherry-pick -x 63a248a6` ("Show subagent summaries on parent dashboard cards",
author Codex, from `origin/ops/subagent-summaries-20261004`, which ops-dashboard is integrating).
Patch identical (4 files, +48/−2); the only conflict was both sides appending to the end of
`style.css`, resolved by keeping both blocks. Integrate in order, or drop together with commit 3.

### 3. Agents: one column, two lines (DASH-GAPS-AGENTS-2LINE) — depends on 3a

- `.agent-list` is one full-width column everywhere. `agentCard` is now a two-line row: line 1
  provider · short id · name · status word · `active Nm ago` (titled "activity is not proof of
  progress") · Terminal · ▸; line 2 decision reason / `Next:` / `Latest:` / "No result or next step
  recorded". Subagents: same two lines nested under the parent, three visible + "Show N more".
  Process, previews, token/timestamp meta and the old subagent block stay in the agent detail
  (which also gains Latest result and Parent session fields).
- Names: task title, else the task ID in the session prompt (`task CLAUDE-…`), else the title.
- A current subagent pulls its parent row in; parents are never duplicated; search matches children.
- Tests: new `ops/agents-view.test.js` (2): exactly 2 lines per agent and per subagent, nesting,
  collapse after 3, escaping, quiet-session wording, no process/preview/meta rows, single-column CSS,
  overview parent pull-in, search on children. Shared vm harness moved to `ops/test-app-vm.js`.
- Live state rendered through the new view (no browser): 3 top-level rows (Codex coordinator with
  3 children, Claude coordinator with 6, one history) — every row two lines.

### 4. Blockers: needs your input vs agent-resolvable (DASH-GAPS-BLOCKERS-SPLIT)

- `blocker-model.js` `actor(snapshot, task)` → `['user'|'agent', basis]` from recorded fields only
  (rule order in ops/README.md "Blockers and decisions"); `split()`; `blockerSummary()` adds
  `needsUser` / `agentResolvable` over primary roots (existing ordering kept).
- Web Blockers: "Needs your input" (live approvals + user roots) then "Agent-resolvable"; every
  blocker row (also Overview's Needs attention) carries a badge and its basis line.
- Telegram `/blockers`: second header line `N need your input · M agent-resolvable`, `NEEDS YOUR
  INPUT` / `AGENT-RESOLVABLE` groups, `Who:` basis per task; existing lines unchanged.
- Tests: `blocker-model.test.js` +1 (7 classification cases, groups, and web↔Telegram parity: same
  task IDs in the same groups and order, same counts); existing empty-summary expectation extended
  with the two new keys; `telegram.test.js` /blockers case asserts the groups and `Who:` line.
- Live state: needs input = RESOURCE-RECONCILE-REMOTE (existing "Capacity needed" rule: hosts),
  MIG-SAM-REP-RESTART (automated review); agent-resolvable = the two GAMEPLAY-* tasks
  ("no user decision").

## Tests

`node --test ops/<file>.test.js` per file in the worktree (node_modules symlinked from the shared
checkout, untracked): all pass except `terminal.test.js` 2 browser cases — `Browser was not found
at the configured executablePath (/Applications/Google Chrome.app/…)`, a macOS-only Chrome path,
pre-existing and unrelated.

## Remaining gaps

Filled in as later commits land.
