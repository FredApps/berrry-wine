# Black & White 2 demo

## Input and extraction (2026-09-09)

`test/binaries/win98-games-a-d/Black and White 2-DX9-D3D.exe` is the
647,216,200-byte Black & White **2 demo** InstallShield 11 self-extractor.
It is not the original Black & White game.

The outer payload starts at file offset `0x1c200`. Each entry is four
NUL-terminated ASCII fields (basename, `Disk1\\...` path, version, decimal
byte length), immediately followed by exactly that many uncompressed bytes.
Walking nine entries ends exactly at EOF. Measured with `xxd` and a bounded
field walker against the input, not guessed from cabinet signatures:

| Entry | Data offset | Bytes |
|---|---:|---:|
| data1.cab | 115243 | 36286822 |
| data1.hdr | 36402105 | 58374 |
| data2.cab | 36460523 | 609467787 |
| engine32.cab | 645928357 | 543481 |
| layout.bin | 646471878 | 559 |
| setup.exe | 646472483 | 121064 |
| setup.ibt | 646593588 | 395955 |
| setup.ini | 646989581 | 480 |
| setup.inx | 646990102 | 226098 |

`unshield l data1.cab` lists 416 files when its matching header is beside it.
Extraction also needs **data2.cab**. Earlier `/private/tmp/black-white-seed2`
emulator overlay contains data1.cab/hdr but **omits data2.cab**; it is therefore
not a complete installation source. `7z` cannot open the outer EXE.

The game EXE is `MainApp/BW2Demo.exe`, 20,656,128 bytes. The largest asset is
`MainApp/Data/Everything.stuff`, 432,577,472 bytes. Other file groups provide
English speech/text, splash textures, credits and the readme. DirectX support
includes `Apr2005_d3dx9_25_x86.cab`. Inspect actual imports with:

```
node tools/pe-imports.js PATH/MainApp/BW2Demo.exe --all
```

## Installer investigation

The direct extracted setup needs all three runner arguments:

```
--exe=PATH/setup.exe
--exe-guest-path=c:\windows\temp\byep1.tmp\disk1\setup.exe
--cwd=c:\windows\temp\byep1.tmp\disk1
--args=-deleter
```

Use `--quiet-api --quiet-blocks`. Positional EXE arguments are ignored by the
runner; omitting the guest path searches for engine32.cab in the wrong place.
Dialog control sequence: wait 710, click 1; wait 1000, click 1000 and 1;
wait 718, click 1; wait 711, click 1 (Install).

Loading `isprobe.tlb` imports stdole2. Registering and mounting its raw MSFT
type-library data removes the measured `TYPE_E_CANTLOADLIBRARY 0x80029C4A`.
This does **not** establish installer success. The following failure jumps
through zero at iuser original VA `0x10001d7c`: an AddRef indirect call where
EDI points to ASCII GUID-path data, not an object. Runtime iuser base in these
runs is `0x01d2f000`, original base `0x10000000`.

`iuser+0x10003391` receives the pointer and forwards it via `0x100010cb` to
the AddRef helper `0x10001d6f`. Cause is still unproved: argument marshalling,
pointer lifetime and unsupported COM behavior remain possibilities. Earlier
claims that the Win98 OLEAUT library lacks these standard automation helpers
were speculative and must not be used as evidence for native overrides.

## Direct executable startup

The complete extraction is currently `/private/tmp/black-white-full.ntZDCF`.
`unshield -d extracted x data1.cab` succeeded for all 416 files. The DirectX
cabinet's `d3dx9_25.dll` was extracted beside `MainApp/BW2Demo.exe` with `7z e`.
Game launches use `--vfs-include='**/*'` and explicit `--dll-seed=` paths for
d3dx9_25.dll, binkw32.dll and dbghelp.dll; the ordinary DLL graph supplies CRT
dependencies. English supplemental groups have provisionally been copied
into MainApp's Data, Audio and Data/Art/Textures folders (verify filesystem
traces before treating these destinations as established).

The executable enters real startup code. CPU gaps observed, in sequence:

- `0x00b65de8`: **F3** 0F59, MULSS (not MULPS).
- `0x0040b656`: UCOMISS followed by LAHF and parity tests.
- `0x006013e0`: scalar division during startup object construction.

The runner's crash EIP can point **after an instruction prefix**. Always
disassemble from a known preceding instruction/function entry: disassembling
at reported EIP `0x00b65de9` falsely labels the opcode MULPS. ADDPS/MULPS were
already implemented in dc7bc157. Scalar arithmetic and UCOMISS are being added
with `test/test-sse-scalar.js`; no SSE feature bit is advertised yet.

The stale region-owner anchors were resolved by the shared integration lane.
Use paired current artifacts: `tools/build-compile-wat.js --out=...
--compat-out=...`, then `--no-build --wasm=...`; do not mistake an older
build/wine-assembly.wasm for current sources. No gameplay has been verified.

## Programmable renderer implementation

The direct game reaches a fatal pixel-shader 1.1 capability check after
creating its LIONHEAD window in the default profile. The experimental
`?d3d9-programmable` profile enables real shader/texture/buffer rendering after
a GPU pixel probe. No game patch or capability-only bypass is used.
See `apps/direct3d9.md` for the extension to the existing graphics design.

Real WAT shader objects/constants, guest texture mip storage/level surfaces,
vertex/index buffers, locking/binding/lifetime and programmable UP/buffer
draws now lower through the shared GPU backend. `test-d3d9-pipeline-web.js`
checks completed canonical BGRA frames, INDEX16 rebasing, INDEX32 above65535,
signed base-vertex offsets and locked/range rejection. These synthetic
rendering passes do not establish game menu or gameplay compatibility.

