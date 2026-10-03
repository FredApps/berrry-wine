# Tetravex drag trails: read-only diagnosis

2026-10-03, corpus_categories. No source edits, build, or runtime. Batch4 remains restore_evidence-owned. The degraded screenshot is preserved unchanged.

## Finding and confidence

**Final scoped result:** ordinary post-repair qualification passed on root-built WASM **939943d487cfe5de640207486b5bf2c0f50c507109a17e27186d9b9183c79597** (1,657,461 bytes). Published immutable bundle: `scratch/runs/20261003-tetravex-gameplay-drag-restored/`. Dashboard reader selects it as Tetravex's latest reviewed passed run, with no bundle warning. Prior degraded/failure evidence is preserved. No FPS measurement.

Root independently reviewed the source and controls reviewer tested331,776 rectangle-oracle cases before the combined canonical build. Qualification attempt1/session82032 stopped before input because newly broad EXE response capture included bodyless desktop HEAD availability probes; this was a harness fault, not a guest fault, and its original artifacts remain. The corrected private helper captures GET JS/WASM and Tetravex EXE only, with method-aware mocks.

Qualification attempt2/session93365 completed normally; browser/server closed **11:41:36.374Z**. I personally reviewed all nine numbered supply tiles, empty destination, and identical board crops one second apart (readiness hash4cdb0247…). One ordinary12-step drag moved the first tile to the first empty destination. Before/first-step/mid/settled images show a restored path and eight intact supply tiles. Root personally viewed `after-settled.png` and independently accepted the clean placement/no-trail result. Final board crops one second apart match **616fc78b6a3d5cdca7a74b79aa9bef71a606794d84253160d9d05774c9d83770**.

The post-repair canonical parent DIB confirms the visual result: **810/810** formerly colored pixels in the first vacated interior strip become the correct c0c0c0 background. The owning Worker now records13 parent BeginPaint calls plus intersecting siblings, instead of only tile paints. It captured1,492 events with zero errors/drops. Actual GET response bodies verify the new WASM, unchanged host-window.js457bfd56 and exact Tetravex EXE3014e1b0. All94 loaded archives were rehashed before publication; metadata was published last. `pixel-review.json`, rawtrace, canonical-DIB PNGs, sources, readiness receipt, commands and cleanup are included.

Acceptance is limited to the repaired custom-child exposure behavior and this normal first-empty-cell placement, not complete puzzle rules or sustained gameplay. Source/test ownership and all runtime/build resources are released; root owns task closure. No extra runtime is required for publication.

**Updated by successful diagnostic attempt3:** runtime evidence below now confirms the custom-child move path and reproduces trails in the canonical parent DIB. The static-only qualification in the following paragraph records the earlier evidence boundary.

The executable has a concrete tile-drag path which moves a custom child window through SetWindowPos. The canonical implementation skips old-parent restoration/invalidation for custom guest children on ordinary movement. This is a strong source-backed candidate for the repeated images, **not yet a runtime-proven cause for HWND 0x10036**. Do not replace that distinction with a screenshot-only diagnosis or claim the tile placement itself is correct.

Evidence run: `scratch/runs/20261003-tetravex-gameplay-trackmouseevent/`.

- `new-game.png`: clean numbered supply and empty destination board.
- `tile-moved.png`: tile image appears at first destination, repeated remnants span the top row after the single 12-step drag.
- `inputs.jsonl`: New Game click (383,285), then drag (556,328)→(345,328), then quit. No retry.
- `browser.log`: final ordinary input is addressed to HWND 0x10036; it records WM_NCHITTEST, LBUTTONDOWN and LBUTTONUP, but not the relevant API calls, mouse-move call stacks, parent/class map, update regions or paint delivery.
- Actual loaded WASM SHA256 `d2c455f7b5f834f3fdb52e42e6d37d34343d5864f5273d1b3dac9d2a1a334bff`.
- Archived executable SHA256 `3014e1b0e7e0f4a0187d023f45f8d9a1797ff1c49b871241a1b0944fe9ca1fef` matches `test/binaries/wep32-community/Tetravex/Tetravex.exe`.

## Executable path established statically

