# Hype: The Time Quest demo

App: `hype_glide_demo` (experimental). Original executable:
`test/binaries/candidates/hype-time-quest-demo/launch-game/MaiDFXvr_bleu.exe`.
The executable directly imports 50 Glide 3 entry points. Static extraction,
English installer mappings, package provenance and generated Windows INI are
documented in [the Glide 3 corpus report](../glide3-corpus.md).

## Startup DebugBreak: missing main-image export lookup

The 2026-09-29 remote CLI smoke stopped in the original sound plugin before
establishing Glide gameplay. The relevant log is
`~/nfs-movsd/build/hype-glide-smoke.log` on the reserved test box. It loaded:

| Image | Original base | Observed loaded base |
| --- | --- | --- |
| `MaiDFXvr_bleu.exe` | `0x00400000` | `0x00400000` |
| `dll/WAVx2BVR.dll` | `0x10000000` | `0x04301000` |

Thread 1 stopped at runtime `0x04302129`, preferred DLL VA `0x10001129`.
The preceding instruction reads the callback cell at preferred
`0x10024b9c`; if it is zero, the plugin calls `DebugBreak`. After the break,
the wrapper would call that same pointer, so ignoring the break would enter
address zero rather than repair startup.

The plugin initializer at `0x10003fb0` first resolves
`_SND_fn_vDisplayError@8` from the main executable handle. Its lookup helper
at `0x10003f40` calls `GetProcAddress`. If that returns zero, it constructs
the message `Function cannot be loaded dynamically` and invokes the error
callback that it has not yet initialized. Thus the visible break is the
error-reporting path for the failed export lookup.

The original executable **does** export the requested callback:

| Name | Ordinal | Original function VA |
| --- | ---: | --- |
| `_SND_fn_vDisplayError@8` | 2229 | `0x004d5430` |
| `_SND_fn_vDisplayErrorEx@12` | 2230 | `0x004d5490` |

The executable has 2,739 export-address entries, no zero holes and no
forwarders. Its export directory is RVA `0x194d70`, size 115,602 bytes.
This was checked against the original file, not inferred from strings.

`handle_GetProcAddress` previously searched `DLL_TABLE`, then known native
API names. The executable is not a member of `DLL_TABLE`, so it could not
answer this lookup. The fix resolves exports from the main image before
that existing path, using the shared mapped DOS/PE headers to obtain the
export directory. It must not rely on the loader instance's
`exe_export_rva` global: Hype makes the call on a secondary guest thread.
No sound configuration, executable bytes, or `DebugBreak` behavior changed.

The existing `test/test-getprocaddress-sparse-name.js` now checks the callback
name and ordinal, out-of-range ordinals, a zero address-table slot, an absent
name, stdcall stack cleanup and operation with the loader-global RVA zero.
Its original sparse-heap Win32 lookup still passes. The focused test passed
remotely on 2026-09-29 after correcting the synthetic fixture's name pointers
to lie above the 16-bit ordinal range. The post-fix remote CLI run reached a
visible main menu without the startup `DebugBreak`; evidence is
`build/hype-fixed-startup.log` and `build/hype-fixed-startup.png` on the test
box. The screenshot was opened for review. Browser Glide identity, entry into
the playable world and input-driven movement remain pending; menu acceptance
alone does not establish gameplay.

## Reproduction

Prepare the original extracted corpus, then use a current compiled artifact
on the remote test machine:

```sh
node tools/prepare-glide3-corpus.js --check
node test/test-getprocaddress-sparse-name.js
node test/run.js --app=hype_glide_demo --threads --no-build \
  --wasm=build/wine-assembly.wasm --quiet-api --max-batches=2000 \
  --png=build/hype-fixed-startup.png
```

Static evidence can be reproduced without executing the game:

