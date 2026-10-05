# Dredmor startup asset loading

Implementation commits3e4cb3cf and its response-validation follow-up are based on main e227d71d in `scratch/wt-dredmor-lazy-20261005`. No canonical engine/WASM or shared dirty source changed. Generic schema semantics are documented in `docs/manifest-loading.md`.

The old local manifests had6269 release /6571 beta entries with only URL/path metadata, all awaited before launch. Adding httpRange alone would still perform a HEAD for every file. The new preparation policy emits stat size and loadMode; lazy mounts directly construct sized range providers, with no startup request. The first actual read checks Content-Range offsets/total and exact response length. Native modules/fonts stay required. Optional background mode is a distinct, capped8×64KiB serial prefix warmup after run, with lifetime cancellation and explicit deferred/error state. Both Dredmor trees choose lazy, not background.

Local ignored manifests regenerated with before snapshots in `scratch/dredmor-lazy-20261005/`: release6248lazy+21required, beta6553lazy+18required. Exact hashes/counts in manifest-receipt.json. Binary bytes unchanged and uncommitted. Generic preparation reproduces this metadata after checkout.

Validation:10 focused tests exercise actual host/provider/VFS/generator paths; six existing asset-cancellation tests pass; range-preload compatibility passes; existing lazy VFS suite49/49 including compiled I/O adapters passes. Tier and browser-cache gates pass.6000 sized files produce zero startup network requests; a guest VFS read fetches exactly one64KiB range. Unknown modes, unsafe sizes, stale response totals, conflicting declarations, lazy decode/preload combinations, required failures, cancellation, retry and background bounds are covered. Test scripts use the production source; no scratch permission environment required.

Prepared ordinary route helper: `scratch/dredmor-lazy-20261005/browser.js dungeons_of_dredmor_release attempt1 --slot-granted`, TTY,180sec. It needs a private current source module first (current WAT differs from prior COMI build in09a7/09a8); no runtime was launched before review. Records request methods/ranges/bytes, source identities, source copies, ordinary input, screenshots and cleanup. No hidden input/guest-state mutation. Runtime qualification remains pending; lazy mount tests alone do not prove Dredmor startup/gameplay or Steam behavior.

Source-only remaining corpus audit saved remaining-route-missing.json from live dashboard: Snood3; BGnoninteractive8; BGinteractive89; BGchapters1–2 55; WinampMOD1 =156 paths. These are current missing route declarations, not a reason to blindly repeat bulk transfer; acquisition/path owners retain those tasks.

## Ordinary release route, 10:29 UTC

Private production compile82126 passed: WASM3a65a4f1ab42aff76bc42aa9844bc31e8059f9328186c90762cd4bda4ecfdc7e,1,659,836bytes, source1878f5ca on e227. No canonical artifact changed; this was compiler validation, not a new full build-gate pass. Ordinary browser37713 exited0; browser/server closed10:30:32.737Z with no cleanup errors, direct slot handoff to Hype.

Immutable diagnostic `scratch/runs/20261005-dredmor-lazy-startup-pathappendw` contains18 files including requests, console, input, screenshots, source identities and hashes. Complete raw served copies remain in scratch/dredmor-lazy-20261005/attempt1. At1128ms the guest reports UNIMPLEMENTED API PathAppendW, then traps with block EIP4ccfe7. First5sec screenshot is already the returned desktop; no gameplay screenshot/control claim.

There were29 game-route requests,21 distinct required companion URLs,0HEAD,0range and0lazy-data requests, versus6269 declared companions. Game-route server body writes total12,776,591bytes. Whole desktop including subsequent icons totals310requests/52,162,562bytes; do not attribute that total to game assets or describe server writes as client-consumed bytes. This demonstrates elimination of manifest-wide eager startup traffic, but no actual on-demand read was reached; runtime Loading/Retry UX remains unqualified.

The private helper initially omitted the normal binaries/ alias, so shared msvcrt.dll lookup404 occurred despite the real corpus file being present. That limits compatibility conclusions beyond the explicit unsupported API. Future helper route resolution now maps binaries/ and test/binaries/ to the fixture root and source files to private checkout; actual msvcrt/EXE existence and traversal-rejection tests pass. No repeat was made to hide this limitation. Failed/aborted request details remain raw.

Policy/lifecycle correction1878f5ca rejects required+optional metadata and renews background state on host reload after stop, while old providers retain their cancelled signal.11focused tests plus6existing cancellation tests pass. Remaining path audit156 was historical at capture; root subsequently restored Snood installer and devhell1.xm and reports154. This task does not own that acquisition work.