The genuine browser run with that profile gets past the shader check and
traps at `0x009343b4`: the following call at `0x009343c4` is
`[device-vtable+0xf4]`, **EndStateBlock** (slot61). Return address is
`0x009343ca`; device pointer `0x07f07030` in the measured run. The immediately
preceding sequence records render states via slot57 (`+0xe4`). Logs label
these COM thunks `<ord>`; disassemble the caller to identify the actual slot.
Selective render-state block recording/Capture/Apply is now implemented and
unit-tested; other recording categories fail explicitly until implemented.

Subsequent genuine browser runs advanced through these measured gaps:

- `0x0093459e`, slot69 `+0x114`: SetSamplerState during recording.
- `0x00934664`, slot65 `+0x104`: SetTexture during recording (initial null bindings).
- `0x0093468f`, slot44 `+0xb0`: SetTransform, texture matrices16..23.
- `0x00936a09`, slot22 `+0x58`: GetGammaRamp for implicit chain0.

Selective sampler, internally retained texture bindings and immutable matrix
copies now Capture/Apply without changing live state during recording. Tests
cover replacement/release, caller-memory reuse and independent matrix slots.
Gamma has copied per-device API data, with display capability still disabled.
The initial WORD ramp is0..255 per Microsoft's "Using gamma correction" note,
not0..65535; the game's following loop multiplies each WORD by255.
No menu or gameplay has yet been reached. Probe logs live under
`/private/tmp/black-white-*-probe.log`; the probe uses the genuine extracted
assets and only the opt-in real GPU capability profile.

Native D3DX then records vertex declarations at original`0x0051b0a1`
(`+0x15c`,slot87) and vertex float constants at`0x005121be`
(`+0x178`,slot94). Measured DLL base`0x02528000`, original`0x00400000`;
runtime failures`0x02643099`/`0x0263a1ac`. Declaration/shader references and
per-register float constant state blocks now have lifetime/overlap tests.

The next real failure was ReadFileEx at`0x00b532be`. It reads175104 bytes
from Everything.stuff offset102306304 into`0x4c550000`; OVERLAPPED at
`0x4fda0300`, callback`0x00b53100`. The callback uses hEvent as a private
context pointer, which must remain untouched. Positional VFS reads now preserve
the shared file cursor and queue completion on the calling WAT instance for
SleepEx/WaitForSingleObjectEx alertable delivery. Lazy residency currently parks
submission through existing IO_WAIT before queueing; this is not fully
asynchronous provider scheduling. Other APC/cancellation APIs remain unsupported.

First integration hung at`0x00938963` in the texture-loader polling loop.
Passive callback count stayed0 despite SleepEx(0,TRUE) and completed bytes.
Cause: inline CALL-reg dispatch overwrites redirected EIP unless steps=0;
handler_set_eip only protects the outer thunk-zone path. The APC continuation
now sets both, and test-read-file-ex includes an actual x86 CALL-reg regression
(the original direct-handler callback test did not exercise that path).

WIP checkpoint: the genuine browser run now advances beyond that callback to
native D3DX at runtime `0x025f6e12` (original `0x004cee12`), with `EDX=0x31545844`
(`DXT1`). This next texture-loading failure is not yet diagnosed. No menu or
gameplay has been verified.

Continuation: disassembly identifies that call as device slot6 GetDirect3D
(`call [eax+0x18]`), not a DXT decoder failure. Parent identity/AddRef and
device-owned lifetime now have compiled tests, along with the subsequent
GetDisplayMode/GetCreationParameters queries. Genuine browser execution passes
this point and reaches D3DX original `0x0051b59e`, runtime `0x0264359e`, whose
`call [ecx+0x10c]` is slot67 SetTextureStageState during state-block recording.
Eight stage rows and selective recording/restoration are being implemented;
fixed-function visual conformance remains unverified.

Stage recording now passes compiled tests and genuine D3DX execution. The next
CPU trap was `F3 0F 2A C0` at `0x00a6bb7f` (CVTSI2SS xmm0,eax). Both GPR and
memory-source forms now convert signed i32 with default nearest-even rounding
and preserve the upper96 XMM bits; 80-case scalar SSE suite passes. MXCSR
rounding/exception state is still not modeled by this SSE subset.

Next D3DX original `0x00429fc1`, runtime `0x02551fc1`, calls device slot38
GetRenderTarget (`+0x98`) then surface slot12 GetDesc (`+0x30`). The getter now
returns the existing render target through its stable Surface9 wrapper with a
caller reference; GetDesc reports the canonical surface dimensions/format.
Compiled identity/reference-count/output-boundary tests pass.

The genuine run passes those queries, then a native DLL at `0x037bca25`
requests ConvertDefaultLocale(LOCALE_USER_DEFAULT=0x400). API3355 now converts
the user/system aliases to the existing emulated en-US locale and preserves
other identifiers and LastError. Thread-locale regression verifies this is
independent of the caller's SetThreadLocale setting.

Further startup continuation (2026-09-09):

- D3DX original `0x0042c58d` requests GetFontLanguageInfo. The API now derives
  legacy kerning/codepage flags from the selected font's actual tables;
  stock bitmap fonts report no shaping flags. Public GDI regression passes.
- Game `0x00937040` requests CreateQuery(EVENT=8). A retained Query9 object now
  implements identity, lifetime, Issue(END) and GetData. Issue uses a real
  synchronous GPU completion barrier; no asynchronous polling performance is
  claimed. Unsupported query kinds return NOTAVAILABLE. Compiled API tests and
  the genuine browser GPU pipeline test verify the barrier and rendered pixels.
- An apparent normal exit was actually a null indirect call at `0x0051f024`:
  GetProcAddress(AddFontMemResourceEx) had returned zero. The game decrypts an
  embedded font into temporary memory, registers it, then frees that buffer.
  Memory font APIs now copy single-face glyf TrueType data into the existing
  face cache, select it privately without enumeration, and unregister by a
  validated handle. Removed faces remain in the existing bounded process cache
  for live realizations; cache eviction, TTC and CFF are not implemented.
  Tests overwrite the source and rasterize the retained copy.
