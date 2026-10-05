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
