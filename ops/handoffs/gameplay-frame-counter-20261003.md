# Blobby logical gameplay counter — 2026-10-03

Released by coverage_audit. No emulator source edits or build. All owned browser
sessions terminated; explicit resource releases delivered to restore_evidence.

Published run: `scratch/runs/20261003-blobby-volley-logical-gameplay`.
Task: `GAMEPLAY-blobby-volley`.

## Accepted narrow measurement

Root personally reviewed ordinary W jump / D movement, then all 18 temporal
screenshots in three active-match windows. Player remains stationary during
sampling; the AI and ball move and scores advance. corpus_categories independently
reviewed native guest disassembly, the observer, all raw vectors/transfers and
qualification arithmetic. Accepted metric is **guest logical frame submissions**,
not physical display refreshes. Observer and screenshot overhead are included;
this is not a hardware-GPU baseline. No p95 is inferred.

| Sample | Completed submissions | Wall ms |
|---|---:|---:|
| 1 | 157 | 5120.10000000149 |
| 2 | 155 | 5104.280000001192 |
| 3 | 155 | 5087.684999994934 |

The combined rate is about 30.5 logical gameplay frames/s. `physicalFps` and
`p95FrameMs` remain null. Published performance uses matching metric/counterKind
`guest-logical-frame-submissions` with explicit qualification, reviewer names
and `qualification.json`; root added dashboard normalization and labels.

## Source and live proof

Pinned Blobby EXE SHA-256:
`24dc221063fcb0000656752105fb9d58e56fd55bb37efa3c8dfbb5ddbe355821`.
Actual loaded EXE and WASM response hashes are in `loaded-identities.json`.
WASM is `6cdc021dbf55ccc68cbcdb22d622adef7a13bb42a4cb56e9c4a8f233f1868886`.
Commit/dirty-patch-to-module provenance remains explicitly unknown.

Match call `0x445286` follows the `0x445242` limiter and calls `0x442a5c`,
which synchronously dispatches callback `0x4428a8`. Existing decoder marker at
the return `0x44528b` counts one completed match rendering submission.
Each originating instance independently verifies the loaded marker instruction
bytes at its actual image-base-relative address. Pacing is zero; debug hit
counters are not used, so they do not disable optimized execution tiers.

Callback full branch returns from BitBlt at `0x44293c` with 800x600 dimensions.
Its dirty branch loops ESI from 1 through max of `[EBX+0x97cc40]` and
`[EBX+0x97cd84]`: first-list BitBlt return `0x4429cf`, second `0x442a3c`.
It clears both lists at `0x442a44`. The full branch has one selected transfer;
the dirty branch must contain every exact list index once. Counting raw GDI
uploads would incorrectly count these rectangles as separate frames.

The observer reads the current callback game object from EBX, list sizes and
index from live guest state, API arguments and return address from the live
guest stack, and only records after the real upload returns. Form comes from
`[[imageBase+0x4df48]]`, form canvas from `[form+0x220]` (`0x437db0`), and
current HDC from `[canvas+4]` (`0x4158ac` return sequence). Every selected API
destination must match that live form HDC. The reviewed target is the unique
800x600 canonical presentation for HWND 65538; actual object tokens, surface ID,
geometry and form/canvas identity must persist across the window and each event.

Runtime has two cooperative WASM contexts. Marker ownership is context 1;
callback upload origin is context 0. Every upload captures the full count vector,
so each completed marker interval is associated with exactly its callback's
full or complete dirty-list submission. Each accepted sample covers every
completed interval with no gap, duplicate index, orphan same-target upload,
invalid/empty clipped transfer, failed upload, changed target or changed origin.
Arm/stop read contexts synchronously on the cooperative host. The observer owns
the immutable starting snapshot; callers cannot supply a replacement start.

`qualification.json` hashes raw windows and both review receipts. Each review
receipt lists exact reviewed raw or image hashes. The run also includes original
observer, capture driver, input sequence, full device identity, closure, actual
response identities, declared asset hashes and source hashes. Post-run source
and asset snapshots are labelled as such; they do not invent build provenance.

## Rejected alternatives and diagnostics

Blobby's earlier 264/131 GDI callbacks are coalesced canonical surface flushes.
`gdi_surface_upload` marks dirty; later flush takes the accumulated rectangle,
and screenshot/readback can provoke a flush. Neither raw upload count nor flush
count is a logical frame count.

DX-Ball's 507 callback sample has 288 unslotted callbacks and 219 slot-3 events.
`host.js` reports both originating kind-5 presents and kind-6 Flips, while
`lib/host-imports.js` additionally reports kind-5 with the slot. Slot filtering
alone does not fix semantic counting: sprite BltFast paths can issue many
`dx_present` events per game iteration, and the observed window includes
life-loss fade. The Flip wrapper `0x401650` has six callers, retry/error branches,
and is disabled on its slow-machine path. A DX-Ball counter needs a selected
game-loop callsite plus success/presentation and active-scene qualification;
do not reuse the Blobby marker or relabel Flip events as FPS.

Earlier Blobby attempts are preserved in `scratch/gameplay-blobby-logical-20261003`:
first ended cleanly at stdin EOF; attempt2 established ordinary input and 65
marker groups but lacked final list-size fields and remains diagnostic;
attempt3 stopped at prequalification because the URL matcher omitted version
queries; attempt4 matched actual response bytes and completed accepted samples.
No failed attempt was promoted or overwritten.

## Verification and release

`node --test ops/gameplay-frame-counter.test.js`: 11 tests pass, including
missing group/list indices, oversized counter deltas, orphan uploads, origin
changes, target replacement, nonfinite/scalar coercion, clipping and receipt
requirements. Independent reviewer also tested formerly false-accepting cases.

Observer SHA: `83cda50fcc756844112accee0488eca72f137b64c340a70c95e8e6eeb78f1b99`.
Test SHA: `7d19a90d1778b48d8178a8b844d82b7ca28113ae783bc834abf4589a347d52b2`.

Coverage now uses reviewed category assignments (151 interactive game/package
entries, one noninteractive demo, 89 non-games), explicit `gameplayScreenshots`
allowlists or named historical scene receipts, and independent logical-frame
qualification with raw/review hash checks. Gameplay route text alone never
promotes startup, setup, failure or game-over images. Accepted logical measurement
is separate from permanently unknown physical display FPS.
