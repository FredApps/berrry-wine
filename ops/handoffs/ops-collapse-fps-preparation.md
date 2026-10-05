# Collapse qualification preparation — BLOCKED source binding

Owner/session: `codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, 2026-10-02. Driver-only preparation is complete for review. **Not launch-ready:** the proposed validated audio base lacks the event-timer behavior required by Collapse. Root acknowledged this finding and authorized finishing an explicitly unbound draft and exact source-delta assessment. No browser, emulator, compilation, transfer, network, installation or performance measurement occurred.

## Critical compatibility finding

The NFS3 immutable base (`scratch/nfs3-renderer-bench-20261002/fixture`, source `9b4f9b3f` plus validated audio slice, WASM `da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074`) is **not** an eligible Collapse source/module pair:

* `src/09a3-handlers-audio.wat:2788` stores only `(fuEvent & 1) == 0` in timer slot offset20, discarding `TIME_CALLBACK_EVENT_SET`/`PULSE` bits `0x10`/`0x20`.
* `src/09a-handlers.wat:289` returns any due timer as a callback slot; it has no event-only branch. `mm_timer_consume_slot` at306 tests the whole offset20 word as a one-shot boolean.
* The original Collapse compatibility notes identify this exact missing event behavior as the earlier callback-at-event-handle failure (`docs/re-notes/reflexive.md:53,450`). This is a known required semantic gap, not merely a performance concern.

GDI infrastructure is present: frozen `lib/host-imports.js` includes create2567/upload2693/attach2727/delete2751, and `src/01-header.wat:519–520` already imports host set/reset event. No missing host import or timer-slot layout expansion is needed for the narrow proposal below. Source presence is not a new runtime validation claim.

No immutable closure or WASM was copied into the new fixture after this failure. `verification.json` verifies all **12,270** original base hashes unchanged. Ricochet's fixture was only read to copy its reviewed deadline/GPU helper bytes; its sources, module, jobs and outputs were not edited.

## Smallest proposed source slice, not applied

Exact function-level comparison: `scratch/ops-collapse-fps-20261002/required-timer-functions.diff`. Relevant base/current hashes are pinned in `input-hashes.json`; these current-tree functions were read, not modified or substituted wholesale.

1. `src/09a3-handlers-audio.wat`, `handle_timeSetEvent`: retain callback mode bits `fuEvent & 0x30` alongside the existing inverted one-shot bit at offset20.
2. `src/09a-handlers.wat`, `mm_timer_due_slot`: distinguish exact event modes0x10/0x20, consume the due tick/one-shot, signal the event handle, reset for pulse, continue scanning instead of exposing the handle as guest callback or message. Event delivery happens even when a message caller is peeking without removal.
3. Same file, `mm_timer_consume_slot`: test only bit0 for retirement so periodic event timers survive their mode bits.

Current dirty source contains this implementation. A scoped `git log -S 'Event timers signal kernel objects'` did not identify a committed introduction; this is not a claim of accepted commit provenance. Existing historical `hot-original.wasm` has verified hash `65985dbecf428a305951d3ca1fe55fa951ae979907a791d437911ec79a8f4ff5` and preserved gameplay evidence, and `/private/tmp/mmx-profile-host` has source files, but the reviewed records inspected do not certify a complete source/compiler/host closure matching that module. The MMX variant provenance hashes outputs, not a sufficient source-to-module proof for substitution. The Sam replay module retains unrelated diagnostic transformations. None is nominated as a clean drop-in replacement.

Recommended next grant: apply only the three function hunks to a **new private copy** of the validated audio base, retain all original inputs, and test before one isolated build. Owner must be assigned; no current source-file ownership is claimed here.

Meaningful acceptance: existing `test/test-mm-timer-callback.js:154–176` covers SET/PULSE × one-shot/periodic, not-due behavior, unchanged EIP/ESP/yield, exact set/reset sequence, peek delivery with no fake message, and kill. Preserve the rest of the function-callback/context/phase tests. Because its event overrides are stubs, also require the relevant existing actual worker/event wake test or a narrow isolated real-event waiter case; set-then-reset pulse behavior must not be “validated” solely by checking two calls. Review/freeze that test's dependency closure first. Run one focused source compilation/test at a time, then WAT structural/static gate and one isolated module build with source/compiler/planner/WASM hashes. Compiler wall cost was not measured and no estimate is asserted. Do not run a broad game sweep, change the canonical module or infer gameplay acceptance from timer-unit tests. Source and build authorization are still required.

## Concrete unbound driver draft

New directory: `scratch/ops-collapse-fps-20261002/fixture` (13 files, full identities in `draft-fixture-hashes.json`).

* `tools/qualify-collapse.js`: qualification-only browser driver draft, body600s; normal page-input coordinates; CDP GPU/browser identity before guest launch; source-manifest and WASM validation; fresh output requirement; original source serving without overrides; owned browser10s/server5s cleanup and late-resource disposal helpers. No private guest addresses, thread-ID assumptions, forced redraw, old source overlays or FPS arithmetic.
* `tools/collapse-qualification.js`: normal route and fail-closed phase/binding checks. Observe menu candidate before click147,277; observe board candidate before click120,110; capture before/after full page and client crops. It never promotes image difference to score/player-control proof. Every terminal candidate retains `performance:null`, measurement disabled and review flags false.
* `tools/collapse-qualification.test.js`: four pure cases pass: phase/binding rejection, input order, menu/board failure stopping subsequent clicks, template geometry/extreme-pixel discrimination. Syntax check passes; `--audit-only` reports blocked binding without browser imports or writes. No live driver test occurred.
* Two byte-identical reviewed helpers copied from Ricochet: `ricochet-fps-analysis.js` and `nfs-bench-analysis.js`. Only limits/resource/GPU utilities are used; the Ricochet overlay, event selection and statistics are not installed or invoked.
* Four required original payload/manifest files copied under the registered `test/binaries/candidates/reflexive-collapse-crunch` path. Three **existing** reference images copied; no image was generated. Input origins and hashes are in `input-hashes.json`.
* `module-binding.json` deliberately has `ready:false`, null source/WASM/manifest. Normal execution stops here, before loading Puppeteer, starting a server, creating output or launching Chrome. Audit mode is available without a host closure.

The static reference matcher is a conservative **candidate** gate, not a reviewed game-state recognizer. It compares sampled client RGB against original menu/board images at similarity≥0.90 with a0.05 margin over the other reference. This tolerance is an unvalidated draft choice. Historical crop is guest32,44/800×600; full screenshots must verify window geometry. Different layout or animation may fail closed. No threshold relaxation, fallback click grid or claimed score parsing is built in. Before runtime approval, reviewer must accept/refine these gates or choose a separately scoped scene observer. Actual score0→26/blocks680→581 in the old evidence is an example, not an exact deterministic expectation for a new run.

Portability remains incomplete intentionally: no host, WASM, browser server or package closure was copied after rejecting the base. Runtime imports of `puppeteer-core`, `pngjs`, and `test/static-server` will be bound only after compatible closure selection. These missing dependencies are not disguised by ancestor resolution or dirty-tree imports. Pure tests use builtins and the copied helper only. The final manifest and dependency-resolution audit must be regenerated after binding; the draft manifest is not named `qualification-input-hashes.json` and cannot authorize execution.

## GDI observer and remaining review gates

Independent assessment: `ops/handoffs/ops-collapse-fps-frame-review.md` by serious_review. Recommended later observer: originating `built.imports.host.gdi_surface_upload(id,left,top,right,bottom)` with create/attach/delete lifetime metadata, forwarded once unchanged. Select the actual visible top-level HWND/surface and full-client stream; retain partial uploads and worker/context identity separately. The return may be optimistic RPC acceptance, rectangles can be clipped or unchanged, and a upload is not screen completion. Canonical flush/readback and public frame callback are unsuitable substitutes for the originating event.

This draft **does not install telemetry** pending source binding and observer review. It records that absence explicitly. A future accepted metric may be named guest GDI presentation-submission rate with sampled-scene limits; neither “displayed FPS” nor unique-content frames follows from upload counts. Continuous proof beyond that scoped claim is not asserted. Root must review the observed board/score input response and scoped stream/lifecycle evidence before authorizing any measurement.

Exact proposed command after compatible binding, closure audit, reference-gate review, separately authorized observer preparation, host/resource grant and explicit runtime approval:

```sh
CHROME=/absolute/approved/chrome node tools/qualify-collapse.js --phase=qualify --app=collapse_crunch --max-seconds=600 --out=../qualification-01
```

Run from the eventual bound fixture only. Add `--allow-swiftshader` solely for explicitly authorized software diagnostics; CDP evidence must label the actual GPU/backend. No measurement command exists; `--phase=measure` fails. No extra Ricochet run is implied. One eventual qualification can produce only candidate visual/metadata evidence, followed by review; no automatic retry or timing transition.

Evidence: `pure-tests.log`, `audit.json`, `verification.json`, `input-hashes.json`, `draft-fixture-hashes.json`, `required-timer-functions.diff`. All pinned protected inputs unchanged at final verification. Shared/canonical source and running jobs preserved. No resources held; this bounded preparation scope is released with the launch blocker explicit.

## Root-review addendum: exact SET evidence and patch recipe

`collapse-timer-flags.json` now pins the original EXE and existing disassembly. At VA`0x42df5c`, `push 0x11` supplies `TIME_PERIODIC | TIME_CALLBACK_EVENT_SET` to the direct `timeSetEvent` call at`0x42df74`. The preceding `CreateEventA` at`0x42df4a` receives four zero arguments: unnamed, auto-reset, initially nonsignaled. All bytes from VA`0x42df3f` through`0x42df79` were matched against the actual original EXE through its PE section mapping, not trusted solely from the old text disassembly. This supports **SET** for the observed direct game callsite, not a claim that no indirect/generated PULSE call can exist.

Root independently identified a PULSE limitation: host set/reset queues a wake but reset can clear state before waiter consumption; there is no preserved pulse latch. The old mock test proves call order only. **Do not certify full PULSE delivery from this proposal.** The concrete Collapse gate is real SET delivery to its auto-reset waiter, with manual-reset coverage as the adjacent meaningful regression. If later evidence requires PULSE, stop and scope that separately.

Standard unified diffs, prepared as artifacts only and not applied:

* `proposed-timer.patch`: exactly the three functions in the two production files above, against immutable audio-base bytes. `proposed-timer-identities.json` records original and resulting whole-file hashes. No unrelated current-tree hunks are included.
* `proposed-timer-test.patch`: only the existing additive event-mode setup and four SET/PULSE×one-shot/periodic mock cases against the frozen `test/test-mm-timer-callback.js`. All existing ordinary-callback EIP/ESP/yield, parked-wait return, DispatchMessage dwUser, reentrancy and timer-phase assertions remain intact. This test compiles real WAT with test-only setup exports, but its host event overrides remain mocks.

Proposed serial recipe after an explicit root implementation/build grant:

1. Create a new private copy of the verified12,270-file base; verify hashes before mutation. Apply the two patch artifacts there only and compare exact resulting source hashes. Keep fixture/module binding false.
2. Add one narrowly owned actual SET waiter regression using the frozen real ThreadManager event implementation and actual timer WAT, avoiding test overrides for set/reset delivery. Cover initially blocked auto-reset waiter waking once, signal consumed once, second poll staying blocked until the next periodic deadline, kill stopping further signals; manual-reset delivery to current waiters and sticky signaled state until reset. Also cover one-shot retirement, no premature deadline and unchanged callback paths. This additional test is required and **not yet implemented**. Existing `test-worker-thread-scheduler.js:119` provides real event bookkeeping examples but its scripted backend is not by itself end-to-end timer delivery proof.
3. From that new private copy run `node test/test-mm-timer-callback.js`, then the new actual SET regression, then `node test/test-next-timer-due.js`, one source compilation at a time. Stop on the first unexpected failure. Keep PULSE mock observations explicitly separate from unsupported real delivery. `test-mm-timer-context.js` is absent from the frozen base, so do not silently pull it and its newer source assumptions into this closure.
4. Run frozen `node tools/check-wat-manifest.js`, `node tools/check-wat-fragments.js`, and the applicable frozen structural gates. For an eventual deployable module run frozen `bash tools/build.sh` inside the private copy only, which includes repository-required gates and `tools/build-compile-wat.js`; no repository-root/canonical write. Review its remaining dependency closure before the build grant rather than substituting current helpers. Record all source/compiler/planner/module hashes and unchanged-input diff after build.
5. Only after semantic acceptance bind the draft to that coherent module and host, complete the package/import closure audit, and implement/review the separately described GDI lifecycle observer and scene gates. A browser grant remains separate. Do not change the module-binding file to ready merely because compilation succeeded.

No patch, test compilation, source build or runtime was executed by this addendum. Further implementation is on hold for root review.

## Authorized private SET implementation and focused validation

Subsequent root grant implemented the exact proposed slice in **new** `scratch/ops-collapse-timer-20261002/fixture`. The original audio-base and the13-file unbound qualification draft remain unchanged. Final verification checked all12,270 base files and all draft hashes. The private copy differs from the base in exactly the two reviewed production files and the additive callback test, plus one new `test/test-collapse-event-set.js`; no shared source, scheduler, REP, TLS or canonical artifact changed.

Production whole-file hashes match the proposed identities exactly:

| File | SHA-256 |
|---|---|
| src/09a-handlers.wat | `650d9b6a25b6816111b19ba392ffbafb716cba0246c9f588de48b4ed75caaf87` |
| src/09a3-handlers-audio.wat | `f793b920c55706782b5b1201635190214a9e7bf584e0425e0145bff5c1fc3279` |
| test/test-mm-timer-callback.js | `63937724f7b5e385bf1131aa50c114dce25b37d4ceaa383b57a4a7fab1c1bb7d` |

The new fixture compiles actual timer WAT through the frozen compiler, forwards set/reset to the real frozen ThreadManager and uses its shared synchronization table, wait acquisition, parked-wait polling and queued wake servicing. Four auto/manual-reset × one-shot/periodic cases verify no early signal, exact inverted stored mode words, PM_NOREMOVE signaling without messages/callbacks, periodic phase/coalescing, repeated-SET coalescing, explicit reset, kill and parked WAT EIP/ESP/yield preservation. Two additional cases install two already parked worker wait requests and verify one auto-reset or both manual-reset waiters are dispatched, no duplicate grants, next-period delivery and cancellation. **Only the final worker-dispatch operation is a recording spy; no OS/browser Worker is spawned and actual resumed guest instructions are not executed.** The emitted completion decision retains result0 and12-byte stdcall cleanup. This is actual timer→manager event/wait integration, not a browser-thread scheduling claim.

First run session34189 compiled successfully but failed after the first case on a test cleanup typo (`closeHandle` versus the frozen `closeSyncHandle`). Original test, log and module are preserved. Root authorized the test-only correction. Corrected session42701 exited0, all six cases passed. Both emitted the same test-module SHA `f275204c3a3f51533ec17afaee917f9e720eba64804e8dd068291da77d59799d`; the test-only WAT exports distinguish this artifact from a deployable module.

Serial results, all terminal:

* New SET fixture: PASS, session42701, `set-integration-second.log` and `set-integration/observations.json`.
* Existing callback test with additive event cases: PASS, session82444, `callback.log`; ordinary callback entry/return, parked context and message-dispatch assertions retained.
* Existing next-timer-due: PASS, session19702 terminal exit0, `next-timer.log`.
* Frozen manifest:120 fragments included correctly; fragment balance:120 PASS; existing aggregate WAT structure regression:PASS. Logs `wat-manifest.log`, `wat-fragments.log`, `wat-structure.log`.

No passed gate was repeated after acceptance. Initial syntax/hash shell commands used the wrong relative working-directory prefix; corrected read-only invocations passed, with no duplicate test compilation from that command mistake. Full result/session accounting is `results.json`. No live owned session remains. PULSE still unqualified; mock call-order coverage is not promoted.

## Frozen build closure review — awaiting deployable-build grant

All60 direct Node entrypoints in the frozen `tools/build.sh` exist and are hashed in `build-entrypoints.json`. A conservative literal import scan of those entries plus explicit computed compiler roots/focused tests visits138 files/204 edges, with **zero resolved imports outside the private fixture** (`build-node-closure.json`). Its sole unresolved `./x` is the explanatory comment at `tools/toyvm/bundle-browser.js:66`, not executable code. This scanner cannot prove arbitrary computed dependencies; the entire12,271-file private fixture is pinned by `final-fixture-hashes.json`, and known dynamic compiler inputs are separately pinned in `build-core-input-hashes.json`.

Specifically frozen `tools/watx.js` loads four vendored VM sources from `tools/watx-src` (parser, stages, codegen, compiler); `tools/watx-closure.js` reads the authoritative `src/main.watx` closure and uses production/standard-WAT options. Frozen `build-compile-wat.js` builds tail-call and compatibility artifacts, applying the existing `lib/dispatch-trampoline.js` transform only for compatibility, stamps region-layout identity using `region-layout-hash.js`, validates modules, and writes the two output files. The host region-map and existing planner files are pinned unchanged. No new planner/runtime implementation is required by the event-mode bits.

Proposed next command, **not run and still requiring root grant**, from the private fixture:

```sh
bash tools/build.sh > ../isolated-build.log 2>&1
```

This invokes the frozen repository-required gates, generates private `build/combined.wat`, produces private `build/wine-assembly.wasm` and `build/wine-assembly.compat.wasm`, and runs emitted data-overlap verification. Without `--names`, the compiler may remove a stale private `.named.wasm` sibling. Preserve original private artifact copies/hashes before that step; do not alter the source base or qualification draft. No environment flags for legacy compiler, region shake, replicated dispatch or named builds are proposed. No install/network step is needed from the identified import closure. Full build gates have not yet been run, and their success is not implied by the three completed structural checks.

After a successful authorized build, required review artifacts are the full build log and terminal code, source/compiler/host/planner manifest, both module hashes, region-layout stamp, complete before/after file delta, and immutable-base/draft postchecks. Then root must separately authorize binding/finishing the qualification driver and GDI observer. The copied deployable WASM currently remains the **old incompatible** `da5bf93b…` bytes; only the newly emitted test module contains the timer changes. `module-binding.json` remains false and no browser or gameplay qualification has occurred.

Implementation evidence root: `scratch/ops-collapse-timer-20261002/`. This bounded implementation/test scope is ready for review and released; no resources held and no deployable build launched.

## Authorized isolated full build — PASS

Root subsequently granted one private full build and narrowly permitted same-revision closure completion. The frozen test registry automatically discovers `test-collapse-event-set.js` in the unit tier; no test list or timeout change was required. Before launch, timeout-gate inspection found missing `test/run-all.sh`; it was restored from Git `9b4f9b3f`. Its associated tier/check-timeout/timeout-JSON files already matched that exact revision. Original private `build/wine-assembly.wasm` was saved in `prebuild-artifacts/`; compatibility, named and combined artifacts did not previously exist (`prebuild-artifacts.json`).

First full build session36893 exited1 at the toyvm bundle freshness gate, before compilation: two frozen generated bundle inputs were absent. Root authorized restoring their exact Git9b4f9b3f bytes and rerunning the full build. Both blobs existed and were copied without regeneration or gate bypass. `closure-additions.json` pins Git blob IDs and SHA-256 for all three added files; root independently checked that provenance. Original failure log/exit remain `isolated-build-first-missing-data.log`/`.exit`; no timer semantic or source gate failed.

Second full build **session61590 terminal exit0**, full log `isolated-build-second.log`, exit `isolated-build-second.exit`. All frozen required build gates passed, including bundle freshness, compiler provenance and emitted data validation (324 segments, no overlaps). No changes to passed tests or production code were made between focused validation and this build.

| Private output | Bytes | SHA-256 |
|---|---:|---|
| build/wine-assembly.wasm | 1,650,854 | `1930e089068d43e0e42d4af2523f027ca97a389937507ef468c1950df117a146` |
| build/wine-assembly.compat.wasm | 1,653,417 | `22b2932387c2ed276d04797736c4e2c55f6b0f9d388e01f913f13ddb3747dae0` |

Layout identity: **`13ec3f8fc4a7f551`**. Source/compiler/planner identity: exact audio base plus the two reviewed timer-file hashes above; full source/compiler/planner hashes in `build-result.json`,136 core build-input hashes in `build-core-input-hashes.json`, and complete final fixture in `postbuild-fixture-hashes.json`. Existing compiler, dispatch trampoline, region map, host and planner bytes stayed unchanged.

Post-build comparison against the tested private fixture found exactly one changed existing file: its deployable WASM. New files are generated `build/combined.wat`, compatibility WASM, and the three provenance-pinned closure inputs (`test/run-all.sh` and the two toyvm bundles). No named artifact was generated or removed. All12,270 original audio-base files and all13 qualification-draft files remain byte-identical. `build-result.json` records these deltas and invariance checks.

This establishes a tested, identified private SET-capable source/module pair. **Qualification binding remains false.** No browser, game, transfer, network or performance run occurred. PULSE remains explicitly unqualified, and focused SET testing retains its recorded final-dispatch-spy limit. Independent GDI observer preparation is owned by serious_review in a separate scratch directory; no observer has been inserted here. Root review/authorization for final driver integration and closure remains the next step. All owned build/test sessions are terminal; no resources held.

## Final qualification integration checkpoint (registration review pending)

Root accepted the build and pure GDI observer handoff, then granted final static preparation. New separate `scratch/ops-collapse-fps-20261002/bound-fixture` combines verified accepted-build files, preserved original driver/assets and byte-identical GDI helper `3fcb63dd72fca0316aa2857b34c2e2fbf9f27ae46186419652b289fd7476e8de`. Both input fixtures remain untouched. Original observer13-test source/log hashes are retained; integrated overlay syntax is checked against the actual bound worker. The original observer test contains its original workspace-relative source-evidence path, so it is retained as evidence rather than claimed as a portable runtime dependency.

Integrated driver changes so far:

* Early and per-stage cross-origin isolation, visible/running/worker-backend checks; worker-start errors are fatal. Served worker overlay retains explicit COEP `require-corp` and CORP `same-origin` headers as in the fixed Ricochet driver. Network failures are bounded metadata, not silently lost.
* Screenshot cropping reads cached clientRect from the uniquely visible, own-surface-associated, top-level Collapse window; the800×600 requirement is explicit. No WAT geometry method or surface flush is called. Historical clicks147,277 and120,110 are translated by their client-relative offsets115,233 and88,66 when the observed window origin differs; both historical and actual coordinates are recorded. Neither geometry nor title sets human association review to true.
* Candidate recognition compares stable menu labels/start control and board HUD labels against original captures, with a separate original retry-dialog negative. Seven existing references calibrate correctly: two menus, three boards, one loading screen and one retry dialog. Three consecutive candidate observations3s apart precede each route transition. These are readiness candidates, not proof of score, player control or uninterrupted scene. Before/after/end images still require review.
* Accepted originating GDI observer wraps the four imports without changing forwarding. All observed guest worker creation/retirement, missing/unarmed observers and mismatched armed/stopped context sets remain explicit coverage ambiguities. Before/after no-flush page metadata and window geometry are retained; changed association/geometry is flagged. Automatic rectangle distributions always call `diagnose` with **reviewed:false**. Root must select the actual surface using images and metadata; no fake association approval is synthesized.
* One short diagnostic covers the board click; no FPS arithmetic, performance remains null. Body600s plus at most3s final raw-buffer salvage,10s own browser close and5s own server close. Late acquisition disposal stays in the reviewed helper. Only owned browser PID can be killed.

Fifteen focused driver/scene pure tests passed (`bound-tests.log`), including early-backend rejection, response headers, child-versus-parent geometry, route ordering and original seven-image calibration. Syntax passed. The final binding-gate test was rerun only after adding manifest identity enforcement.

Copying file hashes alone initially omitted the base's package links. Restored247 valid links as relative in-fixture links from the reviewed original closure report; three pre-existing dangling tool-bin links are excluded and documented. `bound-symlinks.json` and runtime `qualification-links.json` pin link targets. Literal Node closure:397 files/1032 edges, zero ancestor resolution after restoration. All16 unresolved optional/comment references exactly match the original accepted `optional-dependencies.json` (disabled ws accelerators, optional color support, unselected QuickJS variants and example strings); none is a new missing required import. `bound-optional-dependencies.json` records the classification. The driver verifies link identity/resolution and all hashed bytes before importing Puppeteer or launching anything.

**Last static blocker:** frozen `lib/apps.js` has Ricochet but no `collapse_crunch` entry. Root was sent `proposed-app-registration.json`: the four-field descriptor for the original EXE, two-file local manifest, empty files array and requiredFiles:true. Proposed solution is driver page setup inserting only that descriptor into the existing mutable `wineApps.APPS` object, followed by normal trusted Launch. Frozen registry/runtime bytes would stay unchanged. This implementation awaits root acceptance; `bound-fixture/module-binding.json` is false. Earlier intermediate manifest/audit artifacts predate this discovery and are not final release identities. No browser/upload/build/install occurred during integration.

## Final static qualification preparation — ready for root diff review

The fixture-only registration is now implemented as a concrete reviewable result within the granted final-driver scope. `qualification-app.json` pins the four-field descriptor; `registerApp` refuses any different descriptor or conflicting existing entry. A pure test uses the **actual frozen** `lib/apps.js` export, confirms insertion succeeds and preserves the existing Ricochet object. Runtime page setup adds this descriptor to that same APPS object and uses the ordinary trusted Launch button/localFileManifest loader. Frozen `lib/apps.js` and every accepted-build file remain byte-identical. Root was notified of the implementation; final driver/registration diff review remains required before any runtime grant.

The driver now waits up to30s for a defined backend before the early strict worker check, preventing an undefined startup state from being mistaken for a completed fallback. Runtime registry insertion and candidate screenshot recognition do not constitute human gameplay or GDI association approval.

Final identifiers (supersede all intermediate fixture manifests above):

| Artifact | SHA-256 |
|---|---|
| tools/qualify-collapse.js | `2a2bd400a6e8475c588ab99aae48eb7124ff887a844db0ff278bf5e72ac04312` |
| tools/collapse-qualification.js | `520d5ab0e86619c1dffb92580af716a0716d6bf4cf8cb98a52cebdf4f7db2bc8` |
| original accepted GDI helper | `3fcb63dd72fca0316aa2857b34c2e2fbf9f27ae46186419652b289fd7476e8de` |
| qualification-input-hashes.json | `3fb9bb0d40b8f539bd97b4446fc026a21b7f4ab324e6fd484cc68c68fd01edb9` |
| served guest-worker overlay, proposed default runId | `ce2301e5d12a869241e79a0bc11868c89f37c7cfef7117bf0c8bf3504a7a3522` |
| tail-call module | `1930e089068d43e0e42d4af2523f027ca97a389937507ef468c1950df117a146` |
| compatibility module | `22b2932387c2ed276d04797736c4e2c55f6b0f9d388e01f913f13ddb3747dae0` |

`bound-final-report.json` is authoritative for all individual current helper/descriptor/link/binding hashes, including changes made while closing the registry gap. Full diff against the original driver draft is `bound-driver.patch`; the new scene test/helper/descriptor files are manifest-pinned additions. Final `--verify-only` checks **12,297 regular input files and247 relative links** without loading Puppeteer or starting a server/browser. Manifest SHA is pinned by the separate module binding. The binding itself is pinned in the final report, avoiding a cyclic self-hash. No package resolution reaches an ancestor; optional/comment reference classification is preserved. Three pre-existing dangling tool-bin links are excluded rather than silently redirected.

Fifteen route/scene tests passed, then the new registration test passed after its implementation (sixteen distinct focused cases total). The updated manifest-gate case passed, final driver syntax and overlay parsing passed, and final byte/link verification passed. `bound-scene-calibration.log` preserves all seven original-image observations. All12,296 source input paths used to construct the new fixture, including accepted private build, original13-file draft, released observer sources and original reference images, rehash unchanged. Accepted-build-file drift inside the bound fixture is empty; no module/host/compiler/planner source was modified for registration or observation.

`module-binding.json.ready:true` now means **static source/closure preparation is complete**, not runtime authorization. All measurement flags remain false, `performance:null`, and association review remains pending. This task has not launched Chrome, executed Collapse, uploaded assets, installed dependencies or built another module.

Proposed **one** qualification command, from `scratch/ops-collapse-fps-20261002/bound-fixture`, only after root's final diff review and fresh assigned-host/resource grant:

```sh
CHROME=/absolute/approved/chrome node tools/qualify-collapse.js --phase=qualify --app=collapse_crunch --max-seconds=600 --run-id=OPS-GAME-FPS-BASELINE:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f:collapse-qualification-01 --out=../qualification-01
```

For an explicitly approved SwiftShader diagnostic, append `--allow-swiftshader`; software identity otherwise fails before guest launch. Add `--no-sandbox` only if the assigned host's reviewed launch policy requires it. No measurement command exists. Body600s; final raw snapshot salvage≤3s, own browser close≤10s, own server close≤5s. A620s external ceiling is proposed, with any escalation targeting only this run's browser/helper resources. Browser acquisition requires≥40s remaining budget and has30s startup/protocol bounds. Existing foreign jobs remain out of scope.

Expected review artifacts: result/console/network/worker lifecycle records; menu/board-before/board-after/board-end full/client images; before/after page metadata and geometry; raw originating per-context lifecycle/upload windows; explicit context gaps; module/source/served-overlay/CDP-browser/GPU identities. Root must review actual input response and score/blocks, then choose a real surface association. Upload distributions remain requested GDI submissions, not displayed or unique frames. Failure stops the route; no retry, optimization or timing transition is implied. No runtime resource held; final preparation is handed off for review.

## Portable one-run package ready — no transfer/runtime performed

Owner `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`. Root accepted independent integration review and reports the prior Ricochet ASCII slot released. This section hands off the **local-only** wrapper/package for final root review; it does not consume a runtime grant.

New files under `scratch/ops-collapse-fps-20261002`: `remote-qualify.py`, six-case `remote-wrapper.test.py`/log, `package-qualification.py`, `package-inputs.json`, `package-receipt.json`, `qualification-package.tar.gz`, and `remote-package-recipe.md`. The recipe defines the exact fresh `/home/user/ops-collapse-qualification-20261002` extraction/verification/one-run sequence, required host checks, output collection and acceptance limits.

Archive **113,611,016 bytes**, SHA-256 `3eebb5586a15a50a65f72cf3735ea7ae74996addbf61c9cc636e70d05f6a7cb4`;12,316 regular members plus247 relative links. Wrapper SHA `61ae7c9a10cd227542f3a3ce734f9ebc53e109e2bd33f11b05dddf32f8b76eec`; full package input inventory SHA `c547142901dc33dc1837dd7bf5cd99bcb4549b1c75f389aff53f19e8e2a373b8`. Archived bound source report SHA `56efb74045ad6e8559749444fd95dc95d64b46e28a62e754e2dbbc9d67194b09`. All original source/module/driver identities above are unchanged; fixture rehash before/after packaging passes12,297 inputs and247 contained links. Every archived regular byte and literal symlink target was read back and matched; packaging session13744 terminal exit0.

Six pure gate tests PASS, three Python AST checks PASS. Wrapper default never launches, and a durable exclusive attempt marker disallows retries. Future preflight records actual versions/display/processes/thermal availability/free storage, requires3×10s≥95% idle and≥4GiB available, and defers on competing guest/browser runtimes. It preserves foreign jobs. Actual CDP SwiftShader must be reviewed from driver output, never inferred from flags. Driver body600s plus cleanup18s remains; **outer owned-PGID ceiling650s supersedes all earlier620s text**. An independent timer enforces that group ceiling while PID observations, exact group cleanup, terminal residue, pre/post byte checks and full output hashes remain evidence. Residual or escaped processes are reported, not broadly killed.

No browser/network/transfer/runtime/module/source changes occurred. The reviewed driver's obsolete comment about false binding is harmless historical text; the pinned binding is statically ready, performance remains null, and its hash was preserved. Next action requires root's explicit transfer plus one-qualification grant. Afterward, actual scene/input/GDI association and context completeness still need human review. No local or remote runtime resource is held by this worker.

## One authorized remote qualification completed; ASCII released

Root subsequently granted exactly one transfer/run on the released ASCII host. Archive/extraction/hash gates passed. The unchanged wrapper36722 ended exit1 at the300s menu gate:97 saved screenshots, no route clicks, no board or counter qualification. Full result and source/GPU identities are at `scratch/ops-collapse-fps-20261002/remote-artifacts/qualification-01/result.json`. Chrome151.0.7922.108/CDP actual ANGLE SwiftShader, Node24.18.1/V8node.50, worker backend/isolation confirmed. Quiet samples98.999/99.625/99.750%,≥4GiB memory passed; thermal unknown recorded.

Owned PGID511874 cleanupVerifiedtrue, remainingKnownPids[], outerTimeoutfalse; all12,297+247 postrun input identities unchanged. Download24274/local verification35093 both exit0: all125 output hashes match bundle `2b7ba3b62e01146ece38e4b06d2df0211fd9c89dfea8960758633adeae954a7f` (68,700,126 bytes). Explicit ASCII RELEASE posted to board and root/ops_review. No active owned runtime/approval remains, no retry made.

The durable local analysis is `scratch/ops-collapse-fps-20261002/qualification-result-review.md`, with offline pixel evidence in `geometry-diagnosis.json`. Final screenshot shows a loaded mode menu. Three saved images have exact sampled menu-region matches at page40,195, but runtime cached clientRect is802×601 at29,40. Own HWND-associated canonical backing is808×628;800×600 surfaces are unattached and cannot be chosen by size. The strict geometry gate prevented scene matching and input. Frozen source separately represents USER client bounds, full window backing, game-content pixels and DOM presentation; retained data lacks the transform needed to reconcile them. No offset or resize fix was applied.

Next proposal is a narrow driver-only no-flush mapping snapshot (DOM/backing dimensions, cached window bounds/style/clientRect, canonical canvas identity and optionally audited direct client-rect loads), with pure transform/ambiguity tests, before any reviewed change to route mapping. Keep failed fixture/artifacts immutable. Root review/new scope is required before patch or another run. Performance remains null; PULSE and gameplay/score/GDI association remain unqualified.
