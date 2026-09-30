# Native Glide 3 demo corpus

Static audit: 2026-09-29. **Start with Diablo II Shareware**, then Hitman
Demo2, then Hype. All three original packages are already downloaded, with
real x86 Windows PE consumers of `glide3x.dll`. No additional download is
needed to begin Glide 3 implementation or real-game acceptance. This audit
did not execute installers or games, alter fixture originals, or change the
app registry. Existing successful non-Glide gameplay is not Glide acceptance.

Paths below are relative to `test/binaries/candidates/`.

| Priority | Launch executable | Original Glide consumer | Static import count | Preparation |
| --- | --- | --- | ---: | --- |
| 1 | `diablo-2-demo-installer/installed-extracted/diablo ii.exe` | Same directory, `d2glide.dll` | 36 | Existing `diablo2_demo` app mounts installed data and renderer; override renderer selection only in the test launch. |
| 2 | `hitman-codename-47-demo/launch-game/Hitman.Exe` | Same directory, `Render3DFX.dll` | 47 | Initial remote CLI smoke stopped at `XML_ParserCreate`; original parser DLL now explicitly seeded, rerun pending. No Glide gameplay claim. |
| 3 | `hype-time-quest-demo/launch-game/MaiDFXvr_bleu.exe` | The executable itself | 50 | Remote CLI smoke stopped at startup `DebugBreak`; assertion cause unresolved. No Glide gameplay claim. |

The counts come from actual import descriptors/thunks, re-read with
`node tools/pe-imports.js <consumer> --dll=glide3x.dll`. They are not counts
of arbitrary strings, wrapper exports, or required calls observed at runtime.
Hitman and Hype have complete original archives and `provenance.json` files
in their respective fixture directories. Explicit entries are now
`diablo2_glide_demo`, `hitman_glide_demo`, and `hype_glide_demo`; the latter
two are labeled experimental pending gameplay validation.

Remote CLI startup smoke on 2026-09-29 established blockers before gameplay:
Hitman initially stopped at `XML_ParserCreate`; Hype stopped at `DebugBreak`. Static
inspection identifies Hitman's original `xmlparse.dll` as the provider:
`XML_ParserCreate` is export ordinal 15, VA `0x20001006`. `EngineData.dll`
and `Locale.dll` import that symbol; the parser itself imports only four
KERNEL32 heap functions. The file was already in the launch tree and VFS
manifest, but absent from the explicit initial PE seeds. The Hitman app now
seeds this original DLL alongside `Globals.dll` so runtime-loaded engine
modules can bind its exports. The remote rerun passed that import and reached
the original renderer's error, “3DFX: Unable to run Glide on this card.”
`Render3DFX.dll` at preferred VA `0x0fb978f3` queries `GR_NUM_TMU` (`0x13`)
and at `0x0fb978fd` explicitly rejects a result of one. Later initialization
requests `grCoordinateSpace(1)` (clip coordinates) and TMU1 operations.
Real two-TMU rendering and clipping are required; changing the reported
capability would only hide the incompatibility. Hype's break may indicate an assertion, but its cause is not
yet established; bypassing `DebugBreak` would conceal the failure. Neither
smoke establishes gameplay support.

## Diablo II: shortest route to real gameplay

The original installed Shareware v1.04 payload already has known non-Glide
menu, character creation and Rogue Encampment coverage. See
[the package/renderer investigation](re-notes/diablo2-demo.md),
[the registry/mount definition](../lib/apps.js), and
[the existing gameplay driver](../test/test-diablo2-demo-gameplay.js).

Use a launch-local clone of `diablo2_demo` and change `Render` to DWORD `3`
under **both** registry keys:

```text
HKCU\Software\Blizzard Entertainment\Diablo II\VideoConfig
HKLM\Software\Blizzard Entertainment\Diablo II\VideoConfig
```

The current app defaults to `Render=1` (Direct3D). Older prose in the game
notes saying that no renderer is seeded is historical. `DeviceName` alone
does not select the renderer. Avoid `-w`, which selects GDI; preserve the
ordinary full-screen path. The documented historical `Render=3` run loaded
`d2glide.dll` and then stopped at `_grGet@12`. That establishes a reachable
original Glide consumer, not a current claim that the new implementation
runs it. The DLL is already in the app's `files` mount list for dynamic
loading; it need not be moved into the unconditional static DLL list.

