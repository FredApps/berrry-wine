# Jazz gated route implementation checkpoint

Owner codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f (`/root/fp_parity`). Status **INCOMPLETE / scene admission needs review**. Scope remains NEW `scratch/ops-jazz2-route-20261002` only. No original fixture copied/modified, module or asset changed, browser/guest/network/archive/build/runtime started. No active handles. Existing conditional NFS3 grant retains priority after Ricochet release.

Root granted geometry/source-owner helper and saved-reference calibration first, with fixture integration conditional on those gates. Implemented `jazz2-route.js` geometry snapshot, strict source admission, separate source-image and guest-input transforms, screenshot pixel extraction and draft spatial cinematic descriptor. Helper SHA256 `08f9cbb7fe384952baef776a5cdd8dbef61be689f8b1ba0f037c13b6b5ec6b18`; focused test `6dde7f8b44d420c85e7d72b5e42d167c01efcb8e0851c8d41a4adb09d8ad7c9d`. Full identities in preparation-result.json.

## Source-backed geometry

Frozen renderer1397 chooses exclusive window fit/crop; renderer2312–2366 sizes an exclusive composite from the window's DX backing and draws at window-local positions. presentation-filter743–750 /784–823 draws crop fields into destination fields. Native input mapping is independently implemented by renderer2488 mapCanvasPoint. This supports a640×480 source occupying only part of a653×531 crop mapped into831×676 destination; whole-destination stretching would be wrong.

Snapshot accepts lexical renderer explicitly and reads only cached windows/source/layer dimensions, viewport/transform and DOM layout. It never calls composite/source-builder/flush or guest exports. Strict admission requires one visible own-memory top-level Jazz window, matching selected transform HWND, known owned DX/composite source relation,640×480 source+DX+logical canvas, non-GPU layer, origin0,0, finite complete crop/output/DOM dimensions and visible presentation canvas. Unknown/ambiguous association fails. These are supported narrow cases, not proof actual next runtime will meet them. The saved startup snapshots omitted crop/source/backing association, so their inferred mapping remains **calibration-only**; actual runtime must obtain and validate it before input.

Pure tests PASS (terminal0, geometry-tests.log): serialized lexical snapshot/no mutation; actual frozen Win98Renderer.prototype.mapCanvasPoint round trips at several point centres; source versus native transform distinction; translated/scaled DOM; source/owner/HWND/foreign/ambiguous/missing/clipped/nonfinite/hidden/GPU/changed-geometry rejection; synthetic screenshot pixel-coordinate checks and out-of-bounds rejection. No WAT or rendering execution. Actual frozen renderer is required by explicit path for this first-stage local pure test, not by an eventual portable driver. Portable closure is not claimed yet.

## Calibration gap preserved

`calibrate.js` inspected all12 hash-pinned startup images plus8 prior root-reviewed route fixtures. Current draft uses4×3 spatial tiles with8 coarse colour bins; comparison is normalized histogram distance. At provisional distance≤0.13 and negative margin≥0.08, five saved intro references07–11 match themselves and all15 publisher/blank/menu/loading/gameplay negatives reject. This confirms separation only, not temporal robustness.

Held-out nearest-other-intro distances are0.4257,0.5954,0.6322,0.5869,0.4257 for07–11. All five reject without their own reference. Different shots vary too much for this coarse generalization. The current evidence does not establish that two separated future screenshots will both match a reviewed cinematic state reliably. Thresholds were **not** increased to force a pass. `calibration.json` and `preparation-result.json` preserve positive/negative source hashes and raw distances; cinematic-references.json SHA38805470... remains a draft, not an approved input gate.

This is a detector/readiness limitation, not evidence of a game/emulator failure. No new mandatory continuous-cinematic proof is asserted: two independently recognized saved-state candidates could be a conservative route, but its acceptance scope should be explicit rather than called independently calibrated. Alternative is a reviewed persistent cinematic landmark detector with meaningful variation tests. Root has been notified before integration, per instruction to report semantic gaps rather than weaken scene gates.

