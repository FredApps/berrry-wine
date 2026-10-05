# Reviewed main integration

Review date: 2026-10-05 UTC. Base: `dd0dd740`.

Integrated scoped box commits for installed-game shortcuts, parent-agent worker summaries, Runenlegen window geometry, Diablo range loading and download recovery, I/O tracing, and associated investigation/design handoffs.

Review fixes: concurrent failed readers now all receive Retry/Quit; stopping an instance resolves pending download decisions and removes its dialog. Download text no longer claims that the entire game clock is paused.

Validation on the isolated integration checkout:

- Full WASM build and build gates passed.
- All 177 ops tests passed.
- Dashboard browser suite passed: navigation, evidence, task creation/edit conflicts, discussion, pickup, reorder/defer, mobile layout, and live refresh.
- Installed-shortcuts unit and browser persistence/removal checks passed.
- Download controller, preload, lazy VFS, nested parked reads, range census, asset cancellation, launch progress, and deployment asset checks passed.
- Geometry/minmax, client roundtrip, child controls, window-position callbacks, and parked-host lifecycle checks passed.
- Diablo browser route reached gameplay with HTTP 503 injection and visible Retry recovery. Screenshots were visually inspected for the recovery dialog and Tristram gameplay. Final-state rerun uses `/private/tmp/ops-diablo-final-main`.

Deferred: Heroes II short-park timing change `fa639845` remains on its source branch. Its integration cherry-pick was explicitly reverted pending resolution of the recorded idle-map anomaly. Unreviewed runtime experiments remain in the source checkpoint branches; they were not blanket-merged.

Source preservation: `checkpoint/box-source-20261005` (`a9c8df90`) and `checkpoint/local-before-box-sync-20261005` (`fe92af9a`). Both were pushed before integration. Asset/build/scratch files are not Git synchronization evidence.

This integration updates repository main; it does not deploy the public desktop or overwrite the live box's dirty checkout. Range loading does not promise a persistent cache or freeze all game clocks/audio.
