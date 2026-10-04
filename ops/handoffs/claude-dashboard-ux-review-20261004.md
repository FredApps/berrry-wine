# Dashboard UX review — compact proposal (CLAUDE-OPS-DASHBOARD-UX-REVIEW)

claude:1863d2b5 · 2026-10-04 · proposal only (ops/* is ops-dashboard's). Revised for the user's
"more brief design" request. Evidence: `[SRC]` ops source at origin/main eb6d4d61 + 63a248a6;
`[API]` one read-only GET `/api/state` (10:52Z, `scratch/claude-dashboard-ux-review-20261004/`).
**No browser pass yet** — layout claims are inferred from source until phase 2.

Wireframe values are placeholders, not measurements.

## Smallest coherent improvement (do first)
**Single full-width agent column, two lines per agent/subagent, details on demand.** Tasks and corpus rows
follow the same idea (`name · state · next` on one line); everything else moves behind a click (row expands in place,
URL updates). No new data or endpoints needed.

### Agents + subagents (63a248a6) — before `[SRC]`
```
┌ CLAUDE  [Running] ─────────────────────────────────────┐
│ Claude orchestrator: reconcile five handoffs…          │
│ Activity 2m ago · On task 14m · Progress 3m ago        │
│ ┌ Subagents (2) ─────────────────────────────────────┐ │
│ │ [Heroes II perf]                    [Running]      │ │
│ │ "I verified the assets and ran the first… (240ch)" │ │
│ │ Bash · Activity 1m ago                             │ │
│ │ ─────                                              │ │
│ │ [Progressive loading design]        [Running]      │ │
│ │ "…240 chars…"                                      │ │
│ │ Read · Activity 0m ago                             │ │
│ │ From observed session logs; activity is not proof… │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘   ~14 lines / agent
```
### After — user requirement (2026-10-04): one full-width column, two lines per subagent
```
CLAUDE 1863d2  Running · Coordinate Claude lanes: 5 handoffs reconciled, 9 tasks             ▸
               Next: hand runtime slot to Hype after Heroes II releases
  ↳ Heroes II performance · Running                                                         ▸
    Latest: assets verified; profiling adventure-map scroll
  ↳ Progressive game loading design · Running                                               ▸
    Latest: reading the VFS range-miss park path
CODEX 01a0ff   Awaiting approval · Coordinator                                    [Review]  ▸
               Next: approve or decline the pending command
```
Rules (replace the earlier open-ended card suggestions):
- **Layout:** `.agent-list` becomes one full-width column on Overview *and* Agents
  (today `grid-template-columns: repeat(2, …)`, `style.css:308-311`). Lines get the width.
- **Agent:** line 1 = provider · short id · status word · task title; line 2 = the one decision/next
  action (`agentSignal().reason` or task `next`). No meta row of three timestamps; one age, right-aligned.
- **Subagent:** exactly two lines — line 1 `↳ task/name · status`, line 2 `Latest:` clipped summary
  (or next action). No badge row, no operation/activity row, no per-child disclaimer
  (today three blocks per child + a disclaimer, `app.js subagentSummary` from 63a248a6).
- **Details on demand:** ▸ opens the existing agent detail (full summary, timestamps, tokens).
  Keep "Show N more subagents" collapse after 3.
- **Narrow screens:** lines wrap; nothing is hidden. Status stays a word (not only colour); the ▸ /
  [Review] controls stay ≥44px tall on touch.

Planned change for ops-dashboard (not applied by me; ops/* is theirs):
`style.css` `.agent-list{grid-template-columns:1fr}`, compact `.agent` padding; `app.js`
`agentCard` → two-line template; `subagentSummary` row → `<li><button data-agent>↳ title · status</button>
<p class="sub">Latest: …</p></li>`; move the "observed session logs" note to the section title
`title=`. Acceptance: Agents view with 4 agents + 6 subagents fits one 900px-tall desktop screen; each
subagent is exactly 2 rendered lines at ≥1000px width; ops tests for escaping/parent isolation still
pass; phone 390px shows the same content, wrapped.

### Tasks — after
```
ACTIVE   CLAUDE-HEROES2-PERFORMANCE   Heroes II slowness diagnosis    1863d2  next: profile map
BLOCKED  USER-DECISION-OPFS-SHORTCUTS keep installer icons?           user    needs: yes/no   [Reply]
REVIEW   …
```
### Corpus card — after (grid stays visual, text shrinks)
```
┌───────────────┐
│  [screenshot] │  Heroes II demo
│               │  ● reviewed · NN frames/s (logical, date)
└───────────────┘  ✓files ✓launch ✕perf-qual   [Launch ▸]
```
Title detail (on ▸ / own URL): identity strip
`cand heroes-2-demo ✓ │ build 16f764ad dirty ≠ reviewed │ task … │ main ✓ · not deployed`,
then screenshot, metric, gates, runs, commits — each a collapsed section.

## Issues → change → done when (priority order)
| # | Issue | Change | Done when |
|---|---|---|---|
| 1 | Verbose two-column agent cards; 3 blocks per subagent `[SRC]` | Single full-width column; agent and subagent = 2 lines each (above) | 4 agents + 6 subagents fit one 900px screen; subagent = 2 lines |
| 2 | No deep links; hash change resets filters; detail is an unrouted dialog `[SRC app.js:295,368]` | `#/title/ID`, `#/task/ID`, `#/corpus?cat=&release=&q=` | Reload/Back restore view, filters, open row |
| 3 | Launch shows no build; serves live working tree `[SRC emulator-server.js]` | Build chip `rev · dirty · wasm sha`; "≠ reviewed" marker; `&from=` back link | Chip on launch + title; mismatch visible before launch |
| 4 | 4.1 MB `/api/state` every 5 s `[API]` | ETag/304, pause when tab hidden, later split endpoints | Idle tab <100 KB/min |
| 5 | "Ready" = 0, 150 "review needed", gates only in detail `[API]` | Release queue: one row per unreleased game, ✓/✕ per gate, sort by fewest ✕ | "only perf missing" list in one screen |
| 6 | Commits lack branch/main/deploy state `[SRC activity.js:66]` | `main ✓ / branch / local` from fetched refs; link task IDs | Task row shows its commits + state |

## GitHub: what needs no new permission
Local git (no token): on-main/branch/local via `merge-base --is-ancestor` and `branch -r --contains`
on fetched refs, diffstat, task-ID links. Public REST unauthenticated `[DOC]`:
`GET /repos/{o}/{r}/commits/{sha}/pulls`, 60 req/h — on-demand detail only, cached. PR/check status at
scale or creating issues needs a GitHub App/fine-grained token server-side (user decision).

## Backlog
1 compact rows (#1) · 2 routes (#2) · 3 build chip (#3) · 4 ETag/hidden pause (#4) · 5 release queue (#5)
· 6 code state (#6) · later: launch-failure report back to the title, download state from
CLAUDE-PROGRESSIVE-GAME-LOADING-DESIGN.

## Phase 2 (after Heroes II and the Hype browser slot)
One Chrome session on 127.0.0.1:8098: desktop + phone screenshots of Agents, Tasks, Corpus, a title;
keyboard and Back checks; confirm or withdraw each `[SRC]` item; annotated before/after images here.
