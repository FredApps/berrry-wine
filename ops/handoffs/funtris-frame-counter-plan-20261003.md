# Funtris: measure gameplay updates and response, not unqualified FPS

2026-10-03, coverage_audit. Source-only investigation; no guest runtime, builds,
source changes or measurement. Batch3 retained the serial runtime slot.

**Decision:** this executable has a useful completed gravity-message boundary,
but no demonstrated one-to-one complete-frame boundary. Its timer-driven and
input-driven GDI drawing should be reported as separate gameplay update/response
metrics until a stronger scene-completion model is proven. GDI flushes, tile
BitBlts, WM_PAINT calls and timer deliveries are not interchangeable frames.

## Pinned inputs and existing evidence

- `binaries/wep32-community/Funpack/Funtris.exe`, SHA-256
  `893aad1455886d2c4745c72ee698ffd65642c1a9280c933d895a19742b4b31dc`,
  preferred image base400000.
- Registry companion `binaries/wep32-community/Funpack/FunPack.dll`, SHA-256
  `a58c6f976e33d13af9f9441c7dc9d68cfdaaa6ea6a5144eaee362c218e84ce80`.
- Reviewed run `scratch/runs/20261003-funtris-gameplay-restored2`: F2 starts a
  falling piece; Left/Down places the red piece bottom-left, score0→17 and a
  new yellow piece appears. `board.png`/`drop.png` are reviewed scene evidence;
  `performance` is null. Its provenance explicitly says module3d374324 was
  hashed at launch, not from the response body. No counter-event raw data exists
  in that published run, and no new performance claim follows from screenshots.
- `docs/re-notes/funtris.md` describes an earlier idle test and points to
  `/private/tmp/wa-idle-puzzles-start304/funtris.json`. That exact historical
  path is absent on this box. It is not needed for the static plan below.

## Executable proof

The import list includes GDI32 BitBlt, compatible DC/bitmap operations, region
painting and text drawing; USER32 GetDC/ReleaseDC, BeginPaint/EndPaint,
InvalidateRect and UpdateWindow. There is no explicit DirectDraw/OpenGL present
import in this executable. This alone is not the conclusion; the relevant
control flow is:

1. Helper entry403ee0 loads Sleep from IAT41c13c and WaitForSingleObject from
   IAT41c194. It sleeps using EBP at403f37/403f38; EBP is loaded from a game
   structure and can decrease toward8 at403f82..403fad. There are separate500ms
   and650ms sleep paths. It checks gating flags4230f8 and424578, then posts
   message401 at403ff5. Failed PostMessage is retried after100ms. Therefore a
   helper-loop or post count is scheduled work, not proof of drawing completion.
2. The MFC message-map record at41c558 is
   `401,0,0,0,a,407c80`. Its next record maps WM_PAINT(0f) to401b90; a later
   record maps WM_KEYDOWN(100) to404090.
3. Message401 handler407c80 obtains a client DC through416014, passes action8
   to404160 at407cb1, optionally calls403bc0 when its incoming parameter is
   nonzero, releases the DC through416086, and returns after407cdb. Disassembly
   of416014/416086 confirms GetDC(IAT41c2b8)/ReleaseDC(IAT41c2bc).
   **407cdb is a candidate completed gravity-handler marker, not FPS.**
4. Dispatcher404160 is also called from six keyboard paths around4040c0..404124
   and new-game/menu paths. It has state-gated early exits and multiple action
   branches. Some draw immediately, others invalidate rectangles (including
   404791); its common exit404987 therefore includes no-op/transition work and
   does not certify that a subsequent WM_PAINT has run.
5. WM_PAINT handler401b90 constructs a paint DC through4160c8/BeginPaint. It
   loops board cells and checks intersection with the update rectangle before
   drawing each tile. Drawing helper403ac0 has130 direct callsites across paint
   and piece-shape routines. Its BitBlt calls at403b5c/403bb2 copy cell-sized
   rectangles and include a conditional early-out at403afc. A third BitBlt
   site403e9a belongs to a separate compatible-DC helper. None is a single
   unconditional whole-board submission per timer/input transaction.

Representative byte pins (original VAs; relocate operands when checking memory):

```text
407ca5: 6a088bcec744242400000000e8aac4ffff8b44242885c0740c8d4424048bce50e8f6beffff8d4c2404c7442420ffffffff
403fdf: 8b7c24108b461081e7ff0000006a0057680104000050ff15e4c34100
404987: 8b8c24980000005e5d64890d0000000081c49c000000c20400
```

Reproduce with existing tools:

```sh
node tools/pe-imports.js binaries/wep32-community/Funpack/Funtris.exe --all
node tools/disasm.js binaries/wep32-community/Funpack/Funtris.exe 0x403ee0 0x404034
node tools/disasm_fn.js binaries/wep32-community/Funpack/Funtris.exe 0x407c80,0x404090,0x401b90 100
node tools/xrefs.js binaries/wep32-community/Funpack/Funtris.exe 0x404160
node tools/xrefs.js binaries/wep32-community/Funpack/Funtris.exe 0x403ac0
```

## Existing callback semantics

`lib/host-imports.js` `_flushGdiSurfacePresentation` consumes a dirty rectangle,
copies canonical pixels into a canvas and calls `_noteGuestFrame({kind:'gdi',
dirty})` for a non-DirectDraw presentation. `gdi_surface_upload` merely marks
dirty pixels; several writes can be combined into a later canvas flush. A single
game action can change several tiles and text fields, while an exposure repaint
can redraw unchanged state. The renderer's flush scheduling and dirty-region
combination are not the game's transaction boundaries. Count and label these as
surface flushes only; they cannot supply Funtris gameplay FPS.

## Concrete next measurement, when runtime is available

Start with **gravity updates/s**, separately from **input-to-canonical-update
latency**. Do not populate the dashboard's existing logical-frame FPS field with
either metric without adding a distinct honest schema/label.

- Pin actual loaded EXE/module/JS, mapped image bytes, originating worker/main
  context, live game HWND/DC/surface generation and the view object. Instrument
  message401 entry407c80 and successful exit407cdb with an immutable per-message
  sequence. Prove the message came from the helper and is routed to this game;
  count exits once, excluding reentrancy/exception/termination and inactive states.
  Establish the meanings of4230f8/424578 and the speed/level fields before using
  them as gameplay gates. Record intended helper delay and actual queue delay.
- In a fixed active-gameplay window, collect completed gravity handlers and
  independently record changed board/piece state plus all bound-target dirty
  uploads. Report no-op deliveries separately. The posted message may lag its
  sleep deadline; neither a post nor an exit guarantees a displayed image.
- For ordinary Left/Right/Down actions, correlate host input enqueue, guest key
  handler entry, successful game-state transition and the final relevant canonical
  update. Include any deferred WM_PAINT and score/next-piece changes instead of
  stopping at the first changed tile. Until that completion dependency is proven,
  report only time to first observed canonical change, explicitly labeled so.
- Keep a reviewed temporal scene sequence and exact message/event traces. Avoid
  calling intentional slow gravity at an easy level poor rendering performance;
  separately report game speed, input cadence and dropped/queued work. Physical
  display latency remains unknown without compositor/display evidence.

The remaining blocker for **complete logical frames/s** is semantic: one update
can draw several cells synchronously and leave later invalidated paint work,
while unrelated repaint can occur without a game update. A future transaction
collector would need exact dependencies and completion coverage for each action,
including deferred paint, before choosing a consistent whole-scene boundary.
This is not a missing-fixture or generic GDI impossibility claim. Existing
gameplay screenshots remain valid and FPS stays unknown.
