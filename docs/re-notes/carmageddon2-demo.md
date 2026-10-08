# Carmageddon II: Carpocalypse Now demo (SCi / Stainless, 1998)

`lib/apps.js` id **`carmageddon2_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/Carmageddon2Demo-D3D-Glide/installed/carma2_d3d.exe`
with `smackw32.dll`. Argonaut BRender 1.3 engine; Direct3D (IDirect3DDevice2 +
viewport Clear/Begin/EndScene), DirectInput keyboard, Smacker intro.

## Getting the files (InstallShield 3)

The package is InstallShield 3 media (`SETUP.EXE` 16-bit bootstrap, `data.z`).
`installed\` is what the demo's own installer wrote inside the emulator:

```sh
# 1. the 16-bit bootstrap extracts _ins0432._mp and launches it; capture that
node test/run.js --exe='<pkg>/SETUP.EXE' --vfs-include='**/*' --screen=800x600 \
  --batch-size=100000 --tick-ms-per-batch=100 --max-batches=400 --no-close --capture-launch=<cap>
# 2. run the engine with the launch.json args, press Next through every page
node test/run.js --exe=<cap>/windows/temp/_ins0432._mp --exe-guest-path='c:\windows\temp\_ins0432._mp' \
  --args='-fC:\SETUP.INS  -z1 -cx -xC:\WINDOWS\TEMP\' --vfs-tree=<cap> --cwd='C:\' --screen=800x600 \
  --batch-size=100000 --tick-ms-per-batch=100 --max-batches=25000 --no-close --save-vfs=<out> \
  --input='620:dlg-click:1,740:dlg-click:1,860:dlg-click:1,980:dlg-click:1,1100:dlg-click:1,1220:dlg-click:1,9010:dlg-click:1'
```

"Setup is complete" by ~9000; copy `<out>/program files/interplay/carmageddon ii demo`
to `installed\` (46 MB, 1606 files).

## Executables

- `carma2.exe` is a launcher (dialog 101): probes DirectDraw/Direct3D
  (`IDirect3D2::FindDevice`) and `glide2x.dll`, then launches
  `carma2_d3d.exe`/`carma2_3dfx.exe`/`carma2_ddraw.exe` (the last is not in the
  demo). Headless it reports "Invalid Option" after its countdown, so the
  registry runs `carma2_d3d.exe` directly. Not investigated further.
- BRender loads its renderer drivers (`*.bdd`, no PE import directory) and
  resolves their imports by name with `GetProcAddress(exe module, name)`.
  It refuses the driver on the first name it cannot resolve
  ("BRender error detected: Could not resolve imported symbol KERNEL32:X (N)"):
  that was `DebugBreak` and `FatalAppExitA`, both added in 5e42bda1.
  `IsTNT` (a DOS-extender probe) failing is expected.
- The game reads `C:\DATA\...` relative to its directory, so the tree mounts at
  `c:\`. The `Evalu01`/`outro6` lookups in `32X20X8\`, `TIFFX\`, `PIX8\` are the
  engine trying resolutions and formats in turn.

## Route

```sh
node test/run.js --app=carmageddon2_demo --quiet-api --batch-size=50000 --max-batches=3201 --no-close \
  --input='2250:tick-ms:10,2700:keydown:104,3200:keyup:104,3200:png:/tmp/carma.png'
```

Smacker intro (~800), LOADING title (~1500), the Controls screen (~2200), then
the race on its own: grid flyby, 3-2-1, go. Keypad 8 accelerates (VK 0x68),
keypad 2 brakes/reverses, keypad 4/6 steer. Switch to `tick-ms:10` before the
race: at 200 ms/batch the demo's race timer runs out in a few hundred batches
and it plays its outro "sell" screens and exits (ExitProcess(0) after writing
`OPTIONS.TXT`) — that exit is the demo ending, not a crash.