- Next apparent exit was a missing suffix in LoadLibrary's lookup of
  `.\\PlugIns\\ScriptLibraryR`. The supplied DLL already exists in the asset
  manifest. WAT now appends `.dll` when the basename has no extension, and
  honors trailing-dot suppression. The real DLL loads at `0x03801000` and its
  script exports resolve; no script-engine substitute is used.
- Next CPU trap `0x005fdde2` is the prefixed instruction starting at
  `0x005fdde1`: `F3 0F 2D C1`, CVTSS2SI eax,xmm1. Register and four-byte memory
  forms now implement default nearest-even conversion with the x86 indefinite
  integer for invalid/overflow values. The scalar suite passes104 cases.
  Non-default MXCSR modes remain outside the current SSE subset.

Diagnostic logs: `/private/tmp/black-white-exit-trace.log`,
`black-white-memory-font.log`, `black-white-script-library.log` and
`black-white-cvtss2si.log`. All use the genuine extracted files and the explicit
programmable-GPU profile. Menu and gameplay are still **not verified**.

The local Microsoft `binaries/explorer98/dlls/ole32.dll` (4.71.2900) identifies
CoFileTimeToDosDateTime as ordinal23, VA`0x7ff8b556`. Disassembly validates an
8-byte source and two 2-byte output pointers, then calls KERNEL32's
FileTimeToDosDateTime via IAT`0x7ff213a8`. BW2 imports this **by name**; hint25
is not its ordinal. The new wrapper follows that delegation, with compiled
date-range/leap-day/output-boundary/invalid-pointer tests. Genuine startup now
passes `0x0091ee3c`, starts its worker threads and loads additional resources.

Next missing import is GetKeyNameTextW at`0x0064b860`. The bounded UTF-16 wrapper
shares the existing ANSI US scan-code names and has truncation/terminator/ESP
coverage. It inherits that mapper's incomplete extended-key/localization scope;
this is not a complete keyboard-layout implementation. Current diagnostic logs
are `/private/tmp/black-white-co-filetime.log` and `black-white-key-names.log`.

The key-name run passes that initialization and reaches D3DX runtime
`0x025fa277`, original`0x004d2277`. The call at original`0x004d2294` is
`call [esi+0x64]`: device slot25 **CreateCubeTexture**, not another 2D texture
getter. Measured size128, levels1, format21 (A8R8G8B8). Cube resources and cube
sampling are not implemented: the shader compiler currently declares only
sampler2D, and the shared GPU texture interface only uploads TEXTURE_2D.
Next work must cover six face/mip stores, CubeTexture9 identity and surface
aliases, plus cube sampling through the shared backend with pixel tests.
Do not alias a cube to one 2D face or advertise cube support before that works.

Cube continuation (2026-09-09): APIs3369..3390 now implement the 22-slot
CubeTexture9 interface (private-data/autogen operations still fail loudly).
Six independent face/mip stores share locks with retained Surface9 aliases.
The shared GPU backend supports cube upload/binding; shader TEX specialization
uses the bound resource type. Compiled storage/identity/lock/lifetime tests and
actual browser pixels pass for all six faces, lower LOD, return to 2D, and
mixed 2D/cube samplers in both orders. Default shader capabilities are unchanged.

The genuine run now passes cube creation and finishes Greek model preloading.
It then stops at EIP0, without ExitProcess: captured stack return0052679a
identifies game00526795 calling0091ec50, whose tail jump reads a null file
object at +4 then its vtable slot12. The preceding file-open operation requests
data/art/textures/logo.png, which exists in the extracted MainApp tree.
Its open/allocation failure is not yet diagnosed. The trace also contains many
DXT1 (31545844) and DXT5 (35545844) CreateTexture requests; those formats remain
unimplemented and are rejected, not silently accepted. A late ReadFileEx has a
null destination, suggesting allocation pressure, but that is not yet a proven
cause of the logo failure. Logs: /private/tmp/black-white-cube.log and
black-white-cube-stop.log. No menu or gameplay has been verified.

The focused file-loader trace resolves that failure: CreateFileA returns
700000bc and GetFileSize returns00060af6 for logo.png. CreateFileMappingA
returns fb000078, but MapViewOfFile returns0 at00925086. At exit the live map
count is410 and backing cursor1bffa000 is only24KiB below its1c000000 limit.
That is backing exhaustion, not a missing path or DLL export.

Mapping lifetime audit found UnmapViewOfFile deleting JS view metadata without
releasing its guest allocation; failed async provider fills leaked unpublished
allocations too. The matching guest_map_free export now releases those sparse
views (not HeapFree), and invalid/double unmaps fail. Non-top virtual releases
leave holes, so the commit allocator now searches live backing extents for a
non-overlapping gap only when the bump cursor cannot satisfy a request.
It preserves live addresses and the high-water cursor and zeroes reused bytes.
Tests cover1100 real map/release cycles, non-top gap reuse, retained live bytes,
consecutive non-overlap, writeback, async failure cleanup and cross-instance
reservations. The fixed512MiB total /320MiB backing layout is unchanged.

Diagnostic caveat: black-white-unmap.log and black-white-map-reuse.log still
used the preceding compiled browser artifact; they are not post-fix acceptance.
The canonical rebuilt pair is1072381/1072841 bytes; the follow-up run is
/private/tmp/black-white-map-reuse-built.log.

The rebuilt run **passes** the logo map:00925086 returns385a0000, then native
D3DX processes PNG data. At the next stop there are130 live mappings totaling
169906176 bytes (about162MiB); no memory-layout expansion was needed.
New stop00526cf0/return00526d1d is call [ecx+0xc0] at00526d17,
device slot48 GetViewport. Viewport now has real24-byte Get/Set state,
initial full-target dimensions, bounds/depth validation, and immutable GPU draw
snapshot lowering. The browser pipeline verifies default values, preserved
state after an invalid setter, cropped rendering, and untouched outside pixels.
Viewport state-block recording remains explicitly unsupported.