PE section .text is VA 0x401000/file offset 0x400. Delphi method records contain an entry size, function VA, name length and method name; their stored VAs can be checked directly against disassembly.

| Method | VA | Evidence |
|---|---|---|
| ControlMouseDown | 0x469878 | Name record at file 0x68674, preceding function pointer 0x469878 |
| ControlMouseMove | 0x469990 | Name at file 0x6868b, pointer 0x469990 |
| ControlMouseUp | 0x46b31c | Name at file 0x686a2, pointer 0x46b31c |
| TestPanelMouseMove | 0x469eb0 | Separate template-panel route performs the same Left/Top changes |

Tile construction binds these callbacks directly: 0x46a61d writes 0x469878 into object+0xc0; 0x46a630 writes 0x469990 into +0xc8; 0x46a643 writes 0x46b31c into +0xd0. Method data pointers are written alongside them. The controls are sized to 0x3c (60) around 0x46a4ec/0x46a4f8, consistent with the image but not relied on as runtime identity proof.

ControlMouseDown's ordinary branch sets form+0x404, captures the sender and stores cursor position. ControlMouseMove checks that flag, reads cursor position, computes new Left/Top from the sender's +0x40/+0x44 and saved pointer deltas, calls 0x444144 at 0x4699cf and 0x444178 at 0x4699e2, then updates the saved pointer.

Both property setters call virtual slot +0x88. The class reference at 0x463528 points to VMT 0x463574; its class-name pointer identifies **TNumSqPnl**, and slot +0x88 holds **0x44bfe8**. TWinControl's VMT has the same slot target. The bounds method's live-window branch pushes **flags 0x14**, existing size, requested position and HWND from object+0x1b4, then calls **0x4070f8 at 0x44c045**. That thunk is **user32.dll!SetWindowPos**. 0x14 is NOZORDER|NOACTIVATE; NOREDRAW is absent.

COMCTL32 ImageList drag functions are also imported, with VCL wrapper callsites around 0x44e435–0x44e5fc. Their presence is not evidence that this tile path uses them. The identified callback path is window movement; do not start by implementing ImageList drag APIs merely because their names appear in the import table. Actual runtime API-use evidence is still required.

## Canonical implementation path and gap

`src/09a5d-handlers-windowpos.wat`:

1. `$handle_SetWindowPos` enters `$set_window_pos_core`.
2. It obtains mutable WINDOWPOS, commits host geometry, calls `$ctrl_geom_sync`, derives changed flags, recalculates client geometry and sends the changed notification.
3. `$windowpos_finish_paint` queues nonclient work, directly paints only WAT-native controls, and has a separate synthetic-dialog erase case.

`src/09c3-controls.wat:$ctrl_geom_sync` retains the old rectangle and commits the new one. It exits early for NOREDRAW. Its actual old-parent erase/invalidation branch requires **ctrl_table_get_class(hwnd) != 0**. Therefore a custom registered guest control receives geometry but skips that branch. The comment explains why this restriction exists: blindly filling a parent's class brush under custom children previously erased MSPaint output.

`lib/host-window.js:move_window` changes the renderer's rectangle and computes client geometry. It calls `_queueParentExposePaint` when an already-visible child becomes hidden, **not on an ordinary visible-child move**. That helper can restore a parent snapshot and invalidate the visible tree, but its existence does not make it run for movement. `lib/renderer.js:restoreParentUnderChild` is also not proof of valid clean backing for arbitrary moving custom panels; its snapshots can be captured too late or represent stale regions.

Thus the candidate missing behavior is **guest-owned repaint/exposure of a custom child's vacated parent area**, not permission to restore arbitrary pixels with a flat brush or copy a guessed snapshot.

Microsoft's [SetWindowPos contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos) explicitly includes the uncovered parent area in NOREDRAW's suppression and describes preservation of valid contents unless NOCOPYBITS is requested. A repair must preserve these flag distinctions.

Source identity qualification:

