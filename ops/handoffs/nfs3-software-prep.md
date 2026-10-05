# NFS3 explicit software / emulated GL preparation

Owner: `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642` (`/root/ops_review`), 2026-10-02.

Status: narrow isolated implementation complete for coordinator source review (release details below). No browser, upload, build, installation, or remote operation. User authorization now permits a quiet remote CPU host running software rendering or browser-emulated GL. This supersedes the old hardware-capacity blocker, but does not make results hardware baselines. ASCII remains serialized through the coordinator's queue; no NFS3 slot is claimed.

## Frozen baseline and three distinct paths

Read-only baseline: `scratch/nfs3-renderer-bench-20261002/fixture`, audio-base `9b4f9b3f` plus documented validated audio slice. Module SHA-256 `da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074`. Prior handoff and closure manifests remain authoritative. New preparation evidence lives only in `scratch/nfs3-software-prep-20261002`.

| Guest path | Original loaded DLL | Emulator presentation | CPU-host interpretation |
|---|---|---|---|
| Glide | `voodooa.dll` | Glide WebGL endpoint | ANGLE SwiftShader executes GL on CPU; guest swap submissions |
| D3D | `d3da.dll`, device 0 | D3DIM WebGL endpoint | ANGLE SwiftShader executes GL on CPU; selected primary Flip submissions |
| Original game software | `softtria.dll` | DirectDraw presentation | Guest x86 CPU rasterizer; presentation/composition reported separately |

`glide-software` is the emulator's WAT rasterizer, a fourth path excluded from this comparison. `--gpu` is a routing option, not physical-GPU evidence. Browser CDP SwiftShader identity does not establish that the original software path rasterizes through GL; Canvas2D composition is a separate observation. Loaded DLL, actual endpoint and selected backend must agree; no fallback/substitution is accepted silently.

## Narrow changes proposed in a new isolated copy

1. Add explicit `--browser-gpu=hardware|swiftshader`, default hardware; reject ambiguous legacy flag combinations. The existing harness line 37 rejects `--swiftshader`, while `Analysis.hardware` rejects software strings and requires hardware feature flags. Preserve that hardware branch and add a separate SwiftShader classifier. For Glide/D3D require both actual endpoint GL renderer and CDP renderer to identify SwiftShader; retain complete feature statuses without applying the hardware-only `enabled` predicate. Missing or contradictory identity fails. Record requested mode, actual browser renderer, guest DLL and emulator endpoint separately. Save CDP identity before guest launch so failed routes remain attributable.
2. Require explicit CHROME executable binding; use the frozen pure-JS `puppeteer-core` closure with optional native WS extensions disabled. No platform-native Darwin package may be assumed executable on Linux. Capture exact executable/version/launch args, Node/V8, display and host architecture. Existing `/usr/bin/google-chrome` and Node24 paths are candidates, not future identity proof.
3. Carry over reviewed Ricochet startup admission and late-resource disposal helpers. Current `runCase` wraps an async body in a deadline race, but a late `puppeteer.launch` can complete after the race and continue startup. Check deadline after every startup await and before every side effect; dispose late acquired browser/server handles. Use 600-second body, at most 20-second capture/cleanup budget, and independent owned process-group ceiling 650 seconds with TERM grace inside the ceiling. Retain original failure, forbid post-expiry capture requests, save bounded URL/request failures, and clean only owned processes. Existing correct worker COEP/CORP headers must remain unchanged.
4. Preserve seed12345, original seed-hook anchor, scene `{mode:3,ai:0,weather:1,night:0}`, 640×480 display and surface, fresh VFS, renderer defaults and no driving inputs. Require worker backend before race continuation. Existing 100k-triangle / 100-present readiness is only a candidate: save ready and 10/20-second HUD checkpoints and review countdown, advancing race clock, speed0, cockpit/weather, errors and selected DLL. No guessed guest clock address or claim of synchronized comparison from a triangle threshold.
5. Keep qualification-only `samples=0`, `timingAccepted:false`, `performance:null`. Label originating `grBufferSwap` timestamps as guest swap submissions, never displayed/unique frames. D3D later needs the reviewed lifecycle/generation/worker coverage safeguards before Flip rate admission. Softtri kind5 is a present-request diagnostic: partial blits, unlocks and palette calls can produce multiple requests per complete frame. Its FPS remains unavailable absent demonstrated frame-boundary semantics. Preserve zero-gap counts; strict positive-interval admission may reject quantization, never silently remove zero gaps. Record arm/stop clock and bounded capture overflow/worker coverage explicitly.

