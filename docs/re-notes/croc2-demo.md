# Croc 2 (demo) -- PARKED

Fox Interactive / Argonaut, 1999. Fixture:
`test/binaries/win98-games-a-d/Croc2DemoSW-D3D.exe`, an InstallShield
self-extractor around an IS5 Disk1.

## Install (works, headless)

1. `7z x` the SFX; run `Disk1/Setup.exe` with `--vfs-include='*'
   --tick-ms-per-batch=5 --capture-launch=cap` -> `_ins5576._mp`.
2. Run the engine from the capture (`--exe-guest-path`, `--vfs-tree=cap`,
   `--control --frozen`); Next x4, step until "Setup Complete".
3. `--save-vfs-prefix='c:\program files'` -> 20 files, 45 MB, kept at
   `Croc2 demo-SW/installed` (mounts at `C:\Program Files\Fox\Croc 2 Demo`).
   `croc2.exe` statically imports the local `ads.dll` (Argonaut's DirectSound
   layer).

The installer leaves `HKLM\Software\Argonaut Software\Croc2Demo\1.00` empty
(`--reg-export` of the install run). The game then reads `InstallPath` and
`CDPath` from it and, without them, looks for `Wads\` in `C:\` and `D:\`
("Can't find Wad: Couldnt load wad tribe 0, level 0, map 0, type 3").
Seeding both with `C:\Program Files\Fox\Croc 2 Demo\` fixes that.

## What was fixed

- dcf5f901: ads.dll creates CLSID_DirectMusic / IID_IDirectMusic and calls
  SetDirectSound and Activate(FALSE); both were fail-fast (trapped as
  `<ord>`). Now S_OK on the port-less object.

## Where it stops

Boots into its software-rendered attract loop: camera fly-bys of the first
level and a recorded "Demo Mode" run, cycling (3D, textured, correct; the
ground sometimes shows black holes where triangles are missing -- not yet
looked at). The keyboard is DirectInput `GetDeviceState` (256 bytes into
`0x4b6c70`, about one poll per 900 batches); `di-keydown` reaches it (Up ->
DIK 0xC8, Enter -> 0x1C/0x9C), but Up does nothing in the attract loop and
Enter goes black for ~50K batches and back to a fly-by. The game's strings
include "Press Start" and "Press Select For Options", so a title/front end
exists; it may be the black screen (not rendered?), or Start may be a
different key. Next: find the Start binding (`InputDevice Keyboard` registry
value, defaults in croc2.exe) and whether the front end draws.

Registry entry used for the runs (not committed):

```js
      ['croc2_demo', 'Croc 2 Demo', '\u{1F40A}'],
    const croc2DemoRoot = win98GamesADRoot + 'Croc2 demo-SW/installed/';
      // Fox Interactive / Argonaut's 1999 demo, installed by its own
      // InstallShield 5 setup in the emulator under C:\Program Files\Fox.
      croc2_demo: {
        exe: croc2DemoRoot + 'croc2.exe',
        dlls: [croc2DemoRoot + 'ads.dll'],
        files: [],
        localFileManifest: croc2DemoRoot + '.wine-assembly-browser.json',
        workingDirectory: 'c:\\program files\\fox\\croc 2 demo',
        exeGuestPath: 'c:\\program files\\fox\\croc 2 demo\\croc2.exe',
        // The game builds its Wads\ paths on these (it looks in C:\Wads and
        // D:\Wads without them: "Can't find Wad"); the installer leaves the
        // key empty here.
        startupRegistry: ['InstallPath', 'CDPath'].map(valueName => ({
          keyPath: 'HKLM\\Software\\Argonaut Software\\Croc2Demo\\1.00',
          valueName, type: 1, data: 'C:\\Program Files\\Fox\\Croc 2 Demo\\',
        })),
        requiredFiles: true,
        fileConcurrency: 10,
      },
