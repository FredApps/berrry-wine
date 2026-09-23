# DirectSound live rate-clock integration — 2026-09-22

The preceding WAT frequency-state fix exposed a separate host accounting bug:
the cursor was `elapsed * currentFrequency`, so SetFrequency retrospectively
changed how much audio had already played. A fake AudioContext regression
doubled frequency without advancing time and observed the cursor jump from
8819 to 17639 bytes.

`lib/host-audio.js` now integrates piecewise-constant playback rates. Each
changed clock retains its origin and rate boundaries with accumulated media
time. Guest clocks retain millisecond units; audio clocks use seconds. This
avoids rounding exact guest ticks through an early seconds conversion.

The shared calculation feeds snapshot cursors, queued-ring cursor estimates,
stream cursors, one-shot guest-clock completion and the future splice offset.
The AudioWorklet's published cursor remains authoritative when available.
Ordinary fixed-rate voices take the arithmetic path without creating history.
New Play clears history; changed splice/restart origins invalidate their old
clock, and stream reset clears it explicitly.

Device-latency and deadline-lag queries may refer to samples before the most
recent rate change, so simply rebasing a single start timestamp is insufficient.
History retains the current delay window plus one older accumulated anchor.
Changes at the same clock instant replace one boundary. Old boundaries are
pruned on the next rate change rather than accumulating for the lifetime of
a looping sound.

## Validation

`test/test-directsound-play-cursor.js` failed before the change at the immediate
8819 -> 17639 cursor jump. It now covers immediate continuity, two rate changes,
zero/100ms output latency, queries in an older still-in-flight segment,
headless one-shot completion, new Play, stream reset, and 1000 same-tick plus
1000 advancing-tick edits with bounded history. Existing latency and WAT
write-cursor checks remain intact.

Related checks: ring-refresh-seam (10), ring-queue, ring-wrap, AudioWorklet DSP
(30), worklet routing (36), and loop-refresh pass. The loop-refresh test has
concurrent worktree edits owned by another agent; it was run but not modified
or included in this commit.
waveOut audio/completion/reset and suspend-backlog (13 checks) also pass,
along with test-tier membership and whitespace validation.

## Limits / next work

- No real-device audio recording, native Win98 capture or performance number
  is claimed. This test verifies host clock accounting, not sample-perfect
  audible conformance across every backend.
- Existing queued source scheduling and waveOut completion deadlines were
  not redesigned. Changing frequency must eventually be checked against the
  actual samples and all pending sources, not just reported cursor position.
- The frozen-recording tap still has its own fixed-rate ring accounting;
  changes must flush the old-rate interval before retiming the tap. This is
  an identified follow-up, not covered by these cursor assertions.
- Dynamic increases of device latency after history pruning and backwards
  guest-clock jumps are not certified by this test.
- Correct centibel pan attenuation, primary device-wide mixer controls and
  shared PCM ownership for duplicate buffers remain open.

The broader `fable-review.md` goal is still open; this addresses another
stateful-looking implementation that returned plausible but wrong results.
