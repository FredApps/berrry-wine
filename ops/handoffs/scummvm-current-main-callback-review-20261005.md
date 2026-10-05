# ScummVM audio reconciliation, 2026-10-05

Current main b9174bf00837e7fc544f5c3113864683c99aa0e8 contains the owner-safe callback delivery missing from the 2026-10-03 ScummVM run. The old observation of two undelivered CALLBACK_FUNCTION completions is real historical evidence, but it is no longer a description of the current source. No additional audio engine patch is justified before ordinary current-build validation.

## Source comparison

Old evidence: `scratch/scummvm-av-20261003/attempt2`, `source/FINDINGS.md`, and `docs/re-notes/scummvm-fotaq.md`. AudioContext ran at22050Hz while bytes stopped at44096, two callbacks stayed queued for20seconds and auxiliary audio thread stopped progressing. Exact SDL callback originalVA10012140 calls ReleaseSemaphore at1001215c for WOM_DONE. That differs from COMI's CALLBACK_NULL refill issue.

Current source, read from Git main rather than the older shared working files:

- `lib/host-audio.js:715–737,3581–3591`: each completion carries its actual immutable registration; function completions enqueue and wake the scheduler. Registration includes callback, instance and opening owner.
- `host.js:1595–1603` and `lib/guest-thread-host.js:754–755,788–789`: RPC slot identifies the actual opening Worker. Worker metadata publishes registration/generation; the page does not fabricate guest callback state.
- `host.js:1184–1248`: offers are resolved to the opening live link, validated against stream identity, deferred for suspension/in-flight execution and acknowledged before run eligibility changes. Accepted callback does not fake wait completion. The owner executes the real semaphore release.
- `host.js:4627,5947` and `lib/host-imports.js:3716–3717`: both Worker and cooperative scheduler boundaries pump device completions and await queued callback offers. Thus the missing Worker pump from the old finding is now present.
- `lib/guest-worker.js:385–439`: per-owner generation metadata, repeated-token deduplication, stale/cancelled/expired rejection and fault handling precede actual owning `fire_wave_out_callback_bound` admission. No page-shadow callback execution.
- `src/13-exports.wat:3182–3243`: only running/plain-wait states admitted with valid EIP/ESP; nested callbacks refused. Original wait fields and yield state are saved/restored. `src/09b-dispatch.wat:1397–1410` restores at the real return thunk; stale MM resume yield is cleared within wave restoration.

The original ScummVM auxiliary wait1 falls within the supported wait class. Integrated Tile actual Worker/WAT tests and ordinary gameplay exercised the same callback→ReleaseSemaphore mechanism. Their evidence is recorded in `ops/handoffs/tworld-wave-callback-integration-20261005.md`; this audit did not rerun them. Current test-wave-callback-wait source explicitly checks real callback, EIP/ESP/TLS/wait restoration and rejects yields2/5/7/13. Queue/owner/scheduler tests cover ownership and acceptance. Source hashes are in `scratch/scummvm-av-20261003/current-main-review/source.json`.

Known limits remain: cross-owner close can retain opener-side metadata until its own close/stop, while retired host registrations reject new offers; CLI auxiliary-thread callback transport is outside the browser qualification. Neither establishes a current ScummVM browser failure. No concrete remaining source blocker was identified for its previously observed plain semaphore wait.

## Minimal next validation

One serialized ordinary current-main browser launch of registered `scummvm_fotaq`, original SDL and Queen files, default Worker/options, exact full-build source/module closure. No forced callbacks, cooperative workaround or private Worker modification. Capture existing read-only JS voice/queue/registration and auxiliary-thread state at readiness and approximately1,5,10seconds: bytes must advance past44096, completion queue must drain rather than stay at2, and real audio-thread slices must advance. Retain per-stream generation and owner-link identity plus any busy/fault status; do not require queue zero at every instant.

If fresh queued audio is available, reuse the reviewed COMI process-and-sink-attributed12second monitor recorder automatically before intro audio drains. Preserve initial/timed scene screenshots for retrospective review and original WAV. PCM presence and queue advancement establish transport progress only; user listening establishes perceived quality. If it remains stalled, stop with exact owner/queue/status snapshots before proposing a patch. No runtime or build was performed for this review.

Fullscreen remains separate and unresolved. Registry `lib/apps.js:2519–2531` still passes only `-pC:\\games\\FOTAQ_Floppy queen`, no `-f`; matching old default is windowed. The earlier Alt+Enter failure and hidden browser-fullscreen control do not identify a callback defect. Do not combine fullscreen input with the first audio validation or call shell zoom/browser consent a guest fullscreen repair. Floppy edition does not imply total silence.
