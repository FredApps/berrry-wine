# COMI phase 1: main thread repeatedly clock-parks between refill bursts

Observed 2026-10-05 07:16Z by /root/corpus_categories. This is a normal-execution diagnostic with passive page slice/audio observers, no instruction tracing, guest writes, backend changes or engine patch.

Actual run: `scratch/comi-audio-investigation-20261003/mixer-timing/attempt1/`. Browser session52611 exited0, closed07:16:58.703Z, cleanup errors empty. Existing dashboard8098 stayed running; no server owned or restarted. Active hold scene personally reviewed before arming. Runtime used the existing shared-worktree build, **not newly fetched origin/main**. Origin6a92c113 was fetched/read for provenance; its winmm timer changes are absent from this captured Worker. Do not attribute results to those changes or apply them to Heroes.

Exact served identities: WASM `f40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063`; host `f2139768a057cb274df1104d0df1566d0da43ac70ca02279d46ed73a862d245f`; Worker `3665f7c9584aa472e340f4428ed8bb7408382b63abe916d6573e8a02182bd678`. Receipt records93 successful expected-source matches, no mismatches, transformed private HTML separately and optional build-info404. Raw served bytes and prelaunch pins retained. Actual callbacktype0, producer0; every observed slice mmTimer false.

## Observations

- Five-second audio capture:71 writes; between first and last writes,286720 bytes =3.250794 seconds PCM versus4.934240 audio-clock seconds. Stream origin rebased1.683447 seconds. Audio observer16.01ms total overhead, max poll gap11.355ms, errors empty. Streaming stereo16-bit22050Hz AudioContext running; no DirectSound ring path.
- Slice observer hit its fixed512-record cap after256 paired slices: only **298.405ms coverage**, not five seconds.241 slices ended yield14 at07500360 with spinOwedMs1;15 ended yield0 after100000blocks. Worker-reported wall duration totals23.155ms. Between completed slices and next requests totals264.44ms, maximum individual gap1.77ms. Observer0.22ms total overhead.
- Three non-clock-park bursts each contain five slices, lasting about5.2ms, starting89.86ms and89.13ms apart. These are partial-window observations, not a steady-state CPU profile or proof all mixing occurs there.

The host explicitly handles yield14 by clearing yield and scheduling at max(configured clock-park interval, spinOwedMs), host.js4736–4753 in this captured source. This establishes a useful causal boundary: the short capture spends most time repeatedly parking on a guest clock poll, rather than continuously executing a costly mixer. It does **not** prove the detector is wrong, identify the guest clock-call return site, or rule out costly work outside the sampled interval. Refilling one46.44ms chunk roughly every90ms is compatible with the starvation, but the function-level linkage remains to be measured.

## Next bounded proof

Prefer recording the actual owning clock-poll caller/return address and associated clock/deadline/loop state when yield14 is produced, using an existing non-destructive owner snapshot boundary. Also capture mixer service424ce0 registration/entry cadence. Do not infer DLL mapping from07500360 alone. No phase2 tracing or park-disable experiment was run or authorized by this result. A park-duration patch, extra buffering, or speculative timer callback change is not supported yet.

The scratch copied audio observer retains stale endReason text `10sec-limit`; actual timer is5000ms and timestamps show5000.085ms. Raw evidence is unchanged; this is a label defect only. Slice snapshot end records retrieval time after the cap, so analysis uses first request through final paired settlement.

Reusable observer/tests: `tools/comi-slice-observer.js`, `tools/comi-slice-observer.test.js`; original Promise identity, receiver/arguments/results/throws/rejections, bounded cap, descriptor restoration and foreign replacement preservation tested. `tools/comi-analyze-phase1.js ATTEMPT_DIRECTORY` reproduces the reported summary. No test calls guest exports or mutates audio. No FPS, sound-quality requalification or fix claim.
