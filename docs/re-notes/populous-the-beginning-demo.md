# Populous: The Beginning demo (Bullfrog, 1998)

`lib/apps.js` id **`populous_tb_demo`** (localhost-only), exe
`test/binaries/candidates/populous-the-beginning-demo/extracted/popTBDemo.exe`
(software renderer, DirectDraw 640x480x8, `imageBase` 0x400000) with the bundled
`WEANETR.dll` (Bullfrog's MLDPlay network layer, origBase 0x10000000) and
`QMixer.dll` (QSound mixer, origBase 0x18000000) as app DLLs. `SFMAN32.DLL`
(SoundFont manager) is only reached through LoadLibrary and comes from the VFS.
Source: archive.org item `POPULOUS` (`POPULOUS.EXE`, WinZip SFX, md5
5328fd544622c74cc649114dd9e1fe2c). Fetch/prepare:
`node tools/fetch-candidate-corpus.js --id=populous-the-beginning-demo [--prepare]`.
The SFX holds the InstallShield 5 setup *beside* the uncompressed game tree,
so the game runs from `extracted/` without running setup. `D3DPopTBDemo.exe`
(the hardware renderer) and `DemoHW_SW_Select.exe` (the chooser) are untested.

## Registry

`popTBDemo.exe+0x41f416` reads `HKLM\SOFTWARE\Bullfrog Productions Ltd\Populous:
The Beginning (Demo)`: `InstallDrive` (only the first letter is kept, upper-cased,
at `0x7afecf`) and `InstallDirectory` (a leading `\` or `/` is stripped, at
`0x7afed0`). Missing either -> "Missing or incomplete Registry information".
`startupRegistry` sets `C:` and `\`, i.e. the game tree is `C:\`.

## Route to gameplay

```sh
node test/run.js --app=populous_tb_demo --quiet-api --control=8187 --frozen --tick-ms-per-batch=20 \
  --max-seconds=900 --max-batches=100000000
node tools/ctl.js -s :8187 step 16600            # main menu from ~15000
node tools/ctl.js -s :8187 cmd relmousemove:-2000:-2000
node tools/ctl.js -s :8187 cmd relmousemove:320:142   # game cursor onto NEW GAME
node tools/ctl.js -s :8187 cmd di-mousedown; ... step 300; ... cmd di-mouseup
```

then NO on the tutorial prompt (+0,+241), a click on the "Journey Begins"
briefing, ~60000 batches of level flyby (one OK on "I have created my
reincarnation site"), and the player has control. Evidence:
`scratch/runs/20261006T1210Z-populous_tb_demo-gameplay-w6`.

- **Input is DirectInput only, on two guest threads.** The window procedure
  (`0x4f6430` -> handler `0x49a360`) passes every mouse/keyboard message to
  DefWindowProc. Threads `0x4fb600` (keyboard) and `0x4fb9e0` (mouse) call
  `SetCooperativeLevel(NULL, DISCL_NONEXCLUSIVE|DISCL_BACKGROUND)`,
  `SetEventNotification`, then loop on `WaitForSingleObject(event, 200)` +
  `GetDeviceData(10 records)`. The mouse object is the thread parameter
  (`0x91f754` in this build); the game cursor is at `+0x20/+0x24`, starts at
  (320,240) and is clamped to the screen, so `relmousemove:-2000:-2000` parks
  it at (0,0).
- **Menu buttons need a held press** (`di-mousedown`, step ~300, `di-mouseup`):
  a down/up pair inside one game frame is not seen. In the world a long hold is
  a drag-select, so use a short press there (~25 batches).
- Camera: `keydown:37` (renderer keydown, which also feeds DI) rotates the
  world; a bare `di-keydown` did not.
- Idle at the main menu for ~2000 batches at 20 ms/batch and the game starts
  its ROLLING DEMO (loading screen, then an attract-mode level with no HUD).

## Emulator fixes this game needed (2026-10-06)

- `timeGetSystemTime` (WINMM) was unimplemented.
- **Unicode DirectPlay.** `weanetr.dll`'s `MLDPlay::AreWeLobbied`
  (`weanetr+0x10010800`) creates `CLSID_DirectPlayLobby` as
  `IID_IDirectPlayLobby3` (W, `2DB72490`, not 3A `2DB72491`) and
  `CLSID_DirectPlay` as `IID_IDirectPlay3` (W, `133EFE40`). When that failed
  the provider returned 0 instead of 0x20 ("not lobbied"), and the exe
  (`0x4cd16b`: `cmp eax, 0x20`) opened the multiplayer "CONNECTED" lobby
  screen instead of the main menu. IDirectPlay2/3 (W) now return the
  IDirectPlay4W wrapper; IDirectPlayLobby/2/3 (W) get the `IDirectPlayLobby3W`
  vtable (test: `test/test-directplay-unicode-lobby.js`).
- **DirectInput cooperative level with a NULL HWND.**
  `SetCooperativeLevel(NULL, NONEXCLUSIVE|BACKGROUND)` binds the desktop on real
  DirectInput (and in Wine); we returned E_HANDLE, so both input threads never
  acquired and `GetDeviceData` returned DIERR_NOTACQUIRED forever (no cursor,
  no clicks, no keys). Test: `test/test-directinput-device.js`.

## Known gaps

- A stale game-cursor sprite stays at (0,0) on the menu after the large park move.
- Not yet checked: browser, audio (QMixer/DirectSound), the D3D renderer, a
  full level.
