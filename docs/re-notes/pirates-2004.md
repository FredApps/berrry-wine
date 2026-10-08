# Sid Meier's Pirates! (2004)

`test/binaries/candidates/pirates-2004/digital/app/Pirates!.exe`, registry id
`pirates_2004` (`d3d9Programmable`, `bigMemory`). Direct3D 9, statically linked
(`d3d9.dll` import), with msvcr71/msvcp71, Bink, Miles (mss32 plus its
`win32/*.asi`, `*.m3d`, `*.flt` providers) and oleaut32 from the game directory.

## Route to the main menu (CLI, software D3D9 arm)

```sh
node test/run.js --app=pirates_2004 --d3d9-renderer=software --batch-size=100000 \
  --max-batches=1000000 --max-seconds=180 --stuck-after=1000000 --no-close --png=menu.png
```

The D3D9 main menu (Play Sid Meier's Pirates!, Load A Game, Change Your System
Options, Visit The Firaxis Website, Visit The Hall Of Champions, View Credits,
Quit, over the Caribbean map) is up by batch ~1000 at `--batch-size=100000`.
Assets load from `assets\pak*.fpk` one byte per `ReadFile`, which is slow but
correct. Evidence: `scratch/runs/20261006T033534Z-pirates_2004-dxinit`.

## Startup, as reverse engineered (2026-10-06)

- `0x4d2950` is graphics init. It calls `0x500080` (device setup); a nonzero
  result goes to an error path that first asks the DxDiag provider for the
  DirectX version (`0x4ad050`, through the game's `dxdiagn.dll` COM server)
  **only to choose the message**: below 9.0c (`0x90003`) it shows the
  "requires DirectX 9.0c" text at `0x70e234`, otherwise "Unable to initialize
  DirectX." So that message never means the DirectX version check failed.
- Device setup creates a HAL device with software vertex processing
  (BehaviorFlags `0x24`), reads the render target, depth surface and
  `GetDeviceCaps`, and at `0x5c0963` requires `MaxTextureBlendStages >= 2` and
  `MaxSimultaneousTextures >= 2`. Its caps record is at `this+0x644`; it also
  reads MaxVertexBlendMatrices (`+0xa8`), MaxStreams, and the vertex/pixel
  shader versions (`+0xc4`/`+0xcc`; the helper at `0x5002f0` returns them as
  major*10+minor to about twenty callers).
- Miles' A3D provider `win32\mssa3d.m3d` asks `CoCreateInstance` for
  Aureal's class (`a3dapi.dll`), which no machine without an A3D card has.

## Fixed

| commit | what |
|---|---|
| `ba161dfb` | D3D9 caps advertise `MaxTextureBlendStages = 6` (was 0) |
| `12408feb` | a `CoCreateInstance` whose in-proc DLL is missing resumes the caller (the yield pump left EIP on the thunk and re-ran it on the caller stack) and clears `*ppv` |
| `d7f5a429` | `test/run.js` honours `bigMemory` (2048 MB); at 512 MB the asset load runs out of guest heap |

## Not yet looked at

Gameplay (`Play Sid Meier's Pirates!`), audio, the WebGL arm at this build.
`ole32.dll` is absent from this box's `test/binaries/dlls`, so the Miles
providers' ole32 imports fall to WAT stubs.
