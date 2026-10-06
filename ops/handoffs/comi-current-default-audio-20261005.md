# COMI current-default audio: 2026-10-05

The ordinary current-default ship-hold capture produced 12.0047 seconds of attributed nonzero audio. Across three snapshots spanning 9.999315 wall seconds, voice 720899 retained 8, 8, and 7 queued sources, about 0.31–0.35 seconds ahead. It submitted 880640 bytes (9.984580 seconds of stereo 16-bit 22050 Hz PCM), with no sampled stream-start clock rebase. The earlier starvation pattern was not observed in this short window. User listening review remains pending; this is not a claim that sound quality is fixed.

## Exact evidence

- Published diagnostic: `scratch/runs/20261005-comi-current-default-audio/result.json` (`outcome: unknown`, performance null; no new player-control qualification).
- Immutable ordinary capture: `scratch/comi-audio-investigation-20261003/current-default-playback/attempt2`.
- Durable metadata: `ops/release-evidence/comi-current-default-audio-20261005`.
- Source f5b222ee30695a1043e57ee7167bf002a020e5e4; full-gate private module 1a343c5f52ceb33db1603b6be9521800b66c64e43fb02c58ce1bf126ec594bdf (1666677 bytes). All 109 response records covering 93 source paths matched pins. Canonical shared WASM was unchanged.
- Actual default `mmTimerThread: true`, ordinary Worker; no Worker rewrite, timer override, guest callback, state injection or trace.
- Helper browser 9ae1163cbe632326f0deee93e7d2f0e42742aa3ec790f5f926eb3c767043235b. Sixteen focused source/recorder/readiness/scene tests passed before launch.
- Session 46715 exited 0; browser, server and recorder closed 14:18:01.912Z with errors[] and process check clear.

Original `audio.wav` SHA256 6aaac19f2d610826f6b6116facc9ab06c6e5f6172b7780214807e91e7c5111a9 is authoritative. Root's `audio-review.ogg` is a listening derivative, separately hashed in clip-provenance.json. Both pre/post attribution checks matched the launched Chrome process ancestry and actual SunshineSink index1. Recorder waited for child close/drained stdout, was uncapped, and returned no errors. Monitor PCM is stereo16/44100, 2117632 bytes, 0.846228% zero stereo frames, peak13090. Silence fraction includes natural pauses and does not measure perceived quality.

Startup and audio-2 screenshots were personally reviewed by corpus_categories; root also reviewed audio-2. Both show the ship hold, with dialogue animation progression. Early automatic capture required the actual scene template and fresh advancing voice bytes/clock, queued sources, and future scheduled audio. No manual-delay gap occurred.

## Preserved failed setup and limits

Attempt1 remains intact: operator delay moved recording to roughly 76 seconds after launch, after intro voice drained. The resulting all-zero recording lost post-attribution and is unqualified, not evidence of a current game regression. The corrected gate rejects historical bytes alone. It recorded attempt2 early and permitted retrospective scene review as authorized.

This is one 12-second intro observation, not a long-session guarantee, every-callback trace, FPS measurement, or matched old/new code comparison. Prior matched timer-option evidence remains separate. No app flag patch is needed because this source already defaults to the timer Worker. Next action: user listening review of the attributed clip; investigate only a concrete remaining audible symptom. No further runtime is reserved.