```sh
node tools/pe-exports.js test/binaries/candidates/hype-time-quest-demo/launch-game/MaiDFXvr_bleu.exe
node tools/disasm.js test/binaries/candidates/hype-time-quest-demo/launch-game/dll/WAVx2BVR.dll 0x10001120 0x10001142
node tools/disasm.js test/binaries/candidates/hype-time-quest-demo/launch-game/dll/WAVx2BVR.dll 0x10003f40 0x10003fe7
```

## Export lookup limits

Native KERNEL32 currently aliases the main image handle. A missing EXE export
therefore retains the existing native-API fallback; removing it would break
callers looking up Win32 functions through that alias. An unknown callback
still returns zero. This is compatibility with the current handle model,
not evidence that distinct Windows module handles are interchangeable.

The reused `resolve_image_export` helper validates ordinal bounds and empty
address entries. It assumes valid name-to-ordinal indices and does not follow
PE export forwarders. The new dynamic main-image path guards the export
directory's RVA/size range: a resolved address inside it logs marker
`0x46574452` (`FWDR`) and the address, then traps. It therefore cannot return
a forwarder string as callable code. Named and ordinal forwarder cases have
focused regressions, which also passed remotely. Hype has no
such entries. This is an explicit unsupported case, not general forwarded-export
support; malformed PE export tables remain outside this investigation.

## Normal-input gameplay probe

The original `launch-game/Readme.txt`, section IX, documents the default
QWERTY bindings: arrows control the character, left Shift runs, Ctrl jumps,
Space performs an action, and Enter uses magic. Up/Down navigate menus;
Left/Right turn in the world. Do not assume a held Enter key moves the player.
`Gamedata/Options/Default.cfg` is binary data, not a text configuration to edit.

The existing investigation probe `build/glide-app-probe.js` can launch
`hype_glide_demo webgl 120 build/hype-gameplay-webgl`. It records desktop and
actual Glide drawable screenshots every five seconds, plus API version,
endpoint/backend and draw/present counters in `states.jsonl`. Its screenshots
are observations, not automatic world acceptance. A normal New Game menu
selection must be verified visually before calling a changed image gameplay.
After reaching the world, compare a stationary frame against a held ArrowUp
interval and a turn, while confirming API version 3, a `glide` endpoint and
advancing geometry/presents. The probe accepts investigator input through
`input.json`, for example `[{"hold":"ArrowUp","ms":3000}]`; this drives
ordinary browser input and does not modify the guest state directly.

### Menu input, viewport and FIFO polling (2026-09-30)

The menu initially ignored held keys despite correct host physical-key state.
Original code at `0x48e3bd` checks `DIDEVCAPS.dwFlags & DIDC_ATTACHED` before
enabling its keyboard. Our capabilities omitted that flag. Correct attached
keyboard/mouse reporting, plus the correct `dwButtons` offset 16, passes the
remote DirectInput regression for both 24-byte and 44-byte structures. Normal
Enter now loads the level. Keyboard flags change from `0x12` to `0x13`, and
the guest poll counter advances. No focus or input-transport workaround was
needed.

The resulting level capture still occupies only part of the 640×480 drawable.
A read-only snapshot confirms the top window has a 640×480 client, while its
three nested children retain 388×268 clients. Hype initializes its logical
resolution globals `0x5d8108/0x5d810c` to 640/480 and correctly selects Glide
resolution enum 7. Its viewport creation (`0x49a730`) uses the parent's client
rectangle, and `DEV_Device::OnSize` (`0x499250`) resizes the child. The Glide
fullscreen path changed geometry without the normal resize notification.
A candidate delivered `WM_WINDOWPOSCHANGED` after releasing the Glide lock,
allowing normal `DefWindowProc` processing to produce `WM_SIZE`. The subsequent
`build/hype-full-world-webgl.log` snapshot still had 388×268 child clients.
The candidate and its callback fixture were removed: it did not improve the
layout and its internal synchronous dispatcher bypassed window-owner thread
routing. A subsequent owner-thread fix is described below.

