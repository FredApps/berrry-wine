# COMI independent timer policy regression

Source base536729ab15e77dd15f6bee5a0d94892cb91173f7 already implements independent winmm timer threads. Existing test-mm-timer-thread covers actual dispatch, callback argument/stack state, main-path suppression and next deadline; test-mm-timer-callback/context cover parked return/context safety. No scheduler or audio engine change needed.

The existing browser test did not assert independent-thread default or propagation into the process-wide mode setter. Added actual WineAssembly constructor assertion, execution of the exact browser-shell policy block and host pre-Worker boot block, with a setter spy. Actual COMI registry/default enables, explicit app opt-out disables, and query override works both ways. Source extraction requires unique anchors and executes original expressions rather than copied policy. It does not exercise real Worker timing or compile WASM.

Pure JS existing suite passes. Before-control restoring old constructor defaultfalse fails specifically at the new constructor assertion; original host restored byte-for-byte. Dependencies inspected: fs/path/assert/vm, registry, browser cache-list parser; no Worker/browser/compiler started. Existing test-tier membership unchanged.

Evidence motivating protection: matched-main/comparison.json under scratch/comi-audio-investigation-20261003 records identical-source mm-thread0/1 causal arms. Current-default ordinary capture already retained7–8 queued sources with zero sampled stream-start rebase over10.0078audio seconds. This regression prevents policy rollback; it does not prove audible quality, remove natural silence, or require repeating Telegram470. User listening review remains pending.
