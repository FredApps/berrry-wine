# Sid Meier's Pirates! (2004)

## Source and local fixture

The requested [oldyzach post](https://x.com/oldyzach/status/2105358263252402508)
names **Sid Meier's Pirates! (2004, Windows)**. Internet Archive searches for
Windows demo/shareware/trial copies did not establish a playable demo. The
1987 multi-game demo and 1993 Pirates! Gold demo are different games. Software
Informer's search result says “Free trial”, but its actual page labels this
game commercial and offers no download.

The default local candidate uses [this archived Windows ISO](https://archive.org/details/sid-meiers-pirates-pc-windows-iso):

- `Sid Meiers Pirates PC Windows ISO.iso`: 860,028,928 bytes; SHA-1
  `e7ba887ddaee4e7b81c612ea13c23261af18a1cc`.
- This is a community Inno repack containing GOG metadata, game ID
  `1445250653`, **not an authenticated original GOG installer**.
- English `digital/app/Pirates!.exe`: 3,323,288 bytes, product `1.0.2.0`
  (`30927`); SHA-256
  `6e88b90e4e2e30248d9e4de747b521cc03822b7ffeb214fd272b8ad1817447c9`.
- Its normal executable entry point is `0x005f09ac`; it does not enter the
  disc-driver bootstrap described below.

The recipe also retains [the archived UK disc](https://archive.org/details/pirates_202510):

- `PIRATES.iso`: 1,026,529,280 bytes; SHA-1
  `bfaadb137428c16d1e0df408d0f840a91df591d4`.
- The contents identify a later Sold Out DVD reissue, with 2008 support files,
  rather than an original 2004 pressing.
- `Pirates!.exe`: 4,712,406 bytes; product version `1.0.2.0`, string version
  `1, 0, 2, 0, (30927)`; SHA-256
  `e8b0effbac06f0eb347de1dcb9b0b21adbc6bd08c17a373b42bae246fd6e2d64`.
- Retail proprietary software, **not a demo**. All payload bytes and source
  media stay in ignored `test/binaries/candidates/pirates-2004/`.

Fetch and prepare:

```sh
node tools/fetch-candidate-corpus.js --id=pirates-2004
# Reconstruct both already downloaded source ISOs:
node tools/fetch-candidate-corpus.js --id=pirates-2004 --prepare
```

Preparation requires `7z` and `innoextract`. The recipe extracts the retail
ISO and its three standard MSZip cabinets, then uses
the MSI `File`, `Component` and `Directory` tables to restore **1,368 files**.
Cabinet member GUIDs are not filenames. `tools/msi-file-layout.js` rebuilds
the hierarchy, checks compressed payload sizes, and copies the loose EXE
unchanged. The MSI's EXE size is stale compared with the reissue's loose EXE.
The two VC7.1 runtime DLLs assigned to `SystemFolder` are staged app-local.
No installer custom actions are executed. Preparation can be repeated despite
the original cabinet's read-only `Logos.bik` attribute.

The second ISO contains `setup.exe` with two external Inno data files.
`innoextract --language english --exclude-temp` produces the default app tree.
The original DVD's `directx/DirectX.cab` supplies the genuine `dxdiagn.dll`.

The local `Config.ini` profile uses the game's own options: 800x600, minimum
water/world detail, normal shaders enabled, advanced lighting/shadows off, and
slow machine/intro-skip flags. Fully disabling shaders was also tested but
exposed unsupported fixed-function specular lighting, so it is not the chosen
profile. Mount it at the observed
`c:\My Documents\My Games\c:\Config.ini`: the game derives its profile
folder name from the executable directory, which is the VFS root here.

The local selector id is `pirates_2004`, labelled experimental. Its browser
inventory includes the installed companion files and is also used by the CLI.

## Startup evidence, 2026-10-01

**Experimental browser gameplay verified through sailing and a port visit.**
Both cooperative and Worker scheduling now reach gameplay. The candidate
honors the global Threads preference; no per-app cooperative override remains.
The WebGL path renders the title, main menu, new-game cinematic, Crew Signups,
tavern, sailing map and interactive town menu. The reduced-effects profile
gets beyond the initial default-graphics StretchRect crash, but a longer
Worker sailing route reproduced it after cast-off. The filtered-copy fix and
its validation are described below. Terrain shading remains
incorrect (white land). WebGL fixed-function specular lighting is implemented;
the native software lighting path remains separately limited.
The CLI software path
still has renderer failures. Corpus registration and title playback are not
a gameplay pass.

```sh
node test/run.js --app=pirates_2004 --no-close --quiet-api --quiet-blocks \
  --d3d9-renderer=software --memory-mb=1024 \
  --max-batches=6500 --batch-size=20000 --max-seconds=35
# Browser, with headless WebGL enabled:
node tools/profile-web-frames.js --app=pirates_2004 --swiftshader \
  --query='?debug&compile-wat' --warmup=15 --seconds=25 \
  --screenshot=build/pirates-2004/browser-gpu.png
```

An isolated compiled module and traces are in ignored `build/pirates-2004/`.
The measured module was passed explicitly with
`--no-build --wasm=build/pirates-2004/caps.wasm`.

1. Load the supplied `msvcr71.dll` and `msvcp71.dll` explicitly. Emulated CRT
   `setlocale` is insufficient for this executable's startup.
2. Game function `0x004ace40` uses DxDiag COM, CLSID
   `{A65B8071-3BFE-4213-9A5B-491DA4461CA7}`. Mount the real DLL under
   `c:\windows\system` and register its InprocServer32 path. The app-local
   DirectX registry version is `4.09.00.0904`; the global Win98 default
   `4.07.00.0700` makes the genuine diagnostic DLL report too old a version.
3. Device initialization at `0x005c0963` requires at least two texture blend
   stages and two samplers. `D3DCAPS9.MaxTextureBlendStages` (offset 148)
   was left zero despite the implemented six-stage fixed-function cascade.
   Report four alongside the existing four samplers, only when the renderer
   readiness probe succeeds. The app opts into that renderer profile.
4. Miles probes an optional `a3dapi.dll` COM server. The DLL is absent and
   should fail normally. `handleComDllYield` previously popped the stdcall
   frame without restoring EIP from its return address, retrying the thunk
   with corrupted arguments. Restore EIP and clear `*ppv` on failure.
   The same epilogue also exists in `lib/guest-worker.js`: the first fix missed
   that copy, so the normal Worker launch still exited with code 1 after
   spawning its Miles thread at `0x010bd4d0`. Fixing both copies gets Worker
   mode to the title and main menu. Two further problems initially left the
   last menu image visible: leaked exited Workers and a poisoned rendering
   queue. See the threaded follow-up below. Logs/screenshots:
   `worker-failure.log`, `worker-fixed.log`, `worker-menu.png`,
   `worker-after-enter.png` under `build/pirates-2004/`.
5. Browser with WebGL enabled reaches the animated title; screenshot
   `build/pirates-2004/browser-gpu.png`. It also exhausts 512 MB loading the
   menu, so the app enables the existing `bigMemory` allocation ladder.
   With 2 GB, `browser-big.png` shows the main menu. Clicking guest coordinate
   `(400,134)` selects Play and starts the new-game cinematic (`play-menu2.png`).
   Escape skips that cinematic to Crew Signups (`character-setup.png`);
   Enter accepts the default name and reaches the rendered tavern (`setup2.png`).
   A headless browser launched without
   `--swiftshader` has no usable WebGL and fails the DirectX device check.
6. Software CLI with 512 MB produces native allocation failures and later
   `std::bad_alloc` (`0xe06d7363`) after 5,508 batches. At 1,024 MB it runs
   for the 35-second limit but reports native raster validation failures and
   a render-heap retirement error. This route is not considered working.
7. Default graphics reaches the sailing map but traps at `0x0050bdaf`,
   call through Device9 vtable `+0x88` (`StretchRect`) at `0x0050bdc0`.
   It supplies rectangles and filter `D3DTEXF_LINEAR` (2); the original helper
   supported only whole-surface, same-size, unfiltered copies. Screenshot
   `after-crossing.png` is the first map frame, **not proof of playable sailing**.
   The reduced-effects profile initially gets around this path: normal shaders
   remain enabled; advanced lighting/shadows are off and water/world detail
   are minimum. `low2-crew.png` shows the live sailing view near Port Royale;
   the ship subsequently enters town (`sailing-turn.png`), selects Sail Away
   and “No matter, cast off!”, and returns to sea. Numpad 4 input was delivered
   while sailing; `sailing-before-turn.png` and `sailing-after-turn.png` show
   continued travel, with the date advancing from January 9 to January 16,
   1660. This final run uses the normal built WASM and has no OOM or unimplemented
   API trap. No StretchRect
   success stub or executable patch is used. Some draws still report
   unsupported fixed-function specular lighting; the terrain appears white.

## Threaded follow-up and performance, 2026-10-01

The first gameplay check used the profiler's cooperative default. The user's
ordinary Threads-enabled launch exposed the second COM epilogue described above.
Retesting the actual Worker backend then found:

1. `ExitThread` marks a thread exited synchronously inside its RPC. After the
   slice returns, `_runWorkerThread` used to return early on that state without
   calling `dropThread`. Pirates creates 134 threads during startup, mostly
   short-lived thread-slot-5 workers at `0x00afa4f6`; their Workers remained
   alive. Retire them **after** the slice reply, preserving DLL detach cleanup.
   The same startup now leaves four live Workers. The scheduler regression
   fails before this fix and passes afterwards (55 checks).
2. WebGL rejected the first lit-specular draw. In cooperative rendering this
   can reject an individual draw; the asynchronous Worker render queue records
   the error and refuses subsequent commands. A still-visible menu therefore
   did not establish an input deadlock. Subsequent draws repeatedly decoded
   textures and reported the same queue error. One diagnostic counted over
   159,000 repeated errors; the stalled screen was unchanged across 22 probes.
3. `lib/d3d9-fixed.js` now implements the actual
   [D3D9 specular lighting equation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/specular-lighting):
   halfway vector, local/infinite viewer, material/vertex color selection,
   material power, directional/point/spot lighting and attenuation. No error
   bypass or queue reset is used. The existing all-zero attenuation fixture
   also exposed a WebGL/native mismatch; WebGL now uses constant attenuation 1.
   Both WebGL versions pass 102 lighting pixel cases. The native software
   specular implementation is outside this change.
4. The fixed Worker run renders new-game tavern/selection, English sailing
   near St. Kitts and its town menu without a recorded bridge error. Evidence:
   `worker-specular-start.png`, `worker-specular-captain.png`,
   `worker-specular-steer.png`, `worker-specular.log`. White terrain persists.
5. A longer Worker route (`worker-final.log`) sailed from Barbados, selected
   “No matter, cast off!”, then trapped in `StretchRect` at `0x0050bdaf`
   while steering. `final-sailing-before.png` shows sailing; the after image
   is the desktop after the trap, not successful steering evidence.
   `src/09am-d3d-color.wat` now captures source/destination rectangles, waits
   for actual source readback, performs native BGRA8 POINT/NONE or bilinear
   LINEAR resampling, and uploads only the destination rectangle. Both waits
   preserve the stdcall frame and captured arguments. The renderer reports
   the corresponding POINT/LINEAR filter capabilities.
   Direct and asynchronous Worker pixel cases cover up/downscaling, source
   edge clamping, untouched exterior pixels, invalid calls, implicit
   backbuffer source/destination, and caller mutation during suspension.
   These pass (`stretch-tests-4.log`). The broader color-surface test later
   fails an existing Worker `UpdateSurface`/Present pixel assertion, also
   reproduced with all new StretchRect calls removed (`stretch-baseline.log`).
   Adapter capability assertions pass before its existing parent-reference
   assertion fails (3 versus 2, `stretch-caps.log`).

Headful Chrome used the real GPU for profiles (no SwiftShader). These samples
were taken on a heavily loaded laptop and establish cost centers, **not** a
controlled speedup or a 60-FPS gameplay claim. Before the lighting fix, the
20-second stalled sample spent 4,087 ms of page self time in texture decoding
and 1,008 ms reporting errors. In the subsequent live sailing/town sample,
the screen changed in 21/22 probes; page busy time was 4,795 ms, including
1,568 ms in command-stream payload copying. The main guest Worker spent
3,026 ms sampled in `waitForResponse`. Cross-thread transfers and copying are
remaining performance targets. The profiler's ~60-Hz rAF number describes
browser refresh, not guest frames. Raw profiles are in
`build/pirates-2004/worker-retired-profile/` and `worker-specular-profile/`.

A same-scene residency diagnostic at the tavern tested 32/128/32 MB, with
3 seconds settling and 15 seconds measurement per interval. Completed D3D9
presents were 113/139/132; submitted draws were 3,943/4,833/4,617. **All three
uploaded zero texture bytes** and held 32,778,992 resident bytes. The apparent
rate gain did not reverse with the budget, so this does not support a cache
optimization. The original 32 MB budget is retained. Earlier hundreds of MB
of uploads included scene loading, not steady-state cache thrashing.

The unrelated native software cache test currently fails its asynchronous
cache-admission assertion at `test/test-d3d9-fixed-cache.js:72`; that test does
not load the modified WebGL compiler. The WebGL TL plan-cache, Worker scheduler,
threaded I/O and render endpoint lifecycle tests pass.

### Wind-down checkpoint, 2026-10-01

The isolated final run loaded canonical module
`7c5f97f5ba26f556c4fbeebbee40519851295a6e66b0f5f8a2df985fc71689af`
(1,653,718 bytes), confirmed through `WINE_WASM_IDENTITY`, with the actual
Worker backend. It reached Crew Signups, the English captain, Port Royale,
Sail Away and cast-off. Captures `isolated-sailing-before.png` and
`isolated-sailing-right.png` show travel from January 11 to February 3, 1660,
after numpad-right input. A live read reported four Workers, no bridge error,
and 323 completed D3D presents in 57,588 ms (about 5.6 FPS on this busy host).
This is an observation, not a controlled speedup. The transfer counter was
empty: **this particular route did not exercise the new StretchRect path**.
Its pixel tests pass, but in-game use still needs explicit verification.

The subsequent 30-second CPU profile ended at the landing-party prompt after
left-turn input. Its unchanged image is a modal checkpoint, not a crash;
the sample is **not a sustained-sailing FPS measurement**. Page busy time was
10,237 ms, including 3,101 ms in command-payload copying. The report expression
returned an object which the harness printed as `[object Object]`, losing its
final counters. Use `JSON.stringify(...)` for the next report expression.
The harness then closed normally; late `ctl` evidence calls timed out after
closure and their empty JSON file must not be treated as evidence.

Raw profiles/logs are under `build/pirates-2004/worker-stretch-isolated-profile/`
and `worker-stretch-isolated.log`; reviewed captures are bundled in
`scratch/runs/20261001-pirates-worker-sailing-after/`. WebGL independent
color-surface checks also pass 39/39 cases on both versions. The earlier
source-build browser disappeared midroute (the profiling helper kills all
browsers sharing its global prefix); `build/pirates-2004/profile-isolated.js`
is a generated diagnostic copy with a distinct prefix and corrected root.
Its parent was temporarily SIGSTOPed to extend the manual route deadline,
then SIGCONTed after creating the gate file; it is now terminal.

User-requested coordinator handoff:
`ops/handoffs/01a0f736-78f1-7822-8b37-159d6f8ed94d.md`.
No further experiments were started after the explicit handoff request.

## Original disc executable investigation

1. Original entry point `0x008f906e`, image base `0x00400000`. The wrapper
   resolves kernel APIs from `0x008f7f75`. Missing `WriteProcessMemory` made
   `GetProcAddress` return zero; the wrapper called `ExitProcess(1)` immediately.
2. Adding the real current-process `WriteProcessMemory` handler advances past
   that failure. It checks source read and destination write permissions over
   the full spans, reports bytes written, rejects foreign handles, and uses
   the existing guest memmove/code-invalidation path. Calls from the loaded
   temporary module at `0x00eb9a82` now write their requested 64-byte blocks.
3. Win98 path: bootstrap extracts and loads `~df394b.tmp`, then traps at
   runtime `0x00e5f11e`, bytes `0f 01 4d c4` (`SIDT [ebp-0x3c]`). Adjacent
   code contains `CLI`/`STI` and descriptor manipulation. This is not a D3D
   rendering failure. Trace: `api-wpm.log`.
4. `--winver=win2k` avoids that Win9x path, extracts `SECDRV.SYS`, tries
   `\\.\Global\SecDrv` and `\\.\SecDrv`, fails both device opens, and exits
   with code 1. Trace: `api-nt.log`. The emulator does not host that kernel
   driver. This also establishes why changing only the reported OS is not
   a solution.

The default digital payload avoids this bootstrap. No executable patches or
successful device replies were substituted for the missing disc driver.

## Validation

- Both archived ISO hashes and the digital EXE hash were verified. The
  original loose/installed EXE comparison also passed.
- Combined ISO/MSI/Inno/DirectX preparation and repeat preparation passed.
- COM loader failure tests pass, including return EIP, stack cleanup and
  null interface output. Six-stage fixed-function cascade pixel tests pass.
- `test/test-worker-guest.js` passes, including the frozen real-Worker COM
  failure frame: HRESULT, caller EIP, 24-byte cleanup and cleared interface
  output. Its existing Win32/Win16, input and Winamp thread checks also pass.
- Concurrent WGL current-context/DC query tests pass; their two real
  straight-line queries required a reviewed silent-handler inventory re-pin
  before the normal local build could proceed.
- Adapter caps assertions pass before the existing parent-lifetime assertion
  fails (`3 !== 2`); running the unchanged HEAD test against the same source
  reproduces that failure, independently of the caps change.
- `test/test-pointer-probes.js` passes, including WriteProcessMemory success,
  output count and stdcall cleanup, cross-page copies, no partial writes,
  unreadable sources, read-only destinations, invalid handles and bad output
  pointers.
- API append-only, generated dispatch, handler stack cleanup, WAT duplicate
  ratchet and changed-fragment syntax checks passed. Full `bash tools/build.sh`
  passes, producing the normal and compatibility WASM artifacts.
- Candidate survey `--dry-run --id=pirates-2004` finds the executable. This
  checks fixture availability only.
- The registry row and the static `index.html` Local Candidates option both
  name `pirates_2004`; the profiler previously needed to inject the missing
  selector option, which is now part of the normal launcher.
- Whole-registry validation reports pre-existing missing Baldur's Gate demo
  and Snood fixtures; it reports no missing Pirates candidate asset.