The matched `hype-capture3-webgl` / `hype-no-notify-webgl` captures also exclude
notification as a necessary cause of the observed bad geometry. Both capture
three triangles with nine vertices: five X values are NaN and all finite X
values are zero. Their draw state and non-finite field patterns match; all
eight drawable PNGs in both runs share SHA-256
`d38b77b951118e53418317ab5ab5fea654c449b3dc757ede3c171383b4902ceb`.

Static inspection narrows the next trace: `CPA_MainFrame::OnSize` at
`0x499fe0` calls helper `0x477a70`, which always returns zero. It therefore
takes the branch that conditionally waits on the application's semaphore
before calling native MFC42 ordinal 5030 through thunk `0x4f442c`. That MFC
handler (preferred address `0x5f40df89`) invokes its default handler and then
virtual method `+0xd0` (frame layout) unless the size type is minimized.
Counting entries to `0x499fe0` and `0x499250`, alongside child creation and
Glide open, will distinguish missing dispatch from notification timing or
layout suppression. No compositor scaling workaround is justified by this
evidence.

For upstream geometry diagnosis, original polygon clipper `0x483670` takes
the vertex count in ECX, a 60-byte-stride vertex buffer in EDX, and the renderer
context at `[ESP+4]`. Float clip bounds in that context are top `+0x3daa8`,
bottom `+0x3daac`, left `+0x3dab0`, and right `+0x3dab4`. Screen-quad producers
`0x486a30` and `0x486d20` use staging buffer `0x835ae0` (four vertices), but
which produced the captured frame remains unverified.

The Y-edge interpolator at `0x483bf0` is a specific candidate for the NaNs:
it calculates `(boundary-yA)/(yB-yA)`, interpolates X and attributes, and writes
the boundary directly as Y. This can produce the captured finite-Y / NaN-X
and attribute pattern. At its entry ECX is the output vertex, EDX is vertex A,
and stack offsets `+4,+8,+12,+16,+20` hold vertex B, yA, yB, boundary, and
context respectively. Capturing these inputs and the pre-clip staging buffer
will distinguish invalid source geometry or bounds from arithmetic failure;
the instruction sequence alone does not establish which occurred.

The subsequent world stall is a separate query bug. The rendering thread
repeatedly reaches `0x4f1626`, the `grGet` import thunk. Calls at `0x482427`,
`0x482442` and related sites ask for `GR_FIFO_FULLNESS` (3), length 8, and loop
while the first output word exceeds 2,000,000. The unimplemented query returned
zero without writing the output, leaving a stale stack value to drive an
infinite polling loop. The query now drains pending commands and waits for
backend completion (WebGL `finish`, synchronous native software), then writes
the SDK's free-entry count and status words. This adds no pixel readback.
ABI ordering, invalid-length and output-boundary tests pass remotely, as do
software and WebGL 1/2 completion tests. The render loop now progresses.

A subsequent captured frame still cannot change the picture: it clears only
depth, then submits three invalid/degenerate triangles. Five of nine vertices
have NaN X; the other four have X=0. Both software and WebGL retain the menu.
This first post-load frame was not enough to characterize steady gameplay.
The later matched notification comparison and frame captures below narrow
the observation without establishing a CPU arithmetic bug.

Evidence on the remote machine: `build/hype-attached-webgl/` contains the
first world capture; `build/hype-world-diagnostics.log` and its corresponding
`states.jsonl` record the window tree and stalled thread. These captures do
not yet demonstrate movement.

### Later frame comparison

Matched runs `build/hype-steady-default/` and
`build/hype-steady-interpreter/` use the same no-notification WASM and normal
Enter, Space, ArrowUp and ArrowRight route. The second disables both the
micro-op tier and x87 folding. A frame captured after 800 presents contains
no geometry in the default run, versus 390 triangles with 1,170 finite
vertices in the interpreter run. This comparison does not isolate either
optimization or prove a CPU bug: the captured frames can represent different
points in the application's execution.

