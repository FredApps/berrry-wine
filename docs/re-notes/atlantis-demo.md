# Atlantis: The Lost Tales demo (Cryo, 1997)

`lib/apps.js` id **`atlantis_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/ATLANTIS demo SW/ATLANTIS.EXE` (Watcom C,
`imageBase` 0x400000, sections `BEGTEXT`/`DGROUP`/`.bss` 6 MB) plus
`MSS32.DLL`. Manifest: `node tools/gen-win98-games-a-d-manifests.js`
(`HNM\` and `DSETUP\` excluded: a DOS4GW trailer player and the DirectX
installer).

## Route to gameplay

```sh
node test/run.js --app=atlantis_demo --quiet-api --batch-size=50000 --max-batches=1200 \
  --input='850:mousedown:320:313,856:mouseup:320:313,1060:mousemove:3:240,1190:png:/tmp/a.png' --no-close
```

Interplay/Cryo logos, then a map menu whose floating picture panels are the
buttons; they drift into place by about batch 700. The ship panel (centre
bottom, ~320,313 once settled) loads the ship-deck panorama. In a scene the
view turns while the mouse rests at a screen edge. Escape on the menu quits
(`ExitProcess(0)`). Main-thread input is a `GetAsyncKeyState` sweep every
frame (~1,500 calls per batch), so pass `--quiet-api`.

## The blocker that was fixed (4fa1f20b)

The CRT is single-threaded Watcom: `__GetThreadPtr` (`[0x476bf8]`) stays the
static single-thread getter (no `TlsAlloc`), so `__CHK` at `0x42e1d7`
compares `ESP - size` with the **main** thread's stack floor on every thread.
MSS starts a `timeSetEvent` 5 ms timer; its callback `mss32+0xb911b0` runs
on our winmm timer thread, calls `SuspendThread(main)`, and the first
stack-checked call inside it failed: thread stacks used to come from the low
guest heap (~0x00be0000), below `$GUEST_STACK` (0x07400000). It wrote
"Stack Overflow!" (`0x476398`) to handle 0 and called `ExitProcess(1)` on the
timer thread. A thread instance's `ExitProcess` is ignored (both hosts), so
the thread just died with main still suspended: every later batch reported
its full block budget and retired nothing (`--handler-hist` total=0;
`--batch-stats` reads stale values while `run()` is skipped).

Real Win9x reserves thread stacks with `VirtualAlloc` after the main stack,
i.e. above it; `guest_stack_alloc` now does the same.

## Leads

- `0x42cb0a..0x42cb44` is a 555-to-565 pixel conversion loop over a 0x4b000-pixel
  buffer; it is where the main thread sat when it was suspended, not a hang.
- Thread T1 is our winmm timer thread (start thunk 0x7503a80); T2 is MSS's
  own `CreateThread(0xb99bc0)` service loop (`Sleep(50)`).
