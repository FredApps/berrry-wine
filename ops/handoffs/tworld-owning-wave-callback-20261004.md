# Tile World owning waveOut callback repair — private candidate

Tile World remains gameplay-unqualified. Its filename/ruleset picker stays visible after ordinary intro-ms selection. Passive attempt2 found two completed DONE|PREPARED headers queued for CALLBACK_FUNCTION, an advancing AudioContext, main waiting to join the audio worker, and that worker waiting on the semaphore its legitimate WOM_DONE callback releases. Raw run: scratch/runs/20261004-tworld-callback-census. Root's visual correction and prior metadata are preserved in scratch/new-game-tworld-20261004/repair/scene-correction.json.

The isolated candidate lives in scratch/new-game-tworld-20261004/repair/after, with exact inherited before snapshots and a 12-file diff in integrated-draft.patch. integrated-readiness.json is the current source authority. No production file or canonical module has been changed.

The WAT entry preserves caller TLS and the interrupted wait tuple. Worker registration binds the actual opener and a generation; offers retain a token across ambiguous transport, refuse nested loader execution, and never execute on the page shadow. The completion queue retains registration/header submission identity, reset-returned buffers, and non-function notifications. Owner-aware scheduling admits callbacks before resolving parked waits and restores saved scheduler deadline bookkeeping after callback return. Closing an ambiguous offer uses a cancellation query that can acknowledge prior acceptance but cannot start a fresh callback.

Private evidence:

- repair/validation.json: real WAT candidate passed, unchanged WAT control failed on parked admission. Initial even-yield predicate defect caught and corrected.
- repair/transport-validation/receipt.json: actual Worker callback released a real semaphore once despite dropped acceptance reply; original wait/TLS restored; generation, expiry, close/stop checked. Before Worker control failed to publish registration.
- repair/integrated-validation/receipt.json: real host completion queue -> owning callback -> real semaphore audio Worker -> natural Worker exit -> normal main join resolution passed. Before-queue control retained the stalled main. Reset/reuse/busy/order/WINDOW/EVENT/NULL/process retirement and ambiguous-close tests passed. Test-only wait-code expectations were corrected and failures preserved.

All test processes/Workers closed; no browser was started. Canonical module remained f40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063.

One post-test source correction remains explicitly separate from the passing freeze: suspended active owners return busy rather than retired, retaining their notifications. test-wave-owner-lifetime.js checks this using the actual host method plus in-flight/consumed wait, exited/recycled owner and replaced registration cases. Syntax passed; it has not run after the resource release. Root must review this delta and the integrated source before production integration. Full browser step-loop/ordinary Tile World qualification, relevant existing compatibility tests, and canonical build are still pending. This is not a gameplay, release, performance or audible-quality claim.

## Final source-only lifecycle review (2026-10-04, during Heroes matrix)

The passed integrated snapshot remains immutable at `repair/integrated-validation/receipt.json`. The new frozen draft is `repair/source-review-final/readiness.json` and `patch.diff` (SHA256 `606fd2b008a69956693837a047c45dd8a0a65862c578b15ca45b4c66ba66c3f7`). Production files and canonical module were not changed.

Two post-test corrections remain unexecuted: suspended main/auxiliary owners retain notifications as busy; an ambiguous main callback offer prevents the actual scheduler from handling the cached interrupted yield. Without the latter, an old yield-1 result could complete a now-signaled wait over an already admitted callback's stack. `test-wave-pending-step.js` exercises the actual host scheduler with transport substitutes, including its immutable before-fix control, and checks normal wait completion remains intact. These new tests have syntax checks only; no test/build/browser ran during the matrix.

Remaining review detail: cross-owner close retires the host stream and queue, preventing new offers, but does not currently remove the original opener Worker's registration metadata until its own close/stop. This metadata cleanup needs a bounded lifetime decision; do not infer that host retirement permits injection. CLI real-thread completion scheduling is not qualified by the browser transport tests. Existing standalone callback fixtures also need review for valid loaded guest ownership and the explicit six-argument registration API.

Next gates: run the focused suspension and actual step-loop before/after regressions; rerun the real integrated Worker/WAT dependency test on this final snapshot; check existing waveOut/MM callback compatibility; independent root review; separately granted build and ordinary browser qualification. `source-review-final/ordinary-route.json` specifies a visually gated intro-ms picker-to-board route and actual directional response evidence. The retained picker remains the last observed Tile World result, not gameplay.