Interpreter screenshot `006-drawable.png` shows the character in a blue
corridor, still restricted to 388×268 pixels. It was opened in Preview.
The other 15 drawable captures retain the exact earlier menu hash. LFB
read/write counts stop at 238 and remain unchanged through the later capture
interval, so repeated LFB uploads do not explain that return to the menu
image. Later actual-presentation captures below identify the alternating
guest swaps; this was not dropped delivery by the shared render worker.

### Owner-thread resize and movement

Glide fullscreen open now posts `WM_MOVE` and `WM_SIZE` through the existing
owner-routed USER queue, matching DirectDraw's mode-change path. It does not
call the window procedure on the rendering thread or while holding the Glide
lock. The focused ABI regression opens from one instance with a window owned
by another, verifies the ordered payloads and absence of inline callbacks,
and checks that a failed open posts nothing.

On the trusted fallback server, `build/hype-post-size-webgl/` captures a
636×476 child viewport inside the 640×480 drawable, replacing the earlier
388×268 viewport. Actual presentation frames in `build/hype-swap-callers/`
show normal ArrowUp movement and ArrowRight turning; `world-present-661.png`
and `world-present-1047.png` were compared visually and opened in Preview.
Default CPU settings in `build/hype-default-callers/` also produce four
captured world frames with 403–406 triangles and no nonfinite fields.
The earlier single-frame optimized/interpreter comparison sampled opposite
halves of the UI/world alternation and does not establish a CPU bug.
The remaining empty UI swap still prevents stable visible presentation.

### Alternating world and UI swaps

The eight adjacent swaps in `build/hype-swap-callers/frame-capture.json`
all originate from thread 1, return to `0x4671d4`, and use interval 1.
World frames have higher caller `0x43f631`; empty frames have caller
`0x42252b`. Device `0x03f012d8` has field `+0x38 == 0`, and both globals
`0x77728c` and `0x5da054` are zero throughout this sample.

Static disassembly explains the pair: frame-finish callback `0x43f610`
(installed at `0x5b2290`, paired with render callback `0x43f180` at
`0x5b228c`) finalizes descriptor `0x71cd04`, swaps surface ID
`short[0x71cd02]`, then directly calls `0x422260` at `0x43f678` before
releasing semaphore `[0x71cd6c]`. That second function acquires surface
`short[0x71cd70]` into descriptor `0x71cd74`, visits UI objects from
`[0x7136e0]` through links at `+0xd8` using `0x41f300`, finalizes the
descriptor, and unconditionally calls the same swap wrapper. These are
nested guest paths, not two independently scheduled windows or threads.

Wrapper `0x467180` decodes its second argument as device index `/16` and
surface index `%16`, clears the surface's acquired flag at `+0x64`, and
calls Glide swap when `[0x77728c] == 0`. Acquisition `0x467070` sets that
global from whether device field `+0x38` is nonzero. No renderer suppression
is justified by this evidence. The follow-up capture records world surface
ID 0 and UI surface ID 1 on device 0, an empty UI-list head at `0x7136e0`,
mode byte 9 at `0x71c620`, and zero flags at `0x5d9680/84`. The unresolved
question is why this device/surface configuration requests a second flip
without intervening color drawing.

Device field `+0x38` is not populated by a Glide capability query. Constructor
`0x466810` allocates a 0x10c-byte device and copies the caller's first
0x6c configuration bytes into it at `0x466b9e–0x466ba5`. The normal MFC
creation path at `0x499450` explicitly sets configuration `+0x38` to zero
at `0x49949e`, then calls this constructor at `0x49950d`. An alternate
path at `0x499320` sets it to one, but its entry checks `0x477a70`, whose
original implementation is exactly `xor eax,eax; ret`; consequently that
alternate path is disabled in this executable. The constructor can also
clear a nonzero value if an existing device already has it set. The observed
zero therefore matches the original executable's selection, and changing
Glide query results or forcing this field would not be a supported fix.

