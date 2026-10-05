# WEP16 startup dialogs: read-only diagnosis, 2026-10-03

Neither saved batch6 run proves gameplay or a completed ordinary dialog dismissal. No runtime or application source was changed for this diagnosis. Evidence is in `scratch/gameplay-restored-batch6-20261003/{wep16_klotski,wep16_tetris}` and their corresponding `scratch/runs/20261003-*-gameplay-restored6` bundles; these remain unknown, not passed.

## Klotski: likely modal queue/pump mismatch

The saved Welcome image contains a visible OK button around x473..545/y396..419. The recorded click (506,406) is inside it; the unchanged image cannot fairly be dismissed as a missed button. `browser.log` records Win16 MessageBox, with no input dispatch lines or trap. The subsequent main-menu click is blocked by the still-open modal. Enter also fails to dismiss, but the saved evidence contains no owning-Worker queue snapshot.

Source chain: `src/09e-win16-api.wat` `$win16_MessageBox` creates the WAT class15 message box and parks at WIN16_MODAL_PUMP. `$modal_pump_step` in `src/09c3a-dialog-runtime.wat` processes shared completion and paints, then yields15; it does not dequeue mouse/key messages. In `lib/renderer-input.js`, the modal mouse branch first invokes `_queueNativeDialogChildMouseDown`; worker-owned BUTTON controls take the queued path. Worker-owned keyboard handling also queues HWND0 events instead of invoking page-instance dialog callbacks. `$msgbox_wndproc` completes on WM_COMMAND IDs1..11. This suggests queued input has no consumer while this particular pump is active, unlike a normal guest GetMessage dialog loop. It is a source-backed hypothesis, not a captured causal proof. The absent input logs support it but cannot establish whether the click was queued or dropped earlier.

`test/test-win16-wep3-gameplay.js:120` uses `dlg-cmd:1` to dismiss Welcome, another internal command to select the puzzle, and `dlg-set-edit:201:Codex`. `test/run.js` implements modal dlg-cmd as direct `send_message(dialog,WM_COMMAND,1,0)`. Therefore that historical gameplay regression bypasses the ordinary route under investigation.

Next diagnostic: after personally reviewing stable Welcome and actual live button geometry/class/style/id, take owning-Worker EIP/yield/thread, shared modal HWND/result/done, queue head/tail and message contents; make exactly one ordinary visible OK down/up; capture queue publication and consumption plus WM_COMMAND/completion, then clicked screenshot and bounded post-input state. Preserve timeout merely as observation. No direct dlg-cmd, modal_done, guest state writes, or page guest callback. If messages persist while parked and no consumer runs, repair should drain appropriate input on the owning modal instance, with ordering/target/focus semantics and a two-instance regression; do not restore arbitrary page callbacks.

## Tetris: missed control plus unresolved geometry/focus

Saved clicks hit About text at (510,230), not an identified OK control. Browser log shows mouse messages to HWND0x10005, but Enter/F2 target HWND0. The screenshot has clipped credits and no visible OK button. This does not establish that a valid button click is ignored.

Actual `test/binaries/wep16/WEP1/ABOUTTET.DLL` resources, decoded read-only with `node tools/ne-dump.js ... --resources --dialogs`, contain two dialog templates: ID100,174x195dlu, and ID101,174x215dlu, both style0x80400000. Each has a default `&OK` BUTTON ID1, style0x50030001: respectively (75,174,30,15)dlu and (75,190,30,15)dlu. Thus an OK control is expected near the bottom, not over the TETRIS label. Need actual instantiated template, converted parent client dimensions, child HWND/id/rect/style/visibility and clipping before selecting screen coordinates. Do not infer these from resource DLU alone. If the button is genuinely clipped, record that geometry defect rather than clicking invisible coordinates. Future ordinary route should use the actual visible OK button, then F2 and Down after focus/gameplay verification.

`test/test-win16-wep1-gameplay.js:162` likewise uses `40:dlg-cmd:1` before F2 and Down; it does not validate ordinary About dismissal. `docs/re-notes/wep16-tetris.md` describes historical painting/timer fixes, not this browser dismissal.

## Provenance and missing proof

Batch6 used d2c455f7 module; current code is diagnostic guidance, not proof of exact loaded historical source. Existing `geometry.json` files only report canvas/viewport, not HWND/control geometry. No owning-instance queue trace or complete child table exists in these saved runs. No missing bulk archive is required for the proposed diagnostic.

Local binary SHA256:

- KLOTSKI.EXE: `4995ff3b4bf35c6153ce65cdf93af5b5c6805e8d453e0f1fe2422582946c2bdb`
- TETRIS.EXE: `7f240d18e2c52cea58c14cfc83fb4fdc176cfb77c3827e671c705d0146848e2b`
- ABOUTTET.DLL: `8342f654f023e587bc00c13037142b3ddf817327f33e15f4a772f0be53aab756`

Root has authorized offline private Klotski trace preparation only. Batch8 owns the browser; future diagnostic pin is module `2c22cb7d21a5bf9191036bb30b674f959ec554c306b6be69e905a9f53f265e88`. No launch until serial slot grant.

Prepared private helper: `scratch/wep16-modal-trace-20261003/{browser.js,observer.js,mock-test.js,README.md}`. Syntax and actual observer mock PASS, including high thread16 ring wrap and byte-identical memory after observation. Explicit TTY/120s deadline, immutable loaded identities, stable reviewed before-image, live owning-Worker IDOK hit validation, one ordinary click and five-second observation. No runtime launched. Snapshots are observational, not atomic, and do not decode overflow lists; cannot infer dispatch absence solely from sampled queue contents.

## Ordinary-click trace completed; input starvation established

Root subsequently granted the sole runtime slot. Attempt1 (`session43940`, exit1, browser/server closed11:59:18.433Z) failed before guest startup or any input: newborn paused Worker did not yet expose `setInterval`, so observer installation threw and the launch promise timed out. Preserved as harness failure. Correction starts the observation timer only on explicit start after initialization and resumes the paused Worker in `finally`; mock now explicitly removes timers during injection and restores them before start. No application source or module changes.

Corrected attempt2: `scratch/wep16-modal-trace-20261003/attempt2`, session56159 exit0, browser/server closed **12:00:44.015Z**. No faults. Runtime slot explicitly released to root/Icy5. Actual GET responses prove module `2c22cb7d21a5bf9191036bb30b674f959ec554c306b6be69e905a9f53f265e88`, KLOTSKI.EXE hash above, renderer-input `34e889987fa97dcddcf843a19925df835869ed46dd22deb0064210d1a6228942`, host-window `457bfd56e4c16e93e749db8a9149bd918dd44647bef2a78ad70a86da3127d835`.

I personally reviewed the complete stable Welcome image before input. The actual owning-Worker snapshot identifies BUTTON HWND0x10004, ID1, class1, parent/modal0x10002, style0x50010001, screen rectangle(473,395,72,24). Exactly one ordinary click at(506,406) therefore exercises the visible enabled OK control, not guessed geometry.

107 page and107 Worker observations, zero drops, show:

- Renderer pending queue starts empty, receives mouse MOVE0x200, DOWN0x201 and UP0x202 targeting0x10004 with lParam0x000b0021, and retains all three through the five-second post-click observation.
- Owning thread1 remains at EIP0x1fff30, matching WIN16_MODAL_PUMP offset0xff30. Sampled yield is0; do not falsely report sampled yield15. The host can clear a yield between observations.
- Shared thread1 queue head remains0; count/tail changes5→7 only with NCHITTEST0x84 and SETCURSOR0x20 for the button. No mouse down/up enters that shared ring. No overflow.
- Shared modal HWND0x10002/result0/done0 remains unchanged. The live target remains present.
- Before, clicked and after-observation screenshots are byte-identical SHA256 `796be65c2d0d1ebaa042f8e7442998c44845a75aa5965dc1c01c22c66f7e2a5d`; I reviewed the final unchanged Welcome.

This establishes the narrower causal boundary: ordinary button input is generated correctly but remains in the host renderer queue while the guest is parked on the WAT modal pump. It is not merely timeout-based or a misclick. The exact pump source lacks the normal input polling/dequeue path, consistent with the trace. The trace does not instrument every internal WM_COMMAND call, and samples are not atomic, but the retained input sequence directly demonstrates starvation before button dispatch.

Raw trace SHA256 `d62e45aa6e6f2a7a67d5b1a4b81e5a7fd5d58a3ffc9f4fda8c4cbb87e189637a`; frozen browser helper `455e5755969cb7e786d8f814b915fda573b5895effb12e1020fd291824bb2946`; observer `b305b2d04f06f3cfcf9f1ce4ae5a9f9aacd698f968ceafe227a7744bad8cacbb`. No gameplay, success, or FPS claim.

Repair boundary: make the owning WAT modal pump consume relevant ordinary input using established host/USER queue semantics, preserving input ordering, mouse capture and modal target filtering. Ensure nonmodal pending messages survive dismissal. Do not dispatch callbacks from the page shadow. Meaningful regression must instantiate separate page/Worker ownership, park a real WAT MessageBox, deliver ordinary down/up through the renderer queue, require button WM_COMMAND and owning-instance return value, and retain unrelated messages; include Enter/default and Escape/cancel only according to existing supported dialog semantics. Root owns repair authorization. Tetris remains a separate geometry investigation with no valid button exercise yet.