## Remaining work

After root chooses a bounded scene-admission approach: implement its discriminating pure tests, then copy accepted portable247-link fixture and integrate helper plus one-shot Escape token consumed before key send. Natural stable main-menu path must bypass Escape. Require two stable main-menu/Single Player/Jazz/Medium candidates, then two gameplay candidates; normal Right and Right+Space with owned key release and human displacement review. Keep actual-driver deadline/late-operation tests, full input/module preservation, closure and fresh manifests. No measurement/noFPS. No code for that route or fixture copy is claimed completed here; no run/package is authorized by this checkpoint.

## Revised approach requested by root: live frozen review

Root accepted the held-out limitation and replaced the automatic two-cinematic-candidate requirement with bounded root review of a fresh live capture before a single ordinary Escape. Proposal is `scratch/ops-jazz2-route-20261002/review-gate-proposal.md`. Existing WineFrozen page API provides the scheduling seam; no new control hub is needed. Freeze must await the existing one-step-at-rest reply, not merely set a flag. Proposed120s atomic per-run receipt binds image/geometry/source/nonces; durable one-shot consumption precedes key send, with exact frozen-content and scheduler rechecks. No answer means cleanup, not approval. All remains within existing600+20/650s budgets, qualification only.

Geometry draft also needs the existing Collapse mapping's conservative CSS ancestry guard; the current helper hash does NOT yet include it and remains unready for integration. Existing mapping.js5–11 /test-mapping.js22–23 reject rotation/skew/transformed ancestors/zoom/borders/padding. Proposal reuses that policy for presentation and input canvases. No helper edits or copied fixture after root switched to proposal-only scope; original prototype/failure evidence preserved. Await review before implementation.


## Local integrated release — live review gate replaces automatic classifier

Status: **READY for coordinator source review; no package or runtime grant**. Root approved the bounded live review approach and local isolated integration. The authoritative implementation is now `scratch/ops-jazz2-route-20261002/fixture`. Earlier prototype/calibration and first failing harness logs remain preserved; they are not runtime inputs. The automatic cinematic classifier is absent from the integrated helper. All12 startup captures and metadata plus previous8 route references are preserved/pinned in the fixture for reviewer context, never used as automatic approval.

The original accepted portable fixture's12,340 regular files and247 links were reverified unchanged. Inside the new copy only the inherited driver changed, plus2 helpers,3 focused tests and13 startup evidence files. WASM/assets/host/compiler/scheduler/rendering/previous helpers are unchanged. Current full manifest has12,357 inputs plus manifest;247 contained resolving relative links. Static Node closure398files/1,034edges, no ancestor imports;16 optional/unselected/docs-literal misses identical to prior accepted closure. No builds, installs, browser/guest, archive or network operation.

| Authoritative input | SHA256 |
|---|---|
|tools/bench-jazz2-guest-presents.js|`18ef41adac7951aba724c8920f8fa92305e9522320592706d3cca8bdb53a3cfe`|
|tools/jazz2-review.js|`43203301683e36281c28a4a660de2a8c9512a7307c1e8eef0379bd99af292ea6`|
|tools/jazz2-route.js|`01c2d98796291ff9d400a9a46928b91a2e5cb48b18f97bc026c08fbc781df1af`|
|test/test-jazz2-route.js|`cc1948f321fd8e417f31e546493f5ed725ea27bd4ba840da34f17787426726c5`|
|test/test-jazz2-review.js|`5a4430adbe4d279df64056b87ce8928479ceedd66cf2cbfd9f949d41f57ee7b7`|
|test/test-integrated-driver.js|`80260ba239a3f73eac3b1f7cbf0e9781f2371af0bedc4a3a9802b61941e93fbe`|
|qualification-input-hashes.json|`9099f6bd1844f7a904eda304df87e530a59a08fa9472ad4feadb5fc5f2c0cc15`|
|portable-inputs.json|`a400a150dc5be83b8e6e33ac940b629c4e0d053a2d9b7df69d262c2ccc2910e4`|
|build/wine-assembly.wasm|`da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074`|