These are helper/served telemetry changes only; no WAT/module, renderer semantics or game assets change. Freeze original and served script hashes. Pure tests should cover explicit backend classification, contradictory identities, delayed acquired handles, no post-timeout input/capture, zero-gap reporting and closure portability. Do not rerun unrelated suites.

## Portable closure and first proposed command

The old closure has 12,270 regular files and 250 internal symlinks; original 2,826 hashes and prepared helper hashes are preserved. It includes 133 NFS3 manifest entries, 78 fonts, system DLL/data dependencies and all three original renderer DLLs. Existing local static Node closure: 377 files / 1,015 edges / zero ancestor escapes. This does not certify Linux execution. A new portable copy must resolve the changed driver's complete closure from itself, retain required package trees, rebase internal links, and explicitly inventory/exclude only the three unused dangling `.bin` links if necessary. Optional missing native WS/supports-color/unselected QuickJS dependencies remain optional, never silently converted to required fallback. No downloads or installations.

Proposed root after implementation: `/home/user/nfs3-software-qualification-20261002/fixture`, fresh and private. Exact file/link counts and new helper hashes must be established after the approved narrow patch, not invented here. Pre/post verify all inputs, manifest and link containment. Original EXE hash `0defab3eeb22ee4b6e0007a4d5b26a99d868008ba77e2b9bd3ef770e924548ad` must remain pinned.

After explicit queue release and a new one-run grant, execute from that fixture:

```sh
DISPLAY=:0 CHROME=/usr/bin/google-chrome /home/user/.nvm/versions/node/v24.18.1/bin/node tools/nfs-renderer-bench.js --qualification --browser-gpu=swiftshader --cases=glide --samples=0 --seed=12345 --wasm=build/wine-assembly.wasm --source-commit=9b4f9b3f+documented-audio-slice --out=../qualification-glide-01 --no-sandbox
```

This is a proposed command for the revised helper, not runnable permission or a currently supported option. `--no-sandbox` is limited to the assigned isolated box under an explicit grant. Fresh preflight immediately before launch: three 10-second intervals each ≥95% CPU idle, ≥4GiB available, no competing scoped browser/compiler/emulator jobs, preserved services, exact host/runtime/display/storage identities and readable thermal evidence (unknown if unavailable). No foreign signals, automatic retry or reuse of old idle measurements. One launch only, stop and preserve failure. Download/hash all artifacts, verify post-input identity and owned process residue, then explicit release to root/board.

## Later comparison, not part of the first launch

Only after root reviews Glide route and originating counter evidence, propose single D3D then original-software qualifications with the same controlled scene. Do not force unavailable full-frame metrics into a three-way ranking. Timing requires reviewed matched post-countdown checkpoint, adequate counter semantics and quiet-host gates; sampled scene evidence has explicit limits and is not a proof of continuous gameplay.

Retain the previous predeclared campaign budget as a proposal: reverse order blocks `glide,d3d,software,software,d3d,glide`; each fresh session 10-second post-checkpoint warmup plus three 30-second windows, six windows per path. Maximum six 600-second sessions, no reruns. Same-path session drift budget ≤5% median rate and ≤10% interval p95; ≥100 intervals/window, no overflow/interference. Claimed advantage must exceed max(5%, measured same-path drift), agree across both blocks, and avoid >10% p95 regression or correctness degradation. Insufficient original-software frame semantics or counts are reported unavailable rather than changing the window opportunistically. Rate units must name the admitted submission boundary.