Viewport continuation reaches D3DX original0042aa4a (runtime02552a4a):
device slot79 SetNPatchMode(0) while recording the sprite state block.
The old recording guard trapped even on disabled mode; the old getter also
incorrectly returned its FLOAT in EAX. The linear-only backend now accepts
disabled mode (+0/-0), including recording, rejects every nonzero/NaN request
with NOTAVAILABLE, and returns GetNPatchMode through x87 ST(0). This does not
implement or advertise N-patch tessellation. State-block and FLOAT/ABI tests
pass. Diagnostic log: /private/tmp/black-white-npatch.log.

The next sprite-recording calls are SetIndices(NULL) at D3DX0042ac53 and
SetStreamSource(0,NULL,0,0) at0042ac63. Both now use real selective state-block
buffer capture rather than the previous recording guard: last write wins,
stream offset/stride are copied, retained buffer references transfer and
release correctly, and invalid writes preserve prior recorded state.
Compiled tests cover non-null replacement, Capture/Apply and release lifetime;
this is not a NULL-only bypass. Build1073008/1073468 passes canonical gates.

The subsequent black-window loop actually calls SetVertexShader(NULL) and
SetPixelShader(NULL), followed by DrawPrimitive and DrawIndexedPrimitiveUP.
Those were rejected before GPU submission. The new bounded fixed-function
compiler consumes real state snapshots through the shared GPU backend; no
failed guest shader is replaced. WAT-to-browser tests verify world translation,
textured diffuse modulation, POSITIONT coverage and alpha rejection. Build
1072939/1073399 passes the canonical gates; state-block regressions also pass.
The first run (/private/tmp/black-white-fixed.log) still has a black final frame,
with missing-texture and incomplete-mip-chain errors. Two follow-up corrections
implement documented null-COLORARG1-texture cascade termination and one-level
LOD clamping (non-mip filtering, not generated texture data). Pipeline tests pass.
Fresh follow-up log: /private/tmp/black-white-fixed2.log. Gameplay is unverified.

The error-free follow-up remains black. Observational draw snapshots identify
a raster bug: TL/TR/BL POSITIONT strips (white diffuse, valid viewport, z0,
cull3) write zero colored pixels. The backend selected GL_CCW as its front
face, discarding the clockwise sprites D3DCULL_CCW must keep. It now selects
GL_CW; browser regressions explicitly verify both culling modes on the same
screen-space triangle. Genuine follow-up: /private/tmp/black-white-culling.log;
indexed-sprite snapshots are being checked too. No menu acceptance yet.

Corrected-culling snapshots confirm480000 colored pixels in800x600 after
the loading strip, and later indexed sprites write pixels too. Completed
presentation canvases also contain480000 colored pixels while the whole-window
screenshot is black (/private/tmp/black-white-presentation.log). Renderer
exclusive composition skips windows with no _backCanvas; this GPU-only client
does not request a GDI canvas. D3D9 bridge initialization now asks the existing
renderer.getWindowCanvas owner to create that normal backing once. It does not
create another compositor or reuse the live GPU context as a window surface.
Pipeline regression verifies that acquisition; genuine follow-up is
/private/tmp/black-white-compositor.log.

That backing acquisition alone does not fix display. The remaining concrete
notification bug is D3D9 Present assigning renderer.needsRepaint, which no
renderer code reads. Present now calls renderer.scheduleRepaint, preserving
the normal deferred/Worker-safe publication path. Pipeline tests assert exactly
one compositor scheduling request per completed Present. Fresh window probe:
/private/tmp/black-white-repaint.log. The earlier backing-only explanation was
incomplete; neither a colored GPU buffer nor a Present count proves display.

The corrected repaint run visibly renders the genuine Lionhead Studios particle
intro. Screenshot personally inspected:
/private/var/folders/dz/1fqkk_jd4350qkm91pm9_q3c0000gp/T/black-white-browser-DqPoHR/frame-3.png.
This is the first verified visible game-rendered scene, not gameplay or a menu.
The probe now accepts explicit timed browser key/click inputs (BW2_INPUTS);
the next run sends Escape at50/70 seconds to attempt normal intro skipping.
Log /private/tmp/black-white-menu.log; no guest-state patching.

Escape/Space and a real browser click do not skip the intro in180-second probes;
the particle animation is still visibly advancing (npCxjk/final.png). Keyboard
events log hwnd0 whereas mouse events target10001, so skip-key delivery is not
yet proven. Do not classify an animating slow intro as an infinite loop merely
from elapsed wall time. DXT1/DXT5 are now real compressed sampled resources:
block-row allocation/pitches/locks and small mip tails stay compressed, while
the upload snapshot decodes RGB565 and alpha selectors. CPU/compiled tests and
WAT-to-GPU pixels pass. A concurrent authorized main merge preserved the dirty
work and changed the base layout; canonical build now1073704/1074165,
layoute5ea7699f58899e4,source306. Fresh420-second run:
/private/tmp/black-white-dxt.log. No menu/gameplay claim.

The intro loop is005260e0, per-frame simulation/render00526cf0. It increments
object+20 once per frame; object+0 becomes636 in the observed run. At00528141
the fade starts only after frame > target+350, then object+28 rises until >255;
00529421 sets object+24 = currentFrame+500, and0052943b returns completion only
after that frame. Escape is not tested by this loop; mouse and arrow keys alter
its particle interaction instead. This is a frame-count animation, so a few FPS
means many minutes. Read-only BW2_INTRO_TRACE captures the object from ESI at
00526d93, avoiding a hard-coded guest stack allocation.

However,420-second runs stop submitting frames at1000 (DXT run) or953
(counter run, introFrame918, target636, finishFrame-1, completion0). CPU still
executes00868xxx/008c6xxx animation evaluator code. That is not evidence that
the intro returned; the earlier beyond-intro inference from EIP alone was
premature. A600-second follow-up includes calling-stack observations:
/private/tmp/black-white-intro-stack.log. No runtime clock or game state patched.

