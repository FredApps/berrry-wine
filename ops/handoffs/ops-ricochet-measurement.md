# Ricochet software measurement draft — local review ready

Owner `codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, OPS-GAME-FPS-BASELINE. All new work is under `scratch/ops-ricochet-measure-20261002` plus this handoff. Frozen v3 fixture/results remain unchanged. No network, upload, browser, guest, source/module build, remote execution or publication occurred. Root's conditional Jazz startup grant remains separate and awaits explicit Unreal release.

The new private fixture contains a concrete `--phase=measure-draft` revision. Default invocation refuses; old `qualify` and `measure` phases refuse in this separate revision. The ordinary v3 menu/launch/left/right route and its short lifecycle probe remain intact. That old3s probe selects/admit the originating stream only; none of its events are relabeled as warmed performance data.

## Measurement contract

After the established route and successful strict lifecycle admission:

1. Require at least130s remaining within the600s body. Capture a normal gameplay checkpoint, warm up20s with no injected input, then capture a second checkpoint.
2. Run three separate target10s windows. Each has its own pre-screenshot/runtime checkpoint, originating-worker arm receipt, host wait target10s, originating-worker stop receipt, strict admission/summary and post-screenshot/runtime checkpoint. No screenshot, crop, PNG encoding or checkpoint persistence occurs while armed. Arm receipt persistence is deferred until stop/error.
3. Each arm resets only per-window rows, stale stop snapshot and stop timestamp. Full-origin lifecycle history, sequence numbers, allocation generations, overflow and worker identity remain intact. Double-arm or stop-while-unarmed is rejected. Every window independently replays strict existing lifecycle admission and must retain the originally selected worker/context/primary generation/owner/geometry. Reallocation between windows also fails selected-source equality.
4. Retain every complete raw arm/stop structure, event timestamps, raw event observations, coverage, admission, count, actual source start/stop, duration, intervals and p95 in `measurementWindows`. Fail on missing/ambiguous contexts, lifecycle changes during a window, overflow, inconsistent double reads, row/history disagreement, clock/window reset, short originating duration, fewer than100 intervals, scene failure or exhausted budget. There is no sample/run retry. If an armed operation fails and body budget permits, make one bounded stop attempt and preserve the original error/raw evidence.

“10s” is a target host wait, not a fabricated exact source duration. Denominator is each worker's actual `stopped-started` in `performance.now()`, including arm result serialization and stop-request scheduling overhead. Counts are kind6 guest Flip events only. Kind5 remains a strict paired-submission/lifecycle diagnostic and is never counted as a frame. Browser rAF/page repaint is not a counter.

Per-window `p95FlipIntervalMs` is nearest-rank p95 of consecutive Flip timestamps inside that window. Aggregate event rate is `sum(count) * 1000 / sum(actual durationMs)`. Aggregate p95 is computed from pooled raw **within-window** intervals, with gaps between windows excluded. No p95 averaging and no unweighted average of rates. Window counts/durations/p95s remain separately available. At least100 intervals is an admission floor, not a statistical confidence claim.

An entry reserve plus per-window remaining-budget checks covers20s warmup, three10s waits, bounded arm/stop/checkpoint operations and final reserve. Each operation is bounded5s and carries a closure guard: a late awaited snapshot/control cannot start another request or append a checkpoint after its scope closes. Global600s and inherited final-evidence/browser/server cleanup remain. Future execution still needs a reviewed outer immutable-input/resource/650s owned-group wrapper; none is granted or started here.

## Scene admission and its limits

Root accepted the v3 launch/left/right screenshots as sampled control response. This revision preserves the same strict complete-brick/HUD candidate, additionally rejects the existing menu/player/options candidates, and checks visible active isolated Worker state/display640×480 at each checkpoint. It does **not** relax into generic color-count admission. Three accepted original gameplay screenshots are positive fixtures; original menu/player/options, blank and missing-HUD images reject.

The yellow round banner scrolls. Visual inspection/calibration showed a fixed mask incorrectly rejects accepted gameplay when the identifier is partly offscreen. Per root direction, **there is no new mandatory fixed-round gate**. A horizontal exact visual-fragment search can report a match to the reviewed v3 ticker fragment, or `unknown or partial`; `decodedIdentifier:null` and `sameRoundEstablished:false` remain explicit. This is not OCR and does not claim a selected round from partial text. The task does not require fixed-round comparison.

Each accepted checkpoint is an **active-gameplay candidate pending root review**, not continuous scene evidence. The strict complete-brick threshold may conservatively reject later valid gameplay as bricks disappear. It is not a general classifier for every paused, game-over or unknown overlay state. Full raw screenshots and gameplay/HUD metrics remain mandatory review evidence; root must assess all eight checkpoints (two warmup plus six pre/post), visible board/HUD, any round/serve/pause/life transitions, and comparability before accepting a metric. No sampled image proves that no transient transition occurred between checkpoints. The route leaves the paddle at its final ordinary control position; no new auto-play input is added during warmup or timing.

## Software semantics, overhead and review barrier

This draft requires explicit `--allow-swiftshader` and actual CDP classification as software before sampling. It records Chrome executable hash/version, browser/CDP renderer and guest endpoint observations. Browser SwiftShader identifies software browser composition; it does not establish guest GL hardware rasterization. Existing DirectDraw guest semantics remain separate.

The full-origin observer runs during load, route, warmup and all windows. Every retained originating event performs surface double reads and JS bookkeeping; complete history is serialized at arm/stop. Its cap remains100,000 events and overflow fails. No overhead subtraction or independent overhead calibration is claimed. Sample timing is therefore **instrumented guest Flip submission behavior**, not uninstrumented game speed or displayed/unique FPS. Double reads remain observational, not an atomic snapshot or universal ABA proof.

The driver always writes `performance:null`, no publication call and `measurement-draft-awaiting-root-review` on raw-data success. `measurementSummary` is unreviewed raw aggregation. The pure `reviewedDraft(summary, review)` helper can construct a draft with `counterKind:'guest-flip-events'` only when an explicit root review record accepts every checkpoint/source semantic and supplies evidence. The driver never calls it automatically. Its legacy `fps`/`p95FrameMs` fields mean guest Flip events/s and pooled p95 Flip interval, supported by that discriminator and explicit labels. Publication is a later separate action, never implied here.

## Change ownership and provenance

Only two inherited fixture inputs changed:

- `tools/bench-ricochet-guest-presents.js`: separate draft-only phase, measurement integration/provenance, scoped late-await guards for capture/context operations.
- `tools/ricochet-lifecycle.js`: reject invalid repeated arm/stop states and clear stale stop snapshot on each arm. Full-origin recording/admission logic is unchanged.

New `tools/ricochet-measurement.js`, focused `test/test-ricochet-measurement.js`, and six copied positive/negative original reference PNGs are additive. `measurement.patch` contains the exact two-file inherited diff; new files are explicitly listed/hashed in `preparation-result.json`. No production source/compiler/module/host/planner changes, no current-tree imports.

All12,640 original regular files (12,639 declared inputs plus manifest) and250 original literal links reverify unchanged. As discovered during strict preflight,250 literal links are **247 resolving contained links plus three unused dangling bins**. Root authorized excluding exactly `.bin/prebuild-install`, `.bin/rc`, `.bin/mkdirp` only in the new portable fixture. Originals retain them; `excluded-dangling-links.json` pins literal targets. New manifest pins12,647 inputs plus its separate hash, and `portable-links.json` pins247 contained links. Static Node closure400 files/1,041 literal edges has no ancestor/external resolution;16 optional/comment misses exactly match v3. Full packages, assets, source, compiler/planner and build stay manifest-pinned.

| Identity | SHA-256 |
|---|---|
|Driver|`2cda1323561a1de6d77d1d7542d0053102e2987fe1cb08842239326ca8d0e99b`|
|Measurement helper|`47215153e8ae5ff2ba243d99f2828821a36c9d484d1e473c46357297a5566d21`|
|Lifecycle helper|`109c0185c4896e24c078bd88b7106cdb49f9c0850bd8d7881a866bfe3c2ae092`|
|Focused test|`5be8411b06860a432101095028e8836ffff1c5701f1b47441a1105b02dac345f`|
|Input manifest|`0535842eb9622ddafbfddfe601ea9589cc136c38c7195c248445598d9f423599`|
|Unchanged WASM|`da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074`|
|Served worker overlay|`045b4d1ddf0eee5f4f079954de7e1d5f3a0996d10fff0f23d56a17a884213757`|

Module/layout-source/generated-region-map consistency passes; layout hash remains13ec3f8fc4a7f551. `static-audit/source-hashes.json` pins the original worker, helper/layout and overlay identities.

## Validation and next gate

Focused pure test passes: repeated multi-arm reset/history preservation, unchanged prior serialized windows, strict lifecycle/context/reallocation/overflow/reset/row negatives, actual-duration weighting and pooled-p95 discrimination, explicit root-review barrier, positive gameplay/partial ticker and negative scene fixtures,20s/3×10s synthetic schedule, screenshot exclusion, budget refusal, error stop/no retry and late-await cancellation. All synthetic rates are test data, not measured game output. Changed driver syntax and serialized overlay parse pass. Dependency closure and final immutable freeze pass. No unrelated suites or unchanged v3 scene suite were rerun.

`measurement-tests-final.log`, `closure-check.log`, `overlay-audit.log`, `node-closure.json`, `preparation-result.json` and `measurement.patch` are the review bundle. Initial strict link audit stopped on known dangling bins before copying; subsequent copy/exclusion and final freeze resolved the packaging issue under root's explicit policy. Final freeze29911 and local checks terminal0. No owned runtime/resource/approval handle remains.

Next: root review of exact revision/scene and counter contract, then separately prepared/pinned portable wrapper/archive and serialized resource grant if accepted. Proposed internal command is `node tools/bench-ricochet-guest-presents.js --phase=measure-draft --app=ricochet_xtreme --threads --headful --screen=640x480 --max-seconds=600 --allow-swiftshader --no-sandbox --out=../measurement-draft-01` only through that future verified wrapper. No runtime readiness, metric acceptance or full five-game task completion is asserted by this local draft.

## Independent review correction — current release

Root assigned `/root/ops_review`, session `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`, a narrow correction after read-only review. Timer rejection alone did not enforce the five-second operation ceiling when synchronous image work delayed delivery of that timer. `checked()` now also captures an absolute operation end and checks it at every scope gate, using an injectable clock solely for deterministic pure tests. Capture checks immediately after decode/crop/encode/scene/hash work, before each image write and after each write. Checkpoint checks follow file read/decode/scene analysis and precede append/persist, with a final check afterward. An already-started synchronous system call cannot be preempted; these guards reject its overrun and prevent subsequent operations. Original task errors remain preserved.

No lifecycle, rate aggregation, p95, scene classification, warmup or window policy changed. Updated identities are in the table above; lifecycle/module/served observer remain unchanged. The manifest still contains 12,647 inputs and the portable inventory 247 links. Full freeze again verified all 12,640 original v3 files and all 250 original literal links unchanged. Dependency closure remains 400 files/1,041 edges, zero ancestor escapes, same sixteen optional/comment misses.

Focused suite PASS, including deterministic fake-clock synchronous stalls in the actual extracted capture/checkpoint functions: decode, crop, encode, scene, hash and first-write overrun prevent subsequent writes; checkpoint read/decode/scene overruns prevent checkpoint append/persist. No real five-second stalls, browser or guest. The first added VM test attempt hit a cross-realm assertion mismatch in its fake state; that fixture-only issue was corrected, and final tests passed. Evidence: `measurement-tests-deadline.log`, `closure-deadline.log`, refreshed `preparation-result.json`/`measurement.patch`/`node-closure.json`, and `static-audit-deadline/source-hashes.json`. Syntax and served overlay parse passed. Final local handle65423 terminal0; no resources or pending approvals. The earlier `revise-driver.py` is historical preparation, not a recipe to rerun over this corrected fixture.

This release is local source review only. No package, upload, runtime, metric publication or new ownership of remote resources. Root review and any subsequent packaging grant remain required.
