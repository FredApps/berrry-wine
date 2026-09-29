# Glide demo candidates

Research checked 2026-09-29. These are acquisition and compatibility leads,
not additional games claimed to run. Prefer the original renderer distributed
with the demo; a modern Glide wrapper does not establish that the original
game or this implementation supports the required API.

## Archive.org leads

Ranked for further Win32 renderer inspection. Sizes are exact bytes from the
Internet Archive item metadata, rather than rounded item totals.

| Priority | Demo and item | Original file | Bytes | Evidence and remaining check |
| --- | --- | --- | ---: | --- |
| 1 | [Turok: Dinosaur Hunter](https://archive.org/details/TUROK_201402) | [TUROK.EXE](https://archive.org/download/TUROK_201402/TUROK.EXE) | 10,382,356 | **Verified original Win32 Glide2.** Extracted `Video_3DFx.dll` imports `glide2x.dll` with 47 decorated functions. Original August 28, 1997 readme identifies a 3dfx-only demo requiring Glide 2.3 or later. |
| 2 | [Moto Racer 2](https://archive.org/details/MotoRacer2Demo) | [MotoRacer2Demo.zip](https://archive.org/download/MotoRacer2Demo/MotoRacer2Demo.zip) | 41,969,125 | The bundled [Motohelp.txt](https://archive.org/download/MotoRacer2Demo/MotoRacer2Demo.zip/Motohelp.txt) gives `moto.exe -3DFX` and lists the 3dfx option separately from Direct3D. Original renderer selection is documented; exact Glide DLL/API generation still needs binary inspection. |
| 3 | [Unreal Tournament demo](https://archive.org/details/UnrealTournament) | [UTDemo338.exe](https://archive.org/download/UnrealTournament/UTDemo338.exe) | 55,603,712 | A contemporary [Mark Rein announcement](https://tweakers.net/nieuws/5484/mark-rein-over-unreal-tournament-demo.html) explicitly directs 3dfx users to Glide. The archive describes this as the expanded demo following the earlier 3dfx-only release. Inspect this package's `GlideDrv` rather than assuming the API generation of later retail patches. |
| 3, alternative | [Unreal Tournament demo version 348](https://archive.org/details/unreal-tournament-demo-version-348) | [UTDEMO348.EXE](https://archive.org/download/unreal-tournament-demo-version-348/UTDEMO348.EXE) | 55,647,232 | Subsequently acquired and extracted below: original `System/GlideDrv.dll` imports `glide2x.dll`, with 54 functions. Glide 2, not Glide 3. |

The Turok installer has MD5 `9c92578fe9a6038731722dcb9b2502ba`.
Its self-extracting ZIP contains an InstallShield `data1.cab`. Follow-up
inspection successfully extracted it with the already installed `unshield`:
preserving the original `data1.cab` basename resolves the earlier open failure.
`Video_3DFx.dll` is 93,696 bytes; `Turok3DfxDemo.exe` is 1,091,072 bytes.
The renderer's actual PE import descriptor names `glide2x.dll`, with 47
decorated imports including `_grSstWinOpen@28`, `_grLfbLock@24`,
`_guTexAllocateMemory@60`, `_guTexSource@4`, `_guTexDownloadMipMap@12`, and
`_guDrawTriangleWithClip@12`. These utility-texture and clipped-triangle calls
make it a useful next compatibility target; API generation alone does not
prove the current implementation covers them. Nothing was executed.

Installer SHA-256:
`340c67692279c94c5d83a6622b7f63be469b484fb8e32594cd5579af21a1f18e`.
Extracted renderer SHA-256:
`cf5b66ca2e252afaefc1449341c513ece72987637d8813d54b84e1da7b19f83b`.
Static extraction lives under `/private/tmp/glide-turok-static/extracted/`.

Metadata sources: [Turok](https://archive.org/metadata/TUROK_201402),
[Moto Racer 2](https://archive.org/metadata/MotoRacer2Demo),
[UT 338](https://archive.org/metadata/UnrealTournament),
[UT 348](https://archive.org/metadata/unreal-tournament-demo-version-348).

## Already available local fixtures

An independent static audit of the shared fixture tree verified the following
PE imports. These require no new acquisition and should precede the archive
leads for practical coverage. Paths are relative to
`test/binaries/candidates/`. The worktrees share this fixture tree; do not
modify its originals to select a renderer.

| Priority | Registered app | Renderer and verified API | Preparation or limitation |
| --- | --- | --- | --- |
| 1 | `gta2_demo` | `gta2-demo/installed/Program_Executable_Files/DMAGlide.dll` imports `glide2x.dll`; companion `3dfx.dll` also uses Glide 2 | Authentic 1999 Wild Demo. Both renderer DLLs are already mounted. |
| 2 | `unreal_special_demo` | `unreal-special-edition/installed/system/glidedrv.dll` imports `glide2x.dll`; 46 decorated `gr` names | Renderer is mounted; INI currently selects software. Existing software gameplay acceptance does not establish Glide acceptance. |
| 3 | `deus_ex_demo` | `deus-ex-demo/installed/system/glidedrv.dll` imports `glide2x.dll`; 51 decorated `gr` names | Authentic 1.002f demo. Launch manifest includes `GlideDrv.int` but omits the DLL: mount the renderer and select it in the launch configuration. |
| 4 | `diablo2_demo` | `diablo-2-demo-installer/installed-extracted/d2glide.dll` imports `glide3x.dll` | Authentic Barbarian demo. Existing investigation reached `_grGet@12` with `Render=3`; requires the Glide 3 surface. |

These counts are decorated `gr` names from the static import audit, not the
broader string-reference counts in the design document. See the
[Glide design](3dfx-glide-design.md),
[Unreal-family notes](re-notes/unreal-family-demos.md) and
[Diablo II notes](re-notes/diablo2-demo.md) for existing investigations.

Lower-priority local fixtures contain original OpenGL-to-Glide drivers:

- `quake2_demo`:
  `quake-2-demo-installer/installed-extracted/Install/Data/3dfxgl.dll`.
- `halflife_uplink`:
  `half-life-uplink-installer/installed/gldrv/3dfxgl.dll`.
- `icewind_dale_demo`:
  `icewind-dale-demo/installed-extracted/Recommended_compressed/3dfx.dll`.
  This imports `glide2x.dll` and exports 360 `gl`/`wgl` functions; the current
  manifest omits it.

These are original intermediary drivers, not direct game-level Glide renderers
or modern replacement wrappers. Their OpenGL dependency adds another layer
to validation. UT348 was absent at the initial local audit; the follow-up below
adds its original demo fixture without registering a launcher entry.

## Separate or unverified leads

### Windows Tomb Raider demos added to the corpus

These exercise Direct3D 2, not native Glide. Downloaded and statically
extracted on 2026-09-29; each directory contains `provenance.json` with original
URLs, byte sizes, SHA-256 checksums, extraction details and PE evidence.
No launch entries were added and neither installer nor game was executed.

- [TR II Venice](https://www.tombraiderchronicles.com/tr2/demo.html):
  `test/binaries/candidates/tomb-raider-2-demo/game/TOMB2.EXE`.
  Original download `tr2_demo_02.exe`, 3,781,120 bytes.
- [TR III India/Jungle](https://www.tombraiderchronicles.com/tr3/demo.html):
  `test/binaries/candidates/tomb-raider-3-demo/extracted/Program_Executable_Files/tomb3.exe`.
  Original download `tr3_demo_01.exe`, 7,777,792 bytes. InstallShield extraction
  required `unshield -O` (old compression).

Both executables import DirectDraw and contain the Direct3D 2 interface GUID;
no Glide import or string was found. They are separate from the DOS Tomb
Raider I 3dfx package below.

| Demo | File and bytes | Why it is not a verified Win32 Glide candidate yet |
| --- | --- | --- |
| [Tomb Raider 3dfx demo](https://archive.org/details/tomb3dem) | `tomb3dem.zip`, 2,310,970 | The [archive listing](https://archive.org/download/tomb3dem/tomb3dem.zip/) includes `DOS4GW.EXE` and `TOMB.EXE`. This is the DOS branch, requiring separate DOS/3dfx investigation rather than the current Win32 Glide DLL path. The archive's generic Windows tag is insufficient evidence to the contrary. |
| [Carmageddon 2: Carpocalypse Now](https://archive.org/details/Carmageddon2CarpocalypseNowDemo) | `Carmageddon2Demo.zip`, 23,022,621 | Original demo installer located, but bundled renderer/readme evidence was not established in this search. Do not infer demo Glide support solely from the retail game's title. |
| [Moto Racer](https://archive.org/details/MOTORACE) | `MOTORACE.rar`, 20,090,906 | Original demo located; this package's Glide renderer support remains unverified. |

No FIFA/NBA package met the evidence threshold in this bounded search.

## Additional well-known games checked

The strongest newly verified **Win32 Glide2** lead is **Wing Commander:
Prophecy's original 3dfx test**. This is a different, smaller release from
the later story demo, and it specifically requires Glide.

| Title / original package | Exact file and bytes | Evidence and priority |
| --- | --- | --- |
| [Wing Commander: Prophecy 3dfx Test](https://download.wcnews.com/files/wcp/) | [3DFXTEST.zip](https://download.wcnews.com/files/wcp/3DFXTEST.zip), 13,655,530 | **Verified original Win32 Glide2.** Origin's bundled `README.TXT` requires Windows 95, DirectX 5, and Glide 2.43. Package contains `WCP3DFX.EXE` and `GL_00002.DLL`; the latter is x86 PE and its actual import descriptor names `glide2x.dll`. Decorated calls include `_grSstWinOpen@28`, `_grDrawTriangle@12`, lines and points. Best new targeted candidate. This mirror is WCNews, not archive.org. |
| [POD 3dfx shareware](https://archive.org/details/PodDemo_201806) | [POD-3Dfx.zip](https://archive.org/download/PodDemo_201806/POD-3Dfx.zip), 11,541,912 | **Verified native Win32, but early Glide ABI.** Actual x86 PE `podx3dfx.exe` imports `glide.dll`, with `_grSstOpen@24`. Do not classify this as the currently implemented Glide2 ABI. Original bundled readme identifies shareware with two tracks/two cars. Archive item separately offers nGlide; it is unnecessary for this static evidence and was not downloaded. |
| [POD multiplayer demo](https://archive.org/details/poddemo) | `poddemo3dfx.exe`, 12,304,078; ordinary `poddemo.exe`, 11,754,801 | Dedicated 3dfx installer located, but not inspected; its ABI may differ from the earlier two-track shareware. Keep these releases distinct. |
| [Grand Prix Legends original demo](https://archive.org/details/GPLDEMO) | [GPLDEMO.rar](https://archive.org/download/GPLDEMO/GPLDEMO.rar), 11,658,837 | Archive listing contains `PROGRAM/GPL.EXE`, `RAST3DFX.DLL`, `RENDDLL.DLL`, and `SOFTDLL.DLL`: original separate 3dfx renderer confirmed. Sierra's [1999 catalog](https://www.sierragamers.com/wp-content/uploads/2019/12/Catalog_1999_Spring_Buyers_Guide.pdf) independently advertises native 3dfx/Rendition support for the game. Exact demo DLL imports remain unverified: installed `tar` lists this RAR but rejects its executable compression filter. Prefer this historical demo over community 2004/2020 repacks for ABI research. |
| [Wing Commander: Prophecy later demo](https://archive.org/details/WCPDEMO) | `WCPDEMO.rar`, 56,307,973 | Archive description explicitly distinguishes native 3dfx and Direct3D paths, but this package has not been inspected. Original 3dfx test above has stronger evidence and is smaller. |
| [Incoming demo](https://archive.org/details/incoming_201401) | `incoming.exe`, 3,971,633 | **Not promoted as a native Glide candidate.** Package located, but no original Glide DLL/readme evidence established. Contemporary demo descriptions require a Direct3D card; Voodoo compatibility alone does not establish Glide. Suitable for separate D3D corpus investigation. |
| [Carmageddon 2 demo](https://archive.org/details/Carmageddon2CarpocalypseNowDemo) | `Carmageddon2Demo.zip`, 23,022,621 | Plausible native Glide lead, but this specific demo's renderer imports remain unverified. Do not substitute retail or Macintosh renderer evidence. |

Follow-up GPL extraction also tried the already installed p7zip 17.04.
It lists the archive but reports `Unsupported Method` for `RAST3DFX.DLL`
and `README.WRI`; BSD tar reports `Parsing filters is unsupported` for
the renderer. Neither produced a usable DLL. No extractor was installed
and no installer was executed, so the precise GPL demo Glide ABI remains
an explicit extraction blocker. Moto Racer 2 remains at documented renderer
selection evidence; its larger package was not downloaded in this follow-up.

### DOS branches

**Tomb Raider I, Carmageddon I/Splat Pack, Redguard, and Screamer Rally**
belong in a separate DOS/3dfx workstream. DOS hardware or `GLIDE2X.OVL`
support does not follow from adding Win32 `glide2x.dll` handlers. The
[DOSBox Staging video-card documentation](https://github.com/dosbox-staging/dosbox-staging/wiki/Video-cards)
is the implementation project's reference for this distinction; package
verification is still required before claiming any particular demo works.

- Tomb Raider's already listed `tomb3dem.zip` directly contains `DOS4GW.EXE`.
- [Redguard demo](https://archive.org/details/REDGUARDDemo):
  `REDGUARD-Demo.rar`, 69,454,643 bytes. Package located, not downloaded;
  no claim that its particular demo includes the accelerated executable.
- [Screamer Rally demos](https://www.dosgamesarchive.com/download/screamer-rally):
  host identifies `srdemo.zip` (19,114 kB) and `srdemo-it.zip` (36,825 kB)
  as playable MS-DOS demos. Exact bytes and demo-specific Glide executable
  imports were not inspected. `srally.zip` is an ambiguous historical name
  also used by Sega Rally, so identify the contents before acquisition.
- [Carmageddon Splat Pack demo](https://www.dosgamesarchive.com/download/carmageddon-splat-pack/)
  is a more relevant DOS 3dfx lead than assuming the earliest Carmageddon
  beta already shipped acceleration. Exact package ABI remains unchecked.

### Static acquisition provenance

Only archive inspection was performed; none of these executables was run.
The three additional downloads are temporary research artifacts outside
the committed corpus. SHA-256:

| Local file | SHA-256 |
| --- | --- |
| `/private/tmp/glide-wcptest.zip` | `1c32356897741ba60be5ca420631f0b690cb44ab2bc2827d70c51a2d5ae43a3d` |
| `/private/tmp/glide-pod.zip` | `c06447418627bd90ef5a7990f34f483998160cb332ee101aa80c7442681d7d85` |
| `/private/tmp/glide-gpl.rar` | `7526c59bda28da4ff3866ddf876b589e6c131605d77fa5ab8a45d4363d92f57d` |

## Acceptance before adding a launcher entry

1. Extract the original package and inventory PE imports, dynamic DLL names,
   decorated exports, and the actual renderer selection mechanism.
2. Classify Win32 `glide2x.dll`, `glide3x.dll`, or DOS/direct hardware access.
   An original 3dfx option alone does not establish this distinction.
3. Trace the original renderer with threads enabled and fail on unsupported
   APIs. A title screen or successful DLL load is not gameplay acceptance.
4. Verify moving geometry, input, HUD and texture transparency with screenshots
   and renderer counters. Record renderer-specific API gaps separately from
   unrelated loader, audio or platform dependencies.

## Follow-up: DOS Zone and PCGamingWiki lists

Checked 2026-09-29 against [DOS Zone's 3dfx collection](https://dos.zone/3dfx/)
and [PCGamingWiki's Glide list](https://www.pcgamingwiki.com/wiki/List_of_Glide_games).
The latter returned HTTP 403 directly; its search-index copy was accessible,
but this was not an exhaustive audit of all its entries. These are discovery
lists, not evidence that a particular original demo includes a Win32 Glide
renderer. None of the new packages below was downloaded or executed in this
follow-up. Archive filenames and exact sizes were checked through item metadata.

### Newly located Windows demo candidates

| Priority | Candidate and preserved demo | Original-renderer evidence and remaining uncertainty |
| --- | --- | --- |
| 1 | [Myth: The Fallen Lords demo](https://archive.org/details/MYTHDEMO): [MYTHDEMO.EXE](https://archive.org/download/MYTHDEMO/MYTHDEMO.EXE), **32,647,564 bytes** | Bungie's preserved [original Windows readme](https://oldgamesdownload.com/readme/myth-the-fallen-lords-windows-readme-english/) describes automatic 3dfx selection and bundled Glide 2.4.3. This is strong game-level Glide 2 evidence, but the specific demo's imports still need inspection. Prefer the original demo over modern Myth II ports/remasters. Useful new strategy-engine workload. |
| 2 | [Sub Culture demo](https://archive.org/details/SCCGWDEM): [SCCGWDEM.EXE](https://archive.org/download/SCCGWDEM/SCCGWDEM.EXE), **20,206,080 bytes** | Criterion's preserved [original Windows readme](https://oldgamesdownload.com/readme/sub-culture-windows-readme-english/) explicitly requires Glide 2.42 or later for the Voodoo version and distinguishes it from Direct3D, PowerVR and Rendition builds. Inspect which executables the demo actually includes before classifying its ABI. |
| 3 | [Recoil demo](https://archive.org/details/RecoilDemo): [RECOIL.zip](https://archive.org/download/RecoilDemo/RECOIL.zip), **30,351,332 bytes** | The archive listing contains the original `recoil.exe` installer, 29,250,305 bytes. The DOS Zone implementation author's [Glide port account](https://habr.com/ru/articles/924068/) identifies Recoil among its working Glide titles. This confirms a game-level lead, not the demo's exact renderer or API generation; extract the original package next. |
| 4 | [Future Cop: L.A.P.D. demo](https://archive.org/details/fcopdemo): [fcopdemo.exe](https://archive.org/download/fcopdemo/fcopdemo.exe), **23,693,671 bytes** | The same [implementation account](https://habr.com/ru/articles/924068/) identifies Future Cop in its Glide path. The preserved demo exists independently of retail downloads. Its actual renderer DLL/import generation remains unverified. |
| 5 | [Hard Truck: Road to Victory demo](https://www.moddb.com/games/hard-truck-road-to-victory/downloads/hard-truck-road-to-victory-demo-version): `HardTruckDemo.rar`, **16,177,078 bytes** | Host identifies demo v1.6.0 with one Circuit route. The [original Windows readme](https://oldgamesdownload.com/readme/hard-truck-road-to-victory-windows-readme-english/) discusses separate accelerator selection, and the DOS Zone author's account confirms a Glide path for the title. The demo's binary/API generation is unchecked. Do not substitute Hard Truck 2. |
| 6 | [Forsaken demo](https://archive.org/details/FORSAKEN_201610): [FORSAKEN.zip](https://archive.org/download/FORSAKEN_201610/FORSAKEN.zip), **42,762,069 bytes** | DOS Zone includes the game, but this demo's original native Glide renderer was not established here. Keep below the stronger original-readme candidates until inspecting its driver profiles and DLL imports; modern replacement-driver packages are insufficient evidence. |

Metadata: [Myth](https://archive.org/metadata/MYTHDEMO),
[Sub Culture](https://archive.org/metadata/SCCGWDEM),
[Recoil](https://archive.org/metadata/RecoilDemo),
[Future Cop](https://archive.org/metadata/fcopdemo),
[Forsaken](https://archive.org/metadata/FORSAKEN_201610).

### What the catalog comparison does not add

- GTA2 and Turok already have stronger local binary evidence above; their
  catalog listings do not represent additional acquisitions.
- Carmageddon's original DOS branch remains separate. For GTA1 and London,
  verify which executable supplies 3dfx support rather than assuming that a
  Windows edition implies a Windows Glide renderer.
- DOS Zone also lists **Valley of RA**, **Grand Bleu Flipper**, and **The Wizard
  of Tower WIZ** technology demos. They may be compact graphics fixtures,
  but original package provenance, executable platform, and required Glide
  ABI were not verified here; no compatible Win32 claim is made.
- Original Glide 2 consumers already mounted locally remain the quickest
  next tests. Myth and Sub Culture are the best new acquisition leads from
  this comparison, rather than replacements for GTA2/Unreal acceptance.

## Glide 3 corpus acquisitions

Downloaded and statically extracted on 2026-09-29: **two new verified native
Win32 Glide 3 demos**, in addition to the existing Diablo II demo. Verification
read each original x86 PE import descriptor and thunk table; a filename,
wrapper bundle, or retail game's reputation was not used as proof. No
installer or game was executed, and no registry or launcher entries changed.

Paths below are relative to the worktree's `test/binaries/candidates/` symlink,
which points at the shared ignored corpus. Each new directory has a
`provenance.json` recording source URLs, archive and renderer hashes, extraction
commands, dependency DLL names, and every actual Glide import.

| Demo | Original archive | Verified renderer | Useful Glide 3 coverage |
| --- | --- | --- | --- |
| **Hitman: Codename 47 Demo 2** | [Hitman.zip](https://archive.org/download/HitmanCodename47Demo/Hitman.zip), **35,407,292 bytes**; [item](https://archive.org/details/HitmanCodename47Demo) | `hitman-codename-47-demo/extracted/Engine_files/Render3DFX.dll`, **217,088 bytes**, imports **47 functions from `glide3x.dll`** | Includes `_grSelectContext@4`, `_grCoordinateSpace@4`, `_grViewport@16`, `_grVertexLayout@12`, `_grDrawVertexArrayContiguous@16`, `_grGet@12`, and `_grSstWinClose@4`. Original readme explicitly identifies Demo2. Installer `Hitman.ini` documents `DrawDll Render3DFX.dll`, with Direct3D selected by default. |
| **Hype: The Time Quest demo** | [hypedemo.exe](https://archive.org/download/hypedemo/hypedemo.exe), **34,645,838 bytes**; [item](https://archive.org/details/hypedemo) | `hype-time-quest-demo/extracted/HypeDemo/hype/exe/Glide 3x/MaiDFXvr_bleu.exe`, **1,947,648 bytes**, imports **50 functions from `glide3x.dll`** | Includes vertex layout/contiguous arrays, `_grEnable@4`, `_grDisable@4`, `_grGetProcAddress@4`, `_grLfbWriteRegion@36`, and Glide 3 texture-table signatures. Original demo readme explicitly describes **Glide 3.01** and DirectX 6.1 alternatives. Executable archived August 31, 1999. |

Both complete original archives are retained. Hitman's InstallShield cabinet
was extracted with `unshield`; its component groups (`Engine_files`,
`Game_files`, and support groups) must be assembled into a separate launch VFS
matching the installer layout. Hype's ZIP self-extractor was opened with
`7z`; the complete data, sound DLLs, CRT/MFC and configuration/setup files were
retained. Extraction alone is not an installed/configured application, and
installer path/registry effects have not been evaluated. These are future
Glide 3 compatibility targets, not claims that the current Glide 2 frontend
can run them. In particular, same-name functions can have different stack
signatures between Glide generations.

### Unreal Tournament variant checked

`unreal-tournament-348-demo/UTDEMO348.EXE` was also acquired and the full
original ZIP payload extracted to `extracted/`. Its
`System/GlideDrv.dll` is **86,016 bytes** and imports **54 functions from
`glide2x.dll`**, including `_grSstWinClose@0` and
`_grTexDownloadTable@12`. It contributes **zero** to the new Glide 3 count.
No later renderer patch was substituted. Original game entry point:
`extracted/System/UnrealTournament.exe`; launch remains untested.

### SHA-256 checksums

| Package / renderer | SHA-256 |
| --- | --- |
| Hitman `Hitman.zip` | `16107fb6a82f6e3aab85faec164b68e64dd78ba813bc8145986dcea9611ecb93` |
| Hitman `Render3DFX.dll` | `f4a1041d7ad81f10a00121b6c060a3b14fe1dff4fd270f794be4ce429f491740` |
| Hype `hypedemo.exe` | `e1732ac80b51d916358b2ca4c331b1355c75bf882709fa90f688ce849a470982` |
| Hype `MaiDFXvr_bleu.exe` | `635f394121e50001227b97741dbf304f0a88f819c6f2ba2378cf61d9fa2a6344` |
| UT `UTDEMO348.EXE` | `59e65276c67af7859935d79001b93934928b3e1c3a8cc300807cdfa95208f708` |
| UT `GlideDrv.dll` | `f11c736d5425d95666dc232bbbc31bcdd42eec6dfa76fd448f1434ae03ad5f42` |
