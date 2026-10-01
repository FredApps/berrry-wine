# Wine / Ops

A local, read-only dashboard. Files remain the source of truth; no database,
generated project state, API keys, external requests, or new dependencies.

```sh
node ops/server.js
# http://127.0.0.1:8098
```

The UI polls every five seconds while visible. Reads are cached in memory;
restart to rebuild everything. The server binds only to loopback. It does not
launch agents, execute tests, edit tasks, or change the messageboard.

## Sources

| View | Source |
| --- | --- |
| Tasks | Existing root `TODOS.md` |
| Corpus | `test/candidate-corpus/manifest.json`, matching tasks and recorded runs |
| Candidate notes | Existing `docs/re-notes/<candidate-id>.md` or note paths named in the manifest |
| Activity | Latest 150 nonempty lines of append-only `messageboard.txt` |
| Agents | Project-scoped local Claude and Codex JSONL session logs, local process snapshots |
| Runs | `scratch/runs/<id>/result.json` and preserved `ops/runs/<id>/result.json` |

The dashboard does not treat manifest notes or smoke-test `READY` as evidence
of gameplay. Fixture **present** means the named executable files exist, not
that their checksums or behavior have been verified. Candidate IDs are exact;
they are not inferred from executable basenames.

## Tasks: use the existing Markdown file

Legacy level-two sections remain visible with **unknown** status. We do not
guess whether historical prose describes work that is still open. Add ordinary
checkboxes when recording current tasks:

```markdown
## Current work

- [~] Fix resumable SEH
  id: T-0142
  candidate: serious-sam-demo
  owner: claude:YOUR_SESSION_ID
  started: 2026-10-01T14:00:00Z
  progress: 2026-10-01T14:25:00Z
  Next: test handler resumption after the guest commits the page.

- [ ] Verify gameplay and capture a screenshot
  id: T-0143
  candidate: serious-sam-demo
```

`[ ]` = ready, `[~]` = active, `[!]` = blocked, `[x]` = done. An optional
`status: backlog|ready|active|blocked|review|done` overrides the checkbox.
Candidate IDs can occur anywhere in the item, so one task can link several
candidates. Prefer explicit IDs and use the full provider-prefixed session ID
shown in agent details for `owner:`. Session ownership is advisory. Continue
using the existing messageboard protocol to coordinate edits.

`started:` and `progress:` are explicit task timestamps, never inferred from
token counts or tool activity. Without them, the corresponding clocks show
unknown. Historical sections without checkboxes are navigation into the source,
not automatically actionable tasks.

## Runs: one folder per execution

Create a folder such as `scratch/runs/R-0085/` with a `result.json` and its
outputs. `scratch/` is already gitignored. This is a file convention, not a new
capture API: use your existing shell, browser-control, and test tools.

### Agent capture workflow

1. Choose the exact `candidateId` from `test/candidate-corpus/manifest.json`.
   App registry IDs and EXE basenames are not necessarily candidate IDs. If the
   app has no manifest entry, keep the evidence in your existing investigation
   notes until it is registered; do not attach it to an unrelated candidate.
2. Make a unique run folder: use a UTC timestamp, candidate ID, and a short
   agent/session suffix, for example
   `scratch/runs/20261001T153012Z-serious-sam-demo-agent7-before/`.
   Each execution owns its own folder; never overwrite another run.
3. Reproduce or test using the existing tools. CLI `test/run.js --png=PATH`
   writes a headless capture. For an already-controlled browser session,
   `node tools/ctl.js -s SESSION_ID png PATH` captures that session. Existing
   browser tests may already save the required PNGs and logs: copy those files
   into the run folder instead of rerunning solely to change their location.
   Record the original execution time and command, not the copy time.
4. Save the screenshots and relevant output first. Use ordinary files inside
   the run folder, not symlinks to temporary or remote artifacts. Remote workers
   should copy the completed bundle into the checkout served by the dashboard;
   it cannot discover files on another machine or in another worktree.
