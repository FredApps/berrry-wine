# Win16 ordinary setup dialog Worker traps — read-only diagnosis

Owner: corpus_categories. Date: 2026-10-03. Task: WIN16-DIALOG-WORKER-TRAP.

Both failures are real browser Worker traps during ordinary setup input. The exact trapping WASM function is not preserved in the current logs. EIP ending in FF40 identifies the Win16 modal-dialog continuation; it does **not** establish an invalid guest opcode or a broken REP instruction. No runtime, build, or implementation changes were made for this diagnosis.

## Evidence and scope

- `scratch/gameplay-ready-games2-20261003/freecell16/browser.log`: `unreachable`, EIP `0x12ff40`, previous EIP `0x103393`, ESP `0x1120c2`, EBP `0x214a`. Ordinary sequence in sibling `inputs.jsonl`: F3, select-game edit click, Home/Delete, type `1`, OK click. The log does not localize the precise input dispatch that first traps.
- `scratch/gameplay-ready-games2-20261003/mshearts16/browser.log`: `unreachable`, EIP `0x13ff40`, previous EIP `0x109ccb`, ESP `0x1262fc`, EBP `0x6318`. Ordinary sequence: name edit click, type `Player`, dealer radio click, Enter. Dialog clipping and target geometry need review before repeating coordinates.
- Both runs loaded the NE CARDS support successfully. Existing 404 messages alone do not prove missing assets caused these traps. Identity receipts pin WASM SHA256 `6cdc021dbf55ccc68cbcdb22d622adef7a13bb42a4cb56e9c4a8f233f1868886`.
- Exact inputs, screenshots, identity, and logs remain under the two directories above. Gameplay and FPS remain unqualified for these setup failures.

## Source path and diagnostic gap

`src/01-header.wat:3911` defines `WIN16_DLG_PUMP = 0xFF40`. `src/13-exports.wat:223` recognizes the Win16 thunk selector before dispatch, and `src/09e-win16-api.wat:16788` routes this offset to `win16_dlg_pump`. Therefore the recorded guest EIP can remain on the thunk while another WASM helper traps.

`src/09e2-win16-dialog.wat:464` implements the pump. It reads dialog state from the Win16 stack, processes destruction/modeless branches, opens a temporary 32-bit bridge for `GetMessageA`, restores it, then routes ordinary mouse activation or delivers the dialog message. `win16_dlg_park` at line 583 sets this same FF40 continuation with yield reason 6. Mouse activation (`src/09e-win16-api.wat:9592`) can introduce a further invocation-owned stack frame and far callback; this is a candidate boundary to inspect, not an established cause.

Two explicit bridge guard candidates are `win16_arg16` at `src/09e-win16-api.wat:56` (16-bit arguments accessed while a 32-bit bridge is open, diagnostic marker `CA16A9FA`) and `win16_call32_end` at line 447 (EIP changed across the bridge, marker `CA16A9F7`). Other explicit traps remain possible. Current evidence does not select either guard.

`lib/guest-worker.js:550` reduces the caught exception to its message; the returned register snapshot loses the WASM exception stack. `lib/host-imports.js:1736` defaults environment flags to an empty object in browsers and `log_i32` at line 1740 emits only with `DBG_INV`. Absence of the guard markers in these browser logs therefore does not exclude a guard failure.

## Focused next repro, after serial runtime grant

1. Pin the existing loaded WASM and exact registry assets; preserve original failures. Start with FreeCell16 only, and attach a debugger to the guest Worker before input. Enable pause on **all** exceptions, including caught exceptions, to retain the first `unreachable` WASM call frames and function offsets before the Worker catch discards them. Verify debugger attachment to the Worker rather than only the page.
2. Repeat F3 and the ordinary select-game dialog route one action at a time. Save screenshot, HWND/control rectangles, registers, and input timestamp before each edit/OK action. Use the actual visible control bounds; do not assume prior clipped coordinates remain correct. Stop at the first trap; do not retry, skip guards, or modify guest state.
3. Map the trapped WASM function/offset only against the exact matching module and its matching source/build metadata. Capture CS/base, ESP/EBP, recent guest EIPs, and the relevant stack frame. If the trap is a bridge guard, determine the first unexpected EIP or bridge-state transition; if not, follow the actual trap function rather than FF40 alone.
4. After releasing that runtime and with a separate grant, compare the same ordinary inputs under the cooperative backend and the same WASM. A backend difference is currently a hypothesis. Repeat Hearts only after the FreeCell cause is localized or shown distinct.