The pinned Glide 3 SDK's `gglide.c` implementation of `grBufferSwap`
unconditionally cycles current/front/back indices modulo the configured
buffer count, queues the swap command, and selects the new drawing buffer.
It has no exception for an empty frame. Its fast clear also respects the
RGB write mask, so a depth-only clear correctly preserves the older menu
color. These rules agree with the observed alternating buffer contents.
One concrete difference remains: our `handle_grBufferSwap` does not pass
the guest's swap interval to the host; it flips and publishes immediately.
The SDK encodes interval 1 as a retrace-synchronized swap and bounds pending
swaps. Browser compositing may therefore repeatedly sample the second UI
presentation when our two swaps happen close together. Correct pacing
would preserve both requested flips; it is not evidence that the retained
menu pixels should be discarded or that pacing alone fixes gameplay.

Buffer initialization does not explain the alternation either. All four
original `grSstWinOpen` call sites request two color buffers and one auxiliary
buffer. The executable imports no `grRenderBuffer`, `grGlideGetState`, or
`grGlideSetState`; it keeps the default back-buffer target. The SDK's initial
physical buffer numbering differs from ours, but the logical front/back
rotation is equivalent. Initial parity cannot account for menu pixels retained
after the later LFB uploads.

An isolated 120-second default-CPU replay then tested an interval-1 wait
before each swap using the existing virtual-vblank scheduler. It preserved
every requested flip and left canonical WASM and production source unchanged.
`build/hype-vsync-default/frame-capture.json` still alternates four finite
world frames (403–406 triangles) with the same old menu. Device and main-thread
present counts agree; the run ends without errors. World visibility between
actual publications was about 32–38 ms, versus 36–47 ms in the unpaced sample.
These are diagnostic observations, not controlled performance measurements.
Pacing alone did not fix stable presentation and was not promoted to production.

## 2026-10-04 user menu report: current source-only audit

Registered closure is restored:59 manifest entries/60 unique required files,
38,074,960bytes, all regular/present (stat-only inventory). The old20261003 task's
missing-asset verdict is stale. Exact source/module/EXE identities and missing
historical build capture paths are in scratch/hype-menu-20261004/asset-source-audit.json.
Raw historical world/UI captures are not present locally; their conclusions above
are documented history, not a new review.

Current DIDC_ATTACHED keyboard/mouse fix remains in source. Current Glide swap
still preserves both front/back flips; no interval/drop-empty workaround has been
added. Thus first reproduction must distinguish failed New Game input from the
known world/UI alternation. Use Up/Down to select menu, short Enter to activate;
in world arrows move/turn, Shift runs, Ctrl jumps, Space acts, Enter uses magic.
A menu screenshot never qualifies gameplay. New bounded route and optional passive
adjacent-presentation capture proposal: scratch/hype-menu-20261004/PLAN.md.
No runtime yet; Claude HeroesII profiling has exclusive resource ownership.

## 2026-10-04 ordinary menu reproduction

Run scratch/runs/20261004-hype-menu-enter-stall1 (24 hashed artifacts) uses
canonical f40 WASM, current unmodified host/Worker, actual Intel UHD620 WebGL
renderer. The menu has New Game highlighted. Enter150ms is followed in the log
by window title "Chargement de la map", then Hype The Time Quest. The menu
image remains. This contradicts a blanket claim that Enter is not delivered.

Before Enter:1700 swaps. After Enter:2057 swaps/presents,143990 triangles/draws,
2077 LFB reads/writes. These values remain exact through later focused Down and
visible New Game click and final snapshot. Thread1 cached worker-slice count
advances22079 ->72166 ->89451 with sampled lastEIP496635/49413c/493243, yield0;
no critical-section waits/steals reported. Thread2 audio lastEIP4409d42/yield7.
No guest exception reported, no world frame observed. HWND10001 remains640x480
with636x476 viewport descendants.

Unlike historical world/UI alternation, current reproduction stops publishing
Glide frames while guest execution continues after the map-load title. This is
not evidence that dropping an empty swap would fix anything. The exact phase
and root cause remain unresolved: cached host PCs are not stopped owner stacks,
and render publication stopping does not alone prove unfinished map loading.
Menu-only screenshots do not count as gameplay; performance null.

