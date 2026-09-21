# Review P5-3: Win16 positioning bridge and deferred gap

2026-09-19: the two Win16 positioning wrappers duplicated insert-after
conversion, but performed it **after** calling the Win32 handler. A mapped
sibling therefore reached the host first as 257, then as the correct 65538.
The extra top-level update was observable; it was not just dead duplication.

Both wrappers now use `$win16_position_insert_after` before entering the
shared handler. Ordinary HWNDs widen once, 0/1 retain their pseudo-handle
meaning, FFFF/FFFE become -1/-2, and NOZORDER bypasses translation of the
ignored argument. The shared post-call bridge still updates USER order and
forwards child order, but no longer repeats the host's top-level update.

`test/test-win16-windowpos-zorder.js` executes both real Pascal wrappers,
covering top-level and child windows, mapped handles, all four pseudo-handles,
an unmapped ignored argument, far return and stack cleanup. The original
implementation fails the first mapped-handle case with two host updates;
the fixed implementation passes. This test preserves the current immediate
Defer behavior only to exercise its conversion; it is not a batching oracle.

The Win32 deferred-transaction and WINDOWPOS changing/changed regressions
pass, as does the full canonical/compat build. Evidence:
`/private/tmp/wa-win16-zorder-before.log`, `wa-win16-zorder-after.log`,
`wa-win16-zorder-defer32.log`, `wa-win16-zorder-changing.log`,
`wa-win16-zorder-build.log`.

## Original gap: real Win16 transactions (addressed below)

At the original audit, Win16 Begin returned constant 1, Defer applied immediately, and End
returns success without committing anything. This differs from the shared
Win32 HDWP implementation, which owns storage and validates queued entries.
Comments claiming equivalent behavior have been corrected.

Microsoft describes retained updates in
[DeferWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-deferwindowpos)
and commit-time window-position notifications in
[EndDeferWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enddeferwindowpos).
These current references establish the intended transaction contract, not a
new native Win98 measurement.

The remaining implementation needs a mapped live HDWP, shared queue and
validation, plus a stack-owned Win16 continuation that sends far-procedure
size notifications at End rather than Defer. Simply calling the Win32 End
handler would lose the current synchronous Win16 callback path. Required
tests: unchanged geometry/messages before End, independent batches, invalid
and retired handles, failure cleanup, and reentrant far callbacks that finish
before End returns. The remaining large wrapper duplication should be removed
as part of that change, not used to disguise the immediate-execution shortcut.

## 2026-09-20: shared commit preparation

Extracted `$hdwp_prepare_end(handle)` from the Win32 End handler. It validates
the entire batch, preserves existing abort/error behavior, and marks the
record busy. It returns the record or zero without changing EAX, ESP or EIP.
The Win32 handler still owns its return value, stack cleanup and apply loop.

The original transaction regression passes before and after extraction.
Added direct tests for frame neutrality, busy rejection without releasing
the outer record, retired-handle rejection and 32 release/reuse cycles.
The visibility regression fails its queued-paint assertion (`0 != 65538`),
identically with the original End validation restored in memory; no test
expectation was weakened. Logs: `/private/tmp/wa-hdwp-prepare-before.log`,
`wa-hdwp-prepare-after.log`, `wa-hdwp-prepare-visible.log`,
`wa-hdwp-prepare-visible-baseline.log`, `wa-hdwp-prepare-build.log`.
The full canonical/compat build and gates pass.

Implementation design (now realized below): Win16 Begin/Defer use the shared HDWP storage; End uses
this preparation helper and keeps `{record, next-index}` on its own guest
stack above the ordinary far-return continuation. Each entry is handed to
the existing Pascal SetWindowPos bridge with a dedicated continuation return
address. That bridge already delivers synchronous far WM_SIZE callbacks, so
the next entry can resume only after the previous callback returns. Retain
the busy record until the final entry, then release it and the Win16 handle.
This avoids a second queue, a second validator, and global callback state.
At this prerequisite commit the Win16 transaction implementation was still pending.

## 2026-09-20: Win16 transaction implementation

Begin/Defer now use the shared HDWP allocation and queue, with mapped Win16
handles and signed 16-bit coordinates/counts. Defer no longer calls
SetWindowPos or enters a size callback. End uses the shared complete-set
validator, marks the batch busy, and owns an eight-byte `{record, next-index}`
frame above its ordinary six-byte far-return continuation.

The new FF9C continuation marshals each queued record into the existing
Pascal SetWindowPos bridge. A far WM_SIZE callback returns through that
bridge, then the batch continuation advances. The final step releases the
record and handle mapping and restores the original End return address.
Nested commits have independent guest-stack frames, with no global scratch
or duplicate transaction storage. Busy recursive commits fail without freeing
the outer batch. Failed queueing/validation releases the corresponding mapping
when the shared record has been retired.

Verification:

- The old Win16 implementation fails the new test at independent batch
  identity (both Begin calls returned 1).
- `test-win16-defer-window-pos.js` passes delayed geometry, signed coordinates,
  growth, independent empty/live batches, negative count, invalid window,
  mixed-parent abort, End-time reparent validation, consumed handles and 32
  reuse cycles.
- A real x86 Win16 wndproc increments a counter and RETF 10; the callback
  finishes before End returns. A second real wndproc attempts a recursive
  End on its busy outer batch (fails), commits an independent inner batch
  with its own far callback (succeeds), then resumes the outer batch's next
  entry. Result, original CS:IP, ESP and observed move order all pass.
- The z-order regression now creates a real batch and asserts no host order
  update until End, retaining top-level/child/sentinel/NOZORDER coverage.
- Wrong-kind handles (a live HWND passed as HDWP) fail without retiring the
  unrelated window mapping. Only a formerly live batch retired by the shared
  operation has its mapping removed on failure.
- Win32 HDWP lifecycle and Win16 rectangle-bridge regressions pass. Real
  Rodent and Rattler gameplay tests both pass. Full canonical/compat build
  and all gates pass.

Logs: `/private/tmp/wa-defer16-before.log`, `wa-defer16-final.log`,
`wa-defer16-zorder-final.log`, `wa-defer16-win32.log`, `wa-defer16-rect.log`,
`wa-defer16-vb.log`, `wa-defer16-final-build.log`.

This fixes Win16 queue/commit timing and preserves its synchronous WM_SIZE
path; it is not a claim of complete native notification equivalence. The
underlying Win16 SetWindowPos bridge's coverage of WINDOWPOSCHANGING/CHANGED
and WM_MOVE remains a separate gap. The previously reproduced queued-paint
test failure was separate and was not hidden by this change; its resolution
is recorded below.

## 2026-09-20: queued-paint regression resolved

The visibility test expected the shown EDIT to remain queued after End.
However, SetWindowPos synchronously calls the native painter, and the shared
native dispatch now consumes the completed update. A zero pending handle
therefore did not demonstrate a missing paint.

The test now records the existing `ctrl_paint_trace` import and requires one
successful native-paint dispatch at End, no remaining child update region,
and no pending child paint. It also requires no native paint during Defer,
on hiding, or with SWP_NOREDRAW, while retaining the exposed-parent damage
check. These checks pass. An in-memory mutation replacing the native paint
dispatch with a no-op fails the new exactly-once paint assertion. No runtime
code or queue behavior was changed to satisfy the test.

Logs: `/private/tmp/wa-defer-paint.log`, `wa-defer-paint-negative.log`,
`wa-defer-paint-order.log`. This verifies dispatch/update bookkeeping, not a
new pixel-level or native Win98 timing comparison.

## 2026-09-20: Win16 default WINDOWPOSCHANGED processing

