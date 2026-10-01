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
| Agents | Project-scoped local Claude and Codex JSONL session logs |
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
outputs. `scratch/` is already gitignored. Example (replace with actual evidence):

```json
{
  "candidateId": "serious-sam-demo",
  "taskId": "T-0142",
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

Promote a useful run by moving its whole folder to `ops/runs/<id>/` and committing
it. Keep large traces out of Git. Delete the scratch copy after promotion to
avoid displaying two copies. Cleaning scratch destroys unpreserved evidence.
Run folders are ordered by their explicit start timestamp, never file mtime.

## Claude and Codex observation

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
  that it is dead or stuck. Completed turns remain idle.
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