Next focused diagnostic: capture owning renderer-thread registers/stack at a
bounded set of actual execution boundaries after Enter, plus current game frame
callbacks43f180/43f610 and swap boundary467180 entry counts. Verify exact live
EXE mapping and source identity, no BP/guest-state changes or shadow execution.
Distinguish never reaching rendering, semaphore/frame-callback wait, and repeated
guest interpreter/input loop. Only observe actual presentation pairs if swaps
resume; do not assume historical alternation. Scope/helper review and a new serial
grant are required. Ordinary browser66050 closed11:27:02.507Z, bothclosed/PIDgone.

### Source follow-up: possible Action-key wait

The sampled PCs are input evaluation:493243 is inside exported IPT_fn_vReadInput
(entry4930e0),49413c returns from an input-command dispatch in IPT_Kwan.c, and
496635 updates six-byte input records. A direct caller4208e0 has a no-render
loop420925..42097d that looks up literal Action_Key and polls IPT_fn_vReadInput
until its command state becomes positive. Readme maps Action to Space, matching
the older Enter-then-Space route. Other input callers exist, so this is a specific
hypothesis rather than an identified active frame. It may be waiting for a hidden
Action prompt, not a loading failure.

Next proof proposal scratch/hype-menu-20261004/OWNING-PHASE-PROPOSAL.md uses the
existing owning get_key_down_state import with bounded passive stack/global reads,
then ordinary Space. No trace flags/BP/guest mutation or swap suppression needed.
No follow-up runtime or engine edit has run.

### 2026-10-04 ordinary Space continuation: rendering resumes, menu remains

Run `scratch/runs/20261004-hype-enter-space-menu2` uses actual served canonical f40d4ca3, no observer or engine modification. New Game highlighted→Enter150ms logs map-loading title; swaps6126 remain unchanged until ordinary Space300ms. Eight seconds later swaps6421 (+295), draws488471 (+59651), shader variants1→6; LFB reads/writes stay6146. Cached owner PC changes493243→482912. Nevertheless personally/root-reviewed1/3/8-second images all retain the menu. Space is therefore not a demonstrated visible fix, and failure to reach the owning input state is not established either. Exact wait caller/presentation ownership remain unproven. No gameplay screenshot or FPS claim. Browser/server closed cleanly17:59:30.414Z.

### 2026-10-04 passive source capture rules out page-compositor-only explanation

`20261004-hype-space-presentation3` observes actual owner VK_SPACE returns0→32768→0; raw down stack includes42097d (candidate return, not an unwind). Space reaches owning input. Publications1735→1775→1859→2029, but all12 sequential bridge/selected-layer/final PNGs across four phases hash b81ef4efd2344280d59180e8b43777177eb5dbd1fb8b4616816ad7bb74f8b824 and show menu. GPU layer on10001 is unmerged and sequence advances beyond oldGDIseq1742. This sample's retained menu is already in bridge source; pure page-child occlusion is insufficient. Investigate render-worker front/back/default drawable and bitmap transfer next, rather than blind input retries. Private passive Worker only; canonical f40 module/host, no gameplay claim. Clean release18:14:07.522Z.

### 2026-10-04 current upstream capture confirms world/menu alternation

`20261004-hype-upstream-alternation4` captures four consecutive swaps1408..1411: world/menu/world/menu. Naturalentry/front/returned pixels match within each group. Resource3/variant4 hasworld, resource1/variant2 menu;405newdraws betweenworldgroups versus3perinterveningmenu. Thus selection-to-presentationcopy preserves observed frames; do not patchcompositor or suppress swaps on this evidence. Actualpage space-1s showsworld, space-8s menu; capturessequential, notatomic. Need current owningcaller/three-menu-command purpose beforefix. No movement/control/FPS qualification. Private diagnostic only; canonicalf40, released18:32:21.719Z.
