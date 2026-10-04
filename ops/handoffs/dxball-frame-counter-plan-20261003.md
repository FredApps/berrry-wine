# DX-Ball logical render counter: source plan, not a measurement

Owner: coverage_audit. 2026-10-03. Read-only investigation; no runtime, build,
collector implementation, or source changes. The next collector has a concrete
game-specific candidate, but **DX-Ball FPS remains unqualified**.

## Exact evidence

- Executable: `packages/freeware/dxball/dxball.exe`, SHA-256
  `191c113582e1f31016a158d40372fa21ea68d9348bf847bbfbc8e7c7bdfe195f`,
  preferred image base `0x400000`.
- Rejected raw capture: `scratch/gameplay-dxball-20261003/active-sample1.json`,
  SHA-256 `46800795da0708fbfe02706235a7310954a77fc34735ae97eef5b86d27115d06`.
  It has 507 callbacks in about 3002 ms: 288 without a slot, 219 with slot 3.
  It includes life-loss/fade and lacks the call provenance needed below.
- Historical gameplay run: `scratch/runs/20261003-dxball-gameplay-coordinator`.
  Its module was `6cdc021dbf55ccc68cbcdb22d622adef7a13bb42a4cb56e9c4a8f233f1868886`.
  Current canonical module has since changed to the `3d374324` build, and the
  renderer input path is under separate repair. A future qualification must pin
  its actual loaded module and JS; historical capture acceptance does not transfer.

Reproduce source proof with repository tools (no guest execution):

```sh
node tools/disasm.js packages/freeware/dxball/dxball.exe 0x4044d0 0x404aba
node tools/disasm.js packages/freeware/dxball/dxball.exe 0x401650 0x4016fe
node tools/disasm.js packages/freeware/dxball/dxball.exe 0x40ab10 0x40abcf
node tools/xrefs.js packages/freeware/dxball/dxball.exe 0x401650
```

## Candidate and its proof limits

`0x404659` (RVA `0x4659`) is the return landing immediately after the gameplay
routine calls present wrapper `0x401650` at `0x404654`. The dispatcher reads
`[0x431fd0]` and its table at `0x40abd0` maps state 1 to `0x40ab80`, the call to
`0x4044d0`. The other states call separate routines. Within `0x4044d0`, the
`[0x431c74] == 1` branch skips the main render path; otherwise sprite/object
drawing precedes the wrapper and ball/game updates follow the landing. There is
one such presentation call on this main path, without a render-loop backedge
through that call inside the function.

Critical exceptions: `[0x417a04] != 0` bypasses the wrapper and still reaches
`0x404659`. The wrapper can also return after a failed Flip. Consequently a
bare count of this landing is **not** a completed-frame counter.

Within the wrapper, `[0x4349c8] == 0` selects the Flip path. The primary COM
pointer is `[0x4349ac]`; call `0x4016a3` invokes vtable `+0x2c`, returning to
`0x4016a6`. Only a successful zero return reaches `0x4016c5` (RVA `0x16c5`),
which toggles `[0x42c13c]`. `0x8876021c` retries the Flip; other failures leave
without visiting this block. This success block is not gameplay-specific:
the wrapper also has callers `0x403811`, `0x409801`, `0x40a593`, `0x40af5b`,
and `0x40b25e`. Do not count it globally as gameplay.

Byte pins at original VAs:

```text
404647: e884480000393d047a41007505e8f7cfffff8b0dac1c43006a1451e819950000
401697: a1ac4943006a006a00508b08ff512c8bf085f6741981fec20176887505e8e793000081fe1c02768874d685f675378b0d
40abd0: 79ab400080ab400087ab40008eab400095ab4000
```

The software path (`[0x4349c8] != 0`) calls `0x401700`, merges dirty rectangles,
and performs variable-count Blts before clearing `[0x42c138]`. It needs its own
per-rectangle success/coverage proof and should be excluded from the first
collector. It cannot be treated as one callback per render.

## Smallest defensible next qualification

Use `0x404659` as the logical marker, with independent, originating-context
evidence of its preceding successful gameplay Flip. The existing single-address
logical counter cannot by itself also prove the success block. A collector must
retain the API completion/outcome or separately verified success-block events;
polling memory after a browser slice is insufficient.