Acceptance route:

1. Launch with actual guest threads and explicitly select the emulator's
   WebGL or native software Glide backend. Record runtime loading of
   `d2glide.dll`, a live Glide endpoint, and its draw/present counters.
2. Skip intro using normal input; wait for the actual Single Player menu.
3. Choose Single Player, double-click Barbarian, enter a fresh character
   name, confirm, and wait through the Act I loading portal.
4. Capture the Rogue Encampment with terrain, character/NPC, HUD and red/blue
   orbs. Ground-click to move, require subsequent presented frames and
   changed world/character pixels. Reuse the existing driver's route and
   semantic checks; its current pixel source must be adapted to the Glide
   presentation layer, and coordinates must follow the current client size.
5. Repeat on both Glide backends. Preserve actual frame dimensions: game
   notes establish 800x600 menus and 640x480 gameplay for the existing paths;
   observe Glide's selected dimensions rather than assuming them.

For later readback profiling, count actual LFB locks/readbacks and their
callers during gameplay. A static `_grLfbLock` import alone does not prove a
per-frame CPU readback, its direction, or its cost.

The new [browser driver](../test/test-diablo2-glide-web.js) encodes this route:

```sh
GLIDE_RENDERER=webgl CHROME=/path/to/chrome node test/test-diablo2-glide-web.js --swiftshader --no-sandbox
GLIDE_RENDERER=software CHROME=/path/to/chrome node test/test-diablo2-glide-web.js --no-sandbox
```

It always enables threads, clones `diablo2_glide_demo` if registered (otherwise
`diablo2_demo`), and overrides only that page's launch configuration.
`DIABLO2_GLIDE_STAGE=menu` is an explicitly labeled diagnostic run, not full
gameplay acceptance. `DIABLO2_GLIDE_STAGE_TIMEOUT_MS` defaults to 240000 per
stage; `DIABLO2_GLIDE_OUT` overrides `build/diablo2-glide/<backend>/`.
The report records the shared ABI version, runtime DLL selection evidence,
endpoint/backend, draw/present counters, dimensions and scene checks, with
framebuffer and desktop captures. Remote Chrome acceptance passed on both
WebGL (SwiftShader) and native WAT software: original renderer loading,
character creation, Rogue Encampment and normal-input movement. WebGL
screenshots were also inspected. The software route required independent
RGB/alpha clear masks, now covered by a native regression.

`DIABLO2_GLIDE_PROFILE_SECONDS=20` adds a gameplay interval without image
polling; use `--headful` for measurements. One remote WebGL interval recorded
535 presents in 20.13 seconds with zero LFB calls and zero GPU readbacks.
This establishes the readback behavior of that scene, not hardware-GPU speed.

### Exact Diablo II Glide imports

```text
_grDrawVertexArray@12          _grDrawVertexArrayContiguous@16
_grDrawLine@8                  _grDrawPoint@4
_grVertexLayout@12             _grCoordinateSpace@4
_grDitherMode@4                _grConstantColorValue@4
_grAlphaCombine@20             _grAlphaBlendFunction@16
_grColorCombine@20             _grColorMask@8
_grTexCombine@28               _grTexFilterMode@12
_grTexDownloadTable@8          _grTexDownloadMipMap@16
_grTexSource@16                _grTexMinAddress@4
_grTexMaxAddress@4             _grChromakeyMode@4
_grChromakeyValue@4            _grDepthMask@4
_grLoadGammaTable@16           _guGammaCorrectionRGB@12
_grSstWinOpen@28               _grSstWinClose@4
_grFinish@0                    _grBufferClear@12
_grBufferSwap@4                _grGlideShutdown@0
_grGlideInit@0                 _grSstSelect@4
_grGetString@4                 _grGet@12
_grLfbLock@24                  _grLfbUnlock@8
```

In particular, this is an array/layout-driven renderer with palette and
gamma APIs. Reusing Glide 2's fixed `GrVertex` interpretation is insufficient.
The same-name Glide 3 `_grSstWinClose@4` and `_grTexDownloadTable@8` differ
from Glide 2's decorated signatures; preserve both ABIs.

