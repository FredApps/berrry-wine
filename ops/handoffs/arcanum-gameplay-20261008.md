# Arcanum gameplay coverage — 2026-10-08

Both software and WebGL now have reviewed, registered original crash-site
gameplay and ordinary player movement. WebGL has a scene-qualified visible
presentation rate. **The objective remains incomplete: software FPS is
unqualified.** No engine compatibility change was needed or made.

Sole worker, no subagents. Isolated branch `fix/arcanum-gameplay-20261008`
off fetched `7e4ce05ce33b8689ffb6d96184cc319c3353de8a`; shared HEAD/index
untouched. Root reviews, integrates and pushes explicit paths:

- `tools/arcanum-gameplay-browser.js`
- `tools/arcanum-presentation-counter.js`
- `tools/arcanum-presentation-counter.test.js`
- `docs/re-notes/arcanum-demo.md`
- `docs/gl-d3d-corpus-status.md`
- `ops/handoffs/arcanum-gameplay-20261008.md`

## Identity and route

Source/host/fixture closure: 2953 SHA-256 pins in the sealed run's
`provenance/pins.json`, checked before launch and again before removal.
All 37 declared fixture paths were present, including the original
`test/binaries/candidates/arcanum-demo/installed/arcanum.exe`.
Native module SHA-256:
`d8d4096f957ed51cecab589b5a1ec7bf402336f13959ce0710faf2f7d3c68960`.
Chrome 151.0.7922.108, Node 24.18.1, Linux AMD Ryzen 9 9950X,
cooperative/no guest worker, native 800×600, displayed game 560×420.

The driver serves the original closure locally and navigates to
`index.html?app=arcanum_demo&debug&no-threads&d3d-renderer=software`
or the explicit WebGL equivalent. Launch command:
`node tools/arcanum-gameplay-browser.js OUT software` (or `webgl`).
Commands are sequential `OUT/commands/N.json`; exact commands, trusted
input events, requests, module-serving hashes, state and screenshots are
retained. Input uses genuine pointer capture, X11 relative movement and
mouse buttons, and Escape. No guest memory, EIP, surfaces or save state
were forced. Next/Escape/Continue and three gnome responses reach free roam.
Before/after westward movement shows the blue player changing position
relative to the fixed corpse and wreck on both arms.

Software incidentally visited Options and returned through Done without
changing settings. Its later corpse click does not prove reverse movement.
WebGL's first left capture clicked Exit; a second route attempt omitted
required reviewed references for movement and subsequently clicked Exit.
Those failed captures/commands are retained. The third registered URL
navigation in the same browser succeeds; it never resets the outer guard.
The candidate driver now defaults capture to the right button, matching
the separately retained ordinary right-capture helper used on that route.
Actual runtime driver and observer versions remain separate from candidates.

## Presentation measurement and tests

WebGL idle crash site, after westward movement: **434 / 20.127145 s =
21.562919 presentations/s**. `webgl/webgl-fps-samples.json` contains raw
one-second samples, target write sequences and 434 actual copy events.
Every sample has a valid target and visible `screen-present` sink;
observer errors are empty. Backend snapshots have GPU enabled, actual
draws, zero errors/fallbacks; the read-only late snapshot records 18352
GPU draws. Before/after images remain the same reviewed gameplay scene.

The metric counts new selected game uploads whose actual copy chain reaches
a verified visible display sink after completed filter presentation, or an
explicitly verified visible direct canvas. It is compositor submission,
not physical scanout or unique pixels. Raw API/Flip calls and page RAF do
not count. Instrumentation overhead and this one idle scene limit comparisons.

Software's original 20.14755-second observer missed OffscreenCanvas:
writeSeq 45291→46459, zero copy events. Its raw zero FPS is **rejected**.
The exact observer SHA
`30ee354e13083ae89366589b510ab344fcd280a03192e1dfef4c11dbb4214ab6`
and raw samples/screenshots are retained. Corrected contracts fail against
that original observer (expected count 1, actual 0) and pass with both
actual context prototypes. Tests cover visible filtered/direct sinks,
hidden/no-op paths, unrelated copies, repeats, overwritten uploads,
copy exceptions, geometry, target replacement and wrapper restoration.
`node tools/arcanum-presentation-counter.test.js` and syntax check PASS.
Root's 14:23 counter review accepted the revised source/contracts, subject
to live nonzero scene evidence now supplied. Software corrected FPS still
needs a future authorized bounded run; no extra browser was launched.

Canonical native build gates PASS in the retained complete log (the detached
repair build's terminal exit code was not separately captured). Initial build failed because the minimal
closure omitted two checked-in ToyVM bundles; only those were added, with
the original 600-second deadline retained. The Git-less remote append/index
gate cannot compare against HEAD. An overbroad repair helper was stopped;
69 unrelated remote files were retrieved/hash-receipted and pruned before
browser launch. No other guest was run. No silent API-success stubs.

## Runtime, evidence and cleanup

Fresh no-env boat **bx_bdrvj38f**, expiry **2026-10-08T15:39:12.009Z**,
root adopted lifecycle ownership. SSH returned 403 and was not retried;
execution used boat exec. Bounds declared before launch: transfer 1800 s,
native build 600 s, each browser 1200 s, aggregate active browser 2400 s,
retrieval/cleanup 180 s. Transfer 215.8 s; original build start
13:45:15.555, fixed deadline 13:55:15.555. Oversized initial command was
corrected to bounded chunks within the transfer guard.

Software driver/Chrome 67679/67691: start13:49:14.466, guard14:09:14.466,
terminal14:09:15.209, exit0, cleanup0.740 s. WebGL 80564/80593:
start14:12:06.285, unchanged guard14:32:06.285, ordinary terminal
14:30:33.939, exit0, cleanup0.641 s. Aggregate active browser time
2307.016 s <2400 (software guard callback scheduling adds 0.003 s); terminal cleanup is separate. No overlapping browsers.

Software outputs 11,182,080 bytes, archive SHA
`04aa072294ebd77a484fbdec96fc345202430435466fcc4f2e90d7857d97ed6a`;
WebGL outputs 11,827,200 bytes, SHA
`fdb8b840770b944c7271ffb12acaf342b5865885ec574b5e76a6cd2facdb9e0d`;
runtime/build/observer outputs 7,301,120 bytes, SHA
`17d59b3c656dbbf30e4315836b22f55b53a476c4172d735370be66423dc8f081`.
Retrieved and verified before owned prefix removal at14:31:24.289.
Final retrieval/removal5.871 s; WebGL terminal to removal50.350 s <180.
Independent four owned PIDs absent, all Chrome absent, exact baseline
listening port set, owned prefix absent. Root may stop the boat; no jobs remain.
Local free disk stayed above2 GiB; final observation2.9 GiB. Minimal closure
and chunked transfer avoided another large temporary local allocation.

Result-last contained run:
`scratch/runs/20261008T1431Z-arcanum-gameplay-qualified` (336 indexed hashes),
including exact outputs, source/fixture archives, originals, module, host,
observer versions, tests, bounds, cleanup and review. Historical audit:
`scratch/runs/20261008T1349Z-arcanum-retained-gameplay-audit` (39 original
hashes). Retained 28152-batch free roam and45k..54k census stand; historical
imports lack sufficient source/backend identity, so fresh qualification was
necessary. The historical menu-only sweep is not a current gameplay pass.
All 336 new indexed hashes and 39 historical original hashes match;
owned containment errors/missing references are zero. The 82 unrelated legacy
missing references remain external. No combat, mission, save/load or audio
claim. No deployment, public/config changes, held diagnostic retries or refill.