5. Write `result.json` with the tested route/checkpoint (`startup`, `main-menu`,
   `gameplay`, or a specific reproduction), command, outcome, and environment.
   Record the actual loaded build: a browser may still run an older module than
   the current local build file. Include commit, dirty-patch/module hashes when
   known, and relevant browser/engine versions, renderer, thread mode, viewport,
   or input sequence. Use `null` or an explicit `unknown` for unavailable values;
   never substitute current HEAD for an unverified build identity.
6. Publish the metadata last: write `result.json.tmp` and rename it to
   `result.json` within the folder after artifact writes/copies finish. The
   dashboard ignores the temporary filename and discovers the run on refresh.
7. Inspect the image and supporting results before setting `verification` to
   `reviewed`. A successful capture or normal exit alone does not prove the menu,
   gameplay, audio, or input works. State exactly what passed in `summary`.
   Record failures too; omit a screenshot field if capture failed and explain
   why. Preserve useful failure logs.
8. For a visual fix, keep separate before/after runs with matching candidate,
   route, renderer, and environment. Reference their IDs in `TODOS.md` or the
   app's investigation notes and append a messageboard update with their paths.
   Explain any missing baseline or comparison mismatch.

```text
scratch/runs/<unique-id>/
  screen.png       # capture from this execution, if available
  output.log       # relevant test/run output
  result.json      # published last; dashboard entry point
```

No new task runner or provider-specific integration is needed. Claude and Codex
follow the same convention. The dashboard reports malformed run records and
missing artifacts under source notices; check those if a capture does not appear.

### Result format

Example (replace with actual evidence; omit unavailable artifact paths):

```json
{
  "candidateId": "serious-sam-demo",
  "taskId": "T-0142",
  "agentId": "claude:YOUR_SESSION_ID",
  "startedAt": "2026-10-01T14:30:00Z",
  "finishedAt": "2026-10-01T14:31:00Z",
  "outcome": "failed",
  "route": "startup",
  "command": "the exact reproduction command",
  "build": {
    "commit": "git commit hash",
    "dirtyPatchSha256": "hash when the worktree is dirty",
    "wasmSha256": "tested module hash"
  },
  "environment": { "host": "local", "mode": "browser", "renderer": "OpenGL" },
  "summary": "Startup fault before the menu",
  "verification": "unreviewed",
  "screenshot": "screen.png",
  "artifacts": ["output.log", "trace.log"]
}
```

Required: `candidateId`, ISO `startedAt`, and `outcome` from `passed`, `failed`,
`timeout`, `harness-error`, `running`, or `unknown`. A pass applies only to the
recorded route. Set `verification` to `reviewed` after reviewing the evidence;
this is a recorded assertion, not independent dashboard validation.

Use `screenshots: ["menu.png", "gameplay.png"]` for multiple captures. Artifact
paths are relative to that run folder; PNG/JPEG/WebP/JSON/text/log files are
served. Escaping paths and symlinks outside the folder are rejected. A missing
artifact is reported, not silently treated as a successful capture.

### Visuals on Overview and Agents

Overview prioritizes agent activity and shows the newest visual run for each of
up to six candidates. Agent cards show one compact latest preview whose optional
`agentId` exactly matches the provider-prefixed Session
ID in agent details (for example `codex:<session-uuid>` or `claude:<session-uuid>`).
For a Claude subagent, use its displayed `claude:agent-...` identity. Runs without
an `agentId` still appear on Overview and Corpus; the dashboard does not guess
ownership from task titles or filenames. A capture can predate the current task.

Add `"diagrams": ["architecture.png", "render-flow.webp"]` to the same result
file for related diagrams exported as PNG/JPEG/WebP. These appear as diagrams in
visual previews and run details, and do not replace the candidate screenshot.
No new folder or command is needed. Save the images first, then update metadata.
Each preview uses the last image listed in the run (diagrams follow screenshots),
shows its age, and opens all run artifacts, original timestamps, and review status.
Run timestamps determine ordering; visual evidence does not imply agent health
or that the current build passes.

Promote a useful run by moving its whole folder to `ops/runs/<id>/` and committing
it. Keep large traces out of Git. Delete the scratch copy after promotion to
avoid displaying two copies. Cleaning scratch destroys unpreserved evidence.
Run folders are ordered by their explicit start timestamp, never file mtime.

## Claude and Codex observation

