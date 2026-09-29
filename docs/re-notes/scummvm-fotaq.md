# ScummVM — Flight of the Amazon Queen (floppy)

Binary: `test/binaries/candidates/scummvm-fotaq/scummvm.exe` (SDL 1.2.9 build, DX5 video
driver) + `SDL.dll`, `queen.tbl`, `games/FOTAQ_Floppy/queen.1`. Registered in
`lib/apps.js` as the local candidate `scummvm_fotaq` (same files and command line as below;
the candidate binaries live only in the main checkout, so a fresh worktree needs them
copied or symlinked into `test/binaries/candidates/scummvm-fotaq/`).

```
node test/run.js --app=scummvm_fotaq \
  --quiet-api --no-close --batch-size=25000 --max-seconds=580 --input=...
# equivalent, without the registry:
node test/run.js --exe=test/binaries/candidates/scummvm-fotaq/scummvm.exe \
  --vfs-include='SDL.dll,queen.tbl,games/**' --args='-pC:\games\FOTAQ_Floppy queen' ...
```

## Module layout

- `SDL.dll` loads at `0x96d000` (origBase `0x10000000`) — use `sdl+0x1000xxxx` in `--count`.
- ScummVM `pollEvent` entry `0x40166e`; its event switch is at `0x4016b9` through the jump
  table at `0x733058` (type 4 MOUSEMOTION -> `0x4018f1`, 5 -> `0x401938`, 6 -> `0x40199b`).
- `SDL_PrivateMouseMotion` = `sdl+0x1001c530`. Windowed mode takes mouse input from
  WM_MOUSEMOVE only; the DirectInput mouse is ignored.
- SDL emulates TrackMouseEvent (GetProcAddress returns 0) with
  `SetTimer(hwnd, 2, 100, sdl+0x100248c0)`.
- `DX5_CheckInput` loops while `MsgWaitForMultipleObjects(2 DI events, 0, QS_ALLEVENTS)`
  reports a message (branch at `sdl+0x1001525d`), and returns 1 each time.

## Fixed (2026-09-29)

- `GetMessageExtraInfo` / `SetMessageExtraInfo` (the crash that started this).
- `clearerr`, `strncat` (a body existed with no api_table row), `fputc`.
- waveOut CALLBACK_FUNCTION completion read a stale literal address instead of the
  region-placed `$WAVE_OUT_SHARED`, so SDL's audio thread never got WOM_DONE and speech
  froze dialogue. Now `region.addr` in WAT and `_regionMap.BASE.WAVE_OUT_SHARED` in JS.
  (Main fixed the same stale literal independently for Civ2's MM_WOM_DONE while this was
  in flight; the port kept main's code and added `test/test-waveout-callback-function-wasm.js`,
  which drives the WAT `fire_wave_out_callback` path end to end.)
- API ids on main: GetMessageExtraInfo 3751, SetMessageExtraInfo 3752, clearerr 3753,
  strncat 3754, fputc 3755 (rows live in `tools/gen_api_table.js`'s extra list).

With these the intro, cutscenes, autosave, credits and the first gameplay room (hotel room,
Joe, verb panel, inventory) are reached at about batch 8700 with no crash or unimplemented API.

## Fixed: mouse input starved in the room (headless)

pollEvent ran about twice per 200 batches (once in 11,100 batches from boot), so posted
WM_MOUSEMOVE never became an SDL MOUSEMOTION that ScummVM reads. The earlier theory —
that `$host_get_ticks` stepping the headless clock kept a timer always due — was **refuted**.
The real cause was `MsgWaitForMultipleObjects` answering "message waiting" forever: both
its handler and the `$win32_dispatch` fast path tested `$nc_flags_count`, which stays
nonzero while any window holds an erase bit (2) or the persistent default-erase bit (8),
neither of which `PeekMessage` ever returns. SDL 1.2's `DX5_CheckInput` (sdl+0x10015090)
keeps pumping while MsgWait says yes, so `DX5_PumpEvents` never returned. Fixed in
1279f024 (`$msgwait_queue_ready`, counting only NC paint/calcsize bits via
`nc_flags_scan(5)`, the same test `$has_pending_message` uses; covered by
`test/test-nc-flags-message-wake.js`). After it: 1,836 pollEvents in 3,000 batches, the
intro and credits play, the hotel room is up by batch 8,000, hovering the chest shows
"look at chest", and mousedown, gap, mouseup walks Joe to it.

## GOG SDL2 build

The GOG ScummVM (SDL2, the one that actually imports GetMessageExtraInfo) dies earlier on
`InitializeSListHead` (in a DllMain) and then `VerSetConditionMask`. Not addressed.