The600-second stack run stops at introFrame655. Actual saved return addresses
0052618d and00526198 put execution in the100ms catch-up loop, not intro teardown.
GetSystemTimeAsFileTime was multiplying ticks by10000 and adding the epoch using
i32 arithmetic, then writing a constant high DWORD. Consequently its reported
time jumps backwards whenever the low DWORD wraps (~429.497 seconds); the game's
unsigned elapsed-time loop then attempts an enormous number of updates. The API
now uses an unsigned tick extension and i64 multiply/add/store, preserving the
existing simulated epoch and clock source. test-system-filetime covers the exact
first carry boundary, subsequent carries, signed tick bit, one clock sample,
output bounds and stdcall. It passes, as does the corrected real-device NULL
shader test. No guest clock scaling, animation counter or binary patch is used.

BW2_INTRO_TRACE also counts catch-up iterations00526185 vs render-loop0052619d
and samples the game's elapsed milliseconds0177cb18. This can distinguish normal
slow animation from a new enormous-delta catch-up. Keyboard hwnd0 is the renderer's
normal key-event route, not evidence of an input-routing fault; this intro does
not check Escape. A fresh long run is needed to establish progression after the
FILETIME fix; no menu/gameplay acceptance yet.

## Software-worker launch integration (2026-09-10)

The first current-source software CLI probes use all MainApp assets and the
three explicit DLL seeds above, `--d3d9-renderer=software --d3d9-programmable`,
`--batch-size=200000 --real-ticks --max-seconds=45`. Diagnostic artifacts are
`/private/tmp/bw-software-integration.DqstAK/wine.wasm` and its compat pair
(1098688/1099156 bytes, layout f73bfdc3f7f38137). They compile current sources;
the full canonical build still stops at unrelated stale toy-VM browser bundles.

Both ordinary and trace-yield probes stop after 288 batches with `STUCK` at
thunk07503488, return00a4da46. Disassembly confirms call00a4da40 is device
slot81 DrawPrimitive (`+0x144`), triangle strip5, start0, count2. The CLI stuck
detector lacks an exemption for outstanding render waits, although it exempts
controlled sessions; consequently the passing controlled worker smoke does not
prove ordinary launch behavior. A scheduler correction and uncontrolled test
are in progress. This observation does not prove a worker deadlock or gameplay.
Logs are `run.log` and `scheduler.log` in that diagnostic directory. A bounded
follow-up raises only the diagnostic `--stuck-after` threshold to1000000;
`extended-wait.log` will distinguish a false stop from actual renderer errors.

The raised-threshold follow-up does continue submitting real draws. It reports
`D3D9 software: only bounded triangle lists are implemented`, followed by
`D3D9 software: blending is not implemented`. These are explicit renderer
implementation gaps, not a silent successful rendering path. Strip/fan
normalization is now the next adapter task; native blending remains required.
This progression supports the false-stop diagnosis, but no visible gameplay
has been verified.

Strip/fan and native blending integration follow-up:
`/private/tmp/bw-blend-integration.FJ1QzJ/wine.wasm` (1100883 bytes) and its
1101351-byte compat pair compile the new native blend stage and defaults.
`run.log` no longer reports the strip/blend rejections, but the personally
inspected 800x600 `frame.png` is solid white. That run reaches its100000-batch
limit; its CLI summary prints the configured60-second budget as elapsed time,
so the summary must not be used as a performance measurement.

`timed.log` instead uses100000000 max batches and a45-second wall guard, plus
the diagnostic raised stuck threshold. Its more precise backend error is
`fixed-function features are not implemented: alphaTest` (14 occurrences),
not lighting/fog/specular. It starts five guest worker threads. `timed.png` is
byte-identical to the inspected white frame. Alpha testing is the next native
pipeline task; this is not menu/gameplay acceptance. Software triangle, blend
and worker unit results alone did not predict this real-game blocker.

Alpha-test integration follow-up: current-source diagnostic pair
`/private/tmp/bw-alpha-integration.jT7BVd/wine.wasm` and `.compat.wasm` are
1101235/1101703 bytes. The45-second wall-guard run ends at309117 batches with
no renderer error lines. Both programmed and NULL-shader draws now receive
native alpha-test state; a low8 reference and comparison are copied before
execution and applied before color/blend/depth writes. The personally inspected
800x600 `frame.png` is predominantly white with one faint yellow spot near the
lower center, rather than the preceding completely white frame. This proves
changed rendered output, not recognizable intro completion, menu or gameplay.
The same five guest workers are present. Logs remain in that directory.

Ordinary CLI wait follow-up: `normal-wait.log` in the alpha-integration directory
uses the same assets/build and no `--stuck-after` override. After the live render
request exemption, it reaches the20-second wall guard at312228 batches without
STUCK. Stats now reports measured execution20.009s rather than a configured
deadline. `test-cli-elapsed-time.js` independently checks the timing correction.
No image was captured in this run; it establishes continued execution, not
visual progress or gameplay. A separate production-worker strip benchmark found
most default draw wall time spent waiting between256-quad timer callbacks;
bounded scheduling improvements are in progress before the next game capture.

Bounded worker batching follow-up: `/private/tmp/bw-slice-integration.4NVoSq/`
contains current diagnostic1101707/1102175-byte Wasm artifacts, `run.log` and
`frame.png`. The ordinary run uses unchanged256-quad native steps grouped into
4ms/64-step worker callbacks, no stuck override and a45-second wall guard. It
ends at22872 batches in measured45.007s and now reports repeated unsupported
single-level2D texture and primitive topology errors. This is additional failing
draw coverage, not evidence that batches/s measures game speed. The inspected
640x480 capture is still white with a faint yellow spot; no gameplay. Capture
the failing texture and primitive descriptors next before selecting mip/cube or
point/line implementation work. The matching synthetic worker benchmark has
identical output before/after batching, but does not establish real-game parity.