- Current `src/09a5d-handlers-windowpos.wat` SHA256 `546921b75e0dc2d7af958dc4733d5e2c313a08c34bec9d8a9fb500cc9a22f71d` and `src/09c3-controls.wat` SHA256 `2b0f3783e2c57a96ef94e42b8873d5f798afe820f10aeeb1147534c396e94e6e` appear verbatim in canonical `build/combined.wat`.
- Combined artifact SHA256 `2024266de51bb1b938a96aabf719f546dab2d3ad39f35509b9f2b789047d8f28`, mtime 10:35:34.643Z; the matching canonical WASM was written 10:35:39.980Z, before the captured route. No subsequent build was run for this diagnosis.
- Current host-window.js SHA256 `457bfd56e4c16e93e749db8a9149bd918dd44647bef2a78ad70a86da3127d835`. **Its actual response body was not among the earlier run's archived JS responses.** This is a missing provenance item for the next capture; do not label it independently response-pinned. The actual loaded renderer.js was archived, SHA256 `f35d3207b2e6ca524c736f3dea96abfe1b3d754f5df9af013b8e8ee544707d03`.

## Next proof step, when a serial diagnostic slot is granted

Run one fresh New Game followed by one short ordinary tile drag, preserving source/module response identities and all previous failure evidence. No internal guest state changes.

- Before the drag, record HWND/class/style/parent/rect mapping for tile and underlying source/destination panels, control class ID, wndproc and GDI presentation owner/DIB. Establish whether HWND 0x10036 is the TNumSqPnl sender; HWND allocation may differ on the fresh run.
- Use existing `window.__waTraceApiNames` (host.js handles Worker trace) for SetCapture, ReleaseCapture, GetCursorPos, SetWindowPos, InvalidateRect, RedrawWindow, BeginPaint, EndPaint, BitBlt, PatBlt, and ImageList drag calls. A narrow call-stack/return receipt at SetWindowPos should establish 0x44c04a and its outer property-setter/ControlMouseMove path rather than infer it.
- Record flags before and after WM_WINDOWPOSCHANGING, old/new child rectangles, parent update/erase state before and after movement, and which HWNDs receive WM_ERASEBKGND/WM_PAINT. The callback may mutate flags; static 0x14 alone does not prove the committed runtime flags.
- Capture the canonical parent DIB as well as composited screenshots after the first step and after button release. This distinguishes missing guest paint, a wrong DC origin/clip, and stale host composition.
- Stop at the first concrete divergent boundary. If parent damage is present and correctly painted, pursue GDI origin/clip or compositing instead of adding more invalidation.

## Conditional minimal repair and regression

If the trace confirms the gap, add targeted parent/overlapping-child **update-region and erase-pending work** for a visible custom child moved or shrunk with redraw allowed. Preserve old parent-client geometry before committing the new one. Let the owning guest thread's normal paint pipeline execute registered procedures; do not invoke guest callbacks on the page, directly brush-fill unknown parent content, or repaint all windows indiscriminately. Reuse region subtraction/intersection where available so the moved child's valid destination and unrelated siblings are not corrupted. Keep NOREDRAW, NOMOVE/NOSIZE no-ops, clipping, hidden ancestors and destroyed-during-changing handling intact.

Build a focused regression using real guest window procedures (not WAT-native Button controls): parent paints a nonuniform checker/pattern, a registered custom child paints a distinguishable numbered/color marker, and another sibling overlaps part of the route. Move the child several small steps with flags 0x14 through normal SetWindowPos, pump real paint messages, and compare the vacated pixels against the parent's pattern and sibling pixels. Assert correct dirty/erase notifications and new child position. The current implementation should fail the old-area pixel/damage check; merely mirroring the helper's code is insufficient.

Negative cases: identical move, hidden parent, NOREDRAW, move+shrink, NOACTIVATE/NOZORDER preservation, parent/child clipping, a retained child DC, destruction during WM_WINDOWPOSCHANGING, and overlapping siblings. Retain existing `test/test-windowpos-changing.js` and `test/test-win16-windowpos-defproc.js` coverage, especially custom-child exposure/erase ownership. Add a browser Worker case only for the cross-instance presentation boundary the in-process regression cannot prove.

No fix or further runtime was performed. Root owns scheduling and task status.

## Private trace preparation and first harness failure

## Successful readiness-gated trace: attempt3

Root granted the serial slot after Icy3 and delegated personal readiness review. PTY session 97816 completed with exit 0; browser/server closed at **11:13:26.868Z**. No canonical source/build changes. Both earlier attempts remain unchanged and are not promoted.

