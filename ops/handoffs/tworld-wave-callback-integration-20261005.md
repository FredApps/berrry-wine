# Tile World owning wave callback repair

The host marked two SDL wave headers DONE but left their function callbacks queued. SDL's audio thread waited on the callback-released semaphore while the main thread joined it. The ordinary intro-ms route stayed at the filename picker.

This change captures immutable callback registration on the actual opening interpreter, offers completions at owning scheduler boundaries, preserves callback caller TLS and parked wait state, and deduplicates uncertain Worker acknowledgements. Retired streams reject new offers. Queue removal is in place so closing another stream while an offer is awaiting cannot duplicate accepted completions. Suspended owners remain busy; an ambiguous main offer cannot consume a cached interrupted wait.

Private full-module candidate faa06e701111c00486fe6580b898cf1c0762c9e7a287dc05b2d837c3ad2f9ec2 reached Level1 through ordinary intro-ms selection. Right input collected chips6→5→3; Left reversed movement. Root reviewed after-enter/right2 and independent reviewer viewed all4 gameplay images. Immutable run: `scratch/runs/20261005-tworld-private-callback-gameplay` (160 hashed artifacts). No FPS, audio-quality, level-completion or public-release claim.

Validation on the frozen private baseline: real Worker/WAT completion queue→callback→ReleaseSemaphore→audio thread exit→main join passed; original queue control failed as expected. Lost-ack/close exactly-once and shadow isolation passed. A separate cross-stream close regression reproduced a duplicate queue entry before the in-place fix and passed afterward.

The scoped commit is rebased onto c003b59f. Main has synchronous DLL initialization, unlike the tested baseline's separately developed nested asynchronous loader. The callback guard therefore checks for the optional async transaction binding; synchronous main cannot dispatch another message inside that loader operation. Unrelated MM callback context, TrackMouseEvent, debugger, nested-loader and launch changes were not imported. Main's existing stop cleanup was preserved.

On this exact rebased tree, `test/test-wave-callback-{queue,owner,scheduler}.js` PASS and `node tools/test-tiers.js --check` PASS. The rebased real Worker/WAT suite and ordinary browser route remain required before production acceptance; prior private gameplay is not silently relabelled as main validation.

Known scope: cross-owner close retires host registration/queue but opener Worker metadata persists until its own close/stop. No new host offer can use a retired stream; previously accepted ambiguous tokens may still be queried. This metadata retention is disclosed, not an audible-output or broad CLI real-thread compatibility claim. The browser delivery path is the qualified private target.

Exact prior evidence: `scratch/new-game-tworld-20261004/repair/final-validation-20261005/receipt.json`, `candidate-gameplay-20261005.patch`, and `integration-readiness-20261005.json`. Shared source/canonical module were not modified during preparation.