```

Status 2026-10-06: parked (claude:d10ba697); TODOS NEW-GAME-CROC2-DEMO-20261006.

## 2026-10-06 second look (still parked)

- Renderer choice is `D3DDevice` / `DisplayDevice` under the same key: the
  *names* of the chosen devices (saved by `0x413410`, loaded by `0x412dd0`,
  installed by `0x414560(display, d3d, mode, ...)`). Seeding
  `D3DDevice = "Direct3D HAL"` and `DisplayDevice = "Primary Display Driver"`
  (our enumeration names) makes the startup pick a D3D record whose +0x10
  "hardware" byte is 1, yet the game never calls `IDirect3D3_CreateDevice`
  and keeps drawing with its software renderer (only surface Lock/Unlock/Flip
  in a 100-batch API window). The fallback test that rejects our HAL was not
  found.
- With the defaults it reaches Demo Mode by ~20k batches at ~600 batches per
  Flip (~8 presents per wall second): the software path is not prohibitively
  slow.
- At `--tick-ms-per-batch=10` the Demo Mode picture froze from ~120k batches
  on (identical frames over 100k batches) while main kept running compute in
  `0x48xxxx-0x49xxxx` with almost no API calls and T2 looping
  InterlockedExchange + a critical section. Not followed up: the next step is
  to find what main is waiting on there (the T2 handshake is the first
  suspect).

## 2026-10-07: ordinary Start/menu route resolved; control evidence incomplete

Reclaimed the technical investigation using the original installed20-file
closure (46,712,129 bytes), without editing payloads. The executable SHA-256
is `074c0e4333c76635d3f214e6d89ab2f758fe233e6d4b718f7c5a7e0f11b7d24b`.
Actual browser source was user-build `3b8189f5`, WASM
`8eb283c1b595afe336c3e2407f722e19d47aad0739784de4864ba699c8b5712f`;
this does not claim current main's later WAT was rebuilt. Private registration
only supplied the documented InstallPath/CDPath, with a fresh browser profile.
Old frozen Croc runtime registry artifacts were unavailable locally; the older
registration excerpt is not proof that historical runs had no other bindings.

Static source distinguishes controls. Initializer `41a310` defaults keyboard
slot8 to Return/DIK1c and slot9 to P/DIK19. Joystick object-name callback
`411d30` assigns a named Start button to slot9. Mapper `41a948..41a97c` uses
mask table `4a7eb0`: Return becomes `0x1000`, P becomes `0x0008`.
Generic frontend `4401a0` consumes these differently, but the **demo's actual
menu** is `41db30 -> 41cb30`, receiving raw key dwords at `4b52ec`.
`41cca1` tests raw Return at offset70 for1, then returns the selected index;
index0 dispatch `41db67` schedules Jungle mode0xb if transition guard
`4b6934` is zero. Consequently the earlier generic X-confirm inference was
not a valid demo-menu selection contract.

Menu caller `41993f` checks timer `4b6910` using `47aee0` against double40000
at `4a3470` **before** polling/dispatching input. The expired branch schedules
mode5; only the nonexpired branch reaches input update and the edge-triggered
timer reset at `4199c4`. Attempt1 had operator gaps51.16 and66.55seconds
between keys, so its attract/menu alternation cannot establish an engine or
selection defect. P did visibly open the rendered Jungle/Mine/Options/Exit
menu; Down highlighted Mine and Up restored Jungle. Immutable evidence:
`scratch/runs/20261007-croc2-menu-input/result.json` and `hashes.json` (490
artifacts). Optional icon403 and driverexit1 are retained; browser/server
closed, streams0. No gameplay qualification from this run.

Attempt2 replaced those review gaps with one bounded ordinary phase: P1000ms,
capture and real Jungle-menu image match, Return100ms, all within5seconds.
The actual Return release was1.299seconds after phase start. Pure-JS tests
used five saved positive and five negative scenes; black/Demo/Mine each sent
zero Return, capture overhead/exact deadline failed closed, and real helper
keydown/up failures still attempted release. There was no guest state write,
forced callback or engine modification.

This reached a different rope-bridge scene without the Demo Mode overlay.
Ordinary Down750ms changed Croc's orientation/location and camera geometry;
root personally reviewed `attempt2/post-phase.png` and `player-back.png`.
The subsequent Up750ms completed, but **its screenshot was not captured**:
the mandatory2GiB disk floor read2,007,478,272 available bytes and stopped
at09:21:12.896Z. Browser/server closed, streams0, Chromeexit0, driverexit1.
Only1,267,587 capture bytes were written; free space recovered to2,582,630,400
after cleanup, consistent with transient run storage but not an attributed
cause. No reverse/idle evidence, no complete player-control qualification,
no FPS/audio-quality claim. Exact route, inputs, cleanup and pins remain in
`scratch/new-game-croc2-20261007/attempt2`.

Next: retain the now-proven fast normal Start route, account for transient
browser storage before another bounded capture, and obtain reviewed short
movement/reversal/idle evidence. Do not patch the engine based on the older
slow menu interactions or repeat the old Enter-only attract route.