I personally viewed `attempt3/candidate-1.png` and `candidate-1-board-b.png`: all nine supplied tiles had four numbers, destination board was empty. Two board crops one second apart were byte-identical (SHA256 `439c7289a41b97dd214a0e62b2d76b9657781b6f10d0960d7810361cfd6a8a95`). The signed-by-agent receipt is `readiness-review.json`; the harness rechecked the same crop before input. One ordinary 12-step drag then reproduced trails. I viewed `before-drag.png`, `first-step.png`, `after-drag.png` and the extracted raw `after-drag-parent-dib.png`.

The actual moving tile is **HWND 0x10038**, parent **0x10003**, class ID 0 (registered guest custom control), style 0x56000000, 60×60. The parent renderer class is TMainForm. The owning Worker's 13 tile `move_window` entries have stack return **0x44c04a**, argument flags **0x14**, and x positions **192,174,157,139,122,104,86,69,51,34,16,-1,1** at y=1 (starting at x=210). The last movement snaps to the first destination. These are the source-established SetWindowPos calls, not shadow-page API console output.

Every recorded parent damage snapshot has flags 0 and rectangle [0,0,0,0]. All **14 BeginPaint/EndPaint pairs target the moving tile**, none target the parent. After the first tile geometry commit, its update flag becomes 1, then paint/upload clears that flag; the parent remains clean at these observed boundaries. There are 13 accompanying parent SetWindowPos calls from 0x44c7bd with flags0x16 (NOMOVE|NOZORDER|NOACTIVATE); they do not create parent damage. The trace has 1,084 events, zero observer errors and zero drops. `ctrl_paint_trace` is also used for other GDI diagnostics; its 1024-tag records must not be mislabeled proof that this class0 tile is WAT-native.

Canonical parent surface **6356993 / HWND0x10003** is BGRA32, 401×231, stride1604, bitsWa472870912, top-down. Its extracted DIB visibly contains the same repeated triangular remnants as the screenshot, excluding a purely host-compositor stale-image explanation. After the first leftward move, the vacated strip in parent-DIB coordinates [256,43)–[274,103) contains **1,080/1,080 pixels unchanged from the old tile image**. The new tile ends at x256 in that DIB. That strip is outside its new bounds; it is not valid destination content which NOCOPYBITS would govern.

These observations plus the source's explicit class0 exclusion in `$ctrl_geom_sync` support the concrete cause: **the old parent/sibling area exposed by a visible custom-child move is not scheduled for repaint, while the child paints itself at the new origin**. The repair should target that exposure/invalidation path and its correct owner-thread paint delivery, not ImageList APIs or a host-only canvas patch. Existing caveats remain: snapshots observe import boundaries rather than every instruction, and direct internal WM_ERASEBKGND delivery is not exhaustively hooked. No intervention was performed to prove a proposed patch sufficient.

Reproducible offline analysis: `node scratch/tetravex-drag-trace-20261003/analyze.js scratch/tetravex-drag-trace-20261003/attempt3`. Its `analysis.json` includes move sequence, paint counts, parent states, strip comparison, DIB identities, actual response pins and artifact hashes. Raw `trace.json` SHA256 **74c6783df624ed5d5911de47475819ff76647740a7f29a4b037f02dd91b75675**; before image **0c0a8d76a1577d7ae3851c74edfc1f1ca1eadc537d3bc3fc469655f27cca0c95**; after image **e9d7e565b545fae417fb69b7dc5c6d85a2b358b6e799ad5c7bacbc46210b8ddb**. Actual loaded WASM remains d2c455f7 and host-window.js remains457bfd56 (full hashes elsewhere above and in analysis.json). Performance stays null.

The patterned-parent/custom-child/overlapping-sibling regression proposed above is now directly motivated by the reproduced boundary. It must fail current canonical behavior on vacated pixels, preserve NOREDRAW and valid destination content, and pump real registered guest procedures. No blanket parent brush fill: the older MSPaint regression warning remains applicable. Root owns any source-repair grant.

### Earlier preparation and failed attempts

### WAT-only repair prepared for independent review