Parameter diagnostic follow-up: the old topology error was misleading. The
actual rejected draw is triangle LIST4 with2950 primitives, exceeding the
adapter's256-primitive limit; it is not a new primitive topology. The rejected
texture is stage0,1024x1024,11 mip levels,0 cube faces. `parameters60.log` records
these values after enriching the existing errors; the preceding30-second run
ended before reaching this phase. Next work is ordered large-draw batching and
real mip-chain sampling, not a point/line or cube workaround. The software
adapter regression now distinguishes capacity failures from topology failures
and checks texture diagnostic fields while preserving allocation ownership.

Large-draw plus mip integration run: `/private/tmp/bw-mip-integration.nWAYwR/`
contains diagnostic1104018/1104486-byte Wasm pair and `run.log`/`frame.png`.
The ordinary60-second launch ends at24379 batches in measured60.019s, with no
renderer errors or STUCK report. The inspected800x600 frame remains white with
a faint yellow spot. Load average was9.16 at launch, so this is not a performance
comparison. No completed-draw/intro-counter capture was collected here; absence
of the previous errors alone does not prove equivalent game progression.
The exact1024x1024 eleven-level shape independently passes software implicit-LOD
pixel tests, and2950-triangle real x86 COM/worker tests pass. Next capture must
record completed draws and intro state alongside images. No gameplay acceptance.

Controlled software probe50895 provides stronger evidence. Artifacts are
`/var/folders/dz/1fqkk_jd4350qkm91pm9_q3c0000gp/T/bw-software-probe-65NV0y/`.
By60s of its observed attachment window it records168 completed draws and80
completed presents, zero submission failures, and one outstanding draw. At55s
the draw categories change from two loading strips per frame to textured lists
of2/2950/8 triangles using1024x1024 eleven-level textures. The inspected final
640x480 image visibly shows LIONHEAD STUDIOS with falling particles and reflection.
This establishes the software intro, not menu/gameplay or backend parity.

`tools/black-white-software-probe.js` uses the existing CLI control channel,
Bridge submission promises and EIP tracing without modifying guest state. Its
first run falsely reported traceHits0 because its address regex accepted at most
one leading zero; actual logs contain three00526d93 hits with ESI074d6bdc. The
parser is corrected; that observed stack address must not be hard-coded into
later probes. Frozen mode was rejected with real ticks, so the tool attaches to
an ordinarily running real-time guest and explicitly measures only that window.

Longer probe23014 (artifacts `bw-software-probe-pnliVq` under the same temp root)
exposes a lifetime failure after initial success. At75s introFrame1/target636 is
observed; by85s/frame5 native raster creation begins failing. Successful DRAW
completions stop at181 while Present and intro counters continue. At120s the
intro is frame62, but346 submissions have failed, including explicit native
allocation failures. This is not healthy progress toward gameplay.

Focused reproduction: `node test/test-d3d9-large-draw.js --stress-mips` repeats
2950 triangles with the1024x1024 eleven-level chain. Run8381 fails at iteration24;
adapter-owned bytes return to512 after each prior draw and all tracked native
contexts are freed, yet sparse heap reservations advance by roughly12MB per
iteration. Current heap allocation uses first-fit splitting and heap_free only
prepends blocks, without coalescing. Fragmentation is the next hypothesis to test
with native free-list inspection/coalescing; accounting returning to baseline is
not proof that the allocator can reuse the storage.

Follow-up: the primary leak was missing sparse inverse translation in `w2g`.
Native WASM-pointer frees therefore supplied an unrelated guest address and were
silently rejected by heap validation. Fixed and verified by actual sparse reuse
in `test-d3d-render-lifetime.js` (51141/20572). Stress93161 now completes32frames
with stable memory after warm-up. Disabling the idle coalescer (41282) passes32
frames but accumulates fragmented free blocks (494->6661), so both inverse
translation and coalescing are retained. These are allocator/render regressions,
not yet evidence that a fresh real-game run progresses through the intro.

Fresh post-fix probe62767 completed180s using diagnostic build
`/private/tmp/bw-native-reuse.5Xjp7I/wine.wasm`. Artifacts:
`/var/folders/dz/1fqkk_jd4350qkm91pm9_q3c0000gp/T/bw-software-probe-frxgg9`.
At the final sample: introframe43,414 completedDRAW,123 completedPRESENT,
zero submission failures, queue627/627 completed. The inspected final image
shows Lionhead logo, particles and reflection. Successful rendering continues
beyond the old frame5 allocation failure; no menu/gameplay yet. Initial load
average82.53 makes this unsuitable for performance comparisons. No guest intro
counter or clock patch was used.

Long-run probe20567 completed its1800-second observation window successfully.
Frozen native artifact: `/private/tmp/bw-long-native.IxWKnd/wine.wasm`;
artifacts: `/var/folders/dz/1fqkk_jd4350qkm91pm9_q3c0000gp/T/bw-software-probe-WjjGiJ`.
The final sample records introframe560/target636,3514 completed DRAW commands,
563 completed PRESENT commands and zero render failures. One draw remained
pending at sampling, before normal shutdown. This demonstrates sustained intro
rendering, not menu/gameplay. The helper now permits an explicit observation
window up to14400 seconds so later runs can reach beyond the full intro without
patching guest counters or clocks. New source requires a fresh matching native
artifact; this run does not validate subsequent shader/stencil/Reset changes.

The ongoing7200-second probe93079 uses the frozen
`/private/tmp/bw-stencil-native.LHj3DN/wine.wasm` artifact and
`bw-software-probe-pOr4aX` capture directory. At2665seconds it reaches
introframe692,4302 completedDRAW and771 completedPRESENT withzero failures.
Live control ping confirms the same process is running. Frame2163.png was
personally inspected: Lionhead particles/logo/reflection, not gameplay. Passing
the recorded target636 does not imply completion: the existing disassembly
above places fade onset after986, then requires the fade threshold and another
500frames. Do not restart or patch the healthy run merely for crossing636.