1. Pin loaded EXE/module/JS hashes. Resolve every VA using each executing
   instance's actual mapped image base and verify mapped instruction bytes before
   execution/compilation. Arm before the marker block is compiled, pace zero;
   otherwise establish cache invalidation. Freeze context identities and reject
   replacement/new/missing instances during a sample.
2. Attribute the Flip to return `0x4016a6` and the wrapper's caller `0x404659`,
   with state 1 and the non-bypass/non-software guards above. At the original
   three-argument stdcall entry, the outer return is at `ESP+20` (return,
   three arguments, saved ESI, outer return); after API cleanup it is at `ESP+4`.
   Verify mapped stack bounds, actual ABI phase and live values, not a search for
   a coincidental return-address word. Require success before each logical marker;
   retries contribute no frames. Any unmatched marker or selected-target
   submission invalidates the window.
3. Bind actual primary/back surface records, COM pointers, DIB identities,
   dimensions and live presentation owner/generation. Prove a real back/front
   swap and completed canonical submission, not just HRESULT zero. In
   `src/09a8-handlers-directx.wat`, Flip can succeed without a back surface;
   worker and synchronous paths also differ. Qualify the path actually used and
   reject replacement, loss/recovery, changed mode, or unaccounted same-target
   submissions. Intermediate sprite Blts must be source-attributed separately.
4. Keep immutable observer-owned arm/stop boundaries and per-origin event
   vectors. Enclose whole successful render groups; reject partial groups rather
   than trimming their work from the numerator while retaining wall time. Require
   exact coverage for every marker, strict finite times/integers, no counter wrap,
   no orphan selected-target completion, and no mutable caller-supplied proof.
5. Independently review ordinary paddle input, launched moving ball, brick/score
   progression and temporal screenshots throughout each bounded window. Reject
   ready-idle, pause, menu, death/fade, gameover and transitions. Only after first
   qualification passes collect three matched five-second gameplay windows.

The present callbacks cannot supply this proof: `host.js` forwards both
`dx_trace` kinds 5 and 6 to `onGuestFrame`, while `lib/host-imports.js` also
forwards kind 5 with its slot. Thus the public stream duplicates notifications;
slot 3 still includes subframe work. No division/deduplication of the saved
507 events establishes the missing successful gameplay-call relationship.

If all gates pass, label the result `guest-logical-frame-submissions`, describe
observer overhead and actual input route, and keep physical/displayed FPS null.
Average rate can use completed logical submissions over enclosed wall time;
p95 stays null unless source-backed individual frame timestamps are collected.
Remaining work is bounded collector implementation and fresh runtime validation,
not an executable/fixture availability blocker. No current DX-Ball result was
promoted by this source review.

## Independent palette-attribution follow-up (corpus_categories, read-only)

The active palette uploads can be attributed to the same render iteration with **new evidence and a different completion boundary**. They must not be globally whitelisted or counted as additional logical frames. The existing helper and rejected sample are unchanged; no runtime or source edit was performed.

### Exact executable control flow

Pinned EXE SHA256 remains 191c113582e1f31016a158d40372fa21ea68d9348bf847bbfbc8e7c7bdfe195f. Function 0x402af0 rotates a palette range then calls palette vtable+0x18 (SetEntries) at 0x402b8e, return 0x402b91. It has four direct callers: 0x404505, 0x404679, 0x409840, 0x40bbd8.

The active-render caller is 0x404679, **after** the existing Flip-return marker 0x404659. At 0x404659..0x40466c it calls the elapsed-time predicate 0x40db80 with saved timestamp[0x431cac] and threshold20ms. If not due, branch 0x40466c jumps to 0x40468b. Otherwise it passes (224,231,1) to 0x402af0, returns to 0x40467e, updates timestamp at 0x404686, then reaches 0x40468b. The timer predicate at 0x40db80 uses 0x40db20, which obtains milliseconds from performance-counter division or timeGetTime. The observed ~33ms cadence is runtime behavior, not a hardcoded33ms interval.

The pause-only entry branch ([0x431c74]==1) calls the same palette helper at 0x404505 with threshold32ms and returns at 0x40451b **without a Flip or main marker**. Other callers rotate entries200..207. Therefore state1 and return0x402b91 alone do not establish an active rendered iteration.

At the SetEntries host-call phase, the exact 32-bit stack is:

- ESP+0: API return0x402b91.
- +4: palette COM pointer from[base+0x349b8].
- +8: flags0; +12: start224; +16: count8.
- +20: entry buffer base+0x2c4c8 ([base+0x2c148]+224*4).
- +24/+28/+32: saved EBX/ESI/EDI from0x402af0.
- +36: **outer return0x40467e** for active-render palette cycling; +40/+44/+48 are helper arguments224/231/1.

The old raw sample recorded only the first six words. Its palette event does match224/count8/buffer0x42c4c8 but cannot prove outer return or helper arguments. It also lacks palette trace4 and contains fade transitions; it remains rejected.

### Why one palette operation produces another presentation

`handle_IDirectDrawPalette_SetEntries` at `src/09a8-handlers-directx.wat:6497` copies the requested entries to the palette record, emits dx_trace4(slot,start,count,paletteWa), and when that palette is the primary palette calls dx_present. That produces trace5 then canonical upload without swapping front/back DIBs. The all-black-copy exception applies only to start0/count256, so this224/count8 path cannot take it. The handler returns success unconditionally after that sequence. Existing export `get_dx_primary_pal_wa` provides an originating-instance primary-palette identity read; bind it to palette COM record/type/lifetime and trace4/trace5, not merely to an argument address.

### Candidate stricter model for a future qualification

Use a **new logical completion marker at0x40468b (RVA0x468b)**, after the optional palette call. This is a real basic-block entry (0x40466c short branch target). Keep Flip's outer return identity separately at0x404659; do not reuse one constant for both marker and wrapper return. Pin the relocated marker operand [0x40468c]=base+0x31c3c and the branch/call bytes around0x40466a..0x40468b. The inspected routine has no loop back through this render/optional-palette block; later object loops start after0x40469d.

For each originating-context marker interval, require exactly one successful bound primary/back Flip+present+upload chain, followed by **zero or one** fully qualified active palette chain (trace4+present+successful full canonical upload), then the new marker. Palette completion does not increment frame count. Both chains must use the same post-swap front DIB, stable primary/back records, primary palette identity, HWND/surface generation, and one originating instance. Require the exact SetEntries and outer-call ABI above, state1/pause!=1, non-bypass/non-software rendering, and complete mapped stack bounds. Palette updates from the pause caller, other palette ranges/callers, fades, a different palette/target, a missing chain, or any other primary presentation invalidate the window. Reject partial Flip/palette groups at either immutable boundary. A window ending between successful Flip and optional palette completion must not count an unfinished group.

This remains an implementation/qualification proposal. Moving the marker makes the optional palette operation part of the completed logical render group, avoiding the old marker's off-by-one epoch relationship. It does not establish physical displayed FPS, which remains null. A fresh continuously active gameplay capture with ordinary paddle control, all source/loaded identities, and independent raw/scene review is still required. No rate from the old attempt is salvaged.

## CORRECTION: palette helper caller slots are reused as byte scratch

Independent attempt2/source review on 2026-10-03 found my earlier statement that SetEntries stack+40/+44/+48 preserve helper arguments224/231/1 is wrong at the API capture phase. Preserve the earlier section as investigation history; use this correction for a future contract. No old capture is accepted by this correction.

Let S be ESP at entry0x402af0. The helper reads its original direction argument before pushing EDI/ESI/EBX. After these three pushes ESP=S-12. At0x402b27, byte store[ESP+0x18]=AL writes the original range-start GREEN byte into S+12, reusing the direction argument slot. At0x402b2b, byte store[ESP+0x10]=DL writes the original BLUE byte into S+4, reusing the start argument slot. It subsequently writes these same saved bytes to final palette entry231 at0x402b64 and0x402b6f.

After five SetEntries arguments and CALL, API ESP=S-36. Therefore API stack indices10/11/12 contain **final entry231 blue / 231 / final entry231 green**, not the original values. The upper24bits remain zero from the caller's original small constants. A future contract3 can require index10==paletteSourceHex byte30, index11==231, index12==paletteSourceHex byte29 (RGB-flag layout, eighth four-byte entry). Continue requiring source/destination bytes equal and stable across trace4→present→upload, exact outerreturn0x40467e, range224/count8 and sourcebufferbase+0x2c4c8. Pin the scratch-store instruction bytes in per-origin mapped proof as well.

Attempt2 contains16 palette chains; independent examination finds this relationship in all16. Its contract2 expected obsolete original arguments, so its rejection is preserved. It is not retroactively promoted or used as a measurement. This is a correction to evidence interpretation justified by pinned executable instructions, not removal of caller/range/source-copy checks.