This is a proposed diagnostic workflow, not an executed debugger experiment. Browser-to-Worker propagation of generic host tracing has not been verified here; do not assume a page tracing flag captures every guard.

## Existing tests do not cover this exact route

`test/test-win16-web.js` configures FreeCell16 with deal command 102; it does not establish that ordinary F3/edit/OK in a guest Worker succeeds. `test/test-win16-hearts-startup.js` is a CLI route using `dlg-set-edit:201`, `dlg-click:203`, and `dlg-click:1`. `test/test-freecell-select-game.js` exercises the PE variant. `test/test-win16-windowpos-defproc.js` has useful synthetic pump/far-callback coverage, but does not replace this real Worker input regression. Once the cause is known, add a targeted regression at the failing bridge boundary plus the ordinary Worker route, without bypassing dialog controls.

## Release

Read-only investigation complete; root retains the correctness blocker. No browser, server, watcher, build, or guest runtime resource was acquired. Only this handoff and append-only coordination entries were written.

## First bounded debugger attempt, 2026-10-03 09:10 UTC

Artifacts: `scratch/win16-dialog-worker-diagnostic-20261003/`. The new JavaScript harness successfully attached CDP Debugger to the guest Worker with pause-on-all-exceptions and loaded WASM SHA256 `6cdc021dbf55ccc68cbcdb22d622adef7a13bb42a4cb56e9c4a8f233f1868886` (actual response hash saved). However, the shell launch did not allocate an interactive PTY. Its readline input reached EOF immediately after startup/ready, before any ordinary setup input, and the harness closed normally. No trap, function mapping, or root cause was captured. This was a harness failure, not evidence the dialog defect disappeared.

The explicit single-attempt limit was honored: no second runtime launched. A separately authorized continuation can reuse `browser.js` with `tty:true` so the ordinary F3/edit/OK input channel remains open. Session 6321 exited 0; `cleanup.json` records browser/server closed at 09:10:06 UTC; subsequent process inspection found no surviving diagnostic harness or Puppeteer browser profile processes.

## Authorized actual-input attempt: precise trap boundary

Root explicitly authorized correcting the prior preinput harness failure with TTY. Evidence is preserved separately in `scratch/win16-dialog-worker-diagnostic-20261003/actual-input/`. Worker debugger attached before input; actual loaded WASM response hash again matches `6cdc021dbf55ccc68cbcdb22d622adef7a13bb42a4cb56e9c4a8f233f1868886`. F3 displayed the clipped select-game dialog. After clicking its visible edit, Home/Delete cleared its number, typing 1 selected the requested game, and clicking visible OK at (366,355) reproduced the trap. Stopped after this first trap, with no retry or fix.

`exception.json` contains the caught WASM stack: `win16_set_sreg → func9420 → win16_dispatch → run → handleMessage`. Independent parsing of the pinned binary code section in `binary-map.json` identifies function 763 at offsets 160695..161033 and function 9420 at 1389876..1390250. Trap offset 160861 is opcode 00 (unreachable). Caller offset 1390001 is bytes `10 fb 05`, call function 763. Combined-source mapping identifies func9420 as `win16_dlg_pump`; this early call is specifically the modeless-return branch at `src/09e2-win16-dialog.wat:485`, restoring CS from the packed return. The trap is the unmapped CS/SS selector guard in `src/05c-seg16-ops.wat`, not either previously proposed 32-bit bridge guard.

The ordinary modal dialog has entered the modeless-return path and attempted to restore an unmapped CS. The branch tests only `dlg == win16_dlg_modeless_pending`; the pending sentinel defaults to zero. A zero dialog handle therefore equals no pending modeless dialog and incorrectly consumes the return frame. This zero/zero match is a concrete structural defect and a likely explanation of this trace, but debugger locals were not captured, so the precise runtime handle/pending values and the earlier cause of a zero/invalid modal frame remain unproven. The repeated guest EIP/previous EIP/ESP match the earlier failure.