Later in the same live run, at3839seconds/frame1049, the fade/completion field
is53.54997 rather than zero, and the draw categories include10-triangle lists
instead of only8-triangle reflection draws. All9682 submitted commands have
completed withzero failures at that sample. A subsequent control ping confirms
the same process live atframe1052/fade56.09997. Frame3844.png was personally
inspected: the logo changes orientation and fades, but this remains the intro.
This confirms real progression beyond the documented fade threshold; no guest
animation state or clock has been patched.

Probe93079 is now terminal0 after its7200-second guard and graceful controlled
quit; do not treat it as live or send further input. Intro counter reached1787
against finishFrame1786. The final sample records45985 completedDRAW commands,
53558 completed queue commands andzero failures (one draw pending at sampling).
The final `bw-software-probe-pOr4aX/frame.png` was personally inspected: a
cloud-covered island backdrop with a central panel, empty-looking text fields,
up/down controls and bright polygon artifacts. This is visibly beyond the
Lionhead intro, but neither readable menu text nor interactive gameplay is
verified. New draw categories include1280x960,1024x1024 and256x256 textures.
The run still used frozen `bw-stencil-native.LHj3DN/wine.wasm` and startup-loaded
JS, predating the later POSITIONT precision/coverage correction, PSIZE and
multi-stage work. A fresh matched artifact is required before attributing the
panel corruption to current source. No guest counters or clocks were patched.

Follow-up probe33057 uses `/private/tmp/bw-cascade-native.Ca0YQN/wine.wasm`
with startup-loaded JS including the POSITIONT correction. At4553seconds its
intro reaches1787/finish1786 with16323 commands complete and no render failures.
At4660seconds new post-intro draw categories are active. Live controlled capture
`/private/tmp/bw-postintro-scene.png` was personally inspected: cloud-covered
island, central panel with unreadable text and bright polygons remain. Thus the
POSITIONT correction alone did not resolve this panel corruption. This frozen
artifact still predates later cascade operations, transforms and fog work;
the image is not evidence against all current source. Preserve the live run
for inspection; no guest counters or clocks were patched, gameplay unverified.

The same live run now has a bounded neutral-command capture, armed through its
existing eval control with `tools/d3d-command-capture.js`. Artifact:
`/var/folders/dz/1fqkk_jd4350qkm91pm9_q3c0000gp/T/d3d-command-capture-XfJrDb/frame.v8`.
One Present-to-Present interval contains17 DRAW commands plus PRESENT,
77,634,825 serialized command bytes. Capture restored the original submission
hook after completion. It preserves typed arrays/nonfinite values and copied
shared-memory inputs; completion means capture boundaries, not GPU fences.
It does not snapshot the initial color/depth buffers or earlier resource
commands, so replay equivalence must verify those dependencies explicitly.
Draws0–8 include POSITIONT textured strips; later XYZ triangle lists include
empty texture arrays despite stage0 MODULATE/TEXTURE state. This is observed
binding data, not yet proof of which draws are glyphs or why textures are absent.
The capture enables inspecting/replaying the actual panel submissions without
restarting the healthy guest or waiting through another intro.

Current WebGL2 replay32433 of that capture completed17 draws without GL errors.
Tool: `node tools/d3d-replay-web.js CAPTURE/frame.v8 OUTPUT.png`.
Output `/private/tmp/bw-replay-webgl.png` was personally inspected at its native
800x600 size: the same unreadable central panel and bright polygons occur.
This reproduces the defects with another executor using the captured inputs;
it points away from an exclusively software-rasterizer defect, not toward any
particular frontend cause yet. Replay starts with transparent color and no
prior depth history; it is not a pixel-identical whole-session comparison.
The host texture loop omits a stage only when its canonical bound pointer is
zero; invalid nonzero resources throw rather than silently disappearing. The
captured untextured XYZ lists use repeated quarter-atlas UV rectangles and
varying 3D positions, consistent with sprites/particles rather than proven
text glyphs. Determine their binding provenance separately from missing text.

Current software replay47696 completes the same17 draws. Comparing with WebGL
initially found479666 alpha differences but only1 RGB pixel beyond tolerance2.
Source inspection found WebGL ignored `state.colorWriteMask`; applying
COLORWRITEENABLE per draw fixes that independent compatibility bug. All16 masks
plus invalid-mask/no-pixel-change pass on WebGL1/2 in regression76707.
Replayed WebGL32402 versus `/private/tmp/bw-replay-software.png` now differs
beyond tolerance2 in just1/480000 RGBA pixels (max33, coordinate310,325).
Both still show the unreadable panel and bright particle polygons. This makes
the captured shared draw data/frontend path the next investigation, not a
software-only rasterization explanation. Exact pixel parity is not claimed.

Post-checkpoint investigation on the same live33057 process: the captured
1024x1024 UI atlas (draws2/8) was decoded and personally inspected. Its baked
promotional text is readable, and the panel rectangles are intentionally blank;
the thin divider lines in the menu are present in the source atlas, not damaged
glyphs. No separate glyph-texture draw appears in this captured17-draw interval.
Artifacts `/private/tmp/bw-texture-2.png` and `bw-texture-8.png` are diagnostic
extractions from the immutable capture, not native-Windows references.

Microsoft native `d3dx9_25.dll` disassembly identifies the font constructor at
original0042d202, vtable00401580, and DrawTextA/W entries0042f263/0042f29c.
Both call internal0042d8f7 (runtime025558f7). Existing live EIP tracing confirms
that internal routine executes repeatedly with font object4ed795cc; its common
exit0042ef76 is reached with EDI0 (success). The current process has two loaded
TrueType faces of34044 and134188 bytes. These observations do not prove glyph
generation or successful rendering.

Native global original006298d4/runtime027518d4 reads1, selecting the Uniscribe
branch in DrawText; original006298ac/runtime027518ac reads0. Therefore the
fallback GetCharacterPlacementA/W calls at0042e14e/0042e156 are not the first
path to investigate. Follow the native shaping results and glyph-cache/texture
submission boundary next. No Wine implementation source was used; the DLL
addresses come from the supplied Microsoft binary. Temporary EIP ranges were
restored to the original intro probe range00526d93–00526d97 afterward, without
changing guest animation state or restarting the healthy process.