## Hitman Demo2: second engine and 3D scene

Original package: [Hitman.zip](https://archive.org/download/HitmanCodename47Demo/Hitman.zip),
35,407,292 bytes; [archive item](https://archive.org/details/HitmanCodename47Demo).
The retained `installer/readme_eng.txt` identifies **Demo2**. The 45,056-byte
`Hitman.Exe` is the engine entry point, not the installer. Its original
217,088-byte `Render3DFX.dll` imports Glide 3 plus `Globals.dll`, KERNEL32,
USER32 and GDI32.

The retained `installer/Hitman.ini` contains a commented Glide selection and
an active Direct3D selection. In a copied launch configuration use:

```text
Include Setup\Locale.zip
DrawDll Render3DFX.dll
SoundDll Sound.dll
ScriptDll GSC.dll
LocaleDLL Locale.dll
Resolution 800x600
```

The separate `launch-game/` tree now merges `Engine_files/` and `Game_files/`
at the game root, retains `Game_Setup_files/Setup/`, and supplies the copied
`Hitman.ini` above. Static inspection of the original `installer/setup.ins`
finds the English branch's `readme_eng.txt`/`language-English.zip` pair and
the configuration-copy source `setup\locale` and destination `locale.zip`.
Accordingly `Setup/Locale.zip` is a byte-identical copy of the original
`Setup/Locale/language-English.zip`, matching the INI's Include statement.
No locale archive content or executable was modified. Installer registry
effects remain unverified; no speculative registry values were seeded.

Original data includes `C1_HongKong/C1_3.zip`, its laptop/pre-mission files,
UI packages and audio. Acceptance should reach a playable demo mission and
show character/camera movement after normal input, not stop at the renderer
launch panel. The package includes the original WASD/numpad keyboard-layout
PDFs. This route has not yet been run.

Beyond Diablo II, its import set includes `_grSelectContext@4`,
`_grViewport@16`, `_grClipWindow@16`, `_grTexDownloadTablePartial@16`,
`_grLfbConstantDepth@4`, `_grFlush@0`, `_guFogGenerateExp2@8`, depth-buffer
state and alpha-test operations. Full exact imports are in its provenance.

## Hype: direct Glide executable, additional setup work

Original package: [hypedemo.exe](https://archive.org/download/hypedemo/hypedemo.exe),
34,645,838 bytes; [archive item](https://archive.org/details/hypedemo).
The original `hype/Readme.txt` explicitly distinguishes Glide 3.01 from
DirectX 6.1. Use `exe/Glide 3x/MaiDFXvr_bleu.exe`, not the alternative
DirectX executable or configuration utilities.

The original `hype/InstData/ubi.ins` resolves the installation layout without
executing setup. `launch-game/` now follows its `COMMON FILES`, English
`LANGUAGE FILES`, and `CONFIG 3DFX with MMX (GLIDE 3x)` / `SPECIFIC FILES`
mappings. English level/dialog and sound-bank files are copied into their
installed destinations, not left in language-source subdirectories. The
script identifies `MaiDFXvr_bleu.exe`, working directory `.`, and INI values
`Complete=1`, `ChangeMapMusic=0`, `LowGraphicMode=0`.

Disassembly at original VA `0x4055b0` calls `GetWindowsDirectoryA` and appends
`/UbiSoft/Ubi.ini`; its `GetPrivateProfileStringA` calls use section
`Hype - The Time Quest DEMO`. The staged file is therefore
`launch-game/windows/UbiSoft/ubi.ini`, to be mounted at
`C:\windows\UbiSoft\ubi.ini` when the guest Windows directory is `C:\windows`:

```ini
[Hype - The Time Quest DEMO]
Complete=1
ChangeMapMusic=0
LowGraphicMode=0
Language=English
SoundOnHD=1
SoundStream=0
```

The final three entries select English and full-disk audio; the executable
reads those exact keys at `0x40585e`, `0x405881`, and `0x4058be`. The first
three values come directly from the Glide install section. Five installer
size fields are stale relative to the shipped files (including the game
EXE); the assembly records both sizes and copies actual bytes unchanged.
The original complete extraction is retained for further setup investigation.

Its import set adds `_grEnable@4`, `_grDisable@4`, `_grGetProcAddress@4`,
`_grLfbWriteRegion@36`, `_guFogGenerateLinear@12`, and
`_guFogTableIndexToW@4`. Dynamic extension names and their actual use need a
runtime lookup trace; the static GetProcAddress import does not establish
which extensions are required.

The original readme gives arrow keys for movement, Left Shift to run,
Ctrl to jump, Space for action, and Enter for magic. A practical acceptance
route should enter the demo scene, move/jump with these inputs, and inspect
textured terrain/character, fog, transparency and HUD on both backends.

## Reproducibility and limits

### Assembled manifest handoff

Both candidate roots now contain `launch-manifest.json`, listing every
copied source, destination, byte count and SHA-256 plus generated INI changes.
Every copied file was compared byte-for-byte with its original after assembly.

| Launch tree | Files | Bytes | Guest layout |
| --- | ---: | ---: | --- |
| `hitman-codename-47-demo/launch-game/` | 75 | 42,270,720 | Root at `C:\`, EXE `Hitman.Exe`, cwd `C:\`, no arguments |
| `hype-time-quest-demo/launch-game/` | 59 | 38,067,871 | Root at `C:\`, EXE `MaiDFXvr_bleu.exe`, cwd `C:\`, no arguments; Windows INI at the absolute path above |

For app registration, mount every file preserving its path relative to
`launch-game/`; flattening basenames will break both packages. Hitman must
make `Globals.dll` available to the initial PE dependency loader and retain
the engine DLLs as loadable files. Hype must make its bundled root
`MFC42.DLL`/`MSVCRT.DLL` available to that loader and retain `dll/` plugins.
Use the original Glide imports through the emulator, without adding a modern
Glide wrapper or Voodoo driver binary. Each root also has a schema-v1
`.wine-assembly-browser.json` consumed by its registered app; it enumerates
all 75/59 files with explicit VFS paths. Diablo II's Glide entry shares its
existing file manifest and changes only the two Render registry values to 3.
These Hitman/Hype layouts are launch-prepared, **not proven playable**;
the next step is an emulator launch with import/file tracing on the remote box.

Fresh local hashes from this audit:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Diablo II `d2glide.dll` | 94,267 | `baf3ec79532bb569f17ac5a026bcd5aca71cc6df49f998164405a3d74dd23a9e` |
| Hitman `Engine_files/Hitman.Exe` | 45,056 | `69707ab810574a85a0dc202aeef78da55a98a8c9ff6a0cf6bda662cb5edd2d70` |
| Hype `MaiDFXvr_bleu.exe` | 1,947,648 | `635f394121e50001227b97741dbf304f0a88f819c6f2ba2378cf61d9fa2a6344` |

Package/renderer hashes, extraction commands and source URLs for Hitman and
Hype are retained in their local `provenance.json`; see also the
[acquisition report](glide-demo-candidates.md#glide-3-corpus-acquisitions).
Diablo II's package and installed data hashes are in its linked game notes.
No fresh network acquisition was necessary. These are proprietary demo
fixtures in the ignored local corpus; this document contains no game payload.

Reproduce both launch trees and their manifests from the retained original
packages and already-extracted sources with:

```sh
node tools/prepare-glide3-corpus.js
node tools/prepare-glide3-corpus.js --check
```

Use `--corpus-root=PATH` for another candidate corpus directory. The tool
validates both input plans before writing, pins the original package and
renderer/executable hashes, follows Hype's English/Glide installer mappings,
and preserves directory casing consistently on case-sensitive hosts. It writes
the two `launch-game/` trees, `launch-manifest.json` source/hash mappings, and
`.wine-assembly-browser.json` mounts. It preserves acquisition `provenance.json`
and all original inputs, refuses differing existing outputs, and leaves
identical outputs intact. `--check` verifies the prepared outputs without
writing. Neither command downloads files or executes any guest code. The
manifest date records the recipe audit, not the invocation date; the five
stale Hype installer size fields remain recorded rather than truncating data.

Unreal Tournament 348 is deliberately excluded: its original `GlideDrv.dll`
imports `glide2x.dll`, despite its similar vintage. Original Glide 2 games
remain useful regression coverage, but do not count as Glide 3 acceptance.
