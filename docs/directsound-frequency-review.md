# DirectSound playback-frequency state — 2026-09-22

The audit following volume/pan found the same lost-before-Play setter pattern
in SetFrequency. GetFrequency always returned the PCM format rate, even after
a successful rate change on a live voice.

The per-buffer auxiliary record now retains the selected rate at offset 24;
zero means the original PCM rate. `DxObject.misc2` remains the format rate.
Lazy voice creation opens at that original rate, then applies the selected
playback frequency before Play. Duplicate buffers inherit the selected rate
and can subsequently change it independently. Resetting to original passes
zero to the existing host setter, which resolves it against the voice format.

SetFrequency validates the legacy range 100..100000 Hz (or original=0), the
buffer type and CTRLFREQUENCY capability; primary buffers cannot set it.
GetFrequency rejects null output, wrong type and absent capability, and writes
through the guest-aware DWORD accessor. Rejected setters leave state and host
unchanged. These changes do not alter PCM bytes or GetFormat.

## Evidence and scope

`test/test-directsound-frequency.js` invokes real public dispatch and real
creation/duplication. Before the implementation it failed: GetFrequency
returned 22050 after SetFrequency(11025). It checks initial/current/original
rates, unchanged GetFormat, pre-Play behavior, exact host-open format and
frequency-before-play ordering, independent duplicates, live updates, boundary
values and failures, sparse cross-page output, output/stack sentinels,
stop/restart and slot reuse.

This is a state/ABI/host-boundary fix, not a full audio-conformance claim.
The host cursor continuity follow-up is now implemented and documented in
[directsound-rate-clock-review.md](directsound-rate-clock-review.md). Queued
browser audio still needs an audible/timing check, and frozen recording has
separate rate accounting. No native Win98 error-precedence capture was made here.
The device GetCaps frequency fields and primary GetFrequency behavior deserve
a separate native reference audit; this test does not establish every driver
capability or error combination.

Both methods already had calls/branches and were outside the straight-line
quiet inventory, so the **247 manual + 22 metadata** pin remains unchanged.

Validation passed against current source: frequency, volume/pan, buffer-format
and set-current-position runtime tests; fragment balance, handler ESP,
generated epilogues, logical-AND normalization, silent inventory, test tiers,
duplicate ratchet, dispatch freshness and whitespace checks. Duplicate census
remains 126 groups / 497 members. No full release build or browser capture was
performed in this slice.

## Official references

- [IDirectSoundBuffer::SetFrequency](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/mt708937(v=vs.85))
  documents the legacy range, unchanged format and primary-buffer restriction.
- [IDirectSoundBuffer::GetFrequency](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/mt708927(v=vs.85))
  retrieves playback frequency, not merely the creation format.
- [IDirectSoundBuffer8::SetFrequency](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee418143(v=vs.85))
  documents reset-to-original and warns some operating systems do not support
  rates above 100 kHz. The newer ceiling is not silently applied to this
  legacy interface.

Next: queued-source and frozen-recording rate timing; actual pan attenuation
law; primary device-wide mixer controls; shared PCM ownership for duplicates.
