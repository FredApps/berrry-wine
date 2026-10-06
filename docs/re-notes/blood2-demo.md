# Blood II: The Chosen (demo)

Monolith's 1998 LithTech demo in `test/binaries/win98-games-a-d/Blood2-demoD3D/`.
The CD layout has an InstallShield 5 setup (`SETUP.EXE`, `_INST32I.EX_`) beside
`Game\`, which is already the unpacked install: `B2Demo.exe` (MFC launcher),
`Client.exe` (the engine), `B2Demo.rez` (the resource archive), renderers
`d3d.ren`/`soft.ren`, sound `softsnd.dll`, and Microsoft Interactive Music 2.5
(`IMA.DLL`, `IMUSIC25.DLL`, `IMRT25.DLL` + 16/32 variants, `MSynth25.dll`,
`AM18.dll` = Microsoft AudioMan 1.80) with `Music\` styles and sections.

Registry id `blood2_demo` (localhost-only), manifest from
`tools/gen-win98-games-a-d-manifests.js` (root `Game`, 97 companion files).
The registry runs `Client.exe` directly with the command line the launcher
builds (strings in `B2Demo.exe`): `-rez B2Demo.rez -windowtitle "Blood2 Demo"
-config defaults.cfg`. Without `-rez`, Client.exe stops at boot with the
LithTech message box "No game resources specified."

`autoexec.cfg` selects `"RenderDLL" "d3d.ren"` (Direct3D through DDRAW, 640x480).
Client.exe imports WINMM, DPLAYX, DINPUT, KERNEL32, USER32, GDI32, ole32,
WSOCK32 and LoadLibrary's the rest, in this order: `de_msg.dll`, `cshell.dll`,
`cres.dll`, `softsnd.dll`, `d3d.ren`, `ima.dll` (+ its imports), `imrt25.dll`,
then at level load `object.lto` and `sres.dll`.

## Route (headless, `--batch-size=20000`, ~200 batches/s in-level)

| batch | action / screen |
|---|---|
| <3000 | MAIN MENU: SINGLE PLAYER / BLOODBATH / OPTIONS / PRIME GIBS / QUIT, "DEMO V1.0A (BUILD 109)" |
| 3500 | Enter: SINGLE PLAYER -> CALEB / CHOSEN |
| 5500 | Enter: Caleb -> difficulty GENOCIDE / HOMICIDE / SUICIDE (Homicide highlighted) |
| 7500 | Enter: "DEMO LEVEL 1", Center for Disease Management |
| 9500 | Enter: in-level from ~11000, in the starting elevator |

Bindings come from `autoexec.cfg` `rangebind` lines (DIK codes): arrows move
and turn (200/208/203/205), Left Ctrl fires (29), Space opens (57), A jumps (30).
Evidence: `scratch/runs/20261006T015805Z-blood2-demo-app-route` (turn right,
fire: ammo 50 -> 46 with a bullet hole) and
`scratch/runs/20261006T015102Z-blood2-demo-walk` (walk out of the elevator,
take enemy fire to a death camera).

## What it needed

1. **LoadLibrary maps static imports first.** `ima.dll` imports
   `IMUSIC25.DLL` (which imports `AM18.dll`) and `MSYNTH25.DLL`; only
   Client.exe's LoadLibrary names ima.dll. The runtime yield pump in
   `lib/process-boot.js` mapped just the named file, so those imports fell to
   WAT stubs and the game trapped on `_AllocAAEngine2@8`. It now walks the
   target's imports (registry-loadable names only, not yet mapped, looked up
   beside the importer), maps and patches them deepest first and runs their
   DllMains before the target's. `imusic25.dll`, `msynth25.dll`, `am18.dll` are
   in `APP_LOCAL_DLLS`.
2. **`StringFromIID`** (ole32 alias of `StringFromCLSID`), called by IMUSIC25.
3. **DirectInput application-defined data formats.** The device loop at
   `0x429810` walks devices made by the EnumDevices callback `0x4292f0`.
   Creation (`0x42968e`) does CreateDevice, QI, SetCooperativeLevel, then
   SetDataFormat with a DIDATAFORMAT of **zero objects**; on failure it
   releases the device and stores 0, after which every poll skips it (no key
   in-level ever reached the game, though menus worked through WM_KEYDOWN).
   Later `0x429ea0` Unacquires, builds a format naming each bound object by
   its EnumObjects `dwType` and GUID at `dwOfs = 4*i`, and SetDataFormat's it;
   the poll reads `GetDeviceData` and indexes `[dev+0x8c + (dwOfs>>2)*4]`.
   Our DirectInput accepted only the standard keyboard/DIMOUSESTATE layouts.
   It now matches custom formats object by object (GUID, DIDFT type and
   instance, DIDFT_OPTIONAL) into a per-device offset map (guest heap block,
   pointer at +0 of the device's `DX_SURF_STATE` record, freed in `$dx_free`)
   and reports buffered and immediate data at the format's offsets, dropping
   objects the format omits.

## Not yet looked at

- Audio (DirectSound through softsnd.dll, plus the Interactive Music engine).
- The InstallShield setup and the `B2Demo.exe` launcher dialog.
- `ole32.dll` is in `APP_LOCAL_DLLS` but absent from this box's
  `test/binaries/dlls`, so ole32 imports fall to WAT stubs here.
- FPS and the browser.