Agent cards display associated local PIDs. Agent details list PID, parent PID,
executable name, OS state, process age, and up to 40 host descendants. Read-only
`ps`/`lsof` observations refresh at most every ten seconds; no agent processes are
started, stopped, or signaled by this feature. Command arguments and environment
variables are not sent to the browser.

The default cards prioritize session title, recent/quiet/ended activity, PID,
and a small latest preview. Unknown task/progress clocks, model names, raw
session IDs, token/cache telemetry, child processes and evidence metadata live
in Details. A context estimate at 90% or more of the reported limit gets a
compact warning on the card. Duplicate logs for the same provider/session ID
produce one card, using the most recent activity. No-session-title fallback
uses the latest capture's candidate name, or “Untitled session”.

Codex association uses an exact open session-log path on a `codex` process.
Claude also uses `~/.claude/sessions/<pid>.json`, requiring its session ID,
provider executable, local PID domain, and process start time to match the live
process table (stale/reused PIDs are rejected). Claude subagent logs can link to
their parent session host, explicitly marked shared. Multiple sessions with the
same host PID are marked shared as well; descendants are host-level processes,
not proof of which task launched them. A stopped session may retain a live host.

Missing utilities, permissions, or timeouts produce **PID unavailable**; an
unmatched session shows **PID not matched**, never a guessed PID based on its
title or working directory. Process presence and OS sleep/runnable state do not
establish agent responsiveness or progress. This observes local processes only.

Defaults:

- Codex: `~/.codex/sessions/`, filtered by record `cwd` within this repository.
- Claude: `~/.claude/projects/<encoded-repository-path>/`, likewise filtered by
  `cwd`. Subagent log files keep separate identities.

Overrides and fixture support:

```sh
node ops/server.js --port=8099 --root=/path/to/repo
node ops/server.js --codex-root=/path/to/sessions --claude-root=/path/to/project-logs
node ops/server.js --no-agents
```

Provider logs are an evolving, best-effort input format, not a stable integration
API. No log files are modified or copied. New logs are discovered every 30s;
the 100 most recently modified files per provider are considered and the newest
40 matching project sessions are displayed. The reader scans at most 10,000 log
files per provider directory, at depth five. Use narrower source directories
when needed. Missing/unreadable sources produce visible notices.

For a large session, only the first 256 KiB and final 1 MiB are parsed. The UI
labels that coverage as partial. Incomplete JSONL records are ignored until a
later refresh. Unsupported records are ignored. Full prompts, tool arguments,
tool output, and reasoning are not sent to the dashboard API; only a short
session title and summarized measurements/activity are exposed.

- **Activity:** observed timestamp and last tool/message state. A log is not a
  process heartbeat. “Quiet” after 15 minutes means inspect the session, not
  that it is dead or stuck. Completed turns remain idle, even with a live PID.
- **Progress:** only the task's explicit `progress:` timestamp. Not tool calls.
- **Context estimate:** last reported request input, with its timestamp. Codex's
  reported model context limit is used when present; Claude's limit remains
  unknown. Input is not exact live occupancy. A compaction clears the estimate
  until a newer usage record arrives.
- **Tokens:** last-request input/output and, for Codex when reported, session
  total. Claude session totals remain unknown; summing sampled or repeated
  streaming records would miscount them.
- **Cache reuse:** cache-read tokens divided by total last-request input. Claude
  input includes uncached input + cache read + cache creation; Codex input
  already includes cached input. Cache writes are shown separately. Absent
  counters remain unknown, not zero.

Provider references: [OpenAI App Server](https://learn.chatgpt.com/docs/app-server)
documents lifecycle and usage events;
[Claude Code usage](https://code.claude.com/docs/en/costs) explains cache reads
and writes. This v1 observes local files rather than attaching to either runtime.

## Validation

```sh
node --test ops/ops.test.js
node ops/browser-test.js
```

The first command covers real file ingestion, provider differences, freshness,
partial records, HTTP boundaries, and artifact traversal. The second uses the
repository's existing Puppeteer installation for a small dashboard-only browser
test with synthetic sources; it never launches an emulator or reads your real
session logs. `CHROME` can point to a Chrome executable.