### Exact publication boundary and proposed scope

Root correctly distinguishes page publication from shared-ring consumption: the raw trace proves the former fails to occur, not that mouse messages were delivered into a ring and stranded there. The code uses a **pull**: `host.js:1778` implements `check_input`, which calls `renderer.takeInput(owns)` at1814. `lib/guest-rpc.js:595` brokers that import when published INPUT_PENDING is nonzero; queue-depth publication only informs the fast path/wakeup and does not itself transfer mouse messages.

The working Hearts/FreeCell resource-dialog route differs materially: `$win16_dlg_pump` in `src/09e2-win16-dialog.wat:545` calls `$handle_GetMessageA`, which polls `$host_check_input` in `src/09a5-handlers-window.wat:1985`, reads target/coordinates, and invokes `$input_route_to_owner`. Same-thread input can become the returned MSG directly; cross-thread input is explicitly forwarded. `$win16_dlg_route` then dispatches on the owning instance. WAT `$modal_pump_step` calls neither host input nor GetMessage, so queued button events never reach this established pull. No production JS flush change is presently indicated.

Proposed initial implementation scope, **not yet edited/authorized**: `src/09c3a-dialog-runtime.wat` and existing `test/test-modal-common-dialog-worker.js`; only include `src/09a5-handlers-window.wat` if extracting the established input acquisition/owner-routing logic is needed to avoid divergent semantics. Preserve the parked Win16 far-return frame and Win32 modal continuation; do not invoke full GetMessage handler blindly because it adjusts API stack state and can deliver unrelated callbacks. Poll/route relevant input on the owner, dispatch safe modal control messages there, preserve unrelated events and cross-thread forwarding, handle zero-target keyboard through existing modal key semantics. Shared-post-queue handling should be justified/tested separately rather than assumed necessary from this trace.

Existing `test-modal-common-dialog-worker.js` already instantiates two real modules over shared memory, but it directly calls `ui.test_modal_done(1)`; that test therefore misses publication. Extend it with a real WAT-built MessageBox and renderer ordinary down/up queue, a host `check_input` bridge using actual `takeInput`, and counters proving the owning instance polls/dispatches while the shadow never executes guest callbacks. Require owner result1 and restored continuation; keep unrelated posted messages and another thread's input intact; baseline must fail by retaining the queued click. Separate default-key/cancel/capture tests must exercise actual supported paths rather than direct completion helpers. No runtime or source edits while Icy5 owns the slot.

## Authorized private repair prepared, canonical untouched

Root subsequently authorized the narrow WAT/test scope during frozen-module batch9. Before snapshots and scoped review patch are under `scratch/wep16-modal-repair-20261003`; no generated map, browser JS, layout or canonical module changes.

- `src/09c3a-dialog-runtime.wat` SHA `a4861b4d9e309cf6c4c9526be15a190d427da4c836e4400f83e08142e99b0efa`: `$modal_pull_input` runs only on the owning instance, acquires one event through established host imports/pending-input state, applies existing `$input_route_to_owner`, dispatches WAT modal/subtree controls on owner, uses existing modal-key helper, and retains unrelated input through the normal USER queue. Pump checks for completion immediately after dispatch. No shared-ring drain added.
- `test/test-modal-common-dialog-worker.js` SHA `c0b5676305226335bb3a45ceabfc1e53836539afa8679be5f35f9d62575e65f4`: real shared-memory two-instance regression uses actual renderer down/up and `takeInput`; page geometry imports point to the same renderer host as the owner, as in the browser. Synchronous callback exports on the page token throw. Checks IDOK and owning API return; Enter/Escape; release outside button does not activate; unrelated posted/input messages persist; thread2 target receives forwarded input without guest callback.

Private full compile/test PASS(session73725 exit0), WASM `681bd60bb835748c38b73cb805c5a7bd45db706ec53358f5f4e8ba8f0284e6a0`. Negative control compiles the preserved pre-fix09c3a through a private transform and FAILS the intended retained-click/modal-completion assertion(session33973 exit1). Existing renderer-button-queue and modal-input tests PASS, syntax/paren and raw-region census PASS(54). A mistyped nonexistent `tools/check-region-census.js` command was corrected to actual `tools/region-census.js`; no gate failure is hidden.

Canonical remains `2c22cb7d21a5bf9191036bb30b674f959ec554c306b6be69e905a9f53f265e88`. Source is stable for independent/root review; canonical build and ordinary Klotski Win16 far-return qualification still require root scheduling. This is not yet a fixed-game claim. Full evidence in `review.patch`, `review-hashes.json`, `validation.json`, `fixed.wasm` and preserved baseline artifacts.

