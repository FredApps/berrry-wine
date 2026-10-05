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

## Tests

`node --test ops/<file>.test.js` per file in the worktree (node_modules symlinked from the shared
checkout, untracked): all pass except `terminal.test.js` 2 browser cases — `Browser was not found
at the configured executablePath (/Applications/Google Chrome.app/…)`, a macOS-only Chrome path,
pre-existing and unrelated.

## Remaining gaps

Filled in as later commits land.
