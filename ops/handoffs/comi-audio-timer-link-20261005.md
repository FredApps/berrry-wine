# COMI audio service timer linkage

Source-only continuation of the owning-clock result (published aba6a08d). Exact COMI.EXE SHA256 b55524231edacc7d184c22c762d25193d616adc55d0141785fb21b8890d352b9. No new runtime claim.

41b7f0 calls43f160 with callback41b810, period20, flags1, user0.41b810 tail-jumps through4d47d8. That address is descriptor4d47c0+18, populated with424ce0 by424c60. The previous live capture proved descriptor pointer46196c=4d47c0 and period48e7fc=20000; it did not capture callback field or registered timer slots.

43f160 scans19 records of32bytes beginning4ca8b8. Fields callback+0, period+4, flags+8, user+12 and accumulated counters.43f2f0 initializes the timer subsystem;43f387 requests timeSetEvent interval25, callback43f3d0, periodic flag1.43f3d0 calls43f440, which walks the registered guest records, adds the25ms system period and repeatedly invokes applicable periodic callbacks while accumulated time meets their period.41c560 calls the20ms registration wrapper. Actual live execution of that registration remains to be confirmed.

This gives a concrete reason the original can expect audio servicing more often than the observed roughly84ms frame wait: a separate20ms service callback leads424ce0→4224d0→423430→425030. The mixer has paired refill calls around its work; the alternating toggle alone does not prove half-rate servicing. No timer-delivery defect is established solely by this static chain.

Next diagnostic: scratch/comi-audio-investigation-20261003/timer-poll/PLAN.md. Read the guest timer table and dispatcher counters alongside emulator MM_TIMER_TABLE, actual frequency word and frame target/elapsed. Preserve the16 nonpark stack-read errors from the prior run. The observed frequency must replace the conditional static1000Hz assumption before computing an exact live target. In MM_TIMER_TABLE offset16 is last-consumed tick, not deadline.

The normal baseline uses canonical f40 and old Worker3665f7c9, explicitly separate from newer main MM-timer-thread changes. No patch to parking, buffers, or Heroes code is proposed. A private latest-main existing-option comparison is conditional on actual live linkage proof and a separate serialized grant.

## Live proof, 08:00 UTC

`scratch/comi-audio-investigation-20261003/timer-poll/attempt1/analysis.json` and `receipt.json` preserve session24956 (exit0, closed08:00:51.170Z, no cleanup errors). Personally reviewed before-observer.png active ship-hold scene before ordinary manual arm. No trace flags or timer option changes. Every expected served source matched; optional build-info.js404 is not a source mismatch. Canonical module f40 / original Worker3665; private instrumented Worker512f51cc. Origin/main recorded cc2dd28a is **not** the served Worker implementation.

All64 snapshots contain valid timer groups, spanning1517.5ms until cap.16 nonpark candidate-return errors remain verbatim; these do not discard independent timer groups. Actual frequency1000, target5 and elapsed work0 in all records now confirm the approximately84ms integer clock wait. Guest slot0 is41b810/period20/flags1, descriptor callback424ce0; emulator MM slot0 is id1/period25/callback43f3d0. The static link is therefore live.

Dispatcher counter498→514:16 callbacks. Guest accumulated timer progress increases400ms while the sampled wall interval is1517.5ms. First callback change appears at84.85ms, then175.77ms; repeated parked rows preserve unchanged counters even when the MM timer is overdue. MM last-consumed tick44166→45616 advances by skipped periods, while guest dispatcher receives only one25ms credit per actual callback. This directly localizes under-servicing of the game's timer dispatcher in this old runtime; it does not establish behavior of latest-main MM-timer-thread execution.

Accompanying5sec audio capture:71 writes, first-to-last PCM3.250794seconds against4.876190audio-clock seconds, stream rebase1.625397seconds. Snapshot reads add observer cost, so these are diagnostic measurements, not pristine performance or sound acceptance. The inherited audio observer's endReason label says10sec-limit although the actual window is5000.09ms; raw preserved.

Next bounded experiment: private latest-main exact source/module closure with its existing mmTimerThread option, compare default/option only after checking actual current app configuration and owner routing. Use the same normal scene and timer/audio fields, match phases, and verify callback state/queue validity. No parking suppression, buffer enlargement, timer catchup rewrite, or Heroes investigation is justified by this result. New module/source identities must remain separate from this old-runtime control.

## Matched private latest-main comparison, 08:17 UTC

Both arms use exact cc2dd28aa9e82506361aeb6891c34fafaea59d45 source and private production WASM fa14fcc62d0c4dd8ca31f851c511a07d7196cd75d5c9938fa5caea64688f24f1 (1,659,685bytes). No test exports or engine delta. Existing host URL selection `mm-thread=0/1` sets the same mmTimerThread property used by the app option. Same ship-hold scene and ordinary click/manual image readiness, but animation/dialog phase and pre-arm elapsed time differ. Both expected served source sets matched exactly. Private owning observer is separately pinned. Shared canonical f40 untouched.

| Arm | Dispatcher count / sampled time | PCM / AudioContext time, first–last write | Stream rebase |
|---|---|---|---|
| Explicit0, session90155 |16 /1506.585ms |3.204354s /4.899410s |1.695057s |
| Explicit1, session93122 |59 /1480.070ms |3.947392s /3.947392s |0s |

Treatment reaches256-event cap at about4sec; baseline captures5sec. Preserve that difference. An equal3000ms interval `(first write, first write+3000ms]`, excluding the anchor write, yields baseline42 writes/172032bytes/1.950476sPCM versus treatment64/262144/2.972154sPCM. At last write within this interval rebases are1.033288s versus0. One chunk is46.44ms, so near3sec submitted PCM is the expected bounded-buffer result. Treatment has the auxiliary timer thread; baseline has only main thread. Timer groups are valid in both; nonpark return interpretation errors are retained.

Artifacts: `scratch/comi-audio-investigation-20261003/matched-main/comparison.json`, each arm's raw observations/served files/receipt/cleanup. Source compiler completed cleanly; no canonical build modified. Both browsers/servers closed cleanly, final93122 at08:17:21.832Z; Jig received direct release. Preserved setup failures: missing private fixture link before browser, then legacy audio observer assuming numeric scheduled-header value. New source stores a submission object; passive observer now projects waveHdrGA, tested with an actual-source expression and circular owner record. Neither failure is a guest failure.

Default change2745e045 was published during this comparison. Source review confirms host defaulttrue, browser shell `app.mmTimerThread !== false`, and installed programs inherit true unless explicitly opted out. COMI has no false override. This selects the same true mode as our explicit1 arm, but a current-default binary/browser run has not been performed. No redundant COMI registry flag or scheduler patch is needed. A short current-default audible recording/playback qualification remains: PCM queue continuity alone does not prove perceptual audio quality. No audible recording was collected in this pair. No Heroes source/timing changes were made.
