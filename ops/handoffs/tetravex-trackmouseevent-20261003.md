# Tetravex TrackMouseEvent repair plan

2026-10-03 — corpus_categories, read-only diagnosis; implementation and runtime not started.

## Exact observed failure

`scratch/runs/20261003-tetravex-gameplay-restored1/result.json` records the ordinary New Game route trapping before a numbered puzzle. Its browser log contains the complete request, so another diagnostic runtime is unnecessary:

- Executable: `test/binaries/wep32-community/Tetravex/Tetravex.exe`.
- PE import is **comctl32.dll!_TrackMouseEvent**, not user32!TrackMouseEvent. `objdump -p` shows import name RVA 0x7560e, IAT 0x473d30. Thunk 0x41d730 jumps through that IAT slot.
- Call at 0x449d24, return 0x449d29. Disassembly at 0x449d00 initializes the structure exactly as the trap stack records.
- Pointer 0x074ffec8: `cbSize=16`, `dwFlags=2` (TME_LEAVE), `hwndTrack=0x10003`, `dwHoverTime=0xffffffff` (irrelevant without HOVER).
- Caller sets an internal tracking flag before calling; returning success without eventual leave notification would strand that state.
- Loaded module SHA256: `3d374324cd29153dd9354b855c98f0c52b44b709facbb8d1b67941fd9f05dddf`.

Neither named API currently has a handler/table entry. Existing toolbar/help WM_MOUSELEAVE consumers do not implement tracking.

## Contract and scope

Microsoft documents [comctl32 _TrackMouseEvent](https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-_trackmouseevent) as forwarding to TrackMouseEvent when available and otherwise emulating it. Implement both exported names against one tracking core; there is no need for two independent state machines.

[TrackMouseEvent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-trackmouseevent) posts notifications. Client leave ends all tracking; hover delivery ends hover tracking. An application must rearm. The pointer must remain within the configured hover rectangle for the timeout; use consistent SystemParametersInfo settings.

The [TRACKMOUSEEVENT structure](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-trackmouseevent) specifies selective CANCEL, QUERY without arming, and NONCLIENT variants. Repeated HOVER resets its timer. An outside HOVER request is ignored; outside LEAVE produces immediate notification and no continuing tracking. QUERY resolves HOVER_DEFAULT to the actual timeout, initially 400 ms.

Smallest useful first implementation is complete **client LEAVE**, QUERY, and selective CANCEL behavior. Support masks explicitly: LEAVE=2, QUERY=0x40000000, CANCEL=0x80000000. HOVER=1 and NONCLIENT=0x10 require real additional behavior before support; retain explicit fail-fast for those valid but unimplemented modes, rather than returning success or silently dropping bits. Unknown flag bits and invalid pointers/size/HWND need deliberate validation/error behavior; pin exact error codes against primary/compatibility evidence before asserting them. This diagnosis did not establish those codes or all flag-combination precedence rules.

## State ownership and integration

- Append API IDs in `src/api_table.json`, generate dispatch and name hashes with the documented generators. Each API has one in/out pointer, BOOL return, stdcall cleanup of return address plus argument (ESP+8).
- Put tracking state in the existing shared-memory USER/thread ownership model, not an instance-local mutable global or renderer-only map. Store target HWND identity/generation, flags, owning thread and (when implemented) hover deadline/anchor/settings. Publish changes with the repository's existing synchronization conventions; never call blocking host imports while holding a shared lock.
- Resolve physical window/client-region hit ownership separately from capture routing. A captured mouse message delivered to a tracked HWND does not prove the pointer is still inside that window. Child windows, overlapping windows, and client/nonclient transitions need explicit hit-region handling.
- Current cursor publication is `lib/renderer-input.js` around line 591; host access is `lib/host-window.js` around line 1143. These are candidate observation points, not permission to invoke guest WndProc on the page instance. Deliver through the existing owning-thread queue (`$post_queue_push`, exported `post_message_q` in `src/13-exports.wat`).
- Observe actual input transitions, including out-and-back moves before the next guest pump; merely polling final cursor position in PeekMessage can miss a leave. Check arming against current physical location as well. Browser canvas exit, guest SetCursorPos, window movement/destruction, and application switching must not leave stale tracking state.
- On exit, enqueue WM_MOUSELEAVE (0x2A3), wParam=0, lParam=0, exactly once, then clear tracking. Queue insertion failure must not silently lose the only notification. Reuse the queue's ownership/destruction conventions; clear on destruction and prevent a recycled HWND receiving an old notification.
- Full hover support should use the guest clock consistently and integrate due-work/wakeup behavior without borrowing a guest-visible timer ID. Add WM_MOUSEHOVER (0x2A1) with correct key flags/client coordinates; NONCLIENT adds WM_NCMOUSEHOVER (0x2A0) and WM_NCMOUSELEAVE (0x2A2) with their documented payloads. Verify payload contracts separately before implementation.

## Meaningful verification