Minimal fix proposal: require a nonzero pending modeless handle as well as equality before taking this branch. Preserve the invalid-selector guard. A focused synthetic test in the existing Win16 windowpos/defproc render harness should establish that pending=0/dlg=0 cannot consume a modeless return, and that a real nonzero matching pending handle still returns HWND and restores the correct EIP/ESP. Cover a nonmatching nonzero handle too. This test has been designed, not executed; no canonical source edits or synthetic build were authorized for this stage. Guard-only avoidance must not be declared a full fix if the modal pump frame is already invalid: then locate the ordinary input/EndDialog frame transition and add that regression.

Session 66060 exited 0; cleanup receipt records browser/server closed at 09:11:45 UTC. Process inspection found no surviving harness or Puppeteer profile processes. Source and module stayed read-only.

## Narrow guard implemented; full ordinary route still blocked

Root authorized ownership of `src/09e2-win16-dialog.wat` and `test/test-win16-windowpos-defproc.js`, canonical build, one FreeCell ordinary route, and Hearts only if FreeCell passed. The modeless branch now requires a nonzero pending handle before equality. The selector guard is unchanged. Regression cases cover zero/zero, nonzero dialog with no pending handle, unmatched pending handle, and a real matching modeless invocation with exact return HWND/EIP/ESP/pending-state checks. Existing synthetic callbacks are allowed to retire to the modal continuation before frame assertions.

Focused test PASS (`focused-test.log`). The in-memory old-predicate negative control FAILS because it consumes six bytes of the zero/zero modal frame (`negative-test.log`, `negative-regression.js`), demonstrating the regression detects the defect without modifying canonical source for the negative test. Canonical `bash tools/build.sh` PASS (`build.log`); loaded new WASM hash `3d374324cd29153dd9354b855c98f0c52b44b709facbb8d1b67941fd9f05dddf`.

Ordinary browser validation remains FAIL. Artifacts: `guard-freecell/`. Same F3/edit Home/Delete/type 1/visible OK sequence. The original Worker invalid-CS stack was not captured again; instead the page log reports `RuntimeError: unreachable`, and `after-ok.png`/`settled.png` show the unchanged setup dialog with number 1. No Worker debugger pause was emitted. The harness only enabled exception debugging in attached Worker targets and reduced page errors to their string, so **the new exception stack is missing**. A page-side WASM/RPC callback boundary is a hypothesis, not a localized cause. Do not interpret absence of the original Worker stack as complete repair.

Stopped after the first failed ordinary route; no Hearts run, retry, REP override, or broader fix. Next task should enable caught-exception debugging on BOTH page and Worker before launch, preserve page error.stack, and capture stack/frame state at the first new exception. Then determine whether the modal invocation frame was already invalid before the old zero/zero false match. The correctness task remains open.

Session 58536 exited 0; cleanup records browser/server closed at 09:18:25 UTC. Source changes remain narrowly scoped and uncommitted for root review; canonical build products now carry the new module hash.

## Page + Worker capture: direct page-side Win16 notification execution

Root authorized one new read-only runtime with both page and Worker caught-exception debugging. Evidence: `page-worker/first-exception.json`, `browser.log`, loaded identity, inputs, screenshots, and `binary-map.json`. First exception occurs on the PAGE during visible OK mouse-down, not in the guest Worker. Same module `3d374324cd29153dd9354b855c98f0c52b44b709facbb8d1b67941fd9f05dddf`. Exact trap: function 951, `th_zero_entry`, WASM byte offset 187962 (unreachable).

Captured stack maps to: `th_zero_entry → run → wnd_send_message_inner → wnd_send_message → dialog_default_proc → wnd_send_message_inner → wnd_send_message → edit_notify → edit_wndproc → control_wndproc_dispatch → wat_wndproc_dispatch → wnd_send_message_inner → wnd_send_message → focus_notify_transfer → set_focus → button_wndproc → control_wndproc_dispatch → wat_wndproc_dispatch → wnd_send_message_inner → wnd_send_message → dialog_route_mouse → dialog_route_mouse_screen → renderer handleMouseDown → canvas.onmousedown`.

