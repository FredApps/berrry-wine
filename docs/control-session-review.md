# Shared control-session lifecycle

Pass-5 #6 requires a shared control client, including reply routing and
pending-request teardown. The helper existed, but failure paths still had
several holes:

- A parsed `null` reply crashed on `reply.id`. The new test reproduces this
  crash against the old helper before any production test client is started.
- A command object's `id` could replace the generated wire ID, leaving its
  waiter registered under a different ID forever.
- Failed process spawning emitted an unhandled `error`; signal termination
  left `exitCode === null`, so later sends/quit could treat it as live.
- Cyclic JSON entered the pending map before serialization failed.
- Waiters were rejected at `exit`, before stdout necessarily finished draining.

The helper now validates decoded reply shape, owns wire IDs, serializes before
registering waiters, handles child/stdin errors, and rejects sends after normal
or signal exit. Completion and unresolved-request rejection use `close`, after
stdio drains. The public `exited` promise still resolves the exit code (null
for a signal); failed-spawn details are preserved in rejected sends.

Verification:

- `test-control-session.js` runs real tiny Node children: split replies, CRLF,
  ordinary logs, malformed/NULL JSON, caller-supplied ID, cyclic serialization,
  repeated quit, post-exit sends, two pending requests on nonzero exit, missing
  executable, signal termination, remote error, and a final 512-KiB reply.
- `test-control-stdin-frozen-cli.js` passes with the actual emulator: frozen
  stdin control pauses and steps exactly.
- Automatic tier placement and whitespace validation pass.

No emulator behavior changes. Callers still own deadlines and process cleanup;
this helper does not impose a new timeout, truncate captured output, support
arbitrary non-piped stdio, or guarantee completion when a child remains alive
without replying. This is lifecycle coverage, not a full gameplay/browser
sweep or closure of the wider review.
