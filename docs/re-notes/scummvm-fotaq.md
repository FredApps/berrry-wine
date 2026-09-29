# ScummVM — Flight of the Amazon Queen (floppy)

Binary: `test/binaries/candidates/scummvm-fotaq/scummvm.exe` (SDL 1.2.9 build, DX5 video
driver) + `SDL.dll`, `queen.tbl`, `games/FOTAQ_Floppy/queen.1`. Not registered in
`lib/apps.js` (candidate binaries live only in the main checkout).

```
node test/run.js --exe=test/binaries/candidates/scummvm-fotaq/scummvm.exe \
  --vfs-include='SDL.dll,queen.tbl,games/**' --args='-pC:\games\FOTAQ_Floppy queen' \
  --quiet-api --no-close --batch-size=25000 --max-seconds=580 --input=...
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

With these the intro, cutscenes, autosave, credits and the first gameplay room (hotel room,
Joe, verb panel, inventory) are reached at about batch 8700 with no crash or unimplemented API.

## Open: mouse input starved in the room (headless)

pollEvent runs about twice per 200 batches, so posted WM_MOUSEMOVE never becomes an
SDL MOUSEMOTION that ScummVM reads. The main thread spins in `DX5_CheckInput`: every
`$host_get_ticks` call advances the headless batch clock by 1 ms, so the timer-due checks
inside MsgWait and PeekMessage themselves make the next MM timer (internal msg `0x7FF0`)
or SDL's 100 ms WM_TIMER id 2 due, and the loop always has one more message. Candidate
fixes: a non-stepping tick read for internal due checks, or bounding DX5_CheckInput's
drain per call. Likely headless-only (the browser uses real ticks) — unverified in a browser.

## GOG SDL2 build

The GOG ScummVM (SDL2, the one that actually imports GetMessageExtraInfo) dies earlier on
`InitializeSListHead` (in a DllMain) and then `VerSetConditionMask`. Not addressed.