Root authorized exactly `src/09c3-controls.wat` and `test/test-windowpos-changing.js`, preserving inherited work. Before snapshots/hashes, task-only diff, final hashes and validation receipts are in `scratch/tetravex-drag-repair-20261003/`. No app JS, layout, generated files, canonical build or browser qualification changed during repair preparation.

`$ctrl_expose_custom_child` queues damage for the old custom-child rectangle minus its new bounds, clipped to the parent's client area. UPDATE_RECT is a bounding rectangle; diagonal L-shaped exposure conservatively retains its minimal bounding box. The normal guest paint pipeline propagates this damage only to intersecting visible descendants, preserving included child/sibling content. The helper queues erase/pending paint, never paints with a guessed brush or invokes a callback itself. It requires previously effective visibility and WS_CHILD. NOREDRAW exits before it; unchanged geometry and pure growth create no exposure. Move+hide exposes the whole old rectangle, since the invisible new bounds cannot cover it. The inherited native-control erase branch is unchanged; pure-hide policy remains elsewhere.

The extended existing WINDOWPOS test uses real x86 stdcall guest procedures calling BeginPaint, FillRect and EndPaint. A striped parent, two-color custom child, overlapping green sibling and unrelated sibling verify actual canonical pixels after selection/pumping. The custom guest invalidates itself on WM_WINDOWPOSCHANGED like the traced VCL tile; host code does not paint for it. Tests cover repeated moves, diagonal bounding overlap, parent-before-child order, unrelated sibling exclusion, pure shrink with NOMOVE, growth/no-op, NOREDRAW, hidden ancestor/child, parent clipping and move+hide.

Validation:

- Focused private compile/test PASS (session61008); existing WINDOWPOS callback/flag/DefWindowProc tests still pass.
- Before-source private negative control FAILS as intended on vacated pixels: old magenta16711935 versus expected patterned blue16711680 (session46564). No worktree rollback used.
- Existing `test/test-parent-child-paint-order.js` PASS (56231).
- WAT parens and JS syntax PASS; `region-census.js --gate` PASS,54 raw literals (6 below baseline). WS_CHILD0x40000000 does not collide with a declared region.
- Missing original fixture: `test/binaries/calc.exe`. Runs explicitly set `WINDOWPOS_FIXTURE=test/binaries/wep32-community/Tetravex/Tetravex.exe` to initialize the existing test's interpreter; this is not an app execution.

Review hashes: controls **88c539f1af5c659190b0c97739b41d3bac1ee3773b470465b9abc4dd97675914**, test **96279fa3566d0295c42ab59bba625170686d4b98ca92cd01a58691afd86d7ff5**; private focused WASM **4a94387c52de412629cb6674115087461a3ca2dc6bb8f49d11edff1cdc34427a**. Canonical WASM remains **d2c455f7b5f834f3fdb52e42e6d37d34343d5864f5273d1b3dac9d2a1a334bff**. Await independent review and root's combined-build grant. Actual Tetravex trails are not yet claimed fixed.

Offline corrected harness now uses mandatory PTY commands and a 120-second guard. `capture` stores a full candidate plus two board crops one second apart; `accept` requires a named reviewer explicitly confirming nine numbered tiles and the exact stable candidate hash. `drag` checks that hash twice before ordinary input. No automatic timed drag remains. Worker qualification uses the actual `move_window` stack return 0x44c04a/flags0x14 instead of absent API-name events. Browser helper SHA256 `3b88f7a9c84b5b3e8090ad5cb344f8d4ceee3d1db4d8691f8cb682f621af7e29`; observer `1dbec944bd5414ba61ac919a543ac68e3ac9b284a1cb28ae390cf77523afbbbc`. Syntax and realistic collection/readiness/forwarding mocks pass. Instructions: `scratch/tetravex-drag-trace-20261003/README.md`. Prepared only, awaiting serial grant after Icy3; earlier evidence preserved.