The renderer at `lib/renderer-input.js:1898` invokes `dialog_route_mouse_screen` synchronously on the page-side instance. Its `_queueNativeDialogChildMouseDown` helper queues only class=0 registered controls; WAT-owned buttons remain direct. Its comment claims those controls only queue notifications, but this actual stack demonstrates a focus transfer from EDIT calls the dialog procedure synchronously. `src/09c3a-dialog-runtime.wat:141` avoids 32-bit recursive entry of a packed Win16 procedure only when that instance's `code16` is true. The taken recursive run path shows that protection did not apply on this page-side instance.

Read-only register retrieval through paused JavaScript frames returned null because the local export object there is named `we`, not the diagnostic's `ex/ctx` probes. WASM scopes were captured as remote descriptors but their boxed numeric values were not dereferenced. A separately labeled **after-caught** page-instance read returned EIP `0xF3316`, ESP `0x1120BC`, EBP 8522, EAX 1, and six 32-bit stack words `[0,65538,273,33554635,65541,199688467]` (`post-trap-registers.json`). EIP is consistent with packed selector `0x000F:0x3316` being treated as a flat address; the synchronous call stack independently establishes entry through the 32-bit window-procedure path. Do not describe these post-catch registers as a stopped-frame snapshot.

Next focused repair proposal: keep ordinary Win16 dialog mouse/focus/notification dispatch on its owning guest execution context, likely by queueing the dialog-child input to the Worker rather than executing native controls on the page. Use explicit ownership/app-mode metadata, not incidental current page `code16`. Preserve existing PE control behavior and queued mouse-up pairing. Add renderer routing regression for WAT BUTTON/EDIT under a Win16 Worker and an ordinary Worker select-game route. This is a proposal; no further source edit or retry occurred.

Session 31603 exited 0 and browser/server closed. First trap captured, remaining inputs ceased, no Hearts run. Root retains implementation ownership decision and unresolved correctness task.

## Worker-owned control routing fix and final bounded validation

Root authorized the narrow renderer correction. Changed only `lib/renderer-input.js` and `test/test-renderer-dialog-modal-input.js` in this stage, preserving inherited test changes. Before snapshots and hashes are in the diagnostic directory. Existing explicit `_guestWorkerWasms` ownership now lets WAT-owned dialog child controls take the existing queued mouse path, in addition to registered native controls. It does not inspect or copy page-side code16. Cooperative WAT/PE controls retain direct routing. The existing matching DOWN/UP record preserves control-relative coordinates and release outside the target. Captured MOVE/UP direct-handler fallbacks also now queue when their instance is Worker-owned.

Mock regression PASS: Worker BUTTON and EDIT queue exact DOWN/UP coordinates despite false shadow is_win16 and an intervening current-instance switch; outside release stays paired. Worker captured MOVE/UP queue exact child coordinates without page callbacks; cooperative capture and registered native cases retain prior behavior. Test log: `renderer-test.log`. Current renderer SHA256 fe00d48ac2cc761ae27f54eb98c258fac795e0526fa9df645d2052622b5d1326; focused test SHA256 77352481dee8a7353de65b6e04024d4b8aaf796b01dc7f63ef6cf5f3c3964111.

FreeCell ordinary route PASS on unchanged module `3d374324cd29153dd9354b855c98f0c52b44b709facbb8d1b67941fd9f05dddf`: F3, visible edit, Home/Delete/type 1, visible OK; game #1 deals. Clicking exposed six of spades in the first tableau then the first free cell visibly moves it. Personally reviewed both board and moved card. Published `scratch/runs/20261003-freecell16-gameplay-worker-route`, explicit gameplayScreenshots=[moved-card.png], performance:null, loaded response identity, ordinary input log, source hash and archived runtime renderer, artifact hashes, cleanup. Runtime renderer SHA256 `e390f765d6bf9baa79417f9d52c8089cad3667ffda48595c140ed8db121f7711` predates the subsequent captured-MOVE/UP guard addition; that addition has mock regression evidence, not a separate runtime receipt.

Hearts ordinary setup remains BLOCKED. `queued-hearts/` shows Player entered, but the visible dealer radio at (64,227) remains unchecked and default connect remains selected after queued mouse down/up and Enter. Buttons remain clipped to the right. Tab/Down/Space/Enter also did not complete setup. No page or Worker exception was captured; do not turn absence of a trap into gameplay acceptance. No Hearts gameplay run was published, and original failed runs remain intact.

