# Dark Reign demo (Activision, 1997)

`lib/apps.js` id **`dark_reign_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/Dark Reign-SWonlyProbablyMaybeD3D/DATA/DKReign.exe`
(MSVC, `imageBase` 0x400000) with ANET2/MSS32/SMACKW32/WINET2 from the same
directory. The InstallShield 3 setup ships the game tree uncompressed in
`DATA\`, which runs as is. Manifest: `node tools/gen-win98-games-a-d-manifests.js`.
The registry entry sets **`nullPageFaults: true`** (see below).

## Route to gameplay

```sh
node test/run.js --app=dark_reign_demo --quiet-api --batch-size=50000 --max-batches=3710 \
  --input='1480:mousemove:320:252,1490:mousemove:320:180,1500:mousemove:320:100,1510:mousedown:320:100,1514:mouseup:320:100,1800:mousemove:320:150,1810:mousemove:320:200,1830:mousedown:320:200,1834:mouseup:320:200,2700:keydown:27,2703:keyup:27' --no-close --png=/tmp/dr.png
```

Main menu at ~1300 batches; Single Player (320,100) -> Training 2 (320,200);
the mission loads in ~500 batches; Escape closes the briefing.

**The mouse is DirectInput buffered (`GetDeviceData`) and the game draws its
own cursor, which moves by relative deltas.** `renderer-input.js` derives a
delta from the previous host pointer position, so the first `mousemove` only
sets the reference: start every route with a move to the game cursor's
start (320,252), then aim clicks by the *difference* between where the game
cursor is drawn and where it should go (read it off a capture). The
keyboard is DirectInput `GetDeviceState`. Left click selects and orders.

## What was fixed to get here

- msvcrt imports: `_mkdir`, `setvbuf`, `getc`/`fgetc`, `__p___mb_cur_max`,
  `__p__pctype` (834ee8ba), `_makepath` (c8b9005e).
- **`_stat` zeroed 64 bytes of a 36-byte `struct _stat`** (c8b9005e). The game
  keeps one at `[ebp-0x38]` in `0x46a420` (the resource loader), so the extra
  bytes zeroed the saved EBP and return address, and the function returned to
  NULL after reading `.\dark\local\gamemsgs.txt`. Symptom: `[eip-zero]` right
  after a `strncpy` at `0x46a616`. Arming `--watch` hid it only because a
  watchpoint ends the batch at every change and shifts the whole route.
- **NULL guard page** (6f9aa1b4). `0x425166` walks the EBP chain to record a
  call stack (debug allocator), stopping at a return address >= 0x80000000 or
  when reading the outermost frame (`[0+4]`) faults into its `__except`. On our
  NULL sentinel it read zeros forever, on the mission-load bar at ~45%.
  `nullPageFaults` raises for guest accesses below 0x1000 only (Win98's rule);
  `--fault-null=raise` is not a substitute, as it also raises for MSS's
  `0xac44` probe, which Win98 answers.

## Leads

- T1 is MSS's DirectSound service thread (`CreateThread(0x97c2b0)`), which
  `SuspendThread`s main around its mixing pass.
- Multiplayer (ANET2/WINET2) is untried.