Three separately labeled 20-second profiling diagnostics (one/path, each capped600s) follow only under later authorization. Profiles cover actual render/guest worker and page URLs. Preserve draw/triangle/texture/upload/readback/fallback counters with source definitions and identify unavailable counters; profiling and optional census overhead cannot supply headline timing. Maximum originally proposed campaign 7,200 seconds across three qualifications, six timing sessions and three diagnostic sessions. No campaign launch is granted by this report.

Next action: root review and narrow ownership grant for implementing the listed changes in a fresh private fixture; then review frozen patch/portable manifest/wrapper before granting the first Glide-only runtime after the existing queue. Current preparation is complete; full NFS3 task remains active.

## Implemented release for source review

Root subsequently granted the narrow implementation. The new fixture is `scratch/nfs3-software-prep-20261002/fixture`; `implementation.patch` is the complete change against the preserved old fixture. Exactly one original file changed in the copy (`tools/nfs-renderer-bench.js`), plus the new `tools/nfs-qualification.js` and focused test. All 12,270 original baseline file hashes were reverified unchanged in their original location. No module/assets/rendering semantics were changed. Original helper/test remain unchanged; unreachable timed-sample execution was removed from this qualification driver. It accepts the three original paths but launches nothing without explicit `--execute-reviewed-once`; the future command above must add that flag after a runtime grant.

Release identities:

| Input | SHA-256 |
|---|---|
| Driver | `053e505465405fc6b5729032975f46e8f76193423527b66858c2b5224c662b94` |
| Qualification helper | `08e7ade24455a05c6ca7344b42dba44d1322722a8261e0ef8c3d18aaea1eaa1d` |
| New pure test | `7bcb630ca8de4f9fce14c5d4a0c9fa68707b71bd786271b3e778318226e0eb4e` |
| Input manifest | `a9bdbdd689571c72b7618e58685fb8ab748d2562da8a5c94a178386d95e9e6bf` |

`qualification-input-hashes.json` covers 12,272 regular inputs (manifest separately pinned); `symlink-inventory.json` records 247 contained relative links. The copy excludes only unused dangling `.bin/prebuild-install`, `.bin/rc`, `.bin/mkdirp`. `node-closure.json` records 375 files/997 import edges, zero ancestor escapes and no required native modules. Sixteen optional/unselected/docs-literal misses retain their previous classification. Native WS extensions are disabled before importing frozen `puppeteer-core`; selected executable must be an explicit absolute CHROME binding and its bytes/version/arguments are recorded at execution. Static closure is not a claim of having executed Linux Chrome.

The helper preserves strict hardware checks and adds independently checked actual CDP + endpoint SwiftShader identity. CDP evidence is saved before guest launch; original-software guest rasterization is separately labeled from browser composition. Every startup await has before/after deadline checks. Late browser/server acquisitions are disposed and write a separate durable late-resource receipt. Early failure cancels route continuation while permitting bounded final evidence inside the original deadline; actual expiry permits no new capture requests. Capture/browser/server cleanup share 20 seconds. The proposed outer 650-second owned-group supervisor is not yet prepared or granted.

Raw telemetry now has originating context identity, time origin, arm and stop; stop disarms recording. Qualification rejects changed observed worker/context sets, overflow, and events outside their originating windows. Full raw timestamps/intervals and zero-gap counts remain in evidence. Positive-interval statistics are withheld for zero or regressing gaps; no silent filtering. Surface lifecycle and unique/displayed frames remain unqualified. All results retain `performance:null`, empty samples and `timingAccepted:false`.

Validation: syntax PASS; focused pure tests PASS (renderer modes/conflicts, independent identity, late resources, cancelled continuation, early-failure capture versus actual timeout, shared cleanup ceiling, first failure, origin stop/zero gaps, context/worker changes and overflow). `static-audit-final` parses both actual served overlays and verifies unique seed/swap anchors without starting a server/browser/guest. Full baseline-preservation/hash/link audit PASS. No original unchanged tests were rerun. No package or wrapper was created.