Microsoft's *Windows 3.1 Programmer's Reference*, volume 3, printed pages
210–211 and 424, documents a FAR pointer to seven Win16 WINDOWPOS fields and
assigns WM_MOVE/WM_SIZE generation to DefWindowProc. The original Microsoft
manual is available from this [archive mirror](https://bitsavers.trailing-edge.com/pdf/microsoft/windows_3.1/Windows_3.1_Programmers_Reference_Volume_3_Messages_Structures_and_Macros_1992.pdf).
Read via local PDF/text copies `/private/tmp/wa-win31-messages.{pdf,txt}`;
no Wine source used.

The Win16 default procedure previously forwarded the unconverted segmented
pointer to the Win32 handler, which expects 28 bytes rather than 14. It now
reads the Win16 flags at offset 12 and uses a stack-owned `{hwnd,flags,stage}`
continuation to deliver far Pascal geometry callbacks. Its return record
preserves the caller and zero DX:AX. Nested calls have independent flags and
stages; the stage advances before each callback. The window is revalidated
before the next delivery. Native procedures retain their synchronous path.

Both widths share the existing `client_rect_wh_packed` helper for committed
client size, eliminating the Win32 sender's open-coded copy. Origins use the
existing parent-relative/top-level coordinate helper, not WINDOWPOS outer
geometry. The MOVE-then-SIZE order preserves the shared implementation;
the cited manual does not independently establish that exact order.

`test-win16-windowpos-defproc.js` executes actual x86 RETF callbacks and an
actual nested CALL FAR to USER.107. Before the fix, its first case receives
no messages instead of move/size. Coverage includes all four NOMOVE/NOSIZE
combinations, signed top-level client coordinates, child coordinates relative
to the parent's client, poisoned request geometry, adjacent input guards,
nested calls with different flags, original far return and complete stack
cleanup. Logs: `/private/tmp/wa-defpos16-{before,final}.log`.

The shared Win32 mutation test, Win16 deferred/nested transaction regression,
Rodent/Rattler gameplay, and full normal/compatibility builds also pass:
`/private/tmp/wa-defpos16-{win32,defer,vb,build}.log`.

This fixes default processing as a prerequisite, not the entire positioning
pipeline. Win16 SetWindowPos/MoveWindow still need to send mutable CHANGING
and final CHANGED, and replace their direct WM_SIZE shortcut with this default
processing. Minimized/maximized size classifications and native Win98 event
comparison remain separate fidelity checks.

## 2026-09-20: SetWindowPos far transaction connected

Win16 SetWindowPos now sends CHANGING before committing and CHANGED afterward
to a far application procedure. Its previous unconditional WM_SIZE shortcut
is removed. A procedure consuming CHANGED gets no derived geometry messages;
one chaining to USER.107 gets them through the default continuation above.
EndDeferWindowPos inherits this sequence at commit time.

Each invocation keeps a 60-byte frame over its ordinary far-return record:
an immutable target/original-flags/stage header, the 14-byte far WINDOWPOS,
and a 28-byte canonical commit result. FFA4 resumes after each guest callback.
Mutation is read after CHANGING, with signed coordinates, mapped insertion
handles and protected NOACTIVATE/NOOWNERZORDER flags. The same far structure
receives the committed geometry and normalized NOMOVE/NOSIZE flags. A changed
`hwnd` field cannot redirect the operation; destruction of the actual target
during CHANGING causes failure without a host geometry/Z-order update.

The Win32 ABI wrapper now calls `set_window_pos_core`, which also accepts an
external result buffer for the Win16 transaction. This retains one geometry,
visibility, non-client calculation and retained-DC implementation. A zero
buffer retains Win32 notification dispatch. Both notification mechanisms call
`windowpos_finish_paint` only after CHANGED returns, rather than painting in
advance of an asynchronous far callback. Native Win16 control procedures keep
the existing bridge.

The expanded actual-x86 regression covers mutable negative coordinates/size/
Z-order, protected flags, immutable target identity, identical far-pointer
lifetime across both notifications, consumed versus default-processed CHANGED,
NOSENDCHANGING, no-op suppression, nested SetWindowPos calls with distinct
stack-owned structures, and an actual USER.DestroyWindow call from CHANGING.
Original EIP, ESP and BOOL return are checked. Restoring the old Win16 source
in memory makes the new assertion fail with `[WM_SIZE]` rather than
`[WM_WINDOWPOSCHANGING, WM_WINDOWPOSCHANGED]`.

The deferred test now chains CHANGED to DefWindowProc and counts only WM_SIZE;
it still proves callback completion before End, nested independent commits,
busy outer-batch rejection and outer continuation recovery. Counting every
message as a size callback would mask the notification fix.

Passing: far notification/default regression, native Win16 Z-order, Win32
changing/mutation, deferred visibility, parent/child paint ordering, Win16
deferred/nested transactions, Rodent/Rattler gameplay and both build modes.
Logs: `/private/tmp/wa-setpos16-before.log`, `wa-setpos16-final.log`,
`wa-setpos16-native.log`, `wa-setpos16-win32.log`, `wa-setpos16-visible.log`,
`wa-setpos16-paint-order.log`, `wa-setpos16-defer-final.log`,
`wa-setpos16-vb-final.log`, `wa-setpos16-build-final.log`.

Still open: MoveWindow's separate Win16 direct-size path, default CHANGING
min/max validation, minimized/maximized WM_SIZE classifications, and native
Win98 event-order comparison. This transaction change does not establish those.

## 2026-09-20: MoveWindow joins the far transaction

Win16 MoveWindow now enters the same stack-owned CHANGING/CHANGED continuation
as SetWindowPos, with six Pascal arguments and MoveWindow's initial
NOACTIVATE/NOZORDER and bRepaint-derived NOREDRAW flags. It no longer sends a
direct WM_SIZE when an app consumes CHANGED. The private frame's formerly
reserved word records the operation, so nested SetWindowPos and MoveWindow
calls cannot select each other's commit/finish path.

Its existing geometry/retained-DC logic is now `move_window_core`, shared by
both ABI front doors. `move_window_finish` retains non-client invalidation,
dialog erase, startup pending-size refresh, resize invalidation and the call
to UpdateWindow after CHANGED returns. It uses the commit's normalized NOSIZE
flag to distinguish a resize and reads the current client size for pending
startup notification, including geometry changed by a nested callback.

The shared core also rejects missing targets before host mutation, and the
Win16 native bridge now preserves failure instead of overwriting it with 1.
Callback-enabled Z-order was another silent discrepancy: MoveWindow reported
the mutated insertion target but never sent it to the host. The top-level
commit now forwards it when the callback clears NOZORDER; the existing Win16
child-order bridge remains shared with SetWindowPos.

Tests cover consuming versus default-processing CHANGED, mutable geometry and
Z-order, TRUE/FALSE repaint flags, no update region under NOREDRAW, mixed nested
MoveWindow/SetWindowPos calls, destruction during CHANGING, invalid targets,
and exact Pascal frame cleanup. The Win32 regression checks callback-enabled
Z-order and invalid targets too. Restoring the old Win16 source fails because
host geometry is already committed when the test expects to enter CHANGING.

The [Microsoft MoveWindow contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-movewindow)
also requires immediate repaint through UpdateWindow when bRepaint is TRUE.
**That Win16 far-paint behavior remains incomplete:** `update_window_now`
still defers far-procedure painting. The test checks flags but deliberately
does not require deferred paint as the expected native behavior. This is the
next fidelity gap, not a completed repaint claim.

Evidence: `/private/tmp/wa-movepos16-before.log`, `wa-movepos16-final.log`,
`wa-movepos32-final.log`, `wa-movepos16-defer.log`, `wa-movepos16-paint.log`,
`wa-movepos16-vb.log`, `wa-movepos16-build.log`. Notifications, Win32 mutation,
Win16 deferred callbacks, parent/child paint ordering, Rodent/Rattler gameplay
and normal/compatibility builds pass. Default CHANGING min/max behavior,
minimized/maximized size classifications and native Win98 event comparison
remain open alongside far synchronous paint.

## 2026-09-20: synchronous Win16 UpdateWindow and initial erase

Win16 UpdateWindow no longer invalidates the entire window and returns before
painting. It shares damage/native-control preparation with Win32, then uses
an eight-byte invocation-owned `{hwnd, stage}` guest-stack frame (FFA8) for
far erase/paint callbacks. MoveWindow(TRUE) enters the same path after its
position notifications. Clean windows send nothing; partial damage remains
partial; BeginPaint/EndPaint own validation, not the sender. Each callback
stage advances before entry and revalidates the target on return.

This follows the direct, non-queued paint contract in Microsoft's
[UpdateWindow documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-updatewindow).
It is not a claim of complete Win98 painting equivalence: pending erase is
still sent before WM_PAINT, following the existing Win32 implementation,
rather than entered from within BeginPaint. Erase-return/fErase handling and
an exact native event trace remain follow-ups. Microsoft's
[WM_ERASEBKGND documentation](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-erasebkgnd)
specifies that the callback result controls whether further erasing is needed;
this change does not implement that missing result handling.

The real-game check caught a second shortcut: ShowWindow posted its initial
WM_ERASEBKGND. Tetris's newly synchronous UpdateWindow tiled its client, then
the posted erase wiped those tiles with the gray class brush. The old build
passed the existing screenshot assertion; the first candidate failed it.
No assertion was weakened. ShowWindow now completes the initial erase before
returning through a twelve-byte `{hwnd, client-size, pending-bits}` frame
(FFAC), also retaining its synchronous maximize callback. A nested
UpdateWindow can consume the erase; the outer ShowWindow then skips it.
Queued activation/restored-size behavior and child exposure handling remain
separate limitations, not implicitly fixed by this change.

Coverage and outcomes:

- Actual far BeginPaint/EndPaint, original partial rectangle, clean/hidden
  updates, nested UpdateWindow, MoveWindow(TRUE) completion, destruction in
  erase, narrowed HDC and exact far-return/stack restoration pass.
- ShowWindow completes initial erase without posting one, does not repeat it
  on an already-visible window, and tolerates UpdateWindow inside maximize.
- Restoring the old UpdateWindow body fails the clean-damage test. Restoring
  the old ShowWindow body fails the synchronous initial-erase assertion.
- WEP1 gameplay passes **8/8**, including Tetris's original About-background
  and hard-drop checks. Rodent/Rattler and Hearts startup pass. Shared Win32
  parent/child painting and Win16 deferred/nested transactions pass.
- Solitaire's opening deal and all seven columns render. Its drag assertion
  fails on both candidate and pre-change baseline (unchanged column pixel
  count); that separate failure is recorded, not suppressed or called a pass.

Evidence: `/private/tmp/wa-update16-clean-negative.log`,
`wa-update16-show-negative.log`, `wa-update16-show-final.log`,
`wa-update16-tetris-baseline.log`, `wa-update16-wep1.log` (first-candidate
failure), `wa-update16-show-wep1.log`, `wa-update16-show-vb.log`,
`wa-update16-final-hearts.log`, `wa-update16-final-win32.log`,
`wa-update16-final-defer.log`, `wa-update16-show-solitaire.log`,
`wa-update16-show-solitaire-baseline.log`, `wa-update16-final-build.log`.

## 2026-09-20: BeginPaint bridge ownership prerequisite

Extracted `begin_paint_core(hwnd, paintstruct, win16_bridge) -> HDC`. The
Win32 handler now owns only its ABI result/stack cleanup; Win16 calls the
same stack-neutral core directly instead of constructing a synthetic Win32
frame. The Win16 canonical PAINTSTRUCT occupies 64 bytes on that invocation's
guest stack, replacing global `GUEST_STACK` scratch. The temporary global
`win16_beginpaint_call32` is removed; bridge-specific policy is an explicit
argument. Existing Win16 child-fill and clip behavior is preserved even
though calling the core no longer temporarily changes `code16` to zero.

This is preparation for BeginPaint-owned erase callbacks, **not** a fix for
their timing/result semantics. The current brush-derived fErase shortcut,
last-registered class-style lookup and empty-region fallback are still
present. In particular, the Diablo warning attached to the fErase shortcut
must be investigated with real paint sequencing, not removed blindly or
treated as the Windows contract.

The focused test now checks that the core preserves EAX/EDX/ESP, and that
the real Pascal bridge preserves global scratch, adjacent output guards,
partial rectangle, narrowed HDC and far return/argument cleanup. The
existing actual nested paint callbacks also pass. An in-memory mutation
restoring global scratch fails the new scratch-preservation assertion.
WEP1 passes 8/8, Rodent/Rattler pass, shared Win32 parent/child painting passes,
and the normal/compatibility builds pass.

Evidence: `/private/tmp/wa-begin-core-far-final.log`,
`wa-begin-core-scratch-negative.log`, `wa-begin-core-win32.log`,
`wa-begin-core-wep1.log`, `wa-begin-core-vb.log`, `wa-begin-core-build.log`.

## 2026-09-20: default erasing borrows the supplied DC

The next erase-path audit found that DefWindowProc ignored WM_ERASEBKGND's
wParam HDC, allocated a different window DC, and returned success with no
class brush. That made a future BeginPaint callback unable to honor its
update-region clip or distinguish an unhandled erase. Microsoft's
[WM_ERASEBKGND contract](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-erasebkgnd)
defines the supplied DC and requires a nonzero result only when erasing is
handled; a NULL class brush leaves the application responsible.

`erase_background_dc(hwnd, hdc, brush)` now performs the shared fill using
the borrowed DC's existing clip/mapping and returns the rasterizer's result.
It neither allocates a substitute nor releases the supplied handle. Missing
DC or NULL class brush returns zero. DefWindowProcA uses it; the encoding-
neutral W branch delegates to A instead of maintaining another erase policy.
The Win16 bridge already widens the DC and therefore shares the fix too.
Internal exposure callers retain their owned-DC wrapper, including its
intentional no-op success for a NULL brush (used by the list-view, which
paints its background itself); that is separate from the public default
procedure's NULL-class-brush result.

`test-default-erase-dc.js` checks all 768 pixels of a caller-supplied memory
DC with a restricted clip, through A/W and the real Pascal Win16 bridge.
It checks NULL brush/missing DC results, unchanged pixels on failure, caller
DC reuse and ABI stack cleanup. The original code fails at the first pixel
inside the clip: it painted a different surface and left the supplied DC
white. The fixed version passes. Existing far positioning/painting and
Win32 parent/child tests pass; WEP1 passes 8/8 and Rodent/Rattler pass.
Normal and compatibility builds pass.

Logs: `/private/tmp/wa-erase-dc-before.log`, `wa-erase-dc-all-abi.log`,
`wa-erase-dc-far.log`, `wa-erase-dc-win32.log`, `wa-erase-dc-wep1.log`,
`wa-erase-dc-vb.log`, `wa-erase-dc-final-build.log`.
BeginPaint callback timing and propagation of the result to fErase remain
open; this corrects the default callee, not the entire paint transaction.

## 2026-09-20: BeginPaint callback candidate rejected by browser regression

Saved the **not integrated** Win32 candidate at
[`experiments/beginpaint-erase-candidate.patch`](experiments/beginpaint-erase-candidate.patch).
It sends WM_ERASEBKGND from BeginPaint after installing the paint DC clip,
sets fErase from the actual callback result, retains a declined erase, and
removes UpdateWindow's premature erase. Win16 still uses its legacy branch;
this candidate is neither a complete implementation nor safe to enable.

The executable contract probe is:

```sh
node tools/probe-beginpaint-erase.js
```

**Expected current-main result: FAIL.** This deliberately unintegrated probe
is not registered as a passing regression test. It exercises eight combinations
of erase requested/not requested, NULL/non-NULL class brush and zero/nonzero
callback result, then repeats with a non-erasing invalidation. It also runs an
actual nested x86 WM_PAINT -> BeginPaint -> WM_ERASEBKGND sequence and checks
the supplied paint DC, fErase, partial rectangle, callback depth and stack.
Promote it into the regression suite when the complete runtime fix is ready.
The saved candidate passes this probe. Current main first fails by reporting
fErase=TRUE for a NULL brush even without an erase request.

The candidate passes parent/child painting, Win16 far callbacks, WEP1 8/8,
and both builds, **but fails the real Diablo browser menu assertion**: red
selection markers are absent and the client is near-black. Restoring the
erase bit when the callback returns zero passes the repeated-cycle probe,
but still fails the same browser assertion. Neither implementation is a
verified fix. The first browser run passed while compilation was still in
progress; that run is excluded as candidate evidence because it could have
loaded the previous artifact. Both failures were runs started after their
respective candidate builds completed. No screenshot assertion was weakened.

Runtime source was restored to the preceding verified implementation; only
this report, the candidate patch and the explicit failing probe are retained.
The restored normal/compatibility build passes, and a fresh browser run passes
all six Diablo stages through gameplay (`wa-begin-erase-diablo-restored.log`,
captures in `/private/tmp/wa-begin-erase-diablo-restored`). This is an observed
restoration, not an assumption that reverting the candidate fixed the game.
The saved patch passes `git apply --check`; use an isolated test copy if
reapplying it, since its browser regression is known.
Evidence:

- `/private/tmp/wa-begin-erase-before.log`: original contract failure.
- `wa-begin-erase-nested.log`, `wa-begin-erase-persist.log`: candidate probe passes.
- `wa-begin-erase-diablo-verified.log` and `wa-begin-erase-diablo-persist.log`:
  both fail the main-menu marker assertion.
- `/private/tmp/wa-begin-erase-diablo-verified/03-main-menu.png`: inspected
  near-black menu; the corresponding `-persist` directory retains the repeat.
- `wa-begin-erase-order.log`, `wa-begin-erase-children.log`,
  `wa-begin-erase-far.log`, `wa-begin-erase-wep1.log`: narrower passing checks.

Next investigation must observe the **whole erase lifecycle**. Concrete
competing consumers still present: GetMessage/PeekMessage clear NC_FLAGS bit 2
when synthesizing an erase; the native modal pump clears it and fills directly;
the dialog default procedure also has its own erase/paint shortcut. These are
code findings and plausible causes, **not a traced explanation of Diablo's
failure yet**. Trace pending flags and callback results around Storm's class-
brush changes and repeated menu paints before replacing the old brush-derived
fErase behavior. Then connect the Win16 far BeginPaint continuation and remove
its legacy branch, with the browser regression required alongside the probe.

## 2026-09-20: traced erase-state losses and hidden-scan correction

`tools/probe-erase-lifecycle.js` builds an instrumented WASM in a temporary
directory, without editing sources or the shipping artifact. It traces NC
erase sets/clears, hidden-window scans, BeginPaint entry and returned fErase,
with HWND, flags and guest EIP/caller. `--candidate` applies the saved rejected
patch in memory. Patch anchors use the compiler's byte-to-source conversion
(UTF-8 comment punctuation is normalized); ambiguous or stale anchors fail.
This is a cooperative-mode diagnostic, not a performance benchmark.

```sh
node tools/probe-erase-lifecycle.js --candidate --app=diablo_shareware \
  --batch-size=200000 --tick-ms-per-batch=20 --max-batches=1100 \
  --max-seconds=90 --no-close --repaint-every=100
```

Two actual state losses are now observed, not just suspected:

1. Creation sets bit 2 on hidden children 0x10003/0x10004. `nc_flags_scan`
   directly clears it while those windows are effectively hidden. Before
   this fix, 0x10004's first BeginPaint arrives with flags=0. This clear did
   not call `nc_flags_clear`, which is why tracing only that helper missed it.
2. With the callback candidate, BeginPaint on 0x10002/0x10003 returns fErase=1
   and retains bit 2 after the erase is declined. The bit is then cleared
   while Storm polls messages at runtime 0x7a8b48, return 0x7a8b58.
   The logged Storm base is 0x7a1000; disassembly at original 0x15007b48
   identifies the call at 0x15007b52 to IAT 0x15036688. The import table
   identifies that slot as PeekMessageA (USER32 IAT 0x36634, index 21).

The production fix in this step is **only loss 1**: hidden scans retain the
erase bit, skip delivery, and continue to subsequent windows. Existing
non-client calculation/paint handling is otherwise unchanged. Destruction
still clears the slot. A new regression fails on the original code and
checks hidden parents, visible children under hidden parents, repeated and
combined-mask scans, fairness to a later visible window, exposure and cleanup.

The repeated instrumented candidate run now sees 0x10004's first BeginPaint
with flags=2, proving that exposure preserves the original request. The
later PeekMessage consumption still occurs and subsequent calls again see
flags=0. Thus the hidden fix does **not** establish that the saved candidate
is ready to integrate. Next: correct the queued/synchronous erase distinction
without duplicating state, then rerun the contract and browser oracles.

Evidence: `/private/tmp/wa-erase-lifecycle-main.log`,
`wa-erase-lifecycle-candidate.log`, `wa-erase-lifecycle-hidden-title.log`
(pre-fix hidden clears), `wa-erase-lifecycle-preserved.log` (post-fix),
`wa-hidden-erase-before.log`, `wa-hidden-erase-after.log`.

Verification of the production hidden-scan fix: normal/compatibility builds,
Diablo's six-stage browser flow through gameplay, WEP1 8/8, Rodent/Rattler
and shared parent/child paint ordering pass. Logs:
`/private/tmp/wa-hidden-erase-{build,diablo,wep1,vb,order}.log`;
browser captures: `/private/tmp/wa-hidden-erase-diablo/`.

## 2026-09-20: message retrieval no longer consumes pending erase

Removed the GetMessage/PeekMessage branches that manufactured queued
WM_ERASEBKGND from NC_FLAGS bit 2, then cleared the request on retrieval.
An outstanding erase belongs to the paint lifecycle, not to the posted FIFO.
Explicitly posted WM_ERASEBKGND still travels through that FIFO unchanged.
The message-wait wake mask now includes only NC calculation/paint (5), not
erase (2) or persistent default-erase ownership (8), so retaining a declined
erase cannot itself create a permanent wake/retry loop.
The wake check also explicitly recognizes the legacy main-window
`paint_pending` global, before the paint selector mirrors it into per-window
flags. The regression caught that omission: such a paint previously depended
on its erase bit to wake, and must continue waking without that accidental
dependency. Both main-global and per-window paint wake cases are covered.

This distinction follows Microsoft's [WM_ERASEBKGND contract](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-erasebkgnd)
(sent, and an unhandled erase leaves the window marked for erasing) and
[PeekMessage contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-peekmessagea)
(dispatch sent messages, retrieve posted messages). It is not a claim that
every other painting path now matches Win98.

The expanded `test/test-nc-flags-message-wake.js` fails before the fix because
PM_NOREMOVE retrieves an erase that was never posted. It passes after the fix:
both peek modes and GetMessage preserve the request; erase-only state stays
idle; explicitly posted erase wakes, survives PM_NOREMOVE, and is removed by
either API with its HWND/wParam/lParam intact and without validating erase.

The same isolated candidate trace command above now reports no erase clears
at Storm's PeekMessage caller 0x7a8b48; repeated 0x10004 BeginPaint results
retain fErase=1 and flags=2. Log:
`/private/tmp/wa-queued-erase-candidate-trace.log`. This is lifecycle evidence,
not browser validation of the saved BeginPaint candidate, which remains
**unintegrated**. Its next gate is the completed-artifact browser flow.

Verification logs in `/private/tmp/wa-queued-erase-*.log`: `before` fails the
new retrieval assertion, `after` passes retrieval and wake cases; `filter`,
`order`, `far`, and `hidden` pass; `wep1` passes all eight games. `build` and
`final-build` pass normal/compatibility builds. `diablo` passes the six-stage
browser flow before the additional main-global wake check.
`final-diablo` also passes all six stages on the completed final build,
including the main-global wake check; captures are in
`/private/tmp/wa-queued-erase-final-diablo/`.

Rodent2000 is **not green in this shared-tree run**: `vb` fails its board
color assertion (floor/tiles/tileInk/frame all zero). An isolated artifact
built from the same source tree but replacing both edited runtime fragments
with their `7471c624` contents fails identically (`vb-baseline`). The baseline
artifact is `/private/tmp/wa-queued-erase-baseline.wasm`; no production files
were reverted to produce it. This comparison does not identify the cause;
retain the failure rather than claiming that the earlier Rodent pass still
applies to today's shared worktree.
The final pinned shipping artifact repeats the same Rodent failure
(`vb-final`), consistent with that baseline comparison.

## 2026-09-20: Win32 BeginPaint callback integration after lifecycle fixes

Retested the archived candidate **after** hidden-scan preservation (`7471c624`)
and removal of the queued-erase consumer (`80f6174c`). Unlike the earlier
rejected attempts, the completed-build browser test now passes all six Diablo
stages through gameplay, including both menu selection markers. The runtime
change is now integrated, not merely an isolated passing experiment:

- Win32 BeginPaint sends pending WM_ERASEBKGND after installing its paint DC's
  update/system clip; the callback receives the same HDC returned to the caller.
- fErase reflects whether erasing was requested and whether the callback
  handled it, not whether the window happens to have a class brush.
- The in-flight request is consumed before callback entry, preventing a
  same-window nested BeginPaint from redispatching it recursively. A declined
  erase is rearmed on a still-live window; a newly requested erase during a
  successful callback is not cleared on return.
- Win32 UpdateWindow sends WM_PAINT without its former early erase callback.
  The application can arrange its brush/background before calling BeginPaint.

These are the documented [BeginPaint](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-beginpaint)
and [WM_ERASEBKGND](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-erasebkgnd)
contracts. They do not establish exact native-Win98 event parity for all paths.

The former red manual probe is now `test/test-beginpaint-erase-callback.js`.
It covers real x86 callbacks, no-erase damage, NULL/non-NULL brushes,
zero/one/other-nonzero callback results, repeated declined cycles, partial
rcPaint, UpdateWindow -> WM_PAINT -> BeginPaint -> erase nesting, recursive
same-window BeginPaint, callback reinvalidation, guest stack and synchronous
message depth. The old tools command forwards to the regression test.
`tools/probe-erase-lifecycle.js` now instruments current sources; `--candidate`
is retired with an explicit error. The patch under `docs/experiments/` remains
historical evidence of the previously rejected attempt, not a patch to apply
to current main.

Verification: `/private/tmp/wa-beginpaint-retry-{contract,nested,promoted,order,default,wake,winrar,wep1,far,build,diablo}.log`.
Both WASM builds, focused paint tests, WinRAR installer/installed GUI,
WEP1 8/8 and Win16 callback tests pass. The browser run began only after the
build process completed; screenshots are in
`/private/tmp/wa-beginpaint-retry-diablo/`. Rodent's baseline-red status from
the preceding section remains unresolved, not claimed green here.

Negative control: compiling the new regression with both runtime fragments
from `80f6174c` fails its no-erase/NULL-brush fErase assertion
(`/private/tmp/wa-beginpaint-retry-red.log`). The promoted test passes current
source. The updated current-source lifecycle probe completes the same 1100-
batch Diablo trace (`wa-beginpaint-retry-trace.log`) without applying an
experiment patch.

Remaining paint work: connect Win16 BeginPaint's far callback continuation
and remove its legacy class-brush policy; audit modal/default-dialog erase
consumers; move damage validation to the correct lifecycle point and test
callback reinvalidation through EndPaint. Empty-update rcPaint fallback and
the global last-registered redraw-class style are separate known shortcuts.

## 2026-09-20: Win16 BeginPaint far callbacks, legacy erase block removed

Win16 BeginPaint now prepares the same canonical paint DC/rectangle, then
sends a pending WM_ERASEBKGND through a far-callback continuation at FFB0.
The invocation owns a 72-byte guest-stack record (`hwnd`, destination pointer,
64-byte canonical PAINTSTRUCT) above its ordinary six-byte return record.
The narrowed HDC is saved with that return record, so nested callbacks cannot
replace the outer caller's result. No global bridge scratch or ABI mode flag
is introduced. The returned **DX:AX LONG**, including high-word-only nonzero
values, decides fErase. A declined erase is rearmed only if its window still
exists; clearing before callback entry leaves subsequent invalidations intact.

Win16 UpdateWindow now sends WM_PAINT without erasing ahead of it, matching
the Win32 change. BeginPaint owns the nested erase and passes its actual DC,
not `hwnd + 0x40000`. The old class-brush/ownership-bit fill and NULL-brush
fErase heuristic have been removed from the shared core, along with their
obsolete Diablo-specific rationale. Existing Win16 clip preparation is
unchanged; replacing that application-clip compatibility path requires its
own GetClipBox/visible-region checks.

The expanded real-x86 far regression checks:

- MoveWindow/UpdateWindow paint-before-BeginPaint-erase ordering; no erase
  when an application never calls BeginPaint.
- Actual returned narrow DC, partial PAINTSTRUCT, no-erase damage, NULL and
  non-NULL brushes, zero, low-word nonzero and high-word-only callback results.
- Same-window recursive BeginPaint does not resend the in-flight erase;
  different-window recursion gets distinct DCs and preserves both frames.
- Destruction during erase does not rearm the retired HWND; both nested
  return frames unwind correctly. Caller guards and shared-scratch checks
  remain covered.

The previous runtime fails the new ordering assertion
(`/private/tmp/wa-win16-beginpaint-red.log`); current source passes the full
matrix and nested cases (`contract` and `nested` logs with the same prefix).
The Win32 callback regression also passes (`win32`). WEP1 8/8, Hearts startup,
normal/compatibility builds pass (`wep1`, `hearts`, `final-build`). The current-
source lifecycle probe now records a separate `far-result` after the callback,
rather than mistaking the core's pre-callback fErase for the final Win16
result; a Tetris trace confirms the event (`trace`).
The completed final build also passes Diablo's full six-stage browser flow
(`/private/tmp/wa-win16-beginpaint-diablo.log`, captures in the matching
directory without `.log`). Rodent's previously recorded baseline failure
remains open; this turn does not claim to resolve it.

This does not finish painting fidelity: ShowWindow's separate initial-erase
continuation still needs a declined-result ownership audit, as do native
modal/default-dialog consumers. Damage validation/reinvalidation through
EndPaint, empty-update rcPaint and per-class redraw lookup remain open.

## 2026-09-20: ShowWindow erase results and Win16 InvalidateRect

The Win16 show continuation used to clear the erase request before dispatch
and discard the result. It now marks the outstanding callback in its own
stack-resident pending word, consumes the full DX:AX result on far return,
and rearms a declined erase only on a still-live window. Native synchronous
dispatch uses the same result helper. A successful callback cannot clear a
new erase request made inside it. No new global callback state or extra frame
is introduced. This follows the documented
[WM_ERASEBKGND result contract](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-erasebkgnd).

The regression first failed because ShowWindow lost the declined request
(`/private/tmp/wa-show-erase-before.log`). After that fix, the new callback-
reinvalidation case exposed a second, independent shortcut: shared
InvalidateRect explicitly discarded bErase on Win16 (`code16 != 0`) to avoid
the old queued-erase behavior. With queued erase removed and both BeginPaint
ABIs now dispatching callbacks, the workaround is obsolete. Both ABIs now
record nonzero bErase; FALSE does not remove an existing request.

`test-win16-windowpos-defproc.js` covers zero/low/high-word-only callback
results, repeated ShowWindow, the next UpdateWindow/BeginPaint after declined
erase, new invalidation from a handled callback, nested shows with opposite
results and destruction during erase. The final matrix passes
(`wa-show-erase-final-contract.log`); `wa-show-erase-nested.log` records the
intermediate reinvalidation failure rather than a final regression.

Scope limits: ShowWindow still uses its existing compatibility erase DC and
its existing show/activation scheduling. Its fixed nonzero return value is
also a separate gap: the documented
[ShowWindow return](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)
reports prior visibility. Do not add a test pinning that constant as correct.
Damage validation and modal/default-dialog erase consumers remain open.

Verification: both builds pass (`/private/tmp/wa-show-erase-final-build.log`),
as do the far callback matrix, Win32 BeginPaint and message-wake tests.
The Win32 reinvalidation fixture now passes BOOL value 2, not just 1: the old
`(code16 == 0) & bErase` expression also incorrectly discarded even nonzero
BOOLs on Win32. The new direct condition handles every nonzero value
(`wa-show-erase-bool.log`).
Compiling that fixture with only the old InvalidateRect fragment restored
fails the retained-erase assertion, actual 0 versus expected 2
(`wa-show-erase-bool-before.log`).

Broader completed-build gameplay sweep: **21 pass, 3 fail**. WEP1 8/8 passes;
WEP3 Klotski, TetraVex, LifeGenesis, SkiFree and WordZap pass; WEP4 Blackjack,
Chess, Chip's Challenge, JezzBall, Maxwell and Tic Tac Drop pass; VB Rodent and
Rattler pass. In particular Klotski, named in the removed workaround, passes
its gameplay and background checks. Logs:
`wa-show-erase-{wep1,wep3,wep3-rest,wep4,wep4-rest,vb}.log`.

Do **not** call the whole sweep green: Fuji Golf cannot find its player-name
edit control, Go Figure has zero white bordered-field pixels, and TriPeaks
has zero white face-row pixels. All three fail the same assertions in an
isolated WASM with **both edited runtime files restored to f6facca7** and all
other current source/host files retained:
`/private/tmp/wa-show-erase-baseline.wasm`, with
`wa-show-erase-{fuji,gofigure,tripeaks}-baseline.log`. No worktree source was
reverted for this comparison. These results rule out this turn's delta as
the sole cause, not an earlier paint change. Investigate these broader-suite
failures next; they were not exercised by the prior WEP1-only checks.

## 2026-09-20: validate damage at BeginPaint, not EndPaint

TriPeaks exposed the remaining validation shortcut: its WM_PAINT calls
UpdateWindow on itself between BeginPaint and EndPaint. Outstanding old
damage caused recursive painting until the guest stack was corrupted and
the app displayed an OOM message. The trace and reproduction are recorded
in [the TriPeaks note](re-notes/wep16-tripeaks.md).

Shared BeginPaint now snapshots PAINTSTRUCT and the paint DC clip, then clears
the consumed update and paint-pending state before any erase callback.
EndPaint releases the DC but no longer validates rcPaint. Consequently new
invalidations from callbacks or painting survive, including exact overlaps
with the old rectangle. This implements the documented
[BeginPaint validation timing](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getupdaterect).

The previous runtime fails the new immediate-validation assertion
(`/private/tmp/wa-begin-validation-before.log`). Current Win32 and real far
callback tests pass, including self-UpdateWindow during painting and
same-rectangle reinvalidation (`after`, `far-nested` logs with that prefix).
Parent/child paint order passes (`order`). Both builds pass (`build`), and
the completed build passes TriPeaks full tableau (`tripeaks`), WEP1 8/8
(`wep1`), VB Rodent/Rattler (`vb`) and Diablo's six-stage browser/gameplay
flow (`diablo`). The TriPeaks screenshot was also visually inspected.

Go Figure still fails with black puzzle fields (`gofigure`); Fuji Golf's
earlier missing-control failure is not resolved or claimed retested here.
Open paint fidelity work includes empty-update rcPaint, per-class redraw
flags, native modal/default-dialog erase consumers, and ShowWindow's prior-
visibility return and compatibility erase DC. No performance claim is made
from these functional runs on a loaded shared machine.

## 2026-09-20: child exposure must not bypass guest erasing

The remaining Go Figure black fields were isolated to
`win16_rearm_visible_child_erases`: it filled each exposed far-wndproc child
with its class brush and consumed the erase request without dispatching the
guest callback. Removing that shortcut restores the game's white bordered
fields, score and timer. Exposure now retains the request for BeginPaint's
real far erase callback; a class brush no longer overrides guest handling.

The isolated candidate passes Go Figure, Rodent/Rattler and WEP1 8/8.
The corrected Go Figure screenshot was visually inspected, and the current-
source far regression passes with a new class-brush exposure assertion.
Trace, artifact and capture paths are recorded in
[the Go Figure note](re-notes/wep16-gofigure.md). Fuji Golf remains open;
this does not establish native-equivalent parent-exposure message timing.

## 2026-09-20: Fuji Golf failure refined, geometry still open

The reported missing player-name control was a harness startup error: the
game was still asking to copy its DAT file to the Windows directory. After
accepting that prompt, the old physical click also missed the Start New
Round button because the clubhouse scene is too short. The gate now accepts
the prompt and clicks the real control ID, preserving its independent strict
geometry checks. Name entry and the first-tee transition work; the test
remains red for scene bounds 360x291 (height must exceed 310), not a missing
dialog. No runtime change or relaxed visual threshold. Evidence and next
investigation are in [the Fuji Golf note](re-notes/wep16-fujigolf.md).

Further isolation: the maximized WM_SIZE has the correct 632x434 dimensions,
but Win16 ShowWindow has not updated `active_hwnd`. Fuji's NE5:229a compares
GetActiveWindow (zero) with its clubhouse HWND and skips layout. A diagnostic
artifact setting active state before the size callback passes the unchanged
full gate and restores the full-height scene visually. **Not integrated:**
a bare global assignment omits activation notifications/focus/reentrancy.
Implement a proper Win16-safe activation transition next; details and probe
paths are in the app note. No bitmap or system-metric correction is indicated
by this evidence.

## 2026-09-20: Win16 activation transaction and EnableWindow repaint loop

The activation implementation adds an invocation-owned far continuation,
`WIN16_CONT_ACTIVATE` (FFB4), with `{target, previous, phase, old-focus}` on
the guest stack. Activating top-level ShowWindow modes 1/2/3/5/9 publish
`active_hwnd` before sending old/new WM_ACTIVATE, then complete focus
notifications before the show-size callback. Modes 4/7/8 and child shows do
not activate. Each phase advances before callback entry; a nested activation
supersedes the outer target, and target destruction ends the transaction.
Win16 activation packs the other HWND into LOWORD(lParam) and minimized
state into HIWORD(lParam), unlike Win32's wParam packing. Old queued
WM_ACTIVATE/WM_SETFOCUS duplicates are removed.

The expanded far matrix checks exact notification order, narrowed handles,
nonactivating modes/children, nested activation/focus preservation, actual
GetActiveWindow from SIZE_MAXIMIZED, minimized packing and destruction.
The final matrix passes (`/private/tmp/wa-win16-activation-final-contract.log`).

The initial completed build passes Fuji Golf, WEP1 8/8, WEP4 7/7 and VB
Rodent/Rattler, but **regresses Klotski**: closing Welcome enters repeated
WM_PAINT / WM_ENABLE / WM_CAPTURECHANGED cycles. This is not a modal hang.
Trace `wa-activation-klotski-messages.log` shows its painter calling
EnableWindow(FALSE), drawing, then EnableWindow(TRUE) before EndPaint.
The shared EnableWindow handler unconditionally invalidated the window on
both state changes, perpetually recreating the paint damage. Correct active
state exposes this branch; suppressing activation would conceal the problem.

The EnableWindow change removes that API-level repaint shortcut. Disabled
appearance is now requested by native control WM_ENABLE processing, including
a guest subclass that chains to the native procedure. Other windows own their
repaint decisions. `test-enable-window.js` retains prior-state/owner tests and
adds no-invented-damage and native-button repaint assertions; it passes
(`wa-enable-repaint-contract.log`). These are independent API ownership
corrections, not Klotski-specific conditions.

Remaining scope: application-activation/restored-size scheduling, activation
selection on hide/minimize, ShowWindow prior-visibility return, and other
Win16 activation entry points are not claimed complete by this transaction.

Completed combined-build verification (`wa-win16-activation-enable-*` in
`/private/tmp/`): normal/compatibility builds pass (`build`), WEP1 8/8
(`wep1`), WEP4 7/7 (`wep4`), VB Rodent/Rattler (`vb`), and six WEP3 games
including Klotski and Fuji (`wep3`). Diablo's six-stage browser/gameplay flow
also passes (`diablo`), launched after build completion. The first browser
attempt could not bind its local server under sandbox restrictions; the
approved rerun completed successfully.

WordZap remains red at its splash-width check (600), identically on the
earlier pre-activation isolated artifact
`wa-gofigure-no-class-erase.wasm` (`wa-activation-wordzap-baseline.log`).
The current splash screenshot `wa-activation-wordzap.png` was inspected and
is entirely black: this assertion does not establish a font-width bug.
Do not call the full 24-game sweep green (23 pass, 1 red), or weaken the
visual gate. Investigate WordZap's capture/startup separately.

A stricter baseline restores all three edited runtime fragments to their
pre-change HEAD versions while keeping the rest of the current source/host:
`/private/tmp/wa-activation-before-three.wasm`. WordZap fails identically at
width 600 (`wa-activation-wordzap-three-baseline.log`). This rules out this
turn's runtime delta as the sole cause, not every earlier paint change.

## 2026-09-20: WordZap publication lock removed

The WordZap failure above is now resolved without changing its pixel or
gameplay expectations. The guest draws its splash and polls GetCurrentTime
before EndPaint; canonical pixels were correct, but the renderer withheld all
publication while a paint DC was live. BeginPaint is not implicit double
buffering. Publication now waits only for an executing Worker slice, not for
EndPaint, and the modal-dialog exception to the former lock is removed.

All seven WEP3 games, WinRAR candidate menu/property-sheet checks, property-sheet
page lifetimes, native-child DirectDraw overlays and the renderer boundary
regression pass. Chromium shows the splash in cooperative and Worker modes;
the WinRAR Worker browser file-drop gate passes. No new full 24-game sweep is
claimed. Browser-resized WordZap copyright clipping remains a separate issue.
See [the WordZap investigation](re-notes/wep16-wordzap.md) for traces, official
contract links, reproduction and verification scope.

## 2026-09-20: Win16 ShowWindow returns prior visibility

The Win16 adapter captured WS_VISIBLE on entry but discarded that value when
creating its far-return continuation, hardcoding TRUE. The documented return
is the window's previous visibility, not success:
[Microsoft ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow).
The adapter now normalizes the captured bit and stores it in the existing
invocation-owned continuation. Callback results, nested ShowWindow calls and
destruction cannot replace the outer return. No new frame or global is needed.

The far regression snapshots entry visibility and checks the returned AX for
each show case, including maximize, minimized/nonactivating modes, child
windows, destruction and activation reentrancy. Explicit hide/repeated-hide/
re-show cases cover both boolean results. The nested erase callback captures
its own ShowWindow return, testing inner TRUE with outer FALSE independently.
The negative control fails on the previous runtime (`wa-show-result-before.log`)
at the first hidden-to-visible transition, returning 1 instead of 0.

Activation selection on hide/minimize, application/restored-size notification
timing, other activation entry points and the ShowWindow compatibility erase
DC remain separate open items; this return-value fix does not resolve them.

The full far regression passes (`/private/tmp/wa-show-result-after.log`), as do
normal and compatibility builds (`wa-show-result-build.log`, layout hash
`494e011486f18808`). The nested-return fixture calls ShowWindow only from its
erase callback: calling it unconditionally also repeats it from activation
notifications, overwriting the captured first return with a later TRUE.

Completed-artifact gameplay also passes: WEP1 8/8, WEP3 7/7, and VB Rodent/
Rattler 2/2 (`wa-show-result-wep1.log`, `wa-show-result-wep3.log`,
`wa-show-result-vb.log`). These runs used `WINE_ASSEMBLY_WASM=build/wine-assembly.wasm`
after the build completed, not a stale pre-fix artifact.

## 2026-09-20: shared activation must respect callback reentrancy

The hide/minimize audit found a prerequisite discrepancy: Win16's activation
continuation stops after a callback chooses another active window, but the
shared Win32 `$active_window_transition` did not. It could send WA_ACTIVE to
the superseded target after the old window's callback had activated a third
window, or send stale WM_SETFOCUS after a nested focus transition. Furthermore,
SetActiveWindow unconditionally called the browser activation import on unwind,
undoing the nested browser selection even when guest active state was correct.

The shared transition now checks ownership after the deactivation, activation
and kill-focus callbacks. SetActiveWindow requests browser activation only if
its target is still active. The outer invocation retains its original previous
HWND return and stack cleanup. This is consistent with the synchronous
same-queue callbacks documented by Microsoft in
[WM_ACTIVATE](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-activate)
and the previous-window return in
[SetActiveWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setactivewindow);
exact nested Win98 notification traces have not been independently captured.

The expanded `test/test-active-window.js` uses actual guest x86 and a public
SetActiveWindow thunk. It activates a third window from each of the old
window's WA_INACTIVE, the target's WA_ACTIVE, WM_KILLFOCUS and WM_SETFOCUS.
It checks final active/focus state, absence of stale notifications, the outer
return and stack, and host activation targets. Its recorder now has 64 entries
and traps before overflow; the old 16-entry storage could overwrite fixture
code during the expanded sequence. An isolated prior-runtime test fails on
stale activation after WA_INACTIVE (`wa-active-reentrant-before.log`); the
corrected transition passes all four cases (`wa-active-reentrant-after.log`).
Popup-history and owned-form ShowWindow activation tests also pass.

This does not finish the activation audit: ShowWindow, SetForegroundWindow,
SwitchToThisWindow and OpenIcon still need their post-callback host activation
reviewed. Hide/minimize successor selection has no shared WAT implementation
yet. Exact native default-procedure focus ownership and same-target nested
activation generations are not established by this regression.

The final bounds-checked recorder passes (`wa-active-reentrant-final.log`).
Normal and compatibility builds pass (`wa-active-reentrant-build.log`, layout
hash `494e011486f18808`), with no data-segment overlaps. All named logs are in
`/private/tmp/`.
The completed artifact also passes the WinRAR Worker browser file-drop test
(`wa-active-reentrant-winrar-web.log`). This is a browser integration check,
not an exhaustive native activation-order comparison.

## 2026-09-20: foreground/restore wrappers share guarded publication

The follow-up closes the post-callback host-overwrite paths identified above.
`$activate_window_with_host` resolves the target's top-level and runs the
same-thread transition, but does not activate the browser target if a callback
has selected another window. SetForegroundWindow, SwitchToThisWindow, OpenIcon
and the ShowWindow activation helper share it. It preserves the original HWND
passed to the host (including child handles), and foreign-thread targets still
delegate to the host without stealing the calling queue's active state.
SetActiveWindow keeps its previous-HWND return path. OpenIcon still returns
success for a completed restore even if callbacks selected another window.

BringWindowToTop already activates the host before its guest callbacks, so it
does not have this particular post-callback overwrite and was not changed.
This is not a claim that every aspect of BringWindowToTop is native-correct.

The real guest callback matrix now has twenty cases: SetActiveWindow,
SetForegroundWindow, SwitchToThisWindow, OpenIcon, and the ShowWindow activation
helper, each reentered from four activation/focus notification boundaries.
The prior runtime fails the SetForegroundWindow/WA_INACTIVE case by sending
the superseded host activation after the nested one
(`/private/tmp/wa-activation-wrappers-before.log`). The corrected matrix passes;
stack cleanup, nested active/focus state, absence of stale notifications and
host targets are checked. The ShowWindow case tests its activation helper,
not the entire ShowWindow message sequence. Separate owned-form ShowWindow and
OpenIcon/CloseWindow integration tests pass, including the existing restore
and query-veto behavior. Normal and compatibility builds pass.

Remaining: hide/minimize successor selection, startup notification timing,
ShowWindow erase-DC ownership, exact native focus/default-procedure ordering,
and same-target nested activation generations. This change does not model
cross-process foreground restrictions or supply native Win98 trace evidence.

Final verification logs in `/private/tmp/`: `wa-activation-wrappers-contract.log`
also covers preserved child HWND and foreign-thread host delegation;
`wa-activation-wrappers-openicon.log`, `wa-activation-wrappers-owned.log`, and
`wa-activation-wrappers-build.log` pass. The completed artifact passes WinRAR's
real Worker browser file-drop gate (`wa-activation-wrappers-browser.log`).

## 2026-09-20: hide/minimize successor audit, ordering prerequisite

`node tools/probe-window-activation-order.js` now reproduces the missing
successor transition using current USER handlers and the actual canvas host
imports. It creates three unowned, same-thread top-levels A, B, C, then
activates A and calls ShowWindow/CloseWindow. Observation exports report WAT
ranks, styles, iconic state and active/focus state alongside renderer ranks
and its GW_HWNDNEXT result. It does not change production code, assert today's
wrong behavior as a regression contract, or overwrite the shipping artifact.

Observed on the 4d865cde runtime (`/private/tmp/wa-window-activation-order.log`):

| Stage | WAT top-first | Renderer top-first | Guest active/focus | Rendered visible |
| --- | --- | --- | --- | --- |
| Create A, B, C | C B A | C B A | NULL / NULL | A B C |
| SetActiveWindow(A) | C B A | A C B | A / A | A B C |
| ShowWindow(A, SW_HIDE) | C B A | A C B | A / A | B C |
| ShowWindow(A, SW_SHOW) | C B A | A C B | A / A | A B C |
| ShowWindow(A, SW_MINIMIZE) | C B A | A C B | A / A | B C |
| ShowWindow(A, SW_RESTORE) | C B A | A C B | A / A | A B C |
| CloseWindow(A) | C B A | A C B | NULL / NULL | B C |

After activation, host GW_HWNDNEXT(A) is C at every stage. Neither hide nor
minimize sends the guest to C; CloseWindow clears the queue instead. This is
not merely a missing caption repaint. Microsoft documents SW_MINIMIZE as
activating the next top-level in Z order and SW_HIDE as activating another
window: [ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow).

There are currently three distinct orders to avoid conflating:

- `WND_Z_ORDER_TABLE`, assigned on registration and certain explicit WAT raises;
- renderer `zOrder`, updated by `activate_window` / `_raiseWindowGroup` and used
  by host GW_HWNDNEXT and composition;
- `wnd_find_next_sibling`, explicitly a **later allocation slot**, not Z order.

The activation path raises the renderer group but does not update the WAT
ranks. The probe demonstrates the divergence with ordinary public activation,
before any hide/minimize special case. A selector that assumes active A is at
the head of the WAT order will find no window below it in this example, despite
two visible successors in the compositor.

Next implementation needs an explicit ordering authority and a tested
successor transaction shared by hide/minimize/CloseWindow. Keep per-app WAT
order distinct from desktop-wide inter-app order, and cover owner groups,
disabled/hidden candidates, no candidate and callback reentrancy. Do not use
allocation-slot order or a hardcoded fallback to the main HWND. The probe is
an emulator diagnosis, not native Win98 selection evidence; these production
defects remain open.

## 2026-09-20: activation updates guest owner-group ranks

The shared Win32 activation transition now raises its target's guest-side owner
group, including when reasserting an already-active HWND. The latter matters
when a new window has appeared above the active group since the previous
activation. Notifications and the previous-HWND return remain unchanged.

`wnd_z_raise_owner_group` walks to the root owner, raises that root, then raises
visible non-iconic owned windows in stable sibling order, level by level.
Hidden owned windows retain their rank. The window lock covers the complete
operation; nested calls to the existing rank allocator use its recursive lock.
There are no host imports, guest callbacks, scratch allocations or private
per-instance rank counters while locked. The pre-raise maximum and per-level
rank boundaries distinguish old members from already-raised members. Owner
cycles are bounded by MAX_WINDOWS rather than looping forever.

`node tools/probe-window-activation-order.js --check-order` checks relative WAT
and renderer ordering after activation. Its owned fixture deliberately creates
a nested window between two sibling palettes, so allocation order cannot pass
as ownership-level order. Results (`/private/tmp/wa-owner-rank-final.log`):

- Unowned activation: both report A C B, replacing the earlier C B A / A C B
  disagreement.
- Owner activation: both report N Q P A above unrelated windows; N belongs to
  P, and P/Q belong to A. The hidden owned window remains outside the raised
  group.
- Reasserting A after creating unrelated D also preserves that relative order.

The prior activation body, compiled in isolation against the same probe,
fails the unowned comparison (`wa-owner-rank-before.log`). The activation
callback matrix and existing two-instance shared-rank checks pass
(`wa-owner-rank-active.log`, `wa-owner-rank-worker.log`). These checks do not
claim native Win98 reference traces or simultaneous contended group raises.

This is an incremental ordering correction, not the elimination of the second
owner. The renderer still owns desktop-wide ordering and still has its group
walk. Direct renderer input/taskbar raises and Win16's separate activation
continuation need integration; same-process comparisons are not a global
cross-app rank comparison. Hide/minimize successor selection is still open.

The first full build stopped on a stale generated mirror after a concurrent
DirectX change expanded DX_SURF_META. The mirror was regenerated for that
change (layout `e6a915eaedf6cf03`), left outside this change's commit, and the
shipping artifact is being rebuilt against the matching map. This is not a
rank-helper layout change; the helper adds no region.

The extended two-instance test now calls the group operation itself from the
worker instance: all ten checks pass, including root/sibling/nested order,
identical ranks seen by both instances and unchanged hidden-member rank
(`wa-owner-rank-worker-group.log`). This is sequential access through two
instances, not a simultaneous contention benchmark.

The matching-mirror full build then stops at the unrelated DxObject field
gate: the parallel `$d3dim_texture_view_release` uses a raw type load in
`src/09aa-handlers-d3dim.wat` (`wa-owner-rank-build-final.log`). The owner was
notified; that source is untouched by this change. A compile-only run pairs
the local artifact with the regenerated mirror, but is **not** a passing full
build. Do not conflate focused test success with the shared-tree build gate.

Compile-only completed for both normal and compatibility artifacts, using
layout `e6a915eaedf6cf03` (`wa-owner-rank-compile.log`). The generated mirror and
the unrelated DirectX schema changes are not part of the rank-helper commit.

The paired artifact passes WinRAR's Worker browser file-drop test
(`wa-owner-rank-browser.log`). The DirectX owner subsequently reported fixing
the field access and a full build passing at 14:26 in the messageboard. That
is the other agent's build report, not a rerun of the failed build logged here.

### Win16 activation rank integration (2026-09-20)

`$win16_activate_start` now calls the same `$wnd_z_raise_owner_group` as the
Win32 transaction, before its already-active early return. Far notification
frames and callback ordering remain unchanged; no separate Win16 owner walk
or host policy was added.

The real far-call matrix now checks A/B rank changes and reasserts the active
window after creating another above it. Reassertion raises the target without
duplicate activation/focus notifications. The unmodified runtime fails the
first rank assertion (`/private/tmp/wa-win16-rank-before.log`); the updated
runtime passes the full matrix (`/private/tmp/wa-win16-rank-after.log`),
including nested activation, destruction and stack restoration.

This closes the Win16 activation rank gap identified above, not the remaining
direct input/taskbar paths or hide/minimize successor selection. Native Win98
reference traces and desktop-wide cross-app order are still separate work.

Verification: full build gates and both normal/compatibility artifacts pass
with layout `e6a915eaedf6cf03` (`/private/tmp/wa-win16-rank-build.log`). All
seven WEP3 first-action gameplay cases pass against the completed normal
artifact (`/private/tmp/wa-win16-rank-wep3.log`). This gameplay check is
headless, not a new browser or native-reference measurement.

### Input/taskbar transaction gap (2026-09-20)

Reproduce with `node tools/probe-window-activation-order.js --check-order
--input-paths`. This runs the real mouse-down/up methods and the real taskbar
button handlers; only the DOM button container is synthetic. The existing
API-order assertions still pass. Input observations are diagnostic, not
assertions that enshrine the incorrect results.

With A active and B exposed at the right edge, clicking B produces:

```text
                   guest active  guest focus  guest top  renderer top
mouse B                 A             B           N           B
taskbar B raise         A             B           N           B
taskbar B minimize      A             B           N           B (hidden)
taskbar B restore       A             B           N           B
```

N is A's nested owned palette. Taskbar minimize leaves B's guest minimized
bit false while hiding the renderer window; restore only reverses the
renderer-side state. The taskbar does not dispatch the guest show-state
transaction. Mouse input changes focus but does not activate B. This is
broader than a missing rank export: synchronizing rank alone would leave
both active-window notifications and show state incorrect.

Next implementation must route mouse activation and taskbar system commands
through the owning guest, preserving callback reentry and Win16 far-call
semantics. Do not invoke callback-bearing activation on a Worker shadow
instance just to update its globals. The rank helper is pure locked table
arithmetic; the activation transaction is not. Verify both cooperative and
Worker delivery, including keyboard routing across app instances, before
claiming the input paths closed. The current probe covers one process in
the headless renderer, not native Win98 or concurrent Worker input.

### Taskbar minimize/restore delivery (2026-09-20)

The taskbar now enqueues HWND-targeted `WM_SYSCOMMAND` (`SC_MINIMIZE` or
`SC_RESTORE`) and wakes the input pump. It no longer changes visibility or
minimized state before guest handling. Ordinary application handling can
consume the command; default handling commits the existing shared show-state
fold and host presentation. This follows the documented
[WM_SYSCOMMAND contract](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-syscommand),
without calling callback-bearing exports on a Worker shadow instance.

`--check-taskbar` on the activation-order probe asserts the queued HWND and
command, unchanged pre-delivery state, and agreement after explicit native
default processing. Its builtin fixture has no application wndproc: it does
not pretend that calling the default handler tests a real application's pump.

A separate local Chrome check drove Notepad's actual taskbar buttons in both
cooperative and Worker modes. Both minimized with guest `wnd_is_minimized=1`
and renderer minimized/hidden, then restored with guest state 0 and renderer
visible (`/private/tmp/wa-taskbar-browser-final.log`, harness
`/private/tmp/wa-taskbar-browser.js`). The first browser run used an incorrect
optional getter and is not evidence for guest state; the corrected run uses
the required export and asserts the result. This is functional browser
coverage, not a performance measurement.

Still open: taskbar foreground raising and mouse activation, restoring active
state/focus, hide/minimize successor selection, and default-processing gaps
such as `WM_QUERYOPEN` on restore. This change fixes command delivery, not all
semantics of the existing default handler.

Final probe passes (`/private/tmp/wa-taskbar-final.log`); substituting the
prior renderer fails the pre-delivery state assertion
(`/private/tmp/wa-taskbar-negative.log`). The desktop-plane Z-order test and
JavaScript syntax/diff checks also pass. No WAT changes or rebuild are needed
for this delivery correction.

### OpenIcon query callback lifetime (2026-09-20)

Before adding query delivery to the system-command path, inspection found
that the existing `$open_icon_core` trusted a TRUE `WM_QUERYOPEN` result even
when that callback destroyed its target. It now revalidates the HWND after
the callback and returns 0 without restoring/activating a retired target.
No fabricated last-error value or fallback HWND is added.

`test/test-open-icon.js` installs an x86 wndproc that calls the public
`DestroyWindow` thunk only during `WM_QUERYOPEN`, tolerates nested destruction
notifications, and then returns TRUE. The old runtime returns 1 (negative
control: `/private/tmp/wa-open-icon-retired-before.log`). The corrected runtime
returns 0, confirms the target is retired, and emits no outer restore or
activation host call (`/private/tmp/wa-open-icon-retired-after.log`). Existing
allow/veto/maximized/foreign-window checks remain passing.

The broader system-command query gap remains open. In particular,
`$wnd_send_message_inner` posts far Win16 callbacks and returns 0; calling
that helper for a synchronous Win16 veto would incorrectly reject every
restore. A proper Win16 query implementation needs an invocation-owned far
continuation, as the activation and positioning adapters already use.

Verification also passes the active-window/reentrant wrapper matrix
(`/private/tmp/wa-open-icon-retired-active.log`) and the full build gates for
both normal and compatibility artifacts, layout `e6a915eaedf6cf03`
(`/private/tmp/wa-open-icon-retired-build.log`). No new browser measurement is
claimed for this callback-lifetime correction.

### System-command restore queries (2026-09-20)

`SC_RESTORE` and `SC_MAXIMIZE` now query an iconic target before committing
show state. Non-iconic commands do not query. Win32 shares
`$wnd_query_open_allowed` with OpenIcon, including its post-callback liveness
check. Builtin routing sentinels use the default TRUE result, rather than
mistaking their unhandled zero for an application veto. OpenIcon and both
system-command adapters now share `$window_system_show_commit`; restored
maximized windows also retain the corresponding SIZE_MAXIMIZED notification.

Win16 far procedures are entered through a new invocation-owned continuation
holding `{hwnd, command}`. The reply is consumed before shared commit, never
posted and assumed answered. A nested query owns a distinct frame. Rejection
or target destruction leaves no outer host commit; the original Pascal frame
and DefWindowProc zero result are restored.

The Microsoft Windows 3.1 Programmer's Reference, Volume 3, printed page 183
(`WM_QUERYOPEN`, local copy `/private/tmp/wa-win31-messages.pdf`) specifies a
nonzero return to allow opening and zero to reject. The adapter therefore
tests the full DX:AX LONG, including a high-word-only nonzero reply. The first
candidate incorrectly treated the result as AX-only; it was corrected before
commit. Current [Microsoft documentation](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-queryopen)
also documents the veto and default acceptance. Native execution traces for
unusual reentry remain uncollected; destruction/nesting cases here are
emulator lifetime regressions, not a claim that applications should change
activation or focus from inside this query.

Coverage includes Win32 allow/veto and builtin default handling for restore
and maximize; Win16 low/high-word acceptance, rejection, non-iconic bypass,
nested target/command isolation, destroyed target, no host commit on veto,
and Pascal stack/result preservation. Disabling the Win32 query fails the
veto assertion (`/private/tmp/wa-query-open-negative32.log`); using the old
Win16 adapter fails synchronous delivery
(`/private/tmp/wa-query-open-negative16.log`). An initial attempt to compile
the old entire Win32 fragment lacked the newly shared helper symbols and is
not a behavioral negative control.

Still open: input/taskbar foreground activation, hide/minimize successor
selection, and broader native message-order comparisons. This query change
does not claim to close those activation gaps.

Final verification: Win32 query/lifetime matrix
(`/private/tmp/wa-query-open-win32-complete.log`), full Win16 far-call matrix
(`/private/tmp/wa-query-open-win16-long.log`), full gated normal/compat build
(`/private/tmp/wa-query-open-build-long.log`, layout `e6a915eaedf6cf03`), WEP3
gameplay 7/7 against the completed artifact
(`/private/tmp/wa-query-open-wep3-final.log`), and actual Notepad taskbar
minimize/restore in cooperative and Worker Chrome, with guest iconic state
assertions (`/private/tmp/wa-query-open-browser-final.log`). All pass.

### Mouse-activation integration audit (2026-09-20)

The next change is a guest input transaction, not a call to SetActiveWindow
inserted in the renderer. Inspection of the current fetch/dispatch paths
establishes these constraints:

| Path | Current behavior | Required integration |
| --- | --- | --- |
| Renderer mouse-down | Raises the group and may change focus before guest input | Defer those effects until the guest's mouse-activation answer |
| GetMessage hardware branch | Consumes the pending event and formats MSG immediately | Run activation processing before returning the button message |
| PeekMessage hardware branch | Retains input for PM_NOREMOVE; migrates filter misses to the posted queue | Preserve an event's processing state across peeks and filtering; avoid repeated query side effects |
| `$input_route_to_owner` | Forwards a wrong-thread input event through ordinary `$post_queue_push` | Preserve hardware provenance so the owner processes activation and explicit PostMessage does not masquerade as a physical click |
| Win16 Get/Peek adapters | Call shared Win32 fetch using a temporary MSG, then narrow it | Suspend/resume through a far-safe invocation frame, preserving the pending event and caller's output pointer |
| Taskbar foreground raise | Raises renderer order only | Queue an owning-guest activation request; do not fabricate a mouse click |

Relevant code is `$input_route_to_owner`, `$handle_GetMessageA`, and
`$handle_PeekMessageA` in `09a5-handlers-window.wat`, plus
`$win16_GetMessage`/`$win16_PeekMessage` in `09e-win16-api.wat`. A query added
only after the hardware fetch misses events routed through the owner's posted
queue. A query placed before owner routing runs on the wrong thread. A query
implemented with `$wnd_send_message` alone posts a Win16 far callback and
mistakes its immediate zero for an answer. These are source-derived failure
cases, not hypothetical reasons to leave the renderer shortcut in place.

The [Microsoft WM_MOUSEACTIVATE contract](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-mouseactivate)
separates activation and click delivery:

```text
answer                 activate   deliver button message
MA_ACTIVATE               yes             yes
MA_ACTIVATEANDEAT         yes              no
MA_NOACTIVATE              no             yes
MA_NOACTIVATEANDEAT        no              no
```

The Windows 3.1 SDK Volume 3, printed pages 156–157 (local
`/private/tmp/wa-win31-messages.pdf`), additionally states that child default
processing first asks the parent and stops if the parent returns nonzero.
The current shared default procedure has no WM_MOUSEACTIVATE branch. Parent
forwarding/default response must therefore be implemented alongside input
delivery; a hook that treats zero as acceptance would conceal that missing
default behavior.

Required regression matrix: all four answers; child-to-parent forwarding and
unchanged top-level HWND/hit-test/message parameters; repeated PM_NOREMOVE;
filtered input; wrong-thread routing; explicit posted clicks; callback
destruction and nested input; Win16 far stack/return preservation; and actual
cooperative/Worker browser clicks across two app instances. Do not infer
success from the already-passing API activation tests or a renderer-only
frontmost-window check. Native caption hit-test/default response details still
need reference verification before specifying the default fallback.

Baseline `test/test-peek-message-filter.js` passes
(`/private/tmp/wa-mouse-pump-baseline.log`). It covers filter retention,
PM_NOREMOVE, owner-thread keyboard delivery and queue growth, but does not
exercise WM_MOUSEACTIVATE. This audit changes no runtime behavior.

### Queue input provenance (2026-09-20)

Host-input routing and filtered-peek migration now enqueue with a private
source flag. Ordinary `PostMessage` enqueue uses zero, even for the same
WM_LBUTTONDOWN number. The 16-byte guest message payload/ring ABI stays
unchanged: a 4KB sidecar holds one dword for each of 16 × 64 inline slots;
heap overflow nodes grow from 20 to 24 bytes. Ring compaction and overflow
refill move metadata with the payload under the existing window lock.
Slot reuse overwrites it, so a later application post cannot inherit an
earlier input label. No guest message bits are repurposed.

`$user_queue_input_flags` is an instance-private last-read observation, not
shared event state: direct/cached input reports 1, ordinary posts and empty
reads report 0, and shared queue reads publish the selected entry's source.
The durable provenance resides in the queue entry's shared storage. Consumers
must snapshot the observation before callbacks or other queue operations.
Flag 1 means host/input-origin (including synthetic UI/test input), not proof
that a physical device generated it. Activation processing remains absent;
this change does not yet encode a processed activation decision.

The filter regression covers owner routing, repeated direct and overflow
PM_NOREMOVE, same-thread filter migration, overflow-to-ring refill, ring-gap
compaction, posted mouse messages, slot reuse and the high thread-16 partition.
The initial high-thread fixture tried to change an existing HWND's owner by
registering it again; USER correctly retained the original owner. The fixed
fixture creates a distinct HWND. The source-disabled negative control fails
the owner-routing assertion (`/private/tmp/wa-input-flags-negative.log`).

The first build caught the missing region-size declaration; that declaration
was added rather than relaxing the gate. The full build then passed for both
artifacts (`/private/tmp/wa-input-flags-build-final.log`), with matching mirror
and layout `6ee344b49d5799cb`. Queue-growth/FIFO tests pass
(`/private/tmp/wa-input-flags-queue.log`), as do Notepad taskbar
minimize/restore checks in actual cooperative and Worker Chrome
(`/private/tmp/wa-input-flags-browser.log`). No performance benefit or
simultaneous-contention result is claimed.

Final filter matrix also instantiates the same module twice over one shared
memory: one instance enqueues input and the other observes its source, while
their last-read globals remain independent. It passes
(`/private/tmp/wa-input-flags-shared.log`). This is sequential cross-instance
coverage, not concurrent stress. Next: per-event activation-processing state,
parent/default query behavior, and Win16-safe pump continuation.

### Native Win98 mouse-activation reference (2026-09-20)

The new CRT-free `tools/v86-reference/probes/mouse-activate.c` runs against
native USER in the pinned v86 Windows 98 profile, not Wine source or our
emulator. Reproduce with:

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/mouse-apps.json --app mouse-activate \
  --output /private/tmp/wa-mouse-native.png \
  --metadata /private/tmp/wa-mouse-native.json \
  --serial-output /private/tmp/wa-mouse-native.serial
```

Full first-run output is preserved in
[reference-mouse-activate-win98.txt](reference-mouse-activate-win98.txt).
`GetVersion` returned `0xc0000a04` (4.10). The run reached
`MOUSE_ACTIVATE_DONE`; source-only harness checks pass.
The second run (`/private/tmp/wa-mouse-native-repeat.*`) produced byte-identical
serial output and an identical screenshot SHA-256
`1ec7c1d0ea91bafe98fe2e54d636fd1410fab6b08da248ee59abb2dcd93b3f90`.
Runtime provenance:
v86 `0.5.432+gf3d4472`, upstream commit
`f3d4472a9c934b9ad78a311f5849ba711a296d23`, documented online disk/state and
firmware from `tools/v86-reference/SOURCES.md`. Compiled probe SHA-256:
`81b794db13a7c2f881135a6b897b06710c35a43f4cb4dc90d36439fb3a6e50f2`.
Capture metadata and PNG remain in `/private/tmp`; neither OS assets nor
compiled executable are committed.

Observed results (two visible same-thread Win32 top-level windows):

- Both `PM_NOREMOVE` calls return the button-down **without** issuing
  WM_MOUSEACTIVATE or changing activation. `PM_REMOVE` issues the query
  before returning. Thus the planned activation transaction belongs at
  removal, not the first peek; source metadata alone is not permission to
  activate a peeked message.
- Answers 1/2 activate B, answers 3/4 retain A. Answers 2/4 eat button-down,
  making this filtered remove return FALSE, but the subsequent drain still
  delivers button-up. Answer 0 also activates and delivers on this profile;
  it is an observed native fallback, not one of the four documented answers.
- Activation delivers WM_ACTIVATE to B with `WA_CLICKACTIVE` (2), not
  `WA_ACTIVE` (1). The observed sequence is old WM_ACTIVATE, new
  WM_ACTIVATE, old WM_KILLFOCUS, new WM_SETFOCUS, then button-down delivery.
- Explicit `PostMessage(WM_LBUTTONDOWN)` neither queries nor activates.
- Direct top-level DefWindowProc returns MA_NOACTIVATE (3) for
  `HTCAPTION + WM_LBUTTONDOWN`; it returns MA_ACTIVATE (1) for the other
  14 tested hit-test/message combinations. In particular, substituting
  WM_NCLBUTTONDOWN in the high word is **not** equivalent. These direct
  calls do not yet establish the full caption drag/activation sequence.
- Direct child DefWindowProc forwards the original top-level HWND and
  lParam to its parent exactly once. Parent answers 1–4 pass through;
  parent answer 0 falls back to 1 for HTCLIENT/WM_LBUTTONDOWN.

This supersedes the earlier assumption that zero could not be an accepting
pump result. It does **not** remove the need to implement the missing default
procedure: the child fallback and caption exception have distinct behavior.
No production behavior changed in this reference-probe step. Still to test:
filtered nonmatching hardware, actual child/caption input, GetMessage,
cross-thread/cross-app activation, nested pumps/destruction and Win16 far
callbacks. Do not extrapolate their ordering from this same-thread trace.

### Default mouse-activation response implemented (2026-09-20)

DefWindowProc now implements the measured default: a WS_CHILD first sends
WM_MOUSEACTIVATE synchronously to its parent with unchanged top-level HWND
and lParam; a nonzero parent LONG passes through, and zero falls back to
MA_ACTIVATE except for HTCAPTION/WM_LBUTTONDOWN (MA_NOACTIVATE). Merely owned
popups do not use the child forwarding path. The fallback and parent lookup
are shared helpers, not separate Win32/Win16 policy copies.

The Win16 adapter enters a far parent procedure using an invocation-owned
stack continuation containing the original lParam. It preserves a nonzero
full DX:AX response and returns to the original Pascal caller; it does not
post a query whose answer would arrive too late. Nested parent default calls
retain separate frames. This implements explicit default processing only:
GetMessage/PeekMessage still do not run a mouse-activation transaction.

Tests extend the existing OpenIcon and Win16 window/default matrices with
all 15 native default combinations, parent answers 0–4 plus 0x10000,
client/caption fallback, unchanged parameters and once-only parent calls.
The Win32 test uses executable x86 callbacks and checks that owned popups do
not forward. The far test checks stack/result restoration and a two-level
far parent chain. Both pass (`/private/tmp/wa-mouse-default32.log` and
`/private/tmp/wa-mouse-default16-nested.log`). Disabling the Win32 branch
fails the default-response assertion; disabling only the far branch fails
the synchronous parent-query count (the two `wa-mouse-default-negative*`
logs). These negative controls validate behavior, not just source presence.

Full gated normal/compat build passes (`/private/tmp/wa-mouse-default-build.log`),
retaining layout `6ee344b49d5799cb`. Completed-artifact Notepad taskbar
minimize/restore passes in cooperative and Worker Chrome
(`/private/tmp/wa-mouse-default-browser.log`), and the Win16 WEP3 gameplay
suite passes all seven cases (`/private/tmp/wa-mouse-default-wep3.log`). These
are regression checks, not proof of the still-unimplemented input activation
transaction. Next integrate query/activation/eat at removal, with
WA_CLICKACTIVE and far-safe pump completion, before removing eager renderer
focus/raise behavior.

### Activation cause plumbing and remaining ordering gap (2026-09-20)

The Win32 notification transaction now takes an invocation-local reason;
the existing API entry wrapper supplies WA_ACTIVE (1), and the mouse path
can supply WA_CLICKACTIVE (2). The far transaction likewise carries the
reason in its own stack frame (20 bytes, formerly 16). Deactivation remains
WA_INACTIVE; Win16 still puts minimized state in HIWORD(lParam), whereas
Win32 puts it in HIWORD(wParam). No global "current mouse activation" flag
can leak into a nested API activation.

The new tests exercise the full deactivation/activation/focus stream with
reason 2, same-target no-repeat behavior, and an API activation nested inside
the mouse activation callback. The nested notification must retain reason 1
and its selected active/focus window. Far stack cleanup and the original
caller continuation result are checked explicitly. Initial tests reused a
destroyed Win32 fixture and a minimized Win16 fixture; they were corrected
to allocate fresh windows rather than weakening the expected stream.

**Still not native-equivalent:** the preserved native trace reports old A
as active during A's WM_ACTIVATE/WA_INACTIVE callback, then B during B's
WM_ACTIVATE/WA_CLICKACTIVE. Both current transactions publish B before
calling A. Existing reentrancy guards depend on that early publication.
Before mouse-pump integration, fix the publication boundary together with
reentrant-transition ownership (including same-target/ABA cases); do not
just move the assignment while retaining a guard that assumes it already
happened. The reason plumbing does not claim to fix that ordering or to
route actual mouse input yet.

Verification: Win32 and far matrices pass (`/private/tmp/wa-click-reason32-final.log`,
`/private/tmp/wa-click-reason16-final.log`). Forcing reason 1 in either runtime
path makes the corresponding stream assertion fail (the two
`wa-click-reason-negative*` logs). Both gated artifacts build successfully
(`wa-click-reason-build.log`, unchanged region layout), all seven WEP3
gameplay cases pass (`wa-click-reason-wep3.log`), and completed-artifact
Notepad minimize/restore checks pass in cooperative and Worker Chrome
(`wa-click-reason-browser.log`).

### Native activation reentrancy measured (2026-09-20)

The extended mouse probe now creates C and runs seven SetActiveWindow(B)
cases from active/focused A. IDs in the trace are A=1, B=2, child=3, C=4.
Callbacks log GetActiveWindow before invoking a one-shot nested action.
The hook disarms **before** reentry, since native USER can synchronously
send A a second WA_INACTIVE while its first deactivation callback is live.
Full output: [reference-activation-reentry-win98.txt](reference-activation-reentry-win98.txt).

| Case | Callback action | Final active/focus |
| --- | --- | --- |
| 0 | none, normal default processing | B/B |
| 1 | A deactivation calls SetActiveWindow(C) | C/C |
| 2 | A deactivation calls SetActiveWindow(A) | B/B |
| 3 | A deactivation activates C, then A | A/A |
| 4 | B activation activates C, then calls DefWindowProc | B/B |
| 5 | B activation activates C, then consumes WM_ACTIVATE | C/C |
| 6 | B consumes WM_ACTIVATE, no nested activation | B/B |

All outer SetActiveWindow calls return the original A. In cases 0–3,
A's deactivation sees A active, confirming that early publication is wrong
for API activation as well as mouse activation. Case 2 does not emit a
nested notification or cancel the outer switch. Case 3 does cancel it even
though the active HWND returns to A: equality alone cannot distinguish the
completed nested transitions from case 2. A transition-generation check
must not advance merely for a same-active reassertion.

Cases 4/5 disprove a blanket "nested activation always wins" rule. Actual
default processing after the nested call matters: in case 4 the trace shows
C deactivating, B activating again, then focus messages (including a final
B-to-B focus pair). Case 6 shows that simply consuming the original
WM_ACTIVATE does **not** suppress the ordinary focus transfer; do not remove
the transaction's focus assignment based on an untested assumption that
only DefWindowProc can perform it. Exact focus reentry and default-procedure
integration still need implementation; the existing synthetic callbacks
mostly consume messages and cannot prove case 4.

Reproduction uses the same command above with `--wait-ms 45000` and
`/private/tmp/wa-activation-reentry-final.{png,json,serial}` outputs. Same
pinned v86/Win98 profile; executable SHA-256
`a98732a56ee5b5cb1e8a498513a1150dee97724d6ebe453af9a3d22ed0819859`.
Both completion markers are present. The first five cases are byte-identical
to the preceding successful run (`wa-activation-reentry-retry.serial`),
before cases 5/6 were added. The first launch attempt produced zero serial
bytes and a screenshot of an unrelated shell dialog; it is explicitly
discarded, not scored as success. Local load average exceeded 130 during
the attempts; these are ordering observations, not performance results.
The reference-harness source checks pass. No production runtime change in
this measurement step.

### Delayed active-window publication implemented (2026-09-20)

Both notification transactions now retain the old active HWND while sending
WA_INACTIVE. They publish the new HWND only after that callback returns,
before sending its activating WM_ACTIVATE. A shared instance-local transition
serial advances at publication, not on entry or same-active reassertion.
Win32 keeps its observed serial in a local; Win16 keeps it in its own
24-byte continuation frame. A nested committed transition cancels remaining
outer notifications/focus work, including A→C→A. A same-active request does
not. Retired targets are checked before publication so destroying the
candidate during deactivation cannot clear the still-active old window.

Real x86 and far callbacks now query GetActiveWindow inside deactivation.
Tests cover no reentry, selecting a third window, reselecting the old window,
switching away and back, and destroying the candidate. The far API caller
uses ShowWindow's shared activation transaction; it is not a claim that a
new Win16 SetActiveWindow adapter was implemented. Existing return-value,
stack, reason, nested focus and destruction checks remain enabled.

One existing far fixture called ShowWindow from both activating and
deactivating WM_ACTIVATE. With native publication order that callback can
recursively ask to deactivate itself. The fixture now reacts only to a
nonzero activation reason; the new deactivation-reentry matrix explicitly
uses a one-shot hook, as the native probe does. An initial test edit also
duplicated an existing GetActiveWindow thunk declaration; that syntax error
was removed before running the far matrix.

The pre-change Win32 transaction and pre-change far adapter each fail the
new old-active observation assertion (`/private/tmp/wa-activation-serial-negative32.log`
and `wa-activation-serial-negative16.log`). Native case 4 (DefWindowProc
reclaiming activation after a nested choice), focus reentry details and
mouse-pump delivery remain open; this change does not make a blanket claim
that every nested activation must win regardless of subsequent default
processing.

Final Win32/far matrices pass (`/private/tmp/wa-activation-serial32-final.log`,
`wa-activation-serial16-final.log`). The full normal/compat gated build passes
(`wa-activation-serial-build.log`, unchanged layout `6ee344b49d5799cb`),
as do all seven WEP3 gameplay cases (`wa-activation-serial-wep3.log`) and
actual Notepad cooperative/Worker Chrome taskbar checks
(`wa-activation-serial-browser.log`). These regression checks use the
completed artifacts; they do not exercise unimplemented mouse-pump activation.

### Focus/default activation reference (2026-09-20)

The native probe additionally records GetFocus inside WM_ACTIVATE,
WM_KILLFOCUS and WM_SETFOCUS. It directly invokes DefWindowProc(B,
WM_ACTIVATE, ...) from active/focused A, then exercises SetFocus on A, B,
B's child and NULL. This isolates default processing from the outer
activation transaction.

Observed on native Win98:

- WA_INACTIVE is inert. Direct default processing with WA_ACTIVE or
  WA_CLICKACTIVE activates B with an ordinary WA_ACTIVE notification and
  transfers focus. Setting HIWORD(wParam) to 1 on this non-iconic window
  does not suppress it: message bits alone do not establish iconic state.
- GetFocus is still A inside B's initial WM_ACTIVATE; it is already B
  inside A's WM_KILLFOCUS, and B inside B's WM_SETFOCUS.
- Same-focus SetFocus(A) returns A without notifications. SetFocus(NULL)
  returns A, synchronously sends A WM_KILLFOCUS with wParam=0, exposes NULL
  to GetFocus in that callback, and leaves A active.
- SetFocus(B) first activates B. Default activation focuses B; the outer
  SetFocus then sends an additional B→B kill/set pair and returns B, not A.
  The old-focus snapshot for that second transfer is therefore after
  activation, not necessarily the focus HWND at API entry.
- SetFocus(child of B) similarly activates/focuses B first, then transfers
  B→child and returns B. Both child transfer callbacks see the child as
  GetFocus. Active remains B.

These observations expose concrete implementation gaps, not merely a
missing WM_ACTIVATE branch: Win32 SetFocus snapshots focus on entry, posts
WM_KILLFOCUS, synchronously redirects only WM_SETFOCUS, and does not activate
the ancestor. Win16 posts both messages with a comment claiming that this
is equivalent to synchronous delivery; it is not. The separate internal
`$set_focus` sender does not itself publish focus state. A default-procedure
patch that delegates to any of these unchanged paths would retain the
wrong ordering. The next implementation needs a shared focus transaction
with Win32/far callback adapters, correct post-activation return snapshot,
and nested-callback lifetime guards.

The final two cases actually minimize B: direct default WA_ACTIVE and
SetFocus(B) both return zero without changing active/focus A or delivering
focus messages. Thus the native default checks real iconic state, not only
the caller-supplied minimized bit.

Preserved focus-section output:
[reference-focus-win98.txt](reference-focus-win98.txt). Cases 0–5 are direct
defaults (reasons 0/1/2 without and with bit 16); cases 6–9 focus same/other/
child/NULL; cases 10/11 are default/SetFocus on an actually minimized B.
Raw captures and metadata: `/private/tmp/wa-focus-native-final.{serial,json,png}`,
same pinned Win98/v86 profile, using the mouse manifest and `--wait-ms 45000`.
Probe executable SHA-256:
`9cea90f1a41474181d89bb77c078cdce5ca168d932040156bd9c5f6de6e2c8b8`.
Both final markers are present; the first ten cases are byte-identical to
the preceding native run (`wa-focus-native.serial`). The source-only
reference harness test passes. Runtime remains unchanged in this reference
step; focus reentry/destruction, disabled ancestors, cross-thread focus and
Win16 public focus delivery still need regression coverage and implementation.

### Synchronous focus and activation default implemented (2026-09-20)

Win32 SetFocus now uses a synchronous focus transaction instead of posting
WM_KILLFOCUS and redirecting only WM_SETFOCUS. The Win16 adapter uses its
own far continuation for both callbacks and for any intervening top-level
activation; it no longer pretends that posting both notifications is
equivalent. Both adapters share target checks, focus publication and a
transition serial. Activation-driven focus publication uses those same
helpers, so nested activation cannot be invisible to an outer focus guard.

The target/child ancestry must be live, non-disabled and non-iconic, and
the target must belong to the current thread. NULL clears focus; a same-focus
request returns immediately. Otherwise ancestor activation runs first,
then the old-focus return value is captured, the new focus is published,
and the kill/set notifications run synchronously. A focus value established
during activation is not mistaken for an entry-time same-focus request:
the native self kill/set pair and post-activation return value are retained.
Disabled/thread validation follows the public
[SetFocus contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setfocus);
Win98-specific ordering and minimized behavior follow the preserved native
trace. AttachThreadInput is not newly implemented by this change.

DefWindowProc now handles a nonzero WM_ACTIVATE reason through this focus
path, checking actual iconic state instead of trusting the supplied minimized
bit. Both Win32 and far tests reproduce native reentry case 4: the app first
selects C, then chains to the default procedure, which reactivates B and
ends with the observed B→B focus pair. Consuming the message still retains
the nested selection, as covered by the preceding activation tests.

Regression coverage includes direct defaults, NULL/same/top-level/child and
minimized focus, disabled/foreign-thread rejection, post-activation return
values, callback GetFocus observations, nested focus selection and far
destruction during WM_KILLFOCUS. The first focus tests incorrectly assumed
reasserting an already-active window would restore focus after SetFocus(NULL);
fixtures now explicitly restore focus before the next case. Duplicate local
test variable names were also corrected. Old SetFocus adapters fail the new
Win32 synchronous-completion and far return-value assertions
(`/private/tmp/wa-focus-negative32.log`, `wa-focus-negative16.log`).

The initial build caught a disabled-style mask mistaken for a region literal;
the implementation now reuses `$ctrl_style_disabled`, and the fixture uses
EnableWindow rather than copying the mask. The next attempt caught a split-line
ESP epilogue the existing checker could not recognize; standard epilogue
formatting fixes it without changing cleanup or weakening a gate. Existing
dialog tab-stop, BUTTON notification and first-keystroke focus tests pass
(`wa-focus-dialog.log`, `wa-focus-button.log`, `wa-focus-keyboard.log`).

The logical-operand gate additionally required explicit normalization of the
new predicate at its `i32.and` call site. Final full normal/compat build passes
(`/private/tmp/wa-focus-build-verified.log`, layout `6ee344b49d5799cb`). Final
Win32 and far lifetime/default-reentry matrices pass (`wa-focus32-lifetime.log`,
`wa-focus16-lifetime.log`); completed-artifact WEP3 gameplay is 7/7
(`wa-focus-wep3.log`), and Notepad taskbar minimize/restore passes in actual
cooperative/Worker Chrome (`wa-focus-browser.log`). Shared-file resource
descriptor edits were coordinated and committed separately as `b5183f75`;
they are not part of this focus change.

WinRAR acceptance also passes (`/private/tmp/wa-focus-winrar.log`): installer
and installed file-manager rendering, with 28/28 owner-draw drive rows
containing ink. This is the existing candidate acceptance test, not a new
claim of exhaustive menu/property-sheet visual equivalence.

Still open: removal-time WM_MOUSEACTIVATE processing, eager renderer focus/
raise removal, cross-app/attached-queue semantics, broader focus-reentry
native comparisons, and cleanup of the now-unused Win32 SetFocus return
thunk. The internal `$set_focus` sender and modal/dialog focus policies still
have separate callers; this change does not claim every focus writer is
centralized.

### Input-window filtering before mouse activation (2026-09-20)

The next integration audit found that PeekMessage's direct/cached host-input
path tested only the message range, ignoring hWnd. Local and shared posted
queues tested equality but omitted child descendants. A mouse activation
hook at that point could therefore process a click excluded by the caller.

The queued paths now share one HWND/range predicate: NULL accepts all,
-1 accepts thread messages only, and a specific window admits itself and
WS_CHILD descendants through a bounded parent walk. Top-level popup ownership
or SetParent links do not count as child ancestry. This follows Microsoft's
[PeekMessage remarks and hWnd contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-peekmessagea),
not a newly captured Win98 trace. Hardware targets are resolved before the
filter, and skipped input keeps its provenance when queued. A skipped event
also no longer lends its input flag to a subsequently selected local post.

Hotkeys use their registration HWND (possibly NULL), not the physical key's
target. Filtered-out matches retain WM_HOTKEY/id/chord when moved to the
shared queue instead of degrading back into an untranslated WM_KEYDOWN.

The added test initially failed on old code with an unrelated-window filter
returning a mouse click (`/private/tmp/wa-peek-hwnd-negative.log`). Coverage
includes fresh and cached input, both remove modes, repeated peeks,
children/grandchildren, popup exclusion, local/shared queues, shared overflow,
NULL-HWND thread messages, source isolation, and filtered hotkeys. One new
overflow fixture initially posted to an unregistered HWND; it now creates a
live unrelated window and checks that all 64 prefix entries survive in order.

Targeted checks pass: `test-peek-message-filter.js`, `test-register-hotkey.js`,
`test-keyboard-hook.js`, `test-console-input.js` and `test-win16-wait-message.js`
(`wa-peek-hwnd-*.log` in `/private/tmp`). Normal and compat compilation completed.
A concurrent USER_SYS_COLORS region addition landed after the build's mirror
gate, so the final artifacts initially had a different layout from the JS
mirror. Regenerating the mirror repaired the pair; both artifact custom-section
hashes now match it (`74b29198cdc0b91f`). That unrelated region and its generated
mirror are excluded from this queue-filter commit. No browser acceptance or
new native Win98 run is claimed for this change.

This is a prerequisite queue correction, not completed mouse activation.
Removal-time WM_MOUSEACTIVATE, Win16 invocation-owned pump completion and
renderer handoff remain open. GetMessage filtering and synthesized paint/
timer HWND filtering require separate audits; this change is scoped to
PeekMessage's input and posted-message paths.

### Shared child ancestry; remove dialog-only IsChild (2026-09-20)

The follow-up found Win32 IsChild ignored hWnd entirely: it returned true
whenever hWndParent matched the current dialog global. Win16 instead had an
unbounded parent walk, while enumeration and queue filtering each maintained
another walk. The public ABIs now call `$wnd_is_child`, also used by the
enumeration predicate and PeekMessage's window filter. The shared helper
rejects NULL, self and invalid parents, follows only WS_CHILD links, and
bounds traversal by the window-table capacity. Popup ownership/reparenting
does not turn a top-level window into a child.

The behavior follows the official
[IsChild contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-ischild).
The new matrix exercises direct children/grandchildren, unrelated/reversed/
self/NULL/invalid handles, popup exclusion, enumeration parity, malformed
cycles, and both public calling conventions. The old Win32 implementation
fails a grandchild query whose parent is not the current dialog
(`/private/tmp/wa-ischild-negative.log`); the repaired matrix passes. This
does not complete the pending input-removal activation transaction.

Validation: the extended filter/IsChild/cycle matrix and existing active-window
regression pass (`wa-ischild-positive.log`, `wa-ischild-active.log`); full build
passes (`wa-ischild-build.log`) and both artifacts match the generated layout
`74b29198cdc0b91f`. Real Win16 Rodent and Rattler gameplay tests pass using
that completed artifact (`wa-ischild-vb.log`). Foreign SetSysColors and GDI
ordinal changes in the shared adapter files are excluded from this commit.

### Win32 removal-time mouse transaction (2026-09-20)

GetMessageA and PeekMessageA now separate message fetching from the Win32
mouse-removal transaction. Only successfully removed input-origin button-down
messages enter it; PM_NOREMOVE and explicit PostMessage clicks remain inert.
The target receives WM_MOUSEACTIVATE before activation and before the down is
returned. Client messages use HTCLIENT; non-client messages retain their hit
code. The top-level HWND is passed unchanged through child default forwarding.

The measured Win98 answers are implemented: 0/1 activate and deliver,
2 activates and eats, 3 delivers without activation, and 4 eats without
activation. Activation uses WA_CLICKACTIVE. Eating restarts the same fetch
with the original filters and stack frame: PeekMessage may return FALSE,
whereas GetMessage continues to the next available message. Button-up is not
discarded with button-down. A target destroyed during the transaction is not
returned as a surviving click target. All seven MSG fields are held in WAT
locals across callbacks and restored afterward, so a nested pump using the
same LPMSG cannot replace the outer message. Callback-driven activation
already uses the existing transition-generation safeguards.

This is deliberately the Win32 integration stage, not complete desktop mouse
activation. `code16` callers bypass it and far procedures are not sent through
the synchronous 32-bit sender; Win16 task/modal pumps still need their own
invocation-owned query/activation continuation. The renderer still eagerly
raises/focuses on mouse-down, so MA_NOACTIVATE is not yet an end-to-end browser
guarantee. Cross-app foreground arbitration, custom non-client hit-test
semantics and native comparisons for reentrant WM_MOUSEACTIVATE choices also
remain open. None of these are treated as completed by the unit tests.

The real-x86 callback matrix in test-active-window.js covers both public
pumps and all five observed answers, repeated no-remove peeks, exact query
parameters, WA_CLICKACTIVE, posted-click exclusion, button-up preservation,
stack cleanup, nested reuse of LPMSG, parent forwarding and filter migration
into the shared queue. The existing queue-selection fixture now calls the
fetch helpers explicitly because its artificial wndproc addresses are not
executable; the public-handler callback behavior is covered by the real guest
matrix. Earlier activation tests leave non-client work pending, so that fixture
state is drained before the mouse matrix rather than mistaken for a mouse
transaction failure. Synthetic NC filtering remains a separate open issue.

Validation passes: final callback matrix (`wa-mouse-pump32-final.log`), queue
selection (`wa-mouse-queue.log`), keyboard hooks (`wa-mouse-hook.log`) and
console input (`wa-mouse-console.log`). A source-transform negative control
that replaces the two processing calls with zero fails the first removal's
activation assertion (`wa-mouse-pump32-negative.log`). Full normal/compat
build passes (`wa-mouse-build.log`, layout `74b29198cdc0b91f`). WinRAR installer/
file-manager acceptance passes with 28/28 owner-draw drive rows containing ink
(`wa-mouse-winrar.log`). Logs are under `/private/tmp`; this acceptance is not
a claim that renderer activation/no-activation behavior is already correct.
The existing Notepad taskbar minimize/restore browser regression passes in
both cooperative and Worker modes (`wa-mouse-browser.log`); it verifies the
adjacent activation/restore paths, not the still-open browser mouse policy.
Rodent/Rattler gameplay also passes with the completed artifact
(`wa-mouse-vb.log`), checking that the explicit Win16 bypass preserves those
existing input paths while the far transaction is still pending.

### Win16 removal-time mouse transaction

The task GetMessage/PeekMessage adapters and Pascal modal pump now share the
Win32 mouse-answer predicates, but use a far continuation rather than the
32-bit synchronous sender for guest procedures. A 48-byte invocation-owned
stack frame retains the canonical MSG, destination, mode, top HWND, full
DX:AX answer and phase. It survives nested pumping, performs activation with
WA_CLICKACTIVE, then delivers or retries with the original arguments. Eaten
button-downs do not discard button-up. No-remove peeks and posted clicks do
not query. Modal delivery checks EndDialog before dispatching the saved MSG.

The real far-code matrix covers both task adapters, answers 0–4 and a
high-word answer, exact parameters/stack cleanup, repeated no-remove peeks,
posted clicks, nested Peek into the same destination, and modal answers 1–4
with dispatch-versus-eat assertions. High-word cases test ABI consistency,
not a new claim about native behavior for undocumented return values.

The matrix exposed a separate PeekMessage bug: activation-generated
WM_NCCALCSIZE/WM_NCPAINT could escape a mouse-only range filter on retry.
Those synthetic scans now respect the message range without consuming
excluded NC work. Synthetic HWND filtering and the broader GetMessage
filter audit remain open.

Fixture corrections matter: fresh code addresses avoid reusing decoded old
callbacks; the modal cases clear earlier paint/posted work and advance at
callback boundaries. Earlier failures landed in an old reinvalidating paint
procedure, not the new mouse continuation. The main-tree far matrix,
Win32 activation matrix and queue-filter suite pass. A negative control
disabling the far source hook fails the first activation assertion.

Clean-tree validation at `/private/tmp/wa-far-mouse-verify` uses HEAD
`d6cd173b` plus only this stage's source/test changes, transferred with rsync.
Both normal and compatibility builds pass all gates (`wa-mouse-clean-build.log`,
layout `74b29198cdc0b91f`), and the final far matrix passes there too
(`wa-mouse-far-clean.log`). The clean tree excluded a concurrently added
DISPDIB class hook and its unfinished dependencies; their owner subsequently
landed them separately as `1958ab08`. No build ratchet was weakened.
Rodent and Rattler gameplay/input checks pass against that clean artifact
(`wa-mouse-far-vb.log`). These are adjacent real-app regressions, not a
replacement for a browser no-activation acceptance test.

Remaining: renderer eager raise/focus and cross-app foreground handoff;
built-in child-control default forwarding to far parents; fuller reentrant
mouse-query/lifetime and native comparison coverage. This stage does not
claim end-to-end browser MA_NOACTIVATE correctness.

### Renderer handoff audit after 875749f4

The next change cannot be just deleting `_raiseWindowGroup` from mouse-down.
Current source has these independent bypasses:

| Boundary | Current behavior | Required integration |
| --- | --- | --- |
| `renderer-input.js::handleMouseDown` candidate loop | Raises the window group, changes keyboard owner and transfers focus before enqueueing input | Defer activation effects until USER accepts the removal-time query |
| `_setInputFocus` cooperative branch | Calls `set_focus`, then forces `set_focus_hwnd(requested)` if the result differs | Preserve the authoritative focus transaction and callback-selected winner |
| `_setInputFocus` Worker branch | Updates a shadow global and publishes a focus request separately from mouse removal | Keep the query and focus decision on the live guest instance; do not execute guest procedures on the shadow |
| Native dialog/combo/button routes | Some downs call `control_wndproc_dispatch` or `dialog_route_mouse_screen` directly; native scrollbar downs have another early return | Cover these routes with the same activation decision before dispatch, including eaten clicks |
| `host-window.js::activate_window` | Already raises the group and selects keyboard ownership after WAT calls it | Use this as the accepted-activation publication seam, with cross-app arbitration still to specify/test |

The focus mismatch has a concrete cause, not just duplicated naming.
`09c0-window-table.wat::$set_focus` sends KILLFOCUS/SETFOCUS but does not
publish focus or use the transition serial. The renderer export still calls
it. In contrast, the public SetFocus API uses `$focus_set_core`, which
validates, publishes and guards reentry. Seven internal call sites also use
the old helper (dialog/navigation/control paths); replacing the export alone
would leave those divergent semantics. Some callers run inside far/native
dialog routing, so blindly redirecting all of them to the synchronous
32-bit sender is not safe.

A direct JavaScript probe of the actual `_setInputFocus` implementation
confirmed the overwrite: requested HWND 2; the mocked `set_focus` callback
selected HWND 3; the renderer then invoked `set_focus_hwnd(2)`, leaving 2.
This proves the host helper overwrites a callback-selected result, not that
every real app reaches that scenario. The keyboard seed fixture currently
mocks `set_focus` as notification-only, so its passing result would not prove
that a unified focus transaction preserves guest reentry.

Next implementation order: consolidate focus publication/notification with
ABI-appropriate completion; cover native child default mouse activation and
far-parent forwarding; then remove eager renderer effects and validate the
accepted-activation host publication in cooperative and Worker modes. Keep
input target ownership separate from keyboard ownership: `takeInput(owns)`
already supports selecting events for another instance without switching
the keyboard to it first. Acceptance must include answers 1–4, no-remove
peeks, child/native targets, guest focus redirection, two overlapping apps,
and an eaten down with its later up. Existing task-pump tests do not cover
these browser boundaries.

### Shared internal focus publication

The notification-only internal `$set_focus` now validates the requested
target and shares `$focus_notify_transfer` with public SetFocus. That helper
publishes the HWND and transition serial before KILLFOCUS, then sends
SETFOCUS only if the target is still live and no nested focus transaction
superseded it. The API still owns ancestor activation and its measured
post-activation return semantics; internal control handoff does not acquire
a new activation policy in this change.

The cooperative renderer treats `set_focus` completion as authoritative:
it no longer follows it with a raw `set_focus_hwnd(requested)` write. The
Worker branch retains its shadow update/publisher without entering guest
code on the idle browser instance. The keyboard-seed mock now models focus
publication rather than depending on the removed JS overwrite.

The real x86 callback regression drives the renderer helper, observes the
requested HWND inside KILLFOCUS, redirects through guest SetFocus, and
requires the nested winner with no stale outer SETFOCUS. Internal disabled
targets are also rejected. The JS regression covers guest redirection,
rejection and Worker-shadow isolation; loading the pre-change renderer
makes it fail (requested child replaces callback-selected main HWND).

This does not close the full audit above: the existing internal sender still
posts far-procedure notifications. Win16 callers need invocation-owned
completion to become synchronous; public Win16 SetFocus already has that
path. MDI and modal restore helpers also retain separate focus logic and
must be audited, along with native control writes. Browser eager activation
and direct native mouse routes remain open.

Validation: keyboard-seed/Worker-shadow checks, real x86 renderer reentry,
dialog initialization/tab-stop focus and far callback matrix pass. Two
independent negatives fail: old renderer overwrites the guest winner
(`wa-focus-host-negative.log`); old internal WAT helper sends a stale
SETFOCUS (`wa-focus-internal-negative.log`). Full normal/compat build passes
(`wa-focus-internal-build.log`, layout `c5ccefca8909ee4b`); Rodent/Rattler and
all seven WEP3 gameplay checks pass against that artifact
(`wa-focus-internal-vb.log`, `wa-focus-internal-wep.log`). Logs are under
`/private/tmp`. Worker isolation here is a host-unit assertion, not an
end-to-end browser no-activation test.

### MDI focus uses the shared handoff

Removed `$mdi_set_focus`, a second publish/KILLFOCUS/SETFOCUS sequence that
unconditionally notified the requested child after a callback had selected
another window. All four callers now use `$set_focus`: already-active child
selection, newly selected child, MDICLIENT WM_SETFOCUS and frame-default
WM_SETFOCUS. This shares target validation, focus serial publication and the
reentry guard without adding frame-activation policy to MDI child selection.

The real x86 regression exercises those four paths with a KILLFOCUS handler
that reads GetFocus and redirects via SetFocus. Each must expose the proposed
child before the callback, keep the nested winner and omit stale SETFOCUS
to the superseded child. The existing ANSI/Wide MDI default-procedure and
maximized-child resize suites also pass. This is focus-handoff coverage,
not proof that arbitrary reentrant WM_MDIACTIVATE state transitions are
already correct.

Modal restoration remains open for a concrete reason: the EndDialog branch
in `09b-dispatch.wat` calls `$focus_restore_after_modal` **before** capturing
`dlg_result` and `dlg_ret_addr` and restoring the enclosing modal state.
Replacing its posted owner notification with a synchronous callback alone
would permit a nested dialog to overwrite the retiring call's result.
Snapshot/restore ownership must be fixed together with synchronous delivery;
the native common-dialog completion path needs the same reentry audit.

Validation logs under `/private/tmp`: `wa-mdi-focus.log`,
`wa-mdi-default.log` and `wa-mdi-resize.log` pass; reverting only the MDI
source makes route 0 fail on the stale notification
(`wa-mdi-focus-negative.log`). Main-tree build stopped on an unrelated
untracked test's 900-second timeout exceeding the 300-second runner cap.
The clean test tree `/private/tmp/wa-mdi-focus-verify`, based on `7dc1743a`
with only these three files copied by rsync, passes the callback suite and
full normal/compatibility build (`wa-mdi-focus-clean-test.log`,
`wa-mdi-focus-clean-build.log`, layout `c5ccefca8909ee4b`). No gate or foreign
test was changed. No performance claim is made on the heavily loaded host.

### Modal completion snapshots before teardown

The CACA0004 EndDialog completion now retains the retiring HWND, result and
return address in invocation-local variables **before** child teardown and
owner restoration. Child WM_DESTROY can reenter USER; rereading
`dlg_pump_hwnd` afterward could remove a nested dialog instead of the outer
one, and rereading `dlg_result`/`dlg_ret_addr` could return the nested call's
answer to its caller. The saved parent-pump frame and 24-byte API cleanup
remain unchanged.

`test-end-dialog-lifecycle.js` now gives a child a real x86 WM_DESTROY
procedure that calls GetTickCount. Its test host reenters the module and
changes the modal globals to a different live HWND, result 99 and return PC.
The retiring call must remove only its own HWND, retain the other live
dialog, return its original 42/address and consume exactly its own frame.
This deliberately injects the nested completion's shared-state writes; it
does not claim to run a full second DialogBox loop or establish native
notification timing. An earlier result-only variant reproduced 99 instead
of 42 with the old source.

This is a prerequisite ownership repair, not the synchronous focus migration
itself. Native common dialogs additionally retain return PC, saved ESP,
cleanup size, four nonvolatile registers and restore-pending state in modal
globals (`modal_begin`/`modal_capture_nonvolatile`, consumed by CACA0006).
Those need invocation ownership across focus callbacks too. The posted owner
notification is unchanged until that completion protocol is covered.

Validation: the final lifecycle test passes in the clean verification tree
(`wa-modal-result-final-clean.log`). Replacing only `09b-dispatch.wat` with
the pre-fix source fails because the retiring HWND remains alive
(`wa-modal-result-final-negative.log`). Normal/compatibility builds pass all
gates (`wa-modal-result-final-build.log`, layout `c5ccefca8909ee4b`). These
logs are under `/private/tmp`; verification reused the clean MDI tree above,
adding only the dispatch/lifecycle changes via rsync. Unrelated main-tree
test work was excluded, not modified.

### Common-modal continuation and synchronous Win32 owner focus

`modal_finish_local` now owns the parked API's result, return PC, saved ESP,
cleanup size, four nonvolatile registers and restore-pending marker across
teardown/owner callbacks. It snapshots these in WAT locals and republishes
the original continuation afterward for CACA0006. It also republishes the
outer shared result after owner notification. This prevents a completed
nested dialog from lending its continuation to the retiring API.

Owner focus restoration now uses the shared internal focus transaction
instead of publishing a raw HWND and posting guest WM_SETFOCUS. Win32 owner
callbacks therefore run before restoration returns and can redirect focus;
an existing live focus is still left alone. Internal far-procedure delivery
retains the sender's posted path, so this is not a claim of synchronous
Win16 internal restoration or complete modal activation behavior.

The two-instance common-dialog test covers direct owner completion and
renderer-shadow completion, injects nested continuation writes during
teardown, and executes the actual CACA0006 return to assert result, EIP,
ESP, EBX/ESI/EDI/EBP and the pending marker. This is a saved-frame regression,
not a full nested-dialog browser test. The real x86 focus suite separately
checks that an owner observes itself focused inside synchronous WM_SETFOCUS
and can redirect to another child before restoration returns.

Validation under `/private/tmp`: common-frame and lifecycle clean-tree tests
pass, as does the real x86 focus matrix. Reverting the common completion
source yields nested result 256 instead of 42 (`wa-common-frame-negative.log`);
reverting owner restoration fails the synchronous-callback assertion
(`wa-modal-focus-negative.log`). Full clean build gates pass
(`wa-common-focus-build.log`); final normal/compat recompilation after shared
result republication also passes, with no data overlaps and layout
`c5ccefca8909ee4b` (1453624/1454530 bytes).

EmPipe stage transition passes 13/13 checks on the final artifact
(`wa-common-focus-empipe-final.log`), and Rodent/Rattler gameplay passes
(`wa-common-focus-vb.log`). The first EmPipe run passed its stage/bonus/timer
checks but failed an obsolete trace boundary: `dlg-click` is logged after
synchronous button dispatch, so the owner's GetFocus now precedes that line.
Raw trace (`wa-common-focus-empipe-raw.log`) confirmed this ordering. The
test now starts its observation at a read-only marker immediately before
the click, still excluding startup focus; it also accepts the standard
`WINE_ASSEMBLY_WASM` prebuilt-artifact override. These tests do not replace
the remaining full nested-dialog/browser activation acceptance matrix.

### Actual nested guest-dialog coverage

The lifecycle regression now goes beyond injected global writes. Real x86
callbacks call DialogBoxIndirectParamA using an empty DLGTEMPLATE, and the
nested guest DLGPROC calls EndDialog(99) from WM_INITDIALOG. Three routes
exercise that complete nested pump: child WM_DESTROY, owner WM_SETFOCUS
while a DialogBox retires, and owner WM_SETFOCUS while a common dialog
retires. The nested callback must receive 99, both dialog records must be
removed, the owner must survive, and the outer call must return its own 42,
return PC and stack cleanup.

A fourth route calls real MessageBoxA from the common dialog's owner focus
callback. The test host supplies its OK command when the nested modal pump
paints; it does not overwrite continuation globals. The nested MessageBox
returns IDOK, while the outer common call keeps result 42 and its saved
frame. The owner deliberately uses different EBX/ESI/EDI/EBP values during
MessageBox and restores its callee-saved registers afterward; the outer API
must restore its own saved values rather than the nested dialog's values.

Reverting only the common-modal runtime to before `168ecb6d` reproduces the
actual nested-call failure: IDOK (1) escapes as the outer result instead of
42 (`wa-real-nested-common-negative.log`). This closes the injected-state-only
coverage gap for these self-closing guest dialogs and programmatically
accepted MessageBox. It is still a headless real-guest test, not a browser
interaction/Worker or Win16 nested-dialog matrix.

Final clean-tree regression including distinct nested nonvolatile registers
passes (`/private/tmp/wa-real-nested-final.log`). Embedded-WAT address and
test-timeout gates also pass. This stage changes tests/notes only; the runtime
fix remains `168ecb6d`, and no additional artifact rebuild is claimed.

### Win16 modal completion uses the far focus continuation

The Win16 modal pump no longer publishes `main_hwnd` and posts WM_SETFOCUS
before removing a focused dialog child. After teardown it preserves any
surviving focus window; otherwise it restores the actual owner (main-window
fallback only for an ownerless dialog) through `win16_focus_start`. Owner
activation and real far focus callbacks complete before DialogBox returns,
using the existing target validation and reentry guards.

The pump's six-byte `{dialog, return offset, return selector}` frame becomes
`{result, return offset, return selector}` before teardown. This is already
the representation `win16_cont_resume` consumes: no new continuation opcode,
global scratch record or duplicated return machinery is needed. In particular,
a focus callback's nested EndDialog cannot replace the outer return value.
This preserves the deferred completion/result contract documented for
[EndDialog](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enddialog).
The reference is modern API documentation, not a new native Win98 trace of
the entire destruction/activation sequence.

The real far-code regression covers distinct owner/main windows, nested
SetFocus redirection, surviving external focus, owner activation, ownerless
fallback, and a genuine DialogBoxIndirect whose WM_INITDIALOG calls
EndDialog(99) inside the retiring dialog's owner WM_SETFOCUS. Both dialogs
must disappear, the owner must survive, and the outer invocation must retain
42, DX:AX, its return PC and its six-byte stack cleanup. No restoration
notification may remain posted. Replacing just the runtime with its old
version fails by selecting the unrelated main window
(`/private/tmp/wa-far-modal-negative.log`).

Clean verification uses HEAD `9327e0ec` plus rsync of the two changed runtime/
test files in `/private/tmp/wa-far-modal-verify`, excluding unrelated shared
worktree edits. Full build gates and normal/compat compilation pass
(`/private/tmp/wa-far-modal-build.log`), layout `c5ccefca8909ee4b`, artifact
sizes 1453278/1454184 bytes. The initial nested far matrix passes
(`/private/tmp/wa-far-modal-clean.log`), as does the final six-case matrix
including activation/fallback (`/private/tmp/wa-far-modal-final.log`). Real
Rodent/Rattler gameplay and all seven WEP3 gameplay cases pass on this
artifact (`/private/tmp/wa-far-modal-vb.log`, `wa-far-modal-wep3.log`).
Broader internal far notifications,
native-child mouse forwarding, renderer eager activation, and browser/Worker
acceptance remain open; this is not a general Win16 nested-dialog lifecycle
rewrite.

### Native-child mouse activation forwarding

The native control dispatch now sends an unhandled WM_MOUSEACTIVATE through
the shared default parent policy. Previously zero escaped directly to the
input pump, which interpreted it as activation consent without consulting
the parent. The [official WM_MOUSEACTIVATE contract](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-mouseactivate)
requires parent-first processing when the child delegates to DefWindowProc.

Win16 needs a different execution mechanism, not different policy: the WAT
synchronous sender posts far messages and cannot obtain their return values.
`win16_mouseactivate_start` now walks native-control forwarding until it
reaches a guest far procedure, then suspends through the existing FFBC
continuation. Its invocation owns the original lParam and a default-fallback
flag. This flag distinguishes an explicit guest zero result from zero passed
back into DefWindowProc; the complete DX:AX answer survives either route.
The walk is bounded by MAX_WINDOWS. Removed mouse input, explicit Win16
SendMessage, and Win16 DefWindowProc share this query machinery.

Regression coverage uses two native-control-dispatch HWNDs between the click
and a real guest parent. The Win32 parent veto must leave activation alone;
the far matrix covers answers 0, 1, 2, 3, 4 and a high-word-bearing value,
with exact query parameters, delivery/eating, no posted query, and stack
restoration. Existing nested query/modal/DefWindowProc cases remain in the
same suite. These are dispatch/ABI tests, not a new native capture of each
control class or end-to-end browser no-activation acceptance. Browser eager
activation and other internal far sender paths remain separate work.

Validation: both clean real-guest matrices pass (`wa-native-mouse32-clean.log`,
`wa-native-mouse-final-clean.log`). Independent old-source negatives fail:
without the native default epilog the Win32 parent sees no query and unwanted
activation occurs; without the far bridge the parent sees no synchronous
query (`wa-native-mouse32-negative.log`, `wa-native-mouse-negative.log`).
The clean tree `/private/tmp/wa-native-mouse-verify` is based on `4506e725`
plus only the claimed source/tests via rsync. Full gates/normal+compat build
pass (`wa-native-mouse-build.log`); final compilation after adding explicit
SendMessage routing and using MAX_WINDOWS also passes with no data overlaps,
layout `c5ccefca8909ee4b`, sizes 1454186/1455092 bytes. The Win32 fixture adds
no runtime changes after its clean pass; the final far fixture includes the
explicit SendMessage matrix and its exact full-result/stack checks.
Rodent/Rattler gameplay and WEP3 7/7 pass on the final artifact
(`/private/tmp/wa-native-mouse-vb.log`, `wa-native-mouse-wep3.log`).

### Disabled browser frames reject input before ownership effects

The browser candidate loop previously raised a disabled top-level frame,
selected its instance as keyboard owner, and attempted focus transfer before
its later client-route WS_DISABLED check rejected the click. That check now
runs before those effects. It does not make disabled children transparent in
a new way or change capture routing; the existing child/parent routing stays
intact. General enabled-window WM_MOUSEACTIVATE handoff is still open.

The renderer drag/input test now clicks an inactive disabled frame belonging
to another instance with left and right buttons, under both cooperative and
Worker ownership configuration. It checks unchanged z-order/keyboard owner,
no focus calls or Worker focus publication, no down input, and restored click
delivery after reenabling the same HWND. The old renderer fails by raising
the frame from z-order 1 to 10 (`wa-disabled-frame-negative.log`). The fixture
also corrects its obsolete notification-only set_focus mock: shared USER has
owned publication since `25c1a98c`; separate focus-seed tests still verify
that a callback-selected result is not overwritten.

Both updated mouse-drag and keyboard-focus suites pass in main and the clean
temporary verification tree using rsync of just the relevant JS files. No
WASM changed in this stage. Adjacent multi-app-modal and dialog-caption-drag
tests currently fail because their expected queues omit the already-existing
WM_NCHITTEST event. Both failures reproduce with HEAD's unchanged renderer
(`wa-disabled-frame-multi-baseline.log`, `wa-disabled-frame-caption-baseline.log`);
they are not counted as passing validation or fixed here. They need updating
before the broader browser activation acceptance matrix can be trusted.

### Renderer acceptance fixtures repaired; cross-app prerequisite

The two stale queue expectations above now include WM_NCHITTEST before the
button down. They retain exact event ordering and assert screen coordinates
for hit testing versus child-client coordinates for the button/drag. No event
is filtered away to make the tests pass. Multi-app modality and caption/child
drag suites now pass alongside mouse-drag and keyboard-focus suites, both in
main and the temporary clean JS verification tree.

The multi-app test also pins a useful boundary: with keyboard ownership set
to app A, `takeInput(ownsB)` can drain B's hit-test/down/up events in order,
while `takeInput(ownsA)` cannot consume them and dequeue itself does not
change keyboard ownership. This proves target routing does not require the
eager keyboard switch; it does not yet prove a guest activation transaction.

Source inspection identifies an additional prerequisite for removing that
switch. Both `message_mouse_activate32` and `win16_mouse_input_start` skip
the query when the target top-level equals their instance-local `active_hwnd`.
The renderer's `_setKeyboardInputOwner` changes host instance/memory tokens,
and `activate_window` raises the accepted window and invokes that helper;
neither path deactivates the old guest instance. Consequently a background
app can retain a locally active HWND. Simply deleting eager host raising
would then leave its click on the same-active fast path, with no query and
no accepted-activation host callback to raise it.

Next integration must distinguish local active-window state from desktop
foreground ownership at the removal decision, preserve source provenance
through queued input, and publish accepted ownership only after the result.
Tests must cover two instances whose local active HWNDs remain set, answers
1–4, no-remove, live Worker versus shadow execution, and the already-known
direct native-control routes. Existing single-instance active-window tests
cannot establish this cross-instance property. No runtime behavior changes
in this fixture/audit stage.
Negative controls confirm the repaired test rejects both dropping
WM_NCHITTEST (`wa-input-order-negative.log`) and ignoring the queue's ownership
predicate (`wa-input-owner-negative.log`); both are in `/private/tmp`.

### Foreground-aware removal-time query gate

Both ABI pumps now use `mouse_target_is_active`: skipping WM_MOUSEACTIVATE
requires the target to match both local `active_hwnd` and the existing
`foreground_window` host import. A different foreground HWND, or NULL,
requires a query even if the target remains locally active. The distinction
matches the documented separation of [GetActiveWindow's calling-queue state](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getactivewindow)
from desktop foreground ownership; no new native Win98 cross-app trace is
claimed here. Foreground is read only on the local-active fast-path candidate,
not for every message or every interpreter operation.

The real Win32 and far-code matrices now cover all four standard answers
with the same locally active target and either a foreign foreground HWND or
NULL. PM_NOREMOVE makes no guest query. Removal delivers/eats according to the
answer, only answers 1/2 call host activation, and rejecting desktop activation
does not erase the instance's local active HWND. The ordinary same-local-and-
foreground case retains its no-query fast path. Both matrices pass in the
clean tree (`wa-foreground-clean32.log`, `wa-foreground-clean16.log`);
independent negatives restoring the local-only predicate fail by omitting
the query (`wa-foreground-negative32.log`, `wa-foreground-negative16.log`).

This is the guest decision prerequisite, not completed browser arbitration:
the host still derives foreground from renderer z-order, eager mouse-down
raising can change that before removal, other native input routes still
bypass the pump, and WM_ACTIVATEAPP/old-app deactivation and live Worker
acceptance remain open. No host/Worker import signatures changed.

The first clean build also found the prior disabled-frame fixture had added
a second WS_DISABLED literal that equals a region base and tripped the raw
address ratchet. Both fixture uses now share one named WS_DISABLED constant;
the test passes and no gate or baseline was relaxed.

Clean verification uses `47bf2871` plus the claimed files via rsync in
`/private/tmp/wa-foreground-mouse-verify`. Full build gates, normal/compat
compilation and data-overlap checks pass (`wa-foreground-build-final.log`),
layout `c5ccefca8909ee4b`, sizes 1453972/1454878 bytes. The final far matrix
also explicitly checks that matching desktop/local state skips the query
(`wa-foreground-final16.log`). All four renderer/input JS suites pass in the
clean tree. Rodent/Rattler gameplay passes (`wa-foreground-vb.log`).
WEP3 gameplay also passes all seven cases (`wa-foreground-wep3.log`).

### Explicit accepted foreground (host and Win16 show handoff)

The host now records the window accepted by `activate_window`, independently
of renderer z-order. Both import contexts sharing a renderer see the same
record. The record's object identity prevents a recycled HWND from becoming
foreground; hide/minimize, hidden positioning and destruction clear it.
Raising another surface alone no longer changes GetForegroundWindow. This
implements the ownership distinction, not the remaining selection of a
replacement after hide/minimize. NULL is an allowed transition result in
[Microsoft's GetForegroundWindow contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow).

The unchanged Fuji Golf gate caught a prerequisite omission: far ShowWindow
updated guest activation without publishing host activation. Its clubhouse
was correctly sized but painted an inactive caption (blue width zero).
ShowWindow now keeps a pending publication bit in its invocation-owned show
frame and consumes it after the far activation transaction, before size and
erase callbacks. It publishes only a surviving, visible, nonminimized target
that still matches the accepted local active window. A nested activation
therefore wins; child and no-activate shows do not publish. This follows the
[documented show-mode activation distinction](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow),
not a new claim of native Win98 cross-application ordering fidelity.

Remaining: renderer mouse-down/ShowWindow can still change z-order and
keyboard ownership eagerly; direct native-control input routes bypass the
removed-message query; cross-app WM_ACTIVATEAPP, old-app deactivation,
hide/minimize replacement selection and live Worker acceptance need work.
In particular SW_SHOWMINIMIZED has a documented activation contract that the
current renderer's hidden-minimized representation does not fully model.

Verification in the existing clean `47bf2871` tree plus committed `5611d821`
and this stage's owned files: full build gates and both compiled artifacts
pass (1454060/1454966 bytes, layout `c5ccefca8909ee4b`). Host relations and
three renderer/input suites pass; Win32 and real far callback matrices pass.
Old-host and old-far negative controls fail at the new assertions. The rebuilt
Rodent/Rattler and all seven WEP3 gameplay cases pass, including Fuji's
unchanged active-caption and scene-depth checks. Logs are `/private/tmp/`
`wa-accepted-foreground-{build,far,win32,negative,far-negative}.log` and
`wa-accepted-foreground-{vb,wep3}-final.log`. These are clean headless checks,
not a live browser/Worker acceptance claim.

### Native press ownership before deferred activation

The toolbar-combo/deep-dialog branch kept a pending mouse-up without its
owning WASM instance and stored the child HWND instead of the container used
for mouse-down. A scheduler slice switching `renderer.wasm` could therefore
release through another application's router; even without that switch,
the release used a different container. This dependency must be removed
before pointer routing can stop eagerly selecting the keyboard owner.

The route now uses `ownerWasm` for classification/dispatch, classifies once,
and retains the actual routing parent, owner and parent-client origin for
mouse-up. The legacy coordinate router gets parent-relative coordinates,
not the deep child's coordinates. The multi-app regression drives down/up
through both screen and legacy routers with a foreign run slice between
them and asserts the exact owner, container and coordinates. The old-source
negative fails because the pending press has no owner
(`/private/tmp/wa-native-owner-negative.log`). This does not yet move native
controls onto the removal-time WM_MOUSEACTIVATE decision.

Four focused renderer suites pass in main and the clean validation tree.
Two adjacent clean-tree tests (`test-renderer-dialog-modal-input.js` and
`test-renderer-dialog-button-queue.js`) fail identically with the unchanged
renderer: their assertions require queuing WAT-button input, whereas the
current implementation routes it synchronously. Their foreign worktree
edits are not part of this change. Baseline evidence is in
`/private/tmp/wa-native-owner-{modal,button}-baseline.log`.

The clean-tree WordPad browser regression passes after using rsync to put
its EXE/DLL/help assets inside the static server's root (the first attempt
correctly rejected the external worktree symlink with HTTP 403). Evidence:
`/private/tmp/wa-native-owner-wordpad.log` and the clean tree's
`test/output/wordpad-web/hello-world.png`. This covers real RichEdit typing,
Date/Time insertion, inline DIB, toolbar and menu rendering; the synthetic
multi-instance matrix, not this single-app browser smoke, proves the routed
press-owner handoff. No WAT/Worker ABI or build-artifact change in this stage.

### Cancel native presses at the actual release point

The release audit found two independent shortcuts: the renderer retried a
missed UP at the original DOWN coordinates, while the BUTTON procedure
cleared capture but toggled/notified without checking the UP coordinates.
The renderer also dropped an outstanding parent-routed press when UP was
outside a modal frame, leaving USER's capture/pressed state behind.

Pending routed releases now cross those modal bounds and reach the owning
router exactly once at the actual point. A miss is not retried at the press
point. Native BUTTON cancels releases beyond its client bounds, including
signed negative coordinates and the exclusive right/bottom edges, before
automatic state changes or BN_CLICKED. It clears pressed/capture state and
invalidates the cancelled button for repaint. This respects the documented
[capture delivery outside the window](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-mouse-input)
and [BUTTON capture/client-rectangle processing](https://learn.microsoft.com/en-us/windows/win32/controls/button-messages);
no new native Win98 notification-order capture is claimed.

The renderer matrix covers both router ABIs, a foreign current emulator,
modal and nonmodal parents, and missed UP with no synthetic retry. The real
WAT router/button matrix covers four outside edges for push/default,
auto-checkbox, auto-three-state, auto-radio and owner-drawn buttons, then
verifies inside clicks still notify and automatic kinds still check.
Independent old-JS and old-BUTTON negatives fail (extra release and unwanted
BN_CLICKED respectively). This does not finish move-time pressed highlighting,
capture-change cancellation, or the previously listed activation work.

Final checks: native button matrix passes in main and the clean tree; four
renderer/input suites pass; full clean build gates and normal/compat compile
pass (1454113/1455019 bytes, layout `c5ccefca8909ee4b`). Rodent/Rattler,
WEP3 7/7 and the WordPad browser regression all complete successfully.
Evidence is `/private/tmp/wa-release-outside-{native-final,native-clean,
native-negative,js-negative,build,vb,wep3,wordpad}.log`. The obsolete stored
DOWN coordinate was removed along with its retry consumer. Other agents'
uncommitted dialog-fixture changes remain excluded.

### BUTTON cancellation on capture/focus loss

BUTTON previously ignored WM_CAPTURECHANGED and WM_CANCELMODE, and its
WM_KILLFOCUS branch cleared focus/default decoration without cancelling a
tracked press. Public SetCapture/ReleaseCapture already sent the capture
notification, but the control left its pressed bit and the native dialog
router's capture target behind. A later UP could still notify BN_CLICKED.

A shared control cancellation helper now clears pressed state and the
matching dialog-router target without touching check/default/focus bits.
WM_CAPTURECHANGED never changes the already-published replacement owner;
WM_CANCELMODE and focus loss release capture only when this button owns it.
Focus-loss processing refreshes the state pointer after capture notification,
since a callback may destroy the control. These follow Microsoft's
[capture-change rule](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-capturechanged)
and [BUTTON focus-loss cancellation](https://learn.microsoft.com/en-us/windows/win32/controls/button-messages).

The regression exercises the real SetCapture/ReleaseCapture handlers,
WM_CANCELMODE, and shared focus transfer, proving a nonzero pressed state
before cancellation, preserving a replacement owner, clearing the dialog
router target, and rejecting a later stray UP without a command.

**Correction to the previous release tests:** their BM_GETSTATE zero check
was too weak. BUTTON does not yet implement BM_GETSTATE, so that observation
did not prove the pressed state had cleared. The tests now inspect the
actual ButtonState flags via the existing diagnostic export; outside-release
notification, check-state and capture assertions were independent and remain
valid. BM_GETSTATE remains an explicit open API gap, alongside move-time
highlighting and the broader input/activation work. No native Win98 ordering
trace or live Worker acceptance is claimed by this stage.

Verification: corrected native matrix passes in main and the clean tree
(`wa-button-cancel-main.log`, `wa-button-cancel-final2.log`); the old-source
negative fails on the retained dialog capture (`wa-button-cancel-negative2.log`).
Both main and clean full builds pass; only the clean build isolates this
change from other agents' edits. Its normal/compat sizes are 1454258/1455164,
layout `c5ccefca8909ee4b` (`wa-button-cancel-clean-build.log`). Rodent/Rattler,
WEP3 7/7 and WordPad browser checks pass (`wa-button-cancel-{vb,wep3,wordpad}.log`).
All logs are under `/private/tmp/`.

### Public button state and autoradio release drift

BM_GETSTATE now translates ButtonState's stored check, pressed and focus
flags into the public BST bits instead of returning the default zero. The
internal default-border bit is deliberately excluded: it occupies the same
bit position as public BST_PUSHED, but does not mean pressed. The getter
translates the state pointer once and introduces no second state record.
The mapping follows [Microsoft's BM_GETSTATE contract](https://learn.microsoft.com/en-us/windows/win32/controls/bm-getstate).

The new real-input assertions caught a separate auto-radio bug: UP cleared
pressed in a local, then reloaded the still-pressed ButtonState after clearing
sibling checks. The public result remained 13 (checked, focused, pressed)
instead of 9 (checked, focused). That reload now excludes the retired press.
Tests independently assert the native pressed flag is zero after inside
release and check public results during press, after outside cancellation,
after accepted release, and after capture/focus cancellation for six styles.
Old-getter and old-radio-reload negative controls target separate failures.

This adds observation of existing canonical state; it does **not** complete
three-state checkboxes. BM_SETCHECK/ctrl_set_check_state still reduce nonzero
values to one checked bit, and BS_AUTO3STATE still uses a binary toggle.
Indeterminate state storage, its automatic cycle and rendering therefore
remain open together; BM_GETSTATE cannot report a state that these setters
do not retain. Move-time highlighting/BM_SETSTATE and broader activation
work also remain open. Modern themed HOT/dropdown state is not modeled.

Final native matrix passes in main and the clean tree
(`/private/tmp/wa-button-getstate-main-final.log`, `wa-button-getstate-final.log`).
The two independent negatives fail (`wa-button-getstate-negative.log`,
`wa-button-getstate-radio-negative.log`). Clean full gates pass
(`wa-button-getstate-build.log`); after the radio correction, final concat,
paren check, normal/compat compile and data-overlap check also pass: sizes
1454320/1455226, layout `c5ccefca8909ee4b`. Rebuilt Rodent/Rattler, WEP3 7/7
and WordPad browser checks pass (`wa-button-getstate-{vb,wep3,wordpad}.log`,
all under `/private/tmp/`). No live cross-app Worker acceptance is claimed.

### Three-state checkbox storage, cycling and painting

The preceding indeterminate-state gap is now addressed without growing
ButtonState: private bit8 represents indeterminate, mutually exclusive with
checked bit1. Shared encoding helpers preserve pressed/default/focus flags;
BM_SETCHECK and the legacy check setter retain 0/1/2, and BM_GETCHECK and
BM_GETSTATE read the same state. Setters ignore push-button styles.
BS_AUTO3STATE cycles 0 -> 1 -> 2 -> 0; BS_3STATE remains application-managed.
This follows Microsoft's [button styles](https://learn.microsoft.com/en-us/windows/win32/controls/button-styles)
and [BM_SETCHECK](https://learn.microsoft.com/en-us/windows/win32/controls/bm-setcheck)
contracts. Unsupported numeric check values retain the prior nonzero-to-checked
normalization; their exact native behavior has not been established here.

The shared checkbox painter accepts an explicit three-state value, drawing
the indeterminate tick gray. Its existing boolean wrapper remains for
ListView callers so a nonzero boolean cannot accidentally become state2.
Tests sample the actual GDI pixels and write three-state strips to
`test/output/button-three-state-{5,6}.png`. These are emulator regression
artifacts, not a pixel-exact native Win98 oracle.

The native command-queue fixture covers both setters/getters, two complete
automatic cycles, manual non-cycling, no programmatic notification, and
outside-release cancellation preserving indeterminate and focus. Main and
clean-tree runs pass; the old binary decoder negative fails with 0 instead
of 2. The radio-group regression also passes. Clean full build gates pass:
normal/compat sizes 1454485/1455391, layout `c5ccefca8909ee4b`.
Logs: `/private/tmp/wa-three-state-{main,final,negative,radio,build}.log`.
The final PNG-producing fixture passes (`wa-three-state-pixels.log`); the
rendered strip was inspected. Rebuilt VB games pass 2/2 and WEP3 passes 7/7
(`wa-three-state-vb.log`, `wa-three-state-wep3.log`). WordPad's browser
assertions also pass (`wa-three-state-wordpad.log`).

Remaining: BM_SETSTATE and move-time pressed highlighting, tracking versus
visual pressed-state separation, eager activation/direct native input
authority, and live cross-app Worker acceptance.

### Button highlight is independent of mouse tracking

BM_SETSTATE now updates the visual pressed flag without taking capture,
changing a check value, or arming BN_CLICKED. This implements the appearance-only
[Microsoft contract](https://learn.microsoft.com/en-us/windows/win32/controls/bm-setstate).
Mouse tracking has its own private bit9 in the existing ButtonState flags;
it is not exposed by BM_GETSTATE. Captured WM_MOUSEMOVE removes highlighting
outside the client rectangle and restores it on reentry. UP and cancellation
retire both flags, including cancellation after moving outside when the
visual pressed bit is already clear. Autoradio's post-sibling reload also
excludes both retired flags.

The six-style native fixture exercises nonzero BM_SETSTATE, a stray UP that
must not click, drag-out/in with retained capture and one final click,
check-state preservation, and cancellation while unhighlighted followed by
an inert UP. Browser capture routing already forwards child-relative moves
to the owning native control (`renderer-input.js`); no new JS state was added.
This does not resolve keyboard button semantics, activation-before-acceptance,
or live cross-app Worker acceptance.

Main and clean native matrices pass (`/private/tmp/wa-button-tracking-main.log`,
`wa-button-tracking-final.log`). Restoring the old pressed-bit-as-tracking
test fails at the unwanted BN_CLICKED assertion (`wa-button-tracking-negative.log`).
Radio mutual exclusion, renderer multi-app ownership, mouse-drag button mask,
and thread-owned capture/WM_CAPTURECHANGED tests also pass.
Clean full build gates pass (`wa-button-tracking-build.log`), producing
normal/compat 1454644/1455550-byte artifacts with unchanged layout
`c5ccefca8909ee4b`. Rebuilt VB2, WEP3 7/7, and WordPad browser tests pass
and exit successfully (`wa-button-tracking-{vb,wep3,wordpad}.log`). All
logs are under `/private/tmp/`; foreign main-worktree edits were excluded
from the clean build and the commit.

### Keyboard Space uses the button press/release transition

The BUTTON key-down handler used to post BN_CLICKED immediately for both
Space and Enter, without highlighting, capture, automatic check changes,
or release cancellation. Space now shares the native press/release branches:
key-down highlights and tracks, repeats do not notify, and key-up applies
the same automatic check/radio transition and notification policy as mouse
release. Keyboard lParam is not interpreted as mouse coordinates. Focus or
capture loss cancels the pending press; a stray release cannot click.
Enter is left to the dialog manager, not turned into a second control-level
click. Other key-up/SYSKEYUP messages cancel except TAB, as specified by
[Microsoft's button default-processing table](https://learn.microsoft.com/en-us/windows/win32/controls/button-messages#button-default-message-processing).

This reuses the existing tracking flag and notification path rather than
adding a keyboard-only copy. The native fixture covers nine button styles,
three successive Space key-downs, exactly one release click, automatic versus
manual check behavior, repeated release, and focus/key/capture cancellation.
Mixed mouse/keyboard sequences, radio focus-selection notifications, and
complete WM_GETDLGCODE/WM_CHAR behavior still need native fidelity coverage.

Main and clean native matrices pass (`/private/tmp/wa-button-keyboard-main.log`,
`wa-button-keyboard.log`); the final expanded TAB/SYSKEYUP matrix passes
(`wa-button-keyboard-final.log`). The previous handler fails the premature
Enter-click assertion (`wa-button-keyboard-negative.log`). The separate
IsDialogMessage test passes focused-button Enter, Escape, Tab and arrow
routing (`wa-button-keyboard-enter.log`), so removing the control-level
Enter shortcut does not remove the tested dialog activation route.
Clean full build passes (`wa-button-keyboard-build.log`), normal/compat
sizes 1454688/1455594 with unchanged layout `c5ccefca8909ee4b`. Rebuilt
VB2, WEP3 7/7 and WordPad browser checks pass
(`wa-button-keyboard-{vb,wep3,wordpad}.log`, all under `/private/tmp/`).

### Native Win98 button dialog-code reference

WM_GETDLGCODE previously returned zero for all native BUTTON styles. The
response now comes from the current low style nibble, independent of focus
painting: push/pushbox `0x2020`, default push `0x2010`, radio `0x2040`,
groupbox `0x0100`, checkbox/three-state/owner-drawn `0x2000`.

Importantly, native Windows 98 **does not** return DLGC_WANTCHARS for the
checkbox styles, contrary to the current [Microsoft button table](https://learn.microsoft.com/en-us/windows/win32/controls/button-messages#button-default-message-processing).
The initial documentation-based implementation was corrected using native
USER output, not Wine source. Full output is preserved in
[reference-button-input-win98.txt](reference-button-input-win98.txt).

Reproduction:

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/button-apps.json --app button-input \
  --output /private/tmp/wa-button-native.png \
  --metadata /private/tmp/wa-button-native.json \
  --serial-output /private/tmp/wa-button-native.serial
```

The CRT-free probe runs real USER on the pinned v86 Win98 profile, reports
GetVersion `0xc0000a04`, and finishes with BUTTON_INPUT_DONE. v86 version
`0.5.432+gf3d4472`, upstream `f3d4472a9c934b9ad78a311f5849ba711a296d23`;
OS/firmware provenance is in `tools/v86-reference/SOURCES.md`. Probe executable
SHA-256 `a590f51c8e4bde99e02e1444c7815842299b5a42f28a4583a8a7e6a64d85762f`.
No OS assets or compiled executable are committed.

The probe also exposes remaining differences: native creation converts
BS_USERBUTTON (8) to style0, and BM_GETSTATE during Space reports `0x2c`
instead of our documented-bit-only `0x0c`. Synthetic keyboard delivery to
a groupbox also clicks on native Win98. These are recorded gaps, not
silently incorporated assumptions. The measured Space release behavior
for the nine tested interactive styles agrees with the previous change.
Dialog-manager consumption of subclass WM_GETDLGCODE responses remains
separate work; this change implements the native control's response only.

Two native runs produced byte-identical serial output and screenshot SHA-256
`3f5ce89714395d4cbfec8ff8f643998a7b8449414d066f6bb6b227600a66c329`.
The corrected eleven-style emulator matrix passes in the clean tree
(`/private/tmp/wa-button-dlgcode-final.log`); old source fails returning zero
for style0 (`wa-button-dlgcode-negative.log`). IsDialogMessage regressions
pass (`wa-button-dlgcode-enter.log`). Full pre-correction build gates pass
(`wa-button-dlgcode-build.log`); after the native correction, final concat,
paren, normal/compat compilation and data-overlap checks pass, sizes
1454775/1455681, unchanged layout `c5ccefca8909ee4b`.
The corrected matrix also passes on main (`wa-button-dlgcode-main.log`).
The first WordPad browser attempt failed with `Uncaught` at its pre-launch
instrumentation (line211), before guest execution (`wa-button-dlgcode-wordpad.log`).
An unchanged repeat passes all browser assertions
(`wa-button-dlgcode-wordpad-repeat.log`); the initial harness failure is not
counted as a guest regression or silently omitted.

### Native Win98 press-tracking bits

The expanded native probe distinguishes visual highlight from tracking:

| Focused button, initially unchecked | BM_GETSTATE | Capture |
| --- | --- | --- |
| BM_SETSTATE(TRUE) only | `0x0c` | no |
| Space held | `0x2c` | yes |
| Mouse held inside | `0x6c` | yes |
| Mouse held outside | `0x68` | yes |
| Mouse reenters | `0x6c` | yes |
| Capture released externally | `0x08` | no |

These additional `0x20`/`0x40` bits are native Win98 observations, not modern
BST_HOT/DROPDOWN flags. ButtonState now records mouse origin separately from
tracking and visual highlight; BM_GETSTATE translates them to those values.
UP, cancellation and the autoradio sibling reload retire both tracking bits.
No state-record growth or parallel JS state was added. The prior exact
`0x0c` press expectations were wrong for Win98 and have been corrected.

Full native output is in
[reference-button-tracking-win98.txt](reference-button-tracking-win98.txt).
Use the same button-input command above with the expanded probe. Original
dialog-code output remains preserved separately. Runtime provenance is the
same pinned Win98/v86 profile; metadata is
`/private/tmp/wa-button-tracking-native.json`.

**New contradictory evidence, still open:** the sequence ReleaseCapture,
Space DOWN, SetFocus(parent) emits a native BN_CLICKED and changes automatic
check state. Our current focus-cancellation test expects no click. That
test is an emulator regression assertion, not proof of Win98 compatibility.
Isolate that sequence and mixed-input/default-processing behavior before
changing focus transitions. This stage matches the measured state-reporting
bits; it does not claim to close the focus-loss discrepancy.

Two native runs produced byte-identical 5112-byte serial logs. Expanded
probe executable SHA-256:
`fb7d1336b450641734d78125df3703e9d90e1a20bb78a2bea0365ac75c43af1a`.
Main and clean native-control matrices pass
(`/private/tmp/wa-button-native-bits-main.log`, `wa-button-native-bits.log`).
The previous getter fails at mouse-down (`12 != 108`,
`wa-button-native-bits-negative.log`). Clean full build gates pass
(`wa-button-native-bits-build.log`), normal/compat 1454795/1455701 bytes,
unchanged layout `c5ccefca8909ee4b`.
Rebuilt WordPad browser assertions pass (`wa-button-native-bits-wordpad.log`).

### Native focus-loss click rule: highlighted, non-mouse origin

The next probe subclasses each native BUTTON only to trace entry/exit,
then chains to its original procedure. The second Space DOWN leaves clicks
at zero. The click occurs inside WM_KILLFOCUS: BM_SETSTATE(FALSE) clears
highlight, WM_CAPTURECHANGED observes retired tracking, BN_CLICKED runs
while the button still reports focus, then WM_KILLFOCUS clears that bit.
This is native Win98 evidence, not the behavior promised by the current
Microsoft description of focus cancellation.

The expanded matrix isolates four additional cases for all 12 style values:

| State before focus loss | Native result |
| --- | --- |
| Mouse press inside (`0x6c`) | capture released, no click |
| Mouse press outside (`0x68`) | capture released, no click |
| Space tracking, highlight cleared (`0x28`) | capture released, no click |
| BM_SETSTATE(TRUE) only, no capture (`0x0c`) | one click |

The original Space-held case (`0x2c`) also clicks. Therefore capture or
tracking alone is not the selection condition: the measured condition is
highlighted **without mouse origin**. Automatic styles update their check
state before notification; manual styles do not. The 48 isolated outcomes
were programmatically checked against those results. Full trace is preserved
in [reference-button-focus-win98.txt](reference-button-focus-win98.txt).

**Implementation still required:** share the native activation/check-change
operation between release and focus loss, preserving callback ordering,
without synthesizing guest mouse/key messages. Existing Space-focus-cancel
and BM_SETSTATE-focus-loss behavior is not Win98-compatible. Keep the mouse
cancellation behavior; do not simply make all focus loss click. Reentrant
capture/notification callbacks must not resurrect retired state or use a
destroyed ButtonState. Direct synthetic groupbox input and legacy style8
normalization remain separate observed gaps.

Reproduce with the existing button-input manifest and updated C probe.
Metadata and output for this run are `/private/tmp/wa-button-focus-matrix.json`
and `.serial`, using the same pinned native Win98/v86 profile as above.
Compiled probe SHA-256:
`1dfdc420109f147f6de448612e31bebfd1e46ef76be536da3d0c213e8003b54a`.
The first repeat (`wa-button-focus-matrix-repeat.*`) returned exit0 but an
empty serial log; its inspected screenshot shows the restored media player,
not the probe. It is a failed reference launch, not confirmation of results.
The subsequent confirmation (`wa-button-focus-matrix-confirm.*`) completed
and produced byte-identical 27417-byte serial output, including the same
callback ordering and all 48 isolated outcomes. No emulator runtime behavior
was changed in this evidence-gathering stage.

### Implemented: non-mouse focus-loss activation

WM_KILLFOCUS now uses the measured native predicate: highlighted with no
mouse-origin bit. It sends BM_SETSTATE(FALSE), retires press tracking,
releases owned capture, then performs the accepted activation before clearing
the focus flag. Pure BM_SETSTATE highlighting can therefore activate on
focus loss; mouse-origin or unhighlighted presses do not. A late key-up
cannot activate twice.

`button_activate` now owns automatic check/radio changes, repaint, and
parent notification for both release and focus loss. This replaces duplicated
selection semantics rather than synthesizing mouse/key messages. The previous
groupbox notification suppression was removed: ordinary hit-testing still
skips groupboxes, but native Win98 accepts direct synthetic keyboard/focus
activation, as the probe demonstrated. Existing deferred modal/VCL command
delivery is preserved; this does not claim to remove that scheduling exception.

State is revalidated after highlight/capture callbacks and after activation;
the shared helper checks target survival after radio sibling painting and
after repainting. The tests now cover 12 styles x5 focus-loss modes plus
late release. A real synchronous x86 parent reads native state during
BN_CLICKED and observes updated checking, retired tracking, and focus still
set; after the call, focus is clear. Separate x86 callbacks call DestroyWindow
during owner-draw repaint and during BN_CLICKED; both retire the target safely.
Broader reentrant refocus/recapture ordering remains separate work.

The first full build caught a non-normalized logical operand, corrected
before the successful full build. The callback assertion initially included
the private default-border flag; it now excludes that private bit while
checking all other state. Clean callback matrix passes
(`/private/tmp/wa-button-focus-fix-callbacks.log`); old source fails the
missing focus-loss click (`wa-button-focus-fix-negative.log`). Clean full
build passes (`wa-button-focus-fix-build2.log`), normal/compat sizes
1454941/1455847, layout `c5ccefca8909ee4b`. Rebuilt VB2, WEP3 7/7 and WordPad
browser assertions pass (`wa-button-focus-fix-{vb,wep3,wordpad}.log`).

A main-tree run caught a concurrent CreateFileA edit before its `$existed`
local declaration was present (`wa-button-focus-fix-main-final.log`), before
executing tests. The declaration was present on immediate reinspection;
no foreign source was edited to work around it.
The main-tree repeat passes (`wa-button-focus-fix-main-repeat.log`), and the
WordPad browser process exits successfully after its passing assertions.

### Reentrant focus: preserve HWND, retain Win98's focus-bit quirk

The native probe now calls SetFocus from inside BN_CLICKED, choosing either
the same button or a sibling. For all twelve style values, GetFocus after
the outer SetFocus returns still names the callback-selected window.
Self-refocus has an important Win98 quirk: the nested call sets the button's
focus-state bit, but the outer WM_KILLFOCUS clears that bit afterward even
though GetFocus still names the button. A blanket guard skipping all state
cleanup would therefore be incompatible with the observed native behavior.

The emulator bug was the control's direct `focus_hwnd = 0` write after
notification. Removed that write: the shared USER focus transaction owns
focus identity, while the BUTTON still performs its native state cleanup.
The test uses actual SetFocus API calls and synchronous x86 callback thunks,
with siblings under the same parent as the native probe, checking both focus
identity and each button's reported state for 24 cases.

The native refocus sections (baseline matrices omitted) are preserved in
[reference-button-refocus-win98.txt](reference-button-refocus-win98.txt).
Full output/metadata: `/private/tmp/wa-button-refocus-native.serial` and
`.json`. Updated probe executable SHA-256:
`7aa03faafb5faa21fe8488f2b860795cd883e68072850b680f331937982a6141`.
The pinned Win98/v86 runtime provenance is unchanged. Recapture and reentry
during the earlier highlight/capture callbacks remain outside this matrix.

Two native runs produce byte-identical 37597-byte serial output. Main and
clean public-API callback matrices pass (`/private/tmp/wa-button-refocus-main.log`,
`wa-button-refocus-final.log`). Old source fails by clearing the selected
HWND to zero (`wa-button-refocus-negative.log`). Clean full build gates pass
(`wa-button-refocus-build.log`), normal/compat sizes 1454927/1455833,
unchanged layout `c5ccefca8909ee4b`.
The activation/removal-time mouse-activation suite and rebuilt WordPad
browser check also pass (`wa-button-refocus-active.log`,
`wa-button-refocus-wordpad.log`), with both processes exiting successfully.

### Accepted foreground owns keyboard restoration (2026-09-20)

The browser's `_restoreKeyboardInputOwner` now prefers the valid record
published by USER's `activate_window` import over the provisional click owner.
Previously a mouse candidate could replace `_keyboardInputWasm` before its
queued `WM_MOUSEACTIVATE` was answered, and keyboard restoration retained
that candidate merely because one of its windows was still visible. A higher
surface is not proof of activation. Restoration switches exports and memory
together without calling guest focus code or changing z-order.

Record identity, visibility and top-level status are checked; a recycled HWND,
hidden window or child cannot acquire this authority. When there is no valid
accepted foreground, the existing bootstrap/fallback policy is unchanged.
This is a bounded routing fix, **not** completion of activation ownership:
`handleMouseDown` still eagerly raises candidates and changes guest focus,
and direct native/non-client routes still need their own acceptance audit.
Cross-app live Worker activation/deactivation remains unverified here.

Main-tree checks passed: `test-renderer-multi-app-modal.js` (including matching
memory, stale records and no focus callback), `test-host-window-related.js`,
`test-renderer-mouse-drag-mask.js`, `test-renderer-dialog-modal-input.js`,
`test-renderer-dialog-button-queue.js`, `test-keyboard-focus-seed.js`, and
`test-keyboard-message-lparam.js`. Loading the HEAD renderer-input source
against the new regression fails the accepted-foreground ownership assertion.
`test-browser-worker-input-focus.js` fails at its existing Win16 menu-tracker
assertion (line 148, 0 versus 1) with both HEAD and the changed source; it is
not a pass and no unrelated fixture was modified. No WASM source changed and
no full build or real-browser acceptance claim is made for this slice.

### Worker menu regression fixture repaired (2026-09-20)

The failure above was traced to the test double, not a runtime focus failure:
`_hasMenuBar` reads canonical `menu_bar_count`, but the fake Worker exports
omitted it and supplied only `_menuId` on the host record. Thus the test never
entered the menu tracker or reached its later Worker-wake assertions.
The fixture now supplies the canonical count and also tests a menu with the
host mirror absent (guest installation before renderer record creation).
No runtime fallback to the stale mirror was introduced.

`test-browser-worker-input-focus.js` now passes through its final menu-command
wake assertion. Replacing `_wakeMessageWait` with a no-op makes that assertion
fail, confirming restored coverage. `test-renderer-multi-app-modal.js`,
`test-keyboard-focus-seed.js` and `test-worker-input-slice-wake.js` also pass;
the latter executes the compiled guest slice boundary and browser-drive-loop
fixture. These are harness checks, not live cross-app Worker acceptance.

### Queued client clicks no longer preempt USER activation (2026-09-20)

`handleMouseDown` previously raised every candidate, selected its keyboard
instance and transferred guest focus before enqueuing its button-down.
Consequently a correct later `MA_NOACTIVATE` answer could not undo the
already-delivered focus callbacks or restore the previous surface ordering.
Ordinary queued client input now only selects and queues its target. The
compiled USER removal-time transaction and `activate_window` publication
decide activation. Queued child input likewise no longer calls `_setInputFocus`.

The existing synchronous native/non-client preparation is isolated in an
explicit, once-per-candidate helper, used only by those routes. Scrollbar
hit classification happens before preparation and is passed into dispatch,
so focus preparation still precedes scrollbar handling without hit-testing
twice. Direct dialog/combo routes can still prepare before discovering no
child accepts the click; these and non-client acceptance remain unfinished,
not evidence that every mouse path now obeys `WM_MOUSEACTIVATE`.

`test-active-window.js` now connects real renderer queueing to the compiled
USER pump and production desktop activation import for all four `MA_*`
answers. Window geometry and app ownership tokens are synthetic; this does
not launch a second live guest process.
It checks no pre-queue focus callback/z-order/keyboard change, consent-only
publication, veto preservation, and surviving button-up after an eaten down.
This passes on main and the isolated test copy. Loading the old renderer
fails the new pre-activation z-order assertion; the smaller multi-app test
independently fails the old speculative keyboard-owner assignment.

Updated two older renderer fixtures that explicitly required eager focus or
app-context replacement. Their mouse, disabled-window, capture and drag
checks remain; enabled Worker-owned queued input now asserts no speculative
focus publication. Focused main checks pass for multi-app routing, caption
drag, mouse drag mask, native dialog button queue/modal input, Worker input,
keyboard focus seeding, cursor routing, letterbox input, resize and menu
discovery without a mirror. The isolated WordPad browser regression also
passes with terminal exit 0 (including RichEdit text, inline DIB, toolbar
and menus), using the existing consistent WASM artifact; no WAT changed.

Next authority gaps: `host.js` still guesses `_workerFocusHwnd` from a
dequeued mouse-down, rather than the live guest's acceptance/focus decision;
direct native/non-client routing remains separate; live cross-app Worker
activation/deactivation has not been verified by this harness matrix.

### Polling guest supplies live focus to the host (2026-09-20)

`check_input_hwnd` now takes the calling guest's `$focus_hwnd` as an i32
argument. All five WAT call sites pass it: GetMessage, PeekMessage,
MsgWaitForMultipleObjects, console polling and the modal dispatch loop.
The generated Worker import signature carries that argument through the
existing synchronous RPC, without a separate round trip or shared shadow.
Browser routing uses this live value in cooperative and Worker mode;
explicit event HWNDs still win, and existing zero-focus fallback is unchanged.

Removed the browser's `_workerFocusHwnd = evt.hwnd` on mouse-down dequeue.
Dequeue cannot predict `WM_MOUSEACTIVATE` rejection or a subsequent focus
callback's chosen child. Slice-result focus snapshots remain for diagnostics
and existing consumers, but no longer decide this input import's key target.

The browser-host regression executes real `getImports()` closures in both
modes, with idle export access forbidden and a deliberately stale snapshot.
Mouse dequeue leaves that snapshot alone; following keys use two successive
live focus owners without waiting for another slice; explicit mouse and
injected-key targets retain their HWND. The compiled activation/pump test
checks the import argument against the guest global across changing focus
owners. Both main and the isolated test copy pass. Old host code fails on
stale export access; restoring the old zero-argument ABI fails with
`undefined` versus live HWND 65619, not a compiler error.

Main console input, modal timer/input pump and PeekMessage filter suites pass.
Clean full build passes (`/private/tmp/wa-input-live-focus-build.log`),
normal/compat sizes 1454942/1455848, layout `c5ccefca8909ee4b` unchanged.
The rebuilt WordPad browser test passes with terminal exit 0
(`/private/tmp/wa-input-live-focus-wordpad.log`).

The first real Worker browser suite did not launch its guests: external
temporary-corpus symlinks were rejected by the static server with HTTP 403.
The Notepad screenshot identifies `binaries/notepad.exe`; both cooperative
and Worker runs had zero windows. This is not a parity pass. Its terminal
failure log is `/private/tmp/wa-input-live-focus-worker-browser.log`.
Replaced the relevant temporary links with rsynced local corpus copies,
preserving directory links in `/private/tmp/wa-input-live-links.R6Hv28`;
no main-worktree corpus files were changed. The follow-up run is recorded
separately below.

The corrected-corpus rerun passed every check and exited 0:
`/private/tmp/wa-input-live-focus-worker-browser-repeat.log`. Notepad and
Calculator have matching cooperative/Worker windows and titles and no missing
imports. Win16 Rodent's held arrows changed 221 sampled board bytes with
focus `0x10005`; Rodent2000's real-menu new game and arrows changed 893.
Winamp created three real guest threads and executed 14736 slices without
traps; COM server load and missing-server completion also passed. These are
live single-app Worker checks, not proof of cross-app activation/deactivation.
Direct native/non-client mouse acceptance and multi-app Worker coordination
remain open.

### Secondary-app right-button down is no longer dropped (2026-09-21)

The generic client router had an early return for a right-button press when
the target belonged to a non-main instance exposing `send_message`. It saved
the release target but neither sent nor queued the down. Thus ordinary
secondary apps received an orphan `WM_RBUTTONUP`, with no down for USER's
activation transaction. Removed that branch: secondary apps now use the
same queued hit-test/down/up path, without inline guest dispatch.

The multi-app regression supplies a throwing `send_message` export and
checks the complete right-click sequence, MK_RBUTTON and unchanged pre-query
keyboard/focus/z-order. The real renderer → compiled USER → desktop host
matrix now covers both left and right buttons across all four `MA_*`
answers, including the initiating button encoded in the activation query.
Main and isolated-copy matrices plus focused renderer/Worker-host tests pass; the previous router
fails the new complete-sequence assertion. No WAT runtime source changed.

This does not remove `_openWorkerContextMenu`, the separate title-matched
Winamp wVis release workaround. That helper can still consume the release
and synthesize a menu; it needs a real-app regression before replacement.
Nor does this establish live cross-app Worker activation/deactivation.

### wVis helper removal remains blocked by menu state (2026-09-21)

The existing real-browser visualization test passes with the helper. In an
isolated copy, disabling only `_openWorkerContextMenu` delivers the release
and opens the guest popup, but its Rendering Options submenu fails. Moving
the test hover to the guest popup's actual anchor does not fix it: direct
WAT inspection finds the labelled popup and all following rows flagged as
separators. The hit test correctly rejects that row. No runtime workaround
was removed and no coordinate-only test fix was accepted. Binary addresses,
logs, exact flags, limitations and the next diagnostic are recorded in
[winamp-wvis.md](re-notes/winamp-wvis.md).

Follow-up: fixed the flat dynamic-popup serializer, which treated every
MF_POPUP's zero command id as a separator and discarded its child offset.
Tracked popups now share the existing recursive dynamic-menu writer. The
new compiled regression passes and fails with the old serializer. Five
adjacent menu suites and the isolated full build pass; rebuilt wVis with
the helper disabled now passes and visibly opens Rendering Options. The
production helper remains pending command/check-state and modal-lifetime
validation; this does not close the broader input/menu review.

CheckMenuItem now also reaches dynamic and detached LoadMenu trees before
tracking, rather than ignoring them while scanning attached windows. Compiled
tests cover nested commands, exact positions, previous-state returns and
unrelated-menu isolation; old code fails the new test. Rebuilt wVis visibly
shows Slower Fade and Blur checked. A further Clear click/reopen probe leaves
those checks unchanged, so command selection is explicitly unverified despite
the existing visualization/submenu browser assertions passing. The legacy
attached-resource scope, live tracking-snapshot mutation, dynamic GetMenuState
and popup modal lifetime remain open; details are in the binary notes.

The missing Clear selection was traced to browser desktop forwarding: a
cascade outside its app's window rectangle lost its mousedown to an HTML
icon. The DOM bridge now honors the live open-menu context before desktop
hit testing for mouse and touch. Unit tests (with an old-code negative) and
the real wVis rerun confirm delivery; Clear becomes checked on reopening.
Slower Fade remains checked as well, exposing a separate stale detached-menu
state/lifetime issue rather than proving the complete round trip correct.

The stale check was the detached cache surviving tagged DestroyMenu. The
handler now unlinks that cached alias and recursively destroys its MNUD tree;
direct root destruction also unlinks the alias. The 24-check regression
passes and old code fails six checks. The rebuilt browser select/reopen
assertions now pass: Clear becomes checked, Slower Fade clears, Blur remains
checked. A separate wide-item string-release test fails identically with
pre-fix menu code and is recorded, not counted as a pass. Early return from
TrackPopupMenu and non-unique tagged LoadMenu identity remain unresolved.