The next inspection found valid shaped glyph IDs/positive advances, but the
first six cached glyph records reached through font+0x550 all start with
FFFFFFFF followed by zero geometry. Native D3DX0042d32c marks that sentinel
at0042d468 when its measured glyph advance is zero. On the Win9x branch it
uses MoveToEx, ExtTextOutA(options12hex, NULL rectangle, one WORD glyph index),
then MoveToEx to retrieve the updated current position. Our text compositor
rejected the NULL opaque rectangle and did not implement direct glyph indices.
This explains the observed empty-cache path; fresh corrected game rendering
is still required, and cached failures in the old live process are not patched.

Native Win98 oracle `gdi-exttextout-glyph` now covers32 A/W, character/glyph,
NULL/supplied rectangle and options0/2/4/6 combinations. With Arial height-16,
GCP maps A to glyph36; every case returns1, advances CP to(11,0), and draws28
nonblack pixels. Thus Win98 accepts NULL rectangles with OPAQUE/CLIPPED and
renders ANSI WORD glyph indices. This differs from the current Microsoft
[ExtTextOutA documentation](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-exttextouta)
describing ANSI glyph-index calls as a no-op; do not substitute that behavior
for the measured Win98 contract.

Reproduce with `node tools/v86-reference/capture.js --online --manifest
tools/v86-reference/glyph-apps.json --app gdi-exttextout-glyph --serial-output
/private/tmp/win98-exttextout-glyph.serial` (one command). Capture54317 exited0
at2026-09-11T00:46:45.542Z using the pinned v86 Win98 image. Probe EXE SHA256:
`d6cdcb6a24f744b80d743484f1133412932fe38ac443f43a07c744527a8c6c6c`.
Generated metadata is `screenshots/v86-reference/generated/gdi-exttextout-glyph.json`;
serial transcript has32 CASE lines and EXTTEXTOUT_GLYPH_DONE. Source probe and
isolated manifest are tracked candidates; no Windows binary is added.
Null-rectangle normalization and direct TrueType glyph-index rendering are
implemented using the existing native cache and shared text compositor.
The glyph regression covers A/W WORD inputs (including indices above255),
current-position advances, PDY, clipping, path recording and invalid indices.
Bitmap-font indexed output remains explicitly unsupported.

The standalone native D3DX integration probe now verifies the complete font
path, not just GDI: `node tools/d3dx-font-probe.js --dll=/path/to/d3dx9_25.dll
--wasm=/path/to/wine-assembly.wasm` (one command). It executes the supplied
Microsoft DLL's CreateFontA/DrawTextA, uploads its glyph texture, and checks the
software worker's canonical320x160 frame. Baseline75148 exited the guest
successfully but failed acceptance with zero white pixels and51200 blue pixels.
Corrected run12873 passed with863 white pixels and50337 blue pixels; its PNG
was personally inspected and shows readable white “Black & White 2” text.
The actual browser guest/WebGL2 probe31600 also passes with863 white pixels,
50337 blue pixels and GL error0; its PNG was personally inspected and shows
the same readable text. Reproduce using `node tools/d3dx-font-web-probe.js
--exe=/path/to/probe.exe --dll=/path/to/d3dx9_25.dll --wasm=/path/to/current.wasm`
(one command; the software probe builds the fixture EXE). The harness observes
the real backend's target at Present, before normal guest teardown. Initial
browser attempt2860 selected Notepad due to the global launch wrapper ignoring
arguments; corrected harness selects its explicit registry entry instead.
Full canonical/compat build15499 and repeated software font85829 pass after
concurrent main merges. These are focused native-DLL integration results, not
proof of fresh full-game menu/gameplay. No guest cache was patched.

Fresh current-artifact game run98750 was started after checkpointad3ba44b, using
`/private/tmp/bw-glyph-current.pohQXb/wine.wasm` (1141556 bytes). It is independent
of the preserved old33057 process whose native glyph cache already contains
failures. At587 seconds the new run reaches intro frame105, with785 completed
draws and zero reported renderer failures; menu/gameplay acceptance is pending.
Artifacts: `bw-software-probe-DLH67d` under the host temporary directory. This is
a progression observation, not a throughput benchmark (launch loadavg39).

Local Candidates now includes `black_white_2_demo` (Black & White 2 Demo).
The prepared MainApp tree is copied to the ignored local corpus directory
`test/binaries/win98-games-a-d/Black and White 2-DX9-D3D/installed/`;
`node tools/gen-win98-games-a-d-manifests.js` inventories its363 companions.
The entry seeds the same three native DLLs as the CLI probe and opts into the
experimental programmable profile for this app only; renderer selection stays
user-controlled (`?d3d9-renderer=software` for software, WebGL by default).
CLI: `node test/run.js --app=black_white_2_demo --d3d9-renderer=software`.
This registers the extracted game, not an installer-success or gameplay claim.

Progression update: current-font run98750 remains live, reaching intro frame1513
at5947 seconds with finishFrame1786 and zero reported renderer failures.
`frame-5941.png` was visually inspected: complete Lionhead logo/reflection, not
yet the menu. Older pre-font-fix run33057 is now authoritatively terminal with
exit0; its recorded final intro frame1787 and cached missing-glyph state are
historical evidence only. No restart or guest-state patch was used.

Current-font run98750 has now passed intro frame1786 and reached the profile
creation menu. Personally inspected `frame-7320.png` shows readable “Select
Profile”, “New Profile Name”, “Close”, and the main menu labels over the island
background. At7331 seconds the renderer reports20665 completed draws and zero
failures. This proves the glyph fix reaches the real game's menu, not just the
standalone font probe. Profile selection and changing gameplay remain unverified;
the frozen executable artifact predates lighting/cache/scissor checkpoints.
