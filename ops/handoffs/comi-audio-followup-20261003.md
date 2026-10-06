# COMI streamed audio: refill delay remains after DONE

Current-source baseline and bounded follow-up are under `scratch/comi-audio-investigation-20261003/browser/`. Root/source build differences mean this is not a public-build reproduction. Baseline captured11.993s of actual server audio with no graph/playback changes; the remote speaker output remains unverified.

Follow-up `followup/attempt2/publication.json`, `timing-analysis.json`, `observer.json` and `validation.json` preserve exact timing and hashes. Session31214 exited0; browser closed22:52:31.653Z, process check clear. Attempt1's timer receiver binding error is preserved as a harness failure, not a game failure. No production source changed.

The existing profiling hook captured128 events in2.795805s before its cap.43 stream writes of4096 bytes each, callback type0 (NULL/polling), callback target0; profile producer threadId0 and only main thread observed. No CPU shadow-register getter or guest action was used. Browser write duration median0.155ms,max0.32ms.

For41 newly tracked headers whose DONE flags were later observed, first DONE observation was0–23.22ms after scheduled audio end, median11.61ms. These are audio-clock observations, not exact completion timestamps. Recorded last-INQUEUE/first-DONE brackets span5.5–49.99ms because unchanged10ms polls were not serialized. The next producer write follows the first DONE observation by median41.30ms,max92.31ms. That is a lower bound since actual completion; it is not proven reuse of the same header.

19 positive chunk-scheduling gaps total859.14ms. Significant delay remains after DONE is observable, so attributing all gaps to the host completion poll would be unsupported. The exact guest polling/main-loop bottleneck is not located. Next useful work is static examination of COMI's waveOut refill loop, followed only if needed by a narrow owning-CPU trace. No timer or callback repair is justified yet.

Observer overhead26.82ms total,max0.47ms;279 polls,max observed poll gap11.89ms. This is a diagnostic, not an uninstrumented timing benchmark. Source responses now include preflight vendor pins; transformed HTML and existing build-info404 remain explicit. No FPS or gameplay coverage claim was added.