Next Hearts diagnostic should inspect, read-only, the visible radio HWND/control id, screen/client rectangles, styles/type, checked state, focus, and the exact queue target/lParam before and after the ordinary click. Input log currently targets HWND0x10008 for down/up. Compare that target against radio control203 from the NE resource; trace which control/window receives dispatch and whether BN_CLICKED reaches the Win16 dialog. The visible point was correct, so retain radio/geometry routing as the blocker rather than assuming a user selection error. Do not blindly retry or mark the overall Win16 setup task complete.

Both bounded runtimes closed (FreeCell session53503 exit0; Hearts10427 exit0), cleanup receipts present, process check clear. No additional runtime or WAT/build edit in this renderer stage. All renderer/test ownership released to root.

Root-requested final checks: test/test-renderer-mouse-drag-mask.js PASS and test/test-renderer-dialog-button-queue.js PASS. Nearby direct-handler comments now explicitly describe cooperative controls. Final renderer SHA256 71913f9ff075a983b234f05ab36e08f81335ba70ccb1f4611e7e04336eb97e42. Published runtime source snapshot remains unchanged and exact; captured-path changes are separately covered by mocks.

## Hearts groupbox routing completeness correction (pre-runtime)

Saved geometry records only the overall viewport/canvas, so it cannot prove live HWND-to-control-id mapping. Resource order is two STATICs, EDIT201, GROUPBOX214, radio202, radio203, OK1, Quit2. Existing log identifies edit HWND0x10007 and clicked HWND0x10008; this makes groupbox214 the likely target rather than dealer203. Exact live id/style/rect capture is pending the next serial runtime grant.

Source confirms an independent routing mismatch: generic `wnd_child_from_point_deep` at `src/10-helpers.wat:5467` filters statics/color grids but does not filter BS_GROUPBOX. Direct dialog routing at `src/09c3a-dialog-runtime.wat:527` explicitly treats class1/style7 as transparent. Worker queue helper used the former, so an overlapping frame could steal the radio click. Its native button activation does not auto-toggle groupboxes; proper radio style9 auto-clears siblings, sets its check bit, then queues parent WM_COMMAND with control id and HWND (`button_activate` in `src/09c3-controls0-basic-wndprocs.wat`).

Root authorized a narrow JS-only correction: when the worker queue helper's deep target is a groupbox, use existing read-only sibling/geometry/style exports to select the underlying visible enabled interactive sibling, excluding static/color/group frames. No page-side dispatch, generic hit-test replacement, WAT edit, or build. Regression reproduces overlapping frame/radio and hidden/disabled/static distractors, verifies dealer target/local coordinates and inert frame behavior. All three focused renderer tests pass. Runtime waits on DX-Ball owner's explicit cleanup release; next capture records all actual control HWND/id/class/style/screen rectangles before the dealer click.

## Hearts correction verified, limited gameplay published

Serial slot explicitly lent by coverage_audit. Actual live controls-before.json proves HWND0x10008 is GROUPBOX214/style0x50000007 at (48,155),290x100; dealer is HWND0x1000A/id203/style0x50010009 at (58,215),262x24. Generic hit at (64,227) returned the groupbox. The corrected queued route selects the dealer visibly. Enter alone did not close setup; ordinary click on the visible OK edge at (372,90), within actual control1 rect (370,79),100x28, closes it. F2 starts a deal; Play offline dismisses the host online-signin prompt. Three ordinary card clicks and Pass Left exchange the selected cards, showing replacements and Press OK to accept cards.

Personally reviewed dealer selection, dealt board, selected pass cards and replacements. Published `scratch/runs/20261003-mshearts16-gameplay-worker-route` with explicit selected-pass.png/passed.png gameplay allowlist, exact actual-response WASM3d374 and renderer SHA256db595d8dd701a9dc3d1a3b188c32238f72d6c2f365807a51f94a79839a2f712b, archived source, controls/inputs/cleanup/artifact hashes, performance:null. Full game and FPS remain unqualified; clipped setup geometry remains an independent visible defect.

Hearts session93660 exited0/browser+serverclosed. Serial runtime explicitly returned to coverage_audit before further work. Renderer/test groupbox correction released; read-only DX-Ball helper review follows.