Exact next action: coordinator reviews `implementation.patch`, helper and identities; only then grant wrapper/archive preparation. Future runtime remains one Glide qualification after explicit queue release and fresh required host gates. No live handles, approval waits or resource claim remain.

## Arm/stop binding correction completed and released

Root identified that the previous helper validated stop receipts alone and the test admitted the same object as arm and stop. Owner `codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f` applied the narrow released correction. The prior eight source/evidence files and hashes are preserved under `arm-stop-correction-before`; `arm-stop-correction.patch` is the exact subsequent two-file helper/test delta. Top-level preparation copies mirror the corrected fixture bytes. Driver, original NFS baseline, assets/module, renderer behavior and diagnostic/no-FPS scope are unchanged.

Installed telemetry now reports explicit `armed` state and a monotonically increasing `windowSequence`. Double-arm and stop-while-unarmed reject before altering state. A new arm clears per-window timestamps, overflow and stopped timestamp, while retaining lifetime totals. Stop disarms recording. Previously serialized arm/stop receipts remain unchanged across later windows.

`windowEvidence` requires distinct armed-then-stopped receipts, a null arm stopped-time and empty/zero-overflow arm rows. It binds each pair's identity, `performance.now` clock, finite time origin, context URL, finite start time and positive per-arm sequence. A stale stop cannot be substituted even when timer values collide. Existing same-worker/context sets, stop timestamp bounds and overflow checks remain. Raw zero/regressing interval diagnostics retain their prior handling; no surface lifecycle, displayed/unique-frame or FPS claim is added.

Focused test PASS uses the **actually installed serialized observer** in an isolated VM: valid first/second arm-stop windows, duplicate state guards, preserved prior receipts, resetting a real100,000-event overflow, stale/mismatched start/sequence/origin/clock/context receipts, nonempty/overflowed arm data, changed workers, stop bounds and explicit arm=stop rejection. Existing relevant renderer/deadline/cleanup cases in the same focused helper test still pass. No browser, HTTP, guest or module execution occurred. Both actual served overlays parse with unique seed/swap anchors; helper syntax and closure verification pass. Freeze6200 terminal0 reverified all12,270 original baseline files. Only helper/test differ from the previous released12,272-input fixture; all other12,270 released inputs and247 links remain unchanged. Closure stays375 files/997 edges, no ancestor imports or required native modules.

Corrected authoritative identities (`preparation-result.json` and `arm-stop-correction-result.json`):

| Input | SHA-256 |
|---|---|
|Unchanged driver|`053e505465405fc6b5729032975f46e8f76193423527b66858c2b5224c662b94`|
|Corrected qualification helper|`07aa7237731dae3dbaa1382bdbf8eee583bbd088aefbbdad61a757c400931ade`|
|Corrected focused test|`600ddc767ed839b1270b37c5dc1540ad35e3426218da04f8a5a502598ed0b377`|
|Repinned input manifest|`c95191ea85e0cfbf20798e41bfd4934f438aaf7eece94951807b7a13a10d3f05`|
|Served guest-worker overlay|`50733172ed133b638ee49576bd871f29b87ffae28d0e9e97e6697ecebcd7d73a`|
|Served Glide overlay|`636ec233c88ce8d66b3491a9e85ab13b19cd06d270b97da811ce3e2df163440e`|

Evidence: `arm-stop-correction-tests.log`, `arm-stop-overlay.log`, `static-audit-arm-stop/served-hashes.json`, `arm-stop-freeze.log`, `arm-stop-closure.log`, preserved before hashes and exact correction patch. No package/archive, network or runtime grant was used. All checks terminal; no resource/approval handle is held. Correction is released to root for review before packaging. The independent conditional Jazz grant remains subject to explicit Unreal release; it does not authorize NFS runtime.
