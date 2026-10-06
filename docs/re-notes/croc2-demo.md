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