**Latest outcome (attempt2):** root renewed the slot after the collection correction. Session 47910 exited 1 and closed browser/server at 11:02:37.010Z; process inspection found no owned runtime. Actual responses pin d2c455f7 WASM and host-window.js SHA256 `457bfd56e4c16e93e749db8a9149bd918dd44647bef2a78ad70a86da3127d835`. The Worker observer produced 2,468 records, zero errors/drops: 21 move_window pairs, 28 Begin/EndPaint pairs, 344 upload pairs, 812 native-control paint pairs, and one attach pair. `attempt2/trace.json` SHA256 is `2f257929fe374cebd952447a41bfd48faf44cf5943119f76e83e2e26b99d813e`; `analysis.json` extracts boundaries and identities.

This run is **not causal drag evidence**. Personally viewed `before-drag.png` still has two empty boards; `after-drag.png` shows clean numbered supply tiles. The 700ms post-New-Game delay was insufficient under tracing, so ordinary drag input occurred while board initialization was still underway. Worker move events do establish the executable's 0x44c04a SetWindowPos return with flags 0x14 and class VMT word 0x463574, but those moves belong to initialization and cannot be relabeled gameplay dragging. The final assertion also expected decoded API-name events, whereas this Worker exposes the wrapped geometry/paint imports but not the log-name hook as assumed. Page API console stacks are shadow-instance zeros and must not be used as guest call proof. No game failure is inferred from that assertion.

Next authorized diagnostic needs a visible numbered-board readiness condition before input (all nine supplied tiles rendered, followed by a stable pre-drag snapshot), not another arbitrary short delay. Qualify Worker SetWindowPos using the actual move_window stack/arguments and source path rather than absent log-name events. Preserve snapshots/trace even when final qualification fails. No third route was launched automatically; both earlier attempts remain separate. No source/build edit or FPS claim.

Root subsequently authorized a private JS observer and one 60-second diagnostic. Files are under `scratch/tetravex-drag-trace-20261003/`: `browser.js`, `observer.js`, `geometry.js`, and `mock-test.js`. They do not edit or serve modified canonical sources. CDP injects the observer into the page and paused newborn Workers; it wraps imports while preserving their receiver, arguments, return and exceptions. It records the owning instance's API stack, SetWindowPos host geometry boundary, BeginPaint/EndPaint boundaries, per-window update flags/rectangles, surface creation/attachment/upload and bounded raw DIB bytes. Direct internal WM_ERASEBKGND delivery without a host/API boundary is not fully observed; no claim of exhaustive message delivery is warranted. Snapshot reads of shared memory can race guest work and are diagnostic, not atomic frame proofs.

The observer pins canonical WASM `d2c455f7b5f834f3fdb52e42e6d37d34343d5864f5273d1b3dac9d2a1a334bff`; the harness archives loaded JS/WASM responses and compares loaded source hashes to before-launch snapshots, including the previously missing host-window.js. Ordinary route remains New Game (383,285), then one 12-step drag (556,328)→(345,328). It is not a benchmark and has no FPS field other than null. A 60-second internal guard closes browser/server; failures stop the route.

Syntax checks and `node scratch/tetravex-drag-trace-20261003/mock-test.js` pass. The mock checks exact module/instance identity, import forwarding and exceptions, real WebAssembly.Memory preservation, API stack/window/DIB capture, and the actual object-shaped renderer window collection.

Attempt1 runtime session 96088 exited 1. Browser/server closed at 2026-10-03T11:00:45.990Z; process inspection found no owned runtime. The harness failed at startup snapshot because it incorrectly treated `renderer.windows` as a Map. No New Game click or drag occurred, so no game failure or causal evidence is inferred. `attempt1/failure.json`, `cleanup.json`, loaded response bodies and hashes remain unchanged. The private geometry reader now uses the source-established `Object.values(renderer.windows)` and has a regression assertion. No retry was made without a renewed serial grant.

Microsoft's [SWP_NOREDRAW and NOCOPYBITS definitions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos) were rechecked during preparation: uncovered parent area participates in normal redraw; suppression requires application-directed redraw afterwards. [Invalidating the Client Area](https://learn.microsoft.com/en-us/windows/win32/gdi/invalidating-the-client-area) describes invalidation as deferred WM_PAINT work. Therefore the proposed regression must pump real guest painting and verify final patterned parent/sibling pixels, not insist on synchronous paint delivery at SetWindowPos return. The existing conditional repair/regression plan above remains unchanged and unproven until a successful trace identifies the divergent boundary.