`driver-final.patch` is the exact inherited-driver delta. `integration-result.json` identifies every added file; `portable-inputs.json` and fixture manifest identify complete source/compiler/assets/package closure. Initial integrate.py is preserved preparation history; final fixture bytes and final patch/manifests are authoritative.

Geometry uses lexical sharedRenderer and cached own-memory/source association, no observer flush/rebuild/exports. Both logical and presentation canvas plus all ancestors must have observed none transform/translate/rotate/scale/perspective, normal zoom, and no canvas border/padding/object-fit variation; unobserved CSS fails. Source crop and native input mappings remain distinct. Actual next runtime must satisfy the narrow640×480 own-DX/source association; no claim that old snapshots already prove it.

Driver phase is exclusively `qualify-reviewed`; default rejects. At35s after backend readiness it captures actual source geometry and scene. This schedule never authorizes Escape. A natural menu candidate bypasses review and must still pass two stable main-menu checks. Otherwise it uses existing WineFrozen.setEnabled(true) then WineFrozen.step(1), rejects failed/timed-out/wrong-step completion, verifies one actual parked guest. No control service, new guest addresses or private source override.

Review lasts≤120s under original600s body; requires≥360s remaining at entry. It publishes an atomic request containing unpredictable run/request nonces, raw guest-content RGBA hash, geometry hash/HWND/frozen ticks, expiry and source hash binding driver/helpers **plus actual full manifest and module hashes**. Root must download/view a positively identified current cinematic and explicitly supply the exact matching one-shot receipt. No response means timeout/cleanup, not approval. No automatic retries or repeat Escape.

On response: strict fields/action/decision/source/nonces/hash/HWND/expiry validation; fresh frozen content/geometry/ticks/own-window/worker/isolation/visibility checks; exclusive durable review-consumed.json written **before keydown**. Escape stays physically down across resume, then normal80ms keyup. Owned keyup cleanup is attempted even on down/resume/deadline failure. Existing browser cleanup and required650s wrapper ceiling remain authoritative if a boundedReview timer wins while an operation/cleanup is pending. No wrapper/archive was created here.

After resume, two stable main-menu, Single Player, Jazz and Medium scene candidates precede each Enter; Darn Ratz loading is excluded and two gameplay candidates required. Right800ms and Right+Space800ms retain human displacement review. The old short3s raw DX diagnostic remains raw only: no lifecycle/unique/displayed-frame acceptance, performance:null, gameplayQualified:false pending root visual review. Neither scheduler nor mocked transport tests claim that a real Jazz guest consumed Escape; actual menu transition remains the runtime evidence.

Validation: fixture-geometry-tests.log PASS uses actual frozen mapCanvasPoint plus CSS/owner/source/changed/clipped/DOM negatives. fixture-review-tests.log PASS executes actual frozen scheduler methods with controllable in-flight completion and actual renderer-input queue/state handlers; down+up before resume demonstrably clears physical polling state, hence changed sequence. Actual boundedReview timer winning a deferred capture then resolving late cannot consume/down/resume. Strict receipt/mismatch/denial/replay/no-answer/changed-state/durable consumption/owned release regressions PASS. fixture-driver-tests-release.log PASS exercises extracted **actual integrated driver** capture/settle/review IO/key cleanup/bootstrap functions: delayed await and synchronous crop/PNG encoding expiry produce no late requests/writes; source hash includes manifest/module/driver; natural-menu bypass does not call review. No unrelated suites repeated. Served worker overlay static parse/unique hook PASS in static-audit-release (no server/Chrome). Final freeze95327 terminal0 reverified originals/fullpins/closure. Initial test7862 failed only a missing fake clock-state dependency, preserved; corrected focused tests pass.

Remaining review gates: root full source/receipt mechanism review, later package/archive review, then separate explicit one-run authorization and serialized resource release. The existing conditional NFS3 grant after Ricochet remains higher priority. No active local handles or remote claim from Jazz preparation.