1. Real exported API/dispatch test for both import names, exact 16-byte request, BOOL/ESP cleanup, QUERY writes, and equivalent shared state. Exercise malformed size/pointer/HWND and every declared unsupported flag; no success-only path.
2. Arm inside, move within, cross edge: no early notification; exactly one posted leave with zero payload; further movement emits none until rearm. Arm outside: immediate one-shot leave. QUERY must not arm or reset. CANCEL LEAVE must prevent delivery; cancellation of another mode must not remove leave.
3. Owner isolation: two thread/Worker contexts and unrelated page instance; correct target queue receives notification with no synchronous guest callback on page. Capture outside still leaves; child/overlap/client-to-NC transition follows actual hit region. An out-and-back pair before pump still leaves once.
4. Destroy/recreate target, app switch, cursor relocation, and window relocation cannot notify stale HWND identity. Cover queue insertion failure according to chosen retry contract.
5. When hover is added: deterministic clock below/at deadline, rectangle departure/reset, repeat HOVER reset, HOVER_DEFAULT resolved QUERY, hover fires once while LEAVE remains, and leave cancels both. Test client and nonclient modes independently with exact payloads.
6. Run relevant existing input/capture/queue tests and required canonical build gates. Then one bounded ordinary Tetravex New Game route, record exact WASM/source hashes, verify numbered puzzle and a legal tile interaction; preserve the original failed run. Screenshots do not imply gameplay FPS; keep performance null unless independently measured.

No runtime, source edits, build, or task-status changes were made for this diagnosis.

## Implementation checkpoint (later on 2026-10-03)

Root subsequently authorized the narrow implementation. Before-file snapshots and SHA256 values are in `scratch/track-mouse-event-20261003/before/`; `review.patch` isolates this task from inherited WIP and `review-hashes.json` identifies the review snapshot. Canonical build and ordinary Tetravex qualification remain pending root review at this checkpoint.

Both names now use one shared client-leave core. QUERY precedes target validation, valid cross-thread requests use the HWND owner's record, outside requests preserve another active tracker, zero flags replace active services, and selective CANCEL does not withdraw already-generated notifications. Unsupported HOVER/NONCLIENT/unknown modes retain fail-fast behavior. Thread/window teardown retires state; failed notification enqueue remains pending and is retried by the owner's message pump without another pointer event.

Compatibility corrections were checked against the upstream [Wine NtUserTrackMouseEvent implementation](https://github.com/wine-mirror/wine/blob/master/dlls/win32u/input.c): LEAVE-only requests use the default timeout even when the supplied field is 123; armed QUERY therefore returns 400 for this implementation's fixed default, inactive QUERY returns zero. Bad cbSize maps to 87 and nonexistent HWND to 1400. The defensive invalid-pointer error 998, allocation-failure error 8, and concurrent-producer busy error 170 are local failure policies, **not independently proven Windows error-code parity**. Configurable hover settings remain unsupported.

The tracking-specific physical hit walk includes dialog comboboxes, applies every ancestor's client clip, and does not alter existing click routing. The renderer uses compositor top-level order (including Progman), ignores capture recipient for physical tracking, publishes canvas exit, and refreshes stationary-pointer geometry during repaint. Pure observation only updates shared state and posts to queues; it never calls a guest WndProc on the page instance.

Memory map: new 272-byte MOUSE_TRACKING region at 0x07d16650, ending 0x07d16760; comparison against the saved generated mirror found **no existing base changes**. Capacity is validated using the existing USER queue function (TIDs 1–16). Region mirror was staged privately during batch3, then installed after its explicit runtime release.

Focused tests passed using a private compiled module (`focused-test.wasm` and `focused-test.sha256`): actual second WASM instance sharing memory, owner queues, out-and-back motion before pumping, injected enqueue failure and pump retry without motion, API ABI, QUERY/CANCEL/zero flags, outside-request preservation, thread/window lifecycle, unsupported modes, real WAT combo hit and ancestor clipping. Renderer test covers cross-process overlap, capture independence, client/nonclient transition, stationary visibility change, Progman ordering, and canvas exit. Existing renderer drag-mask, dialog-button-queue, and dialog-modal-input tests also passed. No guest runtime qualification is claimed by these tests.

## Canonical build and ordinary-route result

Independent reviewer coverage_audit and root accepted the scoped implementation. Canonical build completed with every required gate passing; log: `scratch/track-mouse-event-20261003/build-completion.log`. Module SHA256 **d2c455f7b5f834f3fdb52e42e6d37d34343d5864f5273d1b3dac9d2a1a334bff**, 1,656,607 bytes.

Two gate corrections preserved semantics: the new WAT WS_DISABLED check now calls existing `ctrl_style_disabled`; the earlier Hearts groupbox check (already present in this task's before snapshot) now calls existing `_isMouseInputDisabled(hwnd, wasm)` instead of repeating the same flag literal. This is not a claim that the inherited JS literal originated in tracking work. The one-pointer ESP epilogue was formatted on one line for the checker. Both reviewers accepted equivalence; focused and renderer tests passed afterwards.

One ordinary Tetravex route ran and closed successfully (session 39748, exit 0). New Game at (383,285) produces a numbered 3×3 supply and empty puzzle without the former API trap. A single drag (556,328)→(345,328) visibly moves a tile image but leaves repeated image trails across the top row. Work stopped at this new concrete rendering defect; no retry or additional guest mutation followed. Root independently viewed both images and accepted only the clean New Game scene, not fully correct legal-placement rendering.

Published run: `scratch/runs/20261003-tetravex-gameplay-trackmouseevent/result.json`. Outcome **unknown** with rendering caveat, `gameplayScreenshots: ["new-game.png"]`, degraded diagnostic `tile-moved.png`, and `performance: null`. Actual loaded WASM and four JS sources match the frozen source archives; duplicate region-map response also matches. Browser/server cleanup receipt exists; no runtime/build process remains.

The narrow client-LEAVE API task is ready for root closure. Unsupported hover/nonclient modes remain fail-fast. The separate next issue is **Tetravex drag-image trails**: diagnose invalidation/background restoration around the single recorded ordinary drag using saved screenshots/logs; no cause has been established, and no further route is authorized by this handoff.
