# Frozen DirectSound recording rate boundaries — 2026-09-22

The recording tap had independent fixed-rate accounting even after live cursor
integration was repaired. SetFrequency changed the voice metadata without
flushing the PCM recorded so far: the next flush could label old audio with
the new sample rate while still advancing at the old byte rate.

SetFrequency now flushes the old-rate interval before changing the voice rate,
then rebases the tap at the same guest tick with the new byte rate. Fractional
source progress is retained across edits; output is still aligned to complete
PCM frames. One-shot clipping remains against the source length.

An adjacent timestamp bug was exposed by testing a nonzero play offset:
the tap added the absolute source cursor to the recording start time, delaying
the first chunk by the initial offset. Chunk timestamps now subtract the source
base before converting the elapsed bytes to time.

## Evidence

`test/test-directsound-recording-frequency.js` uses the production host and a
headless PCM sink. Before the fix, SetFrequency produced zero chunks instead
of flushing the expected old-rate chunk. Now it verifies exact bytes, sample
rate and start time for frame-aligned changes, a nonzero source offset,
reset-to-original, stop, one-shot clipping, repeated fractional edits without
dropping complete frames, and 16-bit stereo frame alignment.

The focused test, existing cursor and loop-refresh tests, test-tier membership
and whitespace validation pass. The existing loop-refresh file contains
foreign worktree edits; it was executed but not modified or committed here.

This is PCM-tap boundary evidence, not an end-to-end encoded recording or
audible browser comparison. The sink describes whole PCM frames at a single
sample rate per chunk; exact timing of a rate switch partway through one frame
is not established here. Fractional progress is preserved, but sub-frame
timestamp precision still needs a reconstruction-level test.

Remaining audio work includes queued-source scheduling at rate changes,
centibel pan attenuation, primary device-wide mixing, and shared sample backing
for DuplicateSoundBuffer. Broader `fable-review.md` work remains open.