### Fairness/retry revision, final review snapshot

Root requested fairness and queue-failure review. The initial early return after consumed input could starve paint under continuous mouse traffic; corrected to process at most one input and one existing paint step per pump. Regression queues20mousemoves plus erase damage, verifies erase clears while19events remain. Queue-failure regression privately injects a return0 at the real enqueue helper boundary (simulated overflow allocation failure, not claimed physical heap exhaustion); packed event stays pending across failure, no next host event is polled, and the later successful retry preserves exact original HWND/wParam/lParam. No routing semantics or production queue code changed. Zero→main fallback only affects the local dispatch target; pending originals remain available for normal retry resolution. Shadow local modal state stays0 and its input helper is explicitly guarded; callbacks through the real shadow-instance UI token are forbidden in the regression.

Updated source SHA `7f7b49b08da8117f6fb6db6e50d002d5b050200246cdeabeeab91197d71ab846`, test SHA `09ef4cc42657fbdc95a163c17132f3500dc6f8cd8cd360d5f2ef638af1d48297`, private WASM `58911cad05d88e170f14aa75480f5204a5704cee5f151dcef5df6df50ba31abf`. Full private regression45717exit0 PASS; syntax/paren PASS. Review bundle refreshed. Canonical untouched by this worker.

Offline ordinary qualification is prepared in `scratch/klotski-qualification-20261003`, including explicit new served-module pin,120sTTY guard, reviewed stable visible IDOK, ordinary menu/puzzle/name controls and legal block drag after board review. Exact target geometry checked for Welcome; each later input requires screenshot review. CLI internal commands are never used. No qualification launched; root schedules canonical build and runtime.

### Canonical qualification attempt1: narrow fix confirmed, game incomplete

Root independently reran final regression18728PASS and canonical build2475PASS: WASM `5ff4844e5e4a2cc54d752d2235de9793999a7f0e651015693f01c8dcf4309ce1` (1,657,773bytes). Sole ordinary qualification session12677 served that exact hash and EXE hash above. I personally reviewed stable visible Welcome and live IDOK geometry; actual click(506,406) dismissed it. Owner trace leaves modal0 and resumes guest code. Ordinary Game(48,51)→Level1(70,72)→visible puzzleOK(426,505) created the Daisy board and name dialog. Clicking visible edit(169,132) and typing Codex succeeded. NameOK(204,170) was visible, but its command was not entered before120s guard; no legal move performed.

Session12677exit2, browser/serverclosed12:24:03.602Z, process inspection showed no remaining harness/Chrome processes. No browser/guest faults. Slot explicitly released to Icy6; source/build frozen. Initial Welcome completion is accepted by root independently from the later resource-dialog layout. Puzzle selector body remained blank, and name dialog right/bottom clipped; both are separate layout evidence, not failures of this WAT MessageBox repair.

Immutable diagnostic `scratch/runs/20261003-wep16_klotski-modal-input-repaired/result.json`: reviewed unknown, gameplayScreenshots empty, FPSnull; all94loaded response archives rehashed. Screenshots preserve before/afterWelcome, puzzle selection and typedname overboard. A fresh separately granted route is prepared offline with redundant5s trace cut to500ms,400ms action/readiness delays, learned visible geometry and no overwritten initial review image. Still120s guard; no restart or runtime until root grant.

### Fresh ordinary qualification completed

Root granted a fresh120s route after Icy6 release. Session17791exit0, browser/serverclosed12:28:44.777Z; process inspection clear and slot released before batch10. Same actualserved5ff4844e module,94loaded archives rehashed. Stable visible Welcome IDOK, Game/Level1/puzzleOK, name edit and nameOK all exercised through ordinary browser controls. I personally reviewed the unobstructed Daisy board (`step-06-after.png`) and the result of ordinary drag(246,213)→(246,231) (`step-07-after.png`); root independently viewed both and accepted limited active-gameplay response.

Immutable publication `scratch/runs/20261003-wep16_klotski-gameplay-modal-repaired/result.json`, scoped passed/reviewed, explicit gameplayScreenshots and FPSnull. 616RGBpixels changed in board ROI(218,185,58,62), with actual third-column centre(265,213) olive→gray and(265,231) gray→olive. This is a legal state change; literal pointer coordinates were in an adjacent column, so retain possible picking-offset caveat and do not claim pixel-perfect input or full puzzle correctness. Blank puzzle-selector body/name-dialog clipping remain separately recorded. Prior unknown/failed runs preserved. Source and runtime ownership released; no further production changes.
